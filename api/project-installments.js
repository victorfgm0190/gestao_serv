import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  const sql = neon(process.env.DATABASE_URL)

  if (req.method === 'GET') {
    const { contract_id } = req.query
    if (!contract_id) return res.status(400).json({ error: 'contract_id obrigatório' })
    const installments = await sql`
      SELECT * FROM project_installments
      WHERE contract_id = ${contract_id}
      ORDER BY installment_number ASC, id ASC
    `
    return res.status(200).json({ installments })
  }

  if (req.method === 'POST') {
    const { contract_id, installment_number, description, value, due_date } = req.body
    if (!contract_id) return res.status(400).json({ error: 'contract_id obrigatório' })
    if (value === undefined || value === null || value === '') {
      return res.status(400).json({ error: 'value obrigatório' })
    }
    try {
      const result = await sql`
        INSERT INTO project_installments (contract_id, installment_number, description, value, due_date)
        VALUES (${contract_id}, ${installment_number || 1}, ${description || null}, ${value}, ${due_date || null})
        RETURNING *
      `
      return res.status(201).json({ installment: result[0] })
    } catch (error) {
      return res.status(500).json({ error: error.message })
    }
  }

  if (req.method === 'PUT') {
    const { id } = req.query
    const { installment_number, description, value, due_date } = req.body
    if (!id) return res.status(400).json({ error: 'id obrigatório' })
    try {
      const current = await sql`SELECT * FROM project_installments WHERE id = ${id} LIMIT 1`
      if (!current.length) return res.status(404).json({ error: 'Parcela não encontrada' })
      // Parcela faturada não pode ter valor alterado — a fatura já foi calculada em cima dele.
      if (current[0].invoice_id) {
        return res.status(400).json({ error: 'Parcela já faturada. Estorne a fatura antes de editar.' })
      }
      const result = await sql`
        UPDATE project_installments SET
          installment_number = ${installment_number ?? current[0].installment_number},
          description = ${description ?? current[0].description},
          value = ${value ?? current[0].value},
          due_date = ${due_date === undefined ? current[0].due_date : (due_date || null)}
        WHERE id = ${id}
        RETURNING *
      `
      return res.status(200).json({ installment: result[0] })
    } catch (error) {
      return res.status(500).json({ error: error.message })
    }
  }

  if (req.method === 'DELETE') {
    const id = req.query.id || req.body?.id
    if (!id) return res.status(400).json({ error: 'id obrigatório' })
    try {
      const current = await sql`SELECT * FROM project_installments WHERE id = ${id} LIMIT 1`
      if (!current.length) return res.status(404).json({ error: 'Parcela não encontrada' })
      if (current[0].status !== 'pendente' || current[0].invoice_id) {
        return res.status(400).json({ error: 'Só é possível excluir parcelas pendentes e não faturadas.' })
      }
      await sql`DELETE FROM project_installments WHERE id = ${id}`
      return res.status(200).json({ success: true })
    } catch (error) {
      return res.status(500).json({ error: error.message })
    }
  }

  res.status(405).json({ error: 'Method not allowed' })
}
