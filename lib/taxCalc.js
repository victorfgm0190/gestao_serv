// Previsão de impostos (reserva de caixa) — NÃO é contabilidade formal.
// Estima quanto reservar por mês com base no faturamento (NF emitidas no mês).
// Usado no card "Previsão de Impostos" da aba Pagar Victor (só Lumen).

// Anexo III do Simples Nacional (serviços — Fator R >= 28%)
export const SIMPLES_III = [
  { max: 180000, rate: 0.06, deduct: 0 },
  { max: 360000, rate: 0.112, deduct: 9360 },
  { max: 720000, rate: 0.135, deduct: 17640 },
  { max: 1800000, rate: 0.16, deduct: 35640 },
  { max: 3600000, rate: 0.21, deduct: 125640 },
  { max: 4800000, rate: 0.33, deduct: 648000 },
]

// Anexo V do Simples Nacional (serviços — Fator R < 28%)
export const SIMPLES_V = [
  { max: 180000, rate: 0.155, deduct: 0 },
  { max: 360000, rate: 0.18, deduct: 4500 },
  { max: 720000, rate: 0.195, deduct: 9900 },
  { max: 1800000, rate: 0.205, deduct: 17100 },
  { max: 3600000, rate: 0.23, deduct: 62100 },
  { max: 4800000, rate: 0.305, deduct: 540000 },
]

export const INSS_TETO = 7786.02
export const INSS_RATE = 0.11

// Fator R: folha / faturamento >= 28% cai no Anexo III (6% na 1ª faixa) em vez do V (15,5%).
// Quando o pró-labore sai exatamente do percentual (sem o piso pegar), a razão cai EM CIMA
// da fronteira — e aí o ponto flutuante decide: 1316.35 / 4701.25 dá 0.27999999999999997,
// que reprova num `>= 0.28` literal e joga tudo para o Anexo V.
// O epsilon absorve esse erro de representação (~1e-16 na escala do Fator R) com folga de
// 7 ordens de grandeza; economicamente 1e-9 de folha é fração de centavo, irrelevante.
export const FATOR_R_MIN = 0.28
export const FATOR_R_EPSILON = 1e-9

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100

// Parâmetros da apuração. Vivem em company_settings; estes são o fallback para
// empresa sem linha cadastrada. O piso acompanha o salário mínimo e muda todo janeiro.
export const PARAMS_PADRAO = { prolabore_percentual: 0.28, prolabore_minimo: 1621, honorarios_mensal: 150 }

// Normaliza os parâmetros a partir de uma linha de company_settings. Checagem por null,
// não por falsy: 0% de pró-labore e honorários zerados são valores legítimos, e um
// `|| padrão` os sobrescreveria de volta em silêncio. Idempotente.
export function parametrosFiscais(settings) {
  const pick = (k) => {
    const v = settings?.[k]
    return v === null || v === undefined || v === '' ? PARAMS_PADRAO[k] : Number(v)
  }
  return {
    prolabore_percentual: pick('prolabore_percentual'),
    prolabore_minimo: pick('prolabore_minimo'),
    honorarios_mensal: pick('honorarios_mensal'),
  }
}

// Pró-labore de um mês: percentual do faturamento, respeitando o piso.
//
// FÓRMULA ÚNICA do sistema — usada pela apuração (api/fiscal-obligations.js), pelo
// Billing.jsx e pela previsão aqui. Antes o pró-labore era um valor guardado em
// company_settings.prolabore_mensal e cada lugar o recalculava do seu jeito: o Billing
// com 28% fixo e sem piso, a apuração com os parâmetros, e a previsão lendo a coluna —
// os três davam números diferentes para o mesmo mês.
export function proLaboreDoMes(faturamento, settings) {
  const p = parametrosFiscais(settings)
  return Math.max(r2((Number(faturamento) || 0) * p.prolabore_percentual), p.prolabore_minimo)
}

// Seleciona a faixa da tabela conforme a receita bruta acumulada em 12 meses (RBT12).
// Exportada para a memória de cálculo da tela /fiscal poder mostrar QUAL faixa pegou
// (teto, alíquota nominal e dedução) sem redigitar a tabela do Simples do lado de lá.
export function faixaFor(tabela, rbt12) {
  return tabela.find(f => rbt12 <= f.max) || tabela[tabela.length - 1]
}

// Tabela do anexo, pelo rótulo que `calcularImpostos` devolve.
export const tabelaDoAnexo = (anexo) => (anexo === 'III' ? SIMPLES_III : SIMPLES_V)

