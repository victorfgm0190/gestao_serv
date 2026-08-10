import { neon } from '@neondatabase/serverless'
import { calcular } from './time-entries.js'
import { requireAdmin } from '../lib/admin-auth.js'
import { contratoComRegra } from '../lib/financial-rule.js'

// Reprocessa victor_share/fabricio_share de lançamentos já gravados usando a
// regra financeira e o contrato atuais. Necessário porque os valores são
// calculados na gravação e ficam congelados na linha.
//
// POST /api/recalc-time-entries
//   { company_id, month, year, client_id?, apply?, include_invoiced? }
//
// apply=false (padrão) → simulação: não grava nada, só devolve o diff.
// Lançamentos já vinculados a uma fatura são pulados por padrão: alterá-los
// dessincronizaria a fatura e os payables já gerados.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!requireAdmin(req, res)) return
  const sql = neon(process.env.DATABASE_URL)

  const { company_id, month, year, client_id, apply = false, include_invoiced = false } = req.body || {}
  if (!company_id) return res.status(400).json({ error: 'company_id obrigatório' })
  if (!month || !year) return res.status(400).json({ error: 'month e year obrigatórios' })

  try {
    const entries = client_id
      ? await sql`
          SELECT te.*, c.name AS client_name FROM time_entries te
          LEFT JOIN clients c ON c.id = te.client_id
          WHERE te.company_id = ${company_id} AND te.client_id = ${client_id}
            AND EXTRACT(MONTH FROM te.entry_date) = ${month}
            AND EXTRACT(YEAR FROM te.entry_date) = ${year}
          ORDER BY te.entry_date ASC, te.id ASC`
      : await sql`
          SELECT te.*, c.name AS client_name FROM time_entries te
          LEFT JOIN clients c ON c.id = te.client_id
          WHERE te.company_id = ${company_id}
            AND EXTRACT(MONTH FROM te.entry_date) = ${month}
            AND EXTRACT(YEAR FROM te.entry_date) = ${year}
          ORDER BY te.entry_date ASC, te.id ASC`

    if (!entries.length) {
      return res.status(200).json({ applied: false, total: 0, changed: 0, message: 'Nenhum lançamento no período.' })
    }

    // Lançamentos já faturados — não mexer sem pedido explícito.
    const invoiced = await sql`
      SELECT DISTINCT unnest(time_entry_ids) AS id
      FROM invoices WHERE time_entry_ids IS NOT NULL`
    const invoicedIds = new Set(invoiced.map(r => Number(r.id)))

    // Cache por CONTRATO — contrato e regra vêm do mesmo lugar agora, então um cache
    // só basta (antes eram três, e o de regra era chaveado por cliente).
    const porContrato = new Map()

    const changes = []
    const skipped = []
    let deltaVictor = 0
    let deltaFabricio = 0

    for (const e of entries) {
      if (invoicedIds.has(Number(e.id)) && !include_invoiced) {
        skipped.push({ id: e.id, entry_date: e.entry_date, client_name: e.client_name, reason: 'ja_faturado' })
        continue
      }

      // Mesma resolução do POST de time-entries: contrato e regra juntos, do contrato.
      // Um lançamento sem contrato é pulado em vez de recalculado pela regra do
      // cliente — recalcular com a regra errada reescreveria o split gravado, que é
      // pior do que não recalcular.
      if (!e.contract_id) {
        skipped.push({ id: e.id, entry_date: e.entry_date, client_name: e.client_name, reason: 'sem_contrato' })
        continue
      }
      if (!porContrato.has(e.contract_id)) {
        porContrato.set(e.contract_id, await contratoComRegra(sql, e.contract_id))
      }
      const resolvido = porContrato.get(e.contract_id)
      if (resolvido.error) {
        skipped.push({ id: e.id, entry_date: e.entry_date, client_name: e.client_name, reason: 'sem_regra_financeira', detalhe: resolvido.error })
        continue
      }
      const { contrato, rule: regra } = resolvido

      const hours = parseFloat(e.hours) || 0
      if (hours <= 0) {
        skipped.push({ id: e.id, entry_date: e.entry_date, client_name: e.client_name, reason: 'sem_horas' })
        continue
      }

      const calc = calcular(
        hours, regra,
        parseFloat(e.horas_deslocamento) || 0,
        contrato,
        parseFloat(e.despesas_deslocamento) || 0,
      )

      const before = {
        gross_value: parseFloat(e.gross_value) || 0,
        tax_amount: parseFloat(e.tax_amount) || 0,
        net_value: parseFloat(e.net_value) || 0,
        victor_share: parseFloat(e.victor_share) || 0,
        fabricio_share: parseFloat(e.fabricio_share) || 0,
      }
      const diffVictor = calc.victor_share - before.victor_share
      const diffFabricio = calc.fabricio_share - before.fabricio_share
      const mudou = Math.abs(diffVictor) >= 0.01 || Math.abs(diffFabricio) >= 0.01
        || Math.abs(calc.gross_value - before.gross_value) >= 0.01
        || Math.abs(calc.tax_amount - before.tax_amount) >= 0.01

      if (!mudou) continue

      deltaVictor += diffVictor
      deltaFabricio += diffFabricio
      changes.push({
        id: e.id,
        entry_date: String(e.entry_date).slice(0, 10),
        client_name: e.client_name,
        hours,
        before,
        after: {
          gross_value: calc.gross_value, tax_amount: calc.tax_amount, net_value: calc.net_value,
          victor_share: calc.victor_share, fabricio_share: calc.fabricio_share,
        },
        diff_victor: parseFloat(diffVictor.toFixed(2)),
        diff_fabricio: parseFloat(diffFabricio.toFixed(2)),
        invoiced: invoicedIds.has(Number(e.id)),
      })

      if (apply) {
        await sql`
          UPDATE time_entries SET
            gross_value = ${calc.gross_value},
            tax_amount = ${calc.tax_amount},
            net_value = ${calc.net_value},
            victor_share = ${calc.victor_share},
            fabricio_share = ${calc.fabricio_share},
            valor_deslocamento = ${calc.valor_deslocamento}
          WHERE id = ${e.id}`
      }
    }

    return res.status(200).json({
      applied: !!apply,
      period: `${month}/${year}`,
      total: entries.length,
      changed: changes.length,
      skipped_count: skipped.length,
      delta_victor: parseFloat(deltaVictor.toFixed(2)),
      delta_fabricio: parseFloat(deltaFabricio.toFixed(2)),
      changes,
      skipped,
      message: apply
        ? `${changes.length} lançamento(s) atualizado(s).`
        : `Simulação: ${changes.length} lançamento(s) mudariam. Reenvie com apply=true para gravar.`,
    })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
}
