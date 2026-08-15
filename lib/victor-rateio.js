// PAGAMENTO COM RATEIO — roteia cada despesa para o cliente que a apuração já disse
// que a absorve, em vez da cascata genérica de lib/victor-distribution.js.
//
// A diferença entre os dois motores, que é a razão deste arquivo existir:
//
//   victor-distribution.js  pool ÚNICO (soma de todas as categorias) consumido do mês
//                           mais antigo ao mais novo. Não sabe de qual cliente é cada
//                           imposto — as categorias sobrevivem só como texto em
//                           payable_payments.notes.
//   victor-rateio.js        cada categoria é consumida PRIMEIRO dos payables que
//                           fiscal_allocations aponta como donos daquele imposto, e só
//                           o que sobrar cai no fallback (Pharmalog, depois os demais).
//
// O rateio é a fonte da verdade sobre "de quem é este imposto": é ele que a tela /fiscal
// exibe em "Custo por cliente" e que a redistribuição (lib/fiscal-redistribution.js) usa
// para devolver o excedente ao Victor. Pagar por outro critério faria o dinheiro sair de
// um cliente e o custo continuar registrado em outro.
//
// ⚠️ A ÂNCORA É A NOTA, NÃO O MÊS. `fiscal_allocations.invoice_id` → `payables_victor
// .invoice_id`. Buscar o payable por `month/year = competência da apuração` parece
// equivalente e não é: a apuração agrupa pela DATA DE EMISSÃO, então a competência
// 02/2026 rateia as invoices 6 e 11, cujos payables (28 e 42) têm `month = 1`. Os
// payables com `month = 2` (45, 44, 43) pertencem às invoices 7, 12 e 21 — que são
// rateadas em 03/2026. Pelo mês, o INSS de uma nota seria descontado de outra.

import { PAID_EPSILON } from './payment-status.js'
import { CLIENT_PHARMA, r2 } from './victor-distribution.js'

// numeric do Postgres chega como string no driver.
const num = (v) => parseFloat(v) || 0

// Limiar de "acabou" — o mesmo 0,005 usado por consumir(). Abaixo disso é resíduo de
// arredondamento, não saldo.
const FIM = 0.005

// Categoria do modal → `kind` de fiscal_obligations.
//
// `honorarios` é o que o Victor chama de "Escritório" (os R$ 150 da contabilidade) e é o
// ÚNICO dos dois que gera rateio. O kind `escritorio` é legado da migração de
// victor_reserves: existe como obrigação, nunca entrou em KINDS e portanto nunca produziu
// fiscal_allocations. Mapear "Escritório" para ele acharia sempre vazio.
//
// `null` = categoria que não é obrigação fiscal (não tem rateio nem quitação a registrar).
// `servico` e `lucro` vêm do breakdown por cliente: são o saldo do próprio payable, não
// uma obrigação fiscal — daí kind null (nenhuma guia a quitar, nenhum rateio a consultar).
// O que os torna úteis é virem SEMPRE com `client_id`, e é o alvo que faz o trabalho.
export const CATEGORIA_KIND = {
  honorarios: 'honorarios',
  inss: 'inss',
  das: 'das',
  pro_labore: 'pro_labore',
  escritorio: 'escritorio',
  lucros: null,
  demais: null,
  servico: null,
  lucro: null,
}

// Os únicos kinds que a apuração rateia por cliente (KINDS em api/fiscal-obligations.js).
export const KINDS_COM_RATEIO = new Set(['das', 'inss', 'honorarios'])

// ── OPÇÃO 1 — IMPOSTO NÃO CONSOME SALDO DO VICTOR (2026-08-14) ─────────────────────────
// O PONTO B do diagnóstico. Pagar uma guia por aqui debitava o payable (era um ABATIMENTO:
// o Victor recebia menos e a guia era dada por paga), o que reintroduzia pelo pagamento a
// mesma absorção que ABSORVER_IMPOSTO_NO_PAYABLE desligou na redistribuição.
//
// Agora estas categorias apenas QUITAM a obrigação: gravam fiscal_payments e nada mais.
// Nenhum payable_payments, nenhum fiscal_allocations de consumo — o dinheiro veio do caixa,
// não do que a empresa deve ao Victor.
//
// Quem NÃO está aqui e continua consumindo saldo: `pro_labore`, `lucros`, `demais`,
// `servico` e `lucro`. Nenhuma delas é imposto — são retirada, distribuição de lucro e
// despesa, isto é, exatamente o dinheiro que a empresa deve ao Victor sendo entregue.
export const CATEGORIAS_IMPOSTO = new Set(['das', 'inss', 'honorarios', 'escritorio'])
export const ABSORVER_IMPOSTO_NO_SALDO = false

