import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const sql = neon(process.env.DATABASE_URL)

  try {
    // Inserir clientes da Imperium (company_id = 2)
    await sql`
      INSERT INTO clients (company_id, name, email_domain) VALUES
        (2, 'Braga', 'bragacont.com.br'),
        (2, 'Dental', 'higimaster.com.br'),
        (2, 'Dental', 'dentalclean.com.br'),
        (2, 'The Best Açaí', 'ogrupothebest.com'),
        (2, 'Ucelo', 'ucelo.com.br'),
        (2, 'Bokada', 'bokada.com.br'),
        (2, 'Sunstar', 'sunstar.com')
      ON CONFLICT DO NOTHING
    `

    // Buscar os clientes recém criados
    const clients = await sql`SELECT * FROM clients WHERE company_id = 2`

    // Criar regras de domínio para cada cliente
    for (const client of clients) {
      if (!client.email_domain) continue
      await sql`
        INSERT INTO email_rules (company_id, rule_type, rule_value, target_client_id)
        VALUES (2, 'domain', ${client.email_domain}, ${client.id})
        ON CONFLICT DO NOTHING
      `
    }

    res.status(200).json({ success: true, clients })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}
