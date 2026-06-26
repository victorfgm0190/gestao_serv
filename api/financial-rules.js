import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL)

  if (req.method === 'GET') {
    const { company_id } = req.query
    const rules = await sql`
      SELECT fr.*, c.name as client_name
      FROM financial_rules fr
      JOIN clients c ON c.id = fr.client_id
      WHERE c.company_id = ${company_id}
      ORDER BY c.name ASC
    `
    return res.status(200).json({ rules })
  }

  if (req.method === 'POST') {
    const {
      client_id, hourly_rate, has_tax, tax_percentage,
      victor_fixed_per_hour, has_fuel, fuel_value,
      remainder_victor_pct, remainder_fabricio_pct,
    } = req.body

    if (!client_id) return res.status(400).json({ error: 'client_id obrigatório' })

    try {
      const result = await sql`
        INSERT INTO financial_rules (
          client_id, hourly_rate, has_tax, tax_percentage,
          victor_fixed_per_hour, has_fuel, fuel_value,
          remainder_victor_pct, remainder_fabricio_pct
        ) VALUES (
          ${client_id},
          ${hourly_rate || null},
          ${has_tax || false},
          ${tax_percentage || null},
          ${victor_fixed_per_hour || null},
          ${has_fuel || false},
          ${fuel_value || null},
          ${remainder_victor_pct || 50},
          ${remainder_fabricio_pct || 50}
        ) RETURNING *
      `
      return res.status(201).json({ rule: result[0] })
    } catch (error) {
      return res.status(500).json({ error: error.message })
    }
  }

  if (req.method === 'PUT') {
    const { id } = req.query
    const {
      client_id, hourly_rate, has_tax, tax_percentage,
      victor_fixed_per_hour, has_fuel, fuel_value,
      remainder_victor_pct, remainder_fabricio_pct,
    } = req.body

    if (!id) return res.status(400).json({ error: 'id obrigatório' })
    if (!client_id) return res.status(400).json({ error: 'client_id obrigatório' })

    try {
      const result = await sql`
        UPDATE financial_rules SET
          client_id = ${client_id},
          hourly_rate = ${hourly_rate || null},
          has_tax = ${has_tax || false},
          tax_percentage = ${tax_percentage || null},
          victor_fixed_per_hour = ${victor_fixed_per_hour || null},
          has_fuel = ${has_fuel || false},
          fuel_value = ${fuel_value || null},
          remainder_victor_pct = ${remainder_victor_pct || 50},
          remainder_fabricio_pct = ${remainder_fabricio_pct || 50}
        WHERE id = ${id}
        RETURNING *
      `
      if (result.length === 0) return res.status(404).json({ error: 'Regra não encontrada' })
      return res.status(200).json({ rule: result[0] })
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
