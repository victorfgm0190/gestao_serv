import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL)

  if (req.method === 'GET') {
    const { company_id, client_id } = req.query
    if (client_id) {
      const contracts = await sql`
        SELECT c.*, cl.name as client_name
        FROM contracts c
        JOIN clients cl ON cl.id = c.client_id
        WHERE c.client_id = ${client_id} AND c.is_active = true
        ORDER BY c.id ASC
      `
      return res.status(200).json({ contracts })
    }
    const contracts = await sql`
      SELECT c.*, cl.name as client_name
      FROM contracts c
      JOIN clients cl ON cl.id = c.client_id
      WHERE c.company_id = ${company_id}
      ORDER BY c.is_active DESC, cl.name ASC
    `
    return res.status(200).json({ contracts })
  }

  if (req.method === 'POST') {
    const { company_id, client_id, name, billing_type, contract_value, victor_fixed, remainder_victor_pct, remainder_fabricio_pct, has_tax, tax_percentage, notes, deslocamento_tipo, deslocamento_valor_hora, financial_rule_id } = req.body
    try {
      const result = await sql`
        INSERT INTO contracts (company_id, client_id, name, billing_type, contract_value, victor_fixed, remainder_victor_pct, remainder_fabricio_pct, has_tax, tax_percentage, notes, deslocamento_tipo, deslocamento_valor_hora, financial_rule_id)
        VALUES (${company_id}, ${client_id}, ${name}, ${billing_type || 'contract'}, ${contract_value}, ${victor_fixed}, ${remainder_victor_pct || 50}, ${remainder_fabricio_pct || 50}, ${has_tax || false}, ${tax_percentage || null}, ${notes || null}, ${deslocamento_tipo || 'nao_cobrado'}, ${deslocamento_valor_hora || 0}, ${financial_rule_id || null})
        RETURNING *
      `
      return res.status(201).json({ contract: result[0] })
    } catch (error) {
      return res.status(500).json({ error: error.message })
    }
  }

  if (req.method === 'PATCH') {
    const { id, ...fields } = req.body
    try {
      const result = await sql`
        UPDATE contracts SET
          name = ${fields.name},
          billing_type = ${fields.billing_type || 'mensal'},
          deslocamento_tipo = ${fields.deslocamento_tipo || 'nao_cobrado'},
          deslocamento_valor_hora = ${fields.deslocamento_valor_hora || 0},
          contract_value = ${fields.contract_value},
          victor_fixed = ${fields.victor_fixed},
          remainder_victor_pct = ${fields.remainder_victor_pct},
          remainder_fabricio_pct = ${fields.remainder_fabricio_pct},
          has_tax = ${fields.has_tax},
          tax_percentage = ${fields.tax_percentage},
          is_active = ${fields.is_active},
          financial_rule_id = ${fields.financial_rule_id || null},
          notes = ${fields.notes}
        WHERE id = ${id}
        RETURNING *
      `
      return res.status(200).json({ contract: result[0] })
    } catch (error) {
      return res.status(500).json({ error: error.message })
    }
  }

  if (req.method === 'DELETE') {
    const { id } = req.body
    await sql`DELETE FROM contracts WHERE id = ${id}`
    return res.status(200).json({ success: true })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
