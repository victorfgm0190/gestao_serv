import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  const sql = neon(process.env.DATABASE_URL)

  if (req.method === 'GET') {
    const { company_id, month, year } = req.query
    const rows = await sql`
      SELECT * FROM victor_reserves
      WHERE company_id = ${company_id} AND month = ${month} AND year = ${year}
      LIMIT 1`
    const data = rows[0] || {
      company_id: Number(company_id), month: Number(month), year: Number(year),
      das: 0, pro_labore: 0, inss: 0, escritorio: 0, notes: null,
    }
    return res.status(200).json({ data })
  }

  if (req.method === 'POST') {
    const { company_id, month, year, das, pro_labore, inss, escritorio, notes } = req.body
    if (!company_id || !month || !year) return res.status(400).json({ error: 'company_id, month e year são obrigatórios' })
    const rows = await sql`
      INSERT INTO victor_reserves (company_id, month, year, das, pro_labore, inss, escritorio, notes, updated_at)
      VALUES (${company_id}, ${month}, ${year}, ${das || 0}, ${pro_labore || 0}, ${inss || 0}, ${escritorio || 0}, ${notes || null}, NOW())
      ON CONFLICT (company_id, month, year) DO UPDATE SET
        das = EXCLUDED.das,
        pro_labore = EXCLUDED.pro_labore,
        inss = EXCLUDED.inss,
        escritorio = EXCLUDED.escritorio,
        notes = EXCLUDED.notes,
        updated_at = NOW()
      RETURNING *`
    return res.status(200).json({ data: rows[0] })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
