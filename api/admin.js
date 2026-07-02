import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { action } = req.query
  const sql = neon(process.env.DATABASE_URL)

  try {
    if (action === 'setup-db') {
      await sql`
        CREATE TABLE IF NOT EXISTS companies (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          color VARCHAR(20),
          created_at TIMESTAMP DEFAULT NOW()
        )
      `
      await sql`
        CREATE TABLE IF NOT EXISTS clients (
          id SERIAL PRIMARY KEY,
          company_id INTEGER REFERENCES companies(id),
          name VARCHAR(150) NOT NULL,
          email_domain VARCHAR(100),
          created_at TIMESTAMP DEFAULT NOW()
        )
      `
      await sql`
        CREATE TABLE IF NOT EXISTS projects (
          id SERIAL PRIMARY KEY,
          company_id INTEGER REFERENCES companies(id),
          client_id INTEGER REFERENCES clients(id),
          name VARCHAR(150) NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `
      await sql`
        CREATE TABLE IF NOT EXISTS email_rules (
          id SERIAL PRIMARY KEY,
          company_id INTEGER REFERENCES companies(id),
          rule_type VARCHAR(50) NOT NULL,
          rule_value VARCHAR(200) NOT NULL,
          target_client_id INTEGER REFERENCES clients(id),
          target_project_id INTEGER REFERENCES projects(id),
          created_at TIMESTAMP DEFAULT NOW()
        )
      `
      await sql`
        CREATE TABLE IF NOT EXISTS demands (
          id SERIAL PRIMARY KEY,
          company_id INTEGER REFERENCES companies(id),
          client_id INTEGER REFERENCES clients(id),
          project_id INTEGER REFERENCES projects(id),
          sender_email VARCHAR(200),
          sender_name VARCHAR(150),
          subject VARCHAR(500),
          body TEXT,
          received_at TIMESTAMP,
          status VARCHAR(50) DEFAULT 'nova',
          origin VARCHAR(20) DEFAULT 'email',
          created_at TIMESTAMP DEFAULT NOW()
        )
      `
      await sql`
        CREATE TABLE IF NOT EXISTS time_entries (
          id SERIAL PRIMARY KEY,
          company_id INTEGER REFERENCES companies(id),
          client_id INTEGER REFERENCES clients(id),
          project_id INTEGER REFERENCES projects(id),
          entry_date DATE NOT NULL,
          description TEXT,
          hours NUMERIC(5,2) NOT NULL,
          hourly_rate NUMERIC(10,2),
          gross_value NUMERIC(10,2),
          tax_amount NUMERIC(10,2),
          net_value NUMERIC(10,2),
          victor_share NUMERIC(10,2),
          fabricio_share NUMERIC(10,2),
          fuel_cost NUMERIC(10,2),
          notes TEXT,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `
      await sql`
        CREATE TABLE IF NOT EXISTS financial_rules (
          id SERIAL PRIMARY KEY,
          project_id INTEGER REFERENCES projects(id),
          hourly_rate NUMERIC(10,2),
          has_tax BOOLEAN DEFAULT false,
          tax_percentage NUMERIC(5,2),
          victor_fixed_per_hour NUMERIC(10,2),
          has_fuel BOOLEAN DEFAULT false,
          fuel_value NUMERIC(10,2),
          remainder_victor_pct NUMERIC(5,2),
          remainder_fabricio_pct NUMERIC(5,2),
          created_at TIMESTAMP DEFAULT NOW()
        )
      `
      await sql`
        CREATE TABLE IF NOT EXISTS monthly_closings (
          id SERIAL PRIMARY KEY,
          company_id INTEGER REFERENCES companies(id),
          month INTEGER NOT NULL,
          year INTEGER NOT NULL,
          total_gross NUMERIC(10,2),
          total_tax NUMERIC(10,2),
          total_victor NUMERIC(10,2),
          total_fabricio NUMERIC(10,2),
          total_fuel NUMERIC(10,2),
          status VARCHAR(30) DEFAULT 'aberto',
          closed_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `
      await sql`
        CREATE TABLE IF NOT EXISTS payments (
          id SERIAL PRIMARY KEY,
          closing_id INTEGER REFERENCES monthly_closings(id),
          amount NUMERIC(10,2) NOT NULL,
          paid_at DATE,
          payment_method VARCHAR(50),
          is_compensation BOOLEAN DEFAULT false,
          reference_month INTEGER,
          reference_year INTEGER,
          notes TEXT,
          status VARCHAR(20) DEFAULT 'pendente',
          created_at TIMESTAMP DEFAULT NOW()
        )
      `
      await sql`
        INSERT INTO companies (name, color) VALUES
          ('Lumen', '#3B82F6'),
          ('Imperium', '#8B5CF6')
        ON CONFLICT DO NOTHING
      `
      return res.status(200).json({ success: true, message: 'Banco criado com sucesso' })
    }

    if (action === 'setup-clients') {
      const clientsData = [
        { name: 'Braga', domains: ['bragacont.com.br'] },
        { name: 'Dental', domains: ['higimaster.com.br', 'dentalclean.com.br'] },
        { name: 'The Best Açaí', domains: ['ogrupothebest.com'] },
        { name: 'Ucelo', domains: ['ucelo.com.br'] },
        { name: 'Bokada', domains: ['bokada.com.br'] },
        { name: 'Sunstar', domains: ['sunstar.com'] },
      ]

      for (const client of clientsData) {
        const existing = await sql`
          SELECT id FROM clients
          WHERE company_id = 2 AND name = ${client.name}
          LIMIT 1
        `
        let clientId
        if (existing.length > 0) {
          clientId = existing[0].id
        } else {
          const result = await sql`
            INSERT INTO clients (company_id, name, email_domain)
            VALUES (2, ${client.name}, ${client.domains[0]})
            RETURNING *
          `
          clientId = result[0].id
        }
        for (const domain of client.domains) {
          const existingRule = await sql`
            SELECT id FROM email_rules
            WHERE company_id = 2 AND rule_type = 'domain' AND rule_value = ${domain}
            LIMIT 1
          `
          if (existingRule.length === 0) {
            await sql`
              INSERT INTO email_rules (company_id, rule_type, rule_value, target_client_id)
              VALUES (2, 'domain', ${domain}, ${clientId})
            `
          }
        }
      }

      const allClients = await sql`SELECT * FROM clients WHERE company_id = 2`
      const allRules = await sql`SELECT * FROM email_rules WHERE company_id = 2`
      return res.status(200).json({ success: true, clients: allClients, rules: allRules })
    }

    if (action === 'migrate-financial-rules') {
      await sql`ALTER TABLE financial_rules ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id)`
      await sql`ALTER TABLE financial_rules DROP CONSTRAINT IF EXISTS financial_rules_project_id_fkey`
      return res.status(200).json({ success: true, message: 'migrate-financial-rules OK' })
    }

    if (action === 'migrate-time-entries') {
      await sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS hora_inicial VARCHAR(5)`
      await sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS intervalo_inicio VARCHAR(5)`
      await sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS intervalo_fim VARCHAR(5)`
      await sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS hora_final VARCHAR(5)`
      await sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS horas_deslocamento NUMERIC(5,2) DEFAULT 0`
      await sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS valor_deslocamento NUMERIC(10,2) DEFAULT 0`
      return res.status(200).json({ success: true, message: 'migrate-time-entries OK' })
    }

    if (action === 'migrate-displacement-hours') {
      await sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS displacement_hours NUMERIC(5,2) DEFAULT 0`
      return res.status(200).json({ success: true, message: 'migrate-displacement-hours OK' })
    }

    if (action === 'migrate-etapa6') {
      await sql`
        CREATE TABLE IF NOT EXISTS contracts (
          id SERIAL PRIMARY KEY,
          company_id INTEGER REFERENCES companies(id),
          client_id INTEGER REFERENCES clients(id),
          name VARCHAR(200) NOT NULL,
          billing_type VARCHAR(20) DEFAULT 'contract',
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
      return res.status(200).json({ success: true, message: 'migrate-etapa6 OK' })
    }

    return res.status(400).json({ error: 'action inválida' })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
}
