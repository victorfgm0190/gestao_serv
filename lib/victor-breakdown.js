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

import { r2 } from './victor-distribution.js'

const num = (v) => parseFloat(v) || 0

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
//   pesos       fatia de cada cliente em cada obrigação (o "87,12%" do rateio)
//   nomes       client_id → nome
export function montarBreakdown({ rows = [], consumos = new Map(), pesos = new Map(), nomes = new Map() } = {}) {
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
      })
    }
    const c = porCliente.get(chave)
    c.payable_ids.push(r.id)
    const podePagar = !r.receivable_status || r.receivable_status === 'pago' || r.receivable_status === 'parcial'
    if (podePagar) c.disponivel = true
    else c.aguardando = r2(c.aguardando + Math.max(r2(num(r.total_amount) - num(r.paid_amount)), 0))

    // ── serviço e lucro: colunas do payable ──────────────────────────────────────────
    const quebra = quebrarPago(r.profit_amount, r.paid_amount)
    c._cat.lucro.devido = r2(c._cat.lucro.devido + num(r.profit_amount))
    c._cat.lucro.pago = r2(c._cat.lucro.pago + quebra.lucro)
    c._cat.servico.devido = r2(c._cat.servico.devido + num(r.service_amount))
    c._cat.servico.pago = r2(c._cat.servico.pago + quebra.servico)

    // ── imposto: rateio da NF, ancorado por invoice_id ───────────────────────────────
    if (r.invoice_id) c.nf.invoice_ids.push(Number(r.invoice_id))
    const aRedistribuir = num(r.fiscal?.a_redistribuir)
    if (r.conferencia) {
      c.nf.total = r2(c.nf.total + num(r.conferencia.nf))
      c.nf.fabricio = r2(c.nf.fabricio + num(r.conferencia.fabricio))
      // O desvio da conferência e o imposto ainda não redistribuído são, quase sempre, o
      // MESMO fato visto de dois ângulos: enquanto o excedente não é aplicado, o payable
      // ainda carrega o valor da provisão e a decomposição da NF não pode fechar. Avisar
      // duas vezes faria todo mês não-redistribuído parecer ter um erro de cálculo além
      // do atraso. Só sobra o aviso quando o desvio NÃO é explicado por ele.
      const explicado = Math.abs(r2(r.conferencia.diferenca - aRedistribuir)) <= 0.05
      if (!r.conferencia.confere && !explicado) {
        c.avisos.push(`NF ${r.invoice_id}: decomposição não fecha (desvio ${r.conferencia.diferenca.toFixed(2)}).`)
      }
    } else if (r.invoice_amount != null) {
      c.nf.total = r2(c.nf.total + num(r.invoice_amount))
    }

    for (const l of r.fiscal?.linhas || []) {
      const cat = KIND_CATEGORIA[l.kind]
      // kind sem categoria no breakdown (pro_labore, escritorio legado) não é rateado por
      // cliente — não tem onde entrar sem inventar um dono.
      if (!cat) continue
      c._cat[cat].devido = r2(c._cat[cat].devido + num(l.amount))
    }

    // Cascata do lucro: soma dos saldos correntes das NFs do cliente. Somável porque cada
    // etapa é uma subtração linear sobre a anterior — o waterfall de dois payables é o
    // waterfall da soma.
    if (r.cascata) {
      c.cascata = c.cascata || {
        lucro_antes_escritorio: 0, escritorio: 0, lucro_antes_inss: 0,
        inss: 0, lucro_antes_das: 0, das: 0, lucro_final: 0, capital_proprio: 0,
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
    const pesoCliente = pesos.get(c.client_id) || {}

    const categorias = {}
    // Serviço e lucro: o "pago" veio do próprio payable.
    categorias.lucro = fechar(c._cat.lucro.devido, c._cat.lucro.pago, {
      // A cascata já zerou o lucro na gravação (aplicarDelta clampa em zero) quando o
      // imposto o superou. Dizer isso explicitamente evita a leitura de que o cliente
      // simplesmente não deu lucro.
      cascade_aplicado: !!(c.cascata && c.cascata.lucro_final < -0.005),
      cascade_valor: c.cascata && c.cascata.lucro_final < 0 ? r2(-c.cascata.lucro_final) : 0,
    })
    categorias.servico = fechar(c._cat.servico.devido, c._cat.servico.pago, {
      // Quanto do imposto o serviço absorveu porque o lucro não cobriu.
      absorveu_do_lucro: c.cascata && c.cascata.lucro_final < 0 ? r2(-c.cascata.lucro_final) : 0,
    })

    for (const cat of ['das', 'inss', 'escritorio']) {
      const kind = BREAKDOWN_KIND[cat]
      const pct = pesoCliente[kind]
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

    saida.push({
      client_id: c.client_id,
      client_name: c.client_name,
      nf: { ...c.nf, invoice_ids: [...new Set(c.nf.invoice_ids)] },
      payable_ids: c.payable_ids,
      categorias,
      cascata: c.cascata,
      // Três subtotais rotulados, porque significam coisas diferentes e somá-los num número
      // só é como o sinal do imposto se perde:
      //   receber  = o que a empresa deve AO VICTOR (é o que entra nos totais da aba)
      //   impostos = o que a empresa deve AO FISCO por conta deste cliente
      //   saida    = caixa total que sai por este cliente (a soma dos dois)
      subtotal_receber,
      subtotal_impostos,
      subtotal_saida: r2(subtotal_receber + subtotal_impostos),
      disponivel: c.disponivel,
      aguardando: c.aguardando,
      avisos: c.avisos,
    })
  }

  // Maior saída primeiro — é a ordem em que o Victor decide o que pagar.
  saida.sort((a, b) => b.subtotal_saida - a.subtotal_saida || String(a.client_name).localeCompare(String(b.client_name)))

  const somar = (sel) => r2(saida.reduce((s, c) => s + sel(c), 0))
  return {
    clientes: saida,
    totais: {
      receber: somar((c) => c.subtotal_receber),
      impostos: somar((c) => c.subtotal_impostos),
      saida: somar((c) => c.subtotal_saida),
      por_categoria: Object.fromEntries(
        CATEGORIAS.map((cat) => [cat, somar((c) => c.categorias[cat].saldo)]),
      ),
    },
  }
}
