import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const sql = neon(process.env.DATABASE_URL)

  try {
    await sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS hora_inicial VARCHAR(5)`
    await sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS intervalo_inicio VARCHAR(5)`
    await sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS intervalo_fim VARCHAR(5)`
    await sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS hora_final VARCHAR(5)`
    await sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS horas_deslocamento NUMERIC(5,2) DEFAULT 0`
    await sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS valor_deslocamento NUMERIC(10,2) DEFAULT 0`

    res.status(200).json({ success: true, message: 'Colunas adicionadas com sucesso' })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}
