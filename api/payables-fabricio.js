import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import { breakdownFabricio } from '../lib/fabricio-breakdown.js'

// Colunas da fatura que explicam o valor do Fabrício, buscadas em UMA query pelos
// invoice_id já filtrados — em vez de engordar os quatro SELECTs de payables acima
// (o driver do Neon não compõe fragmentos, então cada coluna nova seria escrita 4x).
// Mesmo padrão do merge de `payments` logo abaixo.
export async function fetchBreakdowns(sql, invoiceIds) {
  const ids = [...new Set(invoiceIds.filter(Boolean))]
  if (!ids.length) return {}
  const rows = await sql`
    SELECT i.id, i.billing_type, i.contract_value, i.invoice_value, i.tax_amount,
           i.victor_service, i.victor_profit, i.victor_tax_diff, i.fabricio_total,
           i.emission_date, i.invoice_number,
           COALESCE(c.remainder_fabricio_pct, fr.remainder_fabricio_pct) AS fab_pct,
           COALESCE(c.remainder_victor_pct,   fr.remainder_victor_pct)   AS victor_pct
    FROM invoices i
    LEFT JOIN contracts c ON c.id = i.contract_id
    LEFT JOIN LATERAL (
      SELECT remainder_fabricio_pct, remainder_victor_pct
      FROM financial_rules WHERE client_id = i.client_id ORDER BY id LIMIT 1
    ) fr ON true
    WHERE i.id = ANY(${ids})`
  const by = {}
  for (const r of rows) {
    by[r.id] = {
      invoice_number: r.invoice_number,
      // Nomes que a tela e o Excel consomem. As colunas reais são contract_value
      // (bruto), victor_service e emission_date — não existem `gross_amount`,
      // `victor_servico` nem `invoice_date` na tabela.
      gross_amount: r.contract_value,
      victor_servico: r.victor_service,
      tax_amount: r.tax_amount,
      fabricio_total: r.fabricio_total,
      breakdown: breakdownFabricio(r),
    }
  }
  return by
}

