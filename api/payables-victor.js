import { neon } from '@neondatabase/serverless'

const CLIENT_PHARMA = 7
const CATS = { honorarios: 'Honorários', das: 'DAS', inss: 'INSS', pro_labore: 'Pro Labore', lucros: 'Lucros', escritorio: 'Escritório', demais: 'Demais despesas' }
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

// Ordenação canônica: SEMPRE por competência (year/month) do mais antigo ao mais novo.
// Idêntica ao preview do frontend (sortedPending). Dentro do mês: Pharmalog/ANB
// (client_id=7) primeiro, restante por saldo desc. Nunca usa payment_month/year.
function ordenar(records) {
  return [...records].sort((a, b) => {
    const ka = a.year * 100 + a.month, kb = b.year * 100 + b.month
    if (ka !== kb) return ka - kb  // competência ASC — mês mais antigo primeiro
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

// Recalcula o pai de um payable_victor após alterar seus pagamentos.
async function recalcVictorParent(sql, payable_id) {
  const agg = await sql`SELECT COALESCE(SUM(amount),0) AS s, MAX(paid_at) AS last FROM payable_payments WHERE payable_type='victor' AND payable_id=${payable_id}`
  const s = parseFloat(agg[0].s) || 0
  const last = agg[0].last || null
  const pr = await sql`SELECT total_amount FROM payables_victor WHERE id=${payable_id}`
  const tot = parseFloat(pr[0]?.total_amount) || 0
  const st = s <= 0.005 ? 'pendente' : (s >= tot - 0.005 ? 'pago' : 'parcial')
  await sql`UPDATE payables_victor SET paid_amount=${s.toFixed(2)}, status=${st}, paid_at=${last} WHERE id=${payable_id}`
}

// Estorna uma sessão de recebimento (todos os payable_payments com mesmo paid_at + notes)
// da empresa e recalcula os pais afetados. Usado no fluxo de edição.
async function estornarSessao(sql, company_id, sess_paid_at, sess_notes) {
  const sess = await sql`
    SELECT DISTINCT pp.payable_id
    FROM payable_payments pp JOIN payables_victor pv ON pv.id = pp.payable_id
    WHERE pp.payable_type='victor' AND pv.company_id=${company_id}
      AND pp.paid_at=${sess_paid_at} AND pp.notes=${sess_notes}`
  const ids = sess.map(s => s.payable_id)
  if (!ids.length) return []
  await sql`DELETE FROM payable_payments WHERE payable_type='victor' AND payable_id = ANY(${ids}) AND paid_at=${sess_paid_at} AND notes=${sess_notes}`
  for (const id of ids) await recalcVictorParent(sql, id)
  return ids
}

// POST ?action=pagar-distribuido — Etapa 2: consumo de saldos entre múltiplos payables_victor.
async function pagarDistribuido(sql, req, res) {
  const { company_id, despesas = {}, mode, payable_id, overflow_action = null, overflow_target_id = null, paid_at, reference_month, reference_year, edit_session = null } = req.body

  let total = 0
  const partes = []
  for (const [k, label] of Object.entries(CATS)) {
    const v = parseFloat(despesas[k]) || 0
    if (v > 0) { total = r2(total + v); partes.push(`${label}: R$${String(v).replace('.', ',')}`) }
  }
  if (total <= 0) return res.status(400).json({ error: 'Total de despesas deve ser maior que zero' })
  const notes = partes.length ? partes.join(' | ') : 'distribuição geral'
  const when = paid_at || new Date().toISOString().split('T')[0]

  // Edição: estorna a sessão original (após validar o total) antes de redistribuir — restaura os saldos.
  if (edit_session && edit_session.paid_at && edit_session.notes) {
    await estornarSessao(sql, company_id, edit_session.paid_at, edit_session.notes)
  }

  // Mês de referência = filtro ativo da tela (fallback: mês do calendário).
  const now = new Date()
  const refMonth = reference_month ? Number(reference_month) : (now.getMonth() + 1)
  const refYear = reference_year ? Number(reference_year) : now.getFullYear()
  const curKey = refYear * 100 + refMonth

  // Ordenação SEMPRE por competência (year/month); o limite superior é o MÊS DE CAIXA.
  // Só entram payables DISPONÍVEIS: manuais (sem invoice) ou cujo recebível do cliente já foi pago/parcial.
  const all = await sql`
    SELECT p.* FROM payables_victor p
    LEFT JOIN invoices i ON i.id = p.invoice_id
    LEFT JOIN receivables rcv ON rcv.id = i.receivable_id
    WHERE p.company_id = ${company_id} AND p.status IN ('pendente','parcial')
      AND (p.invoice_id IS NULL OR rcv.status IN ('pago','parcial'))
    ORDER BY p.year ASC, p.month ASC, p.created_at ASC`
  for (const rec of all) rec._saldo = r2((parseFloat(rec.total_amount) || 0) - (parseFloat(rec.paid_amount) || 0))
  // Limite superior = mês de CAIXA (payment_month/year) ≤ período ativo. Nunca consome caixa futuro;
  // a sobra (pool - consumido) simplesmente não é distribuída (capital próprio).
  const candidatos = all.filter(rec => {
    if (rec._saldo <= 0) return false
    const py = Number(rec.payment_year) || rec.year
    const pm = Number(rec.payment_month) || rec.month
    return (py * 100 + pm) <= curKey
  })

  // FLOW A — geral
  if (mode === 'geral') {
    const lista = ordenar(candidatos)
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
    poolList = ordenar(others.filter(rec => rec.client_id === CLIENT_PHARMA))
  } else if (overflow_action === 'demais') {
    poolList = ordenar(others.filter(rec => rec.client_id !== CLIENT_PHARMA))
  } else if (overflow_action === 'mes') {
    const chosen = others.filter(rec => rec.id === Number(overflow_target_id))
    const rest = ordenar(others.filter(rec => rec.id !== Number(overflow_target_id)))
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
    // Info da sessão de recebimento (para edição): payables afetados + valor consumido na sessão.
    if (req.query.action === 'sessao') {
      const { company_id, paid_at, notes } = req.query
      const pays = await sql`
        SELECT pp.payable_id, SUM(pp.amount) AS session_amount
        FROM payable_payments pp JOIN payables_victor pv ON pv.id = pp.payable_id
        WHERE pp.payable_type='victor' AND pv.company_id=${company_id}
          AND pp.paid_at=${paid_at} AND pp.notes=${notes}
        GROUP BY pp.payable_id`
      const ids = pays.map(p => p.payable_id)
      let affected = []
      if (ids.length) {
        const rows = await sql`SELECT p.*, c.name AS client_name FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = ANY(${ids})`
        const amt = {}
        for (const p of pays) amt[p.payable_id] = parseFloat(p.session_amount) || 0
        affected = rows.map(r => ({ ...r, session_amount: amt[r.id] || 0 }))
      }
      return res.status(200).json({ paid_at, notes, affected })
    }
    const { company_id, year, month, status, mode } = req.query
    const caixa = mode === 'caixa'  // caixa filtra por payment_month/payment_year
    const statusList = status ? status.split(',').map(s => s.trim()).filter(Boolean) : []
    let rows
    if (statusList.length && caixa) {
      // Caixa: pendentes/parciais até o mês de caixa do filtro (inclusive), acumulando meses anteriores.
      // Ordem SEMPRE por competência (year/month asc) — distribuição segue mês mais antigo primeiro.
      rows = month
        ? await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount, rcv.status as receivable_status FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN receivables rcv ON rcv.id = i.receivable_id WHERE p.company_id = ${company_id} AND p.status = ANY(${statusList}) AND (p.payment_year < ${year} OR (p.payment_year = ${year} AND p.payment_month <= ${month})) ORDER BY p.year ASC, p.month ASC, p.created_at ASC`
        : await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount, rcv.status as receivable_status FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN receivables rcv ON rcv.id = i.receivable_id WHERE p.company_id = ${company_id} AND p.status = ANY(${statusList}) AND p.payment_year = ${year} ORDER BY p.year ASC, p.month ASC, p.created_at ASC`
    } else if (statusList.length) {
      // Competência (padrão): todos os pendentes/parciais, mês mais antigo primeiro (year/month asc).
      rows = await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount, rcv.status as receivable_status FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN receivables rcv ON rcv.id = i.receivable_id WHERE p.company_id = ${company_id} AND p.status = ANY(${statusList}) ORDER BY p.year ASC, p.month ASC, p.created_at ASC`
    } else if (caixa) {
      rows = month
        ? await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount, rcv.status as receivable_status FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN receivables rcv ON rcv.id = i.receivable_id WHERE p.company_id = ${company_id} AND p.payment_year = ${year} AND p.payment_month = ${month} ORDER BY p.payment_month DESC, p.created_at DESC`
        : await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount, rcv.status as receivable_status FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN receivables rcv ON rcv.id = i.receivable_id WHERE p.company_id = ${company_id} AND p.payment_year = ${year} ORDER BY p.payment_month DESC, p.created_at DESC`
    } else {
      rows = month
        ? await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount, rcv.status as receivable_status FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN receivables rcv ON rcv.id = i.receivable_id WHERE p.company_id = ${company_id} AND p.year = ${year} AND p.month = ${month} ORDER BY p.month DESC, p.created_at DESC`
        : await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount, rcv.status as receivable_status FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN receivables rcv ON rcv.id = i.receivable_id WHERE p.company_id = ${company_id} AND p.year = ${year} ORDER BY p.month DESC, p.created_at DESC`
    }
    const ids = rows.map(r => r.id)
    let payments = []
    if (ids.length) {
      payments = await sql`SELECT * FROM payable_payments WHERE payable_type = 'victor' AND payable_id = ANY(${ids}) ORDER BY paid_at DESC, id DESC`
    }
    const byId = {}
    for (const p of payments) { (byId[p.payable_id] ||= []).push(p) }
    for (const r of rows) { r.payments = byId[r.id] || [] }

    // Previsão: recebíveis pendentes/parciais (cliente ainda não pagou) que ainda não geraram
    // payable. Retornados como entradas "previsto" (is_preview) usando invoices.victor_total.
    if (req.query.include_preview === 'true') {
      const prev = caixa
        ? await sql`SELECT r.id AS receivable_id, r.month, r.year, r.payment_month, r.payment_year, c.name AS client_name, i.id AS invoice_id, i.victor_total FROM receivables r JOIN invoices i ON i.receivable_id = r.id LEFT JOIN clients c ON c.id = r.client_id WHERE r.company_id = ${company_id} AND r.status IN ('pendente','parcial') AND r.payment_year = ${year} AND NOT EXISTS (SELECT 1 FROM payables_victor pv WHERE pv.invoice_id = i.id)`
        : await sql`SELECT r.id AS receivable_id, r.month, r.year, r.payment_month, r.payment_year, c.name AS client_name, i.id AS invoice_id, i.victor_total FROM receivables r JOIN invoices i ON i.receivable_id = r.id LEFT JOIN clients c ON c.id = r.client_id WHERE r.company_id = ${company_id} AND r.status IN ('pendente','parcial') AND r.year = ${year} AND NOT EXISTS (SELECT 1 FROM payables_victor pv WHERE pv.invoice_id = i.id)`
      for (const p of prev) {
        rows.push({
          id: 'preview_' + p.receivable_id,
          client_name: p.client_name,
          month: p.month, year: p.year,
          payment_month: p.payment_month, payment_year: p.payment_year,
          total_amount: p.victor_total,
          status: 'previsto', origin: 'faturamento', is_preview: true,
          receivable_status: 'pendente', invoice_id: p.invoice_id, payments: [],
        })
      }
    }
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
