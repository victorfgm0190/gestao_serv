import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'

// Download do XML de uma emissão.
//
// GET /api/nfse-download-xml?emission_id=57[&tipo=dps]
//
// ⚠️ O padrão é o XML **OFICIAL** — a NFS-e autorizada que o SEFIN devolveu e
// que está em `xml_nfse`. A DPS (`xml_assinado`) é o pedido que enviamos: ela
// não tem número de nota, não tem chave de acesso e nem sequer traz razão
// social e endereço do prestador, porque o SEFIN proíbe enviá-los (E0121 /
// E0128). Entregar a DPS como "o XML da nota" dá ao cliente um documento que
// não é a nota dele.
//
// ⚠️ E não há portal a consultar para isso: o XML oficial chega JUNTO com a
// autorização e já está guardado. Quando falta, /api/nfse-consultar o busca —
// uma vez, sob demanda, não em laço.
export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const emissionId = parseInt(req.query.emission_id, 10)
  if (!Number.isInteger(emissionId)) {
    return res.status(400).json({ error: 'emission_id é obrigatório' })
  }
  const querDps = String(req.query.tipo || '').toLowerCase() === 'dps'

  try {
    const sql = neon(process.env.DATABASE_URL)
    const [e] = await sql`
      SELECT id, nfse_number, nsu, chave_acesso, invoice_id, status,
             xml_assinado, xml_nfse
      FROM nfse_emissions WHERE id = ${emissionId}`

    if (!e) return res.status(404).json({ error: 'Emissão não encontrada' })

    // ⚠️ Sem fallback silencioso para a DPS. Quem pediu o XML oficial e recebe
    // a DPS leva para o cliente um documento que NÃO é a nota — sem número,
    // sem chave, sem prestador. Faltando o oficial, recusa-se e diz como
    // obtê-lo; a DPS tem pedido próprio (`tipo=dps`).
    const oficial = !querDps
    const xml = oficial ? e.xml_nfse : e.xml_assinado

    if (!xml) {
      return res.status(404).json({
        error: querDps
          ? 'DPS não disponível para esta emissão'
          : 'XML oficial ainda não disponível',
        detalhe: querDps
          ? 'A tentativa falhou antes de o XML ser montado.'
          : (e.chave_acesso
            ? 'Use "Buscar no portal" para recuperá-lo, ou baixe a DPS com tipo=dps.'
            : 'A nota não chegou a ser autorizada.'),
        tem_dps: Boolean(e.xml_assinado),
      })
    }

    // ⚠️ O nome do arquivo usa o NÚMERO da nota. O esboço propunha
    // `chave_acesso.substring(0, 8)`: os 8 primeiros dígitos da chave são o
    // código do município e o tipo de inscrição — iguais em TODAS as notas do
    // mesmo emitente, então todos os downloads sairiam com o mesmo nome.
    const parte = (v) => String(v ?? '').replace(/[^\w.-]/g, '')
    const nome = [
      oficial ? 'NFSe' : 'DPS',
      parte(e.nfse_number) || `emissao${e.id}`,
      oficial ? parte(e.chave_acesso) : null,
    ].filter(Boolean).join('_')

    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${nome}.xml"`)
    // Deixa a tela distinguir o que veio, mesmo quando cai no fallback.
    res.setHeader('X-NFSe-Tipo', oficial ? 'oficial' : 'dps')
    return res.status(200).send(xml)
  } catch (err) {
    console.error('[nfse-download-xml] falha:', err.message)
    return res.status(500).json({ error: 'Erro ao baixar XML' })
  }
}
