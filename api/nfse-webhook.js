import crypto from 'node:crypto'
import { neon } from '@neondatabase/serverless'
import { registrarEvento, EVENTOS } from '../lib/nfse-events.js'

// Recebe avisos de mudança de status de NFS-e.
//
// 🔒 Rota PÚBLICA por necessidade (quem chama é o emissor, não um usuário
// logado), então a autenticação é a assinatura HMAC-SHA256 do corpo. As três
// decisões abaixo são o que separa isso de um portão aberto:
//
// ⚠️ ASSINATURA INVÁLIDA É RECUSADA. O esboço calculava o HMAC, logava
// "pode ser teste" e **seguia em frente** — qualquer um na internet podia
// mandar `{nsu, status:'cancelled'}` e alterar o estado fiscal de qualquer
// nota. Aqui um POST sem assinatura válida responde 401 e não toca no banco.
//
// ⚠️ SEM SEGREDO CONFIGURADO, A ROTA FECHA (503). O esboço caía em
// `'dev-secret'`, um segredo público que consta do repositório — pior que não
// ter, porque parece proteção. Mesmo princípio do JWT_SECRET.
//
// ⚠️ O HMAC É CALCULADO SOBRE O CORPO CRU. `JSON.stringify(req.body)` não
// reproduz os bytes que o emissor assinou (ordem de chaves, espaços, escapes),
// então a conferência falharia mesmo com o segredo certo. Por isso o parser de
// corpo é desligado aqui.
export const config = { api: { bodyParser: false } }

// Vocabulário do emissor → o nosso (o mesmo de api/nfse-emit.js).
const MAPA_STATUS = {
  approved: 'autorizada', autorizada: 'autorizada', autorizado: 'autorizada',
  rejected: 'rejeitada', rejeitada: 'rejeitada', rejeitado: 'rejeitada',
  cancelled: 'cancelada', canceled: 'cancelada', cancelada: 'cancelada',
  processing: 'enviada', processando: 'enviada', enviada: 'enviada',
}

const EVENTO_DE = {
  autorizada: EVENTOS.AUTORIZADA,
  rejeitada: EVENTOS.REJEITADA,
  cancelada: EVENTOS.CANCELADA,
  enviada: EVENTOS.ENVIADA,
}

function lerCorpoCru(req) {
  return new Promise((resolve, reject) => {
    const partes = []
    let bytes = 0
    req.on('data', (p) => {
      bytes += p.length
      // Um aviso de status tem centenas de bytes. O teto evita que um POST
      // gigante numa rota pública consuma a função inteira.
      if (bytes > 1_000_000) { reject(new Error('Corpo grande demais')); req.destroy() }
      partes.push(p)
    })
    req.on('end', () => resolve(Buffer.concat(partes)))
    req.on('error', reject)
  })
}

function assinaturaConfere(corpoCru, recebida, segredo) {
  if (!recebida) return false
  const esperado = crypto.createHmac('sha256', segredo).update(corpoCru).digest('hex')
  // Aceita "sha256=<hex>", formato comum de header de webhook.
  const limpa = String(recebida).replace(/^sha256=/i, '').trim().toLowerCase()
  const a = Buffer.from(esperado, 'utf8')
  const b = Buffer.from(limpa, 'utf8')
  // Comparação em tempo constante — `===` vaza o prefixo correto byte a byte.
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const segredo = process.env.NFSE_WEBHOOK_SECRET
  if (!segredo || segredo.length < 16) {
    console.error('[nfse-webhook] NFSE_WEBHOOK_SECRET ausente ou curto demais')
    return res.status(503).json({ error: 'Webhook não configurado no servidor' })
  }

  let corpoCru
  try {
    corpoCru = await lerCorpoCru(req)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  const recebida = req.headers['x-signature'] || req.headers['x-hub-signature-256']
  if (!assinaturaConfere(corpoCru, recebida, segredo)) {
    console.warn('[nfse-webhook] assinatura inválida — requisição descartada')
    return res.status(401).json({ error: 'Assinatura inválida' })
  }

  let corpo
  try {
    corpo = JSON.parse(corpoCru.toString('utf8'))
  } catch {
    return res.status(400).json({ error: 'Corpo não é JSON válido' })
  }

  const { nsu, status, event, timestamp, chaveAcesso } = corpo
  if (!nsu && !chaveAcesso) {
    return res.status(400).json({ error: 'nsu ou chaveAcesso é obrigatório' })
  }

  // ⚠️ Status fora da lista é RECUSADO, não repassado. O esboço fazia
  // `statusMap[status] || status` e depois interpolava o resultado direto na
  // string SQL: `SET status = '${newStatus}'`. Isso é injeção de SQL por um
  // campo que vem da internet — o defeito mais grave desta etapa.
  const novoStatus = MAPA_STATUS[String(status || '').toLowerCase()]
  if (!novoStatus) {
    return res.status(400).json({
      error: `Status desconhecido: "${status}"`,
      aceitos: [...new Set(Object.values(MAPA_STATUS))],
    })
  }

  try {
    const sql = neon(process.env.DATABASE_URL)

    const [em] = await sql`
      SELECT id, status, company_id, nfse_number FROM nfse_emissions
      WHERE (${nsu ?? null}::text IS NOT NULL AND nsu = ${nsu ?? null}::text)
         OR (${chaveAcesso ?? null}::text IS NOT NULL
             AND json_response->>'chaveAcesso' = ${chaveAcesso ?? null}::text)
      LIMIT 1`

    // NSU desconhecido: 200 de propósito. É o único caso em que reentregar não
    // adianta — a nota não é nossa —, e um 5xx aqui faria o emissor retentar
    // para sempre.
    if (!em) {
      console.warn(`[nfse-webhook] NSU/chave não encontrado: ${nsu ?? chaveAcesso}`)
      return res.status(200).json({ success: true, message: 'Emissão não encontrada — ignorado' })
    }

    // Tudo parametrizado; o CASE decide a coluna de data pelo status já
    // validado, sem montar SQL por concatenação.
    await sql`
      UPDATE nfse_emissions
      SET status = ${novoStatus},
          approved_at  = CASE WHEN ${novoStatus} = 'autorizada' THEN COALESCE(approved_at, NOW()) ELSE approved_at END,
          cancelled_at = CASE WHEN ${novoStatus} = 'cancelada'  THEN COALESCE(cancelled_at, NOW()) ELSE cancelled_at END,
          updated_at = NOW()
      WHERE id = ${em.id}`

    await registrarEvento(
      sql, em.id, EVENTO_DE[novoStatus] || `nfse.${novoStatus}`,
      { webhook: true, status_original: status, evento_original: event ?? null, payload: corpo },
      { origem: 'webhook', quando: timestamp || null }
    )

    return res.status(200).json({
      success: true, emission_id: em.id, statusAnterior: em.status, statusNovo: novoStatus,
    })
  } catch (err) {
    // ⚠️ 500, não 200. O esboço respondia 200 em erro "para não ficar
    // retentando" — é o contrário: com 200 o emissor considera entregue e o
    // aviso se perde para sempre. Falha nossa tem de pedir reentrega.
    console.error('[nfse-webhook] falha ao processar:', err.message)
    return res.status(500).json({ error: 'Falha ao processar o aviso', processed: false })
  }
}
