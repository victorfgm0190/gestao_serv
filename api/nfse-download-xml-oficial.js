import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import nfseCertManager from '../lib/nfse-cert-manager.js'
import { NFSeADNClient } from '../lib/nfse-adn-client.js'
import { registrarEvento, EVENTOS } from '../lib/nfse-events.js'
import { abrirOperacao, fecharOperacao, OPERACOES } from '../lib/nfse-operations.js'
import { resolverEmissao, nomeArquivo } from '../lib/nfse-resolve.js'

// XML OFICIAL da NFS-e — a nota autorizada pelo SEFIN Nacional.
//
// GET|POST /api/nfse-download-xml-oficial
//   { emission_id | nfse_id | invoice_id | nfse_number, forcar_portal? }
//
// Devolve o ARQUIVO (bytes + Content-Disposition), não um JSON com uma URL:
// não há onde hospedar um blob, e é assim que a tela já baixa DANFSE e XML
// (`baixar()` em NFSeEmitidas.jsx monta o object URL a partir da resposta).
//
// ⚠️ "OFICIAL" AQUI SE OPÕE À DPS, NÃO AO CACHE. O documento fiscal é a NFS-e
// que o SEFIN assinou e devolveu; a DPS (`xml_assinado`) é só o pedido que
// enviamos — sem número, sem chave e sem o prestador, que o SEFIN preenche do
// cadastro nacional e proíbe de mandar na DPS (E0121/E0128).
//
// ⚠️ E o oficial NÃO precisa ser rebaixado do portal a cada clique: ele chega
// JUNTO com a autorização (`nfseXmlGZipB64` na resposta do POST) e já está em
// `nfse_emissions.xml_nfse`. Conferido em 2026-09-01 contra a produção, nas
// emissões #100 (autorizada) e #57 (cancelada): o XML devolvido pelo
// `GET /SefinNacional/nfse/{chave}` é BYTE A BYTE o que está guardado — 9.379
// caracteres nos dois casos, `igual = true`. Consultar o governo para receber
// o arquivo que já temos é bater na porta dele por hábito.
//
// Então: guardado → entrega na hora; faltando → consulta o portal, guarda e
// entrega. `forcar_portal` refaz a consulta mesmo tendo o arquivo (para
// reconciliar quando se desconfia do que foi gravado). O header
// `X-NFSe-Origem: local|portal` diz por onde veio, sempre.

async function consultarPortal(sql, em) {
  const cert = await nfseCertManager.getCertificateFromDB(sql, em.company_id)
  const cliente = new NFSeADNClient({
    ambiente: (em.ambiente ?? 2) === 1 ? 'producao' : 'homologacao',
    pfxBuffer: cert.pfxBuffer,
    senhaPfx: cert.password,
  })

  // A consulta não transmite documento — `xml_enviado` fica nulo. O que
  // interessa na trilha é a RESPOSTA: é ela que traz o XML oficial.
  const opId = await abrirOperacao(sql, {
    company_id: em.company_id, invoice_id: em.invoice_id, nfse_emission_id: em.id,
    operation_type: OPERACOES.CONSULTA, ambiente: em.ambiente ?? 2,
  })
  const r = await cliente.consultarNFSe(em.chave_acesso)
  await fecharOperacao(sql, opId, r)
  return r
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // GET pela query, POST pelo corpo — a mesma rota serve o <a download> da
  // tela e a chamada programática da especificação.
  const entrada = { ...(req.query || {}), ...(req.body || {}) }
  const forcarPortal = entrada.forcar_portal === true || entrada.forcar_portal === 'true'

  try {
    const sql = neon(process.env.DATABASE_URL)

    const { emissao: em, aviso, erro } = await resolverEmissao(sql, entrada)
    if (erro) return res.status(erro.status).json(erro.body)

    let origem = 'local'
    let xml = null

    if (em.tem_oficial && !forcarPortal) {
      const [linha] = await sql`SELECT xml_nfse FROM nfse_emissions WHERE id = ${em.id}`
      xml = linha?.xml_nfse ?? null
    }

    if (!xml) {
      // Sem chave não há o que consultar, e isso não é falha do portal: a
      // chave é atribuída pelo SEFIN na autorização.
      if (!em.chave_acesso) {
        return res.status(422).json({
          error: 'XML oficial indisponível: esta emissão não tem chave de acesso',
          detalhe: em.status === 'erro'
            ? 'A transmissão falhou; a nota não chegou a ser autorizada.'
            : 'A chave é atribuída pelo SEFIN na autorização.',
          emission_id: em.id,
        })
      }

      const r = await consultarPortal(sql, em)

      if (!r.ok || !r.nfseXml) {
        // ⚠️ Sem cair na DPS. Quem pediu o XML oficial e recebe a DPS leva
        // para o cliente um documento que NÃO é a nota dele — a mesma regra
        // de /api/nfse-download-xml, e a razão de a DPS ter pedido próprio.
        return res.status(r.status === 404 ? 404 : 502).json({
          error: r.ok ? 'O portal respondeu sem o XML da nota' : r.erro,
          detalhe: 'A NFS-e autorizada não está guardada aqui nem foi devolvida pelo portal.',
          chave_acesso: em.chave_acesso,
          emission_id: em.id,
          http_status: r.status,
        })
      }

      xml = r.nfseXml
      origem = 'portal'

      // Backfill: o que faltava agora está guardado, e o próximo download nem
      // sai daqui. Idêntico ao de /api/nfse-consultar — mesma leitura, mesma
      // escrita, para as duas rotas não deixarem a linha em estados
      // diferentes.
      await sql`
        UPDATE nfse_emissions
        SET xml_nfse = ${xml},
            nfse_number = COALESCE(nfse_number, ${r.numeroNfse}),
            status = CASE WHEN status = 'enviada' THEN 'autorizada' ELSE status END,
            approved_at = COALESCE(approved_at, NOW()),
            updated_at = NOW()
        WHERE id = ${em.id}`

      if (!em.tem_oficial) {
        await registrarEvento(sql, em.id, EVENTOS.AUTORIZADA, {
          origem: 'download do XML oficial', chave: em.chave_acesso, numero: r.numeroNfse,
        })
      }
    }

    // ⚠️ O nome leva o NÚMERO da nota e a chave inteira. Cortar a chave nos
    // primeiros dígitos (município + tipo de inscrição) daria o mesmo nome a
    // todas as notas do emitente.
    const nome = nomeArquivo(['NFSe', em.nfse_number || `emissao${em.id}`, em.chave_acesso])

    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${nome}.xml"`)
    res.setHeader('X-NFSe-Tipo', 'oficial')
    res.setHeader('X-NFSe-Origem', origem)
    res.setHeader('X-NFSe-Emission-Id', String(em.id))
    if (em.cancelled_at) res.setHeader('X-NFSe-Cancelada', '1')
    // Cabeçalho e não corpo: o corpo é o documento fiscal e não pode carregar
    // recado nosso.
    if (aviso) res.setHeader('X-NFSe-Aviso', encodeURIComponent(aviso))
    return res.status(200).send(xml)
  } catch (err) {
    if (err.code === 'CERT_NOT_FOUND') {
      return res.status(422).json({
        error: 'Certificado digital não configurado para esta empresa',
        detalhe: 'O SEFIN autentica por mTLS: sem o .pfx não há como consultar o portal.',
      })
    }
    console.error('[nfse-download-xml-oficial] falha:', err.message)
    return res.status(500).json({ error: 'Erro ao obter o XML oficial' })
  }
}
