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

  // PATCH: atualização parcial — só mexe nos campos enviados (COALESCE mantém o resto).
  // Usado pela auto-atualização do pró-labore no faturamento, sem sobrescrever
  // regime, salários ou ISS já cadastrados.
  if (req.method === 'PATCH') {
    const { company_id, regime, faturamento_medio_mensal, prolabore_mensal, salarios_mensal, iss_percent } = req.body
    if (!company_id) return res.status(400).json({ error: 'company_id é obrigatório' })
    const rows = await sql`
      UPDATE company_settings SET
        regime = COALESCE(${regime ?? null}, regime),
        faturamento_medio_mensal = COALESCE(${faturamento_medio_mensal ?? null}, faturamento_medio_mensal),
        prolabore_mensal = COALESCE(${prolabore_mensal ?? null}, prolabore_mensal),
        salarios_mensal = COALESCE(${salarios_mensal ?? null}, salarios_mensal),
        iss_percent = COALESCE(${iss_percent ?? null}, iss_percent),
        updated_at = NOW()
      WHERE company_id = ${company_id}
      RETURNING *`
    if (!rows.length) {
      // Sem linha ainda: cria com os campos enviados; os demais caem no default da tabela.
      const created = await sql`
        INSERT INTO company_settings
          (company_id, regime, faturamento_medio_mensal, prolabore_mensal, salarios_mensal, iss_percent, updated_at)
        VALUES
          (${company_id}, ${regime || 'simples_iii'}, ${faturamento_medio_mensal || 0},
           ${prolabore_mensal || 0}, ${salarios_mensal || 0}, ${iss_percent ?? 5}, NOW())
        RETURNING *`
      return res.status(200).json({ data: created[0] })
    }
    return res.status(200).json({ data: rows[0] })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
