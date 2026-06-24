import { neon } from '@neondatabase/serverless'
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const sql = neon(process.env.DATABASE_URL)
  try {
    await sql`ALTER TABLE financial_rules ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id)`
    await sql`ALTER TABLE financial_rules DROP CONSTRAINT IF EXISTS financial_rules_project_id_fkey`
    res.status(200).json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}
