import { neon } from '@neondatabase/serverless'
import { sendCertificateAlert, smtpConfigurado } from '../lib/email-sender.js'
import { statusDoCertificado } from '../lib/nfse-cert-status.js'

// Verificação diária da validade dos certificados A1. Grava o alerta em
// nfse_certificate_alerts e tenta notificar por e-mail.
//
// ⚠️ A autenticação é a MESMA de api/cron-sync.js: Bearer $CRON_SECRET ou o
// header `x-vercel-cron: 1`. O esboço comparava `x-vercel-cron` ao CRON_SECRET,
// e a Vercel manda literalmente `1` nesse header — o cron oficial tomaria 401
// todo dia, para sempre, sem ninguém perceber: um monitoramento que só falha
// quando é a hora de avisar.

// Sem coluna de e-mail em `companies`, o destinatário é mapeado aqui.
// NFSE_ALERT_EMAIL sobrescreve todos — útil para testar sem tocar no código.
const DESTINATARIOS = {
  1: 'victor@lumendev.com.br',      // Lumen
  2: 'victor@imperiumprotheus.com', // Imperium
}
const destinatarioDe = (companyId) =>
  process.env.NFSE_ALERT_EMAIL || DESTINATARIOS[companyId] || null

export default async function handler(req, res) {
  const authHeader = req.headers['authorization']
  const validBearer = Boolean(process.env.CRON_SECRET) && authHeader === `Bearer ${process.env.CRON_SECRET}`
  const isVercelCron = req.headers['x-vercel-cron'] === '1'
  if (!validBearer && !isVercelCron) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const sql = neon(process.env.DATABASE_URL)
    const agora = new Date()

    const certificados = await sql`
      SELECT c.id   AS company_id,
             c.name AS company_name,
             nc.certificate_valid_until,
             nc.certificate_valid_from,
             nc.certificate_subject
      FROM nfse_certificates nc
      JOIN companies c ON c.id = nc.company_id
      WHERE nc.certificate_valid_until IS NOT NULL
      ORDER BY c.id`

    const alertasCriados = []
    const emailsEnviados = []
    const naoNotificados = []

    for (const cert of certificados) {
      const st = statusDoCertificado(
        cert.certificate_valid_until, agora, cert.certificate_valid_from
      )
      if (!st.precisaAlerta) continue

      console.log(`[cron-nfse] ${cert.company_name}: ${st.diasRestantes} dia(s) — ${st.severity}`)

      // Já avisado nas últimas 24h? Nada a fazer.
      const recente = await sql`
        SELECT id FROM nfse_certificate_alerts
        WHERE company_id = ${cert.company_id}
          AND alert_type = ${st.alertType}
          AND notified_at > NOW() - INTERVAL '24 hours'
        LIMIT 1`
      if (recente.length) continue

      // ⚠️ O alerta nasce com `notified_at` NULL e só recebe a data quando o
      // e-mail SAI. No esboço a linha era gravada com NOW() por default antes
      // do envio: um SMTP fora do ar marcava como notificado um aviso que
      // ninguém recebeu, e a checagem de 24h impedia qualquer nova tentativa —
      // o alerta se perdia em silêncio até a severidade mudar de faixa.
      //
      // Um pendente da mesma faixa é reaproveitado, senão cada dia sem SMTP
      // acumularia uma linha nova para o mesmo aviso.
      const pendente = await sql`
        SELECT id FROM nfse_certificate_alerts
        WHERE company_id = ${cert.company_id}
          AND alert_type = ${st.alertType}
          AND notified_at IS NULL
        ORDER BY id DESC
        LIMIT 1`

      let alertaId
      if (pendente.length) {
        alertaId = pendente[0].id
        await sql`
          UPDATE nfse_certificate_alerts
          SET certificate_valid_until = ${cert.certificate_valid_until},
              days_remaining = ${st.diasRestantes},
              severity = ${st.severity}
          WHERE id = ${alertaId}`
      } else {
        const [novo] = await sql`
          INSERT INTO nfse_certificate_alerts
            (company_id, alert_type, certificate_valid_until, days_remaining, severity, notified_at)
          VALUES
            (${cert.company_id}, ${st.alertType}, ${cert.certificate_valid_until},
             ${st.diasRestantes}, ${st.severity}, NULL)
          RETURNING id`
        alertaId = novo.id
        alertasCriados.push({
          company: cert.company_name,
          diasRestantes: st.diasRestantes,
          severity: st.severity,
        })
      }

      const recipientEmail = destinatarioDe(cert.company_id)
      const envio = await sendCertificateAlert({
        companyName: cert.company_name,
        recipientEmail,
        validUntil: cert.certificate_valid_until,
        now: agora,
      })

      if (envio.success) {
        await sql`UPDATE nfse_certificate_alerts SET notified_at = NOW() WHERE id = ${alertaId}`
        emailsEnviados.push(recipientEmail)
      } else {
        // Fica pendente de propósito: a próxima execução tenta de novo.
        naoNotificados.push({ company: cert.company_name, motivo: envio.error })
      }
    }

    // ⚠️ 200 mesmo com e-mail pendente: os alertas FORAM gravados e a tela já
    // os mostra. Devolver 500 marcaria a execução como falha na Vercel e
    // esconderia o que de fato aconteceu — que está aqui no corpo.
    return res.status(200).json({
      success: true,
      smtp_configurado: smtpConfigurado(),
      totalEmpresas: certificados.length,
      alertasCriados: alertasCriados.length,
      emailsEnviados: emailsEnviados.length,
      naoNotificados,
      detalhes: alertasCriados,
    })
  } catch (err) {
    console.error('[cron-nfse] falha ao verificar certificados:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
}
