import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import nfseCertManager from '../lib/nfse-cert-manager.js'
import { extrairChaves } from '../lib/nfse-signer.js'
import https from 'node:https'

// DANFSE em PDF gerado pelo Portal Nacional.
//
// ⚠️⚠️ O PORTAL NÃO OFERECE ISSO HOJE. Sondado em produção com o certificado
// da empresa, contra a nota 26 já autorizada:
//
//   GET /SefinNacional/nfse/{chave}/danfse  → 404 (4 tentativas)
//   GET /SefinNacional/danfse/{chave}       → 501 Not Implemented, corpo vazio
//   GET www.nfse.gov.br/api/v1/nfse/{chave}/pdf → 404 (página HTML do portal)
//
// O 501 é a resposta mais informativa: a rota EXISTE no contrato do serviço e
// **não está implementada**. Não é erro nosso, não é questão de aguardar
// alguns minutos, e não adianta tentar de novo.
//
// ⚠️ E `https://nfse.gov.br/api/v1/...` nem resolve — o host não existe. Um
// endpoint apontando para lá falharia sempre, e o `catch` genérico do esboço
// transformaria isso num 500 "Falha ao baixar PDF do portal", que se lê como
// instabilidade passageira.
//
// Este endpoint existe para o dia em que a rota for publicada: o caminho é
// configurável por NFSE_ROTA_DANFSE e, enquanto o portal responder 404/501,
// ele diz isso por extenso — e lembra que o DANFSE de
// /api/nfse-download-danfse é gerado a partir do XML AUTORIZADO, com o mesmo
// conteúdo fiscal (número, chave, prestador do cadastro nacional).

const HOSTS = {
  producao: process.env.NFSE_SEFIN_HOST_PRODUCAO || 'sefin.nfse.gov.br',
  homologacao: process.env.NFSE_SEFIN_HOST_HOMOLOGACAO || 'sefin.producaorestrita.nfse.gov.br',
}
// `{chave}` é substituído pela chave de acesso.
const ROTA = process.env.NFSE_ROTA_DANFSE || '/SefinNacional/nfse/{chave}/danfse'

function buscar(host, path, agent) {
  return new Promise((resolve) => {
    const req = https.request(
      { host, path, method: 'GET', timeout: 15000, agent, headers: { Accept: 'application/pdf' } },
      (res) => {
        const partes = []
        res.on('data', (c) => partes.push(c))
        res.on('end', () => resolve({
          status: res.statusCode,
          tipo: res.headers['content-type'] || '',
          corpo: Buffer.concat(partes),
        }))
      }
    )
    req.on('timeout', () => { req.destroy(); resolve({ status: 504 }) })
    req.on('error', (e) => resolve({ status: 0, erro: e.message }))
    req.end()
  })
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const emissionId = parseInt(req.query.emission_id, 10)
  if (!Number.isInteger(emissionId)) {
    return res.status(400).json({ error: 'emission_id é obrigatório' })
  }

  try {
    const sql = neon(process.env.DATABASE_URL)
    const [em] = await sql`
      SELECT id, company_id, ambiente, chave_acesso, nfse_number, status
      FROM nfse_emissions WHERE id = ${emissionId}`

    if (!em) return res.status(404).json({ error: 'Emissão não encontrada' })
    if (!em.chave_acesso) {
      return res.status(422).json({
        error: 'Esta emissão não tem chave de acesso',
        detalhe: 'A chave é atribuída pelo SEFIN na autorização.',
      })
    }

    const cert = await nfseCertManager.getCertificateFromDB(sql, em.company_id)
    const { privateKeyPem, certificatePem } = extrairChaves(cert.pfxBuffer, cert.password)
    const agent = new https.Agent({ key: privateKeyPem, cert: certificatePem, keepAlive: false })

    const host = HOSTS[(em.ambiente ?? 2) === 1 ? 'producao' : 'homologacao']
    const r = await buscar(host, ROTA.replace('{chave}', encodeURIComponent(em.chave_acesso)), agent)

    // ⚠️ Confere o CONTEÚDO, não só o status. O portal responde 200 com página
    // HTML de erro em várias rotas; mandá-la ao navegador como
    // `Content-Type: application/pdf` produz um arquivo que não abre.
    const ehPdf = r.corpo?.length > 4 && r.corpo.slice(0, 5).toString() === '%PDF-'

    if (r.status === 200 && ehPdf) {
      const parte = (v) => String(v ?? '').replace(/[^\w.-]/g, '')
      const nome = ['DANFSE', parte(em.nfse_number) || `emissao${em.id}`, 'oficial']
        .filter(Boolean).join('_')
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Length', r.corpo.length)
      res.setHeader('Content-Disposition', `attachment; filename="${nome}.pdf"`)
      return res.status(200).send(r.corpo)
    }

    // 501 = a rota existe no contrato e não foi implementada. Dizer "aguarde
    // alguns minutos" seria mentira: não há o que aguardar.
    if (r.status === 501 || r.status === 404) {
      return res.status(503).json({
        error: 'O Portal Nacional ainda não disponibiliza o DANFSE em PDF por API',
        detalhe: r.status === 501
          ? 'A rota existe no contrato do serviço, mas responde 501 (não implementada).'
          : 'A rota consultada respondeu 404.',
        alternativa: 'Use o DANFSE de /api/nfse-download-danfse: ele é gerado a partir do XML autorizado, com o mesmo conteúdo fiscal (número, chave e prestador do cadastro nacional).',
        rota_tentada: `https://${host}${ROTA.replace('{chave}', em.chave_acesso)}`,
        http_status: r.status,
      })
    }

    return res.status(502).json({
      error: 'O portal não devolveu um PDF',
      http_status: r.status,
      content_type: r.tipo,
      detalhe: r.erro,
    })
  } catch (err) {
    if (err.code === 'CERT_NOT_FOUND') {
      return res.status(422).json({ error: 'Certificado digital não configurado para esta empresa' })
    }
    console.error('[nfse-download-pdf-oficial] falha:', err.message)
    return res.status(500).json({ error: 'Erro ao buscar o PDF oficial' })
  }
}