// A categoria é paga com caixa (só quita a guia) ou consome o saldo do Victor?
export const quitaSemConsumir = (categoria) =>
  !ABSORVER_IMPOSTO_NO_SALDO && CATEGORIAS_IMPOSTO.has(categoria)

// Ordem de processamento das categorias. As com rateio vão primeiro de propósito: elas
// têm alvo definido, e uma categoria de fallback puro (Demais despesas) processada antes
// esvaziaria o payable do Pharmalog que o INSS dele precisa consumir logo em seguida.
//
// `honorarios` abre a fila desde 2026-08-12 para bater com ORDEM_LINHAS da tabela tabulada
// (lib/victor-tabulado.js), que absorve Escritório → DAS → INSS. Com dinheiro suficiente as
// duas ordens dão o mesmo resultado; com dinheiro faltando elas divergem, e a tela mostrava
// uma coisa enquanto o motor gravava outra.
//
// ⚠️ `honorarios` é o "Escritório" da tela (os R$ 150 da contabilidade) e é ELE que tem
// rateio. O `escritorio` logo adiante é o kind legado da migração de victor_reserves:
// nunca entrou em KINDS_COM_RATEIO, então é fallback puro e continua depois dos três
// rateados — mover ESSE seria mexer no item errado, sem efeito nenhum sobre a cascata.
const ORDEM_CATEGORIA = ['honorarios', 'das', 'inss', 'escritorio', 'pro_labore', 'lucros', 'demais']

export const ordenarCategorias = (lista) =>
  [...lista].sort((a, b) => {
    const ia = ORDEM_CATEGORIA.indexOf(a.categoria)
    const ib = ORDEM_CATEGORIA.indexOf(b.categoria)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })

// Todos os rateios de uma competência, de uma vez (uma query em vez de uma por kind).
//
// `basis = 'proporcional_nf'` NÃO é opcional: as linhas `consumo_payable` registram
// abatimentos já feitos, não o rateio. Sem o filtro, um mês já pago apareceria com o
// dobro do imposto — o mesmo motivo pelo qual realPorKind() filtra em
// lib/fiscal-redistribution.js.
export async function buscarRateios(sql, company_id, mes, ano) {
  return sql`
    SELECT fa.id AS alocacao_id, fa.obligation_id, o.kind, fa.client_id,
           fa.invoice_id, fa.amount, fa.provisioned, fa.adjustment
    FROM fiscal_allocations fa
    JOIN fiscal_obligations o ON o.id = fa.obligation_id
    WHERE o.company_id = ${company_id}
      AND o.month = ${mes} AND o.year = ${ano}
      AND fa.basis = 'proporcional_nf'
    ORDER BY o.kind, fa.client_id`
}

// Ordem de consumo DENTRO de um kind: Pharmalog primeiro, depois a maior fatia.
// Só importa quando o valor pago é menor que a soma dos rateios (pagamento parcial da
// guia) — com a guia cheia todos são consumidos e a ordem é indiferente.
const ordemRateio = (a, b) => {
  const pa = Number(a.client_id) === CLIENT_PHARMA
  const pb = Number(b.client_id) === CLIENT_PHARMA
  if (pa !== pb) return pa ? -1 : 1
  return num(b.amount) - num(a.amount)
}

// Ordem do FALLBACK: Pharmalog inteiro primeiro, só depois os demais clientes.
//
// É deliberadamente DIFERENTE de ordenar() em lib/victor-distribution.js, onde a
// competência manda e o Pharmalog só desempata dentro do mês. Aqui a regra pedida é
// "sem rateio → vai para o Pharmalog", e ele tem de vir antes mesmo que outro cliente
// tenha competência mais antiga. Dentro de cada grupo: competência ASC, saldo desc.
export function ordenarFallback(records) {
  const comp = (r) => r.year * 100 + r.month
  const porCompetencia = (a, b) => (comp(a) - comp(b)) || (b._saldo - a._saldo)
  const pharma = records.filter((r) => Number(r.client_id) === CLIENT_PHARMA)
  const resto = records.filter((r) => Number(r.client_id) !== CLIENT_PHARMA)
  return [...pharma.sort(porCompetencia), ...resto.sort(porCompetencia)]
}

