import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import nfseCertManager from '../lib/nfse-cert-manager.js'
import { NFSeSigner } from '../lib/nfse-signer.js'
import { NFSeADNClient } from '../lib/nfse-adn-client.js'
import { NFSeCancellationBuilder, motivoPorCodigo } from '../lib/nfse-xml-cancellation-builder.js'
import { registrarEvento, EVENTOS } from '../lib/nfse-events.js'

// Cancelamento de NFS-e.
//
// POST /api/nfse-cancel { emission_id, motivo?, codigo_motivo?, observacoes?, transmitir? }
//
// ⚠️ PRÉVIA POR PADRÃO, como a emissão. Cancelar é irreversível do lado do
// fisco e o cliente do ADN não foi verificado contra o serviço real.

const CANCELAVEIS = new Set(['enviada', 'autorizada'])

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const {
    emission_id, motivo, codigo_motivo = '1', observacoes = '', transmitir = false,
  } = req.body || {}

  if (!emission_id) return res.status(400).json({ error: 'emission_id é obrigatório' })

  try {
    const sql = neon(process.env.DATABASE_URL)

    // ⚠️ O CNPJ do autor vem de nfse_emitter_settings, não de `companies.cnpj`
    // — coluna que não existe, e cuja leitura faria esta query falhar inteira.
    const [em] = await sql`
      SELECT ne.id, ne.company_id, ne.invoice_id, ne.nfse_number, ne.nsu,
             ne.status, ne.ambiente, ne.cancelled_at, ne.json_response,
             es.cnpj AS emitente_cnpj
      FROM nfse_emissions ne
      LEFT JOIN nfse_emitter_settings es ON es.company_id = ne.company_id
      WHERE ne.id = ${parseInt(emission_id, 10)}`

    if (!em) return res.status(404).json({ error: 'Emissão não encontrada' })

    if (em.cancelled_at || em.status === 'cancelada') {
      return res.status(409).json({
        error: 'Esta NFS-e já foi cancelada',
        cancelada_em: em.cancelled_at,
      })
    }

    // ⚠️ Vocabulário REAL. O esboço exigia `status === 'approved'`, que nunca é
    // gravado — api/nfse-emit.js grava 'enviada'/'erro'. O cancelamento seria
    // recusado 100% das vezes com "Só NFSes aprovadas podem ser canceladas".
    if (!CANCELAVEIS.has(em.status)) {
      return res.status(409).json({
        error: `NFS-e com status "${em.status}" não pode ser cancelada`,
        detalhe: `Cancelável apenas em: ${[...CANCELAVEIS].join(', ')}.`,
      })
    }

    const resposta = (em.json_response && typeof em.json_response === 'object') ? em.json_response : {}
    const chaveAcesso = resposta.chaveAcesso || resposta.chave || null

    const motivoInfo = motivoPorCodigo(codigo_motivo)
    const motivoTexto = [motivo || motivoInfo?.texto || 'Erro na emissão', observacoes]
      .filter((s) => s && String(s).trim()).join(' — ')

    let xml
    try {
      xml = new NFSeCancellationBuilder({
        chaveAcesso,
        cnpjAutor: em.emitente_cnpj,
        ambiente: em.ambiente ?? 2,
        sequencia: 1,
      }).build(motivoTexto, codigo_motivo)
    } catch (err) {
      if (err.code === 'DADOS_INCOMPLETOS') {
        return res.status(422).json({
          error: err.message,
          faltando: err.faltando,
          // A chave só existe depois de o ADN autorizar. Dizer isso evita a
          // leitura de que o cancelamento está quebrado.
          detalhe: !chaveAcesso
            ? 'A chave de acesso é atribuída pelo ADN na autorização. Enquanto a nota não for autorizada, não há o que cancelar no fisco.'
            : undefined,
        })
      }
      throw err
    }

    const cert = await nfseCertManager.getCertificateFromDB(sql, em.company_id)
    const xmlAssinado = new NFSeSigner(cert.pfxBuffer, cert.password)
      .assinarXML(xml, { elemento: 'infPedReg', raiz: 'pedRegEvento' })

    if (transmitir !== true) {
      return res.status(200).json({
        success: true,
        preview: true,
        message: 'Pedido de cancelamento montado e assinado. Nada foi transmitido — envie transmitir: true para cancelar.',
        resumo: {
          emission_id: em.id, nfse_number: em.nfse_number,
          motivo: motivoTexto, codigo_motivo: String(codigo_motivo),
          ambiente: (em.ambiente ?? 2) === 1 ? 'producao' : 'homologacao',
        },
        xml_assinado: xmlAssinado,
      })
    }

    const adn = new NFSeADNClient({
      ambiente: (em.ambiente ?? 2) === 1 ? 'producao' : 'homologacao',
      pfxBuffer: cert.pfxBuffer,
      senhaPfx: cert.password,
    })
    // ⚠️ O XML ASSINADO é o que vai. O esboço montava e assinava o pedido e
    // depois chamava `cancelarNFSe(numero, motivo)` — o documento assinado era
    // descartado e o ADN recebia dois campos soltos.
    const r = await adn.cancelarNFSe(chaveAcesso, xmlAssinado)

    // ⚠️ O banco só muda se o ADN aceitou. O esboço atualizava para 'cancelled'
    // logo depois da chamada, sem olhar o resultado: recusado o cancelamento, o
    // sistema diria "cancelada" enquanto a nota segue valendo na prefeitura —
    // e a fatura ficaria livre para ser reemitida, gerando a segunda nota.
    if (!r.ok) {
      await registrarEvento(sql, em.id, EVENTOS.ERRO, {
        acao: 'cancelamento', motivo: motivoTexto, resposta: r.resposta, http: r.status,
      })
      return res.status(502).json({
        success: false,
        error: `O ADN recusou o cancelamento: ${r.erro || `HTTP ${r.status}`}`,
        resposta: r.resposta,
      })
    }

    await sql`
      UPDATE nfse_emissions
      SET status = 'cancelada', cancelled_at = NOW(),
          json_response = COALESCE(json_response, '{}'::jsonb) || ${JSON.stringify({ cancelamento: r.resposta ?? {} })}::jsonb
      WHERE id = ${em.id}`

    await registrarEvento(sql, em.id, EVENTOS.CANCELADA, {
      motivo: motivoTexto, codigo_motivo: String(codigo_motivo), resposta: r.resposta,
    })

    return res.status(200).json({
      success: true,
      preview: false,
      message: 'NFS-e cancelada',
      nfse_number: em.nfse_number,
      status: 'cancelada',
    })
  } catch (err) {
    if (err.code === 'CERT_NOT_FOUND') {
      return res.status(422).json({ error: 'Certificado digital não configurado para esta empresa' })
    }
    console.error('[nfse-cancel] falha:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
