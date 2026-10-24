import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import { TIPOS_COBRANCA, tipoDaRegra } from '../lib/billing-type.js'
import { recalcularDia } from './time-entries.js'

// Split cadastrado. Não usar `|| 50`: 0 é um split legítimo (cliente 100/0)
// e seria gravado como 50%.
function splitPct(value, fallback) {
  const n = parseFloat(value)
  return isNaN(n) ? fallback : n
}

const numOrNull = (v) => (v === '' || v == null || isNaN(parseFloat(v)) ? null : parseFloat(v))

// Normaliza e valida o corpo de POST/PUT. → { campos } | { error }
//
// `billing_type` é a fonte do tipo de cobrança; `tipo` (a coluna antiga, 'hora' |
// 'por_projeto') é gravado em espelho só para não envelhecer — ninguém deve lê-la.
function camposDaRegra(body) {
  const billing_type = body.billing_type || (body.tipo === 'por_projeto' ? 'projeto' : body.tipo) || 'hora'
  if (!TIPOS_COBRANCA.includes(billing_type)) {
    return { error: `Tipo de cobrança inválido: "${billing_type}". Use ${TIPOS_COBRANCA.join(', ')}.` }
  }
  const vPct = splitPct(body.remainder_victor_pct, 50)
  const fPct = splitPct(body.remainder_fabricio_pct, 50)
  if (Math.abs(vPct + fPct - 100) > 0.001) {
    return { error: `% Victor + % Fabrício precisa somar 100% (está ${vPct + fPct}%).` }
  }
  const valor = { hora: body.hourly_rate, diaria: body.daily_rate, projeto: body.monthly_fixed_value }[billing_type]
  if (!(parseFloat(valor) > 0)) {
    const rotulo = { hora: 'Valor hora', diaria: 'Valor da diária', projeto: 'Valor fixo mensal' }[billing_type]
    return { error: `${rotulo} é obrigatório.` }
  }
  // NF digitada (arredondamento) — só existe no modo líquido de diária/projeto. Fora dele
  // é gravada NULL, para não sobreviver como valor fantasma a uma troca de tipo.
  const is_net_value = billing_type !== 'hora' && !!body.is_net_value
  const nf_value_override = is_net_value ? numOrNull(body.nf_value_override) : null
  if (nf_value_override != null && nf_value_override < parseFloat(valor) - 0.005) {
    return { error: `O valor da NF (R$ ${nf_value_override.toFixed(2)}) não pode ser menor que o líquido (R$ ${parseFloat(valor).toFixed(2)}).` }
  }
  return {
    campos: {
      billing_type,
      tipo: billing_type === 'projeto' ? 'por_projeto' : billing_type,
      hourly_rate: numOrNull(body.hourly_rate),
      victor_fixed_per_hour: numOrNull(body.victor_fixed_per_hour),
      daily_rate: numOrNull(body.daily_rate),
      victor_fixed_daily: numOrNull(body.victor_fixed_daily),
      monthly_fixed_value: numOrNull(body.monthly_fixed_value),
      victor_fixed_monthly: numOrNull(body.victor_fixed_monthly),
      // Valor líquido só existe para diária/projeto: por hora o imposto sempre sai do bruto.
      is_net_value,
      nf_value_override: nf_value_override != null && nf_value_override > 0 ? nf_value_override : null,
      has_tax: !!body.has_tax,
      tax_percentage: numOrNull(body.tax_percentage),
      has_fuel: !!body.has_fuel,
      fuel_value: numOrNull(body.fuel_value),
      remainder_victor_pct: vPct,
      remainder_fabricio_pct: fPct,
    },
  }
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  const sql = neon(process.env.DATABASE_URL)

  if (req.method === 'GET') {
    const { company_id, client_id } = req.query
    if (client_id) {
      const rules = await sql`
        SELECT fr.*, c.name as client_name
        FROM financial_rules fr
        JOIN clients c ON c.id = fr.client_id
        WHERE fr.client_id = ${client_id}
        ORDER BY fr.id ASC
      `
      return res.status(200).json({ rules })
    }
    const rules = await sql`
      SELECT fr.*, c.name as client_name
      FROM financial_rules fr
      JOIN clients c ON c.id = fr.client_id
      JOIN client_companies cc ON cc.client_id = c.id AND cc.company_id = ${company_id}
      ORDER BY c.name ASC
    `
    return res.status(200).json({ rules })
  }

  if (req.method === 'POST') {
    const { client_id } = req.body
    if (!client_id) return res.status(400).json({ error: 'client_id obrigatório' })
    const v = camposDaRegra(req.body)
    if (v.error) return res.status(422).json({ error: v.error })
    const c = v.campos

    try {
      const result = await sql`
        INSERT INTO financial_rules (
          client_id, billing_type, tipo, hourly_rate, victor_fixed_per_hour,
          daily_rate, victor_fixed_daily, monthly_fixed_value, victor_fixed_monthly, is_net_value,
          nf_value_override, has_tax, tax_percentage, has_fuel, fuel_value,
          remainder_victor_pct, remainder_fabricio_pct
        ) VALUES (
          ${client_id}, ${c.billing_type}, ${c.tipo}, ${c.hourly_rate}, ${c.victor_fixed_per_hour},
          ${c.daily_rate}, ${c.victor_fixed_daily}, ${c.monthly_fixed_value}, ${c.victor_fixed_monthly}, ${c.is_net_value},
          ${c.nf_value_override}, ${c.has_tax}, ${c.tax_percentage}, ${c.has_fuel}, ${c.fuel_value},
          ${c.remainder_victor_pct}, ${c.remainder_fabricio_pct}
        ) RETURNING *
      `
      return res.status(201).json({ rule: result[0] })
    } catch (error) {
      return res.status(500).json({ error: error.message })
    }
  }

  if (req.method === 'PUT') {
    const { id } = req.query
    const { client_id } = req.body
    if (!id) return res.status(400).json({ error: 'id obrigatório' })
    if (!client_id) return res.status(400).json({ error: 'client_id obrigatório' })
    const v = camposDaRegra(req.body)
    if (v.error) return res.status(422).json({ error: v.error })
    const c = v.campos

    // Faturas e apontamentos FATURADOS não são recalculados: os valores ficam congelados
    // na linha. Na diária, as OS ainda em aberto dos contratos desta regra são
    // regravadas (recalcularDia) — o valor delas é a cota da diária, e uma NF digitada
    // nova tem de chegar nelas. A resposta lista quais mudaram.
    try {
      const result = await sql`
        UPDATE financial_rules SET
          client_id = ${client_id},
          billing_type = ${c.billing_type},
          tipo = ${c.tipo},
          hourly_rate = ${c.hourly_rate},
          victor_fixed_per_hour = ${c.victor_fixed_per_hour},
          daily_rate = ${c.daily_rate},
          victor_fixed_daily = ${c.victor_fixed_daily},
          monthly_fixed_value = ${c.monthly_fixed_value},
          victor_fixed_monthly = ${c.victor_fixed_monthly},
          is_net_value = ${c.is_net_value},
          nf_value_override = ${c.nf_value_override},
          has_tax = ${c.has_tax},
          tax_percentage = ${c.tax_percentage},
          has_fuel = ${c.has_fuel},
          fuel_value = ${c.fuel_value},
          remainder_victor_pct = ${c.remainder_victor_pct},
          remainder_fabricio_pct = ${c.remainder_fabricio_pct}
        WHERE id = ${id}
        RETURNING *
      `
      if (result.length === 0) return res.status(404).json({ error: 'Regra não encontrada' })

      const recalculados = []
      if (tipoDaRegra(result[0]) === 'diaria') {
        const dias = await sql`
          SELECT DISTINCT te.contract_id, te.entry_date
          FROM time_entries te
          JOIN contracts ct ON ct.id = te.contract_id
          WHERE ct.financial_rule_id = ${id}
            AND NOT EXISTS (SELECT 1 FROM invoices i WHERE te.id = ANY(i.time_entry_ids))`
        for (const d of dias) recalculados.push(...await recalcularDia(sql, d.contract_id, d.entry_date))
      }
      return res.status(200).json({ rule: result[0], apontamentos_recalculados: recalculados })
    } catch (error) {
      return res.status(500).json({ error: error.message })
    }
  }

  if (req.method === 'DELETE') {
    const { id } = req.body
    await sql`DELETE FROM financial_rules WHERE id = ${id}`
    return res.status(200).json({ success: true })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
