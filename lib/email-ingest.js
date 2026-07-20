import imapSimple from 'imap-simple'
import { simpleParser } from 'mailparser'

// Lógica única de ingestão IMAP, compartilhada por /api/cron-sync e /api/ingest-email.
// Antes existiam duas cópias que já haviam divergido (o cron perdeu o suporte a
// regras 'keyword'); manter uma cópia só evita que volte a acontecer.

export function makeImapConfig(host, port, user, pass) {
  // Validação de certificado LIGADA por padrão. Estava desligada, o que expunha
  // usuário e senha do e-mail a interceptação na rede. Se o provedor tiver
  // certificado self-signed, IMAP_ALLOW_INSECURE_TLS=true reabre — mas é saída
  // de emergência, não configuração normal.
  const insecure = process.env.IMAP_ALLOW_INSECURE_TLS === 'true'
  return {
    imap: {
      host, port: parseInt(port), user, password: pass,
      tls: true,
      tlsOptions: { rejectUnauthorized: !insecure, servername: host },
      authTimeout: 10000,
    },
  }
}

function classify(rules, { senderDomain, sender_email, subject }) {
  for (const rule of rules) {
    if (rule.rule_type === 'domain' && senderDomain === rule.rule_value) return rule.target_client_id
    if (rule.rule_type === 'email' && sender_email === rule.rule_value) return rule.target_client_id
    if (rule.rule_type === 'keyword' && rule.rule_value
        && subject.toLowerCase().includes(String(rule.rule_value).toLowerCase())) {
      return rule.target_client_id
    }
  }
  return null
}

// Busca UNSEEN e grava as demandas. Retorna { imported, failed }.
//
// Regra central: a mensagem só é marcada como lida DEPOIS de gravada com sucesso.
// Antes o markSeen era feito no fetch, então qualquer falha (parser, banco,
// timeout no meio do laço) tornava a mensagem invisível para sempre — a demanda
// era perdida sem erro visível. Agora uma falha deixa o e-mail UNSEEN e a
// próxima execução tenta de novo.
// `connect` é injetável só para teste; em produção usa o imap-simple.
export async function fetchEmailsFromAccount(imapConfig, company_id, sql, rules, connect = imapSimple.connect) {
  const connection = await connect(imapConfig)
  const imported = []
  const failed = []

  try {
    await connection.openBox('INBOX')
    const messages = await connection.search(['UNSEEN'], {
      bodies: ['HEADER', 'TEXT', ''],
      markSeen: false,
    })

    for (const message of messages) {
      const uid = message.attributes?.uid
      try {
        const allParts = message.parts.find(p => p.which === '')
        if (!allParts) continue

        const parsed = await simpleParser(allParts.body)
        const sender_email = parsed.from?.value?.[0]?.address || ''
        const sender_name = parsed.from?.value?.[0]?.name || ''
        const subject = parsed.subject || '(sem assunto)'
        const body = parsed.text || parsed.html || ''
        const received_at = parsed.date || new Date()
        const senderDomain = sender_email.split('@')[1] || ''

        const client_id = classify(rules, { senderDomain, sender_email, subject })

        const existing = await sql`
          SELECT id FROM demands
          WHERE company_id = ${company_id} AND sender_email = ${sender_email}
            AND subject = ${subject} AND DATE(received_at) = DATE(${received_at})
          LIMIT 1
        `
        if (existing.length > 0) {
          // Já está no banco: marca como lida para não reprocessar toda execução.
          if (uid) await connection.addFlags(uid, '\\Seen')
          continue
        }

        const result = await sql`
          INSERT INTO demands (company_id, client_id, sender_name, sender_email, subject, body, status, origin, received_at)
          VALUES (${company_id}, ${client_id}, ${sender_name}, ${sender_email}, ${subject}, ${body}, 'nova', 'email', ${received_at})
          RETURNING *
        `

        // Só agora é seguro marcar como lida.
        if (uid) await connection.addFlags(uid, '\\Seen')
        imported.push(result[0])
      } catch (err) {
        // Falha em uma mensagem não derruba o lote; ela fica UNSEEN para a
        // próxima rodada.
        console.error(`[email-ingest] falha na mensagem uid=${uid}:`, err.message)
        failed.push({ uid, error: err.message })
      }
    }
  } finally {
    // Estava fora de finally: uma exceção em openBox/search vazava o socket,
    // segurando a instância serverless até o timeout.
    try { connection.end() } catch { /* conexão já caiu */ }
  }

  return { imported, failed }
}

// Percorre as contas configuradas. Nunca lança: devolve o que importou e a lista
// de erros, para o handler decidir o status HTTP.
export async function ingestAccounts(accounts, company_id, sql, rules) {
  const allImported = []
  const errors = []

  for (const config of accounts) {
    const user = config.imap.user
    try {
      const { imported, failed } = await fetchEmailsFromAccount(config, company_id, sql, rules)
      allImported.push(...imported)
      for (const f of failed) {
        errors.push({ account: user, uid: f.uid, error: f.error })
      }
    } catch (error) {
      console.error(`[email-ingest] conta ${user} falhou:`, error.message)
      errors.push({ account: user, error: error.message })
    }
  }

  return { imported: allImported, errors }
}

export function imperiumAccounts() {
  return [
    makeImapConfig(process.env.IMAP_IMPERIUM_HOST, process.env.IMAP_IMPERIUM_PORT, process.env.IMAP_IMPERIUM_USER, process.env.IMAP_IMPERIUM_PASS),
    makeImapConfig(process.env.IMAP_IMPERIUM2_HOST, process.env.IMAP_IMPERIUM2_PORT, process.env.IMAP_IMPERIUM2_USER, process.env.IMAP_IMPERIUM2_PASS),
  ]
}
