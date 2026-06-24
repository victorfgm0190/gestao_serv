import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const sql = neon(process.env.DATABASE_URL)
  try {
    await sql`CREATE TABLE IF NOT EXISTS companies (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, color VARCHAR(20), created_at TIMESTAMP DEFAULT NOW())`
    await sql`CREATE TABLE IF NOT EXISTS clients (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id), name VARCHAR(150) NOT NULL, email_domain VARCHAR(100), created_at TIMESTAMP DEFAULT NOW())`
    await sql`CREATE TABLE IF NOT EXISTS projects (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id), client_id INTEGER REFERENCES clients(id), name VARCHAR(150) NOT NULL, created_at TIMESTAMP DEFAULT NOW())`
    await sql`CREATE TABLE IF NOT EXISTS email_rules (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id), rule_type VARCHAR(50) NOT NULL, rule_value VARCHAR(200) NOT NULL, target_client_id INTEGER REFERENCES clients(id), target_project_id INTEGER REFERENCES projects(id), created_at TIMESTAMP DEFAULT NOW())`
    await sql`CREATE TABLE IF NOT EXISTS demands (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id), client_id INTEGER REFERENCES clients(id), project_id INTEGER REFERENCES projects(id), sender_email VARCHAR(200), sender_name VARCHAR(150), subject VARCHAR(500), body TEXT, received_at TIMESTAMP, status VARCHAR(50) DEFAULT 'nova', origin VARCHAR(20) DEFAULT 'email', created_at TIMESTAMP DEFAULT NOW())`
    await sql`CREATE TABLE IF NOT EXISTS time_entries (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id), client_id INTEGER REFERENCES clients(id), project_id INTEGER REFERENCES projects(id), entry_date DATE NOT NULL, description TEXT, hours NUMERIC(5,2) NOT NULL, hourly_rate NUMERIC(10,2), gross_value NUMERIC(10,2), tax_amount NUMERIC(10,2), net_value NUMERIC(10,2), victor_share NUMERIC(10,2), fabricio_share NUMERIC(10,2), fuel_cost NUMERIC(10,2), notes TEXT, created_at TIMESTAMP DEFAULT NOW())`
    await sql`CREATE TABLE IF NOT EXISTS financial_rules (id SERIAL PRIMARY KEY, project_id INTEGER, hourly_rate NUMERIC(10,2), has_tax BOOLEAN DEFAULT false, tax_percentage NUMERIC(5,2), victor_fixed_per_hour NUMERIC(10,2), has_fuel BOOLEAN DEFAULT false, fuel_value NUMERIC(10,2), remainder_victor_pct NUMERIC(5,2), remainder_fabricio_pct NUMERIC(5,2), created_at TIMESTAMP DEFAULT NOW())`
    await sql`CREATE TABLE IF NOT EXISTS monthly_closings (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id), month INTEGER NOT NULL, year INTEGER NOT NULL, total_gross NUMERIC(10,2), total_tax NUMERIC(10,2), total_victor NUMERIC(10,2), total_fabricio NUMERIC(10,2), total_fuel NUMERIC(10,2), status VARCHAR(30) DEFAULT 'aberto', closed_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())`
    await sql`CREATE TABLE IF NOT EXISTS payments (id SERIAL PRIMARY KEY, closing_id INTEGER REFERENCES monthly_closings(id), amount NUMERIC(10,2) NOT NULL, paid_at DATE, payment_method VARCHAR(50), is_compensation BOOLEAN DEFAULT false, reference_month INTEGER, reference_year INTEGER, notes TEXT, status VARCHAR(20) DEFAULT 'pendente', created_at TIMESTAMP DEFAULT NOW())`
    await sql`INSERT INTO companies (name, color) VALUES ('Lumen', '#3B82F6'), ('Imperium', '#8B5CF6') ON CONFLICT DO NOTHING`
    res.status(200).json({ success: true, message: 'Banco criado com sucesso' })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}
