import { neon } from '@neondatabase/serverless'

// Tabela pai e coluna de total por tipo
const TABLES = {
  victor: { table: 'payables_victor', totalCol: 'total_amount' },
  fabricio: { table: 'payables_fabricio', totalCol: 'amount' },
}

async function recalcParent(sql, payable_type, payable_id) {
  const cfg = TABLES[payable_type]
  if (!cfg) throw new Error('payable_type inválido')

  // soma dos pagamentos e data mais recente
  const agg = await sql`
    SELECT COALESCE(SUM(amount), 0) AS total, MAX(paid_at) AS last_paid
    FROM payable_payments
    WHERE payable_type = ${payable_type} AND payable_id = ${payable_id}`
  const sum = parseFloat(agg[0].total) || 0
  const lastPaid = agg[0].last_paid || null

  // total do registro pai
  const totalCol = cfg.totalCol
  const parentRows = payable_type === 'victor'
    ? await sql`SELECT total_amount AS total FROM payables_victor WHERE id = ${payable_id}`
    : await sql`SELECT amount AS total FROM payables_fabricio WHERE id = ${payable_id}`
  const total = parseFloat(parentRows[0]?.total) || 0

  let status, paidAt
  if (sum <= 0) {
    status = 'pendente'
    paidAt = null
  } else if (sum >= total) {
    status = 'pago'
    paidAt = lastPaid
  } else {
    status = 'parcial'
    paidAt = lastPaid
  }
  const paidAmount = sum.toFixed(2)

  if (payable_type === 'victor') {
    await sql`UPDATE payables_victor SET paid_amount=${paidAmount}, paid_at=${paidAt}, status=${status} WHERE id=${payable_id}`
  } else {
    await sql`UPDATE payables_fabricio SET paid_amount=${paidAmount}, paid_at=${paidAt}, status=${status} WHERE id=${payable_id}`
  }
  return { sum, status, paidAt }
}

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL)

  if (req.method === 'GET') {
    const { payable_type, payable_id } = req.query
    const rows = await sql`
      SELECT * FROM payable_payments
      WHERE payable_type = ${payable_type} AND payable_id = ${payable_id}
      ORDER BY paid_at DESC, id DESC`
    return res.status(200).json({ data: rows })
  }

  if (req.method === 'POST') {
    const { payable_type, payable_id, amount, paid_at, notes } = req.body
    if (!TABLES[payable_type]) return res.status(400).json({ error: 'payable_type inválido' })
    const result = await sql`
      INSERT INTO payable_payments (payable_type, payable_id, amount, paid_at, notes)
      VALUES (${payable_type}, ${payable_id}, ${amount}, ${paid_at}, ${notes || null})
      RETURNING *`
    await recalcParent(sql, payable_type, payable_id)
    return res.status(201).json({ data: result[0] })
  }

  if (req.method === 'DELETE') {
    const { id, payable_type, payable_id } = req.body
    if (!TABLES[payable_type]) return res.status(400).json({ error: 'payable_type inválido' })
    await sql`DELETE FROM payable_payments WHERE id = ${id}`
    await recalcParent(sql, payable_type, payable_id)
    return res.status(200).json({ success: true })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
