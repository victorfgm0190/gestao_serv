import { neon } from '@neondatabase/serverless'
import { ingestAccounts, imperiumAccounts } from '../lib/email-ingest.js'

export default async function handler(req, res) {
  const authHeader = req.headers['authorization']
  const validBearer = Boolean(process.env.CRON_SECRET) && authHeader === `Bearer ${process.env.CRON_SECRET}`
  const isVercelCron = req.headers['x-vercel-cron'] === '1'

  // Segredo por query string removido: ficava registrado em log de acesso da
  // Vercel, histórico de proxy e header Referer.
  if (!validBearer && !isVercelCron) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // O handler inteiro estava fora de try/catch: uma indisponibilidade do Neon
  // virava rejeição não tratada e 500 opaco, sem log.
  try {
    const sql = neon(process.env.DATABASE_URL)
    const rules = await sql`SELECT * FROM email_rules WHERE company_id = 2`

    const { imported, errors } = await ingestAccounts(imperiumAccounts(), 2, sql, rules)

    // Antes retornava sempre 200 {success:true}, mesmo com as duas contas
    // falhando — a Vercel marcava a execução como bem-sucedida e a ingestão
    // podia estar quebrada por semanas sem sinal. Agora falha aparece como falha.
    if (errors.length) {
      console.error(`[cron-sync] ${errors.length} erro(s); ${imported.length} importada(s)`, errors)
      return res.status(500).json({ success: false, imported: imported.length, errors })
    }

    console.log(`[cron-sync] ok: ${imported.length} demanda(s) importada(s)`)
    return res.status(200).json({ success: true, imported: imported.length, errors: [] })
  } catch (error) {
    console.error('[cron-sync] falha geral:', error)
    return res.status(500).json({ success: false, error: error.message })
  }
}
