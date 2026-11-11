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
//
// → [{ id, entry_date, antes, depois }] dos apontamentos cujo valor mudou.
export async function recalcularDia(sql, contract_id, entry_date) {
  if (!contract_id || !entry_date) return []
  const resolvido = await contratoComRegra(sql, contract_id)
  if (resolvido.error) return []
  const { contrato, rule: regra } = resolvido
  // Só a diária acopla os apontamentos de uma data. Nas outras regras, reescrever as
  // irmãs recalcularia com a regra ATUAL valores que estavam congelados de propósito.
  if (tipoDaRegra(regra) !== 'diaria') return []
  const dia = chaveData(entry_date)

  const doDia = await sql`
    SELECT te.*,
           EXISTS (SELECT 1 FROM invoices i WHERE te.id = ANY(i.time_entry_ids)) AS faturado
    FROM time_entries te
    WHERE te.contract_id = ${contract_id} AND te.entry_date = ${dia}::date
    ORDER BY te.id ASC`
  if (!doDia.length) return []

  const faturados = new Set(doDia.filter(e => e.faturado).map(e => Number(e.id)))
  const cotas = tipoDaRegra(regra) === 'diaria' ? cotasDeDiaria(doDia, regra, faturados) : new Map()

  const writes = []
  const mudaram = []
  for (const e of doDia) {
    if (e.faturado) continue
    const hours = parseFloat(e.hours) || 0
    let calc = { gross_value: null, tax_amount: null, net_value: null, victor_share: null, fabricio_share: null, fuel_cost: null, valor_deslocamento: 0 }
    if (hours > 0) {
      calc = calcular(hours, regra, e.horas_deslocamento, contrato, e.despesas_deslocamento, cotas.get(Number(e.id)))
    }
    const antes = { gross_value: parseFloat(e.gross_value) || 0, victor_share: parseFloat(e.victor_share) || 0, fabricio_share: parseFloat(e.fabricio_share) || 0 }
    const depois = { gross_value: calc.gross_value || 0, victor_share: calc.victor_share || 0, fabricio_share: calc.fabricio_share || 0 }
    if (Object.keys(antes).some(k => Math.abs(antes[k] - depois[k]) >= 0.005)) mudaram.push({ id: e.id, entry_date: dia, antes, depois })
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
  return mudaram
}

const EMPRESAS = ['1', '2']
const LIMITE_LOTE = 31
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/

// Validação + cálculo de UM lançamento, sem gravar. Dono único: o POST individual e o
// lote (`lancarEmLote`) passam por aqui, então as duas portas não podem divergir.
// → { error, status } | { valores prontos para inserirLancamento }
async function prepararLancamento(sql, body, company_id) {
  const {
    client_id, contract_id, entry_date,
    description, hours_fuel, despesas_deslocamento, notes,
    hora_inicial, intervalo_inicio, intervalo_fim, hora_final,
  } = body || {}

  if (!EMPRESAS.includes(String(company_id))) return { status: 400, error: 'company_id inválido (use 1 ou 2)' }
  if (!client_id) return { error: 'Cliente obrigatório.' }
  if (!entry_date || !DATA_RE.test(String(entry_date).slice(0, 10))) return { error: 'Data inválida (use AAAA-MM-DD).' }

  const hours = calcularHoras(hora_inicial, intervalo_inicio, intervalo_fim, hora_final)

  // Contrato e regra saem juntos, do contrato escolhido na tela. O fallback antigo
  // ("contrato ativo mais recente do cliente") foi removido junto com a busca da
  // regra por client_id: eram dois sorteios encadeados, e a tela de horas já exige
  // o contrato (63/63 lançamentos no banco têm contract_id).
  // `company_id` no filtro garante que o contrato é da empresa ativa.
  const resolvido = await contratoComRegra(sql, contract_id, { company_id })
  if (resolvido.error) return { error: resolvido.error }
  const { contrato, rule: regra } = resolvido
  // `clients` não tem company_id: o cliente pertence à empresa através do contrato.
  // Contrato de um cliente lançado em nome de outro gravaria a OS no card errado.
  if (Number(contrato.client_id) !== Number(client_id)) {
    return { error: `O contrato "${contrato.name}" não é do cliente informado.` }
  }

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

  // Descrição é opcional (lote só marca o dia; ela é completada depois). Vazio vira
  // NULL — a coluna é nullable, o export usa `description || ''` e a NFS-e não lê
  // a descrição da OS (vem de invoices.descricao_nfse).
  const desc = typeof description === 'string' && description.trim() ? description : null

  return {
    company_id: Number(company_id), client_id, contrato, regra, hours, calc, hourly_rate,
    entry_date: String(entry_date).slice(0, 10), description: desc, notes: notes || null,
    hora_inicial: hora_inicial || null, intervalo_inicio: intervalo_inicio || null,
    intervalo_fim: intervalo_fim || null, hora_final: hora_final || null,
    horas_desloc, despesas_desloc,
  }
}

// INSERT de um lançamento preparado. `id` explícito só no lote (ver lancarEmLote).
function inserirLancamento(sql, p, id = null) {
  return sql`
    INSERT INTO time_entries (
      id, company_id, client_id, contract_id, entry_date, description,
      hours, hourly_rate, gross_value, tax_amount,
      net_value, victor_share, fabricio_share, fuel_cost, notes,
      hora_inicial, intervalo_inicio, intervalo_fim, hora_final,
      horas_deslocamento, valor_deslocamento, despesas_deslocamento
    ) VALUES (
      COALESCE(${id}::int, nextval(pg_get_serial_sequence('time_entries', 'id'))),
      ${p.company_id}, ${p.client_id}, ${p.contrato.id}, ${p.entry_date}, ${p.description},
      ${p.hours}, ${p.hourly_rate}, ${p.calc.gross_value}, ${p.calc.tax_amount},
      ${p.calc.net_value}, ${p.calc.victor_share}, ${p.calc.fabricio_share},
      ${p.calc.fuel_cost}, ${p.notes},
      ${p.hora_inicial}, ${p.intervalo_inicio}, ${p.intervalo_fim}, ${p.hora_final},
      ${p.horas_desloc}, ${p.calc.valor_deslocamento || 0}, ${p.despesas_desloc}
    ) RETURNING id
  `
}

// POST { company_id, batch: [ { client_id, contract_id, entry_date, hora_*, ... } ] }
//
// Tudo ou nada: cada item passa por prepararLancamento (mesma validação e mesmo
// cálculo do individual); qualquer erro devolve 422 com a lista por data e nada é
// gravado. Os ids são reservados na sequence ANTES da transação — o driver do Neon
// não devolve RETURNING de dentro de sql.transaction em lote.
async function lancarEmLote(sql, req, res) {
  const { company_id, batch } = req.body || {}
  if (!EMPRESAS.includes(String(company_id))) return res.status(400).json({ error: 'company_id inválido (use 1 ou 2)' })
  if (!Array.isArray(batch) || batch.length === 0) return res.status(400).json({ error: 'Lote vazio.' })
  if (batch.length > LIMITE_LOTE) return res.status(400).json({ error: `Lote acima do limite de ${LIMITE_LOTE} itens (${batch.length}).` })

  const preparados = []
  const errors = []
  for (const item of batch) {
    // company_id do item é ignorado: o lote inteiro é da empresa do corpo.
    const prep = await prepararLancamento(sql, item, company_id)
    if (prep.error) errors.push({ entry_date: item?.entry_date || null, error: prep.error })
    else preparados.push(prep)
  }
  if (errors.length) return res.status(422).json({ error: `${errors.length} item(ns) inválido(s); nada foi gravado.`, errors, ids: [] })

  const seq = await sql`SELECT nextval(pg_get_serial_sequence('time_entries', 'id'))::int AS id FROM generate_series(1, ${preparados.length})`
  const ids = seq.map(r => r.id)
  try {
    await sql.transaction(preparados.map((p, i) => inserirLancamento(sql, p, ids[i])))
  } catch (e) {
    return res.status(500).json({ error: `Falha ao gravar o lote; nada foi gravado. ${e.message}`, errors: [], ids: [] })
  }

  // Diária: cada (contrato, data) tocado recalcula as cotas — o mesmo passo do POST
  // individual. Fora da transação, como lá: as OS já existem quando a cota é dividida.
  const tocados = new Map(preparados.map(p => [`${p.contrato.id}|${p.entry_date}`, p]))
  for (const p of tocados.values()) await recalcularDia(sql, p.contrato.id, p.entry_date)

  return res.status(201).json({ ids, errors: [], created: ids.length })
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  const sql = neon(process.env.DATABASE_URL)

  if (req.method === 'GET') {
    const { company_id, month, year } = req.query
    // company_id é explícito (o calendário lê a OUTRA empresa para marcar dias
    // ocupados), então só aceita as duas empresas que existem.
    if (!['1', '2'].includes(String(company_id))) {
      return res.status(400).json({ error: 'company_id inválido (use 1 ou 2)' })
    }
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
    if (req.query?.action === 'batch' || Array.isArray(req.body?.batch)) {
      return lancarEmLote(sql, req, res)
    }
    const prep = await prepararLancamento(sql, req.body, req.body?.company_id)
    if (prep.error) return res.status(prep.status || 422).json({ error: prep.error })

    const [inserido] = await inserirLancamento(sql, prep)
    // Diária: a OS nova muda a cota das irmãs da mesma data (e a dela mesma).
    await recalcularDia(sql, prep.contrato.id, prep.entry_date)
    const [entry] = await sql`SELECT * FROM time_entries WHERE id = ${inserido.id}`
    return res.status(201).json({ entry, hours_calculated: prep.hours })
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
