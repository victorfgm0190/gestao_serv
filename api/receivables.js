import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'

// Deriva mês/ano de caixa da data de recebimento; sem data, cai na competência.
function paymentPeriod(payment_date, fbMonth, fbYear) {
  if (payment_date) {
    const [y, m] = String(payment_date).slice(0, 10).split('-').map(Number)
    if (y && m) return { pmonth: m, pyear: y }
  }
  return { pmonth: fbMonth, pyear: fbYear }
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  const sql = neon(process.env.DATABASE_URL)
  if (req.method === 'GET') {
    const { company_id, year, month, mode } = req.query
    // mode=caixa filtra por payment_month/payment_year (mês do recebimento);
    // competência (padrão) filtra por month/year (mês do faturamento).
    const caixa = mode === 'caixa'
    let rows
    if (caixa) {
      rows = month
        ? await sql`SELECT r.*, c.name as client_name, ct.cnpj as contract_cnpj FROM receivables r LEFT JOIN clients c ON c.id = r.client_id LEFT JOIN invoices i ON i.receivable_id = r.id LEFT JOIN contracts ct ON ct.id = i.contract_id WHERE r.company_id = ${company_id} AND r.payment_year = ${year} AND r.payment_month = ${month} ORDER BY r.created_at DESC`
        : await sql`SELECT r.*, c.name as client_name, ct.cnpj as contract_cnpj FROM receivables r LEFT JOIN clients c ON c.id = r.client_id LEFT JOIN invoices i ON i.receivable_id = r.id LEFT JOIN contracts ct ON ct.id = i.contract_id WHERE r.company_id = ${company_id} AND r.payment_year = ${year} ORDER BY r.payment_month DESC, r.created_at DESC`
    } else {
      rows = month
        ? await sql`SELECT r.*, c.name as client_name, ct.cnpj as contract_cnpj FROM receivables r LEFT JOIN clients c ON c.id = r.client_id LEFT JOIN invoices i ON i.receivable_id = r.id LEFT JOIN contracts ct ON ct.id = i.contract_id WHERE r.company_id = ${company_id} AND r.year = ${year} AND r.month = ${month} ORDER BY r.created_at DESC`
        : await sql`SELECT r.*, c.name as client_name, ct.cnpj as contract_cnpj FROM receivables r LEFT JOIN clients c ON c.id = r.client_id LEFT JOIN invoices i ON i.receivable_id = r.id LEFT JOIN contracts ct ON ct.id = i.contract_id WHERE r.company_id = ${company_id} AND r.year = ${year} ORDER BY r.month DESC, r.created_at DESC`
    }
    return res.status(200).json({ data: rows })
  }
  if (req.method === 'POST') {
    const { company_id, client_id, month, year, description, amount, notes } = req.body
    const result = await sql`INSERT INTO receivables (company_id, client_id, month, year, description, amount, notes, payment_month, payment_year) VALUES (${company_id}, ${client_id}, ${month}, ${year}, ${description}, ${amount}, ${notes||null}, ${month}, ${year}) RETURNING *`
    return res.status(201).json({ data: result[0] })
  }
  if (req.method === 'PATCH') {
    // Estorno: reverte o recebimento e remove os payables gerados pela fatura vinculada.
    // Aceita tanto ?action=estornar&id=X (query) quanto { status: 'estorno' } (body legado).
    if (req.query.action === 'estornar' || req.body?.status === 'estorno') {
      const id = req.query.id || req.body?.id
      const recs = await sql`SELECT * FROM receivables WHERE id = ${id} LIMIT 1`
      if (!recs.length) return res.status(404).json({ error: 'Registro não encontrado' })

      // Linkagem real: invoices.receivable_id -> receivables.id
      const invs = await sql`SELECT * FROM invoices WHERE receivable_id = ${id} LIMIT 1`
      if (invs.length) {
        const inv = invs[0]
        const fabPago = await sql`SELECT id FROM payables_fabricio WHERE invoice_id = ${inv.id} AND status = 'pago' LIMIT 1`
        const vicPago = await sql`SELECT id FROM payables_victor WHERE invoice_id = ${inv.id} AND status = 'pago' LIMIT 1`
        if (fabPago.length || vicPago.length) {
          return res.status(400).json({ error: 'Estorne primeiro os pagamentos de Victor e Fabrício antes de estornar este recebimento.' })
        }
        // Remove pagamentos parciais órfãos antes de apagar os payables
        const fabIds = await sql`SELECT id FROM payables_fabricio WHERE invoice_id = ${inv.id}`
        const vicIds = await sql`SELECT id FROM payables_victor WHERE invoice_id = ${inv.id}`
        if (fabIds.length) await sql`DELETE FROM payable_payments WHERE payable_type='fabricio' AND payable_id = ANY(${fabIds.map(r=>r.id)})`
        if (vicIds.length) await sql`DELETE FROM payable_payments WHERE payable_type='victor' AND payable_id = ANY(${vicIds.map(r=>r.id)})`
        await sql`DELETE FROM payables_fabricio WHERE invoice_id = ${inv.id}`
        await sql`DELETE FROM payables_victor WHERE invoice_id = ${inv.id}`
        await sql`UPDATE invoices SET status = 'pendente' WHERE id = ${inv.id}`
      }

      const result = await sql`UPDATE receivables SET status='pendente', paid_at=NULL, paid_amount=NULL WHERE id=${id} RETURNING *`
      return res.status(200).json({ data: result[0], action: 'estorno' })
    }

    const { id, paid_amount, paid_at, status, notes } = req.body

    // As leituras ficam fora da transação (o driver HTTP do Neon só aceita um
    // array de escritas), mas TODAS as escritas vão juntas. Antes eram 4
    // statements soltos: se o INSERT do Fabrício passasse e o do Victor
    // falhasse, o guard de idempotência (que olha só payables_fabricio)
    // fazia qualquer retry pular tudo — e o lançamento do Victor nunca mais
    // era criado, sem erro visível.
    const writes = [
      sql`UPDATE receivables SET paid_amount=${paid_amount}, paid_at=${paid_at||null}, status=${status}, notes=${notes||null} WHERE id=${id} RETURNING *`,
    ]

    if (status === 'pago') {
      const invs = await sql`SELECT * FROM invoices WHERE receivable_id = ${id} LIMIT 1`
      if (invs.length) {
        const inv = invs[0]
        const jaExiste = await sql`SELECT id FROM payables_fabricio WHERE invoice_id = ${inv.id} LIMIT 1`
        if (!jaExiste.length) {
          const clients = await sql`SELECT name FROM clients WHERE id = ${inv.client_id} LIMIT 1`
          const client_name = clients[0]?.name || 'Cliente'
          const desc = `${client_name} - ${inv.month}/${inv.year}`
          // Mês de caixa = data real do recebimento (paid_at); depois payment_date da fatura; por fim competência.
          const { pmonth, pyear } = paymentPeriod(paid_at || inv.payment_date, inv.month, inv.year)
          // victor_profit/victor_tax_diff podem ser NULL em faturas antigas
          // (colunas vieram de migração): sem o || 0 a soma virava NaN.
          const victorProfit = (parseFloat(inv.victor_profit) || 0) + (parseFloat(inv.victor_tax_diff) || 0)

          // invoices não possui coluna paid_at; o paid_at é registrado no receivable
          writes.push(sql`UPDATE invoices SET status = 'recebido' WHERE id = ${inv.id}`)
          writes.push(sql`INSERT INTO payables_fabricio (company_id, client_id, month, year, description, amount, origin, invoice_id, payment_month, payment_year) VALUES (${inv.company_id}, ${inv.client_id}, ${inv.month}, ${inv.year}, ${desc}, ${inv.fabricio_total}, 'faturamento', ${inv.id}, ${pmonth}, ${pyear})`)
          writes.push(sql`INSERT INTO payables_victor (company_id, client_id, month, year, description, service_amount, profit_amount, total_amount, origin, invoice_id, payment_month, payment_year) VALUES (${inv.company_id}, ${inv.client_id}, ${inv.month}, ${inv.year}, ${desc}, ${inv.victor_service}, ${victorProfit}, ${inv.victor_total}, 'faturamento', ${inv.id}, ${pmonth}, ${pyear})`)
        }
      }
    }

    const results = await sql.transaction(writes)
    return res.status(200).json({ data: results[0][0] })
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
