// Dono único do "quantos dias faltam e quão grave é isso".
//
// ⚠️ Três lugares precisam desta conta — o GET de /api/nfse-certificate, o cron
// de monitoramento e o validateCertificate do cert-manager. No esboço cada um
// tinha a sua cópia, com limiares repetidos e arredondamentos diferentes
// (ceil num, floor no outro). É a história do pró-labore com três donos, e o
// sintoma seria o mesmo: a tela dizendo "8 dias / AVISO" enquanto o e-mail
// chega escrito "CRÍTICO: 7 dias".

export const LIMIAR_CRITICO = 7
export const LIMIAR_AVISO = 30

const DIA_MS = 24 * 60 * 60 * 1000

/**
 * @param {Date|string} validUntil  fim da validade
 * @param {Date}        now
 * @param {Date|string} [validFrom] início da validade (opcional)
 */
export function statusDoCertificado(validUntil, now = new Date(), validFrom = null) {
  const fim = new Date(validUntil)
  const inicio = validFrom ? new Date(validFrom) : null

  // Normaliza o -0 que o Math.ceil produz para um vencimento de horas atrás.
  const diasRestantes = Math.ceil((fim - now) / DIA_MS) || 0

  const base = { diasRestantes, validFrom: inicio, validUntil: fim }

  // ⚠️ A expiração é decidida pela DATA, nunca pelo dia arredondado. Um
  // certificado que venceu há duas horas dá `Math.ceil(-0.08) === -0`, que não
  // é `< 0`: ele cairia na faixa "<= 7 dias" e apareceria como CRÍTICO, com a
  // tela oferecendo renovar "em 0 dias" um certificado que já não assina nada.
  if (now > fim) {
    return { ...base, status: 'expired', severity: 'expired', alertType: 'expired', precisaAlerta: true }
  }
  if (inicio && now < inicio) {
    return { ...base, status: 'not_yet_valid', severity: null, alertType: null, precisaAlerta: false }
  }
  if (diasRestantes <= LIMIAR_CRITICO) {
    return { ...base, status: 'critical', severity: 'critical', alertType: 'expiring_7d', precisaAlerta: true }
  }
  if (diasRestantes <= LIMIAR_AVISO) {
    return { ...base, status: 'warning', severity: 'warning', alertType: 'expiring_30d', precisaAlerta: true }
  }
  return { ...base, status: 'ok', severity: null, alertType: null, precisaAlerta: false }
}