// Linhas "previstas": fatura emitida cujo recebível ainda não foi pago, então o payable
// do Fabrício não existe. O valor sai de invoices.fabricio_total — é o mesmo número que
// o INSERT de receivables.js vai gravar quando o cliente pagar.
//
// Exportada porque o export em Excel precisa da MESMA definição. Duplicar a query faria
// o `NOT EXISTS` e o filtro de status do recebível divergirem entre tela e planilha, e a
// divergência só apareceria como uma linha a mais (ou a menos) num arquivo baixado.
export async function fetchPreviews(sql, { company_id, year, anos, caixa }) {
  const prev = caixa
    ? await sql`SELECT r.id AS receivable_id, r.month, r.year, r.payment_month, r.payment_year, r.client_id, c.name AS client_name, i.id AS invoice_id, i.fabricio_total, i.emission_date FROM receivables r JOIN invoices i ON i.receivable_id = r.id LEFT JOIN clients c ON c.id = r.client_id WHERE r.company_id = ${company_id} AND r.status IN ('pendente','parcial') AND r.payment_year = ${year} AND NOT EXISTS (SELECT 1 FROM payables_fabricio pf WHERE pf.invoice_id = i.id)`
    : await sql`SELECT r.id AS receivable_id, r.month, r.year, r.payment_month, r.payment_year, r.client_id, c.name AS client_name, i.id AS invoice_id, i.fabricio_total, i.emission_date FROM receivables r JOIN invoices i ON i.receivable_id = r.id LEFT JOIN clients c ON c.id = r.client_id WHERE r.company_id = ${company_id} AND r.status IN ('pendente','parcial') AND r.year = ANY(${anos}) AND NOT EXISTS (SELECT 1 FROM payables_fabricio pf WHERE pf.invoice_id = i.id)`
  // Saem da própria fatura, então têm o mesmo demonstrativo das efetivadas — a única
  // diferença é que o payable ainda não existe.
  const prevBreak = await fetchBreakdowns(sql, prev.map(p => p.invoice_id))
  return prev.map(p => ({
    id: 'preview_' + p.receivable_id,
    client_id: p.client_id,
    client_name: p.client_name,
    month: p.month, year: p.year,
    payment_month: p.payment_month, payment_year: p.payment_year,
    emission_date: p.emission_date,
    amount: p.fabricio_total,
    paid_amount: 0,
    status: 'previsto', origin: 'faturamento', is_preview: true,
    receivable_status: 'pendente', invoice_id: p.invoice_id, payments: [],
    ...(prevBreak[p.invoice_id] || {}),
  }))
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  const sql = neon(process.env.DATABASE_URL)
  if (req.method === 'GET') {
    const { company_id, year, month, mode } = req.query
    const caixa = mode === 'caixa'  // caixa filtra por payment_month/payment_year
    // Visão fiscal: agrupada pela emissão da NF no frontend. Aqui só se alarga a janela
    // de anos, para que a NF de dezembro emitida em janeiro chegue na resposta.
    const anos = mode === 'fiscal' ? [Number(year) - 1, Number(year)] : [Number(year)]
    let rows
    if (caixa) {
      rows = month
        ? await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount, i.emission_date, rcv.status as receivable_status FROM payables_fabricio p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN receivables rcv ON rcv.id = i.receivable_id WHERE p.company_id = ${company_id} AND p.payment_year = ${year} AND p.payment_month = ${month} ORDER BY p.payment_month DESC, p.created_at DESC`
        : await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount, i.emission_date, rcv.status as receivable_status FROM payables_fabricio p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN receivables rcv ON rcv.id = i.receivable_id WHERE p.company_id = ${company_id} AND p.payment_year = ${year} ORDER BY p.payment_month DESC, p.created_at DESC`
    } else {
      rows = month
        ? await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount, i.emission_date, rcv.status as receivable_status FROM payables_fabricio p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN receivables rcv ON rcv.id = i.receivable_id WHERE p.company_id = ${company_id} AND p.year = ANY(${anos}) AND p.month = ${month} ORDER BY p.month DESC, p.created_at DESC`
        : await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount, i.emission_date, rcv.status as receivable_status FROM payables_fabricio p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN receivables rcv ON rcv.id = i.receivable_id WHERE p.company_id = ${company_id} AND p.year = ANY(${anos}) ORDER BY p.month DESC, p.created_at DESC`
    }
    const ids = rows.map(r => r.id)
    let payments = []
    if (ids.length) {
      payments = await sql`SELECT * FROM payable_payments WHERE payable_type = 'fabricio' AND payable_id = ANY(${ids}) ORDER BY paid_at DESC, id DESC`
    }
    const byId = {}
    for (const p of payments) { (byId[p.payable_id] ||= []).push(p) }
    for (const r of rows) { r.payments = byId[r.id] || [] }

    // Demonstrativo por linha: como a fatura chegou ao valor do Fabrício.
    const breakdowns = await fetchBreakdowns(sql, rows.map(r => r.invoice_id))
    for (const r of rows) { Object.assign(r, breakdowns[r.invoice_id] || {}) }

    // Previsão: recebíveis pendentes/parciais sem payable ainda, usando invoices.fabricio_total.
    if (req.query.include_preview === 'true') {
      rows.push(...await fetchPreviews(sql, { company_id, year, anos, caixa }))
    }
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
      // Sem desamarrar nada de fiscal aqui: a distribuição de impostos consome só
      // payables do Victor (candidatosDisponiveis lê payables_victor, e
      // fiscal_allocations só tem payable_victor_id). Fabrício não participa.
      await sql`DELETE FROM payable_payments WHERE payable_type = 'fabricio' AND payable_id = ${id}`
      const motivo = req.body?.motivo || null
      const result = await sql`
        UPDATE payables_fabricio SET
          status = 'pendente', paid_amount = 0, paid_at = NULL,
          notes = COALESCE(NULLIF(notes,'') || ' | ', '') || 'Estornado em ' ||
                  to_char(now() AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI') ||
                  COALESCE(' (' || ${motivo}::text || ')', '')
        WHERE id = ${id} RETURNING *`
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
