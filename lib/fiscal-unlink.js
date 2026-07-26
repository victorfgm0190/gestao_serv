// DESFAZER O ABATIMENTO FISCAL quando um payable do Victor é estornado por fora.
//
// O problema: `?action=distribuir` quita obrigações fiscais consumindo saldo dos
// payables do Victor. Isso deixa três registros amarrados:
//   payable_payments                     o dinheiro saindo do payable
//   fiscal_allocations (consumo_payable) o elo obrigação ↔ payable ↔ pagamento
//   fiscal_payments (method='abatimento') a quitação da obrigação
//
// Os estornos do lado do faturamento (payables-victor, receivables, invoices) apagavam
// só o primeiro. A FK `fiscal_allocations.payable_payment_id ON DELETE CASCADE` levava o
// segundo junto, mas o TERCEIRO sobrevivia e ninguém recalculava a obrigação: o DAS
// continuava marcado como pago enquanto o dinheiro voltava para o saldo do Victor — o
// mesmo dinheiro contado duas vezes. E como não sobrava alocação com `payable_victor_id`,
// o "Estornar abatimento" da tela /fiscal passava a dizer "não foi distribuído",
// deixando o estado sem conserto pela interface.
//
// A unidade de reversão é o MÊS, não o payable. A distribuição é montada por competência
// (um pool rateado entre vários payables) e o `?action=distribuir` trata o mês como
// atômico — a guarda dos 409 recusa distribuir de novo enquanto houver qualquer elo.
// Reverter só o pedaço de um payable deixaria a obrigação parcialmente quitada por um
// rateio que não existe mais. Então tocar em um payable distribuído desfaz a
// distribuição inteira daquele mês, e o mês volta a poder ser distribuído.

import { recalcularObrigacao } from './fiscal-status.js'

// Recompõe paid_amount/status de um payable do Victor a partir dos pagamentos que
// SOBRARAM. Sempre derivado da soma real, nunca por subtração — subtrair acumula
// divergência em vez de corrigi-la. Mesmo UPDATE do estornarDistribuicao.
const recomporPayable = (sql, id) => sql`
  UPDATE payables_victor p SET
    paid_amount = s.total,
    status = CASE WHEN s.total <= 0.01 THEN 'pendente'
                  WHEN s.total >= p.total_amount - 0.01 THEN 'pago'
                  ELSE 'parcial' END,
    paid_at = s.ultimo
  FROM (SELECT COALESCE(SUM(amount),0) total, MAX(paid_at) ultimo
        FROM payable_payments WHERE payable_type='victor' AND payable_id=${id}) s
  WHERE p.id = ${id}`

// Desfaz a distribuição fiscal de todo mês que tenha consumido qualquer um dos
// `payableIds`. Idempotente: sem elo fiscal, não faz nada e devolve zeros.
//
// Deve rodar ANTES de o chamador apagar payables ou pagamentos — precisa enxergar as
// alocações para saber o que reverter.
//
// `ignorarPayables` são payables que o chamador vai apagar de qualquer forma; não
// adianta recompor o saldo deles.
export async function desfazerAbatimentoFiscal(sql, payableIds, { ignorarPayables = [] } = {}) {
  const ids = [...new Set((payableIds || []).map(Number).filter(Boolean))]
  if (!ids.length) return { obrigacoes: [], payables_recompostos: [], pagamentos_removidos: 0 }

  // Obrigações tocadas por estes payables.
  const tocadas = await sql`
    SELECT DISTINCT obligation_id FROM fiscal_allocations
    WHERE payable_victor_id = ANY(${ids})`
  if (!tocadas.length) return { obrigacoes: [], payables_recompostos: [], pagamentos_removidos: 0 }
  const obIds = tocadas.map((o) => o.obligation_id)

  // A distribuição INTEIRA dessas obrigações — inclusive payables que o chamador nem
  // mencionou, porque o pool do mês foi rateado entre todos eles.
  const elos = await sql`
    SELECT DISTINCT payable_victor_id, payable_payment_id FROM fiscal_allocations
    WHERE obligation_id = ANY(${obIds}) AND payable_victor_id IS NOT NULL`

  const paymentIds = [...new Set(elos.map((e) => e.payable_payment_id).filter(Boolean))]
  const payableIdsTodos = [...new Set(elos.map((e) => e.payable_victor_id).filter(Boolean))]

  // Apagar os pagamentos leva as alocações junto pela FK ON DELETE CASCADE.
  if (paymentIds.length) {
    await sql`DELETE FROM payable_payments WHERE payable_type = 'victor' AND id = ANY(${paymentIds})`
  }
  // Sobra de segurança: alocação cujo pagamento já sumiu antes (o CASCADE não teria o
  // que apagar) ficaria apontando para um payable estornado.
  await sql`
    DELETE FROM fiscal_allocations
    WHERE obligation_id = ANY(${obIds}) AND payable_victor_id IS NOT NULL`

  // A quitação por abatimento morre com a distribuição. `method='abatimento'` separa
  // essas linhas de pagamentos que o Victor tenha registrado à mão em /fiscal, que ficam.
  await sql`
    DELETE FROM fiscal_payments
    WHERE obligation_id = ANY(${obIds}) AND method = 'abatimento'`

  for (const id of obIds) await recalcularObrigacao(sql, id)

  const ignorar = new Set(ignorarPayables.map(Number))
  const recompor = payableIdsTodos.filter((id) => !ignorar.has(Number(id)))
  for (const id of recompor) await recomporPayable(sql, id)

  return {
    obrigacoes: obIds,
    payables_recompostos: recompor,
    pagamentos_removidos: paymentIds.length,
  }
}

// Payables do Victor gerados por uma fatura. Usado pelos estornos que apagam os
// payables inteiros (receivables e invoices) para saber o que desamarrar antes.
export async function payablesVictorDaFatura(sql, invoice_id) {
  const rows = await sql`SELECT id FROM payables_victor WHERE invoice_id = ${invoice_id}`
  return rows.map((r) => r.id)
}

// ── Trilha de auditoria do estorno ───────────────────────────────────────────────────
// Cada rota de estorno acrescenta a `notes` (sem apagar o que já estava lá) a linha
//   'Estornado em DD/MM/AAAA HH:MM (motivo)'
// com este trecho no SET, `motivo` como parâmetro:
//
//   notes = COALESCE(NULLIF(notes,'') || ' | ', '') || 'Estornado em ' ||
//           to_char(now() AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI') ||
//           COALESCE(' (' || ${motivo}::text || ')', '')
//
// Fica escrito em cada rota em vez de virar helper porque o driver do Neon não compõe
// fragmentos: uma tagged template aninhada viraria parâmetro, não SQL.
//
// Por que o estorno NÃO grava status='estornado': esse valor não existe no vocabulário
// de nenhuma tabela (payables pendente|parcial|pago, receivables pendente|pago, invoices
// pendente|recebido). O registro sumiria dos filtros de todas as telas, do CASE de
// recalcularObrigacao() e do `status IN ('pendente','parcial')` de candidatosDisponiveis(),
// e a cascata de consumo passaria a ignorá-lo em silêncio. Seria também semanticamente
// errado: estornar um payable não o mata, devolve-o a PENDENTE — o valor continua devido,
// e estornar uma fatura a devolve a PENDENTE justamente para poder ser refaturada.
// O que se quer de um 'estornado' (o rastro do que houve) é o que a nota entrega, sem
// quebrar as máquinas de estado.