// INSS sobre o pró-labore (11% até o teto) — vale para todos os regimes.
export function calcINSS(prolabore_mensal) {
  const base = Math.min(Number(prolabore_mensal) || 0, INSS_TETO)
  return r2(base * INSS_RATE)
}

// Alíquota efetiva do Simples: (RBT12 × alíquota - dedução) / RBT12.
export function aliquotaEfetiva(faixa, rbt12) {
  if (!rbt12 || rbt12 <= 0) return 0
  return (rbt12 * faixa.rate - faixa.deduct) / rbt12
}

// Cálculo principal. `faturamentoMes` = total de NF emitidas no mês.
// A configuração informa o faturamento médio mensal; a RBT12 é estimada
// como faturamento_medio_mensal × 12. A folha mensal (pró-labore + salários CLT)
// serve ao Fator R — a razão é a mesma no mensal ou no anual, sem multiplicar por 12.
//
// `opts` existe para a apuração (api/fiscal-obligations.js), que calcula a folha real
// dos 12 meses somando mês a mês. Aplicar a fórmula sobre a MÉDIA não dá o mesmo
// número quando o piso pega em alguns meses e não em outros (o max() não distribui
// sobre a média). Sem opts, tudo é derivado do próprio settings.
//   opts.prolabore    → pró-labore do mês, base do INSS
//   opts.folhaMensal  → folha média mensal, base do Fator R
//
// Retorna { regime, fatorR, anexo, itens:[{label,value}], das/inss/prolabore/... , total }.
export function calcularImpostos(settings, faturamentoMes, opts = {}) {
  const fat = Number(faturamentoMes) || 0
  const regime = settings?.regime || 'simples_iii'
  const faturamentoMedioMensal = Number(settings?.faturamento_medio_mensal) || 0
  const rbt12 = faturamentoMedioMensal * 12
  const salariosMensais = Number(settings?.salarios_mensal) || 0
  // Pró-labore deixou de ser dado guardado e passou a ser derivado dos parâmetros.
  const prolabore = opts.prolabore ?? proLaboreDoMes(fat, settings)
  const folhaMensal = opts.folhaMensal ?? (proLaboreDoMes(faturamentoMedioMensal, settings) + salariosMensais)
  const inss = calcINSS(prolabore)

  if (regime === 'lucro_presumido') {
    const issPct = Number(settings?.iss_percent) || 0
    const base = fat * 0.32
    const irpjAdicional = base > 20000 ? (base - 20000) * 0.10 : 0
    const irpj = r2(base * 0.15 + irpjAdicional)
    const csll = r2(base * 0.09)
    const pis = r2(fat * 0.0065)
    const cofins = r2(fat * 0.03)
    const iss = r2(fat * (issPct / 100))
    const total = r2(irpj + csll + pis + cofins + iss + inss)
    return {
      regime,
      regimeLabel: 'Lucro Presumido',
      fatorR: null,
      anexo: null,
      faturamentoMes: fat,
      irpj, csll, pis, cofins, iss, inss, prolabore,
      itens: [
        { label: 'IRPJ', value: irpj },
        { label: 'CSLL', value: csll },
        { label: 'PIS', value: pis },
        { label: 'COFINS', value: cofins },
        { label: `ISS (${issPct}%)`, value: iss },
        { label: 'INSS pró-labore', value: inss },
      ],
      total,
    }
  }

  // Simples Nacional (III ou V). No III, checa o Fator R para decidir o anexo.
  let tabela = SIMPLES_V
  let anexo = 'V'
  let fatorR = null
  if (regime === 'simples_iii') {
    fatorR = faturamentoMedioMensal > 0 ? folhaMensal / faturamentoMedioMensal : 0
    if (fatorR >= FATOR_R_MIN - FATOR_R_EPSILON) { tabela = SIMPLES_III; anexo = 'III' }
  }

  const faixa = faixaFor(tabela, rbt12)
  const aliq = aliquotaEfetiva(faixa, rbt12)
  const das = r2(fat * aliq)
  const total = r2(das + inss)
  return {
    regime,
    regimeLabel: regime === 'simples_iii' ? 'Simples Nacional (Anexo III)' : 'Simples Nacional (Anexo V)',
    fatorR,
    anexo,
    aliquotaEfetiva: aliq,
    faturamentoMes: fat,
    das, inss, prolabore,
    itens: [
      { label: `DAS (Anexo ${anexo})`, value: das },
      { label: 'INSS pró-labore', value: inss },
    ],
    total,
  }
}
