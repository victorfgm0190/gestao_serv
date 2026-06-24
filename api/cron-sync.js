import { neon } from '@neondatabase/serverless'
import imapSimple from 'imap-simple'
import { simpleParser } from 'mailparser'

async function fetchEmailsFromAccount(imapConfig, company_id, sql, rules) {
  const connection = await imapSimple.connect(imapConfig)
  await connection.openBox('INBOX')
  const messages = await connection.search(['UNSEEN'], {
    bodies: ['HEADER', 'TEXT', ''],
    markSeen: true,
  })
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
    const senderDomain = sender_email.split('@')[1] || ''

    let client_id = null
    for (const rule of rules) {
      if (rule.rule_type === 'domain' && senderDomain === rule.rule_value) { client_id = rule.target_client_id; break }
      if (rule.rule_type === 'email' && sender_email === rule.rule_value) { client_id = rule.target_client_id; break }
    }

    const existing = await sql`
      SELECT id FROM demands
      WHERE company_id = ${company_id} AND sender_email = ${sender_email}
        AND subject = ${subject} AND DATE(received_at) = DATE(${received_at})
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
  const authHeader = req.headers['authorization']
  const querySecret = req.query.secret
  const validBearer = authHeader === `Bearer ${process.env.CRON_SECRET}`
  const validQuery = querySecret === process.env.CRON_SECRET
  const isVercelCron = req.headers['x-vercel-cron'] === '1'

  if (!validBearer && !validQuery && !isVercelCron) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const sql = neon(process.env.DATABASE_URL)
  const rules = await sql`SELECT * FROM email_rules WHERE company_id = 2`

  const makeConfig = (host, port, user, pass) => ({
    imap: { host, port: parseInt(port), user, password: pass, tls: true, tlsOptions: { rejectUnauthorized: false }, authTimeout: 10000 }
  })

  const accounts = [
    makeConfig(process.env.IMAP_IMPERIUM_HOST, process.env.IMAP_IMPERIUM_PORT, process.env.IMAP_IMPERIUM_USER, process.env.IMAP_IMPERIUM_PASS),
    makeConfig(process.env.IMAP_IMPERIUM2_HOST, process.env.IMAP_IMPERIUM2_PORT, process.env.IMAP_IMPERIUM2_USER, process.env.IMAP_IMPERIUM2_PASS),
  ]

  const allImported = []
  const errors = []

  for (const config of accounts) {
    try {
      const imported = await fetchEmailsFromAccount(config, 2, sql, rules)
      allImported.push(...imported)
    } catch (error) {
      errors.push({ account: config.imap.user, error: error.message })
    }
  }

  return res.status(200).json({ success: true, imported: allImported.length, errors })
}
