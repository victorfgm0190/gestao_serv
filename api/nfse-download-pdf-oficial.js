import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import nfseCertManager from '../lib/nfse-cert-manager.js'
import { extrairChaves } from '../lib/nfse-signer.js'
import { resolverEmissao, nomeArquivo } from '../lib/nfse-resolve.js'
import https from 'node:https'

// DANFSE em PDF gerado pelo Portal Nacional.
//
// GET|POST /api/nfse-download-pdf-oficial
//   { emission_id | nfse_id | invoice_id | nfse_number }
// (também atendido em /api/nfse-download-oficial — mesmo handler)
//
// ⚠️⚠️ O PORTAL NÃO OFERECE ISSO. Sondado de novo em **2026-09-01**, em
// produção, com o certificado da Lumen, contra a nota 28 autorizada
// (chave 41137002264761267000184000000000002826086327872448):
//
//   GET sefin.nfse.gov.br/SefinNacional/danfse/{chave}        → 501, corpo vazio
//   GET sefin.nfse.gov.br/SefinNacional/nfse/{chave}/danfse   → 404 (HTML)
//   GET sefin.nfse.gov.br/SefinNacional/nfse/{chave}/pdf      → 404 (HTML)
//   GET adn.nfse.gov.br/contribuinte/danfse/{chave}           → ECONNRESET
//   GET sefin.nfse.gov.br/SefinNacional/nfse/{chave}          → 200 (o XML)
//
// O 501 é a resposta informativa: a rota EXISTE no contrato do serviço e **não
// está implementada**. Não é erro nosso, não adianta tentar de novo, e não é
// questão de aguardar alguns minutos. É o mesmo desfecho da sondagem de
// agosto/2026.
//
// ⚠️ Uma das tentativas devolveu **307** com `Accept: application/pdf` e 501
// com `*/*`, o que se lê como "existe um redirecionamento para o PDF". Não
// existe: repetindo a chamada, o mesmo par (rota, Accept) volta 501. O 307 é
// do balanceador, não da aplicação — perseguir aquele Location é gastar o dia.
//
// ⚠️ E `https://nfse.gov.br/api/v1/...` nem resolve — o host não existe. Um
// endpoint apontando para lá falharia sempre, e um `catch` genérico
// transformaria isso num 500 "Falha ao baixar PDF", que se lê como
// instabilidade passageira.
//
// Este endpoint existe para o dia em que a rota for publicada: o caminho é
// configurável por NFSE_ROTA_DANFSE e, enquanto o portal responder 404/501,
// ele diz isso por extenso — e aponta o DANFSE de /api/nfse-download-danfse,
// que é gerado a partir do XML AUTORIZADO e por isso carrega o mesmo conteúdo
// fiscal (número, chave, prestador do cadastro nacional).

const HOSTS = {
  producao: process.env.NFSE_SEFIN_HOST_PRODUCAO || 'sefin.nfse.gov.br',
  homologacao: process.env.NFSE_SEFIN_HOST_HOMOLOGACAO || 'sefin.producaorestrita.nfse.gov.br',
}
// `{chave}` é substituído pela chave de acesso.
const ROTA = process.env.NFSE_ROTA_DANFSE || '/SefinNacional/danfse/{chave}'

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
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // GET pela query, POST pelo corpo — a mesma rota serve o download da tela e
  // a chamada programática.
  const entrada = { ...(req.query || {}), ...(req.body || {}) }

  try {
    const sql = neon(process.env.DATABASE_URL)

    const { emissao: em, aviso, erro } = await resolverEmissao(sql, entrada)
    if (erro) return res.status(erro.status).json(erro.body)

    if (!em.chave_acesso) {
      return res.status(422).json({
        error: 'Esta emissão não tem chave de acesso',
        detalhe: 'A chave é atribuída pelo SEFIN na autorização — sem ela não há o que consultar.',
        emission_id: em.id,
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
      const nome = nomeArquivo(['DANFSE', em.nfse_number || `emissao${em.id}`, 'oficial'])
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Length', r.corpo.length)
      res.setHeader('Content-Disposition', `attachment; filename="${nome}.pdf"`)
      res.setHeader('X-NFSe-Origem', 'portal')
      res.setHeader('X-NFSe-Emission-Id', String(em.id))
      if (aviso) res.setHeader('X-NFSe-Aviso', encodeURIComponent(aviso))
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
        alternativa: 'Use /api/nfse-download-danfse: o PDF é gerado a partir do XML autorizado, com o mesmo conteúdo fiscal (número, chave e prestador do cadastro nacional).',
        rota_alternativa: `/api/nfse-download-danfse?emission_id=${em.id}`,
        rota_tentada: `https://${host}${ROTA.replace('{chave}', em.chave_acesso)}`,
        emission_id: em.id,
        http_status: r.status,
      })
    }

    return res.status(502).json({
      error: 'O portal não devolveu um PDF',
      http_status: r.status,
      content_type: r.tipo,
      detalhe: r.erro,
      rota_alternativa: `/api/nfse-download-danfse?emission_id=${em.id}`,
    })
  } catch (err) {
    if (err.code === 'CERT_NOT_FOUND') {
      return res.status(422).json({ error: 'Certificado digital não configurado para esta empresa' })
    }
    console.error('[nfse-download-pdf-oficial] falha:', err.message)
    return res.status(500).json({ error: 'Erro ao buscar o PDF oficial' })
  }
}
