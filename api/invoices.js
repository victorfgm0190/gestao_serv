import { neon } from '@neondatabase/serverless'

const round = (n) => parseFloat((Number(n) || 0).toFixed(2))

// Deriva mês/ano de caixa a partir da data prevista de recebimento (payment_date).
// Sem data, cai na competência (mês/ano do faturamento).
function paymentPeriod(payment_date, fbMonth, fbYear) {
  if (payment_date) {
    const [y, m] = String(payment_date).slice(0, 10).split('-').map(Number)
    if (y && m) return { pmonth: m, pyear: y }
  }
  return { pmonth: fbMonth, pyear: fbYear }
}

// Resolve o % usado na fatura: usa o valor enviado pelo frontend se presente,
// senão cai no valor cadastrado (fallback)
function resolvePct(used, fallback) {
  if (used !== undefined && used !== null && used !== '') return parseFloat(used) || 0
  return parseFloat(fallback) || 0
}

// CONTRATO FIXO (billing_type = 'contract' / 'mensal')
function calcContrato(contract, opts = {}) {
  const base = parseFloat(contract.contract_value) || 0
  const victor_fixo = parseFloat(contract.victor_fixed) || 0
  const victor_pct = parseFloat(contract.remainder_victor_pct) || 50
  const fab_pct = parseFloat(contract.remainder_fabricio_pct) || 50
  const taxClient = resolvePct(opts.tax_client_percent_used, contract.tax_client_percent)
  const taxReal = resolvePct(opts.tax_percentage_used, contract.has_tax ? contract.tax_percentage : 0)

  const nf = taxClient > 0 && taxClient < 100 ? base / (1 - taxClient / 100) : base
  const diff_nf = Math.max(nf - base, 0)              // 100% Victor
  const restante = Math.max(base - victor_fixo, 0)
  const victor_lucro = restante * (victor_pct / 100)
  const fabricio = restante * (fab_pct / 100)
  const victor_total = victor_fixo + victor_lucro + diff_nf
  const tax_amount = nf * (taxReal / 100)             // imposto real pago por Victor (sobre a NF)

  return {
    invoice_value: round(nf),
    contract_value: round(base),
    tax_amount: round(tax_amount),
    tax_percentage_used: taxReal,
    tax_client_percent_used: taxClient,
    victor_service: round(victor_fixo),
    victor_profit: round(victor_lucro),
    victor_tax_diff: round(diff_nf),
    victor_total: round(victor_total),
    fabricio_total: round(fabricio),
  }
}

