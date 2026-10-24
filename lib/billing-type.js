// Tipo de cobrança da regra financeira — dono único.
//
//   hora    → valor = horas × valor hora (comportamento histórico)
//   diaria  → valor = 1 diária por DATA distinta; as horas são só demonstrativo
//   projeto → valor = fixo mensal, 1× por competência; as OS são só demonstrativo
//
// `financial_rules.billing_type` é a fonte. A coluna antiga `tipo` ('hora' |
// 'por_projeto') continua sendo escrita em espelho por api/financial-rules.js, mas
// ninguém deve lê-la: o fallback abaixo existe só para uma linha anterior à migração.
//
// Cada tipo tem colunas próprias de valor. `hourly_rate` NÃO é reaproveitado como
// diária ou fixo mensal: a regra do SteelDek já mostra o custo dessa sobrecarga
// (`hourly_rate = 1600` sendo, na verdade, o valor do contrato).

export const TIPOS_COBRANCA = ['hora', 'diaria', 'projeto']

export const ROTULO_COBRANCA = {
  hora: 'Por hora',
  diaria: 'Por diária',
  projeto: 'Por projeto',
}

export function tipoDaRegra(rule) {
  const t = rule?.billing_type || (rule?.tipo === 'por_projeto' ? 'projeto' : rule?.tipo)
  return TIPOS_COBRANCA.includes(t) ? t : 'hora'
}

// Valor unitário e fixo do Victor por unidade, conforme o tipo.
// A "unidade" é a hora, a data distinta ou o mês.
export function valoresDaRegra(rule) {
  const tipo = tipoDaRegra(rule)
  const n = (v) => parseFloat(v) || 0
  if (tipo === 'diaria') return { tipo, unitario: n(rule.daily_rate), victor_fixo: n(rule.victor_fixed_daily) }
  if (tipo === 'projeto') return { tipo, unitario: n(rule.monthly_fixed_value), victor_fixo: n(rule.victor_fixed_monthly) }
  return { tipo, unitario: n(rule.hourly_rate), victor_fixo: n(rule.victor_fixed_per_hour) }
}

// NF de uma unidade (diária ou mês) no modo LÍQUIDO — dono único da fórmula, usado pelo
// apontamento, pela fatura e pelo modal da regra.
//
//   automática → líquido ÷ (1 − imposto%)
//   override   → `financial_rules.nf_value_override`, digitado para arredondar a nota
//                (R$ 1.651,98 → R$ 1.652,00). A diferença NF − líquido continua indo
//                100% para o Victor; o líquido continua sendo a base do split.
//
// O override só vale para diária/projeto com `is_net_value`: no modo bruto o imposto sai
// do valor, e não há NF "por fora" para arredondar.
export function nfAutomatica(liquido, pct) {
  const l = parseFloat(liquido) || 0
  const p = parseFloat(pct) || 0
  return p > 0 && p < 100 ? l / (1 - p / 100) : l
}

export function nfOverride(rule) {
  if (tipoDaRegra(rule) === 'hora' || !rule?.is_net_value) return null
  const v = parseFloat(rule.nf_value_override)
  return v > 0 ? v : null
}

// 'YYYY-MM-DD' de um entry_date.
// ⚠️ Pelo JSON ele chega como string ISO; direto do driver, como `Date` na meia-noite
// LOCAL do processo (03:00Z numa máquina em BRT, 00:00Z na Vercel). Os componentes
// locais acertam nos dois casos; `toISOString()` erraria na máquina de desenvolvimento.
export function chaveData(d) {
  if (!d) return ''
  if (d instanceof Date) {
    const p = (x) => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }
  return String(d).slice(0, 10)
}

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100

// Divide um valor em `n` cotas de centavos que somam exatamente o total.
// O resíduo do arredondamento fica na PRIMEIRA cota (menor id), para que a soma das
// OS de uma data feche na diária no centavo.
export function dividirEmCotas(total, n) {
  if (n <= 0) return []
  const base = r2(total / n)
  const cotas = Array(n).fill(base)
  cotas[0] = r2(total - base * (n - 1))
  return cotas
}

// Cota da i-ésima de `n` OS numa mesma data. Com override de NF, a NF da diária também
// é rateada (`nf`), para que a soma das OS feche exatamente no valor digitado; sem
// override `nf` fica ausente e `calcular()` faz o gross-up da cota líquida.
export function cotaDaDiaria(rule, n, i) {
  const { unitario, victor_fixo } = valoresDaRegra(rule)
  const cota = { bruto: dividirEmCotas(unitario, n)[i], victor_fixo: dividirEmCotas(victor_fixo, n)[i], fracao: 1 / n, n }
  const nf = nfOverride(rule)
  if (nf != null) cota.nf = dividirEmCotas(nf, n)[i]
  return cota
}

// Cota de diária de cada apontamento de UM contrato.
// → Map(id → { bruto, victor_fixo, nf?, fracao, n })
//
// Uma data = uma diária, rateada entre as OS daquela data. Dois cuidados:
//  - data que já tem OS FATURADA não gera diária nova: a diária dela já foi cobrada,
//    então as OS ainda abertas daquela data ficam com cota 0. As faturadas não são
//    devolvidas aqui — os valores delas estão congelados com a fatura.
//  - o rateio é por apontamento, não por hora: a diária independe das horas.
export function cotasDeDiaria(entries, rule, faturados = new Set()) {
  const porData = new Map()
  for (const e of entries) {
    const k = chaveData(e.entry_date)
    if (!porData.has(k)) porData.set(k, [])
    porData.get(k).push(e)
  }
  const out = new Map()
  for (const grupo of porData.values()) {
    grupo.sort((a, b) => Number(a.id) - Number(b.id))
    const abertos = grupo.filter((e) => !faturados.has(Number(e.id)))
    const jaCobrada = abertos.length < grupo.length
    if (jaCobrada) {
      for (const e of abertos) out.set(Number(e.id), { bruto: 0, victor_fixo: 0, nf: 0, fracao: 0, n: grupo.length, ja_cobrada: true })
      continue
    }
    grupo.forEach((e, i) => out.set(Number(e.id), cotaDaDiaria(rule, grupo.length, i)))
  }
  return out
}

// Deslocamento faturado de um apontamento, para regras que não são por hora.
// Mesmo critério de `calcular()` em api/time-entries.js com a hora valendo 0: sem
// valor/hora de deslocamento no contrato não há de onde tirar o preço da hora de
// deslocamento — a diária não é uma hora, e dividi-la por 8 seria inventar tarifa.
export function deslocamentoBruto(entry, contrato) {
  const tipo = contrato?.deslocamento_tipo || 'nao_cobrado'
  if (tipo === 'nao_cobrado') return 0
  return (parseFloat(entry.horas_deslocamento) || 0) * (parseFloat(contrato?.deslocamento_valor_hora) || 0)
}
