// Cálculo de um apontamento — função PURA, compartilhada pelo backend
// (api/time-entries.js, api/recalc-time-entries.js) e pelo preview da tela de horas
// (src/pages/TimeEntries.jsx). Antes a fórmula vivia duplicada no browser e as duas
// cópias só eram "linha a linha equivalentes" por disciplina; aqui não importa `neon`,
// então o Vite a empacota direto.
import { tipoDaRegra } from './billing-type.js'

// Split cadastrado. Não usar `|| 50`: um split legítimo de 0% (cliente 100/0)
// é falsy e viraria 50%, pagando Fabrício indevidamente.
function splitPct(value, fallback) {
  const n = parseFloat(value)
  return isNaN(n) ? fallback : n
}

// `cota` só vale para regra que não é por hora (ver lib/billing-type.js):
//   diaria  → { bruto, victor_fixo } = a fatia da diária que cabe a este apontamento
//   projeto → ausente: o apontamento é demonstrativo, o valor está no fixo mensal
// Por hora ela é ignorada e o cálculo é exatamente o histórico.
export function calcular(horas, regra, horas_deslocamento = 0, contrato = null, despesas_deslocamento = 0, cota = null) {
  const hours = parseFloat(horas) || 0  // horas de trabalho (sem deslocamento)
  const horas_desloc = parseFloat(horas_deslocamento) || 0
  const despesas_desloc = parseFloat(despesas_deslocamento) || 0
  const porHora = tipoDaRegra(regra) === 'hora'
  // Fora da regra por hora não existe "valor hora": o preço do deslocamento vem só do
  // contrato (`deslocamento_valor_hora`), e o fallback abaixo cai em 0.
  const valor_hora = porHora ? (parseFloat(regra.hourly_rate) || 0) : 0
  const imposto_pct = regra.has_tax ? (parseFloat(regra.tax_percentage) || 0) / 100 : 0

  const deslocamento_tipo = contrato?.deslocamento_tipo || 'nao_cobrado'
  const deslocamento_valor_hora = parseFloat(contrato?.deslocamento_valor_hora) || 0
  const valor_hora_desloc = deslocamento_valor_hora || valor_hora

  // Valor LÍQUIDO (imposto por fora), só em diária/projeto: o imposto não sai do valor
  // informado — ele é somado por cima para formar a NF, e a diferença vai 100% para o
  // Victor pagar a guia. Mesma estrutura de calcContrato (SteelDek).
  if (!porHora && regra.is_net_value) {
    const liq_trab = parseFloat(cota?.bruto) || 0
    const liq_desloc = deslocamento_tipo === 'nao_cobrado' ? 0 : horas_desloc * valor_hora_desloc
    const liq_total = liq_trab + liq_desloc
    const nf = imposto_pct > 0 && imposto_pct < 1 ? liq_total / (1 - imposto_pct) : liq_total
    const tax = nf - liq_total
    const desp = deslocamento_tipo === 'hora_despesas' ? despesas_desloc : 0
    const v_serv = Math.min(parseFloat(cota?.victor_fixo) || 0, liq_trab)
    const rest = Math.max(liq_trab - v_serv, 0)
    const v_lucro = rest * splitPct(regra.remainder_victor_pct, 50) / 100
    const fab = rest * splitPct(regra.remainder_fabricio_pct, 50) / 100
    return {
      gross_value: parseFloat(nf.toFixed(2)),
      tax_amount: parseFloat(tax.toFixed(2)),
      net_value: parseFloat(liq_total.toFixed(2)),
      victor_share: parseFloat((liq_desloc + desp + v_serv + v_lucro + tax).toFixed(2)),
      fabricio_share: parseFloat(fab.toFixed(2)),
      fuel_cost: 0,
      valor_deslocamento: parseFloat((liq_desloc + desp).toFixed(2)),
    }
  }

  // Gross: se deslocamento é cobrado, cliente paga as horas de deslocamento também
  let gross, gross_desloc
  // Trabalho: horas × valor hora, ou a cota da diária (0 no projeto).
  const gross_trabalho = porHora ? hours * valor_hora : (parseFloat(cota?.bruto) || 0)
  if (deslocamento_tipo === 'nao_cobrado') {
    gross = gross_trabalho  // cliente não paga deslocamento
    gross_desloc = 0
  } else {
    gross = gross_trabalho
    gross_desloc = horas_desloc * valor_hora_desloc  // horas de deslocamento cobradas
  }
  const gross_total = gross + gross_desloc

  const tax = gross_total * imposto_pct
  const net = gross_total - tax
  const valor_hora_liq = valor_hora * (1 - imposto_pct)
  const valor_hora_desloc_liq = valor_hora_desloc * (1 - imposto_pct)

  // Deslocamento vai 100% pro Victor (fora do split)
  let victor_desloc = 0
  let victor_desloc_despesas = 0
  if (deslocamento_tipo === 'nao_cobrado') {
    victor_desloc = horas_desloc * valor_hora_liq
  } else if (deslocamento_tipo === 'hora') {
    victor_desloc = horas_desloc * valor_hora_desloc_liq
  } else if (deslocamento_tipo === 'hora_despesas') {
    victor_desloc = horas_desloc * valor_hora_desloc_liq
    victor_desloc_despesas = despesas_desloc
  }

  // Split só sobre horas de trabalho líquido
  const net_trabalho = gross * (1 - imposto_pct)
  const victor_fixo_total = porHora
    ? hours * (parseFloat(regra.victor_fixed_per_hour) || 0)
    : (parseFloat(cota?.victor_fixo) || 0)
  // Fixo do Victor sobre a hora BRUTA, limitado ao líquido do trabalho. Sem o teto,
  // quando o fixo iguala o valor/hora Victor levaria o bruto cheio de um valor do
  // qual o imposto já saiu, deixando-o sem lastro.
  const victor_servico = Math.min(victor_fixo_total, Math.max(net_trabalho, 0))
  const restante = Math.max(net_trabalho - victor_servico, 0)
  const victor_lucro = restante * splitPct(regra.remainder_victor_pct, 50) / 100
  const fabricio = restante * splitPct(regra.remainder_fabricio_pct, 50) / 100
  const victor_total = victor_desloc + victor_desloc_despesas + victor_servico + victor_lucro

  return {
    gross_value: parseFloat(gross_total.toFixed(2)),
    tax_amount: parseFloat(tax.toFixed(2)),
    net_value: parseFloat(net.toFixed(2)),
    victor_share: parseFloat(victor_total.toFixed(2)),
    fabricio_share: parseFloat(fabricio.toFixed(2)),
    fuel_cost: 0,
    valor_deslocamento: parseFloat((victor_desloc + victor_desloc_despesas).toFixed(2)),
  }
}