// CONTRATO POR HORA (billing_type = 'hora' / 'agenda')
function calcAgenda(entries, rule, opts = {}) {
  const total_hours = entries.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0)
  const valor_hora = parseFloat(rule.hourly_rate) || 0
  const victor_fixo_hora = parseFloat(rule.victor_fixed_per_hour) || 0
  const victor_pct = parseFloat(rule.remainder_victor_pct) || 50
  const fab_pct = parseFloat(rule.remainder_fabricio_pct) || 50
  const taxReal = resolvePct(opts.tax_percentage_used, rule.has_tax ? rule.tax_percentage : 0)
  const taxClient = resolvePct(opts.tax_client_percent_used, 0)

  // Bruto = serviço + deslocamento faturado. gross_value já soma os dois (0 de deslocamento
  // quando 'nao_cobrado'); usa a taxa de deslocamento correta. Fallback: horas × valor_hora.
  const bruto = entries.reduce((s, e) => {
    const g = parseFloat(e.gross_value)
    return s + (isNaN(g) ? (parseFloat(e.hours) || 0) * valor_hora : g)
  }, 0)
  const tax = bruto * (taxReal / 100)                // imposto real
  const net = bruto - tax                            // líquido
  const victor_servico = total_hours * victor_fixo_hora
  const restante = Math.max(net - victor_servico, 0)
  const victor_lucro = restante * (victor_pct / 100)
  const fabricio = restante * (fab_pct / 100)
  const nf = taxClient > 0 && taxClient < 100 ? bruto / (1 - taxClient / 100) : bruto
  const diff_nf = Math.max(nf - bruto, 0)            // 100% Victor (igual ao fixo)
  const victor_total = victor_servico + victor_lucro + diff_nf

  return {
    invoice_value: round(nf),
    contract_value: round(bruto),
    tax_amount: round(tax),
    tax_percentage_used: taxReal,
    tax_client_percent_used: taxClient,
    victor_service: round(victor_servico),
    victor_profit: round(victor_lucro),
    victor_tax_diff: round(diff_nf),
    victor_total: round(victor_total),
    fabricio_total: round(fabricio),
    total_hours,
  }
}

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL)

  if (req.method === 'GET') {
    const { company_id, client_id, year } = req.query
    const invoices = client_id
      ? await sql`SELECT i.*, c.name as client_name, ct.name as contract_name FROM invoices i LEFT JOIN clients c ON c.id = i.client_id LEFT JOIN contracts ct ON ct.id = i.contract_id WHERE i.company_id = ${company_id} AND i.client_id = ${client_id} ORDER BY i.year DESC, i.month DESC`
      : await sql`SELECT i.*, c.name as client_name, ct.name as contract_name FROM invoices i LEFT JOIN clients c ON c.id = i.client_id LEFT JOIN contracts ct ON ct.id = i.contract_id WHERE i.company_id = ${company_id} AND i.year = ${year||new Date().getFullYear()} ORDER BY i.month DESC, c.name ASC`
    return res.status(200).json({ invoices })
  }

  if (req.method === 'POST') {
    const { company_id, client_id, contract_id, month, year, invoice_number, billing_type, time_entry_ids, notes, tax_percentage_used, tax_client_percent_used, payment_date } = req.body
    try {
      let calc
      if (billing_type === 'contract') {
        const contracts = await sql`SELECT * FROM contracts WHERE id = ${contract_id} LIMIT 1`
        if (!contracts.length) return res.status(404).json({ error: 'Contrato não encontrado' })
        calc = calcContrato(contracts[0], { tax_percentage_used, tax_client_percent_used })
      } else {
        const entries = await sql`SELECT * FROM time_entries WHERE id = ANY(${time_entry_ids}::int[])`
        const rules = await sql`SELECT * FROM financial_rules WHERE client_id = ${client_id} LIMIT 1`
        if (!rules.length) return res.status(400).json({ error: 'Regra financeira não encontrada' })
        calc = calcAgenda(entries, rules[0], { tax_percentage_used, tax_client_percent_used })
      }

      const { pmonth, pyear } = paymentPeriod(payment_date, month, year)

      const invoice = await sql`
        INSERT INTO invoices (company_id, client_id, contract_id, month, year, invoice_number, invoice_value, contract_value, tax_amount, victor_service, victor_profit, victor_tax_diff, victor_total, fabricio_total, billing_type, time_entry_ids, notes, payment_date)
        VALUES (${company_id}, ${client_id}, ${contract_id||null}, ${month}, ${year}, ${invoice_number||null}, ${calc.invoice_value}, ${calc.contract_value}, ${calc.tax_amount}, ${calc.victor_service}, ${calc.victor_profit}, ${calc.victor_tax_diff}, ${calc.victor_total}, ${calc.fabricio_total}, ${billing_type||'contract'}, ${time_entry_ids||null}, ${notes||null}, ${payment_date||null})
        RETURNING *
      `

      const receivable = await sql`
        INSERT INTO receivables (company_id, client_id, month, year, description, amount, notes, origin, payment_month, payment_year)
        VALUES (${company_id}, ${client_id}, ${month}, ${year}, ${`Fatura ${invoice_number || '#'+invoice[0].id} - ${month}/${year}`}, ${calc.invoice_value}, ${notes||null}, 'faturamento', ${pmonth}, ${pyear})
        RETURNING *
      `

      await sql`UPDATE invoices SET receivable_id = ${receivable[0].id} WHERE id = ${invoice[0].id}`

      return res.status(201).json({ invoice: invoice[0], receivable: receivable[0], breakdown: calc })
    } catch (error) {
      return res.status(500).json({ error: error.message })
    }
  }

  if (req.method === 'PATCH') {
    const { id, status, paid_at } = req.body
    try {
      const invoices = await sql`SELECT * FROM invoices WHERE id = ${id} LIMIT 1`
      if (!invoices.length) return res.status(404).json({ error: 'Fatura não encontrada' })
      const inv = invoices[0]

      if (status === 'estorno') {
        if (inv.status !== 'recebido') {
          return res.status(400).json({ error: 'Apenas faturas recebidas podem ser estornadas.' })
        }
        // Bloquear estorno se algum payable gerado já foi pago
        const fabPago = await sql`SELECT id FROM payables_fabricio WHERE invoice_id = ${id} AND status = 'pago' LIMIT 1`
        const vicPago = await sql`SELECT id FROM payables_victor WHERE invoice_id = ${id} AND status = 'pago' LIMIT 1`
        if (fabPago.length || vicPago.length) {
          return res.status(400).json({ error: 'Não é possível estornar. Os lançamentos de Pagar Fabrício e/ou Pagar Victor já foram pagos. Desfaça os pagamentos primeiro.' })
        }
        // Reverter receivable
        if (inv.receivable_id) {
          await sql`UPDATE receivables SET status='pendente', paid_at=NULL, paid_amount=NULL WHERE id=${inv.receivable_id}`
        }
        // Remover payables gerados por esta fatura
        await sql`DELETE FROM payables_fabricio WHERE invoice_id = ${id}`
        await sql`DELETE FROM payables_victor WHERE invoice_id = ${id}`
        // Reverter status da fatura
        await sql`UPDATE invoices SET status='pendente' WHERE id=${id}`
        return res.status(200).json({ success: true, action: 'estorno' })
      }

      await sql`UPDATE invoices SET status = ${status} WHERE id = ${id}`

      if (status === 'recebido' && inv.receivable_id) {
        await sql`UPDATE receivables SET status='pago', paid_at=${paid_at}, paid_amount=${inv.invoice_value} WHERE id=${inv.receivable_id}`

        const clients = await sql`SELECT name FROM clients WHERE id = ${inv.client_id} LIMIT 1`
        const client_name = clients[0]?.name || 'Cliente'
        const desc = `${client_name} - ${inv.month}/${inv.year}`
        // Mês de caixa = data real do recebimento (paid_at); depois payment_date da fatura; por fim competência.
        const { pmonth, pyear } = paymentPeriod(paid_at || inv.payment_date, inv.month, inv.year)

        await sql`INSERT INTO payables_fabricio (company_id, client_id, month, year, description, amount, origin, invoice_id, payment_month, payment_year) VALUES (${inv.company_id}, ${inv.client_id}, ${inv.month}, ${inv.year}, ${desc}, ${inv.fabricio_total}, 'faturamento', ${inv.id}, ${pmonth}, ${pyear})`

        await sql`INSERT INTO payables_victor (company_id, client_id, month, year, description, service_amount, profit_amount, total_amount, origin, invoice_id, payment_month, payment_year) VALUES (${inv.company_id}, ${inv.client_id}, ${inv.month}, ${inv.year}, ${desc}, ${inv.victor_service}, ${parseFloat(inv.victor_profit)+parseFloat(inv.victor_tax_diff)}, ${inv.victor_total}, 'faturamento', ${inv.id}, ${pmonth}, ${pyear})`
      }

      return res.status(200).json({ success: true })
    } catch (error) {
      return res.status(500).json({ error: error.message })
    }
  }

  if (req.method === 'PUT') {
    const { id, invoice_number, notes, billing_type, time_entry_ids, contract_id, client_id, tax_percentage_used, tax_client_percent_used, payment_date } = req.body
    try {
      const invoices = await sql`SELECT * FROM invoices WHERE id = ${id} LIMIT 1`
      if (!invoices.length) return res.status(404).json({ error: 'Fatura não encontrada' })
      const inv = invoices[0]

      if (inv.status === 'recebido') {
        return res.status(400).json({ error: 'Não é possível editar uma fatura já recebida. Estorne primeiro.' })
      }

      let calc
      if (billing_type === 'contract') {
        const contracts = await sql`SELECT * FROM contracts WHERE id = ${contract_id || inv.contract_id} LIMIT 1`
        if (!contracts.length) return res.status(404).json({ error: 'Contrato não encontrado' })
        calc = calcContrato(contracts[0], { tax_percentage_used, tax_client_percent_used })
      } else {
        const ids = time_entry_ids || inv.time_entry_ids
        const entries = await sql`SELECT * FROM time_entries WHERE id = ANY(${ids}::int[])`
        const rules = await sql`SELECT * FROM financial_rules WHERE client_id = ${client_id || inv.client_id} LIMIT 1`
        if (!rules.length) return res.status(400).json({ error: 'Regra financeira não encontrada' })
        calc = calcAgenda(entries, rules[0], { tax_percentage_used, tax_client_percent_used })
      }

      // payment_date: usa o enviado; se a chave não veio no body, mantém o atual.
      const newPaymentDate = payment_date !== undefined ? (payment_date || null) : inv.payment_date
      const { pmonth, pyear } = paymentPeriod(newPaymentDate, inv.month, inv.year)

      const updated = await sql`
        UPDATE invoices SET
          invoice_number = ${invoice_number || null},
          invoice_value = ${calc.invoice_value},
          contract_value = ${calc.contract_value},
          tax_amount = ${calc.tax_amount},
          victor_service = ${calc.victor_service},
          victor_profit = ${calc.victor_profit},
          victor_tax_diff = ${calc.victor_tax_diff},
          victor_total = ${calc.victor_total},
          fabricio_total = ${calc.fabricio_total},
          notes = ${notes || null},
          payment_date = ${newPaymentDate}
        WHERE id = ${id}
        RETURNING *
      `

      if (inv.receivable_id) {
        await sql`UPDATE receivables SET amount = ${calc.invoice_value}, description = ${`Fatura ${invoice_number || '#'+id} - ${inv.month}/${inv.year}`}, payment_month = ${pmonth}, payment_year = ${pyear} WHERE id = ${inv.receivable_id}`
      }

      return res.status(200).json({ invoice: updated[0], breakdown: calc })
    } catch (error) {
      return res.status(500).json({ error: error.message })
    }
  }

  if (req.method === 'DELETE') {
    const { id } = req.body
    try {
      const invoices = await sql`SELECT * FROM invoices WHERE id = ${id} LIMIT 1`
      if (!invoices.length) return res.status(404).json({ error: 'Fatura não encontrada' })
      const inv = invoices[0]

      if (inv.status === 'recebido') {
        return res.status(400).json({ error: 'Não é possível excluir uma fatura já recebida. Estorne primeiro.' })
      }

      if (inv.receivable_id) {
        await sql`DELETE FROM receivables WHERE id = ${inv.receivable_id}`
      }

      await sql`DELETE FROM payables_fabricio WHERE invoice_id = ${id}`
      await sql`DELETE FROM payables_victor WHERE invoice_id = ${id}`
      await sql`DELETE FROM invoices WHERE id = ${id}`

      return res.status(200).json({ success: true })
    } catch (error) {
      return res.status(500).json({ error: error.message })
    }
  }

  res.status(405).json({ error: 'Method not allowed' })
}
