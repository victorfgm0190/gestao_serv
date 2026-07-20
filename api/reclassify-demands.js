import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { company_id } = req.body
  if (!company_id) return res.status(400).json({ error: 'company_id obrigatório' })

  const sql = neon(process.env.DATABASE_URL)

  const rules = await sql`
    SELECT * FROM email_rules WHERE company_id = ${company_id}
  `

  const demands = await sql`
    SELECT id, sender_email FROM demands
    WHERE company_id = ${company_id} AND client_id IS NULL
  `

  let updated = 0

  for (const demand of demands) {
    const senderDomain = (demand.sender_email || '').split('@')[1] || ''
    let client_id = null

    for (const rule of rules) {
      if (rule.rule_type === 'domain' && senderDomain === rule.rule_value) {
        client_id = rule.target_client_id
        break
      }
      if (rule.rule_type === 'email' && demand.sender_email === rule.rule_value) {
        client_id = rule.target_client_id
        break
      }
    }

    if (client_id) {
      await sql`
        UPDATE demands SET client_id = ${client_id}
        WHERE id = ${demand.id}
      `
      updated++
    }
  }

  return res.status(200).json({ success: true, updated })
}
