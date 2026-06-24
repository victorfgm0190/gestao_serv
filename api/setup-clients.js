import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const sql = neon(process.env.DATABASE_URL)
  try {
    const clientsData = [
      { name: 'Braga', domains: ['bragacont.com.br'] },
      { name: 'Dental', domains: ['higimaster.com.br', 'dentalclean.com.br'] },
      { name: 'The Best Açaí', domains: ['ogrupothebest.com'] },
      { name: 'Ucelo', domains: ['ucelo.com.br'] },
      { name: 'Bokada', domains: ['bokada.com.br'] },
      { name: 'Sunstar', domains: ['sunstar.com'] },
    ]
    const insertedClients = []
    for (const client of clientsData) {
      const existing = await sql`SELECT id FROM clients WHERE company_id = 2 AND name = ${client.name} LIMIT 1`
      let clientId
      if (existing.length > 0) { clientId = existing[0].id }
      else {
        const result = await sql`INSERT INTO clients (company_id, name, email_domain) VALUES (2, ${client.name}, ${client.domains[0]}) RETURNING *`
        clientId = result[0].id
        insertedClients.push(result[0])
      }
      for (const domain of client.domains) {
        const existingRule = await sql`SELECT id FROM email_rules WHERE company_id = 2 AND rule_type = 'domain' AND rule_value = ${domain} LIMIT 1`
        if (existingRule.length === 0) {
          await sql`INSERT INTO email_rules (company_id, rule_type, rule_value, target_client_id) VALUES (2, 'domain', ${domain}, ${clientId})`
        }
      }
    }
    const allClients = await sql`SELECT * FROM clients WHERE company_id = 2`
    res.status(200).json({ success: true, clients: allClients })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}
