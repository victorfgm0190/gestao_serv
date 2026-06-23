import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL)
  const { type, company_id, year, month } = req.query

  const tables = {
    receivables: 'receivables',
    fabricio: 'payables_fabricio',
    victor: 'payables_victor',
  }

  const table = tables[type]
  if (!table) return res.status(400).json({ error: 'type inválido. Use: receivables, fabricio, victor' })

  if (req.method === 'GET') {
    let rows
    if (month) {
      rows = await sql.query(`
        SELECT p.*, c.name as client_name FROM ${table} p
        LEFT JOIN clients c ON c.id = p.client_id
        WHERE p.company_id = $1 AND p.year = $2 AND p.month = $3
        ORDER BY p.created_at DESC
      `, [company_id, year, month])
    } else {
      rows = await sql.query(`
        SELECT p.*, c.name as client_name FROM ${table} p
        LEFT JOIN clients c ON c.id = p.client_id
        WHERE p.company_id = $1 AND p.year = $2
        ORDER BY p.month DESC, p.created_at DESC
      `, [company_id, year])
    }
    return res.status(200).json({ data: rows })
  }

  if (req.method === 'POST') {
    const body = req.body
    try {
      let result
      if (type === 'victor') {
        const total = (parseFloat(body.service_amount) || 0) + (parseFloat(body.profit_amount) || 0)
        result = await sql.query(`
          INSERT INTO ${table} (company_id, client_id, month, year, description, service_amount, profit_amount, total_amount, notes)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
        `, [body.company_id, body.client_id, body.month, body.year, body.description, body.service_amount||0, body.profit_amount||0, total.toFixed(2), body.notes||null])
      } else {
        result = await sql.query(`
          INSERT INTO ${table} (company_id, client_id, month, year, description, amount, notes)
          VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
        `, [body.company_id, body.client_id, body.month, body.year, body.description, body.amount, body.notes||null])
      }
      return res.status(201).json({ data: result[0] })
    } catch (error) {
      return res.status(500).json({ error: error.message })
    }
  }

  if (req.method === 'PATCH') {
    const { id, paid_amount, paid_at, status, notes, payment_method, is_compensation, compensation_notes } = req.body
    try {
      let result
      if (type === 'fabricio') {
        result = await sql.query(`
          UPDATE ${table} SET paid_amount=$1, paid_at=$2, payment_method=$3, is_compensation=$4, compensation_notes=$5, status=$6, notes=$7
          WHERE id=$8 RETURNING *
        `, [paid_amount, paid_at||null, payment_method||null, is_compensation||false, compensation_notes||null, status, notes||null, id])
      } else {
        result = await sql.query(`
          UPDATE ${table} SET paid_amount=$1, paid_at=$2, status=$3, notes=$4
          WHERE id=$5 RETURNING *
        `, [paid_amount, paid_at||null, status, notes||null, id])
      }
      return res.status(200).json({ data: result[0] })
    } catch (error) {
      return res.status(500).json({ error: error.message })
    }
  }

  if (req.method === 'DELETE') {
    const { id } = req.body
    await sql.query(`DELETE FROM ${table} WHERE id=$1`, [id])
    return res.status(200).json({ success: true })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
