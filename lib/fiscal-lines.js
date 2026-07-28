// Linhas fiscais materializadas em `payables_victor`.
//
// Espelho de `fiscal_obligations` na aba Pagar Victor: uma linha por (empresa, mês, ano,
// kind), com `origin='fiscal'` e `client_id` NULL — a obrigação é da EMPRESA, não de um
// cliente (o rateio por cliente vive em `fiscal_allocations` e aparece na composição
// fiscal de cada payable de faturamento).
//
// São marcadores de LEITURA, não contas a pagar ao Victor:
//   · ficam fora de `candidatosDisponiveis()` (senão a distribuição consumiria a linha do
//     DAS como se fosse dinheiro a receber do Victor);
//   · ficam fora dos totais da aba;
//   · não têm botão de pagar. A quitação da guia continua sendo em /fiscal, por
//     `fiscal_payments` — dois canais de pagamento para a mesma dívida é como o
//     `paid_amount` de uma delas fica mentindo.
//
// `paid_amount`/`status` são SEMPRE copiados da obrigação, nunca calculados aqui. É o
// mesmo princípio de lib/fiscal-status.js: um dono só por registro.

import { valorDevido } from './fiscal-status.js'

const num = (v) => parseFloat(v) || 0
const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100

// Ordem de exibição pedida: serviço → lucro → pró-labore → DAS → INSS → escritório.
// `manual` e `faturamento` cobrem os payables reais (serviço+lucro no mesmo registro).
export const ORDEM_KIND = [
  'manual', 'servico', 'lucro', 'pro_labore', 'das', 'inss', 'honorarios', 'escritorio',
]

export const DESCRICAO_KIND = {
  das: 'DAS',
  inss: 'INSS sobre pró-labore',
  honorarios: 'Escritório contábil',
  pro_labore: 'Pró-labore',
  escritorio: 'Escritório',
}

// Vocabulário de payables_victor (pendente|parcial|pago) a partir do da obrigação
// (previsto|apurado|parcial|pago). Sem a tradução, 'previsto' e 'apurado' sumiriam de
// todos os filtros da tela — ver "Não existe status estornado" no CLAUDE.md.
const statusDaObrigacao = (s) => (s === 'parcial' || s === 'pago' ? s : 'pendente')

// Mês de CAIXA da guia: o vencimento quando já se conhece, senão o mês seguinte ao
// apurado (DAS de janeiro se paga em fevereiro). É o que faz a linha aparecer no lugar
// certo na visão por caixa.
function periodoDeCaixa(ob, month, year) {
  if (ob.due_date) {
    const d = new Date(ob.due_date)
    return { pmonth: d.getUTCMonth() + 1, pyear: d.getUTCFullYear() }
  }
  return month === 12 ? { pmonth: 1, pyear: year + 1 } : { pmonth: month + 1, pyear: year }
}

// Sincroniza as linhas fiscais de uma competência com as obrigações apuradas.
// Idempotente: rodar duas vezes deixa o mesmo estado. Nunca toca em linha que não seja
// `origin='fiscal'` — os payables de faturamento e os manuais do Victor são de outro dono.
export async function sincronizarLinhasFiscais(sql, company_id, month, year) {
  const m = Number(month)
  const y = Number(year)

  const [obrigacoes, existentes] = await Promise.all([
    sql`
      SELECT * FROM fiscal_obligations
      WHERE company_id = ${company_id} AND month = ${m} AND year = ${y}
      ORDER BY kind`,
    sql`
      SELECT id, kind FROM payables_victor
      WHERE company_id = ${company_id} AND month = ${m} AND year = ${y} AND origin = 'fiscal'`,
  ])

  const porKind = new Map(existentes.map((r) => [r.kind, r.id]))
  const writes = []
  const vistos = new Set()
  let criadas = 0
  let atualizadas = 0

  for (const ob of obrigacoes) {
    const valor = round2(valorDevido(ob))
    const pago = round2(ob.paid_amount)
    const status = statusDaObrigacao(ob.status)
    const desc = `${DESCRICAO_KIND[ob.kind] || ob.kind} — ${String(m).padStart(2, '0')}/${y}`
    const { pmonth, pyear } = periodoDeCaixa(ob, m, y)
    vistos.add(ob.kind)

    const id = porKind.get(ob.kind)
    if (id) {
      atualizadas++
      writes.push(sql`
        UPDATE payables_victor SET
          description = ${desc}, total_amount = ${valor}, paid_amount = ${pago},
          status = ${status}, payment_month = ${pmonth}, payment_year = ${pyear}
        WHERE id = ${id}`)
    } else {
      criadas++
      writes.push(sql`
        INSERT INTO payables_victor
          (company_id, client_id, month, year, description, service_amount, profit_amount,
           total_amount, paid_amount, status, origin, kind, payment_month, payment_year)
        VALUES
          (${company_id}, NULL, ${m}, ${y}, ${desc}, 0, 0,
           ${valor}, ${pago}, ${status}, 'fiscal', ${ob.kind}, ${pmonth}, ${pyear})`)
    }
  }

  // Obrigação que deixou de existir (reapuração de um mês que passou a não ter DAS, por
  // exemplo) leva a linha junto — senão fica um DAS fantasma na tela para sempre.
  const orfas = existentes.filter((r) => !vistos.has(r.kind)).map((r) => r.id)
  if (orfas.length) writes.push(sql`DELETE FROM payables_victor WHERE id = ANY(${orfas})`)

  if (writes.length) await sql.transaction(writes)
  return { criadas, atualizadas, removidas: orfas.length, total: obrigacoes.length }
}
