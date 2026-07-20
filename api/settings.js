import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'

// Configuração fiscal por empresa (regime, faturamento médio mensal, pró-labore,
// salários CLT, ISS). Alimenta a previsão de impostos da aba Pagar Victor. Upsert por company_id.
export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  const sql = neon(process.env.DATABASE_URL)

  if (req.method === 'GET') {
    const { company_id } = req.query
    if (!company_id) return res.status(400).json({ error: 'company_id é obrigatório' })
    const rows = await sql`
      SELECT * FROM company_settings WHERE company_id = ${company_id} LIMIT 1`
    return res.status(200).json({ data: rows[0] || null })
  }

  if (req.method === 'POST') {
    const { company_id, regime, faturamento_medio_mensal, prolabore_mensal, salarios_mensal, iss_percent } = req.body
    if (!company_id) return res.status(400).json({ error: 'company_id é obrigatório' })
    const rows = await sql`
      INSERT INTO company_settings
        (company_id, regime, faturamento_medio_mensal, prolabore_mensal, salarios_mensal, iss_percent, updated_at)
      VALUES
        (${company_id}, ${regime || 'simples_iii'}, ${faturamento_medio_mensal || 0},
         ${prolabore_mensal || 0}, ${salarios_mensal || 0}, ${iss_percent ?? 5}, NOW())
      ON CONFLICT (company_id) DO UPDATE SET
        regime = EXCLUDED.regime,
        faturamento_medio_mensal = EXCLUDED.faturamento_medio_mensal,
        prolabore_mensal = EXCLUDED.prolabore_mensal,
        salarios_mensal = EXCLUDED.salarios_mensal,
        iss_percent = EXCLUDED.iss_percent,
        updated_at = NOW()
      RETURNING *`
    return res.status(200).json({ data: rows[0] })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
