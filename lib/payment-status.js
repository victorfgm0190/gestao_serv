// Limiar único para considerar um payable quitado.
//
// Antes divergia: payable-payments.js comparava `sum >= total` (exato) e
// payables-victor.js usava `total - 0.005`. Um registro quitado pela
// distribuição virava 'pago' com resíduo de centavos e, ao passar por um
// recalculo, voltava para 'parcial' com saldo de R$ 0,00 — reaparecendo como
// pendente e podendo ser "pago" de novo.
export const PAID_EPSILON = 0.01

// Status do payable a partir do total pago e do valor devido.
export function statusFor(sum, total) {
  if (sum <= PAID_EPSILON) return 'pendente'
  if (sum >= total - PAID_EPSILON) return 'pago'
  return 'parcial'
}

// Saldo em aberto, nunca negativo.
export function remainingBalance(total, alreadyPaid) {
  return Math.max((Number(total) || 0) - (Number(alreadyPaid) || 0), 0)
}
