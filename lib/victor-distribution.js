// Cascata de consumo dos payables do Victor.
//
// Uma despesa (imposto, honorário, pró-labore) é abatida sequencialmente dos saldos
// que o Victor tem a receber, do mês mais antigo para o mais novo. Motor único usado
// por api/payables-victor.js (?action=pagar-distribuido, valores digitados no modal)
// e por api/fiscal-obligations.js (?action=distribuir, valores vindos da apuração).
//
// Mora aqui pelo mesmo motivo de lib/fiscal-status.js: a ordem de consumo define
// quanto cada cliente absorve de imposto. Duas implementações divergiriam em silêncio
// e o rateio por cliente ficaria dependendo de qual rota tocou o registro por último.

import { PAID_EPSILON } from './payment-status.js'

// Pharmalog/ANB — maior cliente, consumido primeiro dentro do mesmo mês.
export const CLIENT_PHARMA = 7

export const r2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100

// Ordenação canônica: SEMPRE por competência (year/month), do mais antigo ao mais novo.
// Idêntica ao preview do frontend (sortedPending em Financial.jsx). Dentro do mês:
// Pharmalog primeiro, restante por saldo desc. Nunca usa payment_month/year.
export function ordenar(records) {
  return [...records].sort((a, b) => {
    const ka = a.year * 100 + a.month, kb = b.year * 100 + b.month
    if (ka !== kb) return ka - kb  // competência ASC — mês mais antigo primeiro
    if (a.client_id === CLIENT_PHARMA && b.client_id !== CLIENT_PHARMA) return -1
    if (b.client_id === CLIENT_PHARMA && a.client_id !== CLIENT_PHARMA) return 1
    return b._saldo - a._saldo
  })
}

// Payables elegíveis: pendentes/parciais, e só os DISPONÍVEIS — manuais (sem fatura) ou
// cujo recebível do cliente já foi pago/parcial. Não se desconta imposto de dinheiro que
// ainda não entrou. O teto é o mês de CAIXA (payment_month/year) <= período ativo:
// nunca consome caixa futuro; a sobra simplesmente não é distribuída (capital próprio).
//
// `origin='fiscal'` fica de fora: essas linhas são o espelho de fiscal_obligations na
// aba (ver lib/fiscal-lines.js), o que o Victor DEVE — não o que ele tem a receber.
// Sem este filtro a distribuição consumiria a linha do DAS para pagar o próprio DAS.
export async function candidatosDisponiveis(sql, company_id, curKey) {
  const all = await sql`
    SELECT p.* FROM payables_victor p
    LEFT JOIN invoices i ON i.id = p.invoice_id
    LEFT JOIN receivables rcv ON rcv.id = i.receivable_id
    WHERE p.company_id = ${company_id} AND p.status IN ('pendente','parcial')
      AND p.origin IS DISTINCT FROM 'fiscal'
      AND (p.invoice_id IS NULL OR rcv.status IN ('pago','parcial'))
    ORDER BY p.year ASC, p.month ASC, p.created_at ASC`
  for (const rec of all) {
    rec._saldo = r2((parseFloat(rec.total_amount) || 0) - (parseFloat(rec.paid_amount) || 0))
  }
  return all.filter((rec) => {
    if (rec._saldo <= 0) return false
    const py = Number(rec.payment_year) || rec.year
    const pm = Number(rec.payment_month) || rec.month
    return (py * 100 + pm) <= curKey
  })
}

