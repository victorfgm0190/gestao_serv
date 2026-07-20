import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import { statusFor, remainingBalance } from '../lib/payment-status.js'

// Tabela pai e coluna de total por tipo
const TABLES = {
  victor: { table: 'payables_victor', totalCol: 'total_amount' },
  fabricio: { table: 'payables_fabricio', totalCol: 'amount' },
}

// Deriva mês/ano de caixa de uma data (YYYY-MM-DD). Sem data válida, retorna nulos.
function periodFromDate(date) {
  if (date) {
    const [y, m] = String(date).slice(0, 10).split('-').map(Number)
    if (y && m) return { pmonth: m, pyear: y }
  }
  return { pmonth: null, pyear: null }
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

  const status = statusFor(sum, total)
  const paidAt = status === 'pendente' ? null : lastPaid
  const paidAmount = sum.toFixed(2)

  // Mês de caixa do pai = data do último pagamento. Sem pagamentos (paidAt null),
  // preserva o payment_month/year atual (competência/recebimento original).
  const { pmonth, pyear } = periodFromDate(paidAt)

  if (payable_type === 'victor') {
    if (pmonth) await sql`UPDATE payables_victor SET paid_amount=${paidAmount}, paid_at=${paidAt}, status=${status}, payment_month=${pmonth}, payment_year=${pyear} WHERE id=${payable_id}`
    else await sql`UPDATE payables_victor SET paid_amount=${paidAmount}, paid_at=${paidAt}, status=${status} WHERE id=${payable_id}`
  } else {
    if (pmonth) await sql`UPDATE payables_fabricio SET paid_amount=${paidAmount}, paid_at=${paidAt}, status=${status}, payment_month=${pmonth}, payment_year=${pyear} WHERE id=${payable_id}`
    else await sql`UPDATE payables_fabricio SET paid_amount=${paidAmount}, paid_at=${paidAt}, status=${status} WHERE id=${payable_id}`
  }
  return { sum, status, paidAt }
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
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
    if (!payable_id) return res.status(400).json({ error: 'payable_id obrigatório' })

    // amount entrava direto no INSERT: aceitava nulo, negativo, zero, texto e
    // valor acima do saldo devedor — deixando o pai "pago" com saldo negativo.
    const valor = Number(amount)
    if (!Number.isFinite(valor) || valor <= 0) {
      return res.status(400).json({ error: 'Valor do pagamento deve ser um número maior que zero.' })
    }
    if (!paid_at) return res.status(400).json({ error: 'Data do pagamento é obrigatória.' })

    // O payable precisa existir; sem isso ficava um pagamento órfão permanente,
    // contado em toda soma futura.
    const parent = payable_type === 'victor'
      ? await sql`SELECT total_amount AS total FROM payables_victor WHERE id = ${payable_id} LIMIT 1`
      : await sql`SELECT amount AS total FROM payables_fabricio WHERE id = ${payable_id} LIMIT 1`
    if (!parent.length) return res.status(404).json({ error: 'Lançamento não encontrado' })

    const total = parseFloat(parent[0].total) || 0
    const pago = await sql`
      SELECT COALESCE(SUM(amount), 0) AS s FROM payable_payments
      WHERE payable_type = ${payable_type} AND payable_id = ${payable_id}`
    const jaPago = parseFloat(pago[0].s) || 0
    const restante = remainingBalance(total, jaPago)

    if (valor > restante + 0.01) {
      return res.status(400).json({
        error: `Valor acima do saldo devedor. Restam R$ ${restante.toFixed(2)} deste lançamento.`,
        remaining: Number(restante.toFixed(2)),
      })
    }

    const { pmonth, pyear } = periodFromDate(paid_at)
    const result = await sql`
      INSERT INTO payable_payments (payable_type, payable_id, amount, paid_at, notes, payment_month, payment_year)
      VALUES (${payable_type}, ${payable_id}, ${valor}, ${paid_at}, ${notes || null}, ${pmonth}, ${pyear})
      RETURNING *`
    await recalcParent(sql, payable_type, payable_id)
    return res.status(201).json({ data: result[0] })
  }

  if (req.method === 'DELETE') {
    const id = req.body?.id || req.query?.id
    if (!id) return res.status(400).json({ error: 'id obrigatório' })

    // O tipo/id do pai vêm da própria linha apagada, não do body. Antes o DELETE
    // usava só o id e recalculava o payable informado no body: apagar um
    // pagamento do payable 42 e recalcular o 1 deixava o 42 permanentemente
    // com paid_amount e status errados.
    const deleted = await sql`
      DELETE FROM payable_payments WHERE id = ${id}
      RETURNING payable_type, payable_id`
    if (!deleted.length) return res.status(404).json({ error: 'Pagamento não encontrado' })

    await recalcParent(sql, deleted[0].payable_type, deleted[0].payable_id)
    return res.status(200).json({ success: true })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
