// TABELA TABULADA DA ABA PAGAR VICTOR — CLIENTE | CATEGORIA | BRUTO | % | LÍQUIDO | STATUS.
//
// O que ela responde, e que os cards por cliente não respondiam de relance: "vou pagar
// R$ 150 de Escritório e R$ 632,40 de DAS — de quem sai cada pedaço, e o que sobra devendo
// depois disso?". Os totais são digitados uma vez em cima; o rateio pelo peso da NF diz
// quanto cabe a cada cliente e a cascata mostra o que fica em aberto.
//
// ⚠️ ESTE MÓDULO NÃO CALCULA VALOR FINANCEIRO NOVO. Ele agrega o breakdown que
// lib/victor-breakdown.js já montou (que por sua vez agrega payables_victor e
// fiscal_allocations) e distribui um número digitado sobre ele.
//
//   BRUTO   ← breakdown.clientes[].categorias[cat].devido      (rateio da apuração)
//   %       ← breakdown.clientes[].categorias[cat].rateio_percentual
//   LÍQUIDO ← saldo (devido − pago) menos o que o valor digitado absorve agora
//
// ── DUAS ADVERTÊNCIAS QUE VÃO POUPAR UMA INVESTIGAÇÃO ──────────────────────────────────
//
// 1. ISTO É EXIBIÇÃO, NÃO PAGAMENTO. Nada aqui grava, e a cascata daqui NÃO é a de
//    lib/victor-rateio.js. As duas divergem num ponto material: no `?action=pagar-com-
//    rateio` o imposto é quitado por ABATIMENTO — o dinheiro sai do payable do Victor, e
//    pagar o DAS reduz também o que ele recebe. Aqui cada categoria é independente: pagar
//    o Escritório do Pharmalog baixa a linha Escritório e o SUB, e não toca em Serviço.
//    É o modelo que o Victor pediu ("BRUTO sempre, LÍQUIDO reduz conforme paga") e é
//    coerente enquanto ninguém gravar por este caminho. Se um dia esta tela ganhar botão
//    de pagar, ela tem de chamar o motor de victor-rateio.js — e então a prévia daqui
//    passa a divergir da gravação, que é exatamente o bug do teto de caixa que o "Receber"
//    já teve. Ou se unifica a semântica, ou não se grava por aqui.
//
// 2. CLIENTE SEM NOTA FICA DE FORA. `require_nf = false` (hoje só a Minas Distribuicao)
//    não gera fiscal_allocations, logo não tem fatia de DAS/INSS/Escritório — e mantê-lo
//    na tabela com as três linhas zeradas convidaria a absorver imposto no saldo dele.
//    O Victor recebe e paga esse contrato à parte. Note que isto é DIFERENTE do
//    `?action=distribuir`, que continua elegendo o payable da Minas como origem de caixa
//    (decisão registrada em CLAUDE.md): lá se consome saldo, aqui se rateia tributo.

import { CLIENT_PHARMA, r2 } from './victor-distribution.js'

const num = (v) => parseFloat(v) || 0

// Limiar de "acabou" — o mesmo FIM de lib/victor-rateio.js. Abaixo disso é resíduo de
// arredondamento, não saldo.
const FIM = 0.005

// As 7 caixas de entrada, na ordem do grid da tela (2 linhas × 4/3 colunas).
// São as MESMAS de RECEIVE_VICTOR_CATEGORIES (Financial.jsx) e de CATEGORIA_KIND
// (lib/victor-rateio.js) — o vocabulário de categoria tem um dono só, e um rótulo a mais
// aqui viraria um valor digitado que nenhum motor sabe consumir.
export const CATEGORIAS_ENTRADA = [
  'honorarios', 'das', 'inss', 'pro_labore',
  'lucros', 'escritorio', 'demais',
]

