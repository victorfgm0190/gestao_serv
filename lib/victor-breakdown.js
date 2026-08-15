// BREAKDOWN POR CLIENTE — a aba "Pagar Victor" vista por cliente, não por lançamento.
//
// A aba sempre listou payables (uma linha por NF recebida) e mostrava o imposto como
// leitura. O que faltava era a pergunta que o Victor faz na hora de pagar: "deste cliente,
// quanto ainda devo em serviço, em lucro, e quanto de DAS/INSS/Escritório coube a ele?".
//
// ⚠️ ESTE MÓDULO NÃO CALCULA NADA NOVO. É agregação.
//
//   serviço / lucro   ← payables_victor.service_amount / profit_amount
//   cascata           ← cascataDoLucro() (lib/fiscal-redistribution.js), já anexada ao row
//   DAS/INSS/Escrit.  ← fiscal_allocations (basis='proporcional_nf'), já anexado em r.fiscal
//
// Recalcular a partir de invoices+receivables daria um SEGUNDO dono de cada número, que é
// exatamente a classe de bug que este projeto já pagou duas vezes: o pró-labore com três
// donos (três valores diferentes) e a regra financeira escolhida pela ordem física da heap.
// A entrada aqui são as linhas que o GET de api/payables-victor.js já montou e filtrou —
// mesmo recorte de mês/visão que a tela mostra, então breakdown e lista não têm como
// divergir.
//
// ⚠️ A ÂNCORA DO IMPOSTO É A NOTA, NÃO O MÊS — a mesma advertência de lib/victor-rateio.js.
// `r.fiscal` vem de um JOIN por `invoice_id`, e é por isso que ele funciona: o payable #28
// (Pharmalog) tem competência 01/2026 enquanto a obrigação que o rateia é a de 02/2026
// (a apuração agrupa pela data de emissão). Agrupar imposto por mês do payable pegaria o
// DAS de outra nota, sem erro e sem aviso.

import { r2, parseNotes } from './victor-distribution.js'
import { momentosDaLinha } from './victor-momentos.js'

const num = (v) => parseFloat(v) || 0

// `emission_date` chega como Date pelo driver e como string ISO pelo JSON. `String(date)`
// dá "Mon Feb 02 2026", o split('-') não casa e a data some sem erro — o mesmo tropeço
// já documentado na visão fiscal. Normaliza os dois formatos.
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10))

// Categorias do breakdown, na ordem em que a tela as empilha.
// `servico` e `lucro` são colunas do payable; as três seguintes são rateio fiscal.
//
// "Escritório" é o kind `honorarios` (os R$ 150 da contabilidade) — o kind `escritorio` é
// legado da migração de victor_reserves e nunca gerou fiscal_allocations. Mesmo mapeamento
// de CATEGORIA_KIND em lib/victor-rateio.js; divergir aqui faria a tela pedir um rateio que
// o motor de pagamento nunca encontraria.
export const CATEGORIAS = ['lucro', 'servico', 'das', 'inss', 'escritorio']

export const CATEGORIA_LABEL = {
  lucro: 'Lucro',
  servico: 'Serviço Victor',
  das: 'DAS',
  inss: 'INSS',
  escritorio: 'Escritório',
}

// Categoria do breakdown → kind de fiscal_obligations. null = não é obrigação fiscal.
export const BREAKDOWN_KIND = {
  lucro: null,
  servico: null,
  das: 'das',
  inss: 'inss',
  escritorio: 'honorarios',
}

const KIND_CATEGORIA = { das: 'das', inss: 'inss', honorarios: 'escritorio' }

// Quebra o `paid_amount` único do payable em lucro e serviço.
//
// payables_victor tem UMA coluna de pago — não há como debitar lucro e serviço em
// separado. A hipótese é a mesma de prepararCandidatos() (lib/victor-rateio.js) e a mesma
// cascata de aplicarDelta(): o lucro absorve primeiro. Manter uma hipótese única entre
// exibição e pagamento é o que impede o saldo mostrado de divergir do saldo consumido.
export function quebrarPago(profit_amount, paid_amount) {
  const pago = Math.max(num(paid_amount), 0)
  const lucro = r2(Math.min(pago, Math.max(num(profit_amount), 0)))
  return { lucro, servico: r2(pago - lucro) }
}

