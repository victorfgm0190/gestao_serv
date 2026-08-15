// COMPENSAÇÃO DO FABRÍCIO — quando o que ele tem a receber vira crédito do Victor.
//
// O split de um cliente cabe ao Fabrício, mas ele deve ao Victor. Em vez de sair caixa nos
// dois sentidos, o valor é COMPENSADO: `payables_fabricio` fica quitado sem dinheiro sair,
// e o mesmo valor passa a ser origem de recurso do Victor.
//
//   Cenário A  "compensa tudo"          → compensation_amount = amount
//   Cenário B  "compensa 900, paga 100" → compensation_amount = 900, e os outros 100 são
//                                          pagamento real (sai caixa)
//
// ── O QUE ESTE MÓDULO NÃO FAZ, DE PROPÓSITO ───────────────────────────────────────────
//
// **Não cria `payables_victor`.** Só registra a compensação em `payment_sources`, com
// `fabricio_compensation_id` apontando para a linha do Fabrício. É o que a especificação
// do PROMPT 3 determina na nota final (e que contradiz o passo 5 do mesmo prompt, que
// esboçava um `criarPayableVictorCompensacao`): quem transforma isso em pagamento é a tela
// do PROMPT 4, com um clique.
//
// A ordem importa. Criar o payable agora significaria inventar uma linha do que "a empresa
// deve ao Victor" que não veio de fatura nenhuma — e ela entraria em
// `candidatosDisponiveis()`, virando saldo consumível pela cascata. O crédito da
// compensação existe, mas ele não é uma dívida da empresa: é dinheiro que o Fabrício deixou
// de receber. Confundir os dois é a mesma classe de erro das linhas `origin='fiscal'`, que
// precisaram ser excluídas da distribuição depois de já estarem gravadas.
//
// ⚠️ A origem NÃO sai de `fiscal_allocations`, como a especificação sugeria. Aquela tabela
// é o rateio de IMPOSTO por nota — não tem nada do Fabrício. A origem verdadeira já está na
// própria linha: `payables_fabricio` tem `client_id`, `month`, `year` e `invoice_id`, e o
// valor dele naquela nota é `invoices.fabricio_total`. Um payable é de UM cliente, então
// não há rateio a inventar: compensar três clientes são três linhas, cada uma com a sua
// origem exata. Ratear um total entre clientes produziria fatias que ninguém deve.

const r2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100
const num = (v) => parseFloat(v) || 0

// Destino padrão da compensação. O valor entra como recurso disponível do Victor, e é do
// bolso dele que teria saído o pagamento ao Fabrício.
export const DESTINO_COMPENSACAO = 'lucros'
export const SOURCE_COMPENSACAO = 'compensation_fabricio'

// A origem de uma compensação: qual cliente, que competência, que nota.
//
// `descricao` é o texto que vai para `payment_sources.notes` — "Pharmalog/ANB 1/2026 (NF 11)".
export function calcularOrigemCompensacao(payable, compensation_amount) {
  const valor = r2(compensation_amount)
  const nome = payable.client_name || (payable.client_id ? `Cliente ${payable.client_id}` : 'Sem cliente')
  const nf = payable.invoice_id ? ` (NF ${payable.invoice_id})` : ''
  return {
    client_id: payable.client_id ?? null,
    month: payable.month,
    year: payable.year,
    invoice_id: payable.invoice_id ?? null,
    amount: valor,
    descricao: `${nome} ${payable.month}/${payable.year}${nf}`,
  }
}

// Quanto pode ser compensado, e por quê não mais.
//
// O teto é o que foi efetivamente quitado (`paid_amount`), não o valor cheio do lançamento:
// compensar R$ 900 de um lançamento em que só R$ 500 foram baixados registraria um crédito
// que não existe. No cenário B os dois números convivem — paid 1.000 = 900 compensados +
// 100 em dinheiro —, e é exatamente por isso que a checagem é contra o pago.
export function validarCompensacao({ compensation_amount, paid_amount, amount }) {
  const comp = r2(compensation_amount)
  const pago = r2(paid_amount)
  if (comp <= 0.005) return { ok: false, erro: 'O valor da compensação precisa ser maior que zero.' }
  if (comp > pago + 0.005) {
    return {
      ok: false,
      erro: `A compensação (${comp.toFixed(2)}) não pode passar do valor pago no lançamento (${pago.toFixed(2)}). Registre o pagamento total primeiro — a parte em dinheiro entra como pagamento real.`,
    }
  }
  if (comp > r2(amount) + 0.005) {
    return { ok: false, erro: `A compensação (${comp.toFixed(2)}) não pode passar do valor devido ao Fabrício (${r2(amount).toFixed(2)}).` }
  }
  return { ok: true, compensado: comp, em_dinheiro: r2(pago - comp) }
}

