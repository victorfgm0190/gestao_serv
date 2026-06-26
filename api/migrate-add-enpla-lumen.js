import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const sql = neon(process.env.DATABASE_URL)
  try {
    const rows = await sql`
      INSERT INTO clients (company_id, name)
      SELECT 1, 'Enpla (Atria)'
      WHERE NOT EXISTS (
        SELECT 1 FROM clients WHERE company_id = 1 AND name = 'Enpla (Atria)'
      )
      RETURNING id`
    res.status(200).json({
      success: true,
      inserted: rows.length,
      message: rows.length ? 'Enpla (Atria) adicionada à Lumen' : 'Enpla (Atria) já existia na Lumen — nada inserido',
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}
