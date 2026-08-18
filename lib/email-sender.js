import nodemailer from 'nodemailer'
import { statusDoCertificado } from './nfse-cert-status.js'

// Envio de e-mail por SMTP. Configuração por ambiente:
// SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE.
//
// ⚠️ O transporter é criado sob demanda, não no topo do módulo. Criá-lo no
// import faria o cron inteiro depender de SMTP estar configurado só para
// importar o arquivo — e hoje ele não está. Assim, sem SMTP o alerta continua
// sendo GRAVADO no banco e aparecendo na tela; só o e-mail é que não sai, e
// isso é dito na resposta em vez de virar um stack trace no log da Vercel.

const APP_URL = process.env.APP_URL || 'https://gestao-serv.vercel.app'
const CAMINHO_CONFIG = '/configuracao/nfse'

let _transporter = null

export function smtpConfigurado() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
}

function transporter() {
  if (_transporter) return _transporter
  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })
  return _transporter
}

const botao = (cor, texto, url) =>
  `<p><a href="${url}" style="background:${cor};color:#fff;padding:10px 20px;` +
  `text-decoration:none;border-radius:5px;display:inline-block">${texto}</a></p>`

/**
 * Monta assunto e corpo a partir da severidade.
 *
 * ⚠️ A faixa vem de `statusDoCertificado`, não de uma segunda cadeia de ifs com
 * os mesmos números. No esboço, um certificado com mais de 30 dias caía fora de
 * todos os ramos e o e-mail saía com **assunto e corpo vazios** — enviado,
 * entregue e ilegível. Aqui esse caso é recusado explicitamente.
 */
export function montarAlerta({ companyName, diasRestantes, vencimento, status }) {
  const url = `${APP_URL}${CAMINHO_CONFIG}`

  if (status === 'expired') {
    return {
      subject: `🔴 CRÍTICO: Certificado Digital da ${companyName} EXPIROU`,
      html:
        `<h2 style="color:#dc2626">❌ CERTIFICADO EXPIRADO</h2>` +
        `<p><strong>${companyName}</strong></p>` +
        `<p>Seu certificado digital expirou em <strong>${vencimento}</strong></p>` +
        `<p style="color:#dc2626;font-weight:bold">⚠️ Não será possível emitir NFSe até renovar.</p>` +
        botao('#dc2626', 'Renovar Certificado', url),
      text: `CERTIFICADO EXPIRADO\n${companyName}\nVenceu em ${vencimento}\nAcesse: ${url}`,
    }
  }

  if (status === 'critical') {
    return {
      subject: `🔴 CRÍTICO: Certificado da ${companyName} vence em ${diasRestantes} dias`,
      html:
        `<h2 style="color:#ea580c">🔴 CRÍTICO: ${diasRestantes} dias</h2>` +
        `<p><strong>${companyName}</strong></p>` +
        `<p>Seu certificado digital vence em <strong>${vencimento}</strong></p>` +
        `<p style="color:#ea580c;font-weight:bold">Renove o certificado com URGÊNCIA!</p>` +
        botao('#ea580c', 'Renovar Certificado', url),
      text: `CERTIFICADO VENCE EM ${diasRestantes} DIAS\n${companyName}\nVence em ${vencimento}\nAcesse: ${url}`,
    }
  }

  if (status === 'warning') {
    return {
      subject: `🟡 AVISO: Certificado da ${companyName} vence em ${diasRestantes} dias`,
      html:
        `<h2 style="color:#eab308">🟡 AVISO: ${diasRestantes} dias</h2>` +
        `<p><strong>${companyName}</strong></p>` +
        `<p>Seu certificado digital vence em <strong>${vencimento}</strong></p>` +
        `<p>Planeje a renovação do certificado.</p>` +
        botao('#eab308', 'Visualizar Certificado', url),
      text: `CERTIFICADO VENCE EM ${diasRestantes} DIAS\n${companyName}\nVence em ${vencimento}\nAcesse: ${url}`,
    }
  }

  return null // 'ok' e 'not_yet_valid' não geram alerta
}

/** Envia o alerta de vencimento. Nunca lança — o cron decide o que fazer. */
export async function sendCertificateAlert(data) {
  const { companyName, recipientEmail, validUntil, now = new Date() } = data

  const st = statusDoCertificado(validUntil, now)
  const vencimento = st.validUntil.toLocaleDateString('pt-BR')
  const modelo = montarAlerta({
    companyName,
    diasRestantes: st.diasRestantes,
    vencimento,
    status: st.status,
  })

  if (!modelo) {
    return { success: false, skipped: true, error: `Sem alerta para status "${st.status}"` }
  }
  if (!smtpConfigurado()) {
    return { success: false, skipped: true, error: 'SMTP não configurado (SMTP_HOST/USER/PASS)' }
  }
  if (!recipientEmail) {
    return { success: false, skipped: true, error: 'Sem destinatário configurado' }
  }

  try {
    const info = await transporter().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: recipientEmail,
      subject: modelo.subject,
      html: modelo.html,
      text: modelo.text,
    })
    console.log(`[email] alerta enviado para ${companyName} <${recipientEmail}>`)
    return { success: true, messageId: info.messageId }
  } catch (err) {
    console.error(`[email] falha ao enviar para ${companyName}:`, err.message)
    return { success: false, error: err.message }
  }
}

/** Testa a conexão SMTP. Usado para diagnosticar configuração. */
export async function testSmtpConnection() {
  if (!smtpConfigurado()) {
    return { success: false, error: 'SMTP não configurado (SMTP_HOST/USER/PASS)' }
  }
  try {
    await transporter().verify()
    return { success: true, message: 'Conexão SMTP OK' }
  } catch (err) {
    return { success: false, error: err.message }
  }
}
