import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import nfseCertManager from '../lib/nfse-cert-manager.js'

// Upload do certificado A1 (.pfx) usado para assinar a NFS-e. O arquivo chega
// em base64, é validado (senha confere? é mesmo um PKCS#12?) e só então é
// gravado cifrado por lib/nfse-cert-manager.js.
//
// 🔒 requireAuth NÃO é opcional aqui. Sem ele a rota nasce pública, e uma rota
// pública que aceita certificado + senha deixa qualquer um SUBSTITUIR o
// certificado da empresa — as notas passariam a ser assinadas com a chave de
// outra pessoa. É o endpoint mais sensível da API.

const MAX_PFX_BYTES = 512 * 1024 // um A1 tem alguns KB; isto é folga, não limite real

export default async function handler(req, res) {
  const user = requireAuth(req, res)
  if (!user) return

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { certificate_base64, password, company_id } = req.body || {}

  if (!certificate_base64 || !password || !company_id) {
    return res.status(400).json({
      error: 'Certificado, senha e company_id são obrigatórios',
    })
  }

  // ⚠️ FileReader.readAsDataURL — o caminho natural de um <input type="file">
  // no browser — devolve "data:application/x-pkcs12;base64,MIIK...". Sem tirar
  // o prefixo, o Buffer sai deslocado e o forge acusa ASN.1 inválido: o usuário
  // leria "arquivo corrompido" para um .pfx perfeitamente bom.
  const base64 = String(certificate_base64).replace(/^data:[^;]*;base64,/, '').trim()
  const pfxBuffer = Buffer.from(base64, 'base64')

  if (pfxBuffer.length === 0) {
    return res.status(400).json({ error: 'Arquivo de certificado vazio' })
  }
  if (pfxBuffer.length > MAX_PFX_BYTES) {
    return res.status(400).json({
      error: `Arquivo grande demais para um certificado A1 (${pfxBuffer.length} bytes). Confira se enviou o .pfx correto.`,
    })
  }

  try {
    const sql = neon(process.env.DATABASE_URL)

    const companyCheck = await sql`SELECT id FROM companies WHERE id = ${company_id}`
    if (companyCheck.length === 0) {
      return res.status(404).json({ error: 'Empresa não encontrada' })
    }

    // Valida ANTES de gravar: senha errada ou arquivo que não é PKCS#12 são
    // erro de quem envia (400), não falha do servidor (500) — e um .pfx que
    // não abre aqui também não abriria na hora de assinar a nota.
    let certInfo
    try {
      certInfo = nfseCertManager.extractCertInfo(pfxBuffer, password)
    } catch (err) {
      return res.status(400).json({ error: err.message })
    }

    // `sub` é 'master' para o admin do ambiente e o id (como string) para
    // usuário de tabela. uploaded_by é INT: Number('master') seria NaN.
    const subId = Number(user?.sub)
    certInfo.uploadedBy = Number.isInteger(subId) ? subId : null

    const saved = await nfseCertManager.saveCertificateToDB(
      sql, company_id, pfxBuffer, password, certInfo
    )

    // Certificado vencido não é recusado — pode ser reenvio de histórico, e a
    // recusa esconderia o motivo. Mas o aviso vai na resposta: descobrir a
    // expiração só na hora de emitir a nota é tarde demais.
    const validade = await nfseCertManager.validateCertificate(sql, company_id)

    return res.status(200).json({
      success: true,
      message: 'Certificado salvo com segurança',
      certificate: {
        id: saved.id,
        company_id: saved.company_id,
        thumbprint: saved.certificate_thumbprint,
        subject: saved.certificate_subject,
        valid_from: saved.certificate_valid_from,
        valid_until: saved.certificate_valid_until,
      },
      validade: {
        valid: validade.valid,
        reason: validade.reason,
        days_remaining: validade.daysRemaining,
      },
    })
  } catch (err) {
    // Só o que o servidor errou chega aqui. A mensagem do erro nunca contém a
    // senha, mas a resposta ao cliente é genérica de qualquer forma.
    console.error('[nfse-setup] falha ao processar certificado:', err.message)
    return res.status(500).json({ error: 'Erro ao processar certificado' })
  }
}
