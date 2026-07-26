// REDISTRIBUIÇÃO FISCAL — reconciliação entre imposto PROVISIONADO e imposto REAL.
//
// O problema que isto resolve: na emissão da fatura o imposto é uma PROVISÃO
// (`contracts.tax_percentage`, hoje 7%), descontada do bruto antes de compor o que o
// Victor recebe. O custo fiscal REAL do mês só se conhece depois — é a alíquota
// efetiva do Simples (Anexo III 1ª faixa = 6%) sobre o faturamento, mais INSS e
// honorários, rateados por cliente em `fiscal_allocations`.
//
// Até aqui esses dois números nunca se encontravam: `fiscal_allocations.adjustment`
// (= real − provisionado) era gravado e nunca lido por ninguém. A diferença ficava
// implícita no bolso do Victor, para mais ou para menos, sem registro.
//
// As três etapas que o sistema enxerga:
//   ETAPA 1  fatura emitida        → baseline: `invoices.victor_service/victor_profit`
//   ETAPA 2  mês apurado           → real = rateio de `amount_estimated`
//   ETAPA 3  guia oficial chegou   → real = rateio de `amount_actual`
// As três leem a MESMA base; muda só qual valor da obrigação alimenta o rateio.
//
// Competência × caixa: tudo aqui é competência (mês da NF). O lado caixa continua
// sendo `payables_victor.payment_month/payment_year`, que esta função não toca.

const r2 = (v) => Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100
const num = (v) => parseFloat(v) || 0

// A diferença fiscal é absorvida SÓ pelo Victor — o DAS/INSS/honorários saem do CNPJ
// dele, e a provisão de 7% é o que foi combinado com o Fabrício na fatura. Mexer no
// `fabricio_total` mudaria retroativamente um valor já acordado, então não se mexe.
export const AJUSTE_SO_VICTOR = true

// Cascata do desconto: o lucro absorve primeiro, o serviço só depois.
// Espelha a ordem do consumo de saldos em lib/victor-distribution.js — imposto tira
// do lucro antes de tirar do trabalho. Quando nem o serviço cobre, sobra `nao_coberto`,
// que sai do capital do Victor e não vira payable negativo.
export function aplicarDelta(service_antes, profit_antes, delta) {
  const s0 = r2(service_antes)
  const p0 = r2(profit_antes)
  const d = r2(delta)

  // Imposto real MENOR que o provisionado: sobra volta para o Victor, no lucro.
  if (d <= 0) {
    return {
      service_depois: s0,
      profit_depois: r2(p0 - d),
      from_profit: r2(d),
      from_service: 0,
      nao_coberto: 0,
    }
  }

  const from_profit = r2(Math.min(d, Math.max(p0, 0)))
  const resto = r2(d - from_profit)
  const from_service = r2(Math.min(resto, Math.max(s0, 0)))
  return {
    service_depois: r2(s0 - from_service),
    profit_depois: r2(p0 - from_profit),
    from_profit,
    from_service,
    nao_coberto: r2(resto - from_service),
  }
}

// Custo fiscal real de uma fatura = soma do rateio dela, por tipo de obrigação.
// Só linhas `proporcional_nf`: as de `consumo_payable` registram o abatimento nos
// payables, não o rateio, e somá-las contaria o mesmo imposto duas vezes.
export function realPorKind(alocacoes, invoice_id) {
  const porKind = {}
  let total = 0
  for (const a of alocacoes) {
    if (a.basis !== 'proporcional_nf') continue
    if (Number(a.invoice_id) !== Number(invoice_id)) continue
    const v = r2(num(a.amount))
    porKind[a.kind] = r2((porKind[a.kind] || 0) + v)
    total = r2(total + v)
  }
  return { porKind, total }
}

