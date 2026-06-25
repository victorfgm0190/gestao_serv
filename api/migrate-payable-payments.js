import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const sql = neon(process.env.DATABASE_URL)
  try {
    await sql`CREATE TABLE IF NOT EXISTS payable_payments (
      id SERIAL PRIMARY KEY,
      payable_type VARCHAR(10) NOT NULL,
      payable_id INTEGER NOT NULL,
      amount NUMERIC(10,2) NOT NULL,
      paid_at DATE NOT NULL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`

    const vic = await sql`
      INSERT INTO payable_payments (payable_type, payable_id, amount, paid_at, notes)
      SELECT 'victor', id, paid_amount, COALESCE(paid_at, NOW()::date), 'Migrado automaticamente'
      FROM payables_victor WHERE paid_amount > 0 AND paid_amount IS NOT NULL
      RETURNING id`

    const fab = await sql`
      INSERT INTO payable_payments (payable_type, payable_id, amount, paid_at, notes)
      SELECT 'fabricio', id, paid_amount, COALESCE(paid_at, NOW()::date), 'Migrado automaticamente'
      FROM payables_fabricio WHERE paid_amount > 0 AND paid_amount IS NOT NULL
      RETURNING id`

    res.status(200).json({ success: true, message: `Tabela criada. Migrados ${vic.length} pagamentos de Victor e ${fab.length} de Fabrício.` })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}
