// Contrato × regra financeira — dono único de "o que o contrato herda da regra".
// Puro (sem `neon`): usado pela tela de contratos, pelo /billing e por api/invoices.js.
//
// Quem é a fonte de cada número depende de COMO o contrato é faturado:
//
//   hora / dia            → pela Agenda (calcAgenda / calcPorUnidade, e o apontamento em
//                           lib/time-entry-calc.js). Valor, fixo do Victor, split e imposto
//                           saem da REGRA; do contrato só o deslocamento. Os campos
//                           espelhados no contrato não entram em conta nenhuma — por isso a
//                           tela os mostra somente leitura.
//   mensal / contract     → pelo modo Contrato (calcContrato), que lê TUDO do contrato.
//   por_projeto           → pelo modo Projeto (calcProjeto), idem.
//                           Nesses dois a regra só pré-preenche; o contrato continua sendo
//                           a fonte, e a tela avisa quando ele diverge dela (SteelDek tem
//                           7% no contrato e nada na regra #6, de propósito).
//
// ⚠️ Um contrato hora/dia nunca é faturado pelo modo Contrato: calcContrato leria os
// espelhos do contrato, e o mesmo serviço teria dois cálculos conforme o botão usado.
// A tela de faturamento não o lista e o backend recusa com 400.
import { tipoDaRegra, valoresDaRegra } from './billing-type.js'

export const TIPOS_CONTRATO_AGENDA = ['hora', 'dia']

export function faturaPelaAgenda(contrato) {
  return TIPOS_CONTRATO_AGENDA.includes(contrato?.billing_type)
}

// Tipo do contrato compatível com o tipo da regra.
const TIPO_CONTRATO_DA_REGRA = { hora: 'hora', diaria: 'dia', projeto: 'mensal' }

const num = (v) => {
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

// "R$ 1.500,00" sem Intl — num runtime sem ICU completo o toLocaleString('pt-BR') cai em
// silêncio para o formato inglês (mesmo cuidado da memória de cálculo fiscal).
export function brl(v) {
  const n = Number(v) || 0
  const [int, dec] = Math.abs(n).toFixed(2).split('.')
  return `${n < 0 ? '−' : ''}R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`
}

export function rotuloDaRegra(rule) {
  const { tipo, unitario } = valoresDaRegra(rule)
  const nome = rule.client_name ? `${rule.client_name} — ` : ''
  if (tipo === 'diaria') return `${nome}Diária ${brl(unitario)}${rule.is_net_value ? ' (líquido)' : ''}`
  if (tipo === 'projeto') return `${nome}Fixo mensal ${brl(unitario)}${rule.is_net_value ? ' (líquido)' : ''}`
  return `${nome}${brl(unitario)}/h`
}

// Campos do contrato que a regra preenche ao ser escolhida.
// `atual` é o form do contrato: um contrato por parcelas (ou o 'contract' legado do
// SteelDek) com regra por projeto mantém o próprio tipo — trocar para 'mensal' jogaria
// fora as parcelas.
export function camposDaRegra(rule, atual = {}) {
  const { tipo, unitario, victor_fixo } = valoresDaRegra(rule)
  const manterTipo = tipo === 'projeto' && ['por_projeto', 'contract'].includes(atual.billing_type)
  return {
    billing_type: manterTipo ? atual.billing_type : TIPO_CONTRATO_DA_REGRA[tipo],
    contract_value: unitario ? String(unitario) : '',
    victor_fixed: victor_fixo ? String(victor_fixo) : '0',
    remainder_victor_pct: String(num(rule.remainder_victor_pct) ?? 50),
    remainder_fabricio_pct: String(num(rule.remainder_fabricio_pct) ?? 50),
    has_tax: !!rule.has_tax,
    tax_percentage: rule.has_tax && num(rule.tax_percentage) != null ? String(num(rule.tax_percentage)) : '',
  }
}

// Onde o contrato difere da regra vinculada. → { campo: 'texto da regra' }
// Só faz sentido nos contratos que são a própria fonte (mensal/contract/projeto); nos
// faturados pela Agenda os espelhos são sobrescritos pela regra ao salvar.
export function divergenciasDaRegra(contrato, rule) {
  if (!rule) return {}
  const esperado = camposDaRegra(rule, contrato)
  const d = {}
  const tipoRegra = tipoDaRegra(rule)
  const compativel = esperado.billing_type === contrato.billing_type
    || (tipoRegra === 'projeto' && ['mensal', 'contract', 'por_projeto'].includes(contrato.billing_type))
  if (!compativel) d.billing_type = { hora: 'por hora', diaria: 'por diária', projeto: 'fixo mensal' }[tipoRegra]
  const difere = (a, b) => Math.abs((num(a) ?? 0) - (num(b) ?? 0)) >= 0.005
  if (contrato.billing_type !== 'por_projeto') {
    if (difere(contrato.contract_value, esperado.contract_value)) d.contract_value = brl(esperado.contract_value)
    if (difere(contrato.victor_fixed, esperado.victor_fixed)) d.victor_fixed = brl(esperado.victor_fixed)
  }
  if (difere(contrato.remainder_victor_pct, esperado.remainder_victor_pct) || difere(contrato.remainder_fabricio_pct, esperado.remainder_fabricio_pct)) {
    d.split = `${num(esperado.remainder_victor_pct)}/${num(esperado.remainder_fabricio_pct)}`
  }
  const impContrato = contrato.has_tax ? (num(contrato.tax_percentage) ?? 0) : null
  const impRegra = esperado.has_tax ? (num(esperado.tax_percentage) ?? 0) : null
  if (impContrato !== impRegra) d.imposto = impRegra == null ? 'sem imposto' : `${impRegra}%`
  return d
}
