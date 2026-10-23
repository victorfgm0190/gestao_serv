import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import { contratoComRegra } from '../lib/financial-rule.js'
import { tipoDaRegra, cotasDeDiaria, chaveData } from '../lib/billing-type.js'
import { calcular } from '../lib/time-entry-calc.js'

// Reexportado: recalc-time-entries e testes importam daqui.
export { calcular }

function timeToDecimal(time) {
  if (!time) return 0
  const [h, m] = time.split(':').map(Number)
  return h + m / 60
}

function calcularHoras(hora_inicial, intervalo_inicio, intervalo_fim, hora_final) {
  if (!hora_inicial || !hora_final) return 0
  const inicio = timeToDecimal(hora_inicial)
  const fim = timeToDecimal(hora_final)
  let intervalo = 0
  if (intervalo_inicio && intervalo_fim) {
    intervalo = timeToDecimal(intervalo_fim) - timeToDecimal(intervalo_inicio)
  }
  const total = fim - inicio - intervalo
  return Math.max(parseFloat(total.toFixed(4)), 0)
}

// Recalcula e grava os apontamentos de um contrato numa data.
//
// Por hora e por projeto o valor de um apontamento só depende dele mesmo. Na diária,
// não: a diária da data é rateada entre as OS daquela data (ver cotasDeDiaria), então
// incluir, mover ou excluir uma OS muda o valor das irmãs. POST/PUT/DELETE chamam
// aqui depois de gravar, e o valor final de uma OS por diária é sempre o daqui.
//
// Apontamentos já FATURADOS não são reescritos: os valores deles estão congelados com
// a fatura. Uma OS nova numa data já faturada fica com cota 0 (a diária já foi cobrada).
export async function recalcularDia(sql, contract_id, entry_date) {
  if (!contract_id || !entry_date) return
  const resolvido = await contratoComRegra(sql, contract_id)
  if (resolvido.error) return
  const { contrato, rule: regra } = resolvido
  // Só a diária acopla os apontamentos de uma data. Nas outras regras, reescrever as
  // irmãs recalcularia com a regra ATUAL valores que estavam congelados de propósito.
  if (tipoDaRegra(regra) !== 'diaria') return
  const dia = chaveData(entry_date)

  const doDia = await sql`
    SELECT te.*,
           EXISTS (SELECT 1 FROM invoices i WHERE te.id = ANY(i.time_entry_ids)) AS faturado
    FROM time_entries te
    WHERE te.contract_id = ${contract_id} AND te.entry_date = ${dia}::date
    ORDER BY te.id ASC`
  if (!doDia.length) return

  const faturados = new Set(doDia.filter(e => e.faturado).map(e => Number(e.id)))
  const cotas = tipoDaRegra(regra) === 'diaria' ? cotasDeDiaria(doDia, regra, faturados) : new Map()

  const writes = []
  for (const e of doDia) {
    if (e.faturado) continue
    const hours = parseFloat(e.hours) || 0
    let calc = { gross_value: null, tax_amount: null, net_value: null, victor_share: null, fabricio_share: null, fuel_cost: null, valor_deslocamento: 0 }
    if (hours > 0) {
      calc = calcular(hours, regra, e.horas_deslocamento, contrato, e.despesas_deslocamento, cotas.get(Number(e.id)))
    }
    writes.push(sql`
      UPDATE time_entries SET
        hourly_rate = ${tipoDaRegra(regra) === 'hora' ? (regra.hourly_rate || null) : null},
        gross_value = ${calc.gross_value},
        tax_amount = ${calc.tax_amount},
        net_value = ${calc.net_value},
        victor_share = ${calc.victor_share},
        fabricio_share = ${calc.fabricio_share},
        fuel_cost = ${calc.fuel_cost},
        valor_deslocamento = ${calc.valor_deslocamento || 0}
      WHERE id = ${e.id}`)
  }
  if (writes.length) await sql.transaction(writes)
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  const sql = neon(process.env.DATABASE_URL)

  if (req.method === 'GET') {
    const { company_id, month, year } = req.query
    if (month && year) {
      const entries = await sql`
        SELECT te.*, c.name as client_name, ct.name as contract_name
        FROM time_entries te
        LEFT JOIN clients c ON c.id = te.client_id
        LEFT JOIN contracts ct ON ct.id = te.contract_id
        WHERE te.company_id = ${company_id}
          AND EXTRACT(MONTH FROM te.entry_date) = ${month}
          AND EXTRACT(YEAR FROM te.entry_date) = ${year}
        ORDER BY te.entry_date DESC
      `
      return res.status(200).json({ entries })
    }
    const entries = await sql`
      SELECT te.*, c.name as client_name, ct.name as contract_name
      FROM time_entries te
      LEFT JOIN clients c ON c.id = te.client_id
      LEFT JOIN contracts ct ON ct.id = te.contract_id
      WHERE te.company_id = ${company_id}
      ORDER BY te.entry_date DESC
    `
    return res.status(200).json({ entries })
  }

  if (req.method === 'POST') {
    const {
      company_id, client_id, contract_id, entry_date,
      description, hours_fuel, despesas_deslocamento, notes,
      hora_inicial, intervalo_inicio, intervalo_fim, hora_final,
    } = req.body

    const hours = calcularHoras(hora_inicial, intervalo_inicio, intervalo_fim, hora_final)

    // Contrato e regra saem juntos, do contrato escolhido na tela. O fallback antigo
    // ("contrato ativo mais recente do cliente") foi removido junto com a busca da
    // regra por client_id: eram dois sorteios encadeados, e a tela de horas já exige
    // o contrato (63/63 lançamentos no banco têm contract_id).
    const resolvido = await contratoComRegra(sql, contract_id, { company_id })
    if (resolvido.error) return res.status(422).json({ error: resolvido.error })
    const { contrato, rule: regra } = resolvido

    const horas_desloc = parseFloat(hours_fuel) || 0
    const despesas_desloc = parseFloat(despesas_deslocamento) || 0

    let calc = {
      gross_value: null, tax_amount: null, net_value: null,
      victor_share: null, fabricio_share: null, fuel_cost: null, valor_deslocamento: 0
    }

    if (hours > 0) {
      calc = calcular(hours, regra, horas_desloc, contrato, despesas_desloc)
    }

    const hourly_rate = tipoDaRegra(regra) === 'hora' ? (regra.hourly_rate || null) : null

    const result = await sql`
      INSERT INTO time_entries (
        company_id, client_id, contract_id, entry_date, description,
        hours, hourly_rate, gross_value, tax_amount,
        net_value, victor_share, fabricio_share, fuel_cost, notes,
        hora_inicial, intervalo_inicio, intervalo_fim, hora_final,
        horas_deslocamento, valor_deslocamento, despesas_deslocamento
      ) VALUES (
        ${company_id}, ${client_id}, ${contract_id || null}, ${entry_date}, ${description},
        ${hours}, ${hourly_rate}, ${calc.gross_value}, ${calc.tax_amount},
        ${calc.net_value}, ${calc.victor_share}, ${calc.fabricio_share},
        ${calc.fuel_cost}, ${notes},
        ${hora_inicial || null}, ${intervalo_inicio || null},
        ${intervalo_fim || null}, ${hora_final || null},
        ${horas_desloc}, ${calc.valor_deslocamento || 0}, ${despesas_desloc}
      ) RETURNING *
    `
    // Diária: a OS nova muda a cota das irmãs da mesma data (e a dela mesma).
    await recalcularDia(sql, contrato.id, entry_date)
    const [entry] = await sql`SELECT * FROM time_entries WHERE id = ${result[0].id}`
    return res.status(201).json({ entry, hours_calculated: hours })
  }

  if (req.method === 'PUT') {
    const {
      id, client_id, contract_id, entry_date, description,
      hora_inicial, intervalo_inicio, intervalo_fim, hora_final,
      hours_fuel, despesas_deslocamento, notes
    } = req.body

    const hours = calcularHoras(hora_inicial, intervalo_inicio, intervalo_fim, hora_final)
    // Data/contrato ANTES da edição: mover uma OS de dia (ou de contrato) muda a cota
    // das que ficaram no dia de origem.
    const [antes] = await sql`SELECT contract_id, entry_date FROM time_entries WHERE id = ${id}`
    // Mesma resolução do POST. Sem company_id aqui: o body do PUT não o traz, e o
    // `id` do contrato já é chave — o filtro por empresa é defesa, não identificação.
    const resolvido = await contratoComRegra(sql, contract_id)
    if (resolvido.error) return res.status(422).json({ error: resolvido.error })
    const { contrato, rule: regra } = resolvido

    const horas_desloc = parseFloat(hours_fuel) || 0
    const despesas_desloc = parseFloat(despesas_deslocamento) || 0

    let calc = { gross_value: null, tax_amount: null, net_value: null, victor_share: null, fabricio_share: null, fuel_cost: null, valor_deslocamento: 0 }
    if (hours > 0) {
      calc = calcular(hours, regra, horas_desloc, contrato, despesas_desloc)
    }

    const hourly_rate = tipoDaRegra(regra) === 'hora' ? (regra.hourly_rate || null) : null

    const result = await sql`
      UPDATE time_entries SET
        client_id = ${client_id},
        contract_id = ${contract_id || null},
        entry_date = ${entry_date},
        description = ${description},
        hours = ${hours},
        hourly_rate = ${hourly_rate},
        gross_value = ${calc.gross_value},
        tax_amount = ${calc.tax_amount},
        net_value = ${calc.net_value},
        victor_share = ${calc.victor_share},
        fabricio_share = ${calc.fabricio_share},
        fuel_cost = ${calc.fuel_cost},
        hora_inicial = ${hora_inicial || null},
        intervalo_inicio = ${intervalo_inicio || null},
        intervalo_fim = ${intervalo_fim || null},
        hora_final = ${hora_final || null},
        horas_deslocamento = ${horas_desloc},
        valor_deslocamento = ${calc.valor_deslocamento || 0},
        despesas_deslocamento = ${despesas_desloc},
        notes = ${notes || null}
      WHERE id = ${id}
      RETURNING *
    `
    await recalcularDia(sql, contrato.id, entry_date)
    if (antes && (Number(antes.contract_id) !== Number(contrato.id) || chaveData(antes.entry_date) !== chaveData(entry_date))) {
      await recalcularDia(sql, antes.contract_id, antes.entry_date)
    }
    const [entry] = await sql`SELECT * FROM time_entries WHERE id = ${id}`
    return res.status(200).json({ entry: entry || result[0] })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body
    const apagados = await sql`DELETE FROM time_entries WHERE id = ${id} RETURNING contract_id, entry_date`
    // A diária que esta OS dividia volta inteira para as que ficaram na data.
    if (apagados[0]) await recalcularDia(sql, apagados[0].contract_id, apagados[0].entry_date)
    return res.status(200).json({ success: true })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