// As 5 linhas da tabela, na ordem da cascata pedida: o que o fisco leva primeiro, o que o
// Victor recebe depois.
//
// ⚠️ MANTENHA EM SINCRONIA com ORDEM_CATEGORIA (lib/victor-rateio.js), onde `honorarios`
// é este "escritorio". As duas foram alinhadas em 2026-08-12: enquanto o motor consumia
// DAS → INSS → Honorários, a tabela exibia uma ordem e o pagamento gravava outra — e a
// divergência só aparecia quando o dinheiro não cobria tudo, que é justamente quando
// alguém está olhando a tela para decidir o que pagar primeiro.
export const ORDEM_LINHAS = ['escritorio', 'das', 'inss', 'lucro', 'servico']

export const LINHA_LABEL = {
  escritorio: 'Escritório',
  das: 'DAS',
  inss: 'INSS',
  lucro: 'Lucro',
  servico: 'Serviço Victor',
  sub: 'SUB',
  fab: 'FAB',
}

// Categoria digitada → linha da tabela que ela abate. `null` = não tem linha fiscal
// própria e cai direto na cascata Lucro → Serviço.
//
// `honorarios` e `escritorio` caem na MESMA linha de propósito: a linha "Escritório" da
// tabela é o kind `honorarios` (os R$ 150 da contabilidade), e o kind `escritorio` é
// legado da migração de victor_reserves — existe como obrigação, nunca gerou rateio.
// Mapeá-los para linhas distintas criaria uma linha "Escritório legado" sempre vazia.
export const ENTRADA_LINHA = {
  honorarios: 'escritorio',
  escritorio: 'escritorio',
  das: 'das',
  inss: 'inss',
  pro_labore: null,
  lucros: null,
  demais: null,
}

// Rateia `total` entre pesos que somam 1, com o resíduo do arredondamento na maior fatia.
//
// Mesma regra de `ratear()` em api/fiscal-obligations.js — de propósito: é assim que o
// rateio gravado em fiscal_allocations fecha no centavo, e um segundo critério de resíduo
// faria a tabela mostrar um centavo a mais ou a menos que a apuração, sem nada explicar.
// Não é importado de lá porque aquele recebe faturas; este recebe pesos já normalizados.
export function ratearProporcional(total, pesos) {
  const t = r2(total)
  const chaves = [...pesos.keys()]
  if (!chaves.length || Math.abs(t) < FIM) return new Map(chaves.map((k) => [k, 0]))
  const partes = new Map(chaves.map((k) => [k, r2(t * (pesos.get(k) || 0))]))
  const soma = r2([...partes.values()].reduce((s, v) => s + v, 0))
  const residuo = r2(t - soma)
  if (Math.abs(residuo) >= 0.01) {
    const maior = chaves.reduce((a, b) => ((pesos.get(b) || 0) > (pesos.get(a) || 0) ? b : a))
    partes.set(maior, r2(partes.get(maior) + residuo))
  }
  return partes
}

// Ordem dos clientes na tabela e na cascata: Pharmalog primeiro, depois a maior saída.
//
// Espelha `ordenarFallback()` de lib/victor-rateio.js ("sem rateio → Pharmalog", e ele vem
// antes mesmo que outro cliente seja maior) e a ordenação que montarBreakdown() já aplica.
// A spec descreve a mesma fila: Pharmalog → Bokada → ...
export function ordenarClientes(clientes) {
  return [...clientes].sort((a, b) => {
    const pa = Number(a.client_id) === CLIENT_PHARMA
    const pb = Number(b.client_id) === CLIENT_PHARMA
    if (pa !== pb) return pa ? -1 : 1
    return b.subtotal_saida - a.subtotal_saida
      || String(a.client_name).localeCompare(String(b.client_name))
  })
}