// Prepara os candidatos para o planejamento: além do `_saldo` que candidatosDisponiveis()
// já calcula, o quanto ainda resta de LUCRO no payable.
//
// Serve só para dizer de onde o dinheiro saiu (`de_lucro`/`de_servico`), porque
// payables_victor tem um `paid_amount` único — não há duas colunas de pago para debitar.
// A regra do split é a mesma cascata de aplicarDelta(): o lucro absorve primeiro.
// Pagamentos anteriores são assumidos como tendo consumido lucro antes de serviço, pela
// mesma razão — é a única hipótese consistente com o resto do sistema.
export function prepararCandidatos(candidatos) {
  for (const rec of candidatos) {
    const pago = num(rec.paid_amount)
    rec._lucroRestante = Math.max(r2(num(rec.profit_amount) - pago), 0)
  }
  return candidatos
}

// Debita `valor` de um payable, devolvendo a quebra lucro/serviço. Muta `_saldo` e
// `_lucroRestante` — o planejamento inteiro roda sobre a MESMA lista de candidatos,
// então uma categoria enxerga o que a anterior já consumiu.
function debitar(rec, valor) {
  const v = r2(valor)
  const de_lucro = r2(Math.min(v, rec._lucroRestante))
  const de_servico = r2(v - de_lucro)
  rec._saldo = r2(rec._saldo - v)
  rec._lucroRestante = r2(rec._lucroRestante - de_lucro)
  return { de_lucro, de_servico }
}

