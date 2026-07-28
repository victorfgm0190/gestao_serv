import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import { PAID_EPSILON, remainingBalance } from '../lib/payment-status.js'
import { valorDevido, recalcularObrigacao } from '../lib/fiscal-status.js'
import { sincronizarLinhasFiscais } from '../lib/fiscal-lines.js'

// QUITAÇÃO DE OBRIGAÇÕES FISCAIS — pagamentos da guia (DAS/INSS/honorários).
//
// Complementa api/fiscal-obligations.js: lá se apura o que a empresa DEVE,
// aqui se registra quando a guia foi efetivamente PAGA. Vários pagamentos por
// obrigação, como payable_payments faz para os payables.
//
// POST   ?action=pagar  { obligation_id, amount, paid_at, method }
// GET    ?obligation_id                → pagamentos + saldo da obrigação
// DELETE ?payment_id                   → estorna um pagamento e recalcula

const round2 = (v) => Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100
// numeric do Postgres chega como string no driver — sem isso, `a + b` concatena.
const num = (v) => parseFloat(v) || 0

// Saldo em aberto arredondado. O remainingBalance de lib/payment-status.js não
// arredonda — a subtração em ponto flutuante devolve 182.07999999999998 e isso ia
// direto para a tela. Arredondado aqui em vez de no helper, que é compartilhado
// com os payables e não deve mudar de comportamento por causa deste endpoint.
const saldoAberto = (total, pago) => round2(remainingBalance(total, pago))

async function pagar(sql, req, res) {
  const { obligation_id, amount, paid_at, method, notes } = req.body || {}
  if (!obligation_id || amount === undefined || amount === null || amount === '' || !paid_at) {
    return res.status(400).json({ error: 'obligation_id, amount e paid_at são obrigatórios' })
  }
  const valor = round2(amount)
  // Valor não-positivo corromperia paid_amount silenciosamente. Estorno é o DELETE.
  if (!(valor > 0)) {
    return res.status(400).json({ error: 'amount deve ser maior que zero. Para reverter, use DELETE.' })
  }

  const rows = await sql`SELECT * FROM fiscal_obligations WHERE id = ${obligation_id} LIMIT 1`
  if (!rows.length) return res.status(404).json({ error: 'Obrigação não encontrada' })
  const ob = rows[0]

  const total = valorDevido(ob)
  const jaPago = num(ob.paid_amount)
  const saldo = round2(total - jaPago)

  // INSERT + recálculo na mesma transação: sem isso, uma falha no meio deixaria o
  // pagamento gravado com paid_amount/status defasados na obrigação.
  const [inserido, atualizado] = await sql.transaction([
    sql`
      INSERT INTO fiscal_payments (obligation_id, amount, paid_at, method, notes)
      VALUES (${obligation_id}, ${valor}, ${paid_at}, ${method || 'outro'}, ${notes || null})
      RETURNING *`,
    recalcularObrigacao(sql, obligation_id),
  ])

  const obAtualizada = atualizado[0]
  // O espelho da obrigação na aba Pagar Victor acompanha o pagamento. Fora da
  // transação de propósito: é derivado, e falhar aqui não pode desfazer a quitação.
  await sincronizarLinhasFiscais(sql, obAtualizada.company_id, obAtualizada.month, obAtualizada.year)

  return res.status(200).json({
    obligation: obAtualizada,
    payment: inserido[0],
    summary: {
      total_amount: total,
      paid_amount: num(obAtualizada.paid_amount),
      remaining: saldoAberto(total, num(obAtualizada.paid_amount)),
      status: obAtualizada.status,
    },
    // Não bloqueia (pagar a mais é possível: multa, juros, guia retificada),
    // mas avisa para a tela poder confirmar com o usuário.
    overpaid: valor > saldo + PAID_EPSILON ? round2(valor - saldo) : 0,
  })
}

async function estornar(sql, req, res) {
  const payment_id = req.query.payment_id || req.body?.payment_id
  if (!payment_id) return res.status(400).json({ error: 'payment_id é obrigatório' })

  const rows = await sql`SELECT * FROM fiscal_payments WHERE id = ${payment_id} LIMIT 1`
  if (!rows.length) return res.status(404).json({ error: 'Pagamento não encontrado' })
  const { obligation_id } = rows[0]

  const [, atualizado] = await sql.transaction([
    sql`DELETE FROM fiscal_payments WHERE id = ${payment_id}`,
    recalcularObrigacao(sql, obligation_id),
  ])

  const ob = atualizado[0]
  await sincronizarLinhasFiscais(sql, ob.company_id, ob.month, ob.year)

  const total = valorDevido(ob)
  return res.status(200).json({
    obligation: ob,
    removed: rows[0],
    summary: {
      total_amount: total,
      paid_amount: num(ob.paid_amount),
      remaining: saldoAberto(total, num(ob.paid_amount)),
      status: ob.status,
    },
  })
}

async function listar(sql, req, res) {
  const { obligation_id } = req.query
  if (!obligation_id) return res.status(400).json({ error: 'obligation_id é obrigatório' })

  const rows = await sql`SELECT * FROM fiscal_obligations WHERE id = ${obligation_id} LIMIT 1`
  if (!rows.length) return res.status(404).json({ error: 'Obrigação não encontrada' })
  const ob = rows[0]

  const payments = await sql`
    SELECT * FROM fiscal_payments
    WHERE obligation_id = ${obligation_id}
    ORDER BY paid_at ASC, id ASC`

  const total = valorDevido(ob)
  const pago = num(ob.paid_amount)
  return res.status(200).json({
    obligation: ob,
    payments,
    summary: {
      total_amount: total,
      paid_amount: pago,
      remaining: saldoAberto(total, pago),
      status: ob.status,
      // Divergência entre paid_amount e a soma real dos pagamentos indica
      // gravação perdida — nunca deve aparecer, mas é barato expor.
      soma_pagamentos: round2(payments.reduce((s, p) => s + num(p.amount), 0)),
    },
  })
}

export default async function handler(req, res) {
  // requireAuth JÁ responde 401/503 e devolve null — sem o `return` aqui a execução
  // seguiria e tentaria responder de novo ("headers already sent").
  if (!requireAuth(req, res)) return
  const sql = neon(process.env.DATABASE_URL)

  try {
    if (req.method === 'GET') return listar(sql, req, res)
    if (req.method === 'POST') {
      if (req.query.action === 'pagar') return pagar(sql, req, res)
      return res.status(400).json({ error: 'action inválida. Use ?action=pagar' })
    }
    if (req.method === 'DELETE') return estornar(sql, req, res)
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    console.error('fiscal-payments:', error)
    return res.status(500).json({ error: error.message })
  }
}