const vazia = () => ({ devido: 0, pago: 0, saldo: 0 })

// Uma linha de categoria já fechada: saldo nunca negativo (o excedente vira `excedente`,
// visível em vez de escondido num número negativo que a tela somaria).
function fechar(devido, pago, extra = {}) {
  const d = r2(devido)
  const p = r2(pago)
  return { devido: d, pago: p, saldo: r2(Math.max(d - p, 0)), excedente: r2(Math.max(p - d, 0)), ...extra }
}

// Monta o breakdown por cliente a partir das linhas já enriquecidas pelo GET.
//
//   rows        payables_victor do recorte ativo, com .fiscal, .cascata e .payments
//   consumos    quanto de cada obrigação já foi abatido de cada cliente
//               (fiscal_allocations basis='consumo_payable', agrupado por client+kind)
//   nomes       client_id → nome
//
// O percentual do rateio ("INSS 92,74%") sai das PRÓPRIAS linhas, que já trazem
// `obrigacao_total` e `obligation_id` da query. Acumula-se numerador e denominador e
// divide-se no fim: um cliente cujo card abrange duas obrigações do mesmo kind (duas NFs
// de competências diferentes, o que acontece com o filtro em "todos os meses") tem a fatia
// somada, e não a última sobrescrevendo a primeira.
//
// ⚠️ O denominador é deduplicado POR OBRIGAÇÃO. Somá-lo por linha faria um cliente com duas
// NFs na MESMA guia contá-la duas vezes: no ano inteiro o Pharmalog saía com 54,55% onde
// a fatia real é 70,4%.
//
// `previo` é a saída de momentoPrevio() (lib/victor-momentos.js) e `curKey` o teto de
// caixa do mês corrente (AAAAMM) — os dois opcionais: o Dashboard e o Histórico consomem
// este mesmo breakdown sem eles.
export function montarBreakdown({
  rows = [], consumos = new Map(), nomes = new Map(), previo = null, curKey = null,
} = {}) {
  const porCliente = new Map()

  for (const r of rows) {
    // Previsões (recebível ainda não pago) não têm payable: não há saldo a pagar, e
    // incluí-las faria a tela oferecer um input que grava em nada. Ficam fora, como já
    // ficam fora dos totalizadores da aba.
    if (r.is_preview) continue
    // Linhas `origin='fiscal'` são o espelho de fiscal_obligations (lib/fiscal-lines.js) —
    // o que a empresa DEVE ao fisco, não ao Victor, e sem cliente. Somá-las aqui contaria o
    // mesmo imposto duas vezes: ele já aparece por cliente via rateio. Mesmo motivo pelo
    // qual candidatosDisponiveis() as exclui.
    if (r.origin === 'fiscal') continue

    const cid = r.client_id == null ? null : Number(r.client_id)
    const chave = cid == null ? 'sem_cliente' : cid
    if (!porCliente.has(chave)) {
      porCliente.set(chave, {
        client_id: cid,
        client_name: r.client_name || nomes.get(cid) || 'Sem cliente',
        nf: { total: 0, fabricio: 0, invoice_ids: [] },
        payable_ids: [],
        // Competências que o card agrega. Com o filtro em "todos os meses" um cliente
        // junta lançamentos de meses diferentes num card só, e sem dizer quais o usuário
        // lê isso como o filtro de mês tendo falhado — foi exatamente a leitura do
        // Bokada, cujos lançamentos de jan (#42) e fev (#44) estão certos e separados no
        // banco, mas aparecem somados quando o recorte é o ano.
        _comp: new Map(),
        _cat: { lucro: vazia(), servico: vazia(), das: vazia(), inss: vazia(), escritorio: vazia() },
        cascata: null,
        conferencia: null,
        avisos: [],
        // Nem todo saldo é pagável: candidatosDisponiveis() só aceita payable manual ou
        // cujo recebível do cliente já foi pago/parcial — não se desconta imposto de
        // dinheiro que ainda não entrou. Sem esta marca o card ofereceria um input que o
        // motor recusaria com 422, e o usuário leria isso como bug.
        disponivel: false,
        aguardando: 0,
        // { [kind]: { num, dens: Map<obligation_id, total> } } — fatia do cliente sobre o
        // rateio total das obrigações em que ele aparece (cada guia contada uma vez).
        _pct: {},
        // Momentos 2 e 3 acumulados por categoria. `final` fica null enquanto NENHUMA das
        // guias do cliente foi lançada — distinto de R$ 0,00, que é uma guia zerada.
        _mom: { das: { real: 0, final: null }, inss: { real: 0, final: null }, escritorio: { real: 0, final: null } },
        // Extrato do cliente: um item por pagamento, para o saldo corrente adiante.
        _pagos: [],
        // Total devido do cliente, ponto de partida do saldo corrente do extrato.
        _devido: 0,
        // Imposto real que as NFs deste cliente não retiveram (real − provisão de 7%).
        _excedente: 0,
        // Soma das provisões retidas pelas notas do card — o DAS do Momento 1.
        _provisao: 0,
        // Caixa futuro: candidatosDisponiveis() recusa payable cujo mês de caixa é
        // posterior ao teto, e a recusa é silenciosa. Sem esta marca o card mostra saldo
        // e o pagamento não acontece, o que se lê como bug do filtro de mês.
        _futuro: 0,
        // Contrato que não emite nota (`invoices.require_nf = false`, hoje só a Minas).
        // Contado, não booleano: o cliente só é "sem NF" quando NENHUMA das notas do
        // recorte é tributável — uma nota com NF já o traz de volta para o rateio.
        // Mesmo predicado `temNf` de api/fiscal-obligations.js: só `false` exclui,
        // coluna nula é tributável.
        _nf: { com: 0, sem: 0 },
      })
    }
    const c = porCliente.get(chave)
    c.payable_ids.push(r.id)
    if (r.invoice_id) { if (r.require_nf === false) c._nf.sem += 1; else c._nf.com += 1 }
    const km = Number(r.year) * 100 + Number(r.month)
    if (!c._comp.has(km)) c._comp.set(km, { mes: Number(r.month), ano: Number(r.year) })
    const podePagar = !r.receivable_status || r.receivable_status === 'pago' || r.receivable_status === 'parcial'
    const saldoLinha = Math.max(r2(num(r.total_amount) - num(r.paid_amount)), 0)
    if (podePagar) c.disponivel = true
    else c.aguardando = r2(c.aguardando + saldoLinha)

    // Teto de caixa, espelhando candidatosDisponiveis(): payment_month/year com fallback
    // na competência. Só conta como bloqueado o que ainda tem saldo — um payable já quitado
    // com caixa futuro não impede nada.
    if (curKey != null && saldoLinha > 0) {
      const py = Number(r.payment_year) || Number(r.year)
      const pm = Number(r.payment_month) || Number(r.month)
      if (py * 100 + pm > curKey) c._futuro = r2(c._futuro + saldoLinha)
    }

    // Extrato: um item por pagamento. O saldo corrente é calculado depois, quando o total
    // devido do cliente já é conhecido.
    c._devido = r2(c._devido + num(r.total_amount))
    for (const p of r.payments || []) {
      c._pagos.push({
        payment_id: Number(p.id),
        payable_id: Number(r.id),
        invoice_id: r.invoice_id == null ? null : Number(r.invoice_id),
        data: iso(p.paid_at),
        valor: num(p.amount),
        notes: p.notes || null,
        // Quebra por categoria da sessão, pela inversa de montarNotes(). É o que permite
        // ler "R$ 207 de DAS" em vez de só "R$ 207" num extrato de várias despesas.
        categorias: parseNotes(p.notes),
        competencia: { mes: Number(r.month), ano: Number(r.year) },
      })
    }

    // ── serviço e lucro: colunas do payable ──────────────────────────────────────────
    const quebra = quebrarPago(r.profit_amount, r.paid_amount)
    c._cat.lucro.devido = r2(c._cat.lucro.devido + num(r.profit_amount))
    c._cat.lucro.pago = r2(c._cat.lucro.pago + quebra.lucro)
    c._cat.servico.devido = r2(c._cat.servico.devido + num(r.service_amount))
    c._cat.servico.pago = r2(c._cat.servico.pago + quebra.servico)

    // ── imposto: rateio da NF, ancorado por invoice_id ───────────────────────────────
    if (r.invoice_id) c.nf.invoice_ids.push(Number(r.invoice_id))
    const aRedistribuir = num(r.fiscal?.a_redistribuir)
    // Provisão retida por esta nota — a base do Momento 1. Vem de invoices.tax_amount via
    // r.fiscal.provisionado, então é o valor que a fatura realmente reteve, não 7% recalculado.
    c._provisao = r2(c._provisao + num(r.fiscal?.provisionado))
    if (r.conferencia) {
      c.nf.total = r2(c.nf.total + num(r.conferencia.nf))
      c.nf.fabricio = r2(c.nf.fabricio + num(r.conferencia.fabricio))
      // O desvio da conferência e o imposto ainda não redistribuído são, quase sempre, o
      // MESMO fato visto de dois ângulos: enquanto o excedente não é aplicado, o payable
      // ainda carrega o valor da provisão e a decomposição da NF não pode fechar. Avisar
      // duas vezes faria todo mês não-redistribuído parecer ter um erro de cálculo além
      // do atraso. Só sobra o aviso quando o desvio NÃO é explicado por ele.
      // Sob a Opção 1 há uma segunda explicação legítima para o desvio, e é a normal
      // agora: o imposto real passou do que a NF reteve, e a diferença deixou de ser
      // descontada do Victor. Ver `explicado_pelo_excedente` em lib/victor-recorte.js.
      const explicado = r.conferencia.explicado_pelo_excedente
        || Math.abs(r2(r.conferencia.diferenca - aRedistribuir)) <= 0.05
      if (!r.conferencia.confere && !explicado) {
        c.avisos.push(`NF ${r.invoice_id}: decomposição não fecha (desvio ${r.conferencia.diferenca.toFixed(2)}).`)
      }
      // Quanto do imposto do cliente a NF NÃO reteve. Não é aviso de erro: é o custo que
      // sai do caixa da empresa desde que o imposto parou de ser descontado do Victor.
      c._excedente = r2(c._excedente + Math.max(num(r.conferencia.excedente_fiscal), 0))
    } else if (r.invoice_amount != null) {
      c.nf.total = r2(c.nf.total + num(r.invoice_amount))
    }

    for (const l of r.fiscal?.linhas || []) {
      const cat = KIND_CATEGORIA[l.kind]
      // kind sem categoria no breakdown (pro_labore, escritorio legado) não é rateado por
      // cliente — não tem onde entrar sem inventar um dono.
      if (!cat) continue
      c._cat[cat].devido = r2(c._cat[cat].devido + num(l.amount))

      // Momentos 2 e 3 da MESMA linha: a fatia do cliente aplicada ao estimado e ao
      // oficial. Ver momentosDaLinha() — os dois são reconstruídos pela proporção porque
      // fiscal_allocations só guarda o estágio corrente.
      const mm = momentosDaLinha(l)
      c._mom[cat].real = r2(c._mom[cat].real + (mm.real ?? num(l.amount)))
      if (mm.final != null) c._mom[cat].final = r2((c._mom[cat].final || 0) + mm.final)

      if (num(l.obrigacao_total) > 0) {
        c._pct[l.kind] = c._pct[l.kind] || { num: 0, dens: new Map() }
        c._pct[l.kind].num = r2(c._pct[l.kind].num + num(l.amount))
        // `set`, não soma: a mesma guia vista por duas NFs do cliente entra uma vez só.
        c._pct[l.kind].dens.set(l.obligation_id ?? `nf${r.invoice_id}`, num(l.obrigacao_total))
      }
    }

    // Cascata do lucro: soma dos saldos correntes das NFs do cliente. Somável porque cada
    // etapa é uma subtração linear sobre a anterior — o waterfall de dois payables é o
    // waterfall da soma.
    if (r.cascata) {
      c.cascata = c.cascata || {
        lucro_antes_escritorio: 0, escritorio: 0, lucro_antes_inss: 0,
        inss: 0, lucro_antes_das: 0, das: 0, lucro_final: 0, capital_proprio: 0,
        // Quanto o imposto DE FATO tirou do payable — zero sob a Opção 1. Distinto de
        // `lucro_final`, que continua sendo a aritmética "o imposto comeria isto do lucro"
        // e segue negativa mesmo quando nada é descontado.
        absorvido_lucro: 0, absorvido_servico: 0,
      }
      for (const k of Object.keys(c.cascata)) c.cascata[k] = r2(c.cascata[k] + num(r.cascata[k]))
    }

    // Excedente do imposto real que a apuração já rateou mas o ?action=recalcular ainda
    // não aplicou: enquanto ≠ 0, serviço e lucro exibidos ainda são os da provisão.
    if (Math.abs(aRedistribuir) > 0.005) {
      c.avisos.push(`NF ${r.invoice_id}: ${aRedistribuir.toFixed(2)} de imposto ainda não redistribuído — aplique em /fiscal.`)
    }
  }

  // ── fecha as categorias com o que já foi consumido de cada cliente ──────────────────
  const saida = []
  for (const c of porCliente.values()) {
    const consumoCliente = consumos.get(c.client_id) || {}

    const categorias = {}
    // Serviço e lucro: o "pago" veio do próprio payable.
    categorias.lucro = fechar(c._cat.lucro.devido, c._cat.lucro.pago, {
      // ⚠️ Sai da absorção REAL, não de `lucro_final < 0`.
      //
      // `lucro_final` é a aritmética da cascata e continua negativa quando o imposto supera
      // o lucro — mas sob a Opção 1 (2026-08-14) isso não desconta nada. Manter a condição
      // antiga faria todo cliente nessa situação exibir "a cascata zerou o lucro" ao lado de
      // um lucro que está inteiro.
      cascade_aplicado: r2(c.cascata?.absorvido_lucro) > 0.005,
      cascade_valor: r2(c.cascata?.absorvido_lucro),
    })
    categorias.servico = fechar(c._cat.servico.devido, c._cat.servico.pago, {
      // Quanto do imposto o serviço absorveu porque o lucro não cobriu. Zero sob a Opção 1.
      absorveu_do_lucro: r2(c.cascata?.absorvido_servico),
    })

    for (const cat of ['das', 'inss', 'escritorio']) {
      const kind = BREAKDOWN_KIND[cat]
      const acc = c._pct[kind]
      const den = acc ? r2([...acc.dens.values()].reduce((s, v) => s + v, 0)) : 0
      const pct = den > 0 ? acc.num / den : null
      categorias[cat] = fechar(c._cat[cat].devido, consumoCliente[kind] || 0, {
        rateio_percentual: pct == null ? null : r2(pct * 100),
        origem: pct == null
          ? null
          : cat === 'das'
            // O DAS é % do faturamento do mês, então a fatia do cliente é a própria
            // participação dele — "próprio", não um custo alheio rateado.
            ? `${(pct * 100).toFixed(2)}% do faturamento do mês`
            : `${(pct * 100).toFixed(2)}% rateado do total`,
      })
    }

    const subtotal_receber = r2(categorias.lucro.saldo + categorias.servico.saldo)
    const subtotal_impostos = r2(categorias.das.saldo + categorias.inss.saldo + categorias.escritorio.saldo)
    // Parte do imposto que a NF não reteve. Antes ela era descontada do Victor e não
    // aparecia em lugar nenhum; agora é caixa da empresa e precisa ser visível — é o
    // custo real de ter deixado de absorver.
    const excedente_fiscal = r2(c._excedente)

    // ── os três momentos ──────────────────────────────────────────────────────────────
    const momentoReal = {
      das: c._mom.das.real, inss: c._mom.inss.real, escritorio: c._mom.escritorio.real,
      total: r2(c._mom.das.real + c._mom.inss.real + c._mom.escritorio.real),
    }

    // MOMENTO 1, ancorado nas NOTAS DO CARD — não no mês.
    //
    // ⚠️ A primeira versão puxava o prévio da previsão do MÊS DE EMISSÃO enquanto o card
    // agrupa por COMPETÊNCIA, e os dois descrevem conjuntos de notas diferentes: no card
    // de 03/2026 o Pharmalog saía com prévio R$ 1.978,93 contra real R$ 566,77 — a
    // "diferença entre os momentos" era só a troca das notas por baixo. Comparar dois
    // momentos exige que eles falem das MESMAS notas, então o prévio sai daqui.
    //
    //   das        = a provisão que estas notas retiveram (invoices.tax_amount). É dado
    //                gravado, não estimativa: 7% do contrato, retido antes do split.
    //   inss       = igual ao real, e isto não é preguiça. O INSS prévio e o apurado saem
    //   escritorio   da MESMA fórmula mensal (proLaboreDoMes → calcINSS; honorários é valor
    //                fechado) — nada neles muda na apuração. O único número que a apuração
    //                troca é o DAS, que deixa de ser a provisão do contrato e passa a ser a
    //                alíquota efetiva do Simples. Inventar um "INSS prévio" diferente daria
    //                um segundo dono para um número que só tem uma fórmula.
    const previoDas = r2(c._provisao)
    const momentoPrevioCliente = (previoDas > 0 || momentoReal.total > 0) ? {
      das: previoDas,
      inss: momentoReal.inss,
      escritorio: momentoReal.escritorio,
      total: r2(previoDas + momentoReal.inss + momentoReal.escritorio),
    } : null
    // Momento 3 só existe se ALGUMA guia foi lançada. Para as categorias ainda sem guia
    // vale o estimado — é o que continua devido —, e `aguardando_guia` diz quais são.
    const aguardando_guia = ['das', 'inss', 'escritorio'].filter((k) => c._mom[k].final == null)
    const temFinal = aguardando_guia.length < 3
    const momentoFinal = !temFinal ? null : {
      das: c._mom.das.final ?? c._mom.das.real,
      inss: c._mom.inss.final ?? c._mom.inss.real,
      escritorio: c._mom.escritorio.final ?? c._mom.escritorio.real,
      aguardando_guia,
    }
    if (momentoFinal) {
      momentoFinal.total = r2(momentoFinal.das + momentoFinal.inss + momentoFinal.escritorio)
    }
    const momentos = {
      previo: momentoPrevioCliente,
      real: momentoReal,
      final: momentoFinal,
      // Qual deles é o vigente — o que a tela destaca e o que o payable já reflete.
      atual: temFinal ? 'final' : (momentoReal.total > 0 ? 'real' : 'previo'),
    }
    // Deltas na direção em que o Victor lê: imposto que CAIU sobra para ele.
    const delta = (de, para) => (de == null || para == null ? null : r2(de.total - para.total))
    momentos.delta_previo_real = delta(momentos.previo, momentos.real)
    momentos.delta_real_final = delta(momentos.real, momentos.final)

    // ── extrato com saldo corrente ────────────────────────────────────────────────────
    // Ordem cronológica (o saldo só faz sentido em sequência); empate resolvido pelo id,
    // que é a ordem real de gravação. O saldo parte do total devido do cliente, não do
    // saldo de hoje: o extrato conta a história inteira, e terminar no saldo atual é a
    // conferência de que ela fecha.
    let corrente = c._devido
    const historico_pagamentos = c._pagos
      .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.payment_id - b.payment_id))
      .map((pg) => {
        corrente = r2(corrente - pg.valor)
        return { ...pg, saldo: corrente }
      })

    saida.push({
      client_id: c.client_id,
      client_name: c.client_name,
      nf: { ...c.nf, invoice_ids: [...new Set(c.nf.invoice_ids)] },
      payable_ids: c.payable_ids,
      competencias: [...c._comp.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v),
      categorias,
      momentos,
      historico_pagamentos,
      // Saldo do cliente hoje = devido − pago. É o mesmo `subtotal_receber` por outro
      // caminho; divergirem denuncia payable com pagamento fora de payable_payments.
      saldo_atual: r2(c._devido - c._pagos.reduce((s, x) => s + x.valor, 0)),
      bloqueado_futuro: c._futuro,
      // Cliente cujas notas do recorte são todas `require_nf = false`. Ele não existe
      // para o fisco (sem NF não há fiscal_allocations), então não entra no rateio de
      // DAS/INSS/Escritório — e a tabela tabulada o exclui por completo, porque o Victor
      // recebe e paga esse contrato à parte. Ver lib/victor-tabulado.js.
      sem_nf: c._nf.sem > 0 && c._nf.com === 0,
      cascata: c.cascata,
      // Três subtotais rotulados, porque significam coisas diferentes e somá-los num número
      // só é como o sinal do imposto se perde:
      //   receber  = o que a empresa deve AO VICTOR (é o que entra nos totais da aba)
      //   impostos = o que a empresa deve AO FISCO por conta deste cliente
      //   saida    = caixa total que sai por este cliente (a soma dos dois)
      subtotal_receber,
      subtotal_impostos,
      subtotal_saida: r2(subtotal_receber + subtotal_impostos),
      // Quanto do imposto acima a NF não reteve (real − provisão). Não é um quarto
      // subtotal: já está DENTRO de `impostos`. Serve para dizer de onde sai o dinheiro —
      // a parte retida já foi separada na nota, esta não.
      excedente_fiscal,
      disponivel: c.disponivel,
      aguardando: c.aguardando,
      avisos: c.avisos,
    })
  }

  // Maior saída primeiro — é a ordem em que o Victor decide o que pagar.
  saida.sort((a, b) => b.subtotal_saida - a.subtotal_saida || String(a.client_name).localeCompare(String(b.client_name)))

  // Clientes que existem na PREVISÃO mas não têm payable: o trabalho foi apontado (ou o
  // contrato mensal venceu) e a nota ainda não saiu. Vão numa lista à parte, e não como
  // cards com saldo zero, porque não há o que pagar — o payable só nasce quando o cliente
  // paga o recebível. Misturá-los ofereceria inputs que gravariam em nada, o mesmo motivo
  // pelo qual `is_preview` fica de fora acima.
  const comCard = new Set(saida.map((c) => c.client_id))
  const previstos = []
  for (const [cid, p] of previo?.clientes || []) {
    if (comCard.has(cid)) continue
    if (p.base <= 0) continue
    previstos.push({
      client_id: cid,
      client_name: nomes.get(cid) || `Cliente ${cid}`,
      momentos: { previo: { das: p.das, inss: p.inss, escritorio: p.escritorio, total: p.total, base: p.base, peso: p.peso }, real: null, final: null, atual: 'previo' },
      base: p.base,
      subtotal_impostos: p.total,
    })
  }
  previstos.sort((a, b) => b.base - a.base || String(a.client_name).localeCompare(String(b.client_name)))

  const somar = (sel) => r2(saida.reduce((s, c) => s + sel(c), 0))
  // `null` quando NENHUM card tem aquele momento — distinto de R$ 0,00. Um total zerado
  // onde a guia nunca foi lançada leria como "a guia veio zerada", que é outra coisa.
  const somarMomento = (m) => {
    const comValor = saida.filter((c) => c.momentos[m] != null)
    return comValor.length ? r2(comValor.reduce((s, c) => s + c.momentos[m].total, 0)) : null
  }
  return {
    clientes: saida,
    previstos,
    // O mês inteiro em cada momento, para o cabeçalho comparar os três de uma vez.
    // Só as notas dos cards: os `previstos` (trabalho ainda não faturado) ficam fora e
    // têm total próprio — somá-los aqui faria o "prévio" cobrir um conjunto de notas
    // maior que o "real", e a diferença entre os momentos deixaria de ser a alíquota.
    momentos: {
      previo: somarMomento('previo'),
      real: somarMomento('real'),
      final: somarMomento('final'),
      previsto_nao_faturado: r2(previstos.reduce((s, p) => s + p.subtotal_impostos, 0)),
    },
    totais: {
      receber: somar((c) => c.subtotal_receber),
      impostos: somar((c) => c.subtotal_impostos),
      saida: somar((c) => c.subtotal_saida),
      // Dentro de `impostos`, não somado a ele — ver excedente_fiscal no cliente.
      excedente_fiscal: somar((c) => c.excedente_fiscal),
      bloqueado_futuro: somar((c) => c.bloqueado_futuro),
      por_categoria: Object.fromEntries(
        CATEGORIAS.map((cat) => [cat, somar((c) => c.categorias[cat].saldo)]),
      ),
    },
  }
}