// Planeja UMA categoria. Puro em relação ao banco; muta apenas os candidatos recebidos.
//
//   1. rateio   — consome os payables ancorados nas NFs que a apuração rateou
//   2. fallback — o que sobrou sai do Pharmalog e, se ainda faltar, dos demais
//
// Um rateio cujo payable não está disponível (recebível do cliente ainda pendente, mês
// de caixa futuro, fatura ainda não recebida) NÃO some: vira `rateios_sem_saldo` e o
// valor desce para o fallback. Sem esse registro, o Victor veria o INSS do Pharmalog
// saindo do Bokada sem entender por quê.
// `client_id` (opcional) restringe a categoria a UM cliente — é o que o breakdown por
// cliente da aba Pagar Victor manda ao pagar "o INSS do Pharmalog", em vez de "INSS".
// Com alvo, os dois passos são filtrados: o rateio só olha a fatia daquele cliente e o
// fallback só consome payables dele. O que não couber NÃO vaza para outro cliente — vira
// `restante`, e o endpoint recusa a gravação (422) em vez de debitar quem o usuário não
// escolheu. Sem `client_id` o comportamento é o de antes (rateio completo + fallback
// Pharmalog → demais), que é o que o modal "Receber" continua usando.
// `invoice_ids` (opcional) prende a categoria às NOTAS que a tela mostrou.
//
// Sem ele, a prévia diverge do card: o breakdown de uma competência exibe o imposto das
// notas DAQUELE recorte, mas `ordemRateio` consome a maior fatia do mês inteiro e o
// fallback começa pela competência mais antiga. Caso real conferido: pedindo "DAS do
// Pharmalog, R$ 345" no card de 03/2026, o motor debitava o payable #45 (NF #7, fatia de
// 748,65) e o serviço ia para o #28 (janeiro) — os dois fora do card, que continuava
// exibindo o mesmo saldo depois de pago. É a mesma armadilha do teto de caixa que o
// "Receber" já teve: dois recortes diferentes para o mesmo número.
export function planejarCategoria({ categoria, kind, valor, rateios, candidatos, client_id = null, invoice_ids = null }) {
  const alocacoes = []
  const rateios_sem_saldo = []
  let restante = r2(valor)

  // ── OPÇÃO 1: imposto não passa pela cascata ───────────────────────────────────────
  // Sai antes dos dois passos: nenhum payable é tocado, `restante` é zero (não há o que
  // "faltar" — não se estava procurando saldo) e o valor inteiro vai para a quitação da
  // guia. `quitacao_direta` é o que quitacoesPorObrigacao() usa no lugar da soma das
  // alocações, que aqui é vazia por construção.
  if (quitaSemConsumir(categoria)) {
    return { alocacoes, restante: 0, rateios_sem_saldo, quitacao_direta: restante, sem_consumo: true }
  }
  const alvoCliente = client_id == null || client_id === '' ? null : Number(client_id)
  const alvoNotas = Array.isArray(invoice_ids) && invoice_ids.length
    ? new Set(invoice_ids.map(Number))
    : null

  // Índice NF → payable. `invoice_id` nulo é lançamento manual, que nunca é alvo de
  // rateio; fica de fora do índice mas continua elegível como fallback.
  const porInvoice = new Map()
  for (const rec of candidatos) {
    if (rec.invoice_id) porInvoice.set(Number(rec.invoice_id), rec)
  }

  // ── PASSO 1: rateios da categoria ──────────────────────────────────────────────────
  const doKind = kind && KINDS_COM_RATEIO.has(kind)
    ? rateios
      .filter((r) => r.kind === kind)
      .filter((r) => alvoCliente == null || Number(r.client_id) === alvoCliente)
      .filter((r) => alvoNotas == null || alvoNotas.has(Number(r.invoice_id)))
      .sort(ordemRateio)
    : []

  for (const rt of doKind) {
    if (restante <= FIM) break
    const cota = r2(Math.min(restante, num(rt.amount)))
    if (cota <= FIM) continue
    const alvo = porInvoice.get(Number(rt.invoice_id))
    if (!alvo || alvo._saldo <= FIM) {
      rateios_sem_saldo.push({
        categoria,
        client_id: rt.client_id,
        invoice_id: rt.invoice_id,
        valor: cota,
        motivo: alvo ? 'payable sem saldo em aberto' : 'sem payable disponível (recebível pendente ou fora do teto de caixa)',
      })
      continue
    }
    const consumido = r2(Math.min(cota, alvo._saldo))
    const fonte = debitar(alvo, consumido)
    alocacoes.push({
      tipo: 'rateio',
      categoria,
      kind,
      obligation_id: rt.obligation_id,
      alocacao_id: rt.alocacao_id,
      client_id: alvo.client_id,
      payable_id: alvo.id,
      invoice_id: alvo.invoice_id,
      month: alvo.month,
      year: alvo.year,
      valor: consumido,
      ...fonte,
    })
    restante = r2(restante - consumido)
    // O rateio era maior que o saldo do payable: o excedente segue para o fallback, mas
    // fica registrado para a tela poder explicar.
    if (consumido < cota - FIM) {
      rateios_sem_saldo.push({
        categoria,
        client_id: rt.client_id,
        invoice_id: rt.invoice_id,
        valor: r2(cota - consumido),
        motivo: 'saldo do payable menor que a fatia rateada',
      })
    }
  }

  // ── PASSO 2: fallback ──────────────────────────────────────────────────────────────
  if (restante > FIM) {
    const pool = candidatos.filter((c) =>
      c._saldo > FIM
      && (alvoCliente == null || Number(c.client_id) === alvoCliente)
      && (alvoNotas == null || alvoNotas.has(Number(c.invoice_id))))
    for (const rec of ordenarFallback(pool)) {
      if (restante <= FIM) break
      const consumido = r2(Math.min(restante, rec._saldo))
      const fonte = debitar(rec, consumido)
      alocacoes.push({
        tipo: Number(rec.client_id) === CLIENT_PHARMA ? 'fallback_pharma' : 'fallback_outros',
        categoria,
        kind,
        // Fallback não tem obrigação de origem por cliente — o dinheiro saiu de um saldo
        // que a apuração não vinculou a esta despesa. `obligation_id` é preenchido depois,
        // no rateio da quitação (a obrigação é a da categoria, não a do payable).
        obligation_id: null,
        alocacao_id: null,
        client_id: rec.client_id,
        payable_id: rec.id,
        invoice_id: rec.invoice_id,
        month: rec.month,
        year: rec.year,
        valor: consumido,
        ...fonte,
      })
      restante = r2(restante - consumido)
    }
  }

  return { alocacoes, restante: r2(restante), rateios_sem_saldo }
}

// Planeja todas as categorias sobre a MESMA lista de candidatos, na ordem canônica.
export function planejar({ pagamentos, rateios, candidatos }) {
  prepararCandidatos(candidatos)
  const porCategoria = []
  const todas = []
  for (const pg of ordenarCategorias(pagamentos)) {
    const r = planejarCategoria({
      categoria: pg.categoria,
      kind: pg.kind,
      valor: pg.valor,
      rateios,
      candidatos,
      client_id: pg.client_id ?? null,
      invoice_ids: pg.invoice_ids ?? null,
    })
    porCategoria.push({
      categoria: pg.categoria, kind: pg.kind, valor: r2(pg.valor),
      client_id: pg.client_id ?? null,
      invoice_ids: pg.invoice_ids ?? null,
      ...r,
    })
    todas.push(...r.alocacoes)
  }
  // `ordem` é global e segue a sequência real do consumo — é o que a tela numera.
  todas.forEach((a, i) => { a.ordem = i + 1 })
  return { alocacoes: todas, por_categoria: porCategoria }
}

