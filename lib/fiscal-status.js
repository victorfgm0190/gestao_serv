import { PAID_EPSILON } from './payment-status.js'

// Estado de uma fiscal_obligations. Fonte ÚNICA — usada por api/fiscal-payments.js
// (ao pagar/estornar) e por api/fiscal-obligations.js (ao lançar a guia oficial).
//
// Mora aqui pelo mesmo motivo de lib/payment-status.js: quando duas rotas
// calculavam o status do mesmo registro por conta própria, elas divergiam e o
// registro oscilava de estado conforme o caminho que o tocasse por último.

const num = (v) => parseFloat(v) || 0

// Valor devido: a guia oficial quando já chegou, senão a estimativa.
// Checagem por null, não por falsy — uma guia legítima de R$ 0,00 não pode
// cair de volta na estimativa.
export const valorDevido = (ob) =>
  ob.amount_actual !== null && ob.amount_actual !== undefined
    ? num(ob.amount_actual)
    : num(ob.amount_estimated)

// Status a partir do total pago. Duas diferenças em relação ao statusFor() dos
// payables, que só têm 3 estados:
//  1. o estado "sem pagamento" não é único — é 'apurado' se a guia oficial já
//     chegou (amount_actual preenchido) e 'previsto' se não. Estornar tudo precisa
//     devolver a obrigação ao estado em que ela estava, não rebaixá-la a 'previsto'.
//  2. PAID_EPSILON é reaproveitado: comparar `pago >= total` exato faz um registro
//     quitado com resíduo de centavos oscilar entre 'pago' e 'parcial'.
// Nada devido (guia de R$ 0,00, ou estimativa zerada) já nasce liquidado. Sem essa
// primeira cláusula a obrigação ficava presa em 'apurado'/'previsto' para sempre:
// aparecia como pendente e não havia como quitá-la, porque registrar pagamento exige
// amount > 0.
export function statusObrigacao(pago, total, temGuiaOficial) {
  if (total <= PAID_EPSILON) return 'pago'
  if (pago <= PAID_EPSILON) return temGuiaOficial ? 'apurado' : 'previsto'
  if (pago >= total - PAID_EPSILON) return 'pago'
  return 'parcial'
}

// UPDATE que re-soma fiscal_payments e regrava paid_amount/status da obrigação.
// Sempre derivado da soma real — nunca `paid_amount + valor`, que acumularia
// qualquer divergência em vez de corrigi-la. O CASE espelha statusObrigacao().
//
// Devolve a query SEM await, para poder entrar num sql.transaction([...]).
export const recalcularObrigacao = (sql, obligation_id) => sql`
  UPDATE fiscal_obligations o SET
    paid_amount = s.total,
    status = CASE
      WHEN COALESCE(o.amount_actual, o.amount_estimated, 0) <= ${PAID_EPSILON}
        THEN 'pago'
      WHEN s.total <= ${PAID_EPSILON}
        THEN CASE WHEN o.amount_actual IS NOT NULL THEN 'apurado' ELSE 'previsto' END
      WHEN s.total >= COALESCE(o.amount_actual, o.amount_estimated, 0) - ${PAID_EPSILON}
        THEN 'pago'
      ELSE 'parcial'
    END,
    updated_at = now()
  FROM (
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM fiscal_payments WHERE obligation_id = ${obligation_id}
  ) s
  WHERE o.id = ${obligation_id}
  RETURNING o.*`
