import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL)

  if (req.method === 'GET') {
    const { company_id } = req.query
    const demands = await sql`
      SELECT * FROM demands
      WHERE company_id = ${company_id}
      ORDER BY created_at DESC
    `
    return res.status(200).json({ demands })
  }

  if (req.method === 'POST') {
    const { company_id, sender_name, sender_email, subject, body, status } = req.body
    const result = await sql`
      INSERT INTO demands (company_id, sender_name, sender_email, subject, body, status, origin, received_at)
      VALUES (${company_id}, ${sender_name}, ${sender_email}, ${subject}, ${body}, ${status}, 'manual', NOW())
      RETURNING *
    `
    return res.status(201).json({ demand: result[0] })
  }

  if (req.method === 'PATCH') {
    const { id, status } = req.body
    const result = await sql`
      UPDATE demands SET status = ${status}
      WHERE id = ${id}
      RETURNING *
    `
    return res.status(200).json({ demand: result[0] })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
