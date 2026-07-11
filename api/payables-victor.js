import { neon } from '@neondatabase/serverless'

const CLIENT_PHARMA = 7
const CATS = { honorarios: 'Honorários', das: 'DAS', inss: 'INSS', pro_labore: 'Pro Labore', lucros: 'Lucros', escritorio: 'Escritório', demais: 'Demais despesas' }
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

// Ordenação canônica: mês atual primeiro; demais do mais novo ao mais antigo.
// Dentro do mês: Pharmalog/ANB (client_id=7) primeiro, restante por saldo desc.
function ordenar(records, curKey) {
  return [...records].sort((a, b) => {
    const ka = a.year * 100 + a.month, kb = b.year * 100 + b.month
    const ca = ka === curKey ? 0 : 1, cb = kb === curKey ? 0 : 1
    if (ca !== cb) return ca - cb
    if (ka !== kb) return kb - ka
    if (a.client_id === CLIENT_PHARMA && b.client_id !== CLIENT_PHARMA) return -1
    if (b.client_id === CLIENT_PHARMA && a.client_id !== CLIENT_PHARMA) return 1
    return b._saldo - a._saldo
  })
}

// Consome `pool` sequencialmente sobre `lista` (registros com ._saldo calculado).
// Retorna os writes (fragmentos SQL não-aguardados) para a transação, o que foi aplicado e o restante.
function consumir(sql, pool, lista, when, notes) {
  const writes = []
  const applied = []
  let restante = r2(pool)
  // Mês/ano de caixa derivados da data do pagamento (when).
  const [wy, wm] = String(when).slice(0, 10).split('-').map(Number)
  for (const rec of lista) {
    if (restante <= 0.005) break
    const consumed = r2(Math.min(restante, rec._saldo))
    if (consumed <= 0) continue
    const total = r2(parseFloat(rec.total_amount) || 0)
    const newPaid = r2((parseFloat(rec.paid_amount) || 0) + consumed)
    const status = newPaid >= total - 0.005 ? 'pago' : 'parcial'
    writes.push(sql`INSERT INTO payable_payments (payable_type, payable_id, amount, paid_at, notes, payment_month, payment_year) VALUES ('victor', ${rec.id}, ${consumed}, ${when}, ${notes}, ${wm || null}, ${wy || null})`)
    writes.push(sql`UPDATE payables_victor SET paid_amount=${newPaid}, status=${status}, paid_at=${when}, payment_month=${wm || null}, payment_year=${wy || null} WHERE id=${rec.id}`)
    applied.push({ id: rec.id, consumed, status })
    restante = r2(restante - consumed)
  }
  return { writes, applied, restante }
}