// Núcleo do recálculo de UMA fatura. Puro: não lê nem escreve banco.
//
//   invoice      linha de `invoices` (baseline da ETAPA 1)
//   alocacoes    linhas de fiscal_allocations do mês, com `kind` já resolvido
//   payable      linha de payables_victor da fatura, se já existir (pode ser null)
//   overridePct  simulação: força o custo fiscal a NF × pct em vez do rateio apurado
//
// `antes` sai do payable quando ele existe (é o valor vigente que o Victor vê hoje) e
// da fatura quando não — assim reexecutar é idempotente em vez de acumular o ajuste.
export function recalcularInvoice({ invoice, alocacoes = [], payable = null, overridePct = null }) {
  const provisionado = r2(num(invoice.tax_amount))
  const { porKind, total } = realPorKind(alocacoes, invoice.id)

  const simulado = overridePct !== null && overridePct !== undefined && overridePct !== ''
  const real = simulado ? r2(num(invoice.invoice_value) * Number(overridePct)) : total

  // Baseline da fatura: victor_tax_diff (gross-up do imposto do cliente) entra no lucro,
  // como faz o INSERT de payables_victor em api/invoices.js.
  const baseService = r2(num(invoice.victor_service))
  const baseProfit = r2(num(invoice.victor_profit) + num(invoice.victor_tax_diff))

  const service_antes = payable ? r2(num(payable.service_amount)) : baseService
  const profit_antes = payable ? r2(num(payable.profit_amount)) : baseProfit

  // O ajuste é sempre medido contra a BASE da fatura, nunca contra o payable já
  // ajustado. Sem isto, recalcular duas vezes descontaria o imposto real duas vezes.
  const delta = r2(real - provisionado)
  const alvo = aplicarDelta(baseService, baseProfit, delta)

  const total_antes = r2(service_antes + profit_antes)
  const total_depois = r2(alvo.service_depois + alvo.profit_depois)

  return {
    invoice_id: invoice.id,
    client_id: invoice.client_id,
    simulado,
    provisionado,
    real,
    delta,
    por_kind: porKind,
    nao_coberto: alvo.nao_coberto,
    from_service: alvo.from_service,
    from_profit: alvo.from_profit,
    mudou: Math.abs(r2(total_depois - total_antes)) >= 0.01,
    // ETAPA 1: o que a fatura prometeu ao Victor, com a provisão de imposto embutida.
    // Fica separado de `mudancas.*.antes` porque este último é o valor VIGENTE — depois
    // de uma redistribuição aplicada os dois deixam de coincidir, e é justamente a
    // distância entre eles que a tela mostra como "mudou de X para Y".
    baseline: { service: baseService, profit: baseProfit, total: r2(baseService + baseProfit) },
    mudancas: {
      servico_victor: linha(service_antes, alvo.service_depois),
      lucro_victor: linha(profit_antes, alvo.profit_depois),
      total_victor: linha(total_antes, total_depois),
      imposto: linha(provisionado, real),
    },
    payable_id: payable?.id ?? null,
    // Sem payable a fatura ainda não foi recebida: há o que mostrar, não o que gravar.
    aplicavel: !!payable,
  }
}

const linha = (antes, depois) => ({
  antes: r2(antes),
  depois: r2(depois),
  diferenca: r2(depois - antes),
})

// Consolida vários recálculos no formato de resposta do endpoint.
export function consolidar(resultados) {
  const soma = (sel) => r2(resultados.reduce((s, r) => s + sel(r), 0))
  const kinds = {}
  for (const r of resultados) {
    for (const [k, v] of Object.entries(r.por_kind)) kinds[k] = r2((kinds[k] || 0) + v)
  }
  return {
    baseline: {
      service: soma((r) => r.baseline.service),
      profit: soma((r) => r.baseline.profit),
      total: soma((r) => r.baseline.total),
    },
    servico_victor: agregado(resultados, 'servico_victor'),
    lucro_victor: agregado(resultados, 'lucro_victor'),
    total_victor: agregado(resultados, 'total_victor'),
    imposto: agregado(resultados, 'imposto'),
    por_kind: kinds,
    total_recebimento: soma((r) => r.mudancas.total_victor.depois),
    total_impostos: soma((r) => r.real),
    nao_coberto: soma((r) => r.nao_coberto),
  }
}

const agregado = (resultados, campo) => {
  const antes = resultados.reduce((s, r) => s + r.mudancas[campo].antes, 0)
  const depois = resultados.reduce((s, r) => s + r.mudancas[campo].depois, 0)
  return linha(antes, depois)
}
