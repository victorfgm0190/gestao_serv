import { neon } from '@neondatabase/serverless'
import { ingestAccounts, imperiumAccounts } from '../lib/email-ingest.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { company_id } = req.body || {}
  if (!company_id) {
    return res.status(400).json({ error: 'company_id é obrigatório' })
  }
  if (String(company_id) !== '2') {
    return res.status(400).json({ error: 'Configuração IMAP não disponível para esta empresa' })
  }

  try {
    const sql = neon(process.env.DATABASE_URL)
    const rules = await sql`SELECT * FROM email_rules WHERE company_id = ${company_id}`

    const { imported, errors } = await ingestAccounts(imperiumAccounts(), company_id, sql, rules)

    if (errors.length) {
      console.error(`[ingest-email] ${errors.length} erro(s); ${imported.length} importada(s)`, errors)
      // 207: importou parte, mas houve falhas — a tela precisa saber.
      return res.status(imported.length ? 207 : 500).json({
        success: false, total_imported: imported.length, imported: imported.length, errors,
      })
    }

    return res.status(200).json({
      success: true, total_imported: imported.length, imported: imported.length, errors: [],
    })
  } catch (error) {
    console.error('[ingest-email] falha geral:', error)
    return res.status(500).json({ success: false, error: error.message })
  }
}
