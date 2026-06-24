import { neon } from '@neondatabase/serverless'

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

function calcular(horas, regra, horas_deslocamento = 0, contrato = null, despesas_deslocamento = 0) {
  const hours = parseFloat(horas) || 0
  const horas_desloc = parseFloat(horas_deslocamento) || 0
  const despesas_desloc = parseFloat(despesas_deslocamento) || 0
  const horas_trabalho = Math.max(hours - horas_desloc, 0)
  const valor_hora = parseFloat(regra.hourly_rate) || 0
  const imposto_pct = regra.has_tax ? (parseFloat(regra.tax_percentage) || 0) / 100 : 0
  const gross = hours * valor_hora
  const tax = gross * imposto_pct
  const net = gross - tax
  const valor_hora_liq = valor_hora * (1 - imposto_pct)

  // Deslocamento (configurado no contrato do cliente)
  const deslocamento_tipo = contrato?.deslocamento_tipo || 'nao_cobrado'
  const deslocamento_valor_hora = parseFloat(contrato?.deslocamento_valor_hora) || 0
  let victor_desloc = 0
  let victor_desloc_despesas = 0
  if (deslocamento_tipo === 'nao_cobrado') {
    victor_desloc = horas_desloc * valor_hora_liq  // líquido, fora do split
  } else if (deslocamento_tipo === 'hora') {
    victor_desloc = horas_desloc * (deslocamento_valor_hora || valor_hora_liq)
  } else if (deslocamento_tipo === 'hora_despesas') {
    victor_desloc = horas_desloc * (deslocamento_valor_hora || valor_hora_liq)
    victor_desloc_despesas = despesas_desloc
  }

  // Split só sobre horas de trabalho
  const victor_fixo = parseFloat(regra.victor_fixed_per_hour) || 0
  const victor_servico = horas_trabalho * victor_fixo
  const restante = Math.max(net - victor_desloc - victor_servico, 0)
  const victor_lucro = restante * (parseFloat(regra.remainder_victor_pct) || 50) / 100
  const fabricio = restante * (parseFloat(regra.remainder_fabricio_pct) || 50) / 100
  const victor_total = victor_desloc + victor_desloc_despesas + victor_servico + victor_lucro
  return {
    gross_value: parseFloat(gross.toFixed(2)),
    tax_amount: parseFloat(tax.toFixed(2)),
    net_value: parseFloat(net.toFixed(2)),
    victor_share: parseFloat(victor_total.toFixed(2)),
    fabricio_share: parseFloat(fabricio.toFixed(2)),
    fuel_cost: 0,
    valor_deslocamento: parseFloat((victor_desloc + victor_desloc_despesas).toFixed(2)),
  }
}

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL)

  if (req.method === 'GET') {
    const { company_id, month, year } = req.query
    if (month && year) {
      const entries = await sql`
        SELECT te.*, c.name as client_name
        FROM time_entries te
        LEFT JOIN clients c ON c.id = te.client_id
        WHERE te.company_id = ${company_id}
          AND EXTRACT(MONTH FROM te.entry_date) = ${month}
          AND EXTRACT(YEAR FROM te.entry_date) = ${year}
        ORDER BY te.entry_date DESC
      `
      return res.status(200).json({ entries })
    }
    const entries = await sql`
      SELECT te.*, c.name as client_name
      FROM time_entries te
      LEFT JOIN clients c ON c.id = te.client_id
      WHERE te.company_id = ${company_id}
      ORDER BY te.entry_date DESC
    `
    return res.status(200).json({ entries })
  }

  if (req.method === 'POST') {
    const {
      company_id, client_id, entry_date,
      description, hours_fuel, despesas_deslocamento, notes,
      hora_inicial, intervalo_inicio, intervalo_fim, hora_final,
    } = req.body

    const hours = calcularHoras(hora_inicial, intervalo_inicio, intervalo_fim, hora_final)

    const regras = await sql`
      SELECT * FROM financial_rules WHERE client_id = ${client_id} LIMIT 1
    `
    const contratos = await sql`
      SELECT * FROM contracts WHERE client_id = ${client_id} ORDER BY is_active DESC, created_at DESC LIMIT 1
    `
    const contrato = contratos[0] || null

    const horas_desloc = parseFloat(hours_fuel) || 0
    const despesas_desloc = parseFloat(despesas_deslocamento) || 0

    let calc = {
      gross_value: null, tax_amount: null, net_value: null,
      victor_share: null, fabricio_share: null, fuel_cost: null, valor_deslocamento: 0
    }

    if (regras.length > 0 && hours > 0) {
      calc = calcular(hours, regras[0], horas_desloc, contrato, despesas_desloc)
    }

    const hourly_rate = regras[0]?.hourly_rate || null

    const result = await sql`
      INSERT INTO time_entries (
        company_id, client_id, entry_date, description,
        hours, hourly_rate, gross_value, tax_amount,
        net_value, victor_share, fabricio_share, fuel_cost, notes,
        hora_inicial, intervalo_inicio, intervalo_fim, hora_final,
        horas_deslocamento, valor_deslocamento, despesas_deslocamento
      ) VALUES (
        ${company_id}, ${client_id}, ${entry_date}, ${description},
        ${hours}, ${hourly_rate}, ${calc.gross_value}, ${calc.tax_amount},
        ${calc.net_value}, ${calc.victor_share}, ${calc.fabricio_share},
        ${calc.fuel_cost}, ${notes},
        ${hora_inicial || null}, ${intervalo_inicio || null},
        ${intervalo_fim || null}, ${hora_final || null},
        ${horas_desloc}, ${calc.valor_deslocamento || 0}, ${despesas_desloc}
      ) RETURNING *
    `
    return res.status(201).json({ entry: result[0], hours_calculated: hours })
  }

  if (req.method === 'PUT') {
    const {
      id, client_id, entry_date, description,
      hora_inicial, intervalo_inicio, intervalo_fim, hora_final,
      hours_fuel, despesas_deslocamento, notes
    } = req.body

    const hours = calcularHoras(hora_inicial, intervalo_inicio, intervalo_fim, hora_final)
    const regras = await sql`SELECT * FROM financial_rules WHERE client_id = ${client_id} LIMIT 1`
    const contratos = await sql`SELECT * FROM contracts WHERE client_id = ${client_id} ORDER BY is_active DESC, created_at DESC LIMIT 1`
    const contrato = contratos[0] || null

    const horas_desloc = parseFloat(hours_fuel) || 0
    const despesas_desloc = parseFloat(despesas_deslocamento) || 0

    let calc = { gross_value: null, tax_amount: null, net_value: null, victor_share: null, fabricio_share: null, fuel_cost: null, valor_deslocamento: 0 }
    if (regras.length > 0 && hours > 0) {
      calc = calcular(hours, regras[0], horas_desloc, contrato, despesas_desloc)
    }

    const hourly_rate = regras[0]?.hourly_rate || null

    const result = await sql`
      UPDATE time_entries SET
        client_id = ${client_id},
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
    return res.status(200).json({ entry: result[0] })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body
    await sql`DELETE FROM time_entries WHERE id = ${id}`
    return res.status(200).json({ success: true })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
