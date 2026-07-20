import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'

// Cria a tabela company_settings (configuração fiscal por empresa).
// Rodar uma vez após o deploy: POST /api/migrate-settings com o header Authorization.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!requireAuth(req, res)) return
  const sql = neon(process.env.DATABASE_URL)
  try {
    await sql`CREATE TABLE IF NOT EXISTS company_settings (
      id SERIAL PRIMARY KEY,
      company_id INTEGER UNIQUE NOT NULL,
      regime VARCHAR(30) DEFAULT 'simples_iii',
      faturamento_medio_mensal NUMERIC(14,2) DEFAULT 0,
      prolabore_mensal NUMERIC(10,2) DEFAULT 0,
      salarios_mensal NUMERIC(14,2) DEFAULT 0,
      iss_percent NUMERIC(5,2) DEFAULT 5,
      updated_at TIMESTAMP DEFAULT NOW()
    )`
    // Migração dos campos: substitui receita/folha 12 meses pelo faturamento
    // médio mensal + salários CLT (idempotente para tabelas já existentes).
    await sql`ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS faturamento_medio_mensal NUMERIC(14,2) DEFAULT 0`
    await sql`ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS salarios_mensal NUMERIC(14,2) DEFAULT 0`
    await sql`ALTER TABLE company_settings DROP COLUMN IF EXISTS receita_bruta_12m`
    await sql`ALTER TABLE company_settings DROP COLUMN IF EXISTS folha_12m`
    // Data de emissão da NF (separada da data prevista de recebimento).
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS emission_date DATE`
    res.status(200).json({ success: true, message: 'Tabela company_settings pronta.' })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}
