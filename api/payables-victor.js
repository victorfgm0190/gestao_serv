import { neon } from '@neondatabase/serverless'
export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL)
  if (req.method === 'GET') {
    const { company_id, year, status } = req.query
    const rows = status
      ? await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id WHERE p.company_id = ${company_id} AND p.status = ${status} ORDER BY p.year DESC, p.month DESC, p.created_at DESC`
      : await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id WHERE p.company_id = ${company_id} AND p.year = ${year} ORDER BY p.month DESC, p.created_at DESC`
    const ids = rows.map(r => r.id)
    let payments = []
    if (ids.length) {
      payments = await sql`SELECT * FROM payable_payments WHERE payable_type = 'victor' AND payable_id = ANY(${ids}) ORDER BY paid_at DESC, id DESC`
    }
    const byId = {}
    for (const p of payments) { (byId[p.payable_id] ||= []).push(p) }
    for (const r of rows) { r.payments = byId[r.id] || [] }
    return res.status(200).json({ data: rows })
  }
  if (req.method === 'POST') {
    const { company_id, client_id, month, year, description, service_amount, profit_amount, notes } = req.body
    const total = (parseFloat(service_amount)||0) + (parseFloat(profit_amount)||0)
    const result = await sql`INSERT INTO payables_victor (company_id, client_id, month, year, description, service_amount, profit_amount, total_amount, notes) VALUES (${company_id}, ${client_id}, ${month}, ${year}, ${description}, ${service_amount||0}, ${profit_amount||0}, ${total.toFixed(2)}, ${notes||null}) RETURNING *`
    return res.status(201).json({ data: result[0] })
  }
  if (req.method === 'PATCH') {
    // Estorno: remove todos os pagamentos e volta o lançamento para pendente. Sempre permitido.
    if (req.query.action === 'estornar') {
      const id = req.query.id || req.body?.id
      if (!id) return res.status(400).json({ error: 'id obrigatório' })
      await sql`DELETE FROM payable_payments WHERE payable_type = 'victor' AND payable_id = ${id}`
      const result = await sql`UPDATE payables_victor SET status='pendente', paid_amount=0, paid_at=NULL WHERE id=${id} RETURNING *`
      if (!result.length) return res.status(404).json({ error: 'Registro não encontrado' })
      return res.status(200).json({ data: result[0], action: 'estornar' })
    }
    const { id, paid_amount, paid_at, status, notes } = req.body
    const result = await sql`UPDATE payables_victor SET paid_amount=${paid_amount}, paid_at=${paid_at||null}, status=${status}, notes=${notes||null} WHERE id=${id} RETURNING *`
    return res.status(200).json({ data: result[0] })
  }
  if (req.method === 'DELETE') {
    const { id } = req.body
    const rows = await sql`SELECT origin FROM payables_victor WHERE id = ${id}`
    if (rows.length && rows[0].origin === 'faturamento') {
      return res.status(403).json({ error: 'Este registro foi gerado pelo Faturamento. Para removê-lo, estorne o recebimento da fatura correspondente.' })
    }
    await sql`DELETE FROM payables_victor WHERE id = ${id}`
    return res.status(200).json({ success: true })
  }
  res.status(405).json({ error: 'Method not allowed' })
}
