import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'

// Download do XML assinado de uma emissão.
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
      SELECT id, nfse_number, nsu, invoice_id, xml_assinado
      FROM nfse_emissions WHERE id = ${emissionId}`

    if (!e) return res.status(404).json({ error: 'Emissão não encontrada' })
    if (!e.xml_assinado) {
      return res.status(404).json({
        error: 'XML não disponível para esta emissão',
        detalhe: 'A tentativa falhou antes de o XML ser montado.',
      })
    }

    // ⚠️ O nome do arquivo é higienizado. nsu e nfse_number vêm da resposta do
    // ADN, e um valor com aspas ou quebra de linha aí quebra o cabeçalho
    // Content-Disposition — o navegador salva com nome errado ou a resposta é
    // recusada. Sem número da nota, o id da emissão identifica o arquivo.
    const parte = (v) => String(v ?? '').replace(/[^\w.-]/g, '')
    const nome = ['NFSe', parte(e.nfse_number) || `emissao${e.id}`, parte(e.nsu)]
      .filter(Boolean).join('_')

    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${nome}.xml"`)
    return res.status(200).send(e.xml_assinado)
  } catch (err) {
    console.error('[nfse-download-xml] falha:', err.message)
    return res.status(500).json({ error: 'Erro ao baixar XML' })
  }
}