// Apaga o rastreamento de compensação de um lançamento.
//
// Necessário porque a FK `fabricio_compensation_id ON DELETE CASCADE` só dispara quando a
// LINHA do Fabrício é apagada — e o caso comum não é esse: é desmarcar a compensação,
// mudar o valor, ou estornar o pagamento (que devolve o lançamento a `pendente` sem
// apagá-lo). Sem esta limpeza, o crédito do Victor sobreviveria ao estorno do pagamento
// que o originou — o mesmo erro que `fiscal_payments` de abatimento já cometeu uma vez.
export async function limparCompensacao(sql, payable_fabricio_id) {
  return sql`
    DELETE FROM payment_sources
    WHERE fabricio_compensation_id = ${payable_fabricio_id}
      AND source_type = ${SOURCE_COMPENSACAO}
    RETURNING id, amount`
}

// Registra (ou re-registra) a compensação de um lançamento do Fabrício.
//
// Idempotente por construção: limpa antes de gravar. O PATCH da tela pode ser chamado
// várias vezes sobre a mesma linha (corrigir o valor, mudar a nota), e sem isso cada
// correção somaria um crédito novo em cima do anterior.
export async function registrarCompensacao(sql, { payable, compensation_amount, compensation_notes = null }) {
  await limparCompensacao(sql, payable.id)

  const origem = calcularOrigemCompensacao(payable, compensation_amount)
  const nota = [`Compensação Fabrício: ${origem.descricao}`, compensation_notes]
    .filter(Boolean).join(' — ')

  const rows = await sql`
    INSERT INTO payment_sources
      (company_id, source_type, client_id, month, year,
       destination_category, amount, payment_id, fabricio_compensation_id, notes,
       created_at, updated_at)
    VALUES (${payable.company_id}, ${SOURCE_COMPENSACAO}, ${origem.client_id},
            ${origem.month}, ${origem.year}, ${DESTINO_COMPENSACAO}, ${origem.amount},
            NULL, ${payable.id}, ${nota}, NOW(), NOW())
    RETURNING *`
  // `payment_id` fica NULL: o crédito existe, mas ainda não virou pagamento nenhum ao
  // Victor. É o PROMPT 4 que o consome, e é a presença desse NULL que diz "disponível".
  return { linha: rows[0], origem }
}

// Créditos de compensação ainda não consumidos (payment_id NULL) — a lista que a tela do
// Victor vai oferecer para "Pagar Compensação".
export async function compensacoesDisponiveis(sql, company_id, { month = null, year = null } = {}) {
  return sql`
    SELECT ps.*, c.name AS client_name,
           pf.description AS fabricio_description, pf.amount AS fabricio_amount,
           pf.paid_at AS fabricio_paid_at
    FROM payment_sources ps
    LEFT JOIN clients c ON c.id = ps.client_id
    LEFT JOIN payables_fabricio pf ON pf.id = ps.fabricio_compensation_id
    WHERE ps.company_id = ${company_id}
      AND ps.source_type = ${SOURCE_COMPENSACAO}
      AND ps.payment_id IS NULL
      AND (${month}::int IS NULL OR ps.month = ${month}::int)
      AND (${year}::int IS NULL OR ps.year = ${year}::int)
    ORDER BY ps.year, ps.month, ps.id`
}

// Rastreamento origem → destino do período: TODAS as linhas de `payment_sources`, com o
// pagamento que as realizou (quando já houve um).
//
// ⚠️ O filtro de mês/ano é sobre a COMPETÊNCIA DA ORIGEM (`ps.month/year`), não sobre a
// data do pagamento. É o mesmo recorte dos cards da aba — um pagamento feito em agosto
// consumindo saldo de janeiro aparece em JANEIRO, que é de onde o dinheiro veio. Recortar
// pelo `paid_at` faria a mesma linha aparecer num mês em que ela não tem origem nenhuma.
//
// `payment_id IS NULL` = ainda não realizado: é o crédito de compensação disponível. Vem
// primeiro na ordenação de propósito — é o que tem ação pendente.
export async function rastreamentoOD(sql, company_id, { month = null, year = null } = {}) {
  return sql`
    SELECT ps.id, ps.source_type, ps.client_id, c.name AS client_name,
           ps.month, ps.year, ps.destination_category, ps.amount,
           ps.payment_id, ps.fabricio_compensation_id, ps.notes AS source_notes,
           ps.created_at,
           pp.paid_at, pp.notes AS payment_notes, pp.payable_id,
           pv.client_id AS payable_client_id, pc.name AS payable_client_name
    FROM payment_sources ps
    LEFT JOIN clients c ON c.id = ps.client_id
    LEFT JOIN payable_payments pp ON pp.id = ps.payment_id
    LEFT JOIN payables_victor pv ON pv.id = pp.payable_id AND pp.payable_type = 'victor'
    LEFT JOIN clients pc ON pc.id = pv.client_id
    WHERE ps.company_id = ${company_id}
      AND (${month}::int IS NULL OR ps.month = ${month}::int)
      AND (${year}::int IS NULL OR ps.year = ${year}::int)
    ORDER BY ps.payment_id NULLS FIRST, ps.year, ps.month, ps.id`
}

export { r2 as arredondar, num as numero }
