import { neon } from '@neondatabase/serverless'
import imapSimple from 'imap-simple'
import { simpleParser } from 'mailparser'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { company_id } = req.body

  if (!company_id) {
    return res.status(400).json({ error: 'company_id é obrigatório' })
  }

  const sql = neon(process.env.DATABASE_URL)

  // Seleciona configuração IMAP pela empresa
  let imapConfig
  if (String(company_id) === '2') {
    imapConfig = {
      imap: {
        host: process.env.IMAP_IMPERIUM_HOST,
        port: parseInt(process.env.IMAP_IMPERIUM_PORT),
        user: process.env.IMAP_IMPERIUM_USER,
        password: process.env.IMAP_IMPERIUM_PASS,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 10000,
      }
    }
  } else {
    return res.status(400).json({ error: 'Configuração IMAP não disponível para esta empresa' })
  }

  try {
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

      // Verifica se já existe demanda com mesmo remetente + assunto + data
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
        INSERT INTO demands (company_id, sender_name, sender_email, subject, body, status, origin, received_at)
        VALUES (${company_id}, ${sender_name}, ${sender_email}, ${subject}, ${body}, 'nova', 'email', ${received_at})
        RETURNING *
      `
      imported.push(result[0])
    }

    return res.status(200).json({
      success: true,
      total_found: messages.length,
      imported: imported.length,
      demands: imported,
    })

  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
}
