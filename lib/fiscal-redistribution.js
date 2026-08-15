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

// ── OPÇÃO 1 — O IMPOSTO NÃO É MAIS ABSORVIDO PELO QUE O VICTOR RECEBE ──────────────────
// Decisão do Victor, 2026-08-14.
//
// Até aqui o excedente do imposto real sobre a provisão de 7% era descontado do lucro e,
// no que não coubesse, do serviço do payable — o Victor "pagava" a guia automaticamente,
// recebendo menos. Efeito prático em produção: o payable #28 (Pharmalog, NF 6) tinha lucro
// 295,38 → 0,00 e serviço 8.500,00 → 8.452,95, e o card exibia lucro zerado sem que nada
// nele explicasse para onde o dinheiro tinha ido.
//
// A partir de agora o imposto fica DEVIDO ao fisco (fiscal_obligations, com seu próprio
// status e paid_amount) e é quitado com caixa real, em /fiscal ou pela aba. O payable do
// Victor mantém o que a fatura prometeu.
//
// É uma FLAG e não uma remoção de código de propósito: `aplicarDelta()` continua sendo a
// matemática correta da absorção, e é ela que a memória de cálculo e a cascata de exibição
// usam para dizer "o imposto comeria X do lucro". Voltar atrás é trocar `false` por `true`
// aqui — não reescrever cinco arquivos.
export const ABSORVER_IMPOSTO_NO_PAYABLE = false

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

// O que a redistribuição de fato APLICA ao payable, respeitando a Opção 1.
//
// Com `ABSORVER_IMPOSTO_NO_PAYABLE = false` o serviço e o lucro passam intactos e nada é
// "coberto": o imposto inteiro continua devido ao fisco, e é por isso que `nao_coberto`
// (a parte que viraria capital próprio) também é zero — não há absorção parcial a relatar.
//
// Tudo o que chama esta função em vez de `aplicarDelta` está no caminho de GRAVAÇÃO ou de
// exibição do payable. Quem quer a matemática da absorção — a memória de cálculo, a
// cascata do lucro — continua chamando `aplicarDelta` direto.
export function absorverDelta(service_antes, profit_antes, delta) {
  if (ABSORVER_IMPOSTO_NO_PAYABLE) return aplicarDelta(service_antes, profit_antes, delta)
  return {
    service_depois: r2(service_antes),
    profit_depois: r2(profit_antes),
    from_profit: 0,
    from_service: 0,
    nao_coberto: 0,
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

// CASCATA DO LUCRO — o waterfall que a aba Pagar Victor mostra por NF.
//
//   lucro bruto → −Escritório → −INSS → −DAS → lucro final
//
// De onde sai o ponto de partida (a decisão que faz a cascata FECHAR):
// `baseProfit` (invoices.victor_profit + victor_tax_diff) já vem LÍQUIDO da provisão de
// 7%, que foi retida do bruto antes do split. Se a cascata partisse dele e subtraísse
// DAS/INSS/honorários cheios, terminaria em `baseProfit − real`, enquanto o lucro que o
// Victor de fato recebe é `baseProfit − (real − provisão)`. A conta erraria pela provisão
// em TODA linha, sempre para menos.
//
// Partindo de `baseProfit + provisionado` a identidade fecha nos dois sentidos:
//   lucro_antes_das − das = baseProfit + provisão − real = profit_depois   ✓
// (vale tanto para delta > 0 quanto para delta ≤ 0, porque `aplicarDelta` devolve
// `p0 − delta` em ambos os ramos.) E é o número certo conceitualmente: "quanto sobraria
// para o Victor se não houvesse imposto nenhum".
//
// `lucro_final` aqui é a ARITMÉTICA da cascata e pode ser negativo. O que vai para
// `payables_victor.profit_amount` é clampado em zero por `aplicarDelta` — a diferença é
// absorvida pelo serviço e, no que sobrar, por `capital_proprio`. Os dois números são
// exibidos lado a lado de propósito: é aí que se enxerga o aporte.
//
// "Escritório" é o kind `honorarios` (os R$ 150 do escritório contábil, o único dos três
// rateados). `escritorio` é kind legado da migração de `victor_reserves`, não entra em
// KINDS e portanto não gera rateio — somado aqui só por defesa, para o dia em que entrar.
export function cascataDoLucro({ baseProfit, provisionado, porKind = {}, nao_coberto = 0 }) {
  const escritorio = r2(num(porKind.honorarios) + num(porKind.escritorio))
  const inss = r2(num(porKind.inss))
  const das = r2(num(porKind.das))

  const lucro_antes_escritorio = r2(num(baseProfit) + num(provisionado))
  const lucro_antes_inss = r2(lucro_antes_escritorio - escritorio)
  const lucro_antes_das = r2(lucro_antes_inss - inss)

  return {
    lucro_antes_escritorio,
    escritorio,
    lucro_antes_inss,
    inss,
    lucro_antes_das,
    das,
    lucro_final: r2(lucro_antes_das - das),
    capital_proprio: r2(nao_coberto),
  }
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
  // `absorverDelta`, não `aplicarDelta`: este é o valor que vai para o payable, e sob a
  // Opção 1 ele é o da própria fatura. `mudou` fica false por consequência, então a tela
  // /fiscal para de oferecer um "aplicar" que não muda nada.
  const alvo = absorverDelta(baseService, baseProfit, delta)

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
    // Waterfall do lucro (Escritório → INSS → DAS). Sai do MESMO `alvo`/`porKind` que
    // gera os valores gravados, então não há como a explicação divergir do valor
    // explicado — mesmo motivo pelo qual a memória de cálculo chama `calcularApuracao`
    // em vez de refazer as fórmulas.
    cascata: cascataDoLucro({
      baseProfit,
      provisionado,
      porKind,
      nao_coberto: alvo.nao_coberto,
    }),
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
