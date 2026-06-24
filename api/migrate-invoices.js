import { neon } from '@neondatabase/serverless'
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const sql = neon(process.env.DATABASE_URL)
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS invoices (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id),
        client_id INTEGER REFERENCES clients(id),
        contract_id INTEGER REFERENCES contracts(id),
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        invoice_number VARCHAR(50),
        invoice_value NUMERIC(10,2) NOT NULL,
        contract_value NUMERIC(10,2),
        tax_amount NUMERIC(10,2) DEFAULT 0,
        victor_service NUMERIC(10,2) DEFAULT 0,
        victor_profit NUMERIC(10,2) DEFAULT 0,
        victor_tax_diff NUMERIC(10,2) DEFAULT 0,
        victor_total NUMERIC(10,2) DEFAULT 0,
        fabricio_total NUMERIC(10,2) DEFAULT 0,
        billing_type VARCHAR(20) DEFAULT 'contract',
        time_entry_ids INTEGER[],
        receivable_id INTEGER,
        status VARCHAR(20) DEFAULT 'pendente',
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `
    res.status(200).json({ success: true, message: 'Tabela invoices criada' })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}
