import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import { registrarEvento, EVENTOS } from '../lib/nfse-events.js'
import { registrarOperacaoLocal, OPERACOES } from '../lib/nfse-operations.js'

// Registra, no sistema, um cancelamento que foi feito NO PORTAL.
//
// POST /api/nfse-sincronizar-cancelamento
//   { emission_id, motivo?, confirmar: true }
//
// Serve o caso em que a nota foi cancelada por fora daqui (pelo portal do
// SEFIN, pela contabilidade) e o sistema segue achando que ela vale — o que
// trava a fatura: `idx_nfse_emissions_invoice_unica` e a guarda de
// /api/nfse-emit só liberam nova emissão quando `cancelled_at` está preenchido.
//
// ⚠️ ESTE ENDPOINT NÃO FALA COM O FISCO — ele registra uma DECLARAÇÃO. Nenhuma
// consulta ao portal comprova o cancelamento: `consultarNFSe` devolve o XML da
// nota, não o evento que a cancelou. Por isso o `confirmar: true` explícito, no
// lugar da prévia que /api/nfse-cancel e /api/nfse-emit usam: aqui não há XML a
// conferir, e o risco é o oposto do delas — marcar como cancelada uma nota que
// segue valendo na prefeitura libera a fatura e produz a SEGUNDA nota do mesmo
// serviço. Quando o cancelamento ainda não foi feito, o caminho é
// /api/nfse-cancel, que cancela de verdade.
//
// ⚠️ O status é 'cancelada', do vocabulário real gravado por /api/nfse-emit e
// /api/nfse-cancel — não 'cancelled'. Status fora da lista não arquiva nada:
// some dos badges da tela, do `CANCELAVEIS` do cancelamento e do `ACIONAVEIS`
// da lista, sem erro nenhum. É a mesma armadilha do "status estornado".
export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { emission_id, motivo = '', confirmar = false } = req.body || {}

  const emissionId = parseInt(emission_id, 10)
  if (!Number.isInteger(emissionId)) {
    return res.status(400).json({ error: 'emission_id é obrigatório' })
  }

  try {
    const sql = neon(process.env.DATABASE_URL)

    const [em] = await sql`
      SELECT ne.id, ne.company_id, ne.invoice_id, ne.nfse_number, ne.status,
             ne.cancelled_at, ne.chave_acesso, ne.ambiente, i.invoice_number
      FROM nfse_emissions ne
      JOIN invoices i ON i.id = ne.invoice_id
      WHERE ne.id = ${emissionId}`

    if (!em) return res.status(404).json({ error: 'Emissão não encontrada' })

    // Já sincronizada (ou cancelada por aqui): a fatura JÁ está liberada, que é
    // o objetivo desta rota. Responder 409 faria a re-emissão travar numa
    // segunda tentativa depois de a emissão ter falhado — o pior momento para
    // exigir que o usuário descubra que o passo anterior já tinha dado certo.
    if (em.cancelled_at || em.status === 'cancelada') {
      return res.status(200).json({
        success: true,
        ja_cancelada: true,
        mensagem: 'Esta NFS-e já constava cancelada. A fatura está liberada para re-emitir.',
        invoice_id: em.invoice_id,
        nfse_cancelada: em.nfse_number,
        cancelada_em: em.cancelled_at,
      })
    }

    // 'erro' nunca virou nota no fisco e 'substituida' foi trocada por outra —
    // nos dois casos o índice parcial já libera a fatura, e marcar
    // `cancelled_at` inventaria um cancelamento que não houve.
    if (em.status === 'erro' || em.status === 'substituida') {
      return res.status(422).json({
        error: `NFS-e com status "${em.status}" não tem cancelamento a sincronizar`,
        detalhe: em.status === 'erro'
          ? 'A transmissão falhou; nenhuma nota foi autorizada. A fatura já está liberada para emitir.'
          : 'Esta nota foi substituída por outra. Cancele ou sincronize o cancelamento da substituta.',
        invoice_id: em.invoice_id,
      })
    }

    if (confirmar !== true) {
      return res.status(400).json({
        error: 'Confirmação obrigatória',
        detalhe:
          'Envie confirmar: true declarando que a NFS-e já foi cancelada no portal. ' +
          'Este endpoint não verifica o fisco — se a nota ainda valer lá, a fatura será ' +
          'liberada e uma segunda nota do mesmo serviço poderá ser emitida.',
        alternativa: 'Para cancelar de verdade, use /api/nfse-cancel.',
      })
    }

    const marca = {
      sincronizacao_cancelamento: {
        em: new Date().toISOString(),
        status_anterior: em.status,
        motivo: String(motivo || '').trim() || null,
      },
    }

    // O status anterior fica gravado nos dois lugares (json_response e evento):
    // é a única pista de que a nota estava 'autorizada' quando foi marcada.
    await sql`
      UPDATE nfse_emissions
      SET status = 'cancelada',
          cancelled_at = NOW(),
          updated_at = NOW(),
          json_response = COALESCE(json_response, '{}'::jsonb) || ${JSON.stringify(marca)}::jsonb
      WHERE id = ${em.id}`

    // origem 'manual': o fato não foi observado por nós nem entregue pelo
    // emissor — foi declarado por uma pessoa. A timeline mostra isso.
    await registrarEvento(sql, em.id, EVENTOS.CANCELAMENTO_SINCRONIZADO, {
      motivo: String(motivo || '').trim() || 'Cancelamento efetuado no portal',
      status_original: em.status,
      nfse_number: em.nfse_number,
      chave_acesso: em.chave_acesso,
    }, { origem: 'manual' })

    // Sem envio e sem resposta — entra completa numa linha só, para a trilha
    // de operações da nota não ter um buraco justamente onde o status mudou.
    await registrarOperacaoLocal(sql, {
      company_id: em.company_id, invoice_id: em.invoice_id, nfse_emission_id: em.id,
      operation_type: OPERACOES.SINCRONIZACAO, ambiente: em.ambiente,
      json_resposta: marca.sincronizacao_cancelamento,
    })

    return res.status(200).json({
      success: true,
      ja_cancelada: false,
      mensagem: 'Cancelamento sincronizado. A fatura está liberada para re-emitir.',
      invoice_id: em.invoice_id,
      invoice_number: em.invoice_number,
      nfse_cancelada: em.nfse_number,
      status_anterior: em.status,
    })
  } catch (err) {
    console.error('[nfse-sincronizar-cancelamento] falha:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
