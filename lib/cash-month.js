// Mês de CAIXA original de um payable — o mês em que o dinheiro do CLIENTE entrou.
//
// `payables_*.payment_month/year` tem dois escritores, e eles gravam eventos diferentes:
//   1. a criação (api/receivables.js), a partir do `paid_at` do recebível → o cliente pagou;
//   2. `consumir()` (lib/victor-distribution.js) e `recalcParent()`, a partir da data do
//      pagamento do próprio payable → o Victor liquidou.
//
// O (2) sobrescrever o (1) é aceitável enquanto o pagamento existe. O problema é o ESTORNO:
// todos os caminhos devolviam `paid_amount`/`status`/`paid_at` ao estado original e deixavam
// `payment_month/year` apontando para a data do pagamento que acabou de ser desfeito.
//
// Caso real (Pharmalog, payable 28): recebível pago em 15/02/2026, distribuição consumida e
// estornada em 28/07/2026. Sobrou `payment_month = 7`, e o payable ficou ENCALHADO — o teto
// `payKey <= curKey` de `candidatosDisponiveis()` o exclui de qualquer distribuição datada
// antes de julho, e a visão de caixa o mostrava cinco meses adiante do mês em que o dinheiro
// realmente entrou. Nada disso dava erro: ele simplesmente sumia da lista.
//
// Daí este módulo: quando um payable volta a `pendente` (zero pagamentos), o mês de caixa
// tem de voltar junto — para o recebível que o originou, ou para a competência quando não há
// fatura (lançamento manual, que nasce com `payment_month = month`).

// Aceita os dois formatos em que uma data chega: string ISO (via JSON) ou Date (consumo
// direto do driver). É a mesma armadilha de `emission_date` documentada no CLAUDE.md —
// `String(date).slice(0,10)` num Date dá "Mon Feb 02" e sai sem hífen, falhando em silêncio.
// Do Date usam-se os getters locais, não `toISOString()`: uma coluna DATE vira meia-noite
// local, e em fuso positivo o ISO cairia no dia anterior.
export function partesDeData(v) {
  if (!v) return null
  if (typeof v.getFullYear === 'function') return { m: v.getMonth() + 1, y: v.getFullYear() }
  const [y, m] = String(v).slice(0, 10).split('-').map(Number)
  return y && m ? { m, y } : null
}

// Devolve { pmonth, pyear } do payable, ou null se ele não existir.
export async function mesDeCaixaOriginal(sql, payable_type, payable_id) {
  const rows = payable_type === 'victor'
    ? await sql`
        SELECT p.month, p.year, rcv.paid_at
        FROM payables_victor p
        LEFT JOIN invoices i ON i.id = p.invoice_id
        LEFT JOIN receivables rcv ON rcv.id = i.receivable_id
        WHERE p.id = ${payable_id}`
    : await sql`
        SELECT p.month, p.year, rcv.paid_at
        FROM payables_fabricio p
        LEFT JOIN invoices i ON i.id = p.invoice_id
        LEFT JOIN receivables rcv ON rcv.id = i.receivable_id
        WHERE p.id = ${payable_id}`
  if (!rows.length) return null
  const r = rows[0]
  // Recebível ainda pendente tem `paid_at` nulo — cai na competência, mesmo fallback do
  // `paymentPeriod()` de api/receivables.js.
  const d = partesDeData(r.paid_at)
  return d ? { pmonth: d.m, pyear: d.y } : { pmonth: r.month, pyear: r.year }
}