// POST ?action=pagar-distribuido — Etapa 2: consumo de saldos entre múltiplos payables_victor.
async function pagarDistribuido(sql, req, res) {
  const { company_id, despesas = {}, mode, payable_id, overflow_action = null, overflow_target_id = null, paid_at, reference_month, reference_year } = req.body

  let total = 0
  const partes = []
  for (const [k, label] of Object.entries(CATS)) {
    const v = parseFloat(despesas[k]) || 0
    if (v > 0) { total = r2(total + v); partes.push(`${label}: R$${String(v).replace('.', ',')}`) }
  }
  if (total <= 0) return res.status(400).json({ error: 'Total de despesas deve ser maior que zero' })
  const notes = partes.length ? partes.join(' | ') : 'distribuição geral'
  const when = paid_at || new Date().toISOString().split('T')[0]

  // Mês de referência = filtro ativo da tela (fallback: mês do calendário).
  const now = new Date()
  const refMonth = reference_month ? Number(reference_month) : (now.getMonth() + 1)
  const refYear = reference_year ? Number(reference_year) : now.getFullYear()
  const curKey = refYear * 100 + refMonth

  // Distribuição SEMPRE por competência (year/month) — payment_month/year é só visão de caixa.
  const all = await sql`SELECT * FROM payables_victor WHERE company_id = ${company_id} AND status IN ('pendente','parcial') ORDER BY year ASC, month ASC`
  for (const rec of all) rec._saldo = r2((parseFloat(rec.total_amount) || 0) - (parseFloat(rec.paid_amount) || 0))
  // Ignora meses futuros ao de referência: nunca consome deles
  const candidatos = all.filter(rec => rec._saldo > 0 && (rec.year * 100 + rec.month) <= curKey)

  // FLOW A — geral
  if (mode === 'geral') {
    const lista = ordenar(candidatos, curKey)
    const { writes, applied, restante } = consumir(sql, total, lista, when, notes)
    if (writes.length) await sql.transaction(writes)
    return res.status(200).json({ mode: 'geral', applied, leftover: restante })
  }

  // FLOW B — especifico
  const target = candidatos.find(rec => rec.id === Number(payable_id))
  if (!target) return res.status(404).json({ error: 'Registro alvo não encontrado ou sem saldo' })
  const targetSaldo = target._saldo

  // Cabe tudo no alvo → paga normalmente e encerra
  if (total <= targetSaldo + 0.005) {
    const { writes } = consumir(sql, total, [target], when, notes)
    await sql.transaction(writes)
    return res.status(200).json({ mode: 'especifico', done: true })
  }

  const overflow = r2(total - targetSaldo)

  // Primeira chamada com sobra e sem decisão → não grava nada, pede decisão ao usuário
  if (!overflow_action) {
    return res.status(200).json({ mode: 'especifico', needsDecision: true, overflow, targetSaldo, target_id: target.id })
  }

  // Com decisão: paga o alvo cheio + distribui a sobra conforme a opção escolhida
  const others = candidatos.filter(rec => rec.id !== target.id)
  const targetFull = consumir(sql, targetSaldo, [target], when, notes)
  let writes = [...targetFull.writes]
  const applied = [...targetFull.applied]

  let poolList = []
  if (overflow_action === 'nada') {
    poolList = []
  } else if (overflow_action === 'pharma') {
    poolList = ordenar(others.filter(rec => rec.client_id === CLIENT_PHARMA), curKey)
  } else if (overflow_action === 'demais') {
    poolList = ordenar(others.filter(rec => rec.client_id !== CLIENT_PHARMA), curKey)
  } else if (overflow_action === 'mes') {
    const chosen = others.filter(rec => rec.id === Number(overflow_target_id))
    const rest = ordenar(others.filter(rec => rec.id !== Number(overflow_target_id)), curKey)
    poolList = [...chosen, ...rest]
  } else {
    return res.status(400).json({ error: 'overflow_action inválido' })
  }

  let leftover = overflow
  if (poolList.length) {
    const dist = consumir(sql, overflow, poolList, when, notes)
    writes = writes.concat(dist.writes)
    applied.push(...dist.applied)
    leftover = dist.restante
  }
  await sql.transaction(writes)
  return res.status(200).json({ mode: 'especifico', done: true, applied, leftover })
}

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL)
  if (req.method === 'GET') {
    const { company_id, year, month, status, mode } = req.query
    const caixa = mode === 'caixa'  // caixa filtra por payment_month/payment_year
    const statusList = status ? status.split(',').map(s => s.trim()).filter(Boolean) : []
    let rows
    if (statusList.length && caixa) {
      // Caixa: pendentes/parciais até o mês de caixa do filtro (inclusive), acumulando meses anteriores.
      // Ordem SEMPRE por competência (year/month asc) — distribuição segue mês mais antigo primeiro.
      rows = month
        ? await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id WHERE p.company_id = ${company_id} AND p.status = ANY(${statusList}) AND (p.payment_year < ${year} OR (p.payment_year = ${year} AND p.payment_month <= ${month})) ORDER BY p.year ASC, p.month ASC, p.created_at ASC`
        : await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id WHERE p.company_id = ${company_id} AND p.status = ANY(${statusList}) AND p.payment_year = ${year} ORDER BY p.year ASC, p.month ASC, p.created_at ASC`
    } else if (statusList.length) {
      // Competência (padrão): todos os pendentes/parciais, mês mais antigo primeiro (year/month asc).
      rows = await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id WHERE p.company_id = ${company_id} AND p.status = ANY(${statusList}) ORDER BY p.year ASC, p.month ASC, p.created_at ASC`
    } else if (caixa) {
      rows = month
        ? await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id WHERE p.company_id = ${company_id} AND p.payment_year = ${year} AND p.payment_month = ${month} ORDER BY p.payment_month DESC, p.created_at DESC`
        : await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id WHERE p.company_id = ${company_id} AND p.payment_year = ${year} ORDER BY p.payment_month DESC, p.created_at DESC`
    } else {
      rows = month
        ? await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id WHERE p.company_id = ${company_id} AND p.year = ${year} AND p.month = ${month} ORDER BY p.month DESC, p.created_at DESC`
        : await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id WHERE p.company_id = ${company_id} AND p.year = ${year} ORDER BY p.month DESC, p.created_at DESC`
    }
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
    if (req.query.action === 'pagar-distribuido') return pagarDistribuido(sql, req, res)
    const { company_id, client_id, month, year, description, service_amount, profit_amount, notes } = req.body
    const total = (parseFloat(service_amount)||0) + (parseFloat(profit_amount)||0)
    const result = await sql`INSERT INTO payables_victor (company_id, client_id, month, year, description, service_amount, profit_amount, total_amount, notes, payment_month, payment_year) VALUES (${company_id}, ${client_id}, ${month}, ${year}, ${description}, ${service_amount||0}, ${profit_amount||0}, ${total.toFixed(2)}, ${notes||null}, ${month}, ${year}) RETURNING *`
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
