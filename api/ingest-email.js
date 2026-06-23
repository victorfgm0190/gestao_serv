import { neon } from '@neondatabase/serverless'
import imapSimple from 'imap-simple'
import { simpleParser } from 'mailparser'

async function fetchEmailsFromAccount(imapConfig, company_id, sql, rules) {
  const connection = await imapSimple.connect(imapConfig)
  await connection.openBox('INBOX')

  const searchCriteria = ['UNSEEN']
  const fetchOptions = {
    bodies: ['HEADER', 'TEXT', ''],
    markSeen: true,
  }

  const messages = await connection.search(searchCriteria, fetchOptions)
  connection.end()

  const imported = []

  for (const message of messages) {
    const allParts = message.parts.find(p => p.which === '')
    if (!allParts) continue

    const parsed = await simpleParser(allParts.body)

    const sender_email = parsed.from?.value?.[0]?.address || ''
    const sender_name = parsed.from?.value?.[0]?.name || ''
    const subject = parsed.subject || '(sem assunto)'
    const body = parsed.text || parsed.html || ''
    const received_at = parsed.date || new Date()

    // Aplicar regras de classificação
    let client_id = null
    const senderDomain = sender_email.split('@')[1] || ''

    for (const rule of rules) {
      if (rule.rule_type === 'domain' && senderDomain === rule.rule_value) {
        client_id = rule.target_client_id
        break
      }
      if (rule.rule_type === 'email' && sender_email === rule.rule_value) {
        client_id = rule.target_client_id
        break
      }
      if (rule.rule_type === 'keyword' && subject.toLowerCase().includes(rule.rule_value.toLowerCase())) {
        client_id = rule.target_client_id
        break
      }
    }

    const existing = await sql`
      SELECT id FROM demands
      WHERE company_id = ${company_id}
        AND sender_email = ${sender_email}
        AND subject = ${subject}
        AND DATE(received_at) = DATE(${received_at})
      LIMIT 1
    `

    if (existing.length > 0) continue

    const result = await sql`
      INSERT INTO demands (company_id, client_id, sender_name, sender_email, subject, body, status, origin, received_at)
      VALUES (${company_id}, ${client_id}, ${sender_name}, ${sender_email}, ${subject}, ${body}, 'nova', 'email', ${received_at})
      RETURNING *
    `
    imported.push(result[0])
  }

  return imported
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { company_id } = req.body

  if (!company_id) {
    return res.status(400).json({ error: 'company_id é obrigatório' })
  }

  const sql = neon(process.env.DATABASE_URL)

  if (String(company_id) !== '2') {
    return res.status(400).json({ error: 'Configuração IMAP não disponível para esta empresa' })
  }

  // Buscar regras de classificação
  const rules = await sql`
    SELECT * FROM email_rules WHERE company_id = ${company_id}
  `

  const makeConfig = (host, port, user, pass) => ({
    imap: {
      host,
      port: parseInt(port),
      user,
      password: pass,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 10000,
    }
  })

  const accounts = [
    makeConfig(
      process.env.IMAP_IMPERIUM_HOST,
      process.env.IMAP_IMPERIUM_PORT,
      process.env.IMAP_IMPERIUM_USER,
      process.env.IMAP_IMPERIUM_PASS
    ),
    makeConfig(
      process.env.IMAP_IMPERIUM2_HOST,
      process.env.IMAP_IMPERIUM2_PORT,
      process.env.IMAP_IMPERIUM2_USER,
      process.env.IMAP_IMPERIUM2_PASS
    ),
  ]

  const allImported = []
  const errors = []

  for (const config of accounts) {
    try {
      const imported = await fetchEmailsFromAccount(config, company_id, sql, rules)
      allImported.push(...imported)
    } catch (error) {
      errors.push({ account: config.imap.user, error: error.message })
    }
  }

  return res.status(200).json({
    success: true,
    total_imported: allImported.length,
    imported: allImported.length,
    errors,
  })
}
