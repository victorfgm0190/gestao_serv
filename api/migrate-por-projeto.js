import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const sql = neon(process.env.DATABASE_URL)
  try {
    // billing_type é varchar livre (sem CHECK/enum) — 'por_projeto' passa a ser
    // aceito sem alteração de constraint. Só os parâmetros do split são novos.
    await sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS projeto_split_mode VARCHAR(20) DEFAULT 'direct_split'`
    await sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS projeto_victor_pct NUMERIC(5,2) DEFAULT 0`
    await sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS projeto_victor_fixed NUMERIC(10,2) DEFAULT 0`
    await sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS projeto_expenses NUMERIC(10,2) DEFAULT 0`

    // Regras financeiras passam a ter tipo ('hora' | 'por_projeto'); as existentes são por hora.
    await sql`ALTER TABLE financial_rules ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) DEFAULT 'hora'`
    await sql`UPDATE financial_rules SET tipo = 'hora' WHERE tipo IS NULL`

    await sql`CREATE TABLE IF NOT EXISTS project_installments (
      id SERIAL PRIMARY KEY,
      contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
      installment_number INTEGER NOT NULL,
      description TEXT,
      value NUMERIC(10,2) NOT NULL,
      due_date DATE,
      status VARCHAR(20) DEFAULT 'pendente',
      invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )`
    await sql`CREATE INDEX IF NOT EXISTS idx_project_installments_contract ON project_installments (contract_id)`

    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'contracts' AND column_name LIKE 'projeto_%'
      ORDER BY column_name`

    res.status(200).json({
      success: true,
      message: 'Migração concluída.',
      contracts_columns: cols.map(c => c.column_name),
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}
