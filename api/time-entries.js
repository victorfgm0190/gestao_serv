import { neon } from '@neondatabase/serverless'

function calcular(horas, regra, horas_deslocamento = 0) {
  const h = parseFloat(horas) || 0
  const hd = parseFloat(horas_deslocamento) || 0
  const valor_hora = parseFloat(regra.hourly_rate) || 0
  const imposto_pct = regra.has_tax ? (parseFloat(regra.tax_percentage) || 0) / 100 : 0
  const victor_fixo = parseFloat(regra.victor_fixed_per_hour) || 0
  const victor_pct = parseFloat(regra.remainder_victor_pct) || 0
  const fabricio_pct = parseFloat(regra.remainder_fabricio_pct) || 0
  const combustivel = regra.has_fuel ? (parseFloat(regra.fuel_value) || 0) : 0

  const horas_servico = h - hd
  const gross_value = h * valor_hora
  const tax_amount = gross_value * imposto_pct
  const net_value = gross_value - tax_amount

  const victor_deslocamento = hd * valor_hora * (1 - imposto_pct)
  const victor_servico = horas_servico * victor_fixo
  const restante = net_value - victor_deslocamento - victor_servico - combustivel
  const restante_positivo = Math.max(restante, 0)

  const victor_lucro = restante_positivo * (victor_pct / 100)
  const fabricio_share = restante_positivo * (fabricio_pct / 100)
  const victor_share = victor_deslocamento + victor_servico + victor_lucro

  return {
    gross_value: parseFloat(gross_value.toFixed(2)),
    tax_amount: parseFloat(tax_amount.toFixed(2)),
    net_value: parseFloat(net_value.toFixed(2)),
    victor_share: parseFloat(victor_share.toFixed(2)),
    fabricio_share: parseFloat(fabricio_share.toFixed(2)),
    fuel_cost: parseFloat(combustivel.toFixed(2)),
  }
}

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL)

  if (req.method === 'GET') {
    const { company_id, month, year } = req.query
    let query = sql`
      SELECT te.*, c.name as client_name
      FROM time_entries te
      LEFT JOIN clients c ON c.id = te.client_id
      WHERE te.company_id = ${company_id}
    `
    if (month && year) {
      query = sql`
        SELECT te.*, c.name as client_name
        FROM time_entries te
        LEFT JOIN clients c ON c.id = te.client_id
        WHERE te.company_id = ${company_id}
          AND EXTRACT(MONTH FROM te.entry_date) = ${month}
          AND EXTRACT(YEAR FROM te.entry_date) = ${year}
        ORDER BY te.entry_date DESC
      `
    }
    const entries = await query
    return res.status(200).json({ entries })
  }

  if (req.method === 'POST') {
    const {
      company_id, client_id, entry_date,
      description, hours, hours_fuel,
      hourly_rate, notes
    } = req.body

    const regras = await sql`
      SELECT * FROM financial_rules WHERE client_id = ${client_id} LIMIT 1
    `

    let calc = {
      gross_value: null, tax_amount: null, net_value: null,
      victor_share: null, fabricio_share: null, fuel_cost: null
    }

    const hr = hourly_rate || (regras[0]?.hourly_rate)

    if (regras.length > 0 && hr) {
      const regra = { ...regras[0], hourly_rate: hr }
      calc = calcular(hours, regra, hours_fuel || 0)
    }

    const result = await sql`
      INSERT INTO time_entries (
        company_id, client_id, entry_date, description,
        hours, hourly_rate, gross_value, tax_amount,
        net_value, victor_share, fabricio_share, fuel_cost, notes
      ) VALUES (
        ${company_id}, ${client_id}, ${entry_date}, ${description},
        ${hours}, ${hr}, ${calc.gross_value}, ${calc.tax_amount},
        ${calc.net_value}, ${calc.victor_share}, ${calc.fabricio_share},
        ${calc.fuel_cost}, ${notes}
      ) RETURNING *
    `
    return res.status(201).json({ entry: result[0] })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body
    await sql`DELETE FROM time_entries WHERE id = ${id}`
    return res.status(200).json({ success: true })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
