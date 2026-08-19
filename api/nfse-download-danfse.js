import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import { DANFSEGenerator } from '../lib/danfse-generator.js'
import { lerDPS } from '../lib/nfse-xml-parser.js'

// Gera o DANFSE (PDF) de uma emissão.
//
// ⚠️ Os dados saem do XML ASSINADO, não de um novo JOIN nas tabelas. A nota é
// um documento congelado: mudar o endereço do emitente ou corrigir o cadastro
// do cliente não pode reescrever o comprovante de uma nota já emitida. O esboço
// reconsultava tudo — e ainda por colunas que não existem (`i.valor_total`,
// `c.cnpj`, `comp.cnpj`), com prestador fixo em 'Rua Test' / IM '123456' e
// alíquota fixa em 6%.
export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const emissionId = parseInt(req.query.emission_id, 10)
  if (!Number.isInteger(emissionId)) {
    return res.status(400).json({ error: 'emission_id é obrigatório' })
  }

  try {
    const sql = neon(process.env.DATABASE_URL)
    const [e] = await sql`
      SELECT ne.id, ne.nfse_number, ne.nsu, ne.protocol, ne.status, ne.ambiente,
             ne.valor_servico, ne.competencia, ne.municipio_codigo,
             ne.submitted_at, ne.cancelled_at, ne.xml_assinado, ne.xml_nfse,
             ne.chave_acesso, ne.json_response
      FROM nfse_emissions ne
      WHERE ne.id = ${emissionId}`

    if (!e) return res.status(404).json({ error: 'Emissão não encontrada' })
    // ⚠️ A nota AUTORIZADA tem prioridade sobre a DPS: ela traz o número, a
    // chave e o prestador preenchidos pelo cadastro nacional — dados que a DPS
    // não pode carregar. A DPS é o pedido; o DANFSE representa a nota.
    const fonte = e.xml_nfse || e.xml_assinado
    if (!fonte) {
      return res.status(404).json({
        error: 'DANFSE indisponível: esta emissão não tem XML',
        detalhe: 'A tentativa falhou antes de o documento ser montado.',
      })
    }

    const dps = lerDPS(fonte)
    if (!dps) {
      return res.status(422).json({ error: 'O XML gravado não é uma DPS legível' })
    }

    // ⚠️ json_response é JSONB: o driver já devolve OBJETO. O
    // `JSON.parse(e.json_response || '{}')` do esboço recebe um objeto, o
    // converte em "[object Object]" e estoura com SyntaxError — o endpoint
    // inteiro respondia 500 na primeira chamada.
    const resposta = (e.json_response && typeof e.json_response === 'object') ? e.json_response : {}

    // Chave de acesso e número da nota são atribuídos pelo ADN, então vêm da
    // resposta dele — não estão na DPS, que é o que foi ENVIADO.
    const pdf = await new DANFSEGenerator({
      ...dps,
      numeroNfse: e.nfse_number ?? dps.numeroNfse ?? resposta.numeroNFSe ?? null,
      nsu: e.nsu ?? resposta.nsu ?? null,
      protocolo: e.protocol ?? resposta.protocolo ?? null,
      chaveAcesso: e.chave_acesso ?? resposta.chaveAcesso ?? resposta.chave ?? null,
      // O ambiente gravado na linha manda: é o que valia na hora do envio.
      ambiente: e.ambiente ?? dps.ambiente,
      cancelada: Boolean(e.cancelled_at),
    }).gerarPDF()

    const parte = (v) => String(v ?? '').replace(/[^\w.-]/g, '')
    const nome = ['DANFSE', parte(e.nfse_number) || `emissao${e.id}`, parte(e.nsu)]
      .filter(Boolean).join('_')

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Length', pdf.length)
    res.setHeader('Content-Disposition', `attachment; filename="${nome}.pdf"`)
    return res.status(200).send(pdf)
  } catch (err) {
    console.error('[nfse-download-danfse] falha:', err.message)
    return res.status(500).json({ error: 'Erro ao gerar o DANFSE' })
  }
}
