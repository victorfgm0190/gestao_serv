import { neon } from '@neondatabase/serverless'
export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL)
  if (req.method === 'GET') {
    const { company_id, year, month, mode } = req.query
    const caixa = mode === 'caixa'  // caixa filtra por payment_month/payment_year
    let rows
    if (caixa) {
      rows = month
        ? await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount FROM payables_fabricio p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id WHERE p.company_id = ${company_id} AND p.payment_year = ${year} AND p.payment_month = ${month} ORDER BY p.payment_month DESC, p.created_at DESC`
        : await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount FROM payables_fabricio p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id WHERE p.company_id = ${company_id} AND p.payment_year = ${year} ORDER BY p.payment_month DESC, p.created_at DESC`
    } else {
      rows = month
        ? await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount FROM payables_fabricio p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id WHERE p.company_id = ${company_id} AND p.year = ${year} AND p.month = ${month} ORDER BY p.month DESC, p.created_at DESC`
        : await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount FROM payables_fabricio p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id WHERE p.company_id = ${company_id} AND p.year = ${year} ORDER BY p.month DESC, p.created_at DESC`
    }
    const ids = rows.map(r => r.id)
    let payments = []
    if (ids.length) {
      payments = await sql`SELECT * FROM payable_payments WHERE payable_type = 'fabricio' AND payable_id = ANY(${ids}) ORDER BY paid_at DESC, id DESC`
    }
    const byId = {}
    for (const p of payments) { (byId[p.payable_id] ||= []).push(p) }
    for (const r of rows) { r.payments = byId[r.id] || [] }
    return res.status(200).json({ data: rows })
  }
  if (req.method === 'POST') {
    const { company_id, client_id, month, year, description, amount, notes } = req.body
    const result = await sql`INSERT INTO payables_fabricio (company_id, client_id, month, year, description, amount, notes, payment_month, payment_year) VALUES (${company_id}, ${client_id}, ${month}, ${year}, ${description}, ${amount}, ${notes||null}, ${month}, ${year}) RETURNING *`
    return res.status(201).json({ data: result[0] })
  }
  if (req.method === 'PATCH') {
    // Estorno: remove todos os pagamentos e volta o lançamento para pendente. Sempre permitido.
    if (req.query.action === 'estornar') {
      const id = req.query.id || req.body?.id
      if (!id) return res.status(400).json({ error: 'id obrigatório' })
      await sql`DELETE FROM payable_payments WHERE payable_type = 'fabricio' AND payable_id = ${id}`
      const result = await sql`UPDATE payables_fabricio SET status='pendente', paid_amount=0, paid_at=NULL WHERE id=${id} RETURNING *`
      if (!result.length) return res.status(404).json({ error: 'Registro não encontrado' })
      return res.status(200).json({ data: result[0], action: 'estornar' })
    }
    const { id, paid_amount, paid_at, payment_method, is_compensation, compensation_notes, status, notes } = req.body
    const result = await sql`UPDATE payables_fabricio SET paid_amount=${paid_amount}, paid_at=${paid_at||null}, payment_method=${payment_method||null}, is_compensation=${is_compensation||false}, compensation_notes=${compensation_notes||null}, status=${status}, notes=${notes||null} WHERE id=${id} RETURNING *`
    return res.status(200).json({ data: result[0] })
  }
  if (req.method === 'DELETE') {
    const { id } = req.body
    const rows = await sql`SELECT origin FROM payables_fabricio WHERE id = ${id}`
    if (rows.length && rows[0].origin === 'faturamento') {
      return res.status(403).json({ error: 'Este registro foi gerado pelo Faturamento. Para removê-lo, estorne o recebimento da fatura correspondente.' })
    }
    await sql`DELETE FROM payables_fabricio WHERE id = ${id}`
    return res.status(200).json({ success: true })
  }
  res.status(405).json({ error: 'Method not allowed' })
}
