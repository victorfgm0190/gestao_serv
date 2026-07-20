import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  const sql = neon(process.env.DATABASE_URL)

  if (req.method === 'GET') {
    const { company_id } = req.query
    const rules = await sql`
      SELECT er.*, c.name as client_name
      FROM email_rules er
      LEFT JOIN clients c ON c.id = er.target_client_id
      WHERE er.company_id = ${company_id}
      ORDER BY er.created_at DESC
    `
    return res.status(200).json({ rules })
  }

  if (req.method === 'POST') {
    const { company_id, rule_type, rule_value, target_client_id } = req.body
    const result = await sql`
      INSERT INTO email_rules (company_id, rule_type, rule_value, target_client_id)
      VALUES (${company_id}, ${rule_type}, ${rule_value}, ${target_client_id})
      RETURNING *
    `
    return res.status(201).json({ rule: result[0] })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body
    await sql`DELETE FROM email_rules WHERE id = ${id}`
    return res.status(200).json({ success: true })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
