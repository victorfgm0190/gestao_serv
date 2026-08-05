// Demonstrativo de como se chegou ao valor do Fabrício numa fatura.
//
// NÃO recalcula nada. Fabrício é decidido uma única vez, na emissão da fatura
// (calcContrato/calcAgenda/calcProjeto em api/invoices.js), e daí em diante só é
// copiado para payables_fabricio.amount. Esta função faz o caminho inverso: lê as
// colunas já gravadas em `invoices` e as remonta na ordem em que o cálculo aconteceu,
// para que a tela e o Excel expliquem o número em vez de produzirem um segundo.
//
// ⚠️ A conta "bruto − serviço do Victor − imposto, dividido por 2" está ERRADA fora
// do caso mais comum. Ela só fecha em contrato por hora, sem deslocamento e com split
// 50/50. Os três desvios reais, todos presentes no banco:
//
//   1. Contrato fixo (billing_type='contract'): o imposto NÃO sai antes do split.
//      calcContrato divide `base − victor_fixed`; o imposto é informativo e sai da
//      parte do Victor. SteelDek 06/2026: a conta ingênua dá 338,33, o real é 400,00.
//   2. Deslocamento (agenda): é 100% Victor e fica FORA do split, mas calcAgenda o
//      soma dentro de victor_profit (invoices.js:118), então ele não aparece como
//      coluna própria. Eurofral 06/2026: a conta ingênua dá 252,86, o real é 180,32.
//   3. Split 100/0 (Bokada, Enpla, Minas, ALEX): dividir por 2 inventa um valor para
//      quem não tem participação. ALEX 04/2026: a conta ingênua dá −210,00, o real é 0.
//
// Por isso a cascata abaixo é ramificada por billing_type e o percentual do split é
// lido, nunca presumido.

const num = (v) => parseFloat(v) || 0
const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100

// Mesma tolerância da conferência de lib/fiscal-redistribution.js: a decomposição
// atravessa vários arredondamentos e o resíduo cai na maior fatia.
export const BREAKDOWN_EPSILON = 0.05

// Percentual do split. Não usar `|| 50`: 0% é um split legítimo (cliente 100/0) e é
// falsy — o mesmo motivo de splitPct() em api/invoices.js.
function pctOrNull(value) {
  const n = parseFloat(value)
  return isNaN(n) ? null : n
}

/**
 * Remonta a cascata que produziu `fabricio_total`.
 *
 * @param {object} inv Linha com as colunas de `invoices` (billing_type, contract_value,
 *   invoice_value, tax_amount, victor_service, victor_profit, victor_tax_diff,
 *   fabricio_total) mais `fab_pct`/`victor_pct` vindos do contrato ou da regra financeira.
 * @returns {object|null} null quando não há fatura por trás (lançamento manual).
 */
export function breakdownFabricio(inv) {
  if (!inv || inv.contract_value == null) return null

  const isContrato = inv.billing_type === 'contract'
  const bruto = num(inv.contract_value)
  const nf = num(inv.invoice_value) || bruto
  const imposto = num(inv.tax_amount)
  const victorServico = num(inv.victor_service)
  const victorProfit = num(inv.victor_profit)
  const diffNf = num(inv.victor_tax_diff)
  const fabricio = num(inv.fabricio_total)

  const fabPct = pctOrNull(inv.fab_pct)
  const victorPct = pctOrNull(inv.victor_pct)

  // Base do split. Quando Fabrício tem participação, ela é exata: o valor dele É a
  // fatia, então basta desfazer o percentual. Sem participação (100/0) a base não é
  // recuperável a partir do Fabrício, e o que resta é o que sobrou para o Victor.
  const lucroADividir = fabPct > 0
    ? r2(fabricio / (fabPct / 100))
    : r2(victorProfit + fabricio)

  const victorLucro = r2(lucroADividir - fabricio)

  // Deslocamento é o resíduo: calcAgenda o embute em victor_profit junto com o lucro
  // (invoices.js:118), e é a única parte de victor_profit que não veio do split.
  // Em contrato fixo não existe deslocamento.
  // ⚠️ Com split 100/0 o resíduo é indistinguível do lucro (a base do split saiu do
  // próprio victor_profit acima), então cai zerado. É inofensivo aqui: nesses clientes
  // Fabrício recebe 0 e o demonstrativo dele é trivialmente correto.
  const deslocamento = isContrato ? 0 : r2(victorProfit - victorLucro)

  // Líquido: em agenda o imposto sai antes do split; em contrato fixo não sai.
  const liquido = isContrato ? bruto : r2(bruto - imposto)

  // Conferência: a cascata tem de consumir o bruto inteiro.
  const somaDosRamos = isContrato
    ? victorServico + victorLucro + fabricio
    : imposto + victorServico + deslocamento + victorLucro + fabricio
  const desvio = r2(bruto - somaDosRamos)

  return {
    billing_type: inv.billing_type || null,
    tipo_label: isContrato ? 'Contrato fixo' : 'Por hora (agenda)',
    imposto_antes_do_split: !isContrato,
    bruto,
    nf,
    imposto,
    imposto_pct: bruto > 0 ? r2((imposto / (isContrato ? nf : bruto)) * 100) : 0,
    liquido,
    victor_servico: victorServico,
    deslocamento,
    lucro_a_dividir: lucroADividir,
    victor_lucro: victorLucro,
    victor_pct: victorPct != null ? victorPct : (lucroADividir > 0 ? r2((victorLucro / lucroADividir) * 100) : 0),
    fabricio,
    fabricio_pct: fabPct != null ? fabPct : (lucroADividir > 0 ? r2((fabricio / lucroADividir) * 100) : 0),
    // Gross-up do imposto do cliente: majora a NF e vai 100% para o Victor, fora do
    // split. Só aparece quando o contrato tem tax_client_percent (hoje só SteelDek).
    diff_nf: diffNf,
    confere: Math.abs(desvio) <= BREAKDOWN_EPSILON,
    desvio,
  }
}

/** Rótulo das colunas do Excel e da ordem de exibição, para os dois consumidores concordarem. */
export const BREAKDOWN_LABELS = {
  bruto: 'Faturamento Bruto',
  imposto: 'Imposto',
  victor_servico: 'Serviço Victor',
  deslocamento: 'Deslocamento (100% Victor)',
  lucro_a_dividir: 'Lucro a Dividir',
  victor_lucro: 'Victor (lucro)',
  fabricio: 'Fabrício',
}