// Consome `pool` sequencialmente sobre `lista` (registros com ._saldo calculado).
// Retorna os writes (fragmentos SQL não-aguardados) para a transação, o que foi
// aplicado e o restante não consumido.
export function consumir(sql, pool, lista, when, notes) {
  const writes = []
  const applied = []
  let restante = r2(pool)
  // Mês/ano de caixa derivados da data do pagamento (when).
  const [wy, wm] = String(when).slice(0, 10).split('-').map(Number)
  for (const rec of lista) {
    if (restante <= 0.005) break
    const consumed = r2(Math.min(restante, rec._saldo))
    if (consumed <= 0) continue
    const total = r2(parseFloat(rec.total_amount) || 0)
    const newPaid = r2((parseFloat(rec.paid_amount) || 0) + consumed)
    const status = newPaid >= total - PAID_EPSILON ? 'pago' : 'parcial'
    writes.push(sql`INSERT INTO payable_payments (payable_type, payable_id, amount, paid_at, notes, payment_month, payment_year) VALUES ('victor', ${rec.id}, ${consumed}, ${when}, ${notes}, ${wm || null}, ${wy || null})`)
    writes.push(sql`UPDATE payables_victor SET paid_amount=${newPaid}, status=${status}, paid_at=${when}, payment_month=${wm || null}, payment_year=${wy || null} WHERE id=${rec.id}`)
    applied.push({ id: rec.id, client_id: rec.client_id, month: rec.month, year: rec.year, consumed, status })
    restante = r2(restante - consumed)
  }
  return { writes, applied, restante }
}

// Rótulos das categorias, na grafia que o Financial.jsx espera em payable_payments.notes.
// `parseNotesToAmounts` reconstrói o detalhamento por categoria a partir desta string —
// mudar um acento aqui quebra a leitura de todo o histórico.
// `servico` e `lucro` entraram com o breakdown por cliente (aba Pagar Victor): lá o
// pagamento é "quitar o serviço DESTE cliente", que não é despesa nenhuma das anteriores.
// Precisam estar AQUI e no RECEIVE_LABEL_TO_KEY do Financial.jsx ao mesmo tempo — o
// parser da tela descarta rótulo que não conhece (`if (!key) continue`), então uma sessão
// gravada com "Serviço: R$1000" e lida por um parser desatualizado voltaria sem essa
// parcela, e reeditá-la pagaria a menos sem avisar.
export const CATS = {
  honorarios: 'Honorários',
  das: 'DAS',
  inss: 'INSS',
  pro_labore: 'Pro Labore',
  lucros: 'Lucros',
  escritorio: 'Escritório',
  demais: 'Demais despesas',
  servico: 'Serviço',
  lucro: 'Lucro',
}

// Monta a string de notes no formato "Honorários: R$150 | DAS: R$394,18".
export function montarNotes(despesas) {
  const partes = []
  for (const [k, label] of Object.entries(CATS)) {
    const v = parseFloat(despesas[k]) || 0
    if (v > 0) partes.push(`${label}: R$${String(v).replace('.', ',')}`)
  }
  return partes.length ? partes.join(' | ') : 'distribuição geral'
}

// Rótulo → chave. Derivado de CATS, nunca redigitado: é a inversa exata de montarNotes.
const LABEL_TO_KEY = Object.fromEntries(Object.entries(CATS).map(([k, label]) => [label, k]))

// Inversa de montarNotes: "DAS: R$207 | INSS: R$90" → { das: 207, inss: 90 }.
//
// Mora AQUI, ao lado de montarNotes e de CATS, porque um parser noutro arquivo é como o
// formato passa a ter dois donos: o Financial.jsx já reconstrói o detalhamento de uma
// sessão a partir desta mesma string, e a advertência em CATS ("mudar um acento aqui
// quebra a leitura de todo o histórico") só se sustenta se houver um lugar só para mudar.
//
// Rótulo desconhecido é IGNORADO, não é erro: o histórico tem sessões antigas gravadas
// com "distribuição geral" e outras cujo texto foi editado à mão.
export function parseNotes(notes) {
  const out = {}
  for (const parte of String(notes || '').split('|')) {
    const m = parte.trim().match(/^(.+?):\s*R\$\s*(-?[\d.,]+)$/)
    if (!m) continue
    const key = LABEL_TO_KEY[m[1].trim()]
    if (!key) continue
    // "1.234,56" e "1234.56" convivem no banco: o montarNotes só troca o ponto decimal
    // por vírgula, mas notas antigas passaram por outros caminhos. Descarta o separador
    // de milhar só quando a vírgula está presente, senão "1.234" viraria 1,234.
    const bruto = m[2].includes(',') ? m[2].replace(/\./g, '').replace(',', '.') : m[2]
    const v = parseFloat(bruto)
    if (!Number.isFinite(v)) continue
    out[key] = r2((out[key] || 0) + v)
  }
  return out
}
