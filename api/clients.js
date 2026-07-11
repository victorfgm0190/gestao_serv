import { neon } from '@neondatabase/serverless'

// Normaliza company_ids a partir do body: aceita `company_ids` (array) ou
// `company_id` (single, retrocompatível com telas antigas como FinancialRules).
function parseCompanyIds(body) {
  let ids = body?.company_ids
  if (!ids && body?.company_id != null) ids = [body.company_id]
  return [...new Set((ids || []).map(Number).filter(Boolean))]
}

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL)

  try {
    if (req.method === 'GET') {
      const { company_id } = req.query

      if (company_id) {
        // Clientes que pertencem à empresa informada (mas o array company_ids
        // retornado ainda lista TODAS as empresas do cliente).
        const clients = await sql`
          SELECT c.id, c.name, c.email_domain,
            COALESCE(
              ARRAY_AGG(all_cc.company_id ORDER BY all_cc.company_id)
                FILTER (WHERE all_cc.company_id IS NOT NULL),
              '{}'
            ) AS company_ids
          FROM clients c
          JOIN client_companies filt ON filt.client_id = c.id AND filt.company_id = ${company_id}
          LEFT JOIN client_companies all_cc ON all_cc.client_id = c.id
          GROUP BY c.id, c.name, c.email_domain
          ORDER BY c.name ASC
        `
        return res.status(200).json({ clients })
      }

      const clients = await sql`
        SELECT c.id, c.name, c.email_domain,
          COALESCE(
            ARRAY_AGG(cc.company_id ORDER BY cc.company_id)
              FILTER (WHERE cc.company_id IS NOT NULL),
            '{}'
          ) AS company_ids
        FROM clients c
        LEFT JOIN client_companies cc ON cc.client_id = c.id
        GROUP BY c.id, c.name, c.email_domain
        ORDER BY c.name ASC
      `
      return res.status(200).json({ clients })
    }

    if (req.method === 'POST') {
      const { name, email_domain } = req.body
      const companyIds = parseCompanyIds(req.body)
      if (!name || !name.trim()) return res.status(400).json({ error: 'Nome é obrigatório' })
      if (companyIds.length === 0) return res.status(400).json({ error: 'Selecione ao menos uma empresa' })

      const result = await sql`
        INSERT INTO clients (name, email_domain)
        VALUES (${name.trim()}, ${email_domain || null})
        RETURNING id, name, email_domain
      `
      const client = result[0]
      for (const cid of companyIds) {
        await sql`
          INSERT INTO client_companies (client_id, company_id)
          VALUES (${client.id}, ${cid})
          ON CONFLICT (client_id, company_id) DO NOTHING
        `
      }
      return res.status(201).json({ client: { ...client, company_ids: companyIds } })
    }

    if (req.method === 'PUT') {
      const id = req.query.id || req.body?.id
      if (!id) return res.status(400).json({ error: 'id é obrigatório' })
      const { name, email_domain } = req.body
      const companyIds = parseCompanyIds(req.body)
      if (!name || !name.trim()) return res.status(400).json({ error: 'Nome é obrigatório' })
      if (companyIds.length === 0) return res.status(400).json({ error: 'Selecione ao menos uma empresa' })

      // email_domain só é sobrescrito quando enviado (a tela de Clientes não o edita).
      await sql`
        UPDATE clients
        SET name = ${name.trim()},
            email_domain = COALESCE(${email_domain ?? null}, email_domain)
        WHERE id = ${id}
      `
      await sql`DELETE FROM client_companies WHERE client_id = ${id}`
      for (const cid of companyIds) {
        await sql`
          INSERT INTO client_companies (client_id, company_id)
          VALUES (${id}, ${cid})
          ON CONFLICT (client_id, company_id) DO NOTHING
        `
      }
      return res.status(200).json({ client: { id: Number(id), name: name.trim(), company_ids: companyIds } })
    }

    if (req.method === 'DELETE') {
      const id = req.query.id || req.body?.id
      if (!id) return res.status(400).json({ error: 'id é obrigatório' })
      // ON DELETE CASCADE remove as linhas de client_companies.
      await sql`DELETE FROM clients WHERE id = ${id}`
      return res.status(200).json({ success: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
}
