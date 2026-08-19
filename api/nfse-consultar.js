import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import nfseCertManager from '../lib/nfse-cert-manager.js'
import { NFSeADNClient } from '../lib/nfse-adn-client.js'
import { registrarEvento, EVENTOS } from '../lib/nfse-events.js'
import { abrirOperacao, fecharOperacao, OPERACOES } from '../lib/nfse-operations.js'

// Consulta a NFS-e no portal nacional e guarda o XML oficial se ainda não o
// tivermos.
//
// GET /api/nfse-consultar?emission_id=57
//
// ⚠️ ISTO NÃO É UM VERIFICADOR DE DISPONIBILIDADE PARA A TELA CONSULTAR EM
// LAÇO. Para as notas que ESTE sistema emitiu, o XML oficial vem junto com a
// autorização (`nfseXmlGZipB64` na resposta do POST) e já está gravado em
// `nfse_emissions.xml_nfse`. A disponibilidade, portanto, é um dado nosso —
// `status = 'autorizada'` e `xml_nfse` presente — e não algo a descobrir
// batendo no governo de 30 em 30 segundos, por linha da tabela, em cada aba
// aberta. Esta rota existe para o caso em que o XML NÃO foi guardado (falha ao
// descompactar, nota emitida por outro caminho, reconciliação).
export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const emissionId = parseInt(req.query.emission_id, 10)
  if (!Number.isInteger(emissionId)) {
    return res.status(400).json({ error: 'emission_id é obrigatório' })
  }

  try {
    const sql = neon(process.env.DATABASE_URL)
    const [em] = await sql`
      SELECT id, company_id, invoice_id, chave_acesso, ambiente, status, nfse_number,
             (xml_nfse IS NOT NULL) AS tem_oficial
      FROM nfse_emissions WHERE id = ${emissionId}`

    if (!em) return res.status(404).json({ error: 'Emissão não encontrada' })

    if (!em.chave_acesso) {
      // Sem chave não há o que consultar — e isso não é falha do portal.
      return res.status(422).json({
        disponivel: false,
        error: 'Esta emissão não tem chave de acesso',
        detalhe: em.status === 'erro'
          ? 'A transmissão falhou; a nota não chegou a ser autorizada.'
          : 'A chave é atribuída pelo SEFIN na autorização.',
      })
    }

    // Já temos o oficial: responde sem incomodar o portal.
    if (em.tem_oficial) {
      return res.status(200).json({
        disponivel: true,
        origem: 'local',
        mensagem: 'XML oficial já guardado — o download é imediato.',
        chave_acesso: em.chave_acesso,
        nfse_number: em.nfse_number,
      })
    }

    const cert = await nfseCertManager.getCertificateFromDB(sql, em.company_id)
    const cliente = new NFSeADNClient({
      ambiente: (em.ambiente ?? 2) === 1 ? 'producao' : 'homologacao',
      pfxBuffer: cert.pfxBuffer,
      senhaPfx: cert.password,
    })

    // Consulta não envia documento — `xml_enviado` fica nulo. O que interessa
    // aqui é a RESPOSTA: é ela que traz o XML oficial que faltava.
    const opId = await abrirOperacao(sql, {
      company_id: em.company_id, invoice_id: em.invoice_id, nfse_emission_id: em.id,
      operation_type: OPERACOES.CONSULTA, ambiente: em.ambiente ?? 2,
    })
    const r = await cliente.consultarNFSe(em.chave_acesso)
    await fecharOperacao(sql, opId, r)
    if (!r.ok) {
      return res.status(r.status === 404 ? 404 : 502).json({
        disponivel: false,
        error: r.erro,
        chave_acesso: em.chave_acesso,
      })
    }
    if (!r.nfseXml) {
      return res.status(502).json({
        disponivel: false,
        error: 'O portal respondeu sem o XML da nota',
        resposta: r.resposta,
      })
    }

    // Backfill: o que faltava agora está guardado, e a próxima consulta nem
    // sai daqui.
    await sql`
      UPDATE nfse_emissions
      SET xml_nfse = ${r.nfseXml},
          nfse_number = COALESCE(nfse_number, ${r.numeroNfse}),
          status = CASE WHEN status = 'enviada' THEN 'autorizada' ELSE status END,
          approved_at = COALESCE(approved_at, NOW()),
          updated_at = NOW()
      WHERE id = ${em.id}`

    await registrarEvento(sql, em.id, EVENTOS.AUTORIZADA, {
      origem: 'consulta ao portal', chave: em.chave_acesso, numero: r.numeroNfse,
    })

    return res.status(200).json({
      disponivel: true,
      origem: 'portal',
      mensagem: 'XML oficial recuperado do portal e guardado.',
      chave_acesso: em.chave_acesso,
      nfse_number: r.numeroNfse ?? em.nfse_number,
    })
  } catch (err) {
    if (err.code === 'CERT_NOT_FOUND') {
      return res.status(422).json({ error: 'Certificado digital não configurado para esta empresa' })
    }
    console.error('[nfse-consultar] falha:', err.message)
    return res.status(500).json({ error: 'Erro ao consultar a NFS-e' })
  }
}
