import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import nfseCertManager from '../lib/nfse-cert-manager.js'
import { statusDoCertificado } from '../lib/nfse-cert-status.js'

// Consulta e remoção do certificado A1 da empresa.
//
// GET    /api/nfse-certificate?company_id=1  → metadados + validade
// DELETE /api/nfse-certificate?company_id=1  → remove
//
// ⚠️ O GET nunca decifra o .pfx: as datas, o titular e o thumbprint estão em
// claro no banco. Abrir a chave privada para desenhar um selo de status a
// exporia a cada carregamento de tela.
export default async function handler(req, res) {
  if (!requireAuth(req, res)) return

  const { company_id } = req.query
  if (!company_id) {
    return res.status(400).json({ error: 'company_id é obrigatório' })
  }
  const companyId = parseInt(company_id, 10)
  if (!Number.isInteger(companyId)) {
    return res.status(400).json({ error: 'company_id inválido' })
  }

  try {
    const sql = neon(process.env.DATABASE_URL)

    if (req.method === 'GET') {
      const cert = await nfseCertManager.getCertificateStatus(sql, companyId)

      // Ausência de certificado é resposta normal, não erro: a tela precisa
      // distinguir "ainda não configurado" de "falhou ao consultar".
      if (!cert) {
        return res.status(200).json({
          success: true,
          certificate: null,
          message: 'Nenhum certificado configurado',
        })
      }

      // Dias e faixa vêm de lib/nfse-cert-status.js — o mesmo cálculo do cron.
      const st = statusDoCertificado(
        cert.certificate_valid_until, new Date(), cert.certificate_valid_from
      )

      return res.status(200).json({
        success: true,
        certificate: {
          id: cert.id,
          company_id: cert.company_id,
          thumbprint: cert.certificate_thumbprint,
          subject: cert.certificate_subject,
          valid_from: cert.certificate_valid_from,
          valid_until: cert.certificate_valid_until,
          dias_restantes: st.diasRestantes,
          status: st.status,
          uploaded_at: cert.uploaded_at,
          updated_at: cert.updated_at,
        },
      })
    }

    if (req.method === 'DELETE') {
      const removido = await nfseCertManager.deleteCertificate(sql, companyId)
      if (!removido) {
        return res.status(404).json({ error: 'Certificado não encontrado' })
      }
      return res.status(200).json({ success: true, message: 'Certificado removido' })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('[nfse-certificate] falha:', err.message)
    return res.status(500).json({ error: 'Erro ao processar certificado' })
  }
}