// Peso de cada cliente no rateio.
//
// A fonte preferida é o percentual que a apuração JÁ gravou (fiscal_allocations, via
// `categorias[cat].rateio_percentual`): é o mesmo número que a tela /fiscal mostra em
// "Custo por cliente", e recalculá-lo aqui daria um segundo dono para a fatia — a
// armadilha que este projeto já pagou com o pró-labore e com a regra financeira.
//
// As três categorias rateadas usam pesos idênticos por construção (`ratear` é proporcional
// à NF nas três), então basta a primeira que existir. Só quando NENHUMA existe — mês ainda
// não apurado — é que se cai no peso da NF, e a saída avisa (`origem_peso: 'nf'`): sem o
// aviso, uma tabela inteira caindo em Lucro/Serviço pareceria erro de cálculo.
export function pesosDosClientes(clientes) {
  const pct = new Map()
  for (const c of clientes) {
    const p = ['das', 'inss', 'escritorio']
      .map((cat) => c.categorias?.[cat]?.rateio_percentual)
      .find((v) => v != null && v > 0)
    if (p != null) pct.set(c.client_id, p)
  }

  const origem = pct.size ? 'rateio' : 'nf'
  const bruto = new Map()
  for (const c of clientes) {
    bruto.set(c.client_id, origem === 'rateio' ? (pct.get(c.client_id) || 0) : num(c.nf.total))
  }
  const soma = [...bruto.values()].reduce((s, v) => s + v, 0)

  // Normalizado para somar 1. O percentual EXIBIDO continua sendo o cru (a fatia do
  // cliente na guia inteira, como a /fiscal mostra); o normalizado só reparte o valor
  // digitado entre os clientes que estão na tela. Os dois divergem quando a guia cobre
  // cliente fora do recorte — e é por isso que `soma_percentual` volta na resposta.
  const pesos = new Map()
  for (const c of clientes) {
    pesos.set(c.client_id, soma > 0 ? (bruto.get(c.client_id) || 0) / soma : 0)
  }
  return { pesos, percentual: pct, origem, soma_percentual: origem === 'rateio' ? r2(soma) : null }
}

// Pesos de UMA categoria fiscal, tirados dos valores que a apuração já rateou para ela.
//
// ⚠️ Não use o percentual exibido como peso. Ele é arredondado a 2 casas (92,74%), e
// 632,40 × 0,9274 = 586,49 — um centavo abaixo dos 586,50 que fiscal_allocations gravou
// para o Pharmalog. A linha ficava "parcial" com R$ 0,01 em aberto e o centavo transbordava
// para o Serviço, fazendo duas linhas mentirem por causa de um arredondamento de exibição.
// O peso sai dos próprios valores rateados; assim, digitar exatamente o total da guia zera
// as linhas no centavo, que é o caso normal.
//
// `null` quando a categoria não tem rateio nenhum no recorte (mês não apurado, ou kind sem
// rateio como o `escritorio` legado) — aí vale o peso global.
function pesosDaCategoria(clientes, linha) {
  const val = new Map(clientes.map((c) => [c.client_id, Math.max(num(c.categorias?.[linha]?.devido), 0)]))
  const soma = [...val.values()].reduce((s, v) => s + v, 0)
  if (soma <= FIM) return null
  return new Map(clientes.map((c) => [c.client_id, (val.get(c.client_id) || 0) / soma]))
}

