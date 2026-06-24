import { neon } from '@neondatabase/serverless'
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const sql = neon(process.env.DATABASE_URL)
  try {
    await sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS deslocamento_tipo VARCHAR(20) DEFAULT 'nao_cobrado'`
    await sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS deslocamento_valor_hora NUMERIC(10,2) DEFAULT 0`
    await sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS despesas_deslocamento NUMERIC(10,2) DEFAULT 0`
    res.status(200).json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}
