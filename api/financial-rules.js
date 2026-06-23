import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL)

  if (req.method === 'GET') {
    const { company_id } = req.query
    const rules = await sql`
      SELECT fr.*, c.name as client_name
      FROM financial_rules fr
      JOIN clients c ON c.id = fr.project_id
      WHERE c.company_id = ${company_id}
      ORDER BY c.name ASC
    `
    return res.status(200).json({ rules })
  }

  if (req.method === 'POST') {
    const {
      client_id,
      hourly_rate,
      has_tax,
      tax_percentage,
      victor_fixed_per_hour,
      has_fuel,
      fuel_value,
      remainder_victor_pct,
      remainder_fabricio_pct,
      billing_type
    } = req.body

    const result = await sql`
      INSERT INTO financial_rules (
        project_id, hourly_rate, has_tax, tax_percentage,
        victor_fixed_per_hour, has_fuel, fuel_value,
        remainder_victor_pct, remainder_fabricio_pct
      ) VALUES (
        ${client_id}, ${hourly_rate}, ${has_tax}, ${tax_percentage},
        ${victor_fixed_per_hour}, ${has_fuel}, ${fuel_value},
        ${remainder_victor_pct}, ${remainder_fabricio_pct}
      ) RETURNING *
    `
    return res.status(201).json({ rule: result[0] })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body
    await sql`DELETE FROM financial_rules WHERE id = ${id}`
    return res.status(200).json({ success: true })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
