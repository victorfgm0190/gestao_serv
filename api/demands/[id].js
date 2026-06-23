import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL)
  const { id } = req.query

  if (req.method === 'PATCH') {
    const { status } = req.body
    const result = await sql`
      UPDATE demands SET status = ${status}
      WHERE id = ${id}
      RETURNING *
    `
    return res.status(200).json({ demand: result[0] })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
