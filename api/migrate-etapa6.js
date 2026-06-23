import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const sql = neon(process.env.DATABASE_URL)
  try {
    // Tabela de contratos
    await sql`
      CREATE TABLE IF NOT EXISTS contracts (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id),
        client_id INTEGER REFERENCES clients(id),
        name VARCHAR(200) NOT NULL,
        billing_type VARCHAR(20) DEFAULT 'hourly',
        contract_value NUMERIC(10,2),
        victor_fixed NUMERIC(10,2),
        remainder_victor_pct NUMERIC(5,2) DEFAULT 50,
        remainder_fabricio_pct NUMERIC(5,2) DEFAULT 50,
        has_tax BOOLEAN DEFAULT false,
        tax_percentage NUMERIC(5,2),
        is_active BOOLEAN DEFAULT true,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `
    // Tabela de parcelas/ocorrências mensais do contrato
    await sql`
      CREATE TABLE IF NOT EXISTS contract_months (
        id SERIAL PRIMARY KEY,
        contract_id INTEGER REFERENCES contracts(id),
        company_id INTEGER REFERENCES companies(id),
        client_id INTEGER REFERENCES clients(id),
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        invoice_value NUMERIC(10,2),
        contract_value NUMERIC(10,2),
        victor_share NUMERIC(10,2),
        fabricio_share NUMERIC(10,2),
        tax_amount NUMERIC(10,2),
        net_value NUMERIC(10,2),
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `
    // Tabela contas a receber (clientes)
    await sql`
      CREATE TABLE IF NOT EXISTS receivables (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id),
        client_id INTEGER REFERENCES clients(id),
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        description VARCHAR(300),
        amount NUMERIC(10,2) NOT NULL,
        paid_amount NUMERIC(10,2) DEFAULT 0,
        paid_at DATE,
        status VARCHAR(20) DEFAULT 'pendente',
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `
    // Tabela contas a pagar Fabrício
    await sql`
      CREATE TABLE IF NOT EXISTS payables_fabricio (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id),
        client_id INTEGER REFERENCES clients(id),
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        description VARCHAR(300),
        amount NUMERIC(10,2) NOT NULL,
        paid_amount NUMERIC(10,2) DEFAULT 0,
        paid_at DATE,
        payment_method VARCHAR(50),
        is_compensation BOOLEAN DEFAULT false,
        compensation_notes TEXT,
        status VARCHAR(20) DEFAULT 'pendente',
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `
    // Tabela contas a pagar Victor
    await sql`
      CREATE TABLE IF NOT EXISTS payables_victor (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id),
        client_id INTEGER REFERENCES clients(id),
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        description VARCHAR(300),
        service_amount NUMERIC(10,2) DEFAULT 0,
        profit_amount NUMERIC(10,2) DEFAULT 0,
        total_amount NUMERIC(10,2),
        paid_amount NUMERIC(10,2) DEFAULT 0,
        paid_at DATE,
        status VARCHAR(20) DEFAULT 'pendente',
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `
    res.status(200).json({ success: true, message: 'Tabelas da etapa 6 criadas' })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}
