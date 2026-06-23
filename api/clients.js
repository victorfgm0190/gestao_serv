import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL)

  if (req.method === 'GET') {
    const { company_id } = req.query
    const clients = await sql`
      SELECT * FROM clients
      WHERE company_id = ${company_id}
      ORDER BY name ASC
    `
    return res.status(200).json({ clients })
  }

  if (req.method === 'POST') {
    const { company_id, name, email_domain } = req.body
    const result = await sql`
      INSERT INTO clients (company_id, name, email_domain)
      VALUES (${company_id}, ${name}, ${email_domain})
      RETURNING *
    `
    return res.status(201).json({ client: result[0] })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body
    await sql`DELETE FROM clients WHERE id = ${id}`
    return res.status(200).json({ success: true })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
