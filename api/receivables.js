import { neon } from '@neondatabase/serverless'
export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL)
  if (req.method === 'GET') {
    const { company_id, year, month } = req.query
    const rows = month
      ? await sql`SELECT r.*, c.name as client_name, ct.cnpj as contract_cnpj FROM receivables r LEFT JOIN clients c ON c.id = r.client_id LEFT JOIN invoices i ON i.receivable_id = r.id LEFT JOIN contracts ct ON ct.id = i.contract_id WHERE r.company_id = ${company_id} AND r.year = ${year} AND r.month = ${month} ORDER BY r.created_at DESC`
      : await sql`SELECT r.*, c.name as client_name, ct.cnpj as contract_cnpj FROM receivables r LEFT JOIN clients c ON c.id = r.client_id LEFT JOIN invoices i ON i.receivable_id = r.id LEFT JOIN contracts ct ON ct.id = i.contract_id WHERE r.company_id = ${company_id} AND r.year = ${year} ORDER BY r.month DESC, r.created_at DESC`
    return res.status(200).json({ data: rows })
  }
  if (req.method === 'POST') {
    const { company_id, client_id, month, year, description, amount, notes } = req.body
    const result = await sql`INSERT INTO receivables (company_id, client_id, month, year, description, amount, notes) VALUES (${company_id}, ${client_id}, ${month}, ${year}, ${description}, ${amount}, ${notes||null}) RETURNING *`
    return res.status(201).json({ data: result[0] })
  }
  if (req.method === 'PATCH') {
    const { id, paid_amount, paid_at, status, notes } = req.body

    // Estorno: reverte o recebimento e remove os payables gerados pela fatura vinculada
    if (status === 'estorno') {
      const recs = await sql`SELECT * FROM receivables WHERE id = ${id} LIMIT 1`
      if (!recs.length) return res.status(404).json({ error: 'Registro não encontrado' })

      // Linkagem real: invoices.receivable_id -> receivables.id
      const invs = await sql`SELECT * FROM invoices WHERE receivable_id = ${id} LIMIT 1`
      if (invs.length) {
        const inv = invs[0]
        const fabPago = await sql`SELECT id FROM payables_fabricio WHERE invoice_id = ${inv.id} AND status = 'pago' LIMIT 1`
        const vicPago = await sql`SELECT id FROM payables_victor WHERE invoice_id = ${inv.id} AND status = 'pago' LIMIT 1`
        if (fabPago.length || vicPago.length) {
          return res.status(400).json({ error: 'Não é possível estornar. Os lançamentos de Pagar Fabrício e/ou Pagar Victor já foram pagos. Desfaça os pagamentos primeiro.' })
        }
        await sql`DELETE FROM payables_fabricio WHERE invoice_id = ${inv.id}`
        await sql`DELETE FROM payables_victor WHERE invoice_id = ${inv.id}`
        await sql`UPDATE invoices SET status = 'pendente' WHERE id = ${inv.id}`
      }

      const result = await sql`UPDATE receivables SET status='pendente', paid_at=NULL, paid_amount=NULL WHERE id=${id} RETURNING *`
      return res.status(200).json({ data: result[0], action: 'estorno' })
    }

    const result = await sql`UPDATE receivables SET paid_amount=${paid_amount}, paid_at=${paid_at||null}, status=${status}, notes=${notes||null} WHERE id=${id} RETURNING *`

    // Ao marcar como pago, propaga para a fatura vinculada gerando Pagar Fabrício/Victor (sem duplicar)
    if (status === 'pago') {
      const invs = await sql`SELECT * FROM invoices WHERE receivable_id = ${id} LIMIT 1`
      if (invs.length) {
        const inv = invs[0]
        const jaExiste = await sql`SELECT id FROM payables_fabricio WHERE invoice_id = ${inv.id} LIMIT 1`
        if (!jaExiste.length) {
          // invoices não possui coluna paid_at; o paid_at é registrado no receivable
          await sql`UPDATE invoices SET status = 'recebido' WHERE id = ${inv.id}`
          const clients = await sql`SELECT name FROM clients WHERE id = ${inv.client_id} LIMIT 1`
          const client_name = clients[0]?.name || 'Cliente'
          const desc = `${client_name} - ${inv.month}/${inv.year}`
          await sql`INSERT INTO payables_fabricio (company_id, client_id, month, year, description, amount, origin, invoice_id) VALUES (${inv.company_id}, ${inv.client_id}, ${inv.month}, ${inv.year}, ${desc}, ${inv.fabricio_total}, 'faturamento', ${inv.id})`
          await sql`INSERT INTO payables_victor (company_id, client_id, month, year, description, service_amount, profit_amount, total_amount, origin, invoice_id) VALUES (${inv.company_id}, ${inv.client_id}, ${inv.month}, ${inv.year}, ${desc}, ${inv.victor_service}, ${parseFloat(inv.victor_profit)+parseFloat(inv.victor_tax_diff)}, ${inv.victor_total}, 'faturamento', ${inv.id})`
        }
      }
    }

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
