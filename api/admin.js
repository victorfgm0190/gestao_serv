import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  // Diagnóstico read-only (temporário): confere o mês de caixa dos registros nas 3 tabelas.
  if (req.method === 'GET' && req.query.action === 'check-cash-months') {
    const sql = neon(process.env.DATABASE_URL)
    // client | amount aproximado | competência (month/year). Tolerância ±1 no valor.
    const criteria = [
      { client: '%Bokada%',    amount: 765,      month: 1, year: 2026 },
      { client: '%Pharmalog%', amount: 9775,     month: 1, year: 2026 },
      { client: '%Bokada%',    amount: 722.5,    month: 2, year: 2026 },
      { client: '%Pharmalog%', amount: 12477.5,  month: 2, year: 2026 },
      { client: '%Atria%',     amount: 360,      month: 2, year: 2026 },
      { client: '%Bokada%',    amount: 850,      month: 3, year: 2026 },
      { client: '%Pharmalog%', amount: 5750,     month: 3, year: 2026 },
      { client: '%Atria%',     amount: 540,      month: 3, year: 2026 },
      { client: '%Bokada%',    amount: 680,      month: 4, year: 2026 },
      { client: '%Pharmalog%', amount: 920,      month: 4, year: 2026 },
      { client: '%Atria%',     amount: 540,      month: 4, year: 2026 },
      { client: '%Leil%',      amount: 6000,     month: 4, year: 2026 },
      { client: '%Bokada%',    amount: 1020,     month: 5, year: 2026 },
      { client: '%Pharmalog%', amount: 2932.5,   month: 5, year: 2026 },
      { client: '%Atria%',     amount: 855,      month: 5, year: 2026 },
      { client: '%Stel%',      amount: 1762.12,  month: 6, year: 2026 },
    ]
    try {
      const receivables = new Map()
      const payables_victor = new Map()
      const payables_fabricio = new Map()
      for (const cr of criteria) {
        const lo = cr.amount - 1, hi = cr.amount + 1
        const rec = await sql`
          SELECT r.id, c.name AS client_name, ROUND(r.amount::numeric, 2) AS amount, r.month, r.year, r.payment_month, r.payment_year
          FROM receivables r JOIN clients c ON c.id = r.client_id
          WHERE c.name ILIKE ${cr.client} AND r.month = ${cr.month} AND r.year = ${cr.year}
            AND ROUND(r.amount::numeric, 2) BETWEEN ${lo} AND ${hi}`
        for (const row of rec) receivables.set(row.id, row)
        const vic = await sql`
          SELECT p.id, c.name AS client_name, ROUND(p.total_amount::numeric, 2) AS total_amount, p.month, p.year, p.payment_month, p.payment_year
          FROM payables_victor p JOIN clients c ON c.id = p.client_id
          WHERE c.name ILIKE ${cr.client} AND p.month = ${cr.month} AND p.year = ${cr.year}
            AND ROUND(p.total_amount::numeric, 2) BETWEEN ${lo} AND ${hi}`
        for (const row of vic) payables_victor.set(row.id, row)
        const fab = await sql`
          SELECT p.id, c.name AS client_name, ROUND(p.amount::numeric, 2) AS amount, p.month, p.year, p.payment_month, p.payment_year
          FROM payables_fabricio p JOIN clients c ON c.id = p.client_id
          WHERE c.name ILIKE ${cr.client} AND p.month = ${cr.month} AND p.year = ${cr.year}
            AND ROUND(p.amount::numeric, 2) BETWEEN ${lo} AND ${hi}`
        for (const row of fab) payables_fabricio.set(row.id, row)
      }
      return res.status(200).json({
        receivables: [...receivables.values()],
        payables_victor: [...payables_victor.values()],
        payables_fabricio: [...payables_fabricio.values()],
      })
    } catch (error) {
      return res.status(500).json({ error: error.message })
    }
  }

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
          name VARCHAR(150) NOT NULL,
          email_domain VARCHAR(100),
          created_at TIMESTAMP DEFAULT NOW()
        )
      `
      await sql`
        CREATE TABLE IF NOT EXISTS client_companies (
          id SERIAL PRIMARY KEY,
          client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
          company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
          UNIQUE(client_id, company_id)
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
          SELECT c.id FROM clients c
          JOIN client_companies cc ON cc.client_id = c.id AND cc.company_id = 2
          WHERE c.name = ${client.name}
          LIMIT 1
        `
        let clientId
        if (existing.length > 0) {
          clientId = existing[0].id
        } else {
          const result = await sql`
            INSERT INTO clients (name, email_domain)
            VALUES (${client.name}, ${client.domains[0]})
            RETURNING *
          `
          clientId = result[0].id
          await sql`
            INSERT INTO client_companies (client_id, company_id)
            VALUES (${clientId}, 2)
            ON CONFLICT (client_id, company_id) DO NOTHING
          `
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

      const allClients = await sql`
        SELECT c.* FROM clients c
        JOIN client_companies cc ON cc.client_id = c.id AND cc.company_id = 2
      `
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

    if (action === 'migrate-contract-cnpj') {
      await sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS cnpj VARCHAR(30) DEFAULT NULL`
      return res.status(200).json({ success: true, message: 'migrate-contract-cnpj OK' })
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

    if (action === 'migrate-payment-date') {
      // Competência vs Caixa — data prevista/real de recebimento e mês de caixa.
      await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_date DATE`
      await sql`ALTER TABLE receivables ADD COLUMN IF NOT EXISTS payment_month INTEGER`
      await sql`ALTER TABLE receivables ADD COLUMN IF NOT EXISTS payment_year INTEGER`
      await sql`ALTER TABLE payables_victor ADD COLUMN IF NOT EXISTS payment_month INTEGER`
      await sql`ALTER TABLE payables_victor ADD COLUMN IF NOT EXISTS payment_year INTEGER`
      await sql`ALTER TABLE payables_fabricio ADD COLUMN IF NOT EXISTS payment_month INTEGER`
      await sql`ALTER TABLE payables_fabricio ADD COLUMN IF NOT EXISTS payment_year INTEGER`
      // Backfill: caixa = competência onde ainda não houver data específica.
      await sql`UPDATE receivables SET payment_month = month, payment_year = year WHERE payment_month IS NULL OR payment_year IS NULL`
      await sql`UPDATE payables_victor SET payment_month = month, payment_year = year WHERE payment_month IS NULL OR payment_year IS NULL`
      await sql`UPDATE payables_fabricio SET payment_month = month, payment_year = year WHERE payment_month IS NULL OR payment_year IS NULL`
      return res.status(200).json({ success: true, message: 'migrate-payment-date OK' })
    }

    if (action === 'migrate-victor-reserves') {
      await sql`
        CREATE TABLE IF NOT EXISTS victor_reserves (
          id SERIAL PRIMARY KEY,
          company_id INTEGER REFERENCES companies(id),
          month INTEGER NOT NULL,
          year INTEGER NOT NULL,
          das NUMERIC(10,2) DEFAULT 0,
          pro_labore NUMERIC(10,2) DEFAULT 0,
          inss NUMERIC(10,2) DEFAULT 0,
          escritorio NUMERIC(10,2) DEFAULT 0,
          notes TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(company_id, month, year)
        )
      `
      return res.status(200).json({ success: true, message: 'migrate-victor-reserves OK' })
    }

    if (action === 'migrate-payment-paid-at') {
      // Mês de caixa por pagamento individual: data + mês/ano derivados em payable_payments.
      await sql`ALTER TABLE payable_payments ADD COLUMN IF NOT EXISTS paid_at DATE`
      await sql`ALTER TABLE payable_payments ADD COLUMN IF NOT EXISTS payment_month INTEGER`
      await sql`ALTER TABLE payable_payments ADD COLUMN IF NOT EXISTS payment_year INTEGER`
      await sql`
        UPDATE payable_payments SET
          paid_at = COALESCE(paid_at, created_at::date),
          payment_month = EXTRACT(MONTH FROM COALESCE(paid_at, created_at))::int,
          payment_year = EXTRACT(YEAR FROM COALESCE(paid_at, created_at))::int
        WHERE payment_month IS NULL OR payment_year IS NULL
      `
      return res.status(200).json({ success: true, message: 'migrate-payment-paid-at OK' })
    }

    if (action === 'fix-cash-months') {
      // Correção pontual do mês de caixa (payment_month/year). Competência (month/year) intacta.
      // Idempotente: define valores absolutos, seguro re-executar.
      const correctedRecIds = []
      let receivables_updated = 0
      let victor_updated = 0
      let fabricio_updated = 0

      // RECEIVABLES por id conhecido (do diagnóstico)
      const recFixes = [
        { id: 13, pm: 2 }, { id: 8, pm: 2 },                       // Jan → 2
        { id: 14, pm: 3 }, { id: 9, pm: 3 }, { id: 23, pm: 3 },    // Fev → 3
        { id: 15, pm: 4 }, { id: 10, pm: 4 }, { id: 24, pm: 4 },   // Mar → 4
        { id: 16, pm: 5 }, { id: 11, pm: 5 }, { id: 25, pm: 5 }, { id: 29, pm: 5 }, // Abr → 5
        { id: 17, pm: 6 }, { id: 22, pm: 6 }, { id: 26, pm: 6 },   // Mai → 6
      ]
      for (const f of recFixes) {
        const r = await sql`UPDATE receivables SET payment_month = ${f.pm}, payment_year = 2026 WHERE id = ${f.id} RETURNING id`
        if (r.length) { receivables_updated += r.length; correctedRecIds.push(f.id) }
      }
      // SteelDek Jun/2026 → 6/2026 (id incerto: busca por nome + competência)
      const steelRec = await sql`
        UPDATE receivables r SET payment_month = 6, payment_year = 2026
        FROM clients c
        WHERE c.id = r.client_id AND c.name ILIKE '%Stel%' AND r.month = 6 AND r.year = 2026
        RETURNING r.id`
      receivables_updated += steelRec.length
      for (const row of steelRec) correctedRecIds.push(row.id)

      // PAYABLES_VICTOR por id conhecido (apenas os que precisam correção; os corretos são pulados)
      const vicFixes = [
        { id: 14, pm: 3 },  // Enpla Fev → 3 (confirma)
        { id: 10, pm: 4 },  // Bokada Mar → 4 (corrige de 3)
        { id: 15, pm: 4 },  // Enpla Mar → 4 (corrige de 3)
        { id: 11, pm: 5 },  // Bokada Abr → 5 (confirma)
      ]
      for (const f of vicFixes) {
        const r = await sql`UPDATE payables_victor SET payment_month = ${f.pm}, payment_year = 2026 WHERE id = ${f.id} RETURNING id`
        victor_updated += r.length
      }
      // Pharmalog em payables_victor (ids desconhecidos): comp month → month+1
      const pharmaMap = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 6 }
      for (const m of Object.keys(pharmaMap)) {
        const pm = pharmaMap[m]
        const r = await sql`
          UPDATE payables_victor p SET payment_month = ${pm}, payment_year = 2026
          FROM clients c
          WHERE c.id = p.client_id AND c.name ILIKE '%Pharmalog%' AND p.month = ${Number(m)} AND p.year = 2026
          RETURNING p.id`
        victor_updated += r.length
      }
      // SteelDek em payables_victor Jun → 6
      const steelVic = await sql`
        UPDATE payables_victor p SET payment_month = 6, payment_year = 2026
        FROM clients c
        WHERE c.id = p.client_id AND c.name ILIKE '%Stel%' AND p.month = 6 AND p.year = 2026
        RETURNING p.id`
      victor_updated += steelVic.length

      // PAYABLES_FABRICIO: espelha o mês de caixa do receivable corrigido (via invoice_id)
      if (correctedRecIds.length) {
        const r = await sql`
          UPDATE payables_fabricio pf
          SET payment_month = rr.payment_month, payment_year = rr.payment_year
          FROM invoices i
          JOIN receivables rr ON rr.id = i.receivable_id
          WHERE pf.invoice_id = i.id AND rr.id = ANY(${correctedRecIds})
          RETURNING pf.id`
        fabricio_updated = r.length
      }

      return res.status(200).json({ success: true, message: 'fix-cash-months OK', receivables_updated, victor_updated, fabricio_updated })
    }

    if (action === 'fix-payables-payment-date') {
      // Corrige o mês de caixa dos payables de faturamento existentes:
      // usa a data real do recebimento (receivables.paid_at); senão a payment_date da fatura.
      // Onde não houver nenhuma das duas, mantém a competência (fallback correto).
      const fixVictor = await sql`
        UPDATE payables_victor pv
        SET payment_month = EXTRACT(MONTH FROM src.d)::int,
            payment_year  = EXTRACT(YEAR FROM src.d)::int
        FROM (
          SELECT i.id AS invoice_id, COALESCE(r.paid_at, i.payment_date) AS d
          FROM invoices i
          LEFT JOIN receivables r ON r.id = i.receivable_id
        ) src
        WHERE pv.invoice_id = src.invoice_id
          AND pv.origin = 'faturamento'
          AND src.d IS NOT NULL
        RETURNING pv.id
      `
      const fixFab = await sql`
        UPDATE payables_fabricio pf
        SET payment_month = EXTRACT(MONTH FROM src.d)::int,
            payment_year  = EXTRACT(YEAR FROM src.d)::int
        FROM (
          SELECT i.id AS invoice_id, COALESCE(r.paid_at, i.payment_date) AS d
          FROM invoices i
          LEFT JOIN receivables r ON r.id = i.receivable_id
        ) src
        WHERE pf.invoice_id = src.invoice_id
          AND pf.origin = 'faturamento'
          AND src.d IS NOT NULL
        RETURNING pf.id
      `
      return res.status(200).json({ success: true, message: 'fix-payables-payment-date OK', victor: fixVictor.length, fabricio: fixFab.length })
    }

    if (action === 'migrate-client-companies') {
      // 1. Junction table (many-to-many clients <-> companies)
      await sql`
        CREATE TABLE IF NOT EXISTS client_companies (
          id SERIAL PRIMARY KEY,
          client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
          company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
          UNIQUE(client_id, company_id)
        )
      `
      // 2 + 3. Backfill from clients.company_id and drop the column — only if
      // it still exists (idempotent: safe to re-run after the column is gone).
      const hasCol = await sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'company_id'
      `
      if (hasCol.length > 0) {
        await sql`
          INSERT INTO client_companies (client_id, company_id)
          SELECT id, company_id FROM clients WHERE company_id IS NOT NULL
          ON CONFLICT (client_id, company_id) DO NOTHING
        `
        await sql`ALTER TABLE clients DROP COLUMN company_id`
      }
      return res.status(200).json({ success: true, message: 'migrate-client-companies OK', droppedColumn: hasCol.length > 0 })
    }

    return res.status(400).json({ error: 'action inválida' })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
}
