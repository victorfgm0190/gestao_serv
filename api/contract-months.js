import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL)

  if (req.method === 'GET') {
    const { company_id, year } = req.query
    const months = await sql`
      SELECT cm.*, c.name as contract_name, cl.name as client_name
      FROM contract_months cm
      JOIN contracts c ON c.id = cm.contract_id
      JOIN clients cl ON cl.id = cm.client_id
      WHERE cm.company_id = ${company_id}
        AND cm.year = ${year}
      ORDER BY cm.month DESC, cl.name ASC
    `
    return res.status(200).json({ months })
  }

  if (req.method === 'POST') {
    const { company_id, contract_id, client_id, month, year, invoice_value, notes } = req.body
    try {
      const contracts = await sql`SELECT * FROM contracts WHERE id = ${contract_id} LIMIT 1`
      if (!contracts.length) return res.status(404).json({ error: 'Contrato não encontrado' })
      const c = contracts[0]
      const base = parseFloat(c.contract_value) || 0
      const imposto_pct = c.has_tax ? (parseFloat(c.tax_percentage) || 0) / 100 : 0
      const inv = parseFloat(invoice_value) || base
      const tax = base * imposto_pct
      const net = base - tax
      const victor_fixo = parseFloat(c.victor_fixed) || 0
      const restante = Math.max(net - victor_fixo, 0)
      const victor_lucro = restante * (parseFloat(c.remainder_victor_pct) || 50) / 100
      const fabricio = restante * (parseFloat(c.remainder_fabricio_pct) || 50) / 100
      const diff = inv - base
      const victor_total = victor_fixo + victor_lucro + diff

      const result = await sql`
        INSERT INTO contract_months (contract_id, company_id, client_id, month, year, invoice_value, contract_value, victor_share, fabricio_share, tax_amount, net_value, notes)
        VALUES (${contract_id}, ${company_id}, ${client_id}, ${month}, ${year}, ${inv}, ${base}, ${parseFloat(victor_total.toFixed(2))}, ${parseFloat(fabricio.toFixed(2))}, ${parseFloat(tax.toFixed(2))}, ${parseFloat(net.toFixed(2))}, ${notes || null})
        RETURNING *
      `
      return res.status(201).json({ month: result[0] })
    } catch (error) {
      return res.status(500).json({ error: error.message })
    }
  }

  if (req.method === 'DELETE') {
    const { id } = req.body
    await sql`DELETE FROM contract_months WHERE id = ${id}`
    return res.status(200).json({ success: true })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
