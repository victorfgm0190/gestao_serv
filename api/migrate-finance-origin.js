import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const sql = neon(process.env.DATABASE_URL)
  try {
    await sql`ALTER TABLE receivables ADD COLUMN IF NOT EXISTS origin VARCHAR(20) DEFAULT 'manual'`
    await sql`ALTER TABLE payables_fabricio ADD COLUMN IF NOT EXISTS origin VARCHAR(20) DEFAULT 'manual'`
    await sql`ALTER TABLE payables_victor ADD COLUMN IF NOT EXISTS origin VARCHAR(20) DEFAULT 'manual'`
    await sql`ALTER TABLE receivables ADD COLUMN IF NOT EXISTS invoice_id INTEGER`
    await sql`ALTER TABLE payables_fabricio ADD COLUMN IF NOT EXISTS invoice_id INTEGER`
    await sql`ALTER TABLE payables_victor ADD COLUMN IF NOT EXISTS invoice_id INTEGER`
    res.status(200).json({ success: true, message: 'Colunas de origem adicionadas' })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}
