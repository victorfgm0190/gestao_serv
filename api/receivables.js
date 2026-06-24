import { neon } from '@neondatabase/serverless'
export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL)
  if (req.method === 'GET') {
    const { company_id, year, month } = req.query
    const rows = month
      ? await sql`SELECT r.*, c.name as client_name FROM receivables r LEFT JOIN clients c ON c.id = r.client_id WHERE r.company_id = ${company_id} AND r.year = ${year} AND r.month = ${month} ORDER BY r.created_at DESC`
      : await sql`SELECT r.*, c.name as client_name FROM receivables r LEFT JOIN clients c ON c.id = r.client_id WHERE r.company_id = ${company_id} AND r.year = ${year} ORDER BY r.month DESC, r.created_at DESC`
    return res.status(200).json({ data: rows })
  }
  if (req.method === 'POST') {
    const { company_id, client_id, month, year, description, amount, notes } = req.body
    const result = await sql`INSERT INTO receivables (company_id, client_id, month, year, description, amount, notes) VALUES (${company_id}, ${client_id}, ${month}, ${year}, ${description}, ${amount}, ${notes||null}) RETURNING *`
    return res.status(201).json({ data: result[0] })
  }
  if (req.method === 'PATCH') {
    const { id, paid_amount, paid_at, status, notes } = req.body
    const result = await sql`UPDATE receivables SET paid_amount=${paid_amount}, paid_at=${paid_at||null}, status=${status}, notes=${notes||null} WHERE id=${id} RETURNING *`
    return res.status(200).json({ data: result[0] })
  }
  if (req.method === 'DELETE') {
    const { id } = req.body
    const rows = await sql`SELECT origin FROM receivables WHERE id = ${id}`
    if (rows.length && rows[0].origin === 'faturamento') {
      return res.status(403).json({ error: 'Este registro foi gerado pelo Faturamento. Para removê-lo, estorne a fatura correspondente.' })
    }
    await sql`DELETE FROM receivables WHERE id = ${id}`
    return res.status(200).json({ success: true })
  }
  res.status(405).json({ error: 'Method not allowed' })
}
