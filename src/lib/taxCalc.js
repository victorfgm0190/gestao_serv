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

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100

// Seleciona a faixa da tabela conforme a receita bruta acumulada em 12 meses (RBT12).
function faixaFor(tabela, rbt12) {
  return tabela.find(f => rbt12 <= f.max) || tabela[tabela.length - 1]
}

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
// Retorna { regime, fatorR, anexo, itens:[{label,value}], das/inss/... , total }.
export function calcularImpostos(settings, faturamentoMes) {
  const fat = Number(faturamentoMes) || 0
  const regime = settings?.regime || 'simples_iii'
  const faturamentoMedioMensal = Number(settings?.faturamento_medio_mensal) || 0
  const rbt12 = faturamentoMedioMensal * 12
  const folhaMensal = (Number(settings?.prolabore_mensal) || 0) + (Number(settings?.salarios_mensal) || 0)
  const inss = calcINSS(settings?.prolabore_mensal)

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
      irpj, csll, pis, cofins, iss, inss,
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
    if (fatorR >= 0.28) { tabela = SIMPLES_III; anexo = 'III' }
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
    das, inss,
    itens: [
      { label: `DAS (Anexo ${anexo})`, value: das },
      { label: 'INSS pró-labore', value: inss },
    ],
    total,
  }
}