// Monta a tabela.
//
//   breakdown    saída de montarBreakdown() — as MESMAS linhas que os cards mostram
//   pagamentos   { honorarios, das, inss, pro_labore, lucros, escritorio, demais }
//
// A cascata, na ordem de ORDEM_LINHAS:
//   1..3  cada categoria fiscal é rateada pelos pesos e abate o saldo daquela linha em
//         cada cliente; o que não couber desce para o pool
//   4..5  o pool (sobras + Pró-labore + Lucros + Demais despesas) é rateado e abate
//         Lucro e depois Serviço de cada cliente
//   6     o que ainda sobrar percorre os clientes na ordem, até acabar ou virar
//         `nao_coberto` — que é dinheiro saindo sem lançamento que o justifique
export function montarTabulado({ breakdown, pagamentos = {} } = {}) {
  const todos = breakdown?.clientes || []
  // Cliente sem NF nunca aparece — ver a advertência 2 no topo do arquivo.
  const excluidos = todos.filter((c) => c.sem_nf)
  const clientes = ordenarClientes(todos.filter((c) => !c.sem_nf))

  const entrada = {}
  for (const k of CATEGORIAS_ENTRADA) entrada[k] = r2(num(pagamentos[k]))
  const totalDigitado = r2(CATEGORIAS_ENTRADA.reduce((s, k) => s + entrada[k], 0))

  const { pesos, percentual, origem, soma_percentual } = pesosDosClientes(clientes)

  // Estado mutável da cascata: o saldo restante de cada linha, por cliente.
  const saldo = new Map()
  for (const c of clientes) {
    saldo.set(c.client_id, Object.fromEntries(
      ORDEM_LINHAS.map((l) => [l, Math.max(num(c.categorias?.[l]?.saldo), 0)]),
    ))
  }
  const absorvido = new Map(clientes.map((c) => [c.client_id, Object.fromEntries(ORDEM_LINHAS.map((l) => [l, 0]))]))
  const rateado = new Map(clientes.map((c) => [c.client_id, Object.fromEntries(ORDEM_LINHAS.map((l) => [l, 0]))]))

  const debitar = (cid, linha, valor) => {
    const s = saldo.get(cid)
    const cabe = r2(Math.min(valor, s[linha]))
    if (cabe <= 0) return 0
    s[linha] = r2(s[linha] - cabe)
    absorvido.get(cid)[linha] = r2(absorvido.get(cid)[linha] + cabe)
    return cabe
  }

  // ── PASSOS 1..3: as três categorias fiscais ────────────────────────────────────────
  let pool = 0
  const porCategoria = []
  for (const linha of ['escritorio', 'das', 'inss']) {
    const valor = r2(CATEGORIAS_ENTRADA
      .filter((k) => ENTRADA_LINHA[k] === linha)
      .reduce((s, k) => s + entrada[k], 0))
    if (valor <= FIM) { porCategoria.push({ linha, valor: 0, absorvido: 0, excedente: 0 }); continue }
    // Peso da própria categoria quando ela tem rateio; o global só como último recurso.
    const fatias = ratearProporcional(valor, pesosDaCategoria(clientes, linha) || pesos)
    let excedente = 0
    let usado = 0
    for (const c of clientes) {
      const fatia = fatias.get(c.client_id) || 0
      rateado.get(c.client_id)[linha] = fatia
      const foi = debitar(c.client_id, linha, fatia)
      usado = r2(usado + foi)
      excedente = r2(excedente + (fatia - foi))
    }
    pool = r2(pool + excedente)
    porCategoria.push({ linha, valor, absorvido: usado, excedente })
  }

  // ── PASSOS 4..5: Lucro e Serviço ───────────────────────────────────────────────────
  // O pool são as sobras acima mais as categorias que não têm linha fiscal própria.
  const semLinha = r2(CATEGORIAS_ENTRADA
    .filter((k) => ENTRADA_LINHA[k] === null)
    .reduce((s, k) => s + entrada[k], 0))
  pool = r2(pool + semLinha)

  const poolInicial = pool
  if (pool > FIM) {
    // Primeira passada proporcional — "LUCRO (saldo disponível, proporcional por cliente)".
    const fatias = ratearProporcional(pool, pesos)
    for (const c of clientes) {
      let resta = fatias.get(c.client_id) || 0
      rateado.get(c.client_id).lucro = resta
      for (const linha of ['lucro', 'servico']) {
        if (resta <= FIM) break
        resta = r2(resta - debitar(c.client_id, linha, resta))
      }
      pool = r2(pool - ((fatias.get(c.client_id) || 0) - resta))
    }
    // Segunda passada: o que um cliente não absorveu cascateia para o próximo, na ordem.
    for (const c of clientes) {
      if (pool <= FIM) break
      for (const linha of ['lucro', 'servico']) {
        if (pool <= FIM) break
        pool = r2(pool - debitar(c.client_id, linha, pool))
      }
    }
  }

  // ── MONTAGEM DAS LINHAS ────────────────────────────────────────────────────────────
  const distribuicao = clientes.map((c) => {
    const s = saldo.get(c.client_id)
    const abs = absorvido.get(c.client_id)
    const rat = rateado.get(c.client_id)
    const rows = ORDEM_LINHAS.map((linha) => {
      const bruto = r2(num(c.categorias?.[linha]?.devido))
      const liquido = r2(s[linha])
      return {
        category: linha,
        label: LINHA_LABEL[linha],
        bruto,
        // Só as três fiscais têm percentual; Lucro e Serviço são o saldo do próprio
        // payable, não uma fatia de nada — a coluna fica em branco, como na spec.
        percentual: ['escritorio', 'das', 'inss'].includes(linha)
          ? (percentual.get(c.client_id) ?? null)
          : null,
        liquido,
        // O que o valor digitado tirou desta linha agora, e quanto lhe foi rateado.
        // `rateado > absorvido` é a linha que recebeu mais do que devia e transbordou.
        absorvido: abs[linha],
        rateado: rat[linha],
        status: statusLinha(bruto, liquido),
      }
    })
    const bruto = r2(rows.reduce((t, r) => t + r.bruto, 0))
    const liquido = r2(rows.reduce((t, r) => t + r.liquido, 0))
    rows.push({
      category: 'sub', label: LINHA_LABEL.sub,
      bruto, percentual: null, liquido,
      absorvido: r2(rows.reduce((t, r) => t + r.absorvido, 0)),
      rateado: r2(rows.reduce((t, r) => t + r.rateado, 0)),
      status: 'subtotal',
    })
    return {
      client_id: c.client_id,
      client_name: c.client_name,
      percentage: percentual.get(c.client_id) ?? null,
      bruto_total: bruto,
      rows,
      // Informativo e fora de todos os totais: o Fabrício sai da FATURA e é pago na aba
      // dele. Contá-lo aqui somaria à conta do Victor um valor que nunca passa por ela.
      fabricio_share: r2(num(c.nf?.fabricio)),
      nf_total: r2(num(c.nf?.total)),
      competencias: c.competencias || [],
      // O card recusaria o pagamento com 422 enquanto o cliente não pagar o recebível
      // (candidatosDisponiveis). Aqui não bloqueia nada — é exibição —, mas a tabela
      // precisa dizer, senão o LÍQUIDO promete um pagamento que o motor não faria.
      disponivel: c.disponivel,
      aguardando: c.aguardando,
      bloqueado_futuro: c.bloqueado_futuro,
      avisos: c.avisos || [],
    }
  })

  const somar = (sel) => r2(distribuicao.reduce((t, c) => t + sel(c), 0))
  const sub = (c) => c.rows[c.rows.length - 1]

  return {
    distribution: distribuicao,
    totals: {
      total_bruto: somar((c) => sub(c).bruto),
      total_liquido: somar((c) => sub(c).liquido),
      total_paid: somar((c) => sub(c).absorvido),
      digitado: totalDigitado,
      // Dinheiro digitado que não achou lançamento nenhum onde entrar. Não é resíduo de
      // arredondamento: é o total ter passado do que os clientes do recorte devem.
      nao_coberto: r2(pool),
      fabricio: somar((c) => c.fabricio_share),
    },
    entrada,
    por_categoria: porCategoria,
    pool: { inicial: poolInicial, restante: r2(pool), sem_linha_fiscal: semLinha },
    rateio: {
      origem_peso: origem,
      // Some 100% quando as guias do recorte cobrem só os clientes em tela. Menos que
      // isso = parte da guia é de cliente fora do recorte, e o rateio dos valores
      // digitados foi normalizado entre os presentes.
      soma_percentual,
    },
    // Quem ficou de fora e por quê — sem isto, a Minas some da tela sem explicação e
    // o total da tabela não bate com o total da aba.
    excluidos: excluidos.map((c) => ({
      client_id: c.client_id,
      client_name: c.client_name,
      motivo: 'sem NF (require_nf = false) — fora do rateio de DAS/INSS/Escritório',
      subtotal_receber: c.subtotal_receber,
    })),
  }
}

// bruto 0 não é "pago": é categoria que não existe para aquele cliente (100/0 sem lucro,
// mês sem apuração). Marcá-la como paga encheria a tabela de ✓ enganosos.
function statusLinha(bruto, liquido) {
  if (bruto <= FIM) return 'na'
  if (liquido <= FIM) return 'pago'
  if (liquido < bruto - FIM) return 'parcial'
  return 'pendente'
}