// Agrupa as alocações por payable: um payable_payments por payable, com a soma.
//
// Espelha o ?action=distribuir: N alocações (uma por obrigação) apontando para UM
// pagamento. Gravar um pagamento por categoria multiplicaria as linhas do extrato do
// payable sem acrescentar informação — a quebra por categoria já está nas alocações.
export function agruparPorPayable(alocacoes) {
  const mapa = new Map()
  for (const a of alocacoes) {
    const cur = mapa.get(a.payable_id)
    if (cur) {
      cur.valor = r2(cur.valor + a.valor)
      cur.de_lucro = r2(cur.de_lucro + a.de_lucro)
      cur.de_servico = r2(cur.de_servico + a.de_servico)
    } else {
      mapa.set(a.payable_id, {
        payable_id: a.payable_id,
        client_id: a.client_id,
        valor: a.valor,
        de_lucro: a.de_lucro,
        de_servico: a.de_servico,
      })
    }
  }
  return [...mapa.values()]
}

// Quanto cada OBRIGAÇÃO foi quitada por este pagamento.
//
// Não é a soma das alocações de `tipo:'rateio'`: o fallback também quita: se o INSS do
// Pharmalog saiu do saldo do Bokada porque o payable dele não estava disponível, a guia
// do INSS foi paga do mesmo jeito. Então a quitação é por CATEGORIA (tudo o que foi
// consumido para ela), e o teto é o saldo em aberto da obrigação — pagar R$ 500 de uma
// guia de R$ 324,63 não pode gravar paid_amount acima do devido.
// ⚠️ O teto é por OBRIGAÇÃO e acumulado na sessão, não por entrada de categoria.
//
// Com o breakdown por cliente uma mesma guia chega repartida em várias entradas ("DAS do
// Pharmalog" + "DAS do Bokada"). Medindo cada uma contra `saldoDe(ob)` — que só enxerga o
// que já estava gravado — as duas veriam o saldo cheio e a soma poderia passar do devido:
// guia de R$ 300 recebendo 300 + 51. Por isso as entradas do mesmo kind são somadas antes
// de cortar, e sai UMA linha de fiscal_payments por obrigação.
export function quitacoesPorObrigacao(porCategoria, obrigacoesPorKind, saldoDe) {
  const acumulado = new Map()
  for (const c of porCategoria) {
    if (!c.kind) continue
    const ob = obrigacoesPorKind.get(c.kind)
    if (!ob) continue
    // Categoria de imposto (Opção 1) não tem alocação nenhuma — o valor não saiu de payable
    // algum. O que quita a guia é o que foi digitado, e o teto por obrigação abaixo continua
    // valendo igual.
    const consumido = c.quitacao_direta != null
      ? r2(c.quitacao_direta)
      : r2(c.alocacoes.reduce((s, a) => s + a.valor, 0))
    if (consumido <= FIM) continue
    const cur = acumulado.get(ob.id)
    if (cur) cur.consumido = r2(cur.consumido + consumido)
    else acumulado.set(ob.id, { ob, kind: c.kind, consumido, sem_consumo: !!c.sem_consumo })
  }

  const out = []
  for (const { ob, kind, consumido, sem_consumo } of acumulado.values()) {
    const teto = saldoDe(ob)
    const valor = r2(Math.min(consumido, teto))
    if (valor <= FIM) continue
    out.push({
      obligation_id: ob.id,
      kind,
      valor,
      // Diz ao endpoint com que `method` gravar em fiscal_payments: `true` = caixa próprio
      // (Opção 1), `false` = abatimento do saldo do Victor. lib/fiscal-unlink.js só desfaz
      // os de 'abatimento', e é exatamente essa a diferença — um pagamento em dinheiro não
      // pode ser revertido pelo estorno de um payable com que ele nada tem a ver.
      sem_consumo: !!sem_consumo,
      // Excedente = o Victor pagou mais do que a guia devia. O dinheiro sai do payable
      // de qualquer forma (ele gastou), mas a obrigação não pode ficar superquitada.
      excedente: r2(consumido - valor),
    })
  }
  return out
}

export { FIM as LIMIAR_FIM, PAID_EPSILON }
