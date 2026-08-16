import { Fragment, useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { todayBR } from '../lib/dateUtils'
import CopyButton from '../components/CopyButton'
import MemoriaCalculo from '../components/MemoriaCalculo'
import { calcularImpostos } from '../../lib/taxCalc.js'
import { ORDEM_KIND as KIND_ORDEM } from '../../lib/fiscal-lines.js'
// Categoria do modal → `kind` de fiscal_obligations. Importado, não copiado: é o MESMO
// mapa que o motor de pagamento usa, e uma segunda versão aqui faria a seção "a distribuir"
// procurar a obrigação por um nome que o backend não conhece.
import { CATEGORIA_KIND } from '../../lib/victor-rateio.js'

const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
const STATUS_COLORS = {
  pendente: 'bg-yellow-500/20 text-yellow-400',
  pago: 'bg-green-500/20 text-green-400',
  parcial: 'bg-orange-500/20 text-orange-400',
}
const FINANCE_ENDPOINTS = {
  receivables: '/api/receivables',
  fabricio: '/api/payables-fabricio',
  victor: '/api/payables-victor',
}
const VICTOR_CATEGORIES = [
  ['honorarios', 'Honorários'],
  ['das', 'DAS'],
  ['inss', 'INSS'],
  ['pro_labore', 'Pro Labore'],
  ['lucros', 'Lucros'],
  ['demais', 'Demais despesas'],
]
const EMPTY_VICTOR_CATS = { honorarios: '', das: '', inss: '', pro_labore: '', lucros: '', demais: '' }
const victorCategoryTotal = (cats) => VICTOR_CATEGORIES.reduce((s, [k]) => s + (parseFloat(cats[k]) || 0), 0)
const victorCategorySummary = (cats) => VICTOR_CATEGORIES.filter(([k]) => parseFloat(cats[k]) > 0).map(([k, label]) => `${label}: R$${parseFloat(cats[k])}`).join(' | ')

// Distribuição "Receber" — Pagar Victor (inclui Escritório)
const RECEIVE_VICTOR_CATEGORIES = [
  ['honorarios', 'Honorários'],
  ['das', 'DAS'],
  ['inss', 'INSS'],
  ['pro_labore', 'Pro Labore'],
  ['lucros', 'Lucros'],
  ['escritorio', 'Escritório'],
  ['demais', 'Demais despesas'],
]
const EMPTY_RECEIVE_CATS = { honorarios: '', das: '', inss: '', pro_labore: '', lucros: '', escritorio: '', demais: '' }

// Quais das 7 ganham INPUT no modal "Receber" (decisão do Victor, 2026-08-15).
//
// `honorarios` e `das` saíram: eles são rateados por cliente, e pagá-los aqui nunca fez o
// que o nome promete — este modal usa o `?action=pagar-distribuido`, que debita o SALDO dos
// lançamentos e **não quita guia nenhuma**. Quem os paga é a visão Cards, pelo rateio da
// apuração. Ter o mesmo nome nas duas telas com semânticas opostas foi o que produziu dois
// chamados seguidos ("paguei Escritório e caiu no Serviço").
//
// ⚠️ A LISTA DAS 7 CONTINUA INTEIRA em RECEIVE_VICTOR_CATEGORIES, e isso não é sobra:
// `parseNotesToReceiveCats()` reconstrói sessões antigas a partir do `notes`, e uma sessão
// gravada com "DAS: R$586,50" lida por um vocabulário reduzido voltaria SEM essa parcela —
// reeditá-la pagaria a menos, sem erro nenhum. É a mesma armadilha que o CLAUDE.md registra
// para `servico`/`lucro` em CATS. Por isso o grid abaixo também mostra qualquer categoria
// oculta que venha PREENCHIDA de uma sessão anterior.
const RECEIVE_INPUTS = ['inss', 'pro_labore', 'lucros', 'escritorio', 'demais']

// ── Breakdown por cliente (aba Pagar Victor) ────────────────────────────────────────────
// Espelha CATEGORIAS/CATEGORIA_LABEL de lib/victor-breakdown.js e BREAKDOWN_KIND de
// lib/victor-rateio.js. A ordem é a da cascata: o que o Victor recebe primeiro, o que o
// fisco leva depois.
const BREAKDOWN_CATEGORIAS = ['lucro', 'servico', 'das', 'inss', 'escritorio']

// ⚠️ A categoria do CARD não é a categoria do MOTOR — e confundi-las custou um pagamento.
//
// A linha "Escritório" do breakdown é o kind `honorarios` (`BREAKDOWN_KIND` em
// lib/victor-breakdown.js): os R$ 150 da contabilidade, o único dos dois que a apuração
// rateia por cliente. Já `escritorio`, no vocabulário do motor (`CATEGORIA_KIND` em
// lib/victor-rateio.js), é o kind LEGADO da migração de victor_reserves — nunca entrou em
// `KINDS_COM_RATEIO`.
//
// Mandar 'escritorio' cru fazia o motor procurar rateio de um kind que não tem nenhum:
// as 150 não achavam fatia, desciam inteiras para o fallback e debitavam o SERVIÇO, sem
// quitar guia alguma (não existe obrigação `escritorio` na competência). Conferido:
// categoria='escritorio' → 0 alocações e restante 150; categoria='honorarios' → consome
// os 139,11 rateados ao Pharmalog e quita a guia.
//
// `lucro` e `servico` não têm kind (são o saldo do próprio payable) e passam inalteradas.
const BREAKDOWN_CATEGORIA_MOTOR = { escritorio: 'honorarios' }
const BREAKDOWN_LABEL = {
  lucro: 'Lucro',
  servico: 'Serviço Victor',
  das: 'DAS',
  inss: 'INSS',
  escritorio: 'Escritório',
}
// As três categorias que são obrigação fiscal (`das`/`inss`/`honorarios` no backend)
// aparecem com o percentual do rateio ao lado; pagá-las quita a guia da competência, o
// que a prévia informa antes de gravar.

// ── Tabela tabulada (aba Pagar Victor, visão "Tabela") ──────────────────────────────────
// Espelha ORDEM_LINHAS e LINHA_LABEL de lib/victor-tabulado.js. A ordem é a da cascata
// pedida: Escritório → DAS → INSS → Lucro → Serviço, com SUB fechando o cliente.
//
// As caixas de entrada são as MESMAS 7 de RECEIVE_VICTOR_CATEGORIES — o vocabulário de
// categoria tem um dono só (CATS em lib/victor-distribution.js), e um rótulo extra aqui
// viraria um valor digitado que o backend recusa com 400.
// A ORDEM das linhas não é repetida aqui de propósito: ela vem na resposta
// (`rows` já chega em ORDEM_LINHAS), e uma segunda lista local se desalinharia em
// silêncio no dia em que uma categoria entrasse ou saísse.
const TAB_LINHA_LABEL = {
  escritorio: 'Escritório', das: 'DAS', inss: 'INSS',
  lucro: 'Lucro', servico: 'Serviço Victor', sub: 'SUB',
}
const EMPTY_TAB_INPUTS = { ...EMPTY_RECEIVE_CATS }
// Só as 3 fiscais mostram o % — Lucro e Serviço são o saldo do próprio lançamento, não
// fatia de nada.
const TAB_COM_PERCENTUAL = new Set(['escritorio', 'das', 'inss'])

// Rótulos dos `kind` de fiscal_obligations no card de Reservas.
const RESERVA_LABEL = { das: 'DAS', inss: 'INSS', honorarios: 'Honorários', pro_labore: 'Pro Labore', escritorio: 'Escritório' }
// ── Painel "Distribuição do saldo" (modal Receber) ──────────────────────────────────────
// 5 linhas TRABALHÁVEIS (absorvem o que é digitado) + 2 INFORMATIVAS (SUB, que é a soma
// das 5, e FAB, que nunca muda e não tem líquido).
//
// A ordem é a mesma cascata de ORDEM_LINHAS (lib/victor-tabulado.js) e ORDEM_CATEGORIA
// (lib/victor-rateio.js), alinhadas em 2026-08-12.
const DIST_LINHAS = ['escritorio', 'das', 'inss', 'lucro', 'servico']
// As 5 linhas partidas pelo SINAL do que representam. O SUB soma as duas metades, e essa
// soma não é um saldo de ninguém:
//
//   A RECEBER  lucro + serviço — o que a empresa deve AO VICTOR, e o único dinheiro que o
//              pagamento pode consumir. É este que fecha com o "Líquido" do cabeçalho.
//   IMPOSTO    escritório + DAS + INSS — o que a empresa deve AO FISCO por conta daquela
//              nota. Desde a Opção 1 (2026-08-14) ele nunca é consumido pelo pagamento.
//
// ⚠️ Somados, dão um número que não descreve nada: um lançamento quitado fica com "SUB
// 1.026,68" ao lado de "Líquido R$ 0,00" — e o SUB ali é 100% imposto. Foi exatamente essa
// leitura que gerou o relato de que o Líquido estava zerando errado. As duas metades
// aparecem em linhas próprias, rotuladas pelo lado a que pertencem.
const DIST_LINHAS_RECEBER = ['lucro', 'servico']
const DIST_LINHAS_IMPOSTO = ['escritorio', 'das', 'inss']
const DIST_LINHA_LABEL = {
  escritorio: 'Escritório', das: 'DAS', inss: 'INSS',
  lucro: 'Lucro', servico: 'Serviço', sub: 'SUB', fab: 'FAB',
}
// `kind` de fiscal_obligations → linha. `honorarios` são os R$ 150 da contabilidade, que
// é o "Escritório" da tela; o kind `escritorio` é o legado sem rateio e não vira linha.
const DIST_KIND_LINHA = { honorarios: 'escritorio', das: 'das', inss: 'inss' }
// Categoria digitada no modal → linha própria que ela abate primeiro.
// `null` = não tem linha (Pró-labore, Lucros, Demais despesas): desce direto a Lucro → Serviço.
const DIST_ENTRADA_LINHA = {
  honorarios: 'escritorio', escritorio: 'escritorio', das: 'das', inss: 'inss',
  pro_labore: null, lucros: null, demais: null,
}
// Ordem de processamento das entradas — espelha ORDEM_CATEGORIA de lib/victor-rateio.js.
const DIST_ORDEM_ENTRADA = ['honorarios', 'escritorio', 'das', 'inss', 'pro_labore', 'lucros', 'demais']

// Os DOIS modos de cascata, DERIVADOS de DIST_ENTRADA_LINHA — não uma segunda lista.
//
//   IMPOSTO   tem linha própria: consome a linha daquele tributo e, se faltar, desce para
//             Lucro → Serviço. NUNCA toca a linha de outro imposto.
//   TRABALHO  não tem linha própria: vai direto para Lucro → Serviço. NUNCA toca imposto.
//
// ⚠️ `honorarios` é IMPOSTO, não trabalho: é o kind rateado (KINDS_COM_RATEIO = das, inss,
// honorarios) e é ele que alimenta a linha "Escritório". O input `escritorio` é o kind
// legado da migração de victor_reserves — sem rateio —, mas aponta para a mesma linha, e
// por isso também entra como imposto. Classificar `honorarios` como trabalho tiraria a guia
// do contador justamente do modo protegido.
//
// Derivar em vez de listar é o que impede as duas fontes de divergirem: uma categoria nova
// entra nos dois lugares de uma vez.
const modoDaCategoria = (cat) => (DIST_ENTRADA_LINHA[cat] ? 'imposto' : 'trabalho')
const MODO_INFO = {
  imposto: {
    label: 'imposto',
    cls: 'bg-orange-500/15 text-orange-300/90',
    ajuda: 'consome a própria linha; se faltar, desce para Lucro → Serviço. Não toca os outros impostos.',
  },
  trabalho: {
    label: 'trabalho',
    cls: 'bg-blue-500/15 text-blue-300/90',
    ajuda: 'vai direto para Lucro → Serviço. Não toca imposto nenhum.',
  },
}

// Arredondamento para centavos. No ESCOPO DO MÓDULO de propósito.
//
// ⚠️ Vivia duplicado — uma cópia dentro de alocarCascataDist() e outra no meio do corpo do
// componente, logo antes de `distPool`. Quando `impostoAbertoDe()` passou a usá-lo ~50
// linhas ACIMA dessa segunda declaração (2026-08-15), o `const` do componente ainda estava
// na zona morta temporal e a tela quebrou inteira: "Cannot access 'q' before
// initialization" no bundle. Função pura não tem por que morar dentro de escopo nenhum —
// no módulo, não há ordem que a alcance antes da hora.
const cents = (v) => Math.round(v * 100) / 100

// Aloca em cascata o que foi digitado sobre as linhas dos lançamentos. MUTA `lancamentos`
// (reconstruídos a cada render) e devolve o que sobrou de cada entrada.
//
// Para cada categoria digitada, dois passos — os MESMOS de planejarCategoria()
// (lib/victor-rateio.js), que é quem grava:
//   1. a linha própria da categoria, percorrendo todos os lançamentos (mais antigo antes)
//   2. o que sobrar desce para Lucro → Serviço, lançamento a lançamento
//
// Linha já zerada é PULADA, não recebe nada: digitar "Escritório 150" com o escritório já
// quitado manda os 150 inteiros para Lucro/Serviço. É o Cenário 2 da especificação, e é o
// que torna a cascata condicional em vez de posicional.
//
// ⚠️ O total absorvido é exatamente o digitado — uma categoria não é contada duas vezes.
// Digitar "Escritório 150" com 98,57 em aberto tira 98,57 do Escritório e 51,43 do
// Serviço; o SUB cai 150, não 248,57.
function alocarCascataDist(lancamentos, valores) {
  const sobras = {}
  for (const entrada of DIST_ORDEM_ENTRADA) {
    let resta = cents(parseFloat(String(valores?.[entrada] ?? '').replace(',', '.')) || 0)
    if (resta <= 0.005) continue
    const alvo = DIST_ENTRADA_LINHA[entrada]
    const passos = alvo ? [[alvo], ['lucro', 'servico']] : [['lucro', 'servico']]
    // Coluna DIGITADO: a fatia do valor digitado que foi direcionada A ESTA LINHA.
    //
    // 🐞 A primeira versão rateava o digitado PROPORCIONALMENTE entre todas as linhas em
    // aberto daquela categoria, em todas as competências do painel — enquanto o consumo é
    // SEQUENCIAL, do mês mais antigo até o valor acabar. Duas distribuições diferentes para
    // o mesmo dinheiro: com 13 linhas de Escritório em aberto, "Honorários 150" mostrava
    // DIGITADO 4,57 no Bokada de janeiro (3,05% de 150) ao lado de SERÁ PAGO 10,89, e
    // espalhava números arbitrários por meses que a cascata nem alcançava.
    //
    // Agora é registrado NO MOMENTO DO CONSUMO, na mesma ordem e na mesma medida — então
    // as duas colunas descrevem a mesma coisa. Só na primeira passada: o que transborda
    // para Lucro/Serviço foi direcionado ao ALVO, não a eles, e a diferença entre o total
    // digitado e a soma de DIGITADO é exatamente o transbordo.
    let naPrimeiraPassada = true
    for (const cats of passos) {
      for (const l of lancamentos) {
        if (resta <= 0.005) break
        for (const cat of cats) {
          if (resta <= 0.005) break
          const usa = cents(Math.min(resta, l.cats[cat].liquido))
          if (usa <= 0.005) continue
          l.cats[cat].liquido = cents(l.cats[cat].liquido - usa)
          l.cats[cat].absorvido = cents(l.cats[cat].absorvido + usa)
          if (naPrimeiraPassada) l.cats[cat].direcionado = cents(l.cats[cat].direcionado + usa)
          resta = cents(resta - usa)
        }
      }
      naPrimeiraPassada = false
    }
    sobras[entrada] = resta
  }
  return sobras
}

// As 3 visões de data. [chave, rótulo do botão, tooltip]
const MODOS = [
  ['competencia', 'Competência', 'Mês em que o serviço foi prestado'],
  ['fiscal', 'Fiscal', 'Mês de emissão da nota fiscal'],
  ['caixa', 'Caixa', 'Mês em que o dinheiro entrou'],
]
const MODO_LABEL = {
  competencia: 'competência (mês do serviço)',
  fiscal: 'fiscal (mês da emissão da NF)',
  caixa: 'caixa (mês do recebimento)',
}
const receiveCategoryTotal = (cats) => RECEIVE_VICTOR_CATEGORIES.reduce((s, [k]) => s + (parseFloat(cats[k]) || 0), 0)
// Vocabulário COMPLETO de categorias que podem aparecer em payable_payments.notes —
// as 7 do modal "Receber" mais as duas do breakdown por cliente. Tem de bater com CATS
// em lib/victor-distribution.js: o parser abaixo descarta rótulo desconhecido
// (`if (!key) continue`), então uma sessão gravada com "Serviço: R$1000" e lida por um
// parser que não o conhece voltaria sem essa parcela — e reeditá-la pagaria a menos, sem
// erro nenhum. Só os 7 primeiros viram input no modal antigo.
const ALL_VICTOR_CATEGORIES = [
  ...RECEIVE_VICTOR_CATEGORIES,
  ['servico', 'Serviço'],
  ['lucro', 'Lucro'],
]
const RECEIVE_LABEL_TO_KEY = Object.fromEntries(ALL_VICTOR_CATEGORIES.map(([k, label]) => [label, k]))
// Rótulo por chave — usado pelo painel do rateio, que recebe do backend as chaves
// (`honorarios`, `inss`, ...) e não os rótulos.
const CAT_LABEL = Object.fromEntries(ALL_VICTOR_CATEGORIES)
// Reconstrói as categorias a partir da string de notes gravada pelo pagarDistribuido
// (ex.: "Honorários: R$100 | DAS: R$50,5").
function parseNotesToReceiveCats(notes) {
  const cats = { ...EMPTY_RECEIVE_CATS }
  if (!notes) return cats
  for (const part of String(notes).split('|')) {
    const [rawLabel, rawVal] = part.split('R$')
    if (rawVal == null) continue
    const key = RECEIVE_LABEL_TO_KEY[rawLabel.replace(':', '').trim()]
    if (!key) continue
    const v = parseFloat(rawVal.trim().replace(',', '.'))
    if (!isNaN(v) && v > 0) cats[key] = String(v)
  }
  return cats
}
// Igual ao anterior, mas retorna valores numéricos por categoria (para o detalhamento).
function parseNotesToAmounts(notes) {
  const out = {}
  if (!notes) return out
  for (const part of String(notes).split('|')) {
    const [rawLabel, rawVal] = part.split('R$')
    if (rawVal == null) continue
    const key = RECEIVE_LABEL_TO_KEY[rawLabel.replace(':', '').trim()]
    if (!key) continue
    const v = parseFloat(rawVal.trim().replace(',', '.'))
    if (!isNaN(v)) out[key] = (out[key] || 0) + v
  }
  return out
}
// Distribui um valor consumido proporcionalmente entre as categorias da sessão (notesCats/notesTotal).
function proportionalCats(amount, notesCats, notesTotal) {
  const prop = notesTotal > 0 ? amount / notesTotal : 0
  const out = {}
  for (const [k, v] of Object.entries(notesCats)) out[k] = v * prop
  return out
}

export default function Financial() {
  const { activeCompany } = useOutletContext()
  const [tab, setTab] = useState('receivables')
  const [clients, setClients] = useState([])
  const [receivables, setReceivables] = useState([])
  const [payablesFab, setPayablesFab] = useState([])
  const [payablesVictor, setPayablesVictor] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showPayModal, setShowPayModal] = useState(null)
  const [exporting, setExporting] = useState(false)
  // Previstas entram no Excel por padrão, como na tela. Desmarcar exporta só o que já
  // virou payable — útil para conferir contra o que é efetivamente devido hoje.
  const [includePrevistas, setIncludePrevistas] = useState(true)
  const [filterYear, setFilterYear] = useState(new Date().getFullYear())
  const [histType, setHistType] = useState('receivables')
  const [histClient, setHistClient] = useState('')
  const [form, setForm] = useState({ client_id: '', month: new Date().getMonth() + 1, year: new Date().getFullYear(), description: '', amount: '', service_amount: '', profit_amount: '', notes: '' })
  const [payForm, setPayForm] = useState({ paid_amount: '', paid_at: todayBR(), payment_method: '', is_compensation: false, compensation_amount: '', compensation_notes: '', notes: '', status: 'pago' })
  const [modalPayments, setModalPayments] = useState([])
  const [newPay, setNewPay] = useState({ amount: '', paid_at: todayBR(), notes: '' })
  const [estornoConfirm, setEstornoConfirm] = useState(null)
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth() + 1)
  const [filterStatus, setFilterStatus] = useState('all')
  // Três datas distintas por lançamento, e elas divergem de verdade:
  //   competencia → mês do serviço prestado      (payables.month/year)
  //   fiscal      → mês de EMISSÃO da NF         (invoices.emission_date)
  //   caixa       → mês do recebimento           (payables.payment_month/year)
  // Ex. real: Pharmalog Jan/2026 → fiscal 02/02/2026 → caixa 07/2026, três meses diferentes.
  const [mode, setMode] = useState('competencia')
  const [victorCats, setVictorCats] = useState(EMPTY_VICTOR_CATS)
  const [showReceiveModal, setShowReceiveModal] = useState(false)
  const [receiveCats, setReceiveCats] = useState(EMPTY_RECEIVE_CATS)
  const [receivePaidAt, setReceivePaidAt] = useState(todayBR())
  const [editSession, setEditSession] = useState(null) // { paid_at, notes, affected[] } quando editando uma sessão
  // Reservas do mês: { kind: valor em aberto }, derivado de fiscal_obligations.
  const [reserves, setReserves] = useState({})
  const [breakdownView, setBreakdownView] = useState('geral') // 'geral' | 'cliente' — detalhamento de categorias
  const [receiving, setReceiving] = useState(false)
  // O ?action=pagar-com-rateio é acionado pelo breakdown por cliente da aba (bdEnviar),
  // não mais por um checkbox deste modal: lá cada categoria já é digitada no cliente a que
  // pertence, então não há o que rotear. Este modal ficou sendo só o ?action=pagar-
  // distribuido (pool único, mês mais antigo primeiro) do Flow B e da edição de sessão.
  const [pendingVictor, setPendingVictor] = useState([])
  const [receiveTarget, setReceiveTarget] = useState(null) // item quando Flow B (específico), null = Flow A (geral)
  const [overflowInfo, setOverflowInfo] = useState(null)   // { overflow, targetSaldo, target_id } quando há sobra
  const [showMesAnterior, setShowMesAnterior] = useState(false)
  const [saving, setSaving] = useState(false)         // modal de novo lançamento
  const [paying, setPaying] = useState(false)         // modal de pagamento simples
  const [addingPay, setAddingPay] = useState(false)   // modal de múltiplos pagamentos
  const [erroModal, setErroModal] = useState('')
  const [erroPay, setErroPay] = useState('')
  const [erroPayments, setErroPayments] = useState('')
  const [erroReceive, setErroReceive] = useState('')
  // Card "Valores pagos": categorias expandidas e o estorno de um pagamento.
  const [pagosAberto, setPagosAberto] = useState({})   // { [categoria]: bool }
  // Seleção do estorno em lote. Guarda o ITEM inteiro, não só o id: a confirmação precisa
  // mostrar cliente/data/valor, e o item some da lista assim que a categoria é recolhida.
  // ⚠️ Chaveado por payment_id — a mesma sessão aparece em várias categorias (um pagamento
  // de "DAS + INSS" é UMA linha em payable_payments), e contá-la duas vezes inflaria o
  // total da confirmação.
  const [pagosSel, setPagosSel] = useState({})         // { [payment_id]: item }
  const [estornoItens, setEstornoItens] = useState(null) // array em confirmação (1 ou N)
  const [estornando, setEstornando] = useState(false)
  const [estornoAviso, setEstornoAviso] = useState('')
  // Previsão de impostos (só Lumen / company_id=1) — reserva de caixa na aba Pagar Victor.
  const [companySettings, setCompanySettings] = useState(null)
  const [monthFaturamento, setMonthFaturamento] = useState(0)
  // Memória de cálculo do card de previsão. Vem pronta do GET de fiscal-obligations —
  // é a MESMA da tela /fiscal, e é de propósito: a explicação tem de sair de quem
  // calcula de verdade, não de uma segunda conta feita no browser.
  const [calculoMemoria, setCalculoMemoria] = useState(null)
  const [showMemoria, setShowMemoria] = useState(false)
  const [loadingMemoria, setLoadingMemoria] = useState(false)
  const [erroMemoria, setErroMemoria] = useState('')
  // Obrigações da competência de referência, cruas. `reserves` guarda só o saldo em
  // aberto por kind; para lançar a guia do contador é preciso o `id` de cada obrigação.
  const [obligacoesMes, setObligacoesMes] = useState([])
  const [editImpostos, setEditImpostos] = useState(null) // { month, year, aplicar, rows[] }
  const [savingImpostos, setSavingImpostos] = useState(false)
  const [erroImpostos, setErroImpostos] = useState('')
  const [msgImpostos, setMsgImpostos] = useState('')

  // ── BREAKDOWN POR CLIENTE (aba Pagar Victor) ────────────────────────────────────────
  // Serviço, lucro e o imposto rateado de cada cliente, com input de pagamento por
  // categoria. Vem PRONTO do backend (`?breakdown=true`): a cascata e o rateio já têm dono
  // em lib/fiscal-redistribution.js e fiscal_allocations, e reproduzi-los aqui repetiria a
  // história do pró-labore — três donos do mesmo número, três valores diferentes.
  const [breakdown, setBreakdown] = useState(null)
  const [bdLoading, setBdLoading] = useState(false)
  const [bdInputs, setBdInputs] = useState({})       // { [client_id]: { servico: '12,50', das: '' } }
  // Totais das guias rateadas, digitados uma vez e distribuídos pelos clientes.
  const [bdTotais, setBdTotais] = useState({ escritorio: '', das: '', inss: '' })
  const [bdDistMsg, setBdDistMsg] = useState('')
  // Realce temporário do bloco de rateio, ligado pelo botão "Pagar despesas rateadas".
  // Sem ele, o clique troca a visão e o usuário não sabe para onde olhar.
  const [destaqueRateio, setDestaqueRateio] = useState(false)
  // O bloco de rateio ABRE pelo botão "💰 Pagar despesas rateadas" e FECHA pelo Cancelar.
  //
  // ⚠️ Ele nasce fechado porque a barra de pagamento serve aos dois usos da visão Cards —
  // pagar por cliente (digitando no card) e pagar a guia inteira pelo rateio. Deixar os
  // três campos sempre à vista fazia parecer que todo pagamento passava por eles. E o
  // Cancelar, que antes só limpava valores, não tinha efeito visível nenhum quando não
  // havia nada digitado: "clico e não acontece nada" era literalmente verdade.
  const [mostrarRateio, setMostrarRateio] = useState(false)
  const [bdDistErro, setBdDistErro] = useState('')
  const [bdPaidAt, setBdPaidAt] = useState(todayBR())
  const [bdPlano, setBdPlano] = useState(null)        // prévia vinda do backend
  const [bdSaving, setBdSaving] = useState(false)
  const [bdErro, setBdErro] = useState('')
  const [bdMsg, setBdMsg] = useState('')
  const [bdAberto, setBdAberto] = useState({})       // { [client_id]: bool } — cards expandidos

  // ── TABELA TABULADA ─────────────────────────────────────────────────────────────────
  // Segunda visão da mesma aba: os totais são digitados uma vez em cima e a tabela mostra,
  // por cliente e categoria, BRUTO | % | LÍQUIDO. A distribuição vem do BACKEND
  // (?action=calcular-distribuicao) e não de uma cópia da cascata aqui — repetir a
  // fórmula no browser é o que fez a prévia do "Receber" divergir da gravação.
  //
  // ⚠️ Esta visão é LEITURA. Ela não grava: o pagamento continua na visão Cards, cuja
  // semântica de abatimento é diferente (lá o imposto sai do saldo do Victor). Ver a
  // advertência no topo de lib/victor-tabulado.js.
  const [tabView, setTabView] = useState('tabela')   // 'tabela' | 'cards' | 'rastreio'
  const [tabInputs, setTabInputs] = useState(EMPTY_TAB_INPUTS)
  const [tabDist, setTabDist] = useState(null)
  const [tabLoading, setTabLoading] = useState(false)
  const [tabErro, setTabErro] = useState('')

  // Terceira visão: rastreamento origem → destino (`payment_sources`).
  //
  // ⚠️ Ela responde uma pergunta que as outras duas não respondem, e por isso é uma visão
  // e não um painel a mais nos cards: origem e destino são recortes DIFERENTES do mesmo
  // dinheiro. O card do Pharmalog mostra o que ele deve; aqui se vê que o pró-labore de
  // agosto saiu do serviço do Pharmalog de janeiro. Misturar as duas leituras no mesmo
  // card faria o valor de uma parecer subtotal da outra.
  const [rastreio, setRastreio] = useState([])
  const [compensacoes, setCompensacoes] = useState([])
  const [rastreioLoading, setRastreioLoading] = useState(false)
  const [rastreioErro, setRastreioErro] = useState('')
  const [pagandoComp, setPagandoComp] = useState(null)

  useEffect(() => { fetchAll() }, [activeCompany, filterYear, mode])
  useEffect(() => { setHistClient('') }, [histType, filterYear, activeCompany])

  // Fecha TODOS os modais ao trocar de empresa. Sem isso, um modal aberto com
  // item da Lumen combinava payable_id da Lumen com company_id da Imperium na
  // mesma requisição — gravando no lugar errado.
  useEffect(() => {
    setShowModal(false)
    setShowPayModal(null)
    setShowReceiveModal(false)
    setEstornoConfirm(null)
    setReceiveTarget(null)
    setOverflowInfo(null)
    setEditSession(null)
    setModalPayments([])
    setPendingVictor([])
    // A seleção guarda ITENS de uma lista que acabou de ser descartada; mantê-la marcaria
    // pagamentos que não estão mais na tela e o lote estornaria fora do que se vê.
    setPagosSel({}); setEstornoItens(null); setEstornoAviso('')
    setShowMemoria(false)
    setCalculoMemoria(null)
    setEditImpostos(null)
    setObligacoesMes([])
    setMsgImpostos('')
    setErroModal(''); setErroPay(''); setErroPayments(''); setErroReceive(''); setErroMemoria(''); setErroImpostos('')
  }, [activeCompany])
  // Reservas do Victor exibidas no card da aba (mês/ano/empresa do filtro ativo).
  useEffect(() => { if (tab === 'victor') fetchReserves() }, [tab, filterMonth, filterYear, activeCompany])

  // Previsão de impostos: só Lumen. Busca config fiscal + total de NF do mês do filtro.
  useEffect(() => {
    if (tab === 'victor' && activeCompany.id === 1) fetchTaxPreview()
    else { setCompanySettings(null); setMonthFaturamento(0) }
  }, [tab, filterMonth, filterYear, activeCompany])

  async function fetchTaxPreview() {
    const { rm, ry } = reserveRefPeriod()
    try {
      const [setRes, invRes] = await Promise.all([
        fetch(`/api/settings?company_id=${activeCompany.id}`),
        fetch(`/api/invoices?company_id=${activeCompany.id}&year=${ry}`),
      ])
      setCompanySettings((await setRes.json()).data || null)
      const invoices = (await invRes.json()).invoices || []
      // Fatura de contrato sem NF não gera tributo — mesmo recorte da apuração em
      // api/fiscal-obligations.js. Somá-la aqui inflaria a previsão de DAS.
      const total = invoices
        .filter(i => Number(i.month) === Number(rm) && i.require_nf !== false)
        .reduce((s, i) => s + (parseFloat(i.invoice_value) || 0), 0)
      setMonthFaturamento(total)
    } catch (e) { console.error(e) }
  }

  async function fetchAll() {
    setLoading(true)
    try {
      const [cl, rec, fab, vic] = await Promise.all([
        fetch(`/api/clients?company_id=${activeCompany.id}`),
        fetch(`/api/receivables?company_id=${activeCompany.id}&year=${filterYear}&mode=${mode}`),
        fetch(`/api/payables-fabricio?company_id=${activeCompany.id}&year=${filterYear}&mode=${mode}&include_preview=true`),
        fetch(`/api/payables-victor?company_id=${activeCompany.id}&year=${filterYear}&mode=${mode}&include_preview=true`),
      ])
      setClients((await cl.json()).clients || [])
      setReceivables((await rec.json()).data || [])
      setPayablesFab((await fab.json()).data || [])
      setPayablesVictor((await vic.json()).data || [])
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }

  // Breakdown por cliente. Busca separada do fetchAll de propósito: a lista carrega o ANO
  // (o filtro de mês é client-side, para trocar de mês sem ir ao servidor), mas o
  // breakdown precisa do recorte exato do mês — e quem sabe recortar por competência,
  // emissão ou caixa é o backend, que já faz isso para a lista.
  async function fetchBreakdown() {
    if (tab !== 'victor') return
    setBdLoading(true)
    try {
      const qs = new URLSearchParams({
        company_id: activeCompany.id, year: filterYear, mode, breakdown: 'true',
      })
      if (filterMonth !== '') qs.set('month', filterMonth)
      const res = await fetch(`/api/payables-victor?${qs.toString()}`)
      const data = await res.json()
      setBreakdown(res.ok ? (data.breakdown || null) : null)
    } catch (e) { console.error(e); setBreakdown(null) }
    finally { setBdLoading(false) }
  }
  useEffect(() => { fetchBreakdown() }, [tab, activeCompany, filterYear, filterMonth, mode])

  // ── REFETCH DEPOIS DE GRAVAR ────────────────────────────────────────────────────────
  //
  // A aba tem SEIS fontes independentes — `fetchAll` (as três listas), `fetchBreakdown`
  // (os cards por cliente), `fetchReserves` (impostos), `fetchPendingVictor` (a lista do
  // modal e o card "Valores pagos"), `fetchTaxPreview` e `fetchRastreio` — mais a tabela
  // tabulada, que recalcula no backend por um efeito próprio.
  //
  // Cada gravação chamava só `fetchAll()`. O resultado é o relato de "confirmei e a tela
  // não mudou": as listas atualizavam, mas os CARDS — que é onde o valor é lido — ficavam
  // com o estado anterior até se sair da aba e voltar, quando os efeitos rodam de novo.
  //
  // ⚠️ NÃO é `window.location.reload()`. O reload perde o filtro de mês, a visão ativa
  // (Tabela/Cards/Rastreio), a rolagem e o scroll do modal, e recarrega o bundle inteiro —
  // caro e, pior, com cara de aplicativo que reinicia a cada pagamento. O que faltava era
  // recarregar o que mudou, não recomeçar.
  const [refreshTick, setRefreshTick] = useState(0)
  async function refreshFinancial() {
    // A tabela tabulada é calculada no backend por um efeito com debounce próprio; ela não
    // tem função para chamar, então acompanha o tick. É a "Opção B" — trigger de estado.
    setRefreshTick(t => t + 1)
    await Promise.all([
      fetchAll(),
      fetchBreakdown(),
      fetchReserves(),
      fetchPendingVictor(),
      tab === 'victor' && activeCompany.id === 1 ? fetchTaxPreview() : null,
      tabView === 'rastreio' ? fetchRastreio() : null,
    ].filter(Boolean))
  }

  // Limpa o que foi digitado ao mudar o recorte: os valores se referem aos clientes e
  // notas daquele mês, e mantê-los aplicaria um número pensado para outro período.
  useEffect(() => {
    setBdInputs({}); setBdPlano(null); setBdErro(''); setBdMsg('')
  }, [tab, activeCompany, filterYear, filterMonth, mode])

  // Itens do ?action=pagar-com-rateio a partir do que foi digitado. `invoice_ids` prende o
  // consumo às MESMAS notas do card — sem isso o motor consome a maior fatia do mês e a
  // linha paga não é a exibida (ver planejarCategoria em lib/victor-rateio.js).
  function bdPagamentos() {
    const out = []
    for (const c of breakdown?.clientes || []) {
      const digitado = bdInputs[c.client_id] || {}
      for (const cat of BREAKDOWN_CATEGORIAS) {
        const valor = parseFloat(String(digitado[cat] ?? '').replace(',', '.')) || 0
        if (valor <= 0) continue
        // Traduz para o vocabulário do motor — ver BREAKDOWN_CATEGORIA_MOTOR.
        out.push({
          categoria: BREAKDOWN_CATEGORIA_MOTOR[cat] || cat,
          client_id: c.client_id, invoice_ids: c.nf.invoice_ids, valor,
        })
      }
    }
    return out
  }

  const bdTotalDigitado = bdPagamentos().reduce((s, p) => s + p.valor, 0)

  // ── DISTRIBUIR UMA DESPESA RATEADA ENTRE OS CLIENTES ────────────────────────────────
  //
  // Digitar o total da guia uma vez e deixar o rateio dizer quanto cabe a cada um —
  // Honorários 150 vira Pharmalog 139,11 + Bokada 10,89.
  //
  // ⚠️ O PESO É O SALDO, NÃO O PERCENTUAL EXIBIDO. Duas razões, ambas já documentadas:
  //
  //   1. O percentual é arredondado a 2 casas, e `632,40 × 0,9274 = 586,49` — um centavo
  //      abaixo do que fiscal_allocations gravou. A linha ficaria "parcial" com R$ 0,01 em
  //      aberto e o centavo transbordaria para o Serviço (é o mesmo cuidado de
  //      pesosDaCategoria() em lib/victor-tabulado.js).
  //   2. Rateio sobre o DEVIDO ignoraria o que já foi pago: com o Pharmalog quitado,
  //      digitar os 10,89 que faltam mandaria 92,74% para quem não deve mais nada. Pelo
  //      saldo, vai tudo para o Bokada, que é quem resta.
  //
  // Quando o total digitado é exatamente a soma dos saldos (o caso normal — pagar a guia
  // inteira), cada cliente recebe o PRÓPRIO saldo, sem multiplicação: assim a soma fecha no
  // centavo por construção, em vez de depender do resíduo.
  const CATEGORIAS_RATEADAS = ['escritorio', 'das', 'inss']

  function distribuirRateado(cat) {
    // Cliente sem NF não tem rateio de imposto (hoje só a Minas) — incluí-lo daria a ele
    // uma fatia de uma guia que a nota dele não gerou. Mesmo corte de lib/victor-tabulado.js.
    const alvos = (breakdown?.clientes || [])
      .filter(c => !c.sem_nf)
      .map(c => ({ id: c.client_id, saldo: cents(c.categorias?.[cat]?.saldo || 0), devido: cents(c.categorias?.[cat]?.devido || 0) }))
    const base = alvos.some(a => a.saldo > 0.005) ? 'saldo' : 'devido'
    const elegiveis = alvos.filter(a => a[base] > 0.005)
    const soma = cents(elegiveis.reduce((s, a) => s + a[base], 0))
    const total = cents(parseFloat(String(bdTotais[cat] ?? '').replace(',', '.')) || 0)

    if (total <= 0.005) { setBdDistErro('Informe o total da guia antes de distribuir.'); return }
    if (!elegiveis.length) { setBdDistErro(`Nenhum cliente deste recorte tem ${BREAKDOWN_LABEL[cat]} em aberto.`); return }

    // Total == soma dos saldos: cada um leva o próprio saldo (exato).
    const exato = Math.abs(total - soma) <= 0.005
    const fatias = new Map()
    if (exato) {
      for (const a of elegiveis) fatias.set(a.id, a[base])
    } else {
      let acc = 0
      for (const a of elegiveis) { const v = cents(total * (a[base] / soma)); fatias.set(a.id, v); acc = cents(acc + v) }
      // Resíduo do arredondamento na MAIOR fatia — a mesma regra de ratear() na apuração.
      const resto = cents(total - acc)
      if (Math.abs(resto) >= 0.01) {
        const maior = elegiveis.reduce((x, y) => (y[base] > x[base] ? y : x))
        fatias.set(maior.id, cents(fatias.get(maior.id) + resto))
      }
    }

    setBdInputs(prev => {
      const next = { ...prev }
      for (const [id, v] of fatias) next[id] = { ...(next[id] || {}), [cat]: v.toFixed(2).replace('.', ',') }
      return next
    })
    setBdPlano(null); setBdDistErro('')
    setBdDistMsg(`${BREAKDOWN_LABEL[cat]}: ${fmt(total)} distribuídos entre ${fatias.size} cliente(s)${exato ? '' : ' (proporcional ao saldo)'}${base === 'devido' ? ' — nenhum saldo em aberto, rateado pelo devido' : ''}.`)
  }

  // Prévia e gravação usam O MESMO endpoint, mudando só `aplicar` — a prévia não é uma
  // cópia da cascata no browser. Prévia e gravação divergindo é exatamente o bug que o
  // "Receber" já teve com o teto de caixa.
  async function bdEnviar(aplicar) {
    const pagamentos = bdPagamentos()
    if (!pagamentos.length) { setBdErro('Informe ao menos um valor.'); return }
    if (aplicar) setBdSaving(true)
    setBdErro(''); setBdMsg('')
    try {
      const res = await fetch('/api/payables-victor?action=pagar-com-rateio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: activeCompany.id,
          competencia_mes: refMonth,
          competencia_ano: refYear,
          data_pagamento: bdPaidAt,
          pagamentos,
          aplicar,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setBdErro(data.error || 'Não foi possível processar o pagamento.')
        setBdPlano(data.resumo ? data : null)
        return
      }
      if (aplicar) {
        // Limpa TUDO o que foi digitado — inclusive os totais das guias, que ficavam
        // preenchidos e convidavam a clicar "Distribuir" de novo sobre um saldo que já
        // tinha sido pago (o motor recusaria com 422, mas depois do susto).
        setBdInputs({}); setBdPlano(null)
        setBdTotais({ escritorio: '', das: '', inss: '' })
        setBdDistMsg(''); setBdDistErro('')
        setMostrarRateio(false)
        // A mensagem diz o que foi QUITADO, não só quanto saiu: pagar o rateio não mexe
        // no saldo do Victor, então "R$ 1.107,03 registrado" sozinho não explica o que
        // mudou na tela. E aponta onde estornar — este caminho grava fiscal_payments, que
        // o botão "↩ Estornar" da lista (que desfaz payable_payments) não alcança.
        const guias = (data.resumo?.quitacoes || [])
          .map(q => `${BREAKDOWN_LABEL[q.kind === 'honorarios' ? 'escritorio' : q.kind] || q.kind} ${fmt(q.valor)}`)
          .join(' · ')
        setBdMsg(`✅ ${fmt(data.resumo?.consumido)} registrado.${guias ? ` Guias quitadas: ${guias}.` : ''}${guias ? ' Para desfazer, use /fiscal → Pagamentos.' : ''}`)
        await refreshFinancial()
      } else {
        setBdPlano(data)
      }
    } catch {
      setBdErro('Erro de conexão com o servidor.')
    } finally { setBdSaving(false) }
  }

  function closeModal() {
    setShowModal(false)
    setForm({ client_id: '', month: new Date().getMonth() + 1, year: new Date().getFullYear(), description: '', amount: '', service_amount: '', profit_amount: '', notes: '' })
    setErroModal('')
  }

  async function save() {
    if (saving) return
    setSaving(true)
    setErroModal('')
    try {
      const body = { ...form, company_id: activeCompany.id }
      const res = await fetch(FINANCE_ENDPOINTS[tab], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      // Antes o status era ignorado: num 500 o modal fechava e o formulário era
      // limpo, então o usuário perdia o que digitou achando que tinha salvo.
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErroModal(data.error || 'Não foi possível salvar o lançamento.')
        return
      }
      closeModal()
      refreshFinancial()
    } catch {
      setErroModal('Erro de conexão com o servidor.')
    } finally {
      setSaving(false)
    }
  }

  async function pay(item) {
    if (paying) return
    setPaying(true)
    setErroPay('')
    try {
      const res = await fetch(FINANCE_ENDPOINTS[tab], {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, ...payForm }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErroPay(data.error || 'Não foi possível registrar o pagamento.')
        return
      }
      setShowPayModal(null)
      setPayForm({ paid_amount: '', paid_at: todayBR(), payment_method: '', is_compensation: false, compensation_amount: '', compensation_notes: '', notes: '', status: 'pago' })
      refreshFinancial()
    } catch {
      setErroPay('Erro de conexão com o servidor.')
    } finally {
      setPaying(false)
    }
  }

  async function openPayments(item) {
    setShowPayModal(item)
    setNewPay({ amount: '', paid_at: todayBR(), notes: '' })
    setVictorCats(EMPTY_VICTOR_CATS)
    setBreakdownView('geral')
    setModalPayments(item.payments || [])
    await loadPayments(item)
  }

  async function loadPayments(item) {
    // Linha de previsão: o payable ainda não existe (id é 'preview_N'), então não há
    // pagamentos para buscar — só o demonstrativo da fatura.
    if (item.is_preview) { setModalPayments([]); return }
    const res = await fetch(`/api/payable-payments?payable_type=${tab}&payable_id=${item.id}`)
    setModalPayments((await res.json()).data || [])
  }

  async function addPayment() {
    let amount, notes
    if (tab === 'victor') {
      amount = victorCategoryTotal(victorCats)
      notes = victorCategorySummary(victorCats)
      if (amount <= 0 || !newPay.paid_at) return
    } else {
      if (!newPay.amount || !newPay.paid_at) return
      amount = newPay.amount
      notes = newPay.notes
    }
    if (addingPay) return
    setAddingPay(true)
    setErroPayments('')
    try {
      const res = await fetch('/api/payable-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payable_type: tab, payable_id: showPayModal.id, amount, paid_at: newPay.paid_at, notes }),
      })
      // O backend agora recusa valor acima do saldo devedor — a mensagem dele
      // já informa quanto resta, então exibimos como veio.
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErroPayments(data.error || 'Não foi possível registrar o pagamento.')
        return
      }
      setNewPay({ amount: '', paid_at: todayBR(), notes: '' })
      setVictorCats(EMPTY_VICTOR_CATS)
      await loadPayments(showPayModal)
      refreshFinancial()
    } catch {
      setErroPayments('Erro de conexão com o servidor.')
    } finally {
      setAddingPay(false)
    }
  }

  async function fetchPendingVictor() {
    try {
      // No modo caixa, restringe a lista de distribuição ao mês/ano de caixa do filtro ativo.
      //
      // ⚠️ `pago` entra na lista de propósito, embora um lançamento quitado não tenha saldo
      // a distribuir. O card "Valores pagos" lê o histórico DESTAS linhas, e sem os quitados
      // um pagamento que zerou o lançamento sumia da tela junto com ele — inclusive do
      // estorno. Caso real: R$ 8.900 em Lucros consumiram 8.429,95 do payable #28 e o
      // quitaram; o total pago subiu, mas o pagamento ficou inalcançável.
      //
      // A DISTRIBUIÇÃO não é afetada: `sortedPending` filtra `saldoOf(r) > 0`, e um payable
      // quitado tem saldo zero. É o mesmo corte que candidatosDisponiveis() faz no backend.
      const params = new URLSearchParams({ status: 'pendente,parcial,pago', company_id: activeCompany.id, year: filterYear, mode })
      if (filterMonth !== '') params.set('month', filterMonth)
      const res = await fetch(`/api/payables-victor?${params.toString()}`)
      setPendingVictor((await res.json()).data || [])
    } catch (e) { console.error(e); setPendingVictor([]) }
  }

  // Reservas do mês (ficam no caixa): mês/ano de referência = filtro ativo da tela.
  function reserveRefPeriod() {
    const rm = filterMonth === '' ? (new Date().getMonth() + 1) : Number(filterMonth)
    const ry = Number(filterYear) || new Date().getFullYear()
    return { rm, ry }
  }
  // As reservas deixaram de ser digitadas aqui: vêm da apuração (/fiscal), que calcula
  // DAS e INSS a partir das NFs do mês. A tabela victor_reserves foi migrada para
  // fiscal_obligations e removida — não havia como manter os dois em sincronia.
  //
  // O que se reserva é o que AINDA falta pagar (devido − pago). Obrigação já quitada
  // não precisa mais ser retida no caixa, e se ela foi quitada pelo próprio
  // ?action=distribuir os payables já foram consumidos — contar de novo aqui
  // descontaria o mesmo dinheiro duas vezes.
  async function fetchReserves() {
    const { rm, ry } = reserveRefPeriod()
    try {
      const res = await fetch(`/api/fiscal-obligations?company_id=${activeCompany.id}&year=${ry}&month=${rm}`)
      if (!res.ok) { setReserves({}); setCalculoMemoria(null); setObligacoesMes([]); return }
      const body = await res.json()
      const obrigacoes = body.data || []
      // A memória vem de carona: este GET já a traz, e uma segunda chamada ao clicar
      // no botão pediria ao servidor a mesma coisa duas vezes.
      setCalculoMemoria(body.calculo || null)
      // Idem para as obrigações: o modal de guias precisa do id/kind/amount_actual de
      // cada uma, e são as mesmas linhas de que sai o saldo em aberto abaixo.
      setObligacoesMes(obrigacoes)
      const emAberto = {}
      for (const o of obrigacoes) {
        const devido = o.amount_actual != null ? parseFloat(o.amount_actual) : (parseFloat(o.amount_estimated) || 0)
        const falta = Math.max(devido - (parseFloat(o.paid_amount) || 0), 0)
        if (falta > 0.005) emAberto[o.kind] = (emAberto[o.kind] || 0) + falta
      }
      setReserves(emAberto)
    } catch (e) { console.error(e); setReserves({}); setCalculoMemoria(null); setObligacoesMes([]) }
  }

  // ── Guias oficiais: o contador confirmou os valores reais ────────────────────
  //
  // Nada é calculado aqui. Cada valor digitado vai para o ?action=corrigir-escritorio
  // (= lançar a guia + refazer o rateio por cliente), e só DEPOIS de todas gravadas é
  // que a redistribuição é aplicada, uma vez, pelo ?action=recalcular. Aplicar a cada
  // guia funcionaria — o motor é idempotente, mede sempre contra o baseline da fatura —
  // mas reescreveria os payables N vezes e o "antes/depois" mostrado ao final seria o
  // da última guia, não o da correção inteira.

  const ORDEM_KIND = ['das', 'inss', 'honorarios', 'pro_labore', 'escritorio']
  // Valor da guia como string comparável: null/'' = sem guia lançada (vale o apurado).
  const guiaStr = (v) => (v == null || v === '' ? '' : String(Math.round(parseFloat(v) * 100) / 100))

  function abrirEditImpostos() {
    const { rm, ry } = reserveRefPeriod()
    setErroImpostos(''); setMsgImpostos('')
    const rows = [...obligacoesMes]
      .sort((a, b) => ORDEM_KIND.indexOf(a.kind) - ORDEM_KIND.indexOf(b.kind))
      .map((o) => ({
        id: o.id,
        kind: o.kind,
        estimado: parseFloat(o.amount_estimated) || 0,
        pago: parseFloat(o.paid_amount) || 0,
        original: guiaStr(o.amount_actual),
        valor: guiaStr(o.amount_actual),
      }))
    setEditImpostos({ month: rm, year: ry, aplicar: true, rows })
  }

  const setLinhaImposto = (id, valor) =>
    setEditImpostos((e) => ({ ...e, rows: e.rows.map((r) => (r.id === id ? { ...r, valor } : r)) }))

  async function salvarImpostosReais() {
    if (savingImpostos || !editImpostos) return
    const { rows, aplicar, month: rm, year: ry } = editImpostos

    for (const r of rows) {
      if (r.valor === '') continue
      const v = parseFloat(String(r.valor).replace(',', '.'))
      if (isNaN(v) || v < 0) {
        setErroImpostos(`Valor inválido em ${RESERVA_LABEL[r.kind] || r.kind} — não pode ser negativo.`)
        return
      }
    }
    const alterados = rows.filter((r) => guiaStr(r.valor) !== r.original)
    if (!alterados.length) { setErroImpostos('Nenhum valor foi alterado.'); return }

    setSavingImpostos(true); setErroImpostos('')
    try {
      for (const r of alterados) {
        const res = await fetch('/api/fiscal-obligations?action=corrigir-escritorio', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            obligation_id: r.id,
            tipo: r.kind,
            // Campo em branco = remover o lançamento e voltar a valer o valor apurado.
            imposto_real: r.valor === '' ? null : parseFloat(String(r.valor).replace(',', '.')),
            aplicar: false,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          // As guias anteriores desta rodada já foram gravadas — recarrega para o modal
          // reabrir com o estado real, senão o usuário reenviaria o que já passou.
          await refreshFiscal()
          setErroImpostos(`${RESERVA_LABEL[r.kind] || r.kind}: ${data.error || 'não foi possível salvar a guia.'}`)
          return
        }
      }

      let resumo = ''
      if (aplicar) {
        const res = await fetch('/api/fiscal-obligations?action=recalcular', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ company_id: activeCompany.id, month: rm, year: ry, aplicar: true }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          await refreshFiscal()
          setErroImpostos(`Guias salvas e rateio refeito, mas os lançamentos do Victor não foram atualizados: ${data.error || 'falha ao redistribuir.'}`)
          return
        }
        const d = data.mudancas?.total_victor
        resumo = d && Math.abs(d.diferenca) >= 0.01
          ? ` Victor passa de ${fmt(d.antes)} para ${fmt(d.depois)} (${d.diferenca > 0 ? '+' : ''}${fmt(d.diferenca)}) em ${data.payables_atualizados.length} lançamento(s).`
          : ' Nada mudou no que o Victor tem a receber.'
      }

      setEditImpostos(null)
      setMsgImpostos(`${alterados.length} guia(s) atualizada(s) e rateio por cliente refeito.${resumo}`)
      await refreshFiscal()
    } catch {
      setErroImpostos('Erro de conexão com o servidor.')
    } finally {
      setSavingImpostos(false)
    }
  }

  // Recarrega tudo que a correção das guias mexe: apuração/reservas, previsão e os
  // payables (é a aba Pagar Victor que muda de valor).
  async function refreshFiscal() {
    await refreshFinancial()
  }

  // Abre a memória de cálculo do card de previsão. Normalmente ela já está em mãos
  // (veio no fetchReserves); o fetch aqui é o caminho de exceção — aba aberta antes de
  // a lista carregar, ou a chamada anterior ter falhado.
  async function toggleMemoria() {
    if (showMemoria) { setShowMemoria(false); return }
    setErroMemoria('')
    if (calculoMemoria) { setShowMemoria(true); return }
    const { rm, ry } = reserveRefPeriod()
    setLoadingMemoria(true)
    try {
      const res = await fetch(`/api/fiscal-obligations?company_id=${activeCompany.id}&year=${ry}&month=${rm}`)
      const body = res.ok ? await res.json() : {}
      if (!body.calculo) { setErroMemoria('Não foi possível montar a memória de cálculo deste mês.'); return }
      setCalculoMemoria(body.calculo)
      setShowMemoria(true)
    } catch { setErroMemoria('Erro de conexão com o servidor.') }
    finally { setLoadingMemoria(false) }
  }

  // Estorna UM pagamento. Reusa o DELETE de /api/payable-payments — que já recompõe
  // paid_amount, status e o mês de caixa do payable, e agora também desfaz o abatimento
  // fiscal. Uma rota nova (`?action=reverter-pagamento`) seria um segundo caminho para a
  // mesma operação, e nasceria sem essas três coisas.
  //
  // ⚠️ Não devolve o valor para os campos de input: o estorno recompõe o SALDO, e a tabela
  // de distribuição reflete isso sozinha por ser derivada de `paid_amount`.
  async function confirmarEstornoPagamento() {
    const itens = estornoItens
    if (!itens?.length) return
    setEstornando(true)
    setErroReceive(''); setEstornoAviso('')
    try {
      // Um POST só para o lote inteiro, não N chamadas: o unlink fiscal pode apagar
      // pagamentos que também estão na seleção, e em chamadas separadas a segunda veria
      // 404 num pagamento que o próprio estorno acabou de levar. O backend dedupe e
      // reporta a diferença.
      const ids = [...new Set(itens.map(i => i.payment_id))]
      const res = await fetch('/api/payable-payments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, motivo: 'estorno pela aba Pagar Victor' }),
      })
      const data = await res.json()
      if (!res.ok) { setErroReceive(data.error || 'Não foi possível estornar.'); return }
      setEstornoItens(null)
      setPagosSel({})
      const avisos = []
      // A unidade de reversão do abatimento é o MÊS (lib/fiscal-unlink.js): estornar um
      // pagamento que fazia parte de uma distribuição derruba a competência inteira.
      // Calar sobre isso faria sumir pagamentos que o usuário não mandou estornar.
      if (data.fiscal?.obrigacoes?.length) {
        avisos.push(`Havia distribuição fiscal envolvida: a competência inteira foi desfeita — ${data.fiscal.pagamentos_removidos} pagamento(s) removido(s) e ${data.fiscal.obrigacoes.length} obrigação(ões) voltaram a ficar em aberto. Confira em /fiscal.`)
      }
      // Pedidos > removidos = o unlink fiscal já havia levado o resto. Sem esta linha,
      // "estornei 3 e sumiram 5" pareceria bug.
      if (data.removidos < data.pedidos) {
        avisos.push(`${data.pedidos - data.removidos} dos ${data.pedidos} pagamentos selecionados já haviam sido removidos junto com a distribuição.`)
      }
      if (avisos.length) setEstornoAviso(avisos.join(' '))
      await refreshFinancial()
    } catch (e) {
      console.error(e); setErroReceive('Falha de rede ao estornar.')
    } finally { setEstornando(false) }
  }

  // Total de uma seleção. Soma `valor_pagamento` (o pagamento inteiro), não a fatia da
  // categoria: é a linha de payable_payments que é apagada, e somar as fatias prometeria
  // devolver menos do que o estorno devolve de fato.
  const estornoTotal = (itens) => cents(
    [...new Map((itens || []).map(i => [i.payment_id, i])).values()]
      .reduce((s, i) => s + i.valor_pagamento, 0))
  const pagosSelLista = Object.values(pagosSel)

  // Flow A — Pagar Geral (não vinculado a um registro específico)
  async function openReceive() {
    setReceiveCats(EMPTY_RECEIVE_CATS)
    setReceivePaidAt(todayBR())
    setPendingVictor([])
    // A seleção guarda ITENS de uma lista que acabou de ser descartada; mantê-la marcaria
    // pagamentos que não estão mais na tela e o lote estornaria fora do que se vê.
    setPagosSel({}); setEstornoItens(null); setEstornoAviso('')
    setReceiveTarget(null)
    setOverflowInfo(null)
    setShowMesAnterior(false)
    setErroReceive('')
    setShowReceiveModal(true)
    fetchPendingVictor()
    fetchReserves()
  }

  // Flow B — Pagar em um registro específico (consome o alvo primeiro)
  async function openDistribuir(item) {
    setReceiveCats(EMPTY_RECEIVE_CATS)
    setReceivePaidAt(todayBR())
    setPendingVictor([])
    // A seleção guarda ITENS de uma lista que acabou de ser descartada; mantê-la marcaria
    // pagamentos que não estão mais na tela e o lote estornaria fora do que se vê.
    setPagosSel({}); setEstornoItens(null); setEstornoAviso('')
    setReceiveTarget(item)
    setOverflowInfo(null)
    setShowMesAnterior(false)
    setErroReceive('')
    setShowReceiveModal(true)
    fetchPendingVictor()
    fetchReserves()
  }

  // Editar uma sessão de recebimento em massa: reabre o modal Receber pré-preenchido.
  // O estorno da sessão original só acontece no Confirmar (backend, atômico) — cancelar não altera nada.
  async function openEditReceive(item) {
    const p = (item.payments || [])[0]
    if (!p) { alert('Este registro não possui pagamentos de uma sessão para editar.'); return }
    const paidAt = String(p.paid_at).slice(0, 10)
    const notes = p.notes || ''
    let affected = []
    try {
      const res = await fetch(`/api/payables-victor?action=sessao&company_id=${activeCompany.id}&paid_at=${encodeURIComponent(paidAt)}&notes=${encodeURIComponent(notes)}`)
      affected = (await res.json()).affected || []
    } catch (e) { console.error(e) }
    setEditSession({ paid_at: paidAt, notes, affected })
    setBreakdownView('geral')
    setReceiveCats(parseNotesToReceiveCats(notes))
    setReceivePaidAt(paidAt)
    setReceiveTarget(null)
    setOverflowInfo(null)
    setShowMesAnterior(false)
    setPendingVictor([])
    // A seleção guarda ITENS de uma lista que acabou de ser descartada; mantê-la marcaria
    // pagamentos que não estão mais na tela e o lote estornaria fora do que se vê.
    setPagosSel({}); setEstornoItens(null); setEstornoAviso('')
    setErroReceive('')
    setShowReceiveModal(true)
    fetchPendingVictor()
    fetchReserves()
  }

  function closeReceive() {
    setShowReceiveModal(false)
    setReceiveCats(EMPTY_RECEIVE_CATS)
    setReceiveTarget(null)
    setOverflowInfo(null)
    setShowMesAnterior(false)
    setEditSession(null)
    setErroReceive('')
  }

  async function confirmReceive() {
    const total = Math.round(receiveCategoryTotal(receiveCats) * 100) / 100
    if (total <= 0) return
    if (!receivePaidAt) return
    const paid_at = receivePaidAt
    // Na edição usa a referência efetiva (cobre a competência mais recente da sessão).
    const ref = { reference_month: effRefMonth, reference_year: effRefYear }
    const editBody = editSession ? { edit_session: { paid_at: editSession.paid_at, notes: editSession.notes } } : {}
    const body = receiveTarget
      ? { company_id: activeCompany.id, despesas: receiveCats, mode: 'especifico', payable_id: receiveTarget.id, overflow_action: null, paid_at, ...ref }
      : { company_id: activeCompany.id, despesas: receiveCats, mode: 'geral', paid_at, ...ref, ...editBody }
    setReceiving(true)
    try {
      const res = await fetch('/api/payables-victor?action=pagar-distribuido', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setErroReceive(data.error || 'Falha ao distribuir'); return }
      if (data.needsDecision) {
        setOverflowInfo({ overflow: data.overflow, targetSaldo: data.targetSaldo, target_id: data.target_id })
        return // mantém o modal aberto para o painel de decisão
      }
      closeReceive()
      await refreshFinancial()
    } finally {
      setReceiving(false)
    }
  }

  // Flow B — resolve a sobra (overflow) conforme a opção escolhida pelo usuário
  async function resolveOverflow(action, overflow_target_id = null) {
    const paid_at = receivePaidAt
    setReceiving(true)
    try {
      const res = await fetch('/api/payables-victor?action=pagar-distribuido', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: activeCompany.id, despesas: receiveCats, mode: 'especifico', payable_id: receiveTarget.id, overflow_action: action, overflow_target_id, paid_at, reference_month: refMonth, reference_year: refYear }),
      })
      const data = await res.json()
      if (!res.ok) { setErroReceive(data.error || 'Falha ao distribuir'); return }
      closeReceive()
      await refreshFinancial()
    } finally {
      setReceiving(false)
    }
  }

  async function deletePayment(p) {
    if (addingPay) return
    setAddingPay(true)
    setErroPayments('')
    try {
      // Só o id vai no body: o backend descobre o payable pai pela própria linha
      // apagada (antes ele recalculava o payable informado aqui, o que podia
      // deixar outro lançamento com paid_amount e status errados).
      const res = await fetch('/api/payable-payments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErroPayments(data.error || 'Não foi possível estornar o pagamento.')
        return
      }
      setEstornoConfirm(null)
      await loadPayments(showPayModal)
      refreshFinancial()
    } catch {
      setErroPayments('Erro de conexão com o servidor.')
    } finally {
      setAddingPay(false)
    }
  }

  async function estornar(item) {
    if (!confirm('Tem certeza que deseja estornar?')) return
    const res = await fetch(`/api/receivables?action=estornar&id=${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id })
    })
    const data = await res.json()
    if (res.status === 400) { alert('⚠️ ' + data.error); return }
    if (!res.ok) { alert('Erro: ' + (data.error || 'Falha ao estornar')); return }
    refreshFinancial()
  }

  async function estornarPayable(item) {
    if (!confirm('Tem certeza que deseja estornar?')) return
    const endpoint = tab === 'victor' ? '/api/payables-victor' : '/api/payables-fabricio'
    const res = await fetch(`${endpoint}?action=estornar&id=${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id })
    })
    const data = await res.json()
    if (!res.ok) { alert('Erro: ' + (data.error || 'Falha ao estornar')); return }
    // O estorno do Fabrício leva junto o crédito de compensação que aquele pagamento
    // gerou. É correto — o crédito existia por causa dele —, mas silencioso se lê como
    // crédito perdido.
    if (data.compensacoes_desfeitas > 0) {
      alert(`Estornado. ${data.compensacoes_desfeitas} crédito(s) de compensação do Victor foram desfeitos junto — eles vinham deste pagamento.`)
    }
    refreshFinancial()
  }

  async function del(id) {
    if (!confirm('Excluir?')) return
    const endpoints = { receivables: '/api/receivables', fabricio: '/api/payables-fabricio', victor: '/api/payables-victor' }
    const res = await fetch(endpoints[tab], {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    })
    const data = await res.json()
    if (res.status === 403) {
      alert('⚠️ ' + data.error)
      return
    }
    refreshFinancial()
  }

  const fmt = (v) => v != null ? `R$ ${parseFloat(v).toFixed(2).replace('.', ',')}` : '-'
  // Mês/ano efetivos conforme a visão: caixa usa payment_month/year; competência usa month/year.
  // Data fiscal = emissão da NF. Sem NF (lançamento manual, linha fiscal) cai na
  // competência — mesmo COALESCE de `faturasDoMes` em api/fiscal-obligations.js, para as
  // duas telas agruparem igual. `slice` em vez de `new Date()`: a coluna é DATE e o parse
  // com fuso jogaria dia 01 para o mês anterior.
  // Aceita tanto a string ISO que o JSON entrega ("2026-02-02T00:00:00.000Z") quanto um
  // Date — `String(date)` daria "Mon Feb 02 2026", o slice sairia sem hífens e a linha
  // cairia no fallback de competência SEM erro nenhum, fazendo a visão fiscal parecer
  // idêntica à de competência. Foi exatamente o que aconteceu no primeiro teste.
  const fiscalParts = (r) => {
    if (!r.emission_date) return null
    const s = typeof r.emission_date === 'string'
      ? r.emission_date
      : new Date(r.emission_date).toISOString()
    const [y, m] = s.slice(0, 10).split('-').map(Number)
    return y && m ? { y, m } : null
  }
  const effMonth = (r) => mode === 'caixa' ? (r.payment_month ?? r.month)
    : mode === 'fiscal' ? (fiscalParts(r)?.m ?? r.month)
    : r.month
  const effYear = (r) => mode === 'caixa' ? (r.payment_year ?? r.year)
    : mode === 'fiscal' ? (fiscalParts(r)?.y ?? r.year)
    : r.year
  const isPreview = (r) => r.is_preview === true
  const isPayTab = tab === 'victor' || tab === 'fabricio'
  const baseData = tab === 'receivables' ? receivables : tab === 'fabricio' ? payablesFab : payablesVictor
  // Na visão fiscal a API devolve um superconjunto de dois anos de competência (a NF de
  // dezembro emitida em janeiro), então o ano tem de ser refiltrado pela data efetiva.
  // Nas outras visões a própria query já veio recortada — refiltrar seria redundante.
  const yearFiltered = mode === 'fiscal'
    ? baseData.filter(r => Number(effYear(r)) === Number(filterYear))
    : baseData
  const monthFiltered = filterMonth === ''
    ? yearFiltered
    : yearFiltered.filter(r => Number(effMonth(r)) === Number(filterMonth))
  // Entradas "previsto" (recebível pendente, ainda sem payable) ficam à parte da lista real.
  const previewData = isPayTab && filterStatus !== 'pago' ? monthFiltered.filter(isPreview) : []
  const realMonthFiltered = monthFiltered.filter(r => !isPreview(r))
  // Oculta registros zerados (R$ 0,00 / null) nas abas de Pagar — não devem contaminar os totais
  const payValue = (r) => parseFloat(tab === 'victor' ? r.total_amount : r.amount) || 0
  const nonZeroFiltered = isPayTab
    ? realMonthFiltered.filter(r => payValue(r) !== 0)
    : realMonthFiltered
  const currentData = filterStatus === 'all'
    ? nonZeroFiltered
    : nonZeroFiltered.filter(r => filterStatus === 'pendente_parcial' ? (r.status === 'pendente' || r.status === 'parcial') : r.status === filterStatus)
  // Linhas fiscais (origin='fiscal') são o espelho de fiscal_obligations: o que o Victor
  // DEVE, não o que tem a receber. Saem da lista de pagamento e dos totais da aba —
  // mesmo recorte do candidatosDisponiveis() no backend — e ganham bloco próprio.
  const isFiscalLine = (r) => r.origin === 'fiscal'
  const fiscalData = tab === 'victor' ? currentData.filter(isFiscalLine) : []
  const payData = currentData.filter(r => !isFiscalLine(r))
  // Disponível = manual (sem recebível) ou recebível do cliente já pago/parcial. Pendente = aguardando.
  const isAvailable = (r) => !r.receivable_status || r.receivable_status === 'pago' || r.receivable_status === 'parcial'
  const availableData = isPayTab ? payData.filter(isAvailable) : payData
  const waitingData = isPayTab ? payData.filter(r => !isAvailable(r)) : []
  const previewTotal = previewData.reduce((s, r) => s + (parseFloat(r.amount || r.total_amount) || 0), 0)
  const victorCatTotal = victorCategoryTotal(victorCats)
  const receiveTotal = receiveCategoryTotal(receiveCats)

  // Painel "Distribuição do saldo" (somente visual) — consome receiveTotal em tempo real.
  // Mês de referência = filtro ativo da tela (não o mês do calendário). "Todos" cai no mês atual.
  const refMonth = filterMonth === '' ? (new Date().getMonth() + 1) : Number(filterMonth)
  const refYear = Number(filterYear) || new Date().getFullYear()
  const REF_KEY = refYear * 100 + refMonth

  // ── TABELA TABULADA: distribuição vinda do backend, com debounce ────────────────────
  // Recorte IDÊNTICO ao de fetchBreakdown (mesmos filterMonth/filterYear/mode): a tabela
  // e os cards têm de descrever os mesmos clientes, senão a diferença passa por erro de
  // rateio em vez de recorte diferente.
  const tabTotalDigitado = RECEIVE_VICTOR_CATEGORIES
    .reduce((s, [k]) => s + (parseFloat(String(tabInputs[k]).replace(',', '.')) || 0), 0)

  useEffect(() => {
    if (tab !== 'victor' || tabView !== 'tabela') return
    let cancelado = false
    // 500ms como pedido: o cálculo é uma ida ao banco, e disparar a cada tecla faria a
    // tabela piscar com resultados de valores já obsoletos.
    const t = setTimeout(async () => {
      setTabLoading(true); setTabErro('')
      try {
        const payments = {}
        for (const [k] of RECEIVE_VICTOR_CATEGORIES) {
          payments[k] = parseFloat(String(tabInputs[k]).replace(',', '.')) || 0
        }
        const res = await fetch('/api/payables-victor?action=calcular-distribuicao', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company_id: activeCompany.id,
            year: filterYear,
            month: filterMonth === '' ? null : Number(filterMonth),
            mode,
            payments,
          }),
        })
        const data = await res.json()
        if (cancelado) return
        if (!res.ok) { setTabErro(data.error || 'Não foi possível calcular a distribuição.'); setTabDist(null); return }
        setTabDist(data)
      } catch (e) {
        if (!cancelado) { console.error(e); setTabErro('Falha de rede ao calcular a distribuição.'); setTabDist(null) }
      } finally {
        if (!cancelado) setTabLoading(false)
      }
    }, 500)
    return () => { cancelado = true; clearTimeout(t) }
    // `refreshTick` entra nas deps para a tabela recalcular depois de uma gravação: os
    // valores dela saem do banco (saldo, rateio), não só do que está digitado.
  }, [tab, tabView, activeCompany, filterYear, filterMonth, mode, tabInputs, refreshTick])

  // Trocar o recorte zera o que foi digitado: os valores se referem aos clientes e notas
  // daquele período, e mantê-los aplicaria um número pensado para outro mês.
  useEffect(() => { setTabInputs(EMPTY_TAB_INPUTS) }, [activeCompany, filterYear, filterMonth, mode])

  // Rastreamento + créditos de compensação. Duas leituras da mesma tabela, buscadas juntas
  // porque a visão mostra as duas e um fetch a menos evita o estado meio-carregado.
  //
  // ⚠️ O filtro é de COMPETÊNCIA DA ORIGEM, e não da data do pagamento: um pagamento feito
  // em agosto consumindo saldo de janeiro pertence a JANEIRO aqui, que é de onde o dinheiro
  // veio. É o mesmo recorte dos cards — ver rastreamentoOD() em lib/fabricio-compensation.js.
  const fetchRastreio = useCallback(async () => {
    setRastreioLoading(true); setRastreioErro('')
    try {
      const p = new URLSearchParams({ company_id: activeCompany.id, year: filterYear })
      if (filterMonth !== '') p.set('month', filterMonth)
      const [r1, r2] = await Promise.all([
        fetch(`/api/payables-victor?action=rastreamento&${p}`),
        fetch(`/api/payables-victor?action=compensacoes&${p}`),
      ])
      const [d1, d2] = [await r1.json(), await r2.json()]
      if (!r1.ok || !r2.ok) { setRastreioErro(d1.error || d2.error || 'Falha ao carregar o rastreamento.'); return }
      setRastreio(d1.data || [])
      setCompensacoes(d2.data || [])
    } catch { setRastreioErro('Erro de conexão com o servidor.') }
    finally { setRastreioLoading(false) }
  }, [activeCompany, filterYear, filterMonth])

  useEffect(() => {
    if (tab !== 'victor' || tabView !== 'rastreio') return
    fetchRastreio()
  }, [tab, tabView, activeCompany, filterYear, filterMonth])

  // Usa um crédito de compensação: ele quita um lançamento do MESMO cliente, sem sair
  // caixa. Não cria payable — ver o comentário de pagarCompensacao() no backend.
  async function usarCompensacao(comp) {
    if (pagandoComp) return
    setPagandoComp(comp.id)
    try {
      const res = await fetch('/api/payables-victor?action=pagar-compensacao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compensation_id: comp.id, company_id: activeCompany.id }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error || 'Não foi possível usar o crédito.'); return }
      await Promise.all([fetchRastreio(), refreshFinancial()])
    } catch { alert('Erro de conexão com o servidor.') }
    finally { setPagandoComp(null) }
  }
  // Previsão de impostos (só Lumen, aba Victor, config fiscal preenchida).
  //
  // A RBT12 sai do faturamento REAL do mês (NFs com require_nf, somadas em
  // fetchTaxPreview) anualizado, não mais de `company_settings.faturamento_medio_mensal`.
  // Aquele campo é escrito pelo Billing com o total de UM mês e envelhece: em Jan/2026
  // ele valia 24.100 (de fevereiro) enquanto o mês faturava 10.540, o que jogava a
  // empresa na 2ª faixa do Simples e previa 7,96% de alíquota onde cabiam 6%.
  //
  // Continua sendo uma estimativa — um mês × 12, não os 12 meses reais. Quem tem a RBT12
  // de verdade é a apuração (/fiscal, via acumular12); o botão da memória de cálculo
  // mostra as duas e explica a diferença.
  const taxPreview = (tab === 'victor' && activeCompany.id === 1 && companySettings && companySettings.regime)
    ? calcularImpostos({ ...companySettings, faturamento_medio_mensal: monthFaturamento }, monthFaturamento)
    : null
  // No caixa, NF emitida no mês M é paga no mês M+1.
  const nextMonth = refMonth === 12 ? 1 : refMonth + 1
  const nextYear = refMonth === 12 ? refYear + 1 : refYear
  // Chave de CAIXA do registro (payment_month/year, com fallback na competência).
  const payKey = (r) => (Number(r.payment_year) || r.year) * 100 + (Number(r.payment_month) || r.month)
  // Na edição, a referência precisa cobrir o mês de CAIXA mais recente entre os payables da sessão
  // (senão algum registro restaurado ficaria fora da redistribuição).
  //
  // O teto principal é o mês de CAIXA da data do pagamento — espelho exato do `curKey` em
  // pagarDistribuido(). Antes saía só do REF_KEY (filtro de competência da tela), e como o
  // caixa de um payable é sempre posterior à sua competência, a prévia aparecia vazia e o
  // backend gravava zero. Os dois lados têm de calcular o mesmo teto, senão a prévia mente.
  const paidAtKey = (() => {
    if (!receivePaidAt) return 0
    const [y, m] = String(receivePaidAt).slice(0, 10).split('-').map(Number)
    return y && m ? y * 100 + m : 0
  })()
  const effectiveRefKey = Math.max(
    paidAtKey,
    REF_KEY,
    ...(editSession && editSession.affected.length ? editSession.affected.map(a => payKey(a)) : []),
  )
  const effRefMonth = effectiveRefKey % 100
  const effRefYear = Math.floor(effectiveRefKey / 100)
  const saldoOf = (r) => Math.round(((parseFloat(r.total_amount) || 0) - (parseFloat(r.paid_amount) || 0)) * 100) / 100
  // Fonte da distribuição: só payables disponíveis (recebível do cliente pago/parcial ou manual).
  // No modo edição, restaura os saldos consumidos pela sessão que será estornada.
  const distSource = (() => {
    // O `!isFiscalLine` espelha o filtro do candidatosDisponiveis(): sem ele a prévia da
    // distribuição mostraria a linha do DAS como saldo consumível e não bateria com o
    // que o backend faz de verdade.
    const availablePending = pendingVictor.filter(r => isAvailable(r) && !isFiscalLine(r))
    if (!editSession || !editSession.affected.length) return availablePending
    const map = new Map()
    for (const r of availablePending) map.set(r.id, { ...r })
    for (const a of editSession.affected) {
      const base = map.get(a.id) || { ...a }
      const restored = (parseFloat(base.paid_amount) || 0) - (parseFloat(a.session_amount) || 0)
      base.paid_amount = restored < 0 ? 0 : restored
      map.set(a.id, base)
    }
    return [...map.values()]
  })()
  // Imposto rateado ainda em aberto num lançamento (soma dos saldos das linhas fiscais).
  // É o que faz um payable QUITADO continuar relevante para a distribuição.
  const impostoAbertoDe = (r) => cents((r.fiscal?.linhas || [])
    .reduce((s, l) => s + (l.saldo ?? l.amount ?? 0), 0))

  const sortedPending = [...distSource]
    // Saldo do lançamento OU imposto rateado em aberto.
    //
    // ⚠️ O `saldoOf(r) > 0` sozinho escondia o Pharmalog: os R$ 8.900 em Lucros quitaram o
    // #28, e a partir daí a linha dele sumiu da tabela — mas a CASCATA DO IMPOSTO continua
    // alcançando o rateio dele. Pagar "Honorários 150" consome Pharmalog 139,11 + Bokada
    // 10,89 no backend (o rateio não depende de saldo, ver planejarCategoria), enquanto a
    // tela mostrava só o Bokada. Era a prévia divergindo da gravação de novo — desta vez
    // por esconder a maior das duas parcelas.
    //
    // Incluí-los não muda o consumo do POOL: `distBase` faz `min(pool, saldo)` e o saldo
    // deles é zero. Eles entram para as cinco linhas serem exibidas, e as fiscais são as
    // únicas com valor.
    .filter(r => saldoOf(r) > 0 || impostoAbertoDe(r) > 0.005)
    .filter(r => payKey(r) <= effectiveRefKey)  // nunca consome mês de CAIXA futuro ao período ativo
    .sort((a, b) => {
      // ⚠️ Idêntico a ordenar() em lib/victor-distribution.js — os dois TÊM de andar
      // juntos, senão a prévia mostra um consumo e a gravação faz outro.
      // 1º quem emite nota antes de quem não emite (a Minas é paga à parte e vai para o
      //    fim da fila); 2º competência ASC; 3º Pharmalog; 4º saldo desc.
      const na = a.require_nf === false, nb = b.require_nf === false
      if (na !== nb) return na ? 1 : -1      // sem NF por último
      const ka = a.year * 100 + a.month, kb = b.year * 100 + b.month
      if (ka !== kb) return ka - kb          // competência ASC (mais antigo primeiro)
      if (a.client_id === 7 && b.client_id !== 7) return -1  // Pharmalog/ANB primeiro
      if (b.client_id === 7 && a.client_id !== 7) return 1
      return saldoOf(b) - saldoOf(a)         // restante por saldo desc
    })
  // Candidatos cortados pelo teto de caixa: têm saldo e estão disponíveis, mas o mês de
  // caixa deles é posterior à data deste pagamento. O backend aplica exatamente o mesmo
  // corte (candidatosDisponiveis), então a lista está certa — o que faltava era dizer
  // POR QUE eles não aparecem. Sumiam sem aviso, e foi assim que o payable 28 (Pharmalog),
  // com o mês de caixa deixado em 07/2026 por um estorno, ficou meses invisível sem que
  // nada indicasse a causa.
  const foraDoTeto = distSource
    .filter(r => saldoOf(r) > 0 && payKey(r) > effectiveRefKey)
    .map(r => ({
      id: r.id, client_name: r.client_name, month: r.month, year: r.year,
      pm: Number(r.payment_month) || r.month, py: Number(r.payment_year) || r.year,
      saldo: saldoOf(r),
    }))
    .sort((a, b) => (a.py * 100 + a.pm) - (b.py * 100 + b.pm))
  // Flow B: no específico o alvo é consumido primeiro
  const orderedPending = receiveTarget
    ? [...sortedPending.filter(r => r.id === receiveTarget.id), ...sortedPending.filter(r => r.id !== receiveTarget.id)]
    : sortedPending
  // Meses anteriores com saldo (para o sub-painel "Ir para mês anterior")
  const prevMonthsWithBalance = sortedPending
    .filter(r => payKey(r) < effectiveRefKey && (!receiveTarget || r.id !== receiveTarget.id))
    .map(r => ({ id: r.id, client_name: r.client_name, month: r.month, year: r.year, saldo: saldoOf(r) }))
  let distPool = cents(receiveTotal)

  // ESTADO INICIAL das 5 linhas trabalháveis, ANTES de alocar o que está sendo digitado.
  // O que foi digitado entra depois, por alocarCascataDist().
  const distBase = orderedPending.map(r => {
    const saldo = saldoOf(r)
    const consumed = Math.min(distPool, saldo)
    const liquido = cents(saldo - consumed)
    distPool = cents(distPool - consumed)
    const state = consumed <= 0 ? 'full' : liquido <= 0 ? 'zero' : 'partial'

    // Lucro e serviço partem do que sobrou dos pagamentos JÁ GRAVADOS (`paid_amount`) —
    // o que está sendo digitado é alocado depois, pela cascata, para que a linha da
    // categoria digitada absorva antes. O lucro é consumido primeiro, a mesma hipótese de
    // quebrarPago() (lib/victor-breakdown.js), prepararCandidatos() (lib/victor-rateio.js)
    // e aplicarDelta(). Hipótese única entre o que a tela mostra e o que o backend debita.
    const pagoGravado = parseFloat(r.paid_amount) || 0
    const lucroTot = parseFloat(r.profit_amount) || 0
    const servTot = parseFloat(r.service_amount) || 0
    const lucroPago = Math.min(pagoGravado, Math.max(lucroTot, 0))

    // ── as 9 colunas, por linha ───────────────────────────────────────────────────────
    //   original    o bruto ANTES de a cascata fiscal mexer nele
    //   absorveu    o que a cascata moveu (imposto que o lucro/serviço cobriu)
    //   bruto       o que está gravado no payable hoje  (= original − absorveu)
    //   pagos       o que já saiu por esta linha (histórico)
    //   liquido     bruto − pagos, e é o que a cascata do que está sendo digitado consome
    //   direcionado / absorvido / (liquido restante)  → DIGITADO / SERÁ PAGO / SOBRA
    //
    // ⚠️ `service_amount` e `profit_amount` JÁ chegam líquidos da cascata (aplicarDelta
    // grava o lucro clampado em zero e o serviço reduzido). Então o ORIGINAL é reconstruído
    // somando de volta o que foi absorvido — subtrair de novo, como a leitura intuitiva
    // sugere, descontaria o mesmo imposto duas vezes. Com isso a identidade
    // `original − absorveu = bruto` fecha em toda linha.
    // ⚠️ A absorção vem do BACKEND (`cascata.absorvido_*`), não é mais deduzida daqui.
    //
    // A dedução antiga era `lucro_antes_escritorio − profit_amount`, que só funcionava
    // enquanto o payable estava reduzido pela cascata. Sob a Opção 1 (2026-08-14) o payable
    // guarda o que a fatura prometeu, e a mesma subtração devolveria a PROVISÃO de 7% como
    // se fosse absorção — R$ 684,25 de "ABSORVEU" no Pharmalog, onde o certo é zero.
    //
    //   antes: absLucro   = max(cascata.lucro_antes_escritorio − lucroTot, 0)
    //          absServico = cascata.lucro_final < 0 ? −cascata.lucro_final : 0
    const absLucro = cents(parseFloat(r.cascata?.absorvido_lucro) || 0)
    const absServico = cents(parseFloat(r.cascata?.absorvido_servico) || 0)
    const linha = (bruto, pagos, absorveu = 0) => ({
      original: cents(bruto + absorveu),
      absorveu: cents(absorveu),
      bruto: cents(bruto),
      pagos: cents(pagos),
      liquido: Math.max(cents(bruto - pagos), 0),
      direcionado: 0,
      absorvido: 0,
      percentual: null,
    })
    const cats = {
      escritorio: linha(0, 0),
      das: linha(0, 0),
      inss: linha(0, 0),
      lucro: linha(lucroTot, lucroPago, absLucro),
      servico: linha(servTot, pagoGravado - lucroPago, absServico),
    }
    // As três fiscais: BRUTO é o rateio da NF; LÍQUIDO já desconta o que foi abatido
    // deste lançamento em pagamentos anteriores (`l.saldo`, de lib/victor-recorte.js).
    // Sem isso a linha mostraria o rateio cheio depois de quitada, e o Cenário 2 da
    // especificação — digitar de novo e pular direto para Lucro/Serviço — não existiria.
    for (const l of r.fiscal?.linhas || []) {
      const cat = DIST_KIND_LINHA[l.kind]
      if (!cat) continue
      // Imposto não sofre cascata: o rateio é o que é. original = bruto, absorveu = 0.
      cats[cat].original = cents(cats[cat].original + l.amount)
      cats[cat].bruto = cents(cats[cat].bruto + l.amount)
      cats[cat].pagos = cents(cats[cat].pagos + (l.pago || 0))
      cats[cat].liquido = cents(cats[cat].liquido + (l.saldo ?? l.amount))
      cats[cat].percentual = l.percentual ?? null
    }

    return {
      id: r.id, month: r.month, year: r.year, client_name: r.client_name,
      // Devido total do lançamento e o que JÁ havia sido pago antes desta sessão.
      //
      // ⚠️ `saldo` (= total − pago) é o que a cascata consome, e sem o par ao lado ele é
      // indistinguível de um lançamento menor. Caso real: o Pharmalog #28 devia 8.795,38 e
      // já tinha 209,16 pagos (Pró-labore + Demais, cinco dias antes), então o saldo era
      // 8.586,22 — e "Lucros 8.900" quitou o lançamento e mandou 313,78 para o Bokada.
      // Foi lido como "faltou consumir 209,16 do Pharmalog", quando aqueles 209,16 já
      // estavam pagos; somá-los de novo pagaria 9.109,16 com 8.900.
      total: cents(parseFloat(r.total_amount) || 0),
      jaPago: cents(pagoGravado),
      // Contrato sem nota: vai para o fim da fila de consumo, e a etiqueta diz por quê —
      // sem ela, um cliente fora da ordem de competência parece erro de ordenação.
      semNf: r.require_nf === false,
      saldo, liquido, state, consumed: cents(consumed), cats,
      // FAB: o que cabe ao Fabrício nesta NF. Informativa e estática — sai da FATURA e é
      // paga na aba dele, então nunca entra no SUB nem é absorvida por nada.
      fabricio: r.conferencia ? cents(r.conferencia.fabricio) : null,
      // Excedente do imposto real que a apuração já rateou mas o ?action=recalcular ainda
      // não aplicou. Enquanto ≠ 0, o payable carrega o valor da PROVISÃO (7%) e o imposto
      // exibido é o REAL — então as linhas fiscais somam mais do que a NF reteve. Hoje
      // isso vale para 13 das 14 notas do banco, então calar deixaria o SUB sem explicação.
      aRedistribuir: cents(r.fiscal?.a_redistribuir || 0),
      // A cascata negativa (imposto > lucro) agora vive nas colunas ORIGINAL/ABSORVEU de
      // cada linha, em `absLucro`/`absServico` — não há mais um campo solto aqui.
    }
  })

  // Aloca o que foi digitado. MUTA `distBase` — que é reconstruído a cada render.
  const distSobras = alocarCascataDist(distBase, receiveCats)
  // SUB e FAB, as duas informativas. SUB é sempre a soma das 5, então recalcula sozinho
  // quando qualquer uma muda; FAB fica de fora dele.
  const distRows = distBase.map(d => {
    const somaDe = (linhas, campo) => cents(linhas.reduce((s, c) => s + d.cats[c][campo], 0))
    const somaCol = (campo) => somaDe(DIST_LINHAS, campo)
    // Metade de cada sinal, nas mesmas 9 colunas do SUB. `sobra` é o `liquido` pós-alocação
    // (o que resta depois do que está sendo digitado) — a mesma regra do SUB abaixo.
    const parcial = (linhas) => ({
      original: somaDe(linhas, 'original'),
      absorveu: somaDe(linhas, 'absorveu'),
      bruto: somaDe(linhas, 'bruto'),
      pagos: somaDe(linhas, 'pagos'),
      liquido: cents(somaDe(linhas, 'liquido') + somaDe(linhas, 'absorvido')),
      direcionado: somaDe(linhas, 'direcionado'),
      absorvido: somaDe(linhas, 'absorvido'),
      sobra: somaDe(linhas, 'liquido'),
    })
    return {
      ...d,
      // O que o Victor ainda recebe deste lançamento, e o que fica devido ao fisco por ele.
      // Separados porque têm sinais opostos — ver DIST_LINHAS_RECEBER/IMPOSTO.
      receber: parcial(DIST_LINHAS_RECEBER),
      imposto: parcial(DIST_LINHAS_IMPOSTO),
      // SUB é sempre a soma das 5 em TODAS as colunas — recalcula sozinho quando qualquer
      // uma muda. FAB fica de fora: sai da FATURA e é pago na aba do Fabrício.
      sub: {
        original: somaCol('original'),
        absorveu: somaCol('absorveu'),
        bruto: somaCol('bruto'),
        pagos: somaCol('pagos'),
        // LÍQUIDO da coluna 5 é o de ANTES da alocação do que está sendo digitado: o que
        // resta depois dela é a coluna SOBRA. Somar o pós-alocação aqui faria as duas
        // colunas mostrarem o mesmo número e a simulação sumir.
        liquido: cents(somaCol('liquido') + somaCol('absorvido')),
        direcionado: somaCol('direcionado'),
        absorvido: somaCol('absorvido'),
        sobra: somaCol('liquido'),
      },
    }
  })
  const distOverflow = distPool > 0.005 ? distPool : 0
  // Lançamentos que o painel esconde por não terem saldo. Um pagamento que QUITA o
  // lançamento o faz sumir da distribuição no mesmo instante — correto (não há mais o que
  // consumir), mas indistinguível de "o filtro quebrou". Caso real: os R$ 8.900 em Lucros
  // quitaram o Pharmalog #28 e ele desapareceu da tela sem explicação.
  // ⚠️ Agora só os quitados SEM imposto em aberto ficam de fora — os que ainda carregam
  // rateio entram na tabela (ver o filtro de `sortedPending`), porque a cascata do imposto
  // os alcança. Antes esta lista incluía os dois casos e o Pharmalog, que ia ser consumido,
  // aparecia como "escondido".
  const quitadosOcultos = distSource
    .filter(r => saldoOf(r) <= 0 && impostoAbertoDe(r) <= 0.005)
    .map(r => ({ id: r.id, client_name: r.client_name, month: r.month, year: r.year, impostoAberto: 0 }))
  // Mantido para o aviso: lançamentos quitados que seguem na tabela POR CAUSA do imposto.
  // O rótulo mudou de "não aparecem" para "aparecem só pelo imposto".
  const quitadosComImposto = distSource
    .filter(r => saldoOf(r) <= 0 && impostoAbertoDe(r) > 0.005)
    .map(r => ({
      id: r.id, client_name: r.client_name, month: r.month, year: r.year,
      impostoAberto: impostoAbertoDe(r),
    }))
  // Digitado que não achou linha nenhuma onde entrar — todas as 5 já estavam zeradas.
  const distSobraCategoria = cents(Object.values(distSobras).reduce((s, v) => s + v, 0))

  // ── VALORES DISTRIBUÍDOS ────────────────────────────────────────────────────────────
  // O que JÁ foi alocado por categoria nos lançamentos listados, lido do histórico de
  // pagamentos — a mesma fonte do extrato por cliente da aba.
  //
  // ⚠️ `notes` guarda as categorias da SESSÃO inteira, não a fatia deste pagamento: uma
  // sessão de R$ 173 espalhada por dois payables grava a MESMA string nos dois. Somar as
  // strings direto multiplicaria o valor pelo número de lançamentos atingidos. Por isso
  // passa por proportionalCats(), que escala a sessão para o valor do pagamento — o mesmo
  // caminho que paymentEntries e editEntries já usam.
  const distribuidos = (() => {
    const porCat = {}
    for (const r of pendingVictor) {
      // Ordem cronológica para a origem (lucro/serviço) de cada pagamento: o lucro é
      // consumido primeiro, então quanto dele sobrou depende dos pagamentos ANTERIORES.
      // Empate pelo id, que é a ordem real de gravação — mesma regra do extrato por
      // cliente em lib/victor-breakdown.js.
      const pagamentos = [...(r.payments || [])].sort((a, b) => {
        const da = String(a.paid_at || ''), db = String(b.paid_at || '')
        return da < db ? -1 : da > db ? 1 : Number(a.id) - Number(b.id)
      })
      const lucroTot = Math.max(parseFloat(r.profit_amount) || 0, 0)
      let acumulado = 0
      for (const p of pagamentos) {
        const nc = parseNotesToAmounts(p.notes)
        const nt = Object.values(nc).reduce((s, v) => s + v, 0)
        const amt = parseFloat(p.amount) || 0
        // De onde este pagamento saiu. `payables_victor` tem um `paid_amount` único, então
        // a quebra segue a hipótese única do sistema — o LUCRO absorve primeiro —, a mesma
        // de quebrarPago(), prepararCandidatos() e aplicarDelta(). O que este pagamento
        // pegou de lucro é a sobreposição de [acumulado, acumulado+amt] com [0, lucroTot].
        const deLucro = cents(Math.max(Math.min(acumulado + amt, lucroTot) - acumulado, 0))
        const deServico = cents(amt - deLucro)
        acumulado = cents(acumulado + amt)
        const origem = deLucro > 0.005 && deServico > 0.005 ? 'Lucro + Serviço'
          : deLucro > 0.005 ? 'Lucro' : 'Serviço'
        // Pagamento sem categoria no notes (lançado pelo modal simples de pagamento):
        // entra como "sem categoria" em vez de sumir — o dinheiro saiu do mesmo jeito.
        const porCategoria = nt > 0 ? proportionalCats(amt, nc, nt) : { _sem: amt }
        for (const [k, v] of Object.entries(porCategoria)) {
          if (v <= 0.005) continue
          porCat[k] ||= { valor: 0, data: null, clientes: new Set(), itens: [] }
          porCat[k].valor = cents(porCat[k].valor + v)
          // ⚠️ `paid_at` chega como string ISO pelo JSON, mas como Date em qualquer
          // consumo direto do driver. `String(date).slice(0,10)` dá "Tue Feb 1", o
          // split('-') não casa e a data sai como lixo — sem erro nenhum. Mesmo tropeço
          // já documentado com `emission_date` na visão fiscal.
          const d = p.paid_at ? (p.paid_at instanceof Date ? p.paid_at.toISOString().slice(0, 10) : String(p.paid_at).slice(0, 10)) : null
          if (d && (!porCat[k].data || d > porCat[k].data)) porCat[k].data = d
          if (r.client_name) porCat[k].clientes.add(r.client_name)
          // Um item por pagamento, para a categoria expandir. `valor` é a FATIA desta
          // categoria; `valor_pagamento` é o pagamento inteiro — é ele que o estorno
          // remove, porque payable_payments é uma linha só para a sessão toda.
          porCat[k].itens.push({
            payment_id: Number(p.id),
            payable_id: Number(r.id),
            client_name: r.client_name || 'Sem cliente',
            competencia: `${months[Number(r.month) - 1]}/${r.year}`,
            data: d,
            valor: cents(v),
            valor_pagamento: amt,
            origem,
            de_lucro: deLucro,
            de_servico: deServico,
            // A sessão pode ter mais de uma categoria: estornar remove todas de uma vez.
            categorias_da_sessao: Object.keys(nc).length,
          })
        }
      }
    }
    for (const c of Object.values(porCat)) {
      c.itens.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : b.payment_id - a.payment_id))
    }
    return porCat
  })()
  const distribuidosLista = [...RECEIVE_VICTOR_CATEGORIES, ['_sem', 'Sem categoria']]
    .filter(([k]) => (distribuidos[k]?.valor || 0) > 0.005)
    .map(([k, label]) => ({ k, label, ...distribuidos[k], clientes: [...distribuidos[k].clientes] }))
  const distribuidosTotal = cents(distribuidosLista.reduce((s, d) => s + d.valor, 0))

  // ── VALORES A DISTRIBUIR ────────────────────────────────────────────────────────────
  // Saldo em aberto das obrigações da competência (`reserves` = devido − pago, montado a
  // partir de fiscal_obligations em fetchReserves), menos o que está sendo digitado agora.
  //
  // ⚠️ NÃO desconta o que aparece em "distribuídos", e isso é o ponto: o
  // ?action=pagar-distribuido deste modal não grava `fiscal_payments`, então alocar R$ 150
  // ao Escritório aqui NÃO quita a guia — ela segue devida. Descontar os dois faria a
  // pendência sumir da tela enquanto a /fiscal continua cobrando. Quando a mesma categoria
  // aparece nas duas seções, é exatamente isso que está acontecendo, e a linha avisa.
  //
  // `lucros` e `demais` não são obrigação fiscal (kind null), então nunca têm pendência —
  // aparecem zeradas, como na especificação.
  const aDistribuir = RECEIVE_VICTOR_CATEGORIES.map(([k, label]) => {
    const kind = CATEGORIA_KIND[k]
    const devido = kind ? (parseFloat(reserves[kind]) || 0) : 0
    const digitando = parseFloat(String(receiveCats[k] ?? '').replace(',', '.')) || 0
    return {
      k, label, kind, devido, digitando,
      restante: Math.max(cents(devido - digitando), 0),
      alocadoSemQuitar: kind && (distribuidos[k]?.valor || 0) > 0.005 && devido > 0.005
        ? cents(Math.min(distribuidos[k].valor, devido)) : 0,
    }
  })
  const aDistribuirTotal = cents(aDistribuir.reduce((s, d) => s + d.restante, 0))
  const aDistribuirSemQuitar = aDistribuir.filter(d => d.alocadoSemQuitar > 0.005)

  // Reservas do mês (ficam no caixa) e saldo disponível para distribuir.
  // Soma o que a apuração ainda tem em aberto no mês, qualquer que seja o tipo —
  // fixar a lista de categorias deixaria de fora um kind novo (honorários já entrou assim).
  const reservesTotal = Object.values(reserves).reduce((s, v) => s + (parseFloat(v) || 0), 0)
  const reservesLista = Object.entries(reserves).filter(([, v]) => (parseFloat(v) || 0) > 0.005)
  const saldoDisponivelBruto = sortedPending.reduce((s, r) => s + saldoOf(r), 0)
  const disponivelParaDistribuir = Math.max(Math.round((saldoDisponivelBruto - reservesTotal) * 100) / 100, 0)
  const reservesExceedSaldo = reservesTotal > saldoDisponivelBruto + 0.005
  const receiveExcedeDisponivel = receiveTotal > disponivelParaDistribuir + 0.005

  // Detalhamento em dois níveis (Por cliente / Geral). Cada "entry" tem o valor consumido
  // e as categorias proporcionais (fatia do cliente/pagamento × cada categoria da sessão).
  const editEntries = editSession ? (() => {
    const nc = parseNotesToAmounts(editSession.notes)
    const nt = Object.values(nc).reduce((s, v) => s + v, 0)
    return editSession.affected
      .filter(a => (parseFloat(a.session_amount) || 0) > 0.005)
      .map(a => {
        const amt = parseFloat(a.session_amount) || 0
        return { label: `${a.client_name} - ${months[a.month - 1]}/${a.year}`, amount: amt, cats: proportionalCats(amt, nc, nt) }
      })
  })() : []
  const paymentEntries = (showPayModal && tab !== 'receivables') ? modalPayments.map(p => {
    const nc = parseNotesToAmounts(p.notes)
    const nt = Object.values(nc).reduce((s, v) => s + v, 0)
    const amt = parseFloat(p.amount) || 0
    const dateStr = p.paid_at ? new Date(p.paid_at).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : ''
    return { label: `${showPayModal.client_name} - ${months[showPayModal.month - 1]}/${showPayModal.year}${dateStr ? ` · ${dateStr}` : ''}`, amount: amt, cats: nc && Object.keys(nc).length ? proportionalCats(amt, nc, nt) : {} }
  }) : []

  function breakdownPanel(entries) {
    const geralCats = {}
    let totalAmount = 0
    for (const e of entries) { totalAmount += e.amount; for (const [k, v] of Object.entries(e.cats)) geralCats[k] = (geralCats[k] || 0) + v }
    const cats = RECEIVE_VICTOR_CATEGORIES.filter(([k]) => (geralCats[k] || 0) > 0.005)
    if (!entries.length || !cats.length) return null
    return (
      <div className="bg-gray-950/60 border border-gray-800 rounded-xl p-3 mt-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-gray-300 text-xs font-medium uppercase tracking-wider">Detalhamento por categoria</p>
          <div className="flex gap-1 bg-gray-900 p-0.5 rounded-lg">
            <button onClick={() => setBreakdownView('cliente')} className={`px-2 py-0.5 rounded-md text-xs font-medium transition-colors ${breakdownView === 'cliente' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>Por cliente</button>
            <button onClick={() => setBreakdownView('geral')} className={`px-2 py-0.5 rounded-md text-xs font-medium transition-colors ${breakdownView === 'geral' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>Geral</button>
          </div>
        </div>
        {breakdownView === 'geral' ? (
          <div className="space-y-1">
            {cats.map(([k, label]) => (
              <div key={k} className="flex justify-between text-xs"><span className="text-gray-400">{label}</span><span className="text-gray-200 font-mono">{fmt(geralCats[k])}</span></div>
            ))}
            <div className="flex justify-between text-xs border-t border-gray-800 pt-1 mt-1 font-semibold"><span className="text-gray-300">Total</span><span className="text-green-400 font-mono">{fmt(totalAmount)}</span></div>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((e, i) => (
              <div key={i} className="text-xs">
                <div className="flex justify-between gap-2"><span className="text-gray-200 truncate">{e.label}</span><span className="text-white font-mono whitespace-nowrap">Total: {fmt(e.amount)}</span></div>
                <div className="text-gray-500 mt-0.5">└ {RECEIVE_VICTOR_CATEGORIES.filter(([k]) => (e.cats[k] || 0) > 0.005).map(([k, label]) => `${label}: ${fmt(e.cats[k])}`).join(' | ') || '—'}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Renderiza uma linha das abas de Pagar/Receber. waiting=true oculta o botão "Pagar".
  function renderRow(item, waiting = false) {
    return (
      <div key={item.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-400 text-xs rounded-full">{item.client_name}</span>
              <span className="text-gray-500 text-xs">{months[effMonth(item)-1]}/{effYear(item)}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[item.status] || 'bg-gray-700 text-gray-400'}`}>{item.status}</span>
              {tab === 'receivables' && item.contract_cnpj && (
                <span className="flex items-center gap-1.5 text-xs">
                  <span className="text-gray-500">CNPJ:</span>
                  <span className="text-gray-300 font-mono">{item.contract_cnpj}</span>
                  <CopyButton value={item.contract_cnpj} />
                </span>
              )}
            </div>
            <p className="text-white text-sm">{item.description}</p>
            <div className="flex gap-4 mt-2 text-xs">
              {item.invoice_amount != null && (
                <span className="text-gray-500">NF: <span className="text-gray-300">{fmt(item.invoice_amount)}</span></span>
              )}
              {tab === 'victor' ? (
                <>
                  <span className="text-gray-500">Serviço: <span className="text-gray-300">{fmt(item.service_amount)}</span></span>
                  <span className="text-gray-500">Lucro: <span className="text-gray-300">{fmt(item.profit_amount)}</span></span>
                  <span className="text-gray-500">Total: <span className="text-white font-medium">{fmt(item.total_amount)}</span></span>
                </>
              ) : (
                <span className="text-gray-500">Valor: <span className="text-white font-medium">{fmt(item.amount)}</span></span>
              )}
              {parseFloat(item.paid_amount) > 0 && <span className="text-gray-500">Pago: <span className="text-green-400">{fmt(item.paid_amount)}</span></span>}
              {item.paid_at && <span className="text-gray-500">Em: <span className="text-gray-300">{new Date(item.paid_at).toLocaleDateString('pt-BR', {timeZone:'UTC'})}</span></span>}
              {item.is_compensation && <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded-full">Compensação</span>}
            </div>

            {/* Composição fiscal da NF — DAS/INSS/Honorários que couberam a este cliente.
                NÃO são valores a pagar: o imposto já saiu do que o Victor recebe, parte
                pela provisão retida na fatura, o excedente pela cascata lucro→serviço.
                Por isso ficam marcados como "coberto" e fora dos totais da aba. */}
            {tab === 'victor' && item.fiscal && (
              <div className="mt-3 pt-3 border-t border-gray-800/80">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">Imposto real desta NF</span>
                  <span className="text-xs text-gray-300 font-medium">{fmt(item.fiscal.total)}</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {item.fiscal.linhas.map((l) => (
                    <span key={l.kind} className="text-gray-500">
                      {RESERVA_LABEL[l.kind] || l.kind}: <span className="text-gray-300 font-mono">{fmt(l.amount)}</span>
                    </span>
                  ))}
                </div>
                {/* De onde saiu cada real: a soma fecha com o total acima. */}
                <p className="text-gray-600 text-[11px] mt-1.5 leading-tight">
                  Coberto por: provisão da NF {fmt(item.fiscal.provisionado)}
                  {item.fiscal.do_lucro !== 0 && ` + lucro ${fmt(item.fiscal.do_lucro)}`}
                  {item.fiscal.do_servico !== 0 && ` + serviço ${fmt(item.fiscal.do_servico)}`}
                </p>
                {/* CASCATA DO LUCRO — saldo corrente, Escritório → INSS → DAS.
                    Parte do lucro BRUTO (lucro da fatura + a provisão de 7% que foi
                    retida antes do split), senão a conta não fecha em lucro_final: a
                    provisão já saiu do victor_profit e seria descontada duas vezes.
                    Ver cascataDoLucro() em lib/fiscal-redistribution.js. */}
                {item.cascata && (
                  <div className="mt-3 p-3 bg-gray-900/60 rounded-lg border border-gray-700/70">
                    <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">
                      💰 Cascata do lucro
                      <span className="ml-2 normal-case tracking-normal text-gray-600">
                        · agrupado por {mode === 'competencia' ? 'competência' : mode === 'fiscal' ? 'data fiscal' : 'caixa'}
                      </span>
                    </p>

                    <div className="space-y-1 text-xs font-mono">
                      <div className="flex justify-between text-gray-400">
                        <span className="font-sans">Lucro bruto (antes de imposto)</span>
                        <span>{fmt(item.cascata.lucro_antes_escritorio)}</span>
                      </div>

                      <div className="flex justify-between text-gray-500">
                        <span className="font-sans pl-3">− Escritório</span>
                        <span>{fmt(item.cascata.escritorio)}</span>
                      </div>
                      <div className="flex justify-between text-gray-400 border-t border-gray-800 pt-1">
                        <span className="font-sans">= após Escritório</span>
                        <span>{fmt(item.cascata.lucro_antes_inss)}</span>
                      </div>

                      <div className="flex justify-between text-gray-500">
                        <span className="font-sans pl-3">− INSS</span>
                        <span>{fmt(item.cascata.inss)}</span>
                      </div>
                      <div className="flex justify-between text-gray-400 border-t border-gray-800 pt-1">
                        <span className="font-sans">= após INSS</span>
                        <span>{fmt(item.cascata.lucro_antes_das)}</span>
                      </div>

                      <div className="flex justify-between text-gray-500">
                        <span className="font-sans pl-3">− DAS</span>
                        <span>{fmt(item.cascata.das)}</span>
                      </div>
                      <div className={`flex justify-between border-t border-gray-700 pt-1 font-semibold ${item.cascata.lucro_final < 0 ? 'text-red-400' : 'text-white'}`}>
                        <span className="font-sans">= Lucro final</span>
                        <span>{fmt(item.cascata.lucro_final)}</span>
                      </div>
                    </div>

                    {/* Cascata negativa: o lucro não cobriu o imposto. O que o payable
                        registra é o clamp em zero — a diferença foi absorvida pelo
                        serviço e, no que sobrou, pelo capital próprio do Victor. */}
                    {item.cascata.lucro_final < 0 && (
                      <p className="mt-2 text-[11px] text-gray-500 leading-tight">
                        Lucro negativo: o payable registra {fmt(item.profit_amount)} e a diferença
                        {item.fiscal.do_servico > 0 && <> saiu do serviço ({fmt(item.fiscal.do_servico)})</>}
                        {item.cascata.capital_proprio > 0 && <> e do capital próprio</>}.
                      </p>
                    )}

                    {item.cascata.capital_proprio > 0 && (
                      <div className="mt-2 flex justify-between text-xs font-semibold text-yellow-400 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-2 py-1">
                        <span>Capital próprio (injetar)</span>
                        <span className="font-mono">{fmt(item.cascata.capital_proprio)}</span>
                      </div>
                    )}

                    {/* Conferência da decomposição da NF: imposto + serviço + lucro +
                        Fabrício tem de fechar com o valor da nota. */}
                    {item.conferencia && (
                      <div className="mt-2 pt-2 border-t border-gray-800 space-y-1 text-xs font-mono">
                        <div className="flex justify-between text-gray-500">
                          <span className="font-sans">Serviço Victor</span>
                          <span>{fmt(item.service_amount)}</span>
                        </div>
                        <div className="flex justify-between text-gray-500">
                          <span className="font-sans">Lucro Victor</span>
                          <span>{fmt(item.profit_amount)}</span>
                        </div>
                        <div className="flex justify-between text-gray-500">
                          <span className="font-sans">Fabrício</span>
                          <span>{fmt(item.conferencia.fabricio)}</span>
                        </div>
                        <div className={`flex justify-between pt-1 border-t border-gray-800 ${item.conferencia.confere ? 'text-gray-400' : 'text-amber-400'}`}>
                          <span className="font-sans">
                            {item.conferencia.confere ? '✓' : '⚠️'} imposto + serviço + lucro + Fabrício
                          </span>
                          <span>{fmt(item.conferencia.soma)}</span>
                        </div>
                        <div className="flex justify-between text-gray-600">
                          <span className="font-sans">NF</span>
                          <span>{fmt(item.conferencia.nf)}</span>
                        </div>
                        {!item.conferencia.confere && (
                          <p className="text-amber-300/90 text-[11px] font-sans leading-tight pt-1">
                            Diferença de {fmt(Math.abs(item.conferencia.diferenca))} — esperado enquanto a
                            redistribuição do mês não for aplicada.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {Math.abs(item.fiscal.a_redistribuir) >= 0.01 && (
                  <p className="mt-1.5 text-amber-300/90 text-[11px] bg-amber-500/10 border border-amber-500/30 rounded-lg px-2 py-1 leading-tight">
                    ⚠️ {fmt(Math.abs(item.fiscal.a_redistribuir))} de imposto {item.fiscal.a_redistribuir > 0 ? 'a mais que' : 'a menos que'} a provisão
                    {' '}ainda não foi redistribuído — os valores acima ainda são os da fatura.
                    {' '}Aplique em <strong>/fiscal</strong>.
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            {tab === 'receivables' ? (
              <>
                {item.status !== 'pago' && (
                  <button onClick={() => { setShowPayModal(item); setPayForm(f => ({...f, paid_amount: item.amount || item.total_amount})) }} className="px-3 py-1 bg-green-700 hover:bg-green-600 text-white rounded-lg text-xs">Pagar</button>
                )}
                {(item.status === 'pago' || item.status === 'recebido') && (
                  <button onClick={() => estornar(item)} className="px-3 py-1 border border-red-500/60 text-red-400 hover:bg-red-500/10 rounded-lg text-xs">↩ Estornar</button>
                )}
              </>
            ) : (
              <>
                {item.status === 'pendente' ? (
                  !waiting && <button onClick={() => tab === 'victor' ? openDistribuir(item) : openPayments(item)} className="px-3 py-1 bg-green-700 hover:bg-green-600 text-white rounded-lg text-xs">Pagar</button>
                ) : (
                  <button onClick={() => openPayments(item)} className="px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white rounded-lg text-xs">Ver Pagamentos</button>
                )}
                {tab === 'victor' && item.origin === 'faturamento' && (item.status === 'pago' || item.status === 'parcial') && (item.payments?.length > 0) && (
                  <button onClick={() => openEditReceive(item)} className="px-3 py-1 border border-blue-500/60 text-blue-400 hover:bg-blue-500/10 rounded-lg text-xs">✏️ Editar</button>
                )}
                {/* Estorno do LANÇAMENTO: apaga os pagamentos dele e devolve a pendente.
                    ⚠️ Não desfaz guia fiscal quitada pelo rateio — aquilo não passa por
                    payable_payments; o caminho é /fiscal → Pagamentos. */}
                {(item.status === 'pago' || item.status === 'parcial') && (
                  <button onClick={() => estornarPayable(item)}
                    title={item.status === 'pago'
                      ? 'Desfaz os pagamentos deste lançamento e o devolve para Pendente'
                      : 'Desfaz os pagamentos parciais deste lançamento e o devolve para Pendente'}
                    className="px-3 py-1 bg-red-600/90 hover:bg-red-500 text-white rounded-lg text-xs font-medium">🔄 Estornar</button>
                )}
                {/* Sempre disponível, inclusive nas linhas que aguardam o cliente pagar
                    (essas não têm botão de Pagar e ficariam sem acesso ao demonstrativo). */}
                {tab === 'fabricio' && item.breakdown && (
                  <button onClick={() => openPayments(item)} className="px-3 py-1 border border-gray-600 text-gray-300 hover:bg-gray-800 rounded-lg text-xs">🧮 Ver cálculo</button>
                )}
              </>
            )}
            {(!item.origin || item.origin !== 'faturamento') && (
              <button onClick={() => del(item.id)} className="text-gray-600 hover:text-red-400 text-xs">Excluir</button>
            )}
            {item.origin === 'faturamento' && (
              <span className="text-gray-600 text-xs">via Faturamento</span>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── BREAKDOWN POR CLIENTE — a aba Pagar Victor vista por cliente ────────────────────
  // Cada card é um cliente com as 5 categorias (lucro, serviço, DAS, INSS, escritório),
  // o saldo de cada uma e um input de pagamento. Os números vêm PRONTOS do backend
  // (lib/victor-breakdown.js): aqui só se subtrai o que está sendo digitado, para o saldo
  // reagir em tempo real. Nenhuma fórmula financeira mora neste arquivo — a cascata é de
  // lib/fiscal-redistribution.js e o rateio é de fiscal_allocations.
  function bdSaldoRestante(c, cat) {
    const saldo = c.categorias[cat]?.saldo || 0
    const digitado = parseFloat(String(bdInputs[c.client_id]?.[cat] ?? '').replace(',', '.')) || 0
    return saldo - digitado
  }

  function bdSetInput(client_id, cat, valor) {
    setBdInputs(prev => ({ ...prev, [client_id]: { ...(prev[client_id] || {}), [cat]: valor } }))
    // O plano vira obsoleto assim que um valor muda — deixá-lo na tela mostraria uma
    // prévia de outros números.
    setBdPlano(null); setBdErro(''); setBdMsg('')
  }

  function renderBreakdownCard(c) {
    const aberto = bdAberto[c.client_id] !== false   // expandido por padrão
    const temDigitado = BREAKDOWN_CATEGORIAS.some(cat =>
      (parseFloat(String(bdInputs[c.client_id]?.[cat] ?? '').replace(',', '.')) || 0) > 0)

    return (
      <div key={c.client_id ?? 'sem'} className={`bg-gray-900 border rounded-xl overflow-hidden ${temDigitado ? 'border-blue-500/50' : 'border-gray-800'}`}>
        <button
          onClick={() => setBdAberto(p => ({ ...p, [c.client_id]: !aberto }))}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-800/40 text-left"
        >
          <span className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="text-gray-500 text-xs">{aberto ? '▼' : '▶'}</span>
            <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-400 text-xs rounded-full">{c.client_name}</span>
            {/* Competências agregadas. Com o filtro num mês só é uma etiqueta redundante;
                com "todos os meses" é o que impede a leitura de que o filtro falhou —
                dois lançamentos certos e separados no banco viram um card só. */}
            {(c.competencias || []).length > 0 && (
              <span className={`text-[11px] ${c.competencias.length > 1 ? 'text-amber-400/80' : 'text-gray-600'}`}>
                {c.competencias.length === 1
                  ? `${months[c.competencias[0].mes - 1]}/${c.competencias[0].ano}`
                  : `${c.competencias.length} competências: ${c.competencias.map(k => `${months[k.mes - 1]}/${k.ano}`).join(', ')}`}
              </span>
            )}
            {c.nf.total > 0 && <span className="text-gray-600 text-[11px]">NF {fmt(c.nf.total)}</span>}
            {/* Fabrício é informativo: sai da fatura e é pago na aba dele. */}
            {c.nf.fabricio > 0 && <span className="text-gray-600 text-[11px]">· Fab {fmt(c.nf.fabricio)}</span>}
            {!c.disponivel && (
              <span className="px-2 py-0.5 bg-gray-700 text-gray-400 text-[11px] rounded-full">aguardando cliente</span>
            )}
          </span>
          <span className="text-right shrink-0">
            <span className="block text-white font-semibold text-sm">{fmt(c.subtotal_saida)}</span>
            <span className="block text-gray-600 text-[10px]">
              receber {fmt(c.subtotal_receber)} + imposto {fmt(c.subtotal_impostos)}
            </span>
          </span>
        </button>

        {aberto && (
          <div className="px-4 pb-4 space-y-1">
            {BREAKDOWN_CATEGORIAS.map(cat => {
              const v = c.categorias[cat]
              const restante = bdSaldoRestante(c, cat)
              // Categoria sem devido e sem pago não tem o que mostrar — poluiria o card
              // com cinco linhas zeradas nos clientes 100/0 e nos meses sem apuração.
              if (v.devido === 0 && v.pago === 0) return null
              return (
                <div key={cat} className="flex items-center gap-2 py-1.5 border-b border-gray-800/60 last:border-0">
                  <span className="w-32 shrink-0 text-xs text-gray-400">{BREAKDOWN_LABEL[cat]}</span>

                  <span className="flex-1 min-w-0 text-[11px] font-mono text-gray-600">
                    {fmt(v.devido)}
                    {v.pago > 0 && <span className="text-green-500"> · pago {fmt(v.pago)}</span>}
                    {v.rateio_percentual != null && v.devido > 0 && (
                      <span className="text-blue-400/70 font-sans"> · {v.rateio_percentual.toFixed(2)}%</span>
                    )}
                    {/* A cascata já zerou o lucro na gravação: dizer isso evita a leitura
                        de que o cliente simplesmente não deu lucro. */}
                    {cat === 'lucro' && v.cascade_aplicado && (
                      <span className="text-amber-400/80 font-sans"> · zerado pela cascata (−{fmt(v.cascade_valor)})</span>
                    )}
                    {cat === 'servico' && v.absorveu_do_lucro > 0 && (
                      <span className="text-amber-400/80 font-sans"> · absorveu {fmt(v.absorveu_do_lucro)} do lucro</span>
                    )}
                  </span>

                  <span className={`w-24 shrink-0 text-right text-xs font-mono ${restante < -0.005 ? 'text-red-400' : restante <= 0.005 ? 'text-green-400' : 'text-gray-200'}`}>
                    {fmt(restante)}
                  </span>

                  <input
                    type="number" step="0.01" min="0" placeholder="0,00"
                    disabled={!c.disponivel || v.saldo <= 0.005}
                    value={bdInputs[c.client_id]?.[cat] ?? ''}
                    onChange={e => bdSetInput(c.client_id, cat, e.target.value)}
                    className="w-24 shrink-0 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white text-xs text-right placeholder-gray-600 focus:outline-none focus:border-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
                  />
                  <button
                    type="button"
                    disabled={!c.disponivel || v.saldo <= 0.005}
                    onClick={() => bdSetInput(c.client_id, cat, String(v.saldo.toFixed(2)))}
                    className="shrink-0 text-[10px] text-gray-500 hover:text-blue-400 disabled:opacity-30 disabled:hover:text-gray-500"
                    title="Preencher com o saldo total"
                  >tudo</button>
                </div>
              )
            })}

            {momentosDoCard(c)}
            {extratoDoCard(c)}
            {fiscalDoCard(c)}

            {c.avisos.map((a, i) => (
              <p key={i} className="text-amber-400/80 text-[11px] pt-1">⚠️ {a}</p>
            ))}
            {!c.disponivel && (
              <p className="text-gray-500 text-[11px] pt-1">
                O cliente ainda não pagou o recebível — {fmt(c.aguardando)} em aberto. Não se
                desconta imposto de dinheiro que ainda não entrou.
              </p>
            )}
            {/* Caixa futuro: candidatosDisponiveis() recusaria estes payables, e a recusa
                do backend é silenciosa — sem o aviso, pagar não faria nada e leria como bug. */}
            {c.bloqueado_futuro > 0.005 && (
              <p className="text-amber-400/80 text-[11px] pt-1">
                🔒 {fmt(c.bloqueado_futuro)} com mês de caixa posterior a{' '}
                {months[(breakdown?.caixa?.mes_referencia || 1) - 1]}/{breakdown?.caixa?.ano_referencia} —
                não pode ser consumido ainda. O dinheiro não entrou.
              </p>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── TABELA TABULADA ─────────────────────────────────────────────────────────────────
  // CLIENTE | CATEGORIA | BRUTO | % | LÍQUIDO | STATUS, com SUB fechando cada cliente e a
  // linha FAB (informativa) embaixo. Tudo vem pronto de lib/victor-tabulado.js: aqui não
  // se rateia, não se soma e não se decide status. O único cálculo local é o total
  // digitado, que é a soma das caixas de entrada.
  function tabStatusCell(s) {
    if (s === 'pago') return <span className="text-green-400">✓ Pago</span>
    if (s === 'parcial') return <span className="text-orange-400">◐ Parcial</span>
    if (s === 'pendente') return <span className="text-gray-500">— Pendente</span>
    if (s === 'subtotal') return <span className="text-gray-600">Subtotal</span>
    // 'na' = a categoria não existe para este cliente (split 100/0 sem lucro, mês sem
    // apuração). Marcá-la como paga encheria a tabela de ✓ enganosos.
    return <span className="text-gray-700">—</span>
  }

  // ── VISÃO RASTREIO — origem → destino (payment_sources) ────────────────────────────
  //
  // Três seções, e cada uma responde uma pergunta diferente do MESMO conjunto de linhas:
  //   ORIGEM     de onde o recurso pode vir / veio (por cliente e natureza)
  //   DESTINO    para onde foi, por categoria, com a origem de cada fatia
  //   HISTÓRICO  agrupado por pagamento, na ordem em que aconteceu
  //
  // ⚠️ Só entram movimentos JÁ REALIZADOS (com `payment_id`) nas seções de destino e
  // histórico. O que ainda não virou pagamento são os créditos de compensação, que têm
  // seção própria e botão — misturá-los com o realizado faria a soma dos destinos
  // prometer dinheiro que não saiu.
  function renderRastreio() {
    const realizados = rastreio.filter(r => r.payment_id != null)
    // Absorção de imposto: saiu do Victor sem passar por pagamento nenhum (o valor foi
    // descontado do que ele recebe). `payment_id` é NULL por isso, e sem seção própria
    // essas linhas ficariam invisíveis — o destino e o histórico só mostram o realizado.
    const absorcoes = rastreio.filter(r => r.payment_id == null && r.destination_category === 'impostos')
    const soma = (arr) => cents(arr.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0))
    const rotuloOrigem = (r) => (
      r.source_type === 'compensation_fabricio' ? 'Compensação Fabrício'
        : r.source_type === 'profit' ? 'Lucro' : 'Serviço'
    )

    // ORIGEM: agrupa por (cliente, natureza). É o que a tabela sabe dizer — o saldo em
    // aberto continua sendo dos cards, que leem `payables_victor`.
    const porOrigem = new Map()
    for (const r of realizados) {
      const k = `${r.client_id ?? 'x'}|${r.source_type}`
      if (!porOrigem.has(k)) porOrigem.set(k, { nome: r.client_name || 'Sem cliente', tipo: rotuloOrigem(r), linhas: [] })
      porOrigem.get(k).linhas.push(r)
    }
    const porDestino = new Map()
    for (const r of realizados) {
      if (!porDestino.has(r.destination_category)) porDestino.set(r.destination_category, [])
      porDestino.get(r.destination_category).push(r)
    }
    const porPagamento = new Map()
    for (const r of realizados) {
      if (!porPagamento.has(r.payment_id)) porPagamento.set(r.payment_id, { paid_at: r.paid_at, notes: r.payment_notes, linhas: [] })
      porPagamento.get(r.payment_id).linhas.push(r)
    }

    return (
      <div className="space-y-3">
        {rastreioErro && <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{rastreioErro}</p>}
        {rastreioLoading && <p className="text-gray-500 text-xs">Carregando rastreamento…</p>}

        {/* ── 1 · ORIGEM ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
          <p className="text-[11px] uppercase tracking-wide text-blue-400/80 font-medium mb-2">📊 Origem do recurso</p>
          {porOrigem.size === 0 && compensacoes.length === 0 ? (
            <p className="text-gray-600 text-xs">Nenhum movimento rastreado neste recorte. O rastreamento passou a ser gravado em 15/08/2026 — pagamentos anteriores a isso não têm origem registrada.</p>
          ) : (
            <div className="space-y-1">
              {[...porOrigem.values()].map((g, i) => (
                <div key={i} className="flex justify-between gap-2 text-xs">
                  <span className="text-gray-400">{g.nome} <span className="text-gray-600">{g.tipo}</span></span>
                  <span className="text-white font-mono">{fmt(soma(g.linhas))}</span>
                </div>
              ))}
            </div>
          )}

          {/* Créditos de compensação: origem que ainda NÃO virou pagamento. */}
          {compensacoes.length > 0 && (
            <div className="mt-3 border-t border-gray-800 pt-2">
              <p className="text-[11px] text-green-400 font-medium mb-1">✨ Compensações do Fabrício disponíveis</p>
              <p className="text-[10px] text-gray-600 mb-2 leading-tight">
                O Fabrício deixou de receber e o valor virou crédito. Usar quita um lançamento
                do mesmo cliente, sem sair caixa — não cria lançamento novo.
              </p>
              {compensacoes.map(c => (
                <div key={c.id} className="flex justify-between items-center gap-2 text-xs mb-1">
                  <span className="text-gray-400 truncate">
                    {c.client_name || 'Sem cliente'} <span className="text-gray-600">{c.month}/{c.year}</span>
                    {c.fabricio_description && <span className="text-gray-700"> · {c.fabricio_description}</span>}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="text-green-300 font-mono">{fmt(c.amount)}</span>
                    <button onClick={() => usarCompensacao(c)} disabled={pagandoComp === c.id}
                      className="px-2 py-0.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded text-[11px]">
                      {pagandoComp === c.id ? '...' : 'Usar'}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── 1b · IMPOSTO ABSORVIDO ── */}
        {absorcoes.length > 0 && (
          <div className="bg-gray-900 border border-orange-500/20 rounded-xl p-3">
            <p className="text-[11px] uppercase tracking-wide text-orange-400/80 font-medium mb-1">🧾 Imposto absorvido</p>
            <p className="text-[10px] text-gray-600 mb-2 leading-tight">
              Excedente do imposto real sobre a provisão retida na NF, descontado do que o
              Victor recebe — do lucro primeiro, do serviço no que não coube. <strong>Não é
              pagamento</strong>: é redução do que ele tem a receber.{' '}
              <span className="text-amber-400/80">Se a guia também for quitada com caixa, o
              mesmo tributo sai duas vezes.</span>
            </p>
            {absorcoes.map(a => {
              // Valor negativo = a provisão da NF passou do imposto real e a sobra voltou
              // para o Victor. É o caso comum (NF reserva 7%, Simples cobra ~6%) e aparece
              // em verde, com o sinal invertido: "devolvido" é ganho, não desconto.
              const v = parseFloat(a.amount) || 0
              const devolveu = v < 0
              return (
                <div key={a.id} className="flex justify-between gap-2 text-xs mb-0.5">
                  <span className="text-gray-400 truncate">
                    {a.client_name || 'Sem cliente'}{' '}
                    <span className="text-gray-600">{a.source_type === 'profit' ? 'lucro' : 'serviço'} · {a.month}/{a.year}</span>
                    {devolveu && <span className="text-green-400/70"> · devolvido</span>}
                  </span>
                  <span className={`font-mono shrink-0 ${devolveu ? 'text-green-400' : 'text-orange-300'}`}>
                    {devolveu ? `+ ${fmt(-v)}` : fmt(v)}
                  </span>
                </div>
              )
            })}
            <div className="flex justify-between gap-2 text-xs border-t border-gray-800 mt-1 pt-1">
              <span className="text-gray-500">Total absorvido</span>
              <span className="text-orange-300 font-mono font-semibold">{fmt(soma(absorcoes))}</span>
            </div>
          </div>
        )}

        {/* ── 2 · DESTINO ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
          <p className="text-[11px] uppercase tracking-wide text-blue-400/80 font-medium mb-2">💰 Destino do recurso</p>
          {porDestino.size === 0 ? (
            <p className="text-gray-600 text-xs">Nada pago com rastreamento neste recorte.</p>
          ) : [...porDestino.entries()].map(([destino, linhas]) => (
            <div key={destino} className="mb-2 last:mb-0">
              <div className="flex justify-between gap-2 text-xs">
                <span className="text-gray-300 font-medium">{CAT_LABEL[destino] || destino}</span>
                <span className="text-green-400 font-mono">{fmt(soma(linhas))}</span>
              </div>
              {linhas.map(l => (
                <div key={l.id} className="flex justify-between gap-2 text-[11px] pl-3">
                  <span className="text-gray-600">← {l.client_name || 'Sem cliente'} {rotuloOrigem(l)} <span className="text-gray-700">{l.month}/{l.year}</span></span>
                  <span className="text-gray-500 font-mono">{fmt(l.amount)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* ── 3 · HISTÓRICO ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
          <p className="text-[11px] uppercase tracking-wide text-blue-400/80 font-medium mb-2">📋 Histórico rastreado</p>
          {porPagamento.size === 0 ? (
            <p className="text-gray-600 text-xs">Nenhum pagamento rastreado neste recorte.</p>
          ) : [...porPagamento.entries()].map(([pid, pg]) => (
            <div key={pid} className="mb-2 last:mb-0 bg-gray-800/40 rounded-lg px-2 py-1.5">
              <div className="flex justify-between gap-2 text-xs">
                <span className="text-gray-300">
                  {pg.paid_at ? new Date(pg.paid_at).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—'}
                  <span className="text-gray-600"> · {pg.notes || 'sem descrição'}</span>
                </span>
                <span className="text-white font-mono">{fmt(soma(pg.linhas))}</span>
              </div>
              {pg.linhas.map(l => (
                <div key={l.id} className="flex justify-between gap-2 text-[11px] pl-3 text-gray-600">
                  <span>├─ {l.client_name || 'Sem cliente'} {rotuloOrigem(l)} {l.month}/{l.year} → {CAT_LABEL[l.destination_category] || l.destination_category}</span>
                  <span className="font-mono">{fmt(l.amount)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <p className="text-gray-700 text-[10px] leading-tight">
          O recorte é pela <strong>competência da origem</strong>, não pela data do pagamento:
          um pagamento feito em agosto consumindo saldo de janeiro aparece em janeiro, que é
          de onde o dinheiro veio.{' '}
          No <strong>?action=pagar-distribuido</strong> (modal Receber) a origem é exata e a
          categoria de destino é uma fatia proporcional da sessão — no pagamento por cliente
          (Cards) as duas são exatas.
        </p>
      </div>
    )
  }

  function renderTabelaTabulada() {
    const d = tabDist
    return (
      <div className="space-y-3">
        {/* ── Seção 1: os totais a distribuir ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
            {/* NÃO chamar de "Valores a distribuir": esse nome é da seção do modal
                "Receber", que mostra o que a competência ainda DEVE. Aqui são os valores
                que se está DIGITANDO. Os dois nomes iguais na mesma tela fizeram procurar
                a seção verde (que mora no modal) aqui na aba, onde ela nunca existiu. */}
            <p className="text-[11px] uppercase tracking-wide text-gray-500">💸 Valores a lançar</p>
            <span className="text-xs text-gray-500">
              Total <span className="text-green-400 font-mono font-semibold">{fmt(tabTotalDigitado)}</span>
              {tabLoading && <span className="text-gray-600"> · calculando…</span>}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {RECEIVE_VICTOR_CATEGORIES.map(([k, label]) => (
              <div key={k} className="flex flex-col gap-1">
                <label className="text-[10px] text-gray-500">{label}</label>
                <input
                  type="number" step="0.01" min="0" placeholder="0,00"
                  value={tabInputs[k]}
                  onChange={e => setTabInputs(p => ({ ...p, [k]: e.target.value }))}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white text-xs text-right placeholder-gray-600 focus:outline-none focus:border-blue-500"
                />
              </div>
            ))}
          </div>
          <p className="text-gray-600 text-[10px] mt-2">
            Cada total é rateado pelo peso da NF de cada cliente e absorvido na ordem
            Escritório → DAS → INSS → Lucro → Serviço; o que não couber num cliente desce
            para o próximo. <strong className="text-gray-500">Esta visão é leitura</strong> —
            o pagamento é registrado na visão Cards.
          </p>
        </div>

        {tabErro && <p className="text-red-400 text-xs">{tabErro}</p>}

        {/* ── Seção 2: a distribuição ── */}
        {!d ? (
          <div className="text-gray-600 text-sm text-center py-6">
            {tabLoading ? 'Calculando distribuição…' : 'Sem distribuição para este recorte.'}
          </div>
        ) : d.distribution.length === 0 ? (
          <div className="text-gray-600 text-sm text-center py-6">
            Nenhum cliente com NF neste recorte.
          </div>
        ) : (
          <>
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-gray-500 border-b border-gray-800">
                      <th className="text-left font-medium px-3 py-2">Cliente</th>
                      <th className="text-left font-medium px-3 py-2">Categoria</th>
                      <th className="text-right font-medium px-3 py-2">Bruto</th>
                      <th className="text-right font-medium px-3 py-2">%</th>
                      <th className="text-right font-medium px-3 py-2">Líquido</th>
                      <th className="text-left font-medium px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.distribution.map(c => (
                      <Fragment key={c.client_id ?? 'sem'}>
                        {c.rows.map(r => {
                          const sub = r.category === 'sub'
                          return (
                            <tr key={r.category}
                              className={sub
                                ? 'bg-gray-950/60 border-b border-gray-800 font-medium'
                                : 'border-b border-gray-800/40 hover:bg-gray-800/20'}>
                              <td className="px-3 py-1.5 text-gray-400 whitespace-nowrap">
                                {c.client_name}
                                {/* candidatosDisponiveis() recusaria o pagamento enquanto o
                                    cliente não pagar o recebível. A tabela não bloqueia
                                    nada, mas omitir isso faria o LÍQUIDO prometer um
                                    pagamento que o motor não faria. */}
                                {r.category === 'escritorio' && !c.disponivel && (
                                  <span className="ml-2 px-1.5 py-0.5 bg-gray-700 text-gray-400 text-[10px] rounded-full">
                                    aguardando cliente
                                  </span>
                                )}
                              </td>
                              <td className={`px-3 py-1.5 ${sub ? 'text-gray-300' : 'text-gray-500'}`}>
                                {TAB_LINHA_LABEL[r.category] || r.category}
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono text-gray-400">{fmt(r.bruto)}</td>
                              <td className="px-3 py-1.5 text-right text-blue-400/70">
                                {TAB_COM_PERCENTUAL.has(r.category) && r.percentual != null
                                  ? `${r.percentual.toFixed(2)}%`
                                  : <span className="text-gray-700">—</span>}
                              </td>
                              <td className={`px-3 py-1.5 text-right font-mono ${
                                r.liquido <= 0.005 && r.bruto > 0.005 ? 'text-green-400'
                                  : sub ? 'text-white' : 'text-gray-200'}`}>
                                {fmt(r.liquido)}
                              </td>
                              <td className="px-3 py-1.5 whitespace-nowrap">{tabStatusCell(r.status)}</td>
                            </tr>
                          )
                        })}
                        {/* FAB: sai da FATURA e é pago na aba do Fabrício. Fora de todos os
                            totais — somá-lo aqui acrescentaria à conta do Victor um valor
                            que nunca passa por ela. */}
                        <tr className="border-b-2 border-gray-800 bg-gray-950/30">
                          <td className="px-3 py-1 text-gray-700 text-[11px]"></td>
                          <td className="px-3 py-1 text-gray-600 text-[11px]">FAB</td>
                          <td className="px-3 py-1 text-right text-gray-700">—</td>
                          <td className="px-3 py-1 text-right text-gray-700">—</td>
                          <td className="px-3 py-1 text-right font-mono text-gray-600">{fmt(c.fabricio_share)}</td>
                          <td className="px-3 py-1 text-gray-700 text-[11px]">aba Pagar Fab</td>
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-gray-700 text-xs">
                      <td className="px-3 py-2 text-gray-400 font-medium" colSpan={2}>Total</td>
                      <td className="px-3 py-2 text-right font-mono text-gray-300">{fmt(d.totals.total_bruto)}</td>
                      <td className="px-3 py-2"></td>
                      <td className="px-3 py-2 text-right font-mono text-white font-semibold">{fmt(d.totals.total_liquido)}</td>
                      <td className="px-3 py-2 text-green-400 text-[11px] whitespace-nowrap">
                        absorvido {fmt(d.totals.total_paid)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* ── Avisos: cada um cobre um jeito de a tabela parecer errada ── */}
            <div className="space-y-1">
              {d.totals.nao_coberto > 0.005 && (
                <p className="text-amber-400/80 text-[11px]">
                  ⚠️ {fmt(d.totals.nao_coberto)} não encontrou lançamento onde entrar — o total
                  digitado passou do que os clientes deste recorte devem.
                </p>
              )}
              {d.rateio?.origem_peso === 'nf' && (
                <p className="text-amber-400/80 text-[11px]">
                  ⚠️ Competência ainda não apurada: sem rateio de DAS/INSS/Escritório, o peso
                  saiu do valor da NF e os valores digitados caem em Lucro/Serviço. Apure em{' '}
                  <strong>/fiscal</strong>.
                </p>
              )}
              {d.rateio?.soma_percentual != null && d.rateio.soma_percentual < 99.5 && (
                <p className="text-amber-400/80 text-[11px]">
                  ⚠️ Os clientes em tela somam {d.rateio.soma_percentual.toFixed(2)}% das guias
                  da competência — o resto é de nota fora deste recorte. O valor digitado foi
                  repartido só entre os presentes.
                </p>
              )}
              {/* Sem esta linha a Minas some da tela sem explicação e o total da tabela
                  não bate com o total da aba, logo acima. */}
              {d.excluidos?.length > 0 && (
                <p className="text-gray-600 text-[11px]">
                  Fora da tabela: {d.excluidos.map(e => `${e.client_name} (${fmt(e.subtotal_receber)})`).join(', ')} —
                  contrato sem NF, não entra no rateio de DAS/INSS/Escritório e é pago à parte.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    )
  }

  // OS TRÊS MOMENTOS, lado a lado. Vêm prontos de lib/victor-breakdown.js — aqui não se
  // calcula nada, nem o delta (que o backend já mede na direção em que o Victor lê:
  // imposto que CAI sobra para ele).
  //
  // Os três descrevem as MESMAS notas do card, e é isso que torna a comparação honesta.
  // A primeira versão puxava o prévio da previsão do mês de emissão enquanto o card
  // agrupa por competência: a "diferença entre os momentos" era a troca das notas por
  // baixo, não a mudança de alíquota.
  function momentosDoCard(c) {
    const M = c.momentos
    if (!M?.previo && !M?.real?.total) return null
    const col = (chave, titulo, legenda) => {
      const m = M[chave]
      const atual = M.atual === chave
      if (!m) {
        return (
          <div key={chave} className="flex-1 min-w-[8.5rem] rounded-lg p-2 bg-gray-950/40 border border-dashed border-gray-800">
            <p className="text-[10px] uppercase tracking-wide text-gray-600">{titulo}</p>
            <p className="text-sm text-gray-700 mt-1">aguardando</p>
            <p className="text-[10px] text-gray-700 mt-0.5">{legenda}</p>
          </div>
        )
      }
      return (
        <div key={chave} className={`flex-1 min-w-[8.5rem] rounded-lg p-2 border ${atual ? 'bg-blue-500/10 border-blue-500/40' : 'bg-gray-950/60 border-gray-800'}`}>
          <p className={`text-[10px] uppercase tracking-wide ${atual ? 'text-blue-300' : 'text-gray-500'}`}>
            {titulo}{atual && ' · vigente'}
          </p>
          <p className="text-sm font-mono text-white mt-1">{fmt(m.total)}</p>
          <div className="text-[10px] font-mono text-gray-500 mt-1 space-y-0.5">
            <div className="flex justify-between"><span className="font-sans">DAS</span><span>{fmt(m.das)}</span></div>
            <div className="flex justify-between"><span className="font-sans">INSS</span><span>{fmt(m.inss)}</span></div>
            <div className="flex justify-between"><span className="font-sans">Escritório</span><span>{fmt(m.escritorio)}</span></div>
          </div>
          <p className="text-[10px] text-gray-600 mt-1">{legenda}</p>
          {/* Guia parcial: algumas categorias já têm valor oficial, outras não. Sem dizer
              quais, o total do Momento 3 pareceria já ser o definitivo. */}
          {chave === 'final' && m.aguardando_guia?.length > 0 && (
            <p className="text-[10px] text-amber-400/70 mt-0.5">
              {m.aguardando_guia.map(k => BREAKDOWN_LABEL[k]).join(', ')} ainda no estimado
            </p>
          )}
        </div>
      )
    }
    // Delta positivo = o imposto caiu, e a diferença fica com o Victor.
    const delta = (v, de, para) => v == null || Math.abs(v) < 0.005 ? null : (
      <span className={v > 0 ? 'text-green-400' : 'text-red-400'}>
        {de} → {para}: {v > 0 ? '+' : '−'}{fmt(Math.abs(v))} {v > 0 ? 'para o lucro' : 'a mais de imposto'}
      </span>
    )
    return (
      <details className="pt-2" open>
        <summary className="text-[11px] text-gray-500 cursor-pointer hover:text-gray-300">🕒 Os três momentos do imposto</summary>
        <div className="mt-2 flex gap-2 flex-wrap">
          {col('previo', '1 · Prévio', 'provisão de 7% retida na NF')}
          {col('real', '2 · Real', 'apuração: alíquota efetiva do Simples')}
          {col('final', '3 · Final', 'guia oficial do contador')}
        </div>
        {(M.delta_previo_real || M.delta_real_final) && (
          <p className="text-[10px] mt-1.5 space-x-3">
            {delta(M.delta_previo_real, '1', '2')}
            {delta(M.delta_real_final, '2', '3')}
          </p>
        )}
      </details>
    )
  }

  // Extrato do cliente: cada pagamento e o saldo que restou depois dele.
  //
  // O saldo corrente vem do backend, que parte do total DEVIDO e desce — não do saldo de
  // hoje subindo. Assim a última linha tem de terminar exatamente no saldo atual, e
  // terminar noutro lugar denuncia pagamento gravado fora de payable_payments.
  function extratoDoCard(c) {
    const h = c.historico_pagamentos || []
    if (!h.length) return null
    return (
      <details className="pt-2">
        <summary className="text-[11px] text-gray-500 cursor-pointer hover:text-gray-300">
          🧾 Histórico de pagamentos ({h.length})
        </summary>
        <div className="mt-2 space-y-0.5 text-[11px] font-mono bg-gray-950/60 rounded-lg p-2">
          <div className="flex justify-between text-gray-600 pb-1 border-b border-gray-800">
            <span className="font-sans">Saldo inicial</span>
            <span>{fmt(h[0].saldo + h[0].valor)}</span>
          </div>
          {h.map(p => (
            <div key={p.payment_id} className="flex justify-between gap-2 py-0.5">
              <span className="font-sans text-gray-400 min-w-0 truncate">
                {p.data.split('-').reverse().join('/')}
                {/* Categorias parseadas de notes pela inversa de montarNotes() — no
                    backend, para o formato ter um dono só. */}
                {Object.keys(p.categorias || {}).length > 0 && (
                  <span className="text-gray-600"> · {Object.entries(p.categorias)
                    .map(([k, v]) => `${CAT_LABEL[k] || k} ${fmt(v)}`).join(', ')}</span>
                )}
              </span>
              <span className="shrink-0">
                <span className="text-red-400/80">−{fmt(p.valor)}</span>
                <span className="text-gray-600"> → </span>
                <span className="text-gray-300">{fmt(p.saldo)}</span>
              </span>
            </div>
          ))}
        </div>
      </details>
    )
  }

  // Cascata do lucro do cliente, no card. Mesmos números de cascataDoLucro().
  function fiscalDoCard(c) {
    if (!c.cascata) return null
    const linhas = [
      ['Lucro bruto (antes de imposto)', c.cascata.lucro_antes_escritorio, false],
      ['− Escritório', c.cascata.escritorio, true],
      ['− INSS', c.cascata.inss, true],
      ['− DAS', c.cascata.das, true],
    ]
    return (
      <details className="pt-2">
        <summary className="text-[11px] text-gray-500 cursor-pointer hover:text-gray-300">💰 Cascata do lucro</summary>
        <div className="mt-2 space-y-0.5 text-[11px] font-mono bg-gray-950/60 rounded-lg p-2">
          {linhas.map(([label, valor, indent]) => (
            <div key={label} className={`flex justify-between ${indent ? 'text-gray-500 pl-3' : 'text-gray-400'}`}>
              <span className="font-sans">{label}</span><span>{fmt(valor)}</span>
            </div>
          ))}
          <div className={`flex justify-between border-t border-gray-700 pt-1 font-semibold ${c.cascata.lucro_final < 0 ? 'text-red-400' : 'text-white'}`}>
            <span className="font-sans">= Lucro final</span><span>{fmt(c.cascata.lucro_final)}</span>
          </div>
          {c.cascata.capital_proprio > 0 && (
            <div className="flex justify-between text-yellow-400 pt-1">
              <span className="font-sans">Capital próprio (injetar)</span><span>{fmt(c.cascata.capital_proprio)}</span>
            </div>
          )}
        </div>
      </details>
    )
  }

  // Demonstrativo do Fabrício: a cascata que a fatura percorreu até o valor dele.
  // Os números vêm prontos de `item.breakdown` (lib/fabricio-breakdown.js, no backend) —
  // aqui não se calcula nada, senão a explicação poderia divergir do valor que ela explica.
  // A cascata é ramificada porque o imposto sai antes do split em contrato por hora e
  // NÃO sai em contrato fixo (onde ele é descontado da parte do Victor).
  function fabricioBreakdownPanel(item) {
    const b = item?.breakdown
    if (!b) {
      return (
        <div className="mb-5 p-3 bg-gray-800/40 border border-gray-700/60 rounded-xl">
          <p className="text-gray-500 text-xs">
            Lançamento manual — sem fatura por trás, não há demonstrativo de cálculo.
          </p>
        </div>
      )
    }
    const linha = (label, valor, opts = {}) => (
      <div className={`flex justify-between ${opts.className || 'text-gray-400'}`}>
        <span className="font-sans">{label}</span>
        <span>{fmt(valor)}</span>
      </div>
    )
    return (
      <div className="mb-5 p-3 bg-gray-900/60 rounded-xl border border-gray-700/70">
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <p className="text-[11px] uppercase tracking-wide text-gray-500">🧮 Demonstrativo de cálculo</p>
          <span className="text-[11px] text-gray-500">{b.tipo_label}</span>
        </div>

        <div className="space-y-1 text-xs font-mono">
          {linha('Faturamento bruto', b.bruto, { className: 'text-gray-300' })}

          {/* Por hora: o imposto sai do bruto antes de qualquer divisão. */}
          {b.imposto_antes_do_split && (
            <>
              {linha(`− Imposto (${b.imposto_pct}%)`, b.imposto, { className: 'text-gray-500 pl-3' })}
              <div className="flex justify-between text-gray-400 border-t border-gray-800 pt-1">
                <span className="font-sans">= Líquido</span>
                <span>{fmt(b.liquido)}</span>
              </div>
            </>
          )}

          {linha('− Serviço Victor', b.victor_servico, { className: 'text-gray-500 pl-3' })}

          {/* Deslocamento é 100% Victor e fica FORA do split — por isso aparece como
              dedução, não como parte da divisão. */}
          {b.deslocamento !== 0 && (
            linha('− Deslocamento (100% Victor)', b.deslocamento, { className: 'text-gray-500 pl-3' })
          )}

          <div className="flex justify-between text-white font-semibold border-t border-gray-700 pt-1">
            <span className="font-sans">= Lucro a dividir</span>
            <span>{fmt(b.lucro_a_dividir)}</span>
          </div>

          <div className="pt-2 space-y-1">
            {linha(`Victor (${b.victor_pct}%)`, b.victor_lucro, { className: 'text-gray-400 pl-3' })}
            <div className="flex justify-between text-green-400 font-semibold pl-3">
              <span className="font-sans">Fabrício ({b.fabricio_pct}%)</span>
              <span>{fmt(b.fabricio)} {b.confere && '✓'}</span>
            </div>
          </div>

          {/* Contrato fixo: o imposto existe, mas não entra no split. Mostrado à parte
              para não parecer que foi esquecido. */}
          {!b.imposto_antes_do_split && b.imposto > 0 && (
            <div className="flex justify-between text-gray-600 border-t border-gray-800 pt-1 mt-1">
              <span className="font-sans">Imposto ({b.imposto_pct}% da NF)</span>
              <span>{fmt(b.imposto)}</span>
            </div>
          )}

          {/* Gross-up do imposto do cliente: majora a NF e vai 100% para o Victor. */}
          {b.diff_nf > 0 && (
            <div className="flex justify-between text-gray-600">
              <span className="font-sans">Gross-up da NF (100% Victor)</span>
              <span>{fmt(b.diff_nf)}</span>
            </div>
          )}
        </div>

        {!b.imposto_antes_do_split && (
          <p className="text-gray-600 text-[11px] mt-2 leading-tight">
            Em contrato fixo o imposto não é descontado antes da divisão — ele sai da parte do Victor.
          </p>
        )}
        {!b.confere && (
          <p className="text-red-400 text-[11px] mt-2 leading-tight">
            ⚠️ A decomposição não fecha com o faturamento (diferença de {fmt(b.desvio)}).
          </p>
        )}
      </div>
    )
  }

  async function exportFabricio() {
    if (exporting) return
    setExporting(true)
    try {
      const params = new URLSearchParams({
        company_id: activeCompany.id,
        year: filterYear,
        mode,
        status: filterStatus,
        include_preview: includePrevistas ? 'true' : 'false',
      })
      if (filterMonth !== '') params.set('month', filterMonth)
      const res = await fetch(`/api/export-payables-fabricio?${params.toString()}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert('Erro ao gerar Excel: ' + (data.error || res.status))
        return
      }
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const monthsShort = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']
      a.href = objectUrl
      a.download = `pagar_fabricio_${filterMonth !== '' ? monthsShort[filterMonth-1] + '_' : ''}${filterYear}.xlsx`
      a.click()
      URL.revokeObjectURL(objectUrl)
    } catch (e) {
      alert('Erro ao exportar: ' + e.message)
    } finally {
      setExporting(false)
    }
  }

  const statusFilter = (
    <div className="flex gap-2 items-center">
      <span className="text-gray-500 text-xs uppercase tracking-wider mr-1">Status:</span>
      <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500">
        <option value="all">Todos</option>
        <option value="pendente_parcial">Pendente / Parcial</option>
        <option value="pago">Pago</option>
      </select>
    </div>
  )
  // Totais só contam registros disponíveis (não os que aguardam recebimento do cliente).
  const totalsData = isPayTab ? availableData : currentData
  const totalAmount = totalsData.reduce((s, r) => s + (parseFloat(r.amount || r.total_amount) || 0), 0)
  const totalPaid = totalsData.reduce((s, r) => s + (parseFloat(r.paid_amount) || 0), 0)
  const totalOpen = totalAmount - totalPaid

  // Histórico: registros pagos do tipo selecionado
  const histSource = histType === 'receivables' ? receivables : histType === 'fabricio' ? payablesFab : payablesVictor
  const histPaidAll = histSource
    .filter(r => r.status === 'pago' || r.status === 'parcial')
    .filter(r => filterMonth === '' || Number(effMonth(r)) === Number(filterMonth))
  const histClients = Array.from(
    histPaidAll.reduce((m, r) => { if (r.client_id != null && !m.has(r.client_id)) m.set(r.client_id, r.client_name || 'Sem cliente'); return m }, new Map())
  ).map(([id, name]) => ({ id, name }))
  const histData = histClient ? histPaidAll.filter(r => String(r.client_id) === String(histClient)) : histPaidAll
  const histTotalPaid = histData.reduce((s, r) => s + (parseFloat(r.paid_amount) || 0), 0)

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Financeiro</h2>
          <p className="text-gray-400 text-sm mt-1">{activeCompany.name}</p>
        </div>
        <div className="flex gap-2">
          {tab !== 'historico' && (
            <button onClick={() => setShowModal(true)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium">+ Novo</button>
          )}
        </div>
      </div>

      {/* Toggle das 3 visões de data */}
      <div className="flex gap-2 mb-4 items-center">
        <span className="text-gray-500 text-xs uppercase tracking-wider mr-1">Visão:</span>
        <div className="flex gap-1 bg-gray-900 p-1 rounded-xl w-fit">
          {MODOS.map(([key, label, hint]) => (
            <button key={key} onClick={() => setMode(key)} title={hint}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${mode === key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Filtro de mês (aplicado a todas as abas) */}
      <div className="flex gap-2 mb-6 flex-wrap items-center">
        <button onClick={() => setFilterMonth('')} className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filterMonth === '' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>Todos</button>
        {months.map((m, i) => (
          <button key={i} onClick={() => setFilterMonth(i+1)} className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filterMonth === i+1 ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{m}</button>
        ))}
        <input type="number" value={filterYear} onChange={e=>setFilterYear(e.target.value)} className="ml-2 w-20 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white text-xs focus:outline-none"/>
      </div>

      {/* Abas */}
      <div className="flex gap-1 mb-6 bg-gray-900 p-1 rounded-xl w-fit">
        {[['receivables','💰 A Receber'],['fabricio','👷 Pagar Fab'],['victor','👤 Pagar Victor'],['historico','📜 Histórico']].map(([key,label]) => (
          <button key={key} onClick={() => setTab(key)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === key ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>{label}</button>
        ))}
      </div>

      {tab !== 'historico' && (<>
      {/* Totalizadores */}
      {(() => {
        const cardCount = 3 + (previewTotal > 0 ? 1 : 0) + (tab === 'victor' ? 1 : 0)
        const gridCols = cardCount >= 5 ? 'grid-cols-2 md:grid-cols-5' : cardCount === 4 ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-3'
        return (
      <div className={`grid ${gridCols} gap-4 mb-6`}>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">Total previsto</p>
          <p className="text-white text-lg font-bold">{fmt(totalAmount)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">Total pago</p>
          <p className="text-green-400 text-lg font-bold">{fmt(totalPaid)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">Em aberto</p>
          <p className="text-yellow-400 text-lg font-bold">{fmt(totalOpen)}</p>
        </div>
        {previewTotal > 0 && (
          <div className="bg-gray-900/40 border border-dashed border-gray-700 rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">🔮 Previsto cliente</p>
            <p className="text-gray-300 text-lg font-bold">{fmt(previewTotal)}</p>
          </div>
        )}
        {tab === 'victor' && (
          <button
            onClick={openReceive}
            title={reservesLista.map(([k, v]) => `${RESERVA_LABEL[k] || k}: ${fmt(v)}`).join(' | ') || 'Nada apurado neste mês'}
            className="text-left bg-gray-900 border border-amber-500/30 rounded-xl p-4 hover:border-amber-500/60 transition-colors"
          >
            <p className="text-gray-400 text-xs mb-1">🏦 Reservas do mês</p>
            <p className={`text-lg font-bold ${reservesTotal > 0 ? 'text-orange-400' : 'text-gray-500'}`}>{fmt(reservesTotal)}</p>
            {reservesTotal > 0 ? (
              <p className="text-gray-500 text-[11px] mt-1 leading-tight">{reservesLista.map(([k, v]) => `${RESERVA_LABEL[k] || k}: ${fmt(v)}`).join(' | ')}</p>
            ) : (
              <p className="text-gray-600 text-[11px] mt-1">Nada em aberto na apuração</p>
            )}
          </button>
        )}
      </div>
        )
      })()}

      <p className="text-gray-500 text-xs mb-4 -mt-2">
        Visualizando por {MODO_LABEL[mode]}
        {mode === 'fiscal' && ' — lançamentos sem NF (manuais e linhas fiscais) caem na competência'}
      </p>

      {(tab === 'victor' || tab === 'fabricio') && (
        <div className="flex gap-2 items-center mb-4 flex-wrap">
          {statusFilter}
          {tab === 'fabricio' && (
            <div className="ml-auto flex items-center gap-3">
              {/* Com o filtro "Pago" não existe previsão nenhuma (a fatura prevista é, por
                  definição, a que o cliente ainda não pagou), então marcar não faria efeito. */}
              <label
                title={filterStatus === 'pago'
                  ? 'Sem efeito no filtro "Pago": previsão é fatura que o cliente ainda não pagou'
                  : 'Inclui as faturas cujo cliente ainda não pagou, fora do total efetivado'}
                className={`flex items-center gap-2 text-xs ${filterStatus === 'pago' ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 cursor-pointer hover:text-gray-300'}`}
              >
                <input
                  type="checkbox"
                  checked={includePrevistas && filterStatus !== 'pago'}
                  disabled={filterStatus === 'pago'}
                  onChange={e => setIncludePrevistas(e.target.checked)}
                  className="w-3.5 h-3.5 accent-emerald-600 disabled:cursor-not-allowed"
                />
                Incluir linhas previstas
              </label>
              <button
                onClick={exportFabricio}
                disabled={exporting}
                title="Baixa em Excel o demonstrativo das linhas visíveis (mesmo mês, visão e status)"
                className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium"
              >
                {exporting ? 'Gerando...' : '📥 Exportar Excel'}
              </button>
            </div>
          )}
          {tab === 'victor' && (
            <div className="ml-auto flex gap-2">
              {/* ⚠️ Atalho, NÃO um modal novo.
                  A tela de despesas rateadas já existe: é a visão 🗂️ Cards, onde cada valor
                  é digitado no cliente e na categoria a que pertence, com o bloco
                  "Distribuir guia pelo rateio". Um segundo lugar para pagar a mesma coisa
                  seria o problema que acabamos de resolver tirando Honorários e DAS do
                  modal "Receber" — dois caminhos com o mesmo nome e motores diferentes.
                  Este botão leva até lá e destaca o bloco. */}
              <button
                onClick={() => {
                  setTabView('cards')
                  setMostrarRateio(true)
                  setDestaqueRateio(true)
                  setTimeout(() => {
                    document.getElementById('bloco-distribuir-rateio')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }, 50)
                  setTimeout(() => setDestaqueRateio(false), 2600)
                }}
                title="Honorários, DAS e INSS — digite o total da guia e distribua pelo rateio de cada cliente"
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium"
              >💰 Pagar despesas rateadas</button>
              <button onClick={openReceive} className="px-4 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium">Receber</button>
            </div>
          )}
        </div>
      )}

      {tab === 'receivables' && (
        <div className="mb-4">{statusFilter}</div>
      )}

      {/* Previsão de impostos — só Lumen, aba Pagar Victor */}
      {tab === 'victor' && taxPreview && (
        <div className="bg-gray-900 border border-blue-500/30 rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <h3 className="text-white font-semibold">📊 Previsão de Impostos — {months[refMonth-1]}/{refYear}</h3>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400">{taxPreview.regimeLabel}</span>
              <button onClick={toggleMemoria} disabled={loadingMemoria}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 rounded-lg text-xs font-medium">
                💡 {loadingMemoria ? 'Carregando...' : showMemoria ? 'Ocultar memória' : 'Como chegamos aqui?'}
              </button>
              {/* Só faz sentido com o mês apurado: a guia é lançada SOBRE uma obrigação
                  existente, e é ela que carrega o id. Sem apuração o caminho é /fiscal. */}
              <button onClick={abrirEditImpostos} disabled={obligacoesMes.length === 0}
                title={obligacoesMes.length === 0 ? 'Nada apurado nesta competência — apure em /fiscal antes de lançar as guias.' : ''}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-xs font-medium">
                ✏️ Editar valores
              </button>
            </div>
          </div>
          {erroMemoria && (
            <p className="mb-3 text-red-300 text-xs bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">⚠️ {erroMemoria}</p>
          )}
          {msgImpostos && (
            <p className="mb-3 text-green-300 text-xs bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2 flex items-start gap-2">
              <span className="flex-1">✅ {msgImpostos}</span>
              <button onClick={() => setMsgImpostos('')} className="text-green-300/60 hover:text-green-200">✕</button>
            </p>
          )}
          {mode === 'caixa' && (
            <p className="text-amber-300/90 text-xs mb-3">💸 Impostos previstos para pagamento em {months[nextMonth-1]}/{nextYear}</p>
          )}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            <div className="flex justify-between col-span-2 border-b border-gray-800 pb-2 mb-1">
              <span className="text-gray-400">Faturamento do mês (NF)</span>
              <span className="text-white font-medium">{fmt(taxPreview.faturamentoMes)}</span>
            </div>
            {/* Sem faturamento não há Fator R: a razão folha/receita é uma divisão por zero
                que o taxCalc devolve como 0, e o "Anexo V" resultante seria uma etiqueta
                inventada num mês em que não há DAS nenhum a pagar. */}
            {taxPreview.fatorR != null && taxPreview.faturamentoMes > 0 ? (
              <div className="flex justify-between col-span-2 text-xs">
                <span className="text-gray-500">Fator R</span>
                <span className="text-gray-300">{(taxPreview.fatorR * 100).toFixed(1)}% → Anexo {taxPreview.anexo}</span>
              </div>
            ) : taxPreview.faturamentoMes <= 0 && (
              <p className="col-span-2 text-xs text-gray-500">
                Nenhuma NF neste mês — sem DAS. Sobra o INSS sobre o pró-labore no piso.
              </p>
            )}
            {taxPreview.itens.map((it) => (
              <div key={it.label} className="flex justify-between col-span-2 sm:col-span-1">
                <span className="text-gray-400">{it.label}</span>
                <span className="text-gray-200 font-mono">{fmt(it.value)}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between items-center border-t border-gray-800 mt-3 pt-3">
            <span className="text-gray-300 font-medium">Total a reservar</span>
            <span className="text-orange-400 text-lg font-bold">{fmt(taxPreview.total)}</span>
          </div>

          {/* O bloco acima é PREVISÃO e continua sendo: ele estima a partir do
              faturamento do mês. Quando a guia oficial chega, o valor que passa a valer
              é outro — e é este, que sai de fiscal_obligations.amount_actual. Mostrar os
              dois lado a lado evita a leitura de que o card "não atualizou" depois de
              salvar as guias. */}
          {(() => {
            const lancadas = obligacoesMes.filter((o) => o.amount_actual != null)
            if (!lancadas.length) return null
            const totalGuias = lancadas.reduce((s, o) => s + (parseFloat(o.amount_actual) || 0), 0)
            return (
              <div className="mt-3 pt-3 border-t border-gray-800">
                <div className="flex justify-between items-center">
                  <span className="text-gray-300 font-medium text-sm">📄 Guias oficiais lançadas</span>
                  <span className="text-blue-300 font-bold">{fmt(totalGuias)}</span>
                </div>
                <p className="text-gray-500 text-[11px] mt-1 leading-tight">
                  {lancadas.map((o) => `${RESERVA_LABEL[o.kind] || o.kind}: ${fmt(o.amount_actual)}`).join(' | ')}
                </p>
              </div>
            )
          })()}
          <p className="text-gray-600 text-[11px] mt-3">
            ⚠️ Previsão estimada. Consulte seu contador. A base é o faturamento real deste mês
            {' '}(só NFs de contrato que emite nota), e a RBT12 é esse mês × 12. A apuração de
            {' '}<strong>/fiscal</strong> usa a RBT12 dos 12 meses reais e agrupa a NF pela data de emissão —
            {' '}por isso os dois podem divergir. Abra a memória de cálculo para ver a conta.
          </p>

          {/* Memória de cálculo: o MESMO componente e os MESMOS números da tela /fiscal.
              Duas coisas podem separar o card da apuração, e o aviso diz qual delas é:
                base   — o card agrupa a NF pelo mês de referência da fatura (`month`), a
                         apuração pela data de EMISSÃO. Uma NF de dezembro emitida em
                         janeiro cai em meses diferentes nas duas telas.
                RBT12  — o card anualiza o mês; a apuração soma os 12 meses reais.
              Sem isto o usuário vê "R$ 10.540" no card e "sem faturamento nesta
              competência" logo abaixo, e conclui que um dos dois está quebrado. */}
          {showMemoria && calculoMemoria && (() => {
            const baseDif = Math.abs(calculoMemoria.faturamento_tributavel - taxPreview.faturamentoMes) >= 0.01
            const totalDif = Math.abs(calculoMemoria.total.calculado - taxPreview.total) >= 0.01
            return (
              <div className="mt-4">
                <MemoriaCalculo
                  calculo={calculoMemoria}
                  competencia={`${months[refMonth-1]}/${refYear}`}
                  aviso={(baseDif || totalDif) && (
                    <p className="mb-4 text-amber-300 text-xs bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                      ⚠️ O card acima ({fmt(taxPreview.total)}) e esta memória ({fmt(calculoMemoria.total.calculado)}) não batem.
                      {baseDif && <>
                        {' '}A base é outra: o card soma {fmt(taxPreview.faturamentoMes)} pelo mês de referência da
                        {' '}fatura, a apuração soma {fmt(calculoMemoria.faturamento_tributavel)} pela
                        {' '}<strong>data de emissão</strong> da NF.
                      </>}
                      {!baseDif && totalDif && <>
                        {' '}O card anualiza este mês para estimar a RBT12; a apuração soma os 12 meses reais.
                      </>}
                      {' '}Vale a apuração — é dela que saem as guias.
                    </p>
                  )} />
              </div>
            )
          })()}
        </div>
      )}

      {loading ? <div className="text-gray-500 text-sm">Carregando...</div> : (currentData.length === 0 && previewData.length === 0) ? (
        <div className="text-center py-16 text-gray-600"><p className="text-4xl mb-3">📂</p><p>Nenhum registro encontrado.</p></div>
      ) : (
        <div className="space-y-6">
          {/* Obrigações fiscais da competência — espelho de fiscal_obligations.
              Ordem: mês DESC, depois pró-labore → DAS → INSS → escritório (KIND_ORDEM).
              Não entram nos totais da aba nem na distribuição: são o que o Victor DEVE.
              A quitação é em /fiscal, que é o único lugar que registra fiscal_payments —
              dois canais de pagamento para a mesma guia fariam um dos dois mentir. */}
          {fiscalData.length > 0 && (
            <div className="space-y-2 bg-gray-900/40 border border-orange-500/20 rounded-xl p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs font-medium uppercase tracking-wider text-orange-400/80">🏛️ Obrigações fiscais</p>
                <span className="text-xs text-gray-500">
                  Em aberto: <span className="text-orange-400 font-medium">
                    {fmt(fiscalData.reduce((s, r) => s + Math.max(saldoOf(r), 0), 0))}
                  </span>
                </span>
              </div>
              <p className="text-gray-600 text-[11px] -mt-1">
                O que a empresa deve na competência. Fora dos totais desta aba — quitação em <strong>/fiscal</strong>.
              </p>
              {[...fiscalData]
                .sort((a, b) => {
                  const ka = a.year * 100 + a.month, kb = b.year * 100 + b.month
                  if (ka !== kb) return kb - ka                                    // mês DESC
                  return KIND_ORDEM.indexOf(a.kind) - KIND_ORDEM.indexOf(b.kind)   // kind ASC
                })
                .map(item => (
                  <div key={item.id} className="flex items-center justify-between gap-3 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="text-gray-500 text-xs">{months[effMonth(item)-1]}/{effYear(item)}</span>
                      <span className="text-white text-sm truncate">{item.description}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[item.status] || 'bg-gray-700 text-gray-400'}`}>{item.status}</span>
                    </div>
                    <div className="flex items-baseline gap-3 shrink-0 text-xs">
                      {parseFloat(item.paid_amount) > 0 && (
                        <span className="text-gray-500">Pago: <span className="text-green-400">{fmt(item.paid_amount)}</span></span>
                      )}
                      <span className="text-gray-200 font-mono text-sm">{fmt(item.total_amount)}</span>
                    </div>
                  </div>
                ))}
            </div>
          )}
          {/* Aba Pagar Victor: a lista por lançamento deu lugar ao breakdown por cliente.
              As outras abas seguem na lista — só o Victor tem cascata e rateio a mostrar. */}
          {tab === 'victor' ? (
            bdLoading ? (
              <div className="text-gray-500 text-sm">Carregando breakdown...</div>
            ) : !breakdown || breakdown.clientes.length === 0 ? (
              <div className="text-center py-10 text-gray-600 text-sm">Nenhum lançamento por cliente neste recorte.</div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="flex items-center gap-2">
                    <p className="text-xs font-medium uppercase tracking-wider text-green-400/80">👤 Por cliente</p>
                    {/* As duas visões leem o MESMO breakdown do backend — a tabela pelo
                        ?action=calcular-distribuicao, os cards pelo ?breakdown=true —,
                        então não têm como divergir no conjunto de clientes.
                        Só os Cards pagam: ver o comentário do estado tabView. */}
                    <span className="flex gap-1 bg-gray-800 rounded-lg p-0.5">
                      <button onClick={() => setTabView('tabela')}
                        className={`px-2 py-0.5 rounded text-[11px] ${tabView === 'tabela' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                      >📋 Tabela</button>
                      <button onClick={() => setTabView('cards')}
                        className={`px-2 py-0.5 rounded text-[11px] ${tabView === 'cards' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                        title="Momentos do imposto, extrato por cliente e pagamento"
                      >🗂️ Cards</button>
                      <button onClick={() => setTabView('rastreio')}
                        className={`px-2 py-0.5 rounded text-[11px] ${tabView === 'rastreio' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                        title="De onde veio cada centavo e para onde foi (payment_sources)"
                      >🔎 Rastreio</button>
                    </span>
                  </span>
                  <span className="text-xs text-gray-500">
                    Receber <span className="text-white font-medium">{fmt(breakdown.totais.receber)}</span>
                    <span className="text-gray-700"> · </span>
                    Imposto <span className="text-orange-400 font-medium">{fmt(breakdown.totais.impostos)}</span>
                    <span className="text-gray-700"> · </span>
                    Saída <span className="text-white font-semibold">{fmt(breakdown.totais.saida)}</span>
                  </span>
                </div>

                {/* Os três momentos do MÊS. Só as notas dos cards — o não faturado tem
                    bloco próprio abaixo, senão o "prévio" cobriria um conjunto maior que
                    o "real" e a diferença entre eles deixaria de ser a alíquota. */}
                {breakdown.momentos?.previo != null && (
                  <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-3">
                    <div className="flex items-center gap-3 flex-wrap text-xs">
                      <span className="text-[11px] uppercase tracking-wide text-gray-500">🕒 Imposto do recorte</span>
                      <span className="text-gray-500">1 · Prévio <span className="text-gray-200 font-mono">{fmt(breakdown.momentos.previo)}</span></span>
                      <span className="text-gray-700">→</span>
                      <span className="text-gray-500">2 · Real <span className="text-gray-200 font-mono">{fmt(breakdown.momentos.real)}</span></span>
                      <span className="text-gray-700">→</span>
                      <span className="text-gray-500">3 · Final{' '}
                        {breakdown.momentos.final == null
                          ? <span className="text-gray-700">aguardando guia</span>
                          : <span className="text-gray-200 font-mono">{fmt(breakdown.momentos.final)}</span>}
                      </span>
                    </div>
                    {breakdown.caixa?.bloqueado > 0.005 && (
                      <p className="text-amber-400/80 text-[11px] mt-2">
                        🔒 {fmt(breakdown.caixa.bloqueado)} em caixa posterior a{' '}
                        {months[breakdown.caixa.mes_referencia - 1]}/{breakdown.caixa.ano_referencia} —
                        aparece no card, mas não pode ser pago ainda.
                      </p>
                    )}
                  </div>
                )}

                {tabView === 'rastreio' ? renderRastreio()
                  : tabView === 'tabela' ? renderTabelaTabulada()
                    : breakdown.clientes.map(renderBreakdownCard)}

                {/* MOMENTO 1 puro: trabalho apontado e contrato mensal que ainda não viraram
                    nota. Ficam FORA dos cards porque não há payable — o Victor só recebe
                    quando o cliente paga o recebível, e um input aqui gravaria em nada. */}
                {breakdown.previstos?.length > 0 && (
                  <div className="bg-gray-900/40 border border-dashed border-gray-700 rounded-xl p-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                      <p className="text-[11px] uppercase tracking-wide text-gray-500">
                        🔮 Ainda sem NF — imposto previsto
                      </p>
                      <span className="text-xs text-gray-500">
                        Base <span className="text-gray-300 font-mono">{fmt(breakdown.previsao?.base)}</span>
                        <span className="text-gray-700"> · </span>
                        Imposto <span className="text-orange-400/80 font-mono">{fmt(breakdown.momentos?.previsto_nao_faturado)}</span>
                      </span>
                    </div>
                    {breakdown.previstos.map(p => (
                      <div key={p.client_id} className="flex justify-between gap-2 py-1 text-[11px] font-mono border-b border-gray-800/60 last:border-0">
                        <span className="font-sans text-gray-400">{p.client_name}</span>
                        <span className="text-gray-500">
                          base {fmt(p.base)}
                          <span className="text-gray-700"> · </span>
                          DAS {fmt(p.momentos.previo.das)} · INSS {fmt(p.momentos.previo.inss)} · Escrit {fmt(p.momentos.previo.escritorio)}
                          <span className="text-gray-700"> · </span>
                          <span className="text-orange-400/80">{fmt(p.momentos.previo.total)}</span>
                        </span>
                      </div>
                    ))}
                    <p className="text-gray-600 text-[10px] mt-2">
                      Horas apontadas sem fatura e contrato mensal sem nota no mês. Nada a pagar
                      aqui: o lançamento do Victor só nasce quando o cliente paga o recebível.
                      {breakdown.previsao?.contratos_projetados === false && (
                        <> Mês fechado — contratos mensais não são projetados, só as horas apontadas.</>
                      )}
                    </p>
                  </div>
                )}

                {/* Barra de pagamento. Prévia e gravação chamam o MESMO endpoint,
                    mudando só `aplicar` — ver bdEnviar().
                    Só na visão Cards: lá cada valor é digitado no cliente e na categoria a
                    que pertence. Na Tabela os totais são globais e a absorção é exibição —
                    ligar o botão a ela faria a gravação (que abate do saldo do Victor)
                    divergir do que a tabela mostra. Ver lib/victor-tabulado.js. */}
                <div className={`sticky bottom-2 bg-gray-900 border border-gray-700 rounded-xl p-3 space-y-2 shadow-lg ${tabView === 'tabela' ? 'hidden' : ''}`}>
                  {/* Guias rateadas: digita-se o total UMA vez e o rateio diz quanto cabe a
                      cada cliente. Preenche os campos dos cards — não paga sozinho, para o
                      valor ainda poder ser conferido e ajustado antes do Pagar. */}
                  {!mostrarRateio && (
                    <button onClick={() => { setMostrarRateio(true); setDestaqueRateio(true); setTimeout(() => setDestaqueRateio(false), 2600) }}
                      className="text-[11px] text-blue-300/80 hover:text-blue-200 underline decoration-dotted">
                      🧮 Distribuir uma guia pelo rateio (Escritório, DAS, INSS)
                    </button>
                  )}
                  {mostrarRateio && (
                  <div id="bloco-distribuir-rateio"
                    className={`border-b border-gray-800 pb-2 rounded-lg transition-all duration-500 ${destaqueRateio ? 'ring-2 ring-blue-400/70 bg-blue-500/5 px-2 pt-2' : ''}`}>
                    <p className="text-[11px] uppercase tracking-wider text-blue-300/80 mb-1.5">
                      🧮 Distribuir guia pelo rateio
                    </p>
                    <div className="flex items-end gap-2 flex-wrap">
                      {CATEGORIAS_RATEADAS.map(cat => (
                        <div key={cat} className="flex flex-col gap-1">
                          <label className="text-[10px] text-gray-500">{BREAKDOWN_LABEL[cat]} — total da guia</label>
                          <div className="flex gap-1">
                            <input type="number" step="0.01" placeholder="0,00"
                              value={bdTotais[cat]}
                              onChange={e => { setBdTotais(t => ({ ...t, [cat]: e.target.value })); setBdDistMsg(''); setBdDistErro('') }}
                              className="w-28 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-xs placeholder-gray-600 focus:outline-none focus:border-blue-500"/>
                            <button onClick={() => distribuirRateado(cat)}
                              className="px-2 py-1.5 border border-blue-500/40 text-blue-300 hover:bg-blue-500/10 rounded-lg text-[11px] whitespace-nowrap">
                              Distribuir
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {bdDistMsg && <p className="text-green-400/90 text-[11px] mt-1.5">{bdDistMsg}</p>}
                    {bdDistErro && <p className="text-red-400 text-[11px] mt-1.5">{bdDistErro}</p>}
                    <p className="text-gray-600 text-[10px] mt-1 leading-tight">
                      Preenche os campos dos cards com a fatia de cada cliente — <strong>não paga</strong>.
                      Confira e use o <strong>Pagar</strong> abaixo. O peso é o <strong>saldo em aberto</strong> de
                      cada um, não o percentual exibido: ele é arredondado a 2 casas e deixaria um centavo para trás.
                    </p>
                  </div>
                  )}

                  <div className="flex items-end gap-3 flex-wrap">
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] text-gray-400">Data do pagamento</label>
                      <input type="date" value={bdPaidAt} onChange={e => { setBdPaidAt(e.target.value); setBdPlano(null) }}
                        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-blue-500"/>
                    </div>
                    <div className="flex-1 min-w-[8rem]">
                      <p className="text-[11px] text-gray-400">Total a pagar</p>
                      <p className="text-lg font-bold text-green-400">{fmt(bdTotalDigitado)}</p>
                    </div>
                    {/* Cancelar = descartar o que foi digitado. Não fecha nada: esta barra
                        não é um modal, é parte da visão Cards. Sem ele, o único jeito de
                        desfazer uma distribuição indesejada era apagar campo por campo. */}
                    {/* ⚠️ SEM `disabled`. Ele ficava apagado (opacity-40) enquanto não
                        houvesse nada digitado — que é exatamente quando o usuário abre a
                        barra e procura os botões. Um botão translúcido ao lado de dois
                        sólidos se lê como "não existe". Sem nada para limpar, o clique
                        simplesmente não faz diferença. */}
                    <button
                      onClick={() => {
                        setBdInputs({}); setBdTotais({ escritorio: '', das: '', inss: '' })
                        setBdPlano(null); setBdErro(''); setBdMsg(''); setBdDistMsg(''); setBdDistErro('')
                        // Fecha o bloco de rateio: é o "sair" que faltava. Sem isto, o
                        // clique não tinha efeito visível quando não havia nada digitado.
                        setMostrarRateio(false); setDestaqueRateio(false)
                      }}
                      title="Descarta os valores digitados e fecha a distribuição — nada é gravado"
                      className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-xs font-medium"
                    >❌ Cancelar</button>
                    <button
                      onClick={() => bdEnviar(false)}
                      disabled={bdTotalDigitado <= 0 || bdSaving}
                      className="px-3 py-2 border border-gray-600 text-gray-200 hover:bg-gray-800 rounded-lg text-xs font-medium disabled:opacity-40"
                    >👁️ Ver prévia</button>
                    <button
                      onClick={() => bdEnviar(true)}
                      disabled={bdTotalDigitado <= 0 || bdSaving}
                      className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-xs font-medium disabled:opacity-40"
                    >{bdSaving ? 'Gravando...' : '✅ Pagar'}</button>
                  </div>

                  {bdErro && <p className="text-red-400 text-xs">{bdErro}</p>}
                  {bdMsg && <p className="text-green-400 text-xs">{bdMsg}</p>}

                  {bdPlano?.resumo && (
                    <div className="border-t border-gray-800 pt-2 space-y-1">
                      <p className="text-[11px] uppercase tracking-wider text-blue-300">Prévia — nada foi gravado</p>
                      {bdPlano.alocacoes?.map(a => (
                        <div key={a.ordem} className="flex justify-between gap-2 text-[11px]">
                          <span className="truncate text-gray-400">
                            <span className="text-gray-600 font-mono">{a.ordem}.</span>{' '}
                            <span className={a.tipo === 'rateio' ? 'text-blue-400' : 'text-amber-400'}>
                              {a.tipo === 'rateio' ? 'rateio' : 'fallback'}
                            </span>{' '}
                            {CAT_LABEL[a.categoria] || a.categoria} · {a.cliente_nome} · lançamento #{a.payable_id}
                          </span>
                          <span className="shrink-0 font-mono text-green-400">{fmt(a.valor)}</span>
                        </div>
                      ))}
                      {/* Pagar uma categoria fiscal quita a guia da competência — dizer
                          isso aqui evita a descoberta pela /fiscal depois. */}
                      {bdPlano.resumo.quitacoes?.length > 0 && (
                        <p className="text-[11px] text-orange-400/90 pt-1">
                          Quita em Apuração Fiscal: {bdPlano.resumo.quitacoes.map(q => `${CAT_LABEL[q.kind] || q.kind} ${fmt(q.valor)}`).join(' · ')}
                        </p>
                      )}
                      {bdPlano.resumo.sem_obrigacao?.length > 0 && (
                        <p className="text-[11px] text-amber-400/80">
                          ⚠️ Sem apuração em {months[refMonth-1]}/{refYear} para: {bdPlano.resumo.sem_obrigacao.map(k => CAT_LABEL[k] || k).join(', ')}. Nenhuma guia será quitada.
                        </p>
                      )}
                      {bdPlano.resumo.ja_quitadas?.length > 0 && (
                        <p className="text-[11px] text-red-400">
                          ⛔ Já quitado nesta competência: {bdPlano.resumo.ja_quitadas.map(q => CAT_LABEL[q.categoria] || q.categoria).join(', ')}. Estorne o abatimento em /fiscal antes de pagar de novo.
                        </p>
                      )}
                    </div>
                  )}

                  <p className="text-gray-600 text-[10px]">
                    O estorno continua por lançamento (logo abaixo) e o abatimento fiscal em <strong>/fiscal</strong>.
                  </p>
                </div>

                {/* ── LANÇAMENTOS COM PAGAMENTO — o acesso ao estorno ────────────────
                    ⚠️ A aba Pagar Victor cai no ramo dos CARDS e nunca chega ao
                    `renderRow` do outro lado do ternário, onde mora o botão "🔄 Estornar".
                    Resultado: o botão existia e era inalcançável — o usuário só conseguia
                    estornar indo a outra aba.
                    Aqui entram SÓ os que têm pagamento registrado (pago/parcial), que são
                    os únicos com o que estornar. Repetir a lista inteira duplicaria os
                    cards, que é a razão de ela ter sido tirada daqui. */}
                {(() => {
                  const comPagamento = (availableData || []).filter(r => r.status === 'pago' || r.status === 'parcial')
                  if (!comPagamento.length) return null
                  return (
                    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3 space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
                        ↩️ Lançamentos com pagamento — {comPagamento.length}
                      </p>
                      <p className="text-gray-600 text-[10px] -mt-1 leading-tight">
                        Estornar apaga os pagamentos do lançamento e o devolve para Pendente.
                        Guia fiscal quitada pelo rateio não sai por aqui — isso é em <strong>/fiscal → Pagamentos</strong>.
                      </p>
                      {comPagamento.map(item => (
                        <div key={item.id} className="flex items-center justify-between gap-2 flex-wrap border-t border-gray-800/60 pt-2 first:border-0 first:pt-0">
                          <span className="text-xs text-gray-300 truncate">
                            <span className="text-gray-500">{months[item.month - 1]}/{item.year}</span> {item.client_name}
                            <span className={`ml-2 px-2 py-0.5 rounded-full text-[10px] ${item.status === 'pago' ? 'bg-green-500/20 text-green-400' : 'bg-orange-500/20 text-orange-400'}`}>
                              {item.status === 'pago' ? '✓ Pago' : '◐ Parcial'}
                            </span>
                            <span className="text-gray-600 font-mono ml-2">{fmt(item.paid_amount)} de {fmt(item.total_amount)}</span>
                          </span>
                          <span className="flex gap-2 shrink-0">
                            <button onClick={() => openPayments(item)}
                              className="px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white rounded-lg text-xs">Ver pagamentos</button>
                            <button onClick={() => estornarPayable(item)}
                              title="Desfaz os pagamentos deste lançamento e o devolve para Pendente"
                              className="px-3 py-1 bg-red-600/90 hover:bg-red-500 text-white rounded-lg text-xs font-medium">🔄 Estornar</button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>
            )
          ) : availableData.length > 0 && (
            <div className="space-y-3">
              {isPayTab && (waitingData.length > 0 || previewData.length > 0) && (
                <p className="text-xs font-medium uppercase tracking-wider text-green-400/80">✅ Disponível para pagar</p>
              )}
              {availableData.map(item => renderRow(item, false))}
            </div>
          )}
          {/* No Victor os que aguardam o cliente já aparecem no card do próprio cliente,
              marcados e com os inputs desabilitados — repetir a lista aqui mostraria o
              mesmo lançamento duas vezes. */}
          {isPayTab && tab !== 'victor' && waitingData.length > 0 && (
            <div className="space-y-3 bg-gray-900/40 border border-gray-800/60 rounded-xl p-3">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">⏳ Aguardando recebimento do cliente</p>
              <div className="space-y-3 opacity-70">
                {waitingData.map(item => renderRow(item, true))}
              </div>
            </div>
          )}
          {isPayTab && previewData.length > 0 && (
            <div className="space-y-3 bg-gray-900/30 border border-dashed border-gray-700 rounded-xl p-3 opacity-60">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">🔮 Previsto (aguardando cliente pagar)</p>
              <p className="text-gray-600 text-xs -mt-1">Será criado automaticamente quando o cliente pagar</p>
              {previewData.map(item => (
                <div key={item.id} className="bg-gray-900 border border-dashed border-gray-700 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-400 text-xs rounded-full">{item.client_name}</span>
                    <span className="text-gray-500 text-xs">{months[effMonth(item)-1]}/{effYear(item)}</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-700 text-gray-400">previsto</span>
                  </div>
                  <div className="flex gap-4 mt-1 text-xs items-center">
                    <span className="text-gray-500">Total: <span className="text-white font-medium">{fmt(item.amount || item.total_amount)}</span></span>
                    {tab === 'fabricio' && item.breakdown && (
                      <button onClick={() => openPayments(item)} className="ml-auto px-3 py-1 border border-gray-600 text-gray-300 hover:bg-gray-800 rounded-lg text-xs">🧮 Ver cálculo</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      </>)}

      {tab === 'historico' && (
        <div>
          {/* Filtro de tipo */}
          <div className="flex gap-2 mb-4 flex-wrap items-center">
            <span className="text-gray-500 text-xs uppercase tracking-wider mr-1">Tipo:</span>
            {[['receivables','A Receber'],['fabricio','Pagar Fabrício'],['victor','Pagar Victor']].map(([key,label]) => (
              <button key={key} onClick={() => setHistType(key)} className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${histType === key ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{label}</button>
            ))}
          </div>

          {/* Filtro de cliente */}
          {histClients.length > 0 && (
            <div className="flex gap-2 mb-4 flex-wrap items-center">
              <span className="text-gray-500 text-xs uppercase tracking-wider mr-1">Cliente:</span>
              <button onClick={() => setHistClient('')} className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${histClient === '' ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>Todos</button>
              {histClients.map(c => (
                <button key={c.id} onClick={() => setHistClient(String(c.id))} className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${histClient === String(c.id) ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{c.name}</button>
              ))}
            </div>
          )}

          {/* Totalizador */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6 w-fit min-w-[220px]">
            <p className="text-gray-400 text-xs mb-1">Total pago no período</p>
            <p className="text-green-400 text-lg font-bold">{fmt(histTotalPaid)}</p>
          </div>

          {loading ? <div className="text-gray-500 text-sm">Carregando...</div> : histData.length === 0 ? (
            <div className="text-center py-16 text-gray-600"><p className="text-4xl mb-3">📭</p><p>Nenhum pagamento registrado no período.</p></div>
          ) : (
            <div className="space-y-3">
              {histData.map(item => (
                <div key={item.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-400 text-xs rounded-full">{item.client_name}</span>
                    <span className="text-gray-500 text-xs">{months[effMonth(item)-1]}/{effYear(item)}</span>
                    {item.origin === 'faturamento' && <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded-full">via Faturamento</span>}
                  </div>
                  {item.description && <p className="text-white text-sm">{item.description}</p>}
                  <div className="flex gap-4 mt-2 text-xs flex-wrap">
                    <span className="text-gray-500">Pago: <span className="text-green-400 font-medium">{fmt(item.paid_amount)}</span></span>
                    {item.paid_at && <span className="text-gray-500">Em: <span className="text-gray-300">{new Date(item.paid_at).toLocaleDateString('pt-BR', {timeZone:'UTC'})}</span></span>}
                  </div>
                  {item.notes && <p className="text-gray-500 text-xs mt-2 italic">{item.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal — valores reais das guias (o contador confirmou) */}
      {editImpostos && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-white mb-1">
              Valores reais dos impostos — {months[editImpostos.month - 1]}/{editImpostos.year}
            </h3>
            <p className="text-gray-500 text-xs mb-4">
              O que o contador confirmou. Em branco = sem guia lançada, volta a valer o valor apurado.
            </p>

            {editImpostos.rows.length === 0 ? (
              <p className="text-amber-300 text-xs bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                Nada apurado nesta competência. Rode a apuração em <strong>/fiscal</strong> antes de lançar as guias.
              </p>
            ) : (
              <div className="space-y-3">
                {editImpostos.rows.map((r) => (
                  <div key={r.id} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white">{RESERVA_LABEL[r.kind] || r.kind}</p>
                      <p className="text-[11px] text-gray-500">
                        Apurado {fmt(r.estimado)}
                        {r.pago > 0 && ` · ${fmt(r.pago)} já pago`}
                      </p>
                    </div>
                    <input
                      type="number" step="0.01" min="0" placeholder={r.estimado.toFixed(2)}
                      value={r.valor} onChange={(e) => setLinhaImposto(r.id, e.target.value)}
                      className="w-36 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm text-right placeholder-gray-600 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                ))}

                <label className="flex items-start gap-2 pt-2 border-t border-gray-800 cursor-pointer">
                  <input type="checkbox" checked={editImpostos.aplicar}
                    onChange={(e) => setEditImpostos((s) => ({ ...s, aplicar: e.target.checked }))}
                    className="mt-0.5 accent-blue-500" />
                  <span className="text-xs text-gray-300">
                    Atualizar os lançamentos do Victor
                    <span className="block text-gray-500 text-[11px]">
                      O imposto real substitui a provisão da fatura no que o Victor tem a receber.
                      Desmarque para só registrar as guias e conferir a prévia em <strong>/fiscal</strong>.
                    </span>
                  </span>
                </label>
              </div>
            )}

            {erroImpostos && (
              <p className="mt-3 text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{erroImpostos}</p>
            )}

            <div className="flex gap-3 mt-5">
              <button onClick={() => { setEditImpostos(null); setErroImpostos('') }}
                className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Cancelar</button>
              <button onClick={salvarImpostosReais} disabled={savingImpostos || editImpostos.rows.length === 0}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium">
                {savingImpostos ? 'Salvando...' : 'Salvar e recalcular'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal novo registro */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-white mb-4">Novo registro — {tab === 'receivables' ? 'A Receber' : tab === 'fabricio' ? 'Pagar Fabrício' : 'Pagar Victor'}</h3>
            <div className="space-y-3">
              <select value={form.client_id} onChange={e=>setForm(f=>({...f,client_id:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                <option value="">Selecione o cliente</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-3">
                <select value={form.month} onChange={e=>setForm(f=>({...f,month:parseInt(e.target.value)}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                  {months.map((m,i) => <option key={i} value={i+1}>{m}</option>)}
                </select>
                <input type="number" value={form.year} onChange={e=>setForm(f=>({...f,year:parseInt(e.target.value)}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400 font-medium">Descrição</label>
                <input placeholder="Descrição" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
              </div>
              {tab === 'victor' ? (
                <>
                  <input placeholder="Valor serviço (R$)" type="number" value={form.service_amount} onChange={e=>setForm(f=>({...f,service_amount:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                  <input placeholder="Valor lucro (R$)" type="number" value={form.profit_amount} onChange={e=>setForm(f=>({...f,profit_amount:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                </>
              ) : (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400 font-medium">Valor (R$)</label>
                  <input placeholder="Valor (R$)" type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400 font-medium">Observações</label>
                <textarea placeholder="Observações" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"/>
              </div>
            </div>
            {erroModal && (
              <p className="mt-3 text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{erroModal}</p>
            )}
            <div className="flex gap-3 mt-5">
              <button onClick={closeModal} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Cancelar</button>
              <button onClick={save} disabled={saving} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium">{saving ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal pagamento — A Receber (pagamento único) */}
      {showPayModal && tab === 'receivables' && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-white mb-4">Registrar pagamento</h3>
            <div className="space-y-3">
              <input placeholder="Valor pago (R$)" type="number" value={payForm.paid_amount} onChange={e=>setPayForm(f=>({...f,paid_amount:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400 font-medium">Data do pagamento</label>
                <input type="date" value={payForm.paid_at} onChange={e=>setPayForm(f=>({...f,paid_at:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
              </div>
              {tab === 'fabricio' && (
                <>
                  <input placeholder="Forma de pagamento" value={payForm.payment_method} onChange={e=>setPayForm(f=>({...f,payment_method:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                  <label className="flex items-center gap-2 text-gray-300 text-sm cursor-pointer">
                    <input type="checkbox" checked={payForm.is_compensation} onChange={e=>setPayForm(f=>({...f,is_compensation:e.target.checked}))} className="rounded"/>
                    É uma compensação?
                  </label>
                  {/* Compensação: quanto do que foi pago vira crédito do Victor em vez de
                      sair caixa. Em branco = tudo (o comportamento de antes). O resto é
                      pagamento real — é o Cenário B ("compensa 900, me paga 100"). */}
                  {payForm.is_compensation && (() => {
                    const pago = parseFloat(String(payForm.paid_amount).replace(',', '.')) || 0
                    const comp = payForm.compensation_amount === ''
                      ? pago
                      : (parseFloat(String(payForm.compensation_amount).replace(',', '.')) || 0)
                    const dinheiro = cents(pago - comp)
                    return (
                      <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 flex flex-col gap-2">
                        <p className="text-[11px] text-blue-200/80 leading-tight">
                          O Fabrício deixa de receber e o valor vira crédito do Victor —
                          nenhum dinheiro sai. Não cria lançamento a pagar: o crédito fica
                          disponível para ser usado na aba Pagar Victor.
                        </p>
                        <div className="flex items-center gap-2">
                          <input type="number" step="0.01" placeholder={`Compensado (padrão: ${fmt(pago)})`}
                            value={payForm.compensation_amount}
                            onChange={e=>setPayForm(f=>({...f,compensation_amount:e.target.value}))}
                            className="w-40 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                          <span className="text-[11px] text-gray-500">de {fmt(pago)} pagos</span>
                        </div>
                        {dinheiro > 0.005 && (
                          <p className="text-[11px] text-amber-300/90">
                            {fmt(comp)} compensados (sem caixa) + <strong>{fmt(dinheiro)} pagos em dinheiro</strong> (sai do caixa).
                          </p>
                        )}
                        {dinheiro < -0.005 && (
                          <p className="text-[11px] text-red-400">
                            A compensação passa do valor pago em {fmt(-dinheiro)} — o backend vai recusar.
                          </p>
                        )}
                        <textarea placeholder="Detalhe da compensação (ex: Fabrício devia R$ 900)" value={payForm.compensation_notes} onChange={e=>setPayForm(f=>({...f,compensation_notes:e.target.value}))} rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"/>
                      </div>
                    )
                  })()}
                </>
              )}
              <select value={payForm.status} onChange={e=>setPayForm(f=>({...f,status:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                <option value="pago">Pago integralmente</option>
                <option value="parcial">Pago parcialmente</option>
              </select>
              <textarea placeholder="Observações" value={payForm.notes} onChange={e=>setPayForm(f=>({...f,notes:e.target.value}))} rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"/>
            </div>
            {erroPay && (
              <p className="mt-3 text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{erroPay}</p>
            )}
            <div className="flex gap-3 mt-5">
              <button onClick={()=>{setShowPayModal(null);setErroPay('')}} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Cancelar</button>
              <button onClick={() => pay(showPayModal)} disabled={paying} className="flex-1 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium">{paying ? 'Confirmando...' : 'Confirmar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal pagamentos — Pagar Victor/Fabrício (múltiplos pagamentos) */}
      {showPayModal && tab !== 'receivables' && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-1">
              <h3 className="text-lg font-bold text-white">Pagamentos</h3>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[showPayModal.status] || 'bg-gray-700 text-gray-400'}`}>{showPayModal.status}</span>
            </div>
            <p className="text-gray-400 text-xs mb-4">
              {showPayModal.client_name} — {months[showPayModal.month-1]}/{showPayModal.year}
              <span className="text-gray-500"> · Total: </span>
              <span className="text-white">{fmt(showPayModal.total_amount || showPayModal.amount)}</span>
            </p>

            {/* Demonstrativo — como a fatura chegou ao valor do Fabrício. Vem antes da
                lista de pagamentos porque explica o total exibido logo acima. */}
            {tab === 'fabricio' && fabricioBreakdownPanel(showPayModal)}

            {/* Lista de pagamentos */}
            <div className="space-y-2 mb-5">
              {modalPayments.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-4">Nenhum pagamento registrado</p>
              ) : modalPayments.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-3 bg-gray-800 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium">{fmt(p.amount)} <span className="text-gray-500 font-normal">em {new Date(p.paid_at).toLocaleDateString('pt-BR', {timeZone:'UTC'})}</span></p>
                    {p.notes && <p className="text-gray-500 text-xs italic truncate">{p.notes}</p>}
                  </div>
                  <button onClick={() => setEstornoConfirm(p)} title="Estornar" className="shrink-0 text-red-500 hover:text-red-400 text-base">🗑️</button>
                </div>
              ))}
            </div>

            {/* Detalhamento por categoria (Por cliente / Geral) */}
            {breakdownPanel(paymentEntries)}

            {/* Formulário novo pagamento */}
            <div className="border-t border-gray-800 pt-4 space-y-3">
              <p className="text-gray-300 text-sm font-medium">Novo pagamento</p>
              {tab === 'victor' ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {VICTOR_CATEGORIES.map(([key, label]) => (
                      <div key={key} className="flex flex-col gap-1">
                        <label className="text-xs text-gray-400 font-medium">{label} (R$)</label>
                        <input type="number" placeholder="0" value={victorCats[key]} onChange={e=>setVictorCats(c=>({...c,[key]:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400 font-medium">Data do pagamento</label>
                    <input type="date" value={newPay.paid_at} onChange={e=>setNewPay(f=>({...f,paid_at:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
                  </div>
                  <p className="text-sm text-gray-300">Total a pagar: <span className="text-green-400 font-bold">{fmt(victorCatTotal)}</span></p>
                  <button onClick={addPayment} disabled={addingPay || victorCatTotal <= 0 || !newPay.paid_at} className="w-full py-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium">{addingPay ? 'Registrando...' : 'Registrar Pagamento'}</button>
                </>
              ) : (
                <>
                  <input placeholder="Valor (R$)" type="number" value={newPay.amount} onChange={e=>setNewPay(f=>({...f,amount:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400 font-medium">Data do pagamento</label>
                    <input type="date" value={newPay.paid_at} onChange={e=>setNewPay(f=>({...f,paid_at:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
                  </div>
                  <textarea placeholder="Observação" value={newPay.notes} onChange={e=>setNewPay(f=>({...f,notes:e.target.value}))} rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"/>
                  <button onClick={addPayment} disabled={addingPay || !newPay.amount || !newPay.paid_at} className="w-full py-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium">{addingPay ? 'Registrando...' : 'Registrar Pagamento'}</button>
                </>
              )}
            </div>

            {erroPayments && (
              <p className="mt-3 text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{erroPayments}</p>
            )}
            <button onClick={()=>{setShowPayModal(null);setErroPayments('')}} className="w-full mt-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Fechar</button>
          </div>
        </div>
      )}

      {/* Confirmação de estorno */}
      {estornoConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-white mb-2">Estornar pagamento</h3>
            <p className="text-gray-400 text-sm mb-5">Deseja estornar o pagamento de {fmt(estornoConfirm.amount)} realizado em {new Date(estornoConfirm.paid_at).toLocaleDateString('pt-BR', {timeZone:'UTC'})}?</p>
            <div className="flex gap-3">
              <button onClick={()=>setEstornoConfirm(null)} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Cancelar</button>
              <button onClick={()=>deletePayment(estornoConfirm)} disabled={addingPay} className="flex-1 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium">{addingPay ? 'Estornando...' : 'Estornar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Receber — distribui valor entre os registros pendentes/parciais do Victor */}
      {/* Confirmação do estorno de UM pagamento. z-60 para ficar sobre o modal Receber,
          de onde é aberto. Não devolve o valor para os inputs: o estorno recompõe o SALDO,
          e a tabela de distribuição reflete isso sozinha por ser derivada de paid_amount. */}
      {estornoItens?.length > 0 && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 w-full max-w-sm max-h-[85vh] overflow-y-auto">
            <h3 className="text-base font-bold text-white mb-3">
              {estornoItens.length === 1 ? 'Estornar pagamento' : `Estornar ${estornoItens.length} pagamentos`}
            </h3>
            {/* Um pagamento: os detalhes cabem e são o que se quer conferir antes de
                confirmar. Vários: a lista, porque repetir "Absorveu de" N vezes viraria
                parede de texto e o que importa no lote é o conjunto e o total. */}
            {estornoItens.length === 1 ? (
              <div className="space-y-1 text-xs font-mono bg-gray-950/60 rounded-lg p-3">
                {[
                  ['Cliente', estornoItens[0].client_name],
                  ['Competência', estornoItens[0].competencia],
                  ['Data do pagamento', estornoItens[0].data ? estornoItens[0].data.split('-').reverse().join('/') : '—'],
                  ['Absorveu de', `${estornoItens[0].origem} · lucro ${fmt(estornoItens[0].de_lucro)} + serviço ${fmt(estornoItens[0].de_servico)}`],
                ].map(([label, valor]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <span className="font-sans text-gray-500">{label}</span>
                    <span className="text-gray-300 text-right">{valor}</span>
                  </div>
                ))}
                <div className="flex justify-between gap-3 border-t border-gray-800 pt-1 mt-1">
                  <span className="font-sans text-gray-400 font-semibold">Valor a devolver</span>
                  <span className="text-red-400 font-semibold">{fmt(estornoItens[0].valor_pagamento)}</span>
                </div>
              </div>
            ) : (
              <div className="space-y-0.5 text-[11px] font-mono bg-gray-950/60 rounded-lg p-3">
                {estornoItens.map(it => (
                  <div key={it.payment_id} className="flex justify-between gap-3">
                    <span className="font-sans text-gray-500 min-w-0 truncate">
                      {it.data ? it.data.split('-').reverse().join('/') : '—'} · {it.client_name}
                      <span className="text-gray-700"> · {it.competencia}</span>
                    </span>
                    <span className="text-gray-300 shrink-0">{fmt(it.valor_pagamento)}</span>
                  </div>
                ))}
                <div className="flex justify-between gap-3 border-t border-gray-800 pt-1 mt-1">
                  <span className="font-sans text-gray-400 font-semibold">Total a devolver</span>
                  <span className="text-red-400 font-semibold">{fmt(estornoTotal(estornoItens))}</span>
                </div>
              </div>
            )}
            {/* payable_payments é UMA linha por sessão: se o pagamento cobria mais de uma
                categoria, estornar devolve todas. Mostrar só a fatia clicada faria o valor
                do botão não bater com o que some da tela. */}
            {estornoItens.some(i => i.categorias_da_sessao > 1) && (
              <p className="text-amber-400/80 text-[11px] mt-2 leading-tight">
                ⚠️ {estornoItens.length === 1 ? 'Este pagamento cobre' : 'Há pagamento que cobre'} mais
                de uma categoria — o estorno devolve todas elas, não só a fatia da categoria
                em que foi marcado.
              </p>
            )}
            <p className="text-gray-600 text-[11px] mt-2 leading-tight">
              O saldo do lançamento volta ao valor anterior e a distribuição recalcula. O
              estorno fica registrado nas observações do lançamento.
            </p>
            {erroReceive && <p className="text-red-400 text-xs mt-2">{erroReceive}</p>}
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => { setEstornoItens(null); setErroReceive('') }}
                disabled={estornando}
                className="flex-1 px-4 py-2 border border-gray-600 text-gray-300 hover:bg-gray-800 rounded-lg text-sm disabled:opacity-40"
              >Cancelar</button>
              <button
                onClick={confirmarEstornoPagamento}
                disabled={estornando}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-medium disabled:opacity-40"
              >{estornando ? 'Estornando...' : 'Confirmar estorno'}</button>
            </div>
          </div>
        </div>
      )}

      {showReceiveModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          {/* max-w-3xl (era md): a tabela de distribuição passou a ter 9 colunas e em
              448px elas quebravam linha, deixando os valores ilegíveis. */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-white mb-1">{editSession ? 'Editar recebimento — Pagar Victor' : receiveTarget ? 'Pagar — Pagar Victor' : 'Receber — Pagar Victor'}</h3>
            {receiveTarget && (
              <p className="text-gray-400 text-xs mb-4">Alvo: {receiveTarget.client_name} — {months[receiveTarget.month-1]}/{receiveTarget.year} · Saldo: {fmt((parseFloat(receiveTarget.total_amount)||0) - (parseFloat(receiveTarget.paid_amount)||0))}</p>
            )}
            {editSession && (
              <p className="text-gray-400 text-xs mb-4">Editando a sessão de {new Date(editSession.paid_at).toLocaleDateString('pt-BR', {timeZone:'UTC'})}. Ao confirmar, a distribuição anterior é substituída.</p>
            )}
            {!receiveTarget && !editSession && <div className="mb-4" />}
            <div className="space-y-3">
              {/* Reservas do mês — vêm da apuração fiscal, não são mais digitadas aqui. */}
              <div className="bg-amber-500/5 border border-amber-500/30 rounded-xl p-3 space-y-2">
                <p className="text-amber-300 text-xs font-medium uppercase tracking-wider">🏦 Reservas do mês (ficam no caixa)</p>
                {reservesLista.length ? (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    {reservesLista.map(([key, v]) => (
                      <div key={key} className="flex items-center justify-between text-xs">
                        <span className="text-gray-400">{RESERVA_LABEL[key] || key}</span>
                        <span className="text-gray-200">{fmt(v)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-xs">Nada em aberto na apuração deste mês.</p>
                )}
                <div className="flex items-center justify-between gap-2 border-t border-amber-500/20 pt-2">
                  <p className="text-xs text-gray-300">Total reservas: <span className="text-orange-400 font-bold">{fmt(reservesTotal)}</span></p>
                  <a href="/fiscal" className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-medium">Abrir apuração</a>
                </div>
                <p className="text-gray-600 text-[11px]">
                  Valor em aberto (devido − pago) da apuração de {(() => { const {rm,ry} = reserveRefPeriod(); return `${months[rm-1]}/${ry}` })()}.
                  Para alterar, apure ou lance a guia em Apuração Fiscal.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {RECEIVE_VICTOR_CATEGORIES.map(([key, label]) => {
                  const modo = MODO_INFO[modoDaCategoria(key)]
                  const digitou = (parseFloat(String(receiveCats[key] ?? '').replace(',', '.')) || 0) > 0
                  // Categoria sem input (Honorários e DAS) só aparece quando vem PREENCHIDA
                  // de uma sessão que está sendo editada — esconder um valor gravado faria a
                  // reedição pagá-lo a menos. Ver RECEIVE_INPUTS.
                  const oculta = !RECEIVE_INPUTS.includes(key)
                  if (oculta && !digitou) return null
                  return (
                    <div key={key} className="flex flex-col gap-1">
                      <label className="text-xs text-gray-400 font-medium flex items-center gap-1.5">
                        {label} (R$)
                        {oculta && (
                          <span className="px-1.5 py-0.5 rounded-full text-[9px] uppercase tracking-wide bg-amber-500/15 text-amber-300/90"
                            title="Esta categoria é rateada por cliente e se paga na visão Cards. Aparece aqui porque a sessão que você está editando já a continha — zerar o campo remove o valor da sessão.">
                            de sessão anterior
                          </span>
                        )}
                        {/* O modo diz para onde o valor pode escorrer. Fica sempre visível
                            (não só ao digitar) porque a pergunta é feita ANTES de digitar:
                            "se eu puser 500 aqui, de onde sai?". */}
                        <span className={`px-1.5 py-0.5 rounded-full text-[9px] uppercase tracking-wide ${modo.cls} ${digitou ? '' : 'opacity-60'}`}
                          title={`Modo ${modo.label}: ${modo.ajuda}`}>{modo.label}</span>
                      </label>
                      <input type="number" placeholder="0" value={receiveCats[key]} onChange={e=>setReceiveCats(c=>({...c,[key]:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                    </div>
                  )
                })}
              </div>
              <div className="flex flex-col gap-1 text-[10px] leading-tight">
                <p className="text-orange-300/70">
                  <strong className="uppercase">imposto</strong> (Escritório, INSS) — consome a
                  própria linha e, se faltar, desce para Lucro → Serviço. <strong>Nunca toca a linha de outro
                  imposto.</strong>
                </p>
                {/* Sem esta frase, procurar Honorários/DAS aqui e não achar se lê como campo
                    que sumiu. Eles saíram porque este modal debita SALDO e não quita guia —
                    quem os paga pelo rateio é a visão Cards. */}
                <p className="text-gray-500">
                  <strong>Honorários e DAS não entram aqui</strong>: eles são rateados por cliente e
                  se pagam na visão <strong>🗂️ Cards</strong>, que consome a fatia de cada um e quita a
                  guia. Este modal debita o saldo dos lançamentos e não quita guia nenhuma.
                </p>
                <p className="text-blue-300/70">
                  <strong className="uppercase">trabalho</strong> (Pró-labore, Lucros, Demais despesas) — vai
                  direto para Lucro → Serviço. <strong>Nunca toca imposto nenhum.</strong>
                </p>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400 font-medium">Data do pagamento</label>
                <input type="date" value={receivePaidAt} onChange={e=>setReceivePaidAt(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
              </div>

              {/* VALORES DISTRIBUÍDOS — o que já saiu, por categoria.
                  ⚠️ Renderiza SEMPRE, inclusive vazia. A primeira versão se escondia quando
                  não havia histórico ("um bloco de R$ 0,00 é ruído"), e o resultado foi uma
                  investigação de bug: sem histórico a seção sumia, e some é indistinguível
                  de quebrada. Um empty-state de uma linha responde a pergunta. */}
              <div className="bg-green-500/5 border border-green-500/30 rounded-xl p-3">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  {/* "Valores pagos" e não "distribuídos": é o mesmo número que a spec
                      pediu num card separado, e dois cards com o mesmo valor lado a lado
                      leem como R$ 46. O que faltava era poder ABRIR e ESTORNAR — foi isso
                      que entrou aqui, em vez de um segundo card. */}
                  <p className="text-green-400/90 text-xs font-medium uppercase tracking-wider">Valores pagos</p>
                  <span className="text-xs text-gray-500">
                    Total <span className="text-green-400 font-mono font-semibold">{fmt(distribuidosTotal)}</span>
                  </span>
                </div>
                {distribuidosLista.length === 0 ? (
                  <p className="text-gray-500 text-[11px]">
                    Nenhum pagamento registrado nos lançamentos de{' '}
                    <span className="text-gray-400">{activeCompany.name}</span>. O que for pago
                    aqui aparece nesta lista, por categoria.
                  </p>
                ) : (
                  <>
                    <div className="space-y-0.5 font-mono text-[11px]">
                      {distribuidosLista.map(d => {
                        const aberto = !!pagosAberto[d.k]
                        return (
                          <div key={d.k}>
                            <button
                              type="button"
                              onClick={() => setPagosAberto(p => ({ ...p, [d.k]: !aberto }))}
                              className="w-full flex justify-between gap-2 text-left hover:bg-green-500/5 rounded px-1 -mx-1 py-0.5"
                            >
                              <span className="font-sans text-gray-400 min-w-0 truncate">
                                <span className="text-gray-600">{aberto ? '▼' : '▶'}</span>{' '}
                                <span className="text-green-500">✓</span> {d.label}
                                {d.data && <span className="text-gray-600"> · {d.data.split('-').reverse().join('/')}</span>}
                                {d.clientes.length > 0 && <span className="text-gray-600"> · {d.clientes.join(', ')}</span>}
                              </span>
                              <span className="text-green-400 shrink-0">−{fmt(d.valor)}</span>
                            </button>
                            {aberto && (
                              <div className="ml-3 mt-0.5 mb-1 pl-2 border-l border-gray-800 space-y-0.5">
                                {d.itens.map(it => (
                                  <div key={it.payment_id} className="flex items-center justify-between gap-2">
                                    <span className="font-sans text-gray-500 min-w-0 truncate flex items-center gap-1.5">
                                      <input
                                        type="checkbox"
                                        checked={!!pagosSel[it.payment_id]}
                                        onChange={e => setPagosSel(p => {
                                          const n = { ...p }
                                          if (e.target.checked) n[it.payment_id] = it
                                          else delete n[it.payment_id]
                                          return n
                                        })}
                                        className="accent-red-500 w-3 h-3 shrink-0 cursor-pointer"
                                      />
                                      <span className="min-w-0 truncate">
                                        {it.data ? it.data.split('-').reverse().join('/') : '—'} · {it.client_name}
                                        <span className="text-gray-700"> · {it.competencia}</span>
                                        {/* De onde o dinheiro saiu — o lucro absorve primeiro. */}
                                        <span className="text-gray-600"> · de {it.origem}</span>
                                      </span>
                                    </span>
                                    <span className="flex items-center gap-2 shrink-0">
                                      <span className="text-gray-300">{fmt(it.valor)}</span>
                                      <button
                                        type="button"
                                        onClick={() => { setEstornoAviso(''); setEstornoItens([it]) }}
                                        className="font-sans text-[10px] px-1.5 py-0.5 border border-red-500/40 text-red-400 hover:bg-red-500/10 rounded"
                                      >Estornar</button>
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    {/* Barra do lote. Aparece só com algo marcado — um botão permanente
                        dizendo "(0)" ocuparia espaço para não fazer nada. O contador é de
                        pagamentos DISTINTOS: marcar a mesma sessão em duas categorias
                        seleciona uma linha só. */}
                    {pagosSelLista.length > 0 && (
                      <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-green-500/20">
                        <span className="font-sans text-[11px] text-gray-400">
                          {pagosSelLista.length} pagamento{pagosSelLista.length > 1 ? 's' : ''} ·{' '}
                          <span className="font-mono text-red-400">{fmt(estornoTotal(pagosSelLista))}</span>
                          <button
                            type="button"
                            onClick={() => setPagosSel({})}
                            className="ml-2 text-[10px] text-gray-500 hover:text-gray-300 underline"
                          >limpar</button>
                        </span>
                        <button
                          type="button"
                          onClick={() => { setEstornoAviso(''); setEstornoItens(pagosSelLista) }}
                          className="font-sans text-[10px] px-2 py-1 bg-red-600/80 hover:bg-red-500 text-white rounded"
                        >Estornar selecionados ({pagosSelLista.length})</button>
                      </div>
                    )}
                    <p className="text-gray-600 text-[10px] mt-1.5 leading-tight">
                      Já consumido dos lançamentos listados abaixo — clique numa categoria para
                      ver os pagamentos, marcar vários e estornar de uma vez. A quebra por
                      categoria vem do histórico de cada pagamento; pagamento lançado sem
                      categoria aparece como &quot;sem categoria&quot;.
                    </p>
                  </>
                )}
                {/* O abatimento fiscal é revertido por MÊS, não por pagamento — estornar um
                    pode derrubar a distribuição inteira da competência. Calar sobre isso
                    faria sumir pagamentos que o usuário não mandou estornar. */}
                {estornoAviso && (
                  <p className="text-amber-400/90 text-[10px] mt-2 leading-tight border-t border-green-500/20 pt-1.5">
                    ⚠️ {estornoAviso}
                  </p>
                )}
              </div>

              {/* VALORES A DISTRIBUIR — o que a competência ainda deve, por categoria. */}
              <div className="bg-amber-500/5 border border-amber-500/30 rounded-xl p-3">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <p className="text-amber-400/90 text-xs font-medium uppercase tracking-wider">Valores a distribuir</p>
                  <span className="text-xs text-gray-500">
                    Total <span className="text-amber-400 font-mono font-semibold">{fmt(aDistribuirTotal)}</span>
                  </span>
                </div>
                <div className="space-y-0.5 font-mono text-[11px]">
                  {aDistribuir.map(d => (
                    <div key={d.k} className="flex justify-between gap-2">
                      <span className="font-sans text-gray-400 min-w-0 truncate">
                        {d.label}
                        {d.digitando > 0.005 && d.devido > 0.005 && (
                          <span className="text-gray-600"> · {fmt(d.digitando)} de {fmt(d.devido)} sendo digitado</span>
                        )}
                        {/* Alocado neste modal, guia ainda aberta — ver o cálculo de aDistribuir. */}
                        {d.alocadoSemQuitar > 0.005 && (
                          <span className="text-amber-400/70"> · {fmt(d.alocadoSemQuitar)} já alocado sem quitar a guia</span>
                        )}
                      </span>
                      <span className={`shrink-0 ${d.restante > 0.005 ? 'text-amber-400' : 'text-gray-600'}`}>
                        {fmt(d.restante)}
                      </span>
                    </div>
                  ))}
                </div>
                {aDistribuirSemQuitar.length > 0 && (
                  <p className="text-amber-400/80 text-[10px] mt-1.5 leading-tight">
                    ⚠️ {aDistribuirSemQuitar.map(d => d.label).join(', ')} aparece nas duas seções: o
                    valor já saiu do saldo do Victor, mas este modal não quita a guia — ela segue
                    devida em <strong>/fiscal</strong>, onde é registrada como abatimento.
                  </p>
                )}
                {Object.keys(reserves).length === 0 && (
                  <p className="text-gray-600 text-[10px] mt-1.5 leading-tight">
                    Sem apuração em {months[refMonth-1]}/{refYear} — nada a distribuir por
                    categoria. Apure em <strong>/fiscal</strong> para ver DAS, INSS e Escritório aqui.
                  </p>
                )}
              </div>

              {/* Distribuição do saldo — painel visual em tempo real.
                  O rateio por cliente saiu daqui: virou o breakdown da própria aba,
                  onde cada categoria é digitada no cliente a que pertence, em vez de
                  ser roteada por um checkbox. Este modal ficou sendo só o
                  ?action=pagar-distribuido (pool único) do Flow B e da edição de sessão. */}
              <div className="bg-gray-950/60 border border-gray-800 rounded-xl p-3">
                <p className="text-gray-300 text-xs font-medium uppercase tracking-wider">Distribuição do saldo</p>
                {/* ⚠️ Este painel IGNORA o filtro de mês da tela, e tem de ignorar: o pool
                    é consumido do mês mais antigo para o mais novo, e candidatosDisponiveis()
                    no backend também não filtra por competência — só pelo teto de caixa.
                    Recortar a prévia por mês a faria mostrar menos do que a gravação
                    consome, que é a versão em espelho do bug do "Receber gravava zero".
                    Sem esta frase, ver fev listado com o filtro em jan parece o filtro
                    tendo falhado (foi a leitura do Bokada #42/#44). */}
                <p className="text-gray-600 text-[10px] mb-2 leading-tight">
                  Todas as competências em aberto até {months[effRefMonth-1]}/{effRefYear}, da mais
                  antiga para a mais nova — não só o mês do filtro. É a ordem em que o pagamento
                  consome os saldos.
                  {/* Sem esta frase, "Serviço caiu 51,43" ao lado de "Saldo caiu 150" parece
                      erro de conta. São duas leituras: o cabeçalho é o saldo do lançamento
                      (o que o backend debita), a tabela é a alocação por categoria (o que
                      fica registrado no histórico do pagamento). ⚠️ Pagar aqui NÃO quita a
                      guia — isso é na /fiscal ou pela visão Cards da aba. */}
                  {' '}Na tabela, cada valor digitado abate primeiro a linha da própria categoria e
                  desce para Lucro → Serviço; o cabeçalho mostra o saldo do lançamento, que é o
                  que sai do caixa. Pagar aqui não quita a guia — isso é em <strong>/fiscal</strong>.
                </p>
                {(quitadosOcultos.length > 0 || quitadosComImposto.length > 0) && (
                  <div className="mb-2">
                    {quitadosOcultos.length > 0 && (
                      <p className="text-gray-600 text-[10px] leading-tight">
                        {quitadosOcultos.length === 1 ? '1 lançamento já quitado não aparece' : `${quitadosOcultos.length} lançamentos já quitados não aparecem`}
                        {' '}({quitadosOcultos.slice(0, 3).map(r => `${r.client_name} ${months[r.month-1]}/${r.year}`).join(', ')}
                        {quitadosOcultos.length > 3 ? ` +${quitadosOcultos.length - 3}` : ''}) — não têm saldo nem imposto a consumir.
                        O histórico deles continua em &quot;Valores pagos&quot;, com estorno.
                      </p>
                    )}
                    {/* ⚠️ Estes CONTINUAM na tabela, e é a correção de 2026-08-15: o
                        lançamento está quitado, mas a cascata do IMPOSTO alcança o rateio
                        dele — o backend consome Pharmalog 139,11 + Bokada 10,89 ao pagar
                        "Honorários 150", e a tela mostrava só o Bokada. Esconder a maior das
                        duas parcelas era a prévia divergindo da gravação. */}
                    {quitadosComImposto.length > 0 && (
                      <p className="text-amber-400/80 text-[10px] leading-tight mt-1">
                        ⚠️ {quitadosComImposto.map(r => `${r.client_name} ${months[r.month-1]}/${r.year} (${fmt(r.impostoAberto)})`).join(', ')}
                        {' '}{quitadosComImposto.length === 1 ? 'está quitado' : 'estão quitados'}, mas
                        {quitadosComImposto.length === 1 ? ' segue' : ' seguem'} na lista pelo imposto em
                        aberto: o rateio é devido ao fisco e a cascata de imposto o alcança sem
                        precisar de saldo. As linhas de Lucro e Serviço {quitadosComImposto.length === 1 ? 'dele' : 'deles'} aparecem
                        zeradas — não há mais o que consumir ali.
                      </p>
                    )}
                  </div>
                )}
                {distRows.length === 0 ? (
                  <p className="text-gray-600 text-xs text-center py-2">Nenhum saldo pendente</p>
                ) : (
                  <div className="space-y-2">
                    {distRows.map(d => (
                      <div key={d.id} className="border-b border-gray-800/60 last:border-0 pb-2 last:pb-0">
                        {/* Cabeçalho: o saldo consumido pelo pagamento — a razão de ser
                            do painel. A árvore abaixo diz de QUE esse saldo é feito. */}
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className={`truncate ${d.state === 'zero' ? 'text-gray-600' : 'text-gray-300'}`}>
                            <span className="text-gray-500">{months[d.month-1]}/{d.year}</span> {d.client_name}
                            {d.semNf && (
                              <span className="ml-1.5 px-1.5 py-0.5 bg-gray-700 text-gray-400 text-[10px] rounded-full font-sans">
                                sem NF · consumido por último
                              </span>
                            )}
                            {/* Lançamento quitado que segue na lista pelo imposto. Sem a
                                etiqueta, "Saldo 0,00" ao lado de linhas fiscais com valor
                                se lê como erro — é o oposto: são justamente elas que a
                                cascata do imposto vai consumir. */}
                            {d.saldo <= 0.005 && d.imposto.sobra > 0.005 && (
                              <span className="ml-1.5 px-1.5 py-0.5 bg-amber-500/15 text-amber-300/90 text-[10px] rounded-full font-sans">
                                quitado · só imposto
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 font-mono text-right whitespace-nowrap">
                            <span className="text-gray-500">Saldo: {fmt(d.saldo)}</span>
                            {/* De onde o saldo saiu. Sem isto, um lançamento com pagamento
                                anterior parece simplesmente menor, e a cascata parece ter
                                parado no meio dele. */}
                            {d.jaPago > 0.005 && (
                              <span className="text-gray-600 text-[10px]"
                                title="Total devido do lançamento menos o que já foi pago em sessões anteriores. A cascata consome o SALDO, não o total.">
                                {' '}(de {fmt(d.total)} · {fmt(d.jaPago)} já pago)
                              </span>
                            )}
                            <span className="text-gray-600"> → </span>
                            <span className={
                              d.state === 'zero' ? 'text-gray-600 line-through'
                              : d.state === 'partial' ? 'text-yellow-400'
                              : 'text-green-400'
                            }>Líquido: {fmt(d.liquido)}</span>
                            {/* ⚠️ "Líquido 0,00" num lançamento que ainda carrega imposto se
                                lê como se a linha tivesse sumido do nada — e o SUB logo
                                abaixo mostra justamente o valor do imposto, o que convida a
                                somar os dois. O imposto vem AQUI, rotulado e com o sinal
                                oposto explícito: ele é devido ao fisco, não ao Victor. */}
                            {d.imposto.sobra > 0.005 && (
                              <span className="text-amber-400/80" title="Imposto rateado desta nota, devido ao FISCO — não é saldo do Victor. Este modal não quita guia: para isso use a visão Cards ou /fiscal.">
                                {' · '}imposto: {fmt(d.imposto.sobra)}
                              </span>
                            )}
                          </span>
                        </div>

                        {/* Tabela CATEGORIA | BRUTO | LÍQUIDO. As 5 primeiras absorvem o
                            que é digitado, em cascata; SUB é a soma delas e FAB é estática
                            e sem líquido (sai da FATURA e é paga na aba do Fabrício).
                            Linha zerada é pulada pela cascata — ver alocarCascataDist(). */}
                        {/* 5 colunas de ESTADO (original → absorveu → bruto → pagos →
                            líquido) e 3 de SIMULAÇÃO do que está sendo digitado
                            (digitado → será pago → sobra). Rola na horizontal: não cabem
                            9 colunas na largura do modal em tela estreita, e espremer faria
                            os valores quebrarem linha. */}
                        <div className="mt-1.5 overflow-x-auto">
                        <table className="w-full min-w-[46rem] font-mono text-[11px]">
                          <thead>
                            <tr className="text-[9px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
                              <th className="text-left font-medium font-sans pb-0.5 pr-2">Categoria</th>
                              <th className="text-right font-medium font-sans pb-0.5 px-1">Original</th>
                              <th className="text-right font-medium font-sans pb-0.5 px-1">Absorveu</th>
                              <th className="text-right font-medium font-sans pb-0.5 px-1">Ajust. bruto</th>
                              <th className="text-right font-medium font-sans pb-0.5 px-1">Pagos</th>
                              <th className="text-right font-medium font-sans pb-0.5 px-1 text-green-500/70">Líquido</th>
                              <th className="text-right font-medium font-sans pb-0.5 px-1 bg-blue-500/10 text-blue-300/80">Digitado</th>
                              <th className="text-right font-medium font-sans pb-0.5 px-1 bg-orange-500/10 text-orange-300/80">Será pago</th>
                              <th className="text-right font-medium font-sans pb-0.5 pl-1 bg-green-500/10 text-green-300/80">Sobra</th>
                            </tr>
                          </thead>
                          <tbody>
                            {DIST_LINHAS.map(cat => {
                              const c = d.cats[cat]
                              // LÍQUIDO da coluna 5 é o de ANTES da alocação; a SOBRA é o
                              // que resta depois. Somar `absorvido` de volta é o que separa
                              // as duas — senão a simulação não teria de onde sair.
                              const liquidoAntes = cents(c.liquido + c.absorvido)
                              const zerou = c.bruto > 0.005 && c.liquido <= 0.005
                              const opt = (v, cls = 'text-gray-500') => v > 0.005
                                ? <span className={cls}>{fmt(v)}</span>
                                : <span className="text-gray-700">—</span>
                              return (
                                <tr key={cat} className="border-b border-gray-800/40">
                                  <td className="font-sans text-gray-500 py-px pr-2 whitespace-nowrap">
                                    {DIST_LINHA_LABEL[cat]}
                                    {c.percentual != null && (
                                      <span className="text-gray-700"> ({c.percentual.toFixed(2)}%)</span>
                                    )}
                                    {/* ⚠️ ABSORVEU é o que a cascata FISCAL levou, não o que este
                                        pagamento vai consumir — e a linha do Lucro quase sempre
                                        aparece com ORIGINAL cheio e LÍQUIDO zero, o que se lê como
                                        "tem 979,63 disponível". Foi essa leitura que gerou a conta
                                        "979,63 + 7.920,37 = 8.900". Dizer em palavras, na própria
                                        linha, é o único lugar onde a confusão não passa. */}
                                    {c.absorveu > 0.005 && c.bruto <= 0.005 && (
                                      <span className="text-red-400/70"> · imposto absorveu tudo, nada a consumir</span>
                                    )}
                                    {c.absorveu > 0.005 && c.bruto > 0.005 && (
                                      <span className="text-red-400/60"> · imposto levou {fmt(c.absorveu)}</span>
                                    )}
                                  </td>
                                  <td className="text-right text-gray-500 py-px px-1">{fmt(c.original)}</td>
                                  {/* O lucro zerado por cascata não é "cliente sem lucro": o
                                      imposto o superou e o serviço cobriu a diferença. */}
                                  <td className="text-right py-px px-1">{opt(c.absorveu, 'text-red-400/80')}</td>
                                  <td className="text-right text-gray-400 py-px px-1">{fmt(c.bruto)}</td>
                                  <td className="text-right py-px px-1">{opt(c.pagos, 'text-orange-400/80')}</td>
                                  <td className={`text-right py-px px-1 ${zerou ? 'text-gray-600' : 'text-green-400'}`}>{fmt(liquidoAntes)}</td>
                                  <td className="text-right py-px px-1 bg-blue-500/5">{opt(c.direcionado, 'text-blue-300')}</td>
                                  <td className="text-right py-px px-1 bg-orange-500/5">{opt(c.absorvido, 'text-orange-300')}</td>
                                  <td className={`text-right py-px pl-1 bg-green-500/5 ${c.absorvido > 0.005 ? 'text-white font-semibold' : 'text-gray-300'}`}>{fmt(c.liquido)}</td>
                                </tr>
                              )
                            })}
                            {/* Separador entre as 5 trabalháveis e as 2 informativas. */}
                            <tr className="font-semibold">
                              <td className="font-sans text-gray-400 border-t-2 border-gray-700 pt-0.5 pr-2">SUB</td>
                              <td className="text-right text-gray-400 border-t-2 border-gray-700 pt-0.5 px-1">{fmt(d.sub.original)}</td>
                              <td className="text-right text-red-400/80 border-t-2 border-gray-700 pt-0.5 px-1">{d.sub.absorveu > 0.005 ? fmt(d.sub.absorveu) : '—'}</td>
                              <td className="text-right text-gray-400 border-t-2 border-gray-700 pt-0.5 px-1">{fmt(d.sub.bruto)}</td>
                              <td className="text-right text-orange-400/80 border-t-2 border-gray-700 pt-0.5 px-1">{d.sub.pagos > 0.005 ? fmt(d.sub.pagos) : '—'}</td>
                              <td className="text-right text-green-400 border-t-2 border-gray-700 pt-0.5 px-1">{fmt(d.sub.liquido)}</td>
                              <td className="text-right text-blue-300 border-t-2 border-gray-700 pt-0.5 px-1 bg-blue-500/5">{d.sub.direcionado > 0.005 ? fmt(d.sub.direcionado) : '—'}</td>
                              <td className="text-right text-orange-300 border-t-2 border-gray-700 pt-0.5 px-1 bg-orange-500/5">{d.sub.absorvido > 0.005 ? fmt(d.sub.absorvido) : '—'}</td>
                              <td className="text-right text-white border-t-2 border-gray-700 pt-0.5 pl-1 bg-green-500/5">{fmt(d.sub.sobra)}</td>
                            </tr>
                            {/* O SUB acima soma dois sinais opostos. Estas duas linhas dizem
                                quanto dele é de cada lado — e é na SOBRA de "= imposto" que
                                mora o valor que sobra num lançamento já quitado. */}
                            {[
                              { key: 'receber', label: '= a receber', hint: 'lucro + serviço · o que este pagamento consome', cls: 'text-green-300' },
                              // ⚠️ O hint não diz "não é consumido": digitar Escritório/DAS/INSS
                              // aqui REDUZ esta linha na simulação. O que não acontece é a guia
                              // ser quitada — o ?action=pagar-distribuido não grava
                              // fiscal_payments. É a mesma ressalva de `aDistribuirSemQuitar`.
                              { key: 'imposto', label: '= imposto', hint: 'devido ao fisco · este modal não quita guia', cls: 'text-amber-300' },
                            ].map(({ key, label, hint, cls }) => {
                              const t = d[key]
                              const opt2 = (v) => (v > 0.005 ? fmt(v) : '—')
                              return (
                                <tr key={key} className="text-[10px]">
                                  <td className={`font-sans py-px pr-2 whitespace-nowrap ${cls}`}>
                                    {label}<span className="text-gray-700"> · {hint}</span>
                                  </td>
                                  <td className="text-right text-gray-600 py-px px-1">{opt2(t.original)}</td>
                                  <td className="text-right text-gray-600 py-px px-1">{opt2(t.absorveu)}</td>
                                  <td className="text-right text-gray-500 py-px px-1">{opt2(t.bruto)}</td>
                                  <td className="text-right text-gray-600 py-px px-1">{opt2(t.pagos)}</td>
                                  <td className="text-right text-gray-500 py-px px-1">{opt2(t.liquido)}</td>
                                  <td className="text-right text-gray-600 py-px px-1 bg-blue-500/5">{opt2(t.direcionado)}</td>
                                  <td className="text-right text-gray-600 py-px px-1 bg-orange-500/5">{opt2(t.absorvido)}</td>
                                  <td className={`text-right py-px pl-1 bg-green-500/5 font-semibold ${cls}`}>{fmt(t.sobra)}</td>
                                </tr>
                              )
                            })}
                            {d.fabricio != null && (
                              <tr>
                                <td className="font-sans text-gray-600 py-px pr-2">FAB</td>
                                <td className="text-right text-gray-600 py-px px-1">{fmt(d.fabricio)}</td>
                                <td colSpan={7} className="text-right text-gray-700 py-px text-[10px] font-sans">sai da nota · pago na aba Pagar Fab</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                        </div>
                        {/* ⚠️ O SUB de ORIGINAL conta o imposto duas vezes por construção: o
                            "original" do Lucro é o lucro BRUTO, de onde o imposto ainda ia
                            sair, e as três linhas fiscais o listam de novo. A coluna que
                            fecha com a nota é AJUST. BRUTO. Dizer isso evita a leitura de
                            que a decomposição está estourada em ~R$ 1.000. */}
                        <p className="text-gray-700 text-[10px] mt-1 leading-tight">
                            <strong>Original</strong> e <strong>Absorveu</strong> descrevem o que a
                            cascata FISCAL já fez — não o pagamento que está sendo digitado. Só
                            <strong> Líquido</strong> é consumível, e o que este pagamento leva está
                            em <strong>Será pago</strong>.{' '}
                            O SUB de <strong>Original</strong> soma o lucro bruto e o imposto que
                            saiu dele — a coluna que fecha com a nota é <strong>Ajust. bruto</strong>.{' '}
                            E o <strong>SUB soma dois sinais opostos</strong>: o que a empresa deve
                            ao Victor e o que deve ao fisco. As duas linhas abaixo dele separam —
                            só <strong>= a receber</strong> é consumível; <strong>= imposto</strong>{' '}
                            fica devido e se quita em /fiscal ou pela visão Cards.
                            Pró-labore, Lucros e Demais despesas não têm linha própria: aparecem
                            em <strong>Digitado</strong> no Lucro, que é onde a cascata delas
                            começa, e escorrem para o Serviço.
                        </p>
                        {Math.abs(d.aRedistribuir) > 0.005 && (
                          <p className="text-amber-400/80 text-[10px] leading-tight pt-1">
                            ⚠️ As três linhas fiscais são o imposto REAL, mas o lançamento ainda
                            carrega a provisão de 7%: {fmt(d.aRedistribuir)} não foi
                            redistribuído, então o SUB está alto nesse valor. Aplicar em /fiscal.
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {distOverflow > 0 && (
                  <p className="text-red-400 text-xs mt-2">⚠️ Valor excede o saldo disponível em {fmt(distOverflow)}</p>
                )}
                {/* Distinto do overflow acima: ali o POOL passou do saldo dos lançamentos;
                    aqui o valor coube no pool, mas passou do que AQUELA categoria alcança —
                    a própria linha, mais Lucro e Serviço. DAS e INSS não são alcançados por
                    um pagamento de Escritório, então não entram na capacidade dele. Sem este
                    aviso, digitar sobre um mês já quitado não muda nada e parece travamento. */}
                {/* Nomeia QUEM sobrou e por qual regra. "R$ X não coube" sem dizer de que
                    categoria manda o usuário conferir as sete à mão. */}
                {distSobraCategoria > 0.005 && distOverflow <= 0.005 && (
                  <div className="text-amber-400/80 text-[11px] mt-2 space-y-0.5">
                    {Object.entries(distSobras).filter(([, v]) => v > 0.005).map(([cat, v]) => {
                      const rotulo = (RECEIVE_VICTOR_CATEGORIES.find(([k]) => k === cat) || [cat, cat])[1]
                      return (
                        <p key={cat}>
                          ⚠️ Sobraram <strong>{fmt(v)}</strong> de {rotulo}: {modoDaCategoria(cat) === 'imposto'
                            ? 'o valor passou da linha desse imposto e do Lucro/Serviço disponível. Não abate a linha de outro imposto.'
                            : 'o valor passou do Lucro/Serviço disponível. Categoria de trabalho não abate imposto.'}
                        </p>
                      )
                    })}
                  </div>
                )}
                {foraDoTeto.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-gray-800">
                    <p className="text-gray-500 text-[11px] mb-1">
                      {foraDoTeto.length === 1 ? '1 lançamento ficou' : `${foraDoTeto.length} lançamentos ficaram`} de fora: o caixa deles é posterior a {months[effRefMonth-1]}/{effRefYear} (data deste pagamento). Ajuste a data para alcançá-los.
                    </p>
                    {foraDoTeto.map(r => (
                      <div key={r.id} className="flex items-center justify-between gap-2 text-[11px] text-gray-600">
                        <span className="truncate">{months[r.month-1]}/{r.year} {r.client_name} <span className="text-gray-700">· caixa {months[r.pm-1]}/{r.py}</span></span>
                        <span className="shrink-0 font-mono">{fmt(r.saldo)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Detalhamento por categoria (Por cliente / Geral) — só na edição de sessão */}
              {editSession && breakdownPanel(editEntries)}

              {/* Saldo disponível considerando as reservas do mês */}
              <div className="border-t border-gray-800 pt-3 space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-gray-400">Saldo disponível bruto</span><span className="text-white">{fmt(saldoDisponivelBruto)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">(-) Reservas</span><span className="text-orange-400">-{fmt(reservesTotal)}</span></div>
                <div className="flex justify-between font-semibold"><span className="text-gray-300">= Disponível para distribuir</span><span className="text-green-400">{fmt(disponivelParaDistribuir)}</span></div>
                {reservesExceedSaldo && (
                  <p className="text-red-400 text-xs pt-1">⚠️ Reservas excedem o saldo disponível</p>
                )}
                {!reservesExceedSaldo && receiveExcedeDisponivel && (
                  <p className="text-red-400 text-xs pt-1">⚠️ Total a distribuir excede o disponível (após reservas) em {fmt(receiveTotal - disponivelParaDistribuir)}</p>
                )}
              </div>

              <p className="text-sm text-gray-300 border-t border-gray-800 pt-3">Total a distribuir: <span className="text-green-400 font-bold">{fmt(receiveTotal)}</span></p>
            </div>

            {erroReceive && (
              <p className="mt-3 text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{erroReceive}</p>
            )}

            {/* Flow B — painel de decisão da sobra (overflow) */}
            {overflowInfo ? (
              <div className="mt-5 bg-amber-500/10 border border-amber-500/40 rounded-xl p-4">
                <p className="text-amber-300 text-sm font-medium mb-1">Sobra após preencher o registro</p>
                <p className="text-gray-300 text-xs mb-4">O registro alvo recebeu {fmt(overflowInfo.targetSaldo)}. Ainda restam <span className="text-amber-300 font-bold">{fmt(overflowInfo.overflow)}</span> a distribuir. O que deseja fazer?</p>
                {!showMesAnterior ? (
                  <div className="space-y-2">
                    <button onClick={() => resolveOverflow('pharma')} disabled={receiving} className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium">Completar com Pharmalog</button>
                    <button onClick={() => resolveOverflow('demais')} disabled={receiving} className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium">Completar com demais clientes</button>
                    <button onClick={() => setShowMesAnterior(true)} disabled={receiving} className="w-full py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-200 rounded-lg text-sm font-medium">Ir para mês anterior</button>
                    <button onClick={() => resolveOverflow('nada')} disabled={receiving} className="w-full py-2 border border-gray-700 text-gray-400 hover:bg-gray-800 disabled:opacity-50 rounded-lg text-sm">Não fazer nada</button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-gray-400 text-xs">Escolha o registro de mês anterior para continuar:</p>
                    {prevMonthsWithBalance.length === 0 ? (
                      <p className="text-gray-600 text-xs text-center py-2">Nenhum saldo em meses anteriores</p>
                    ) : prevMonthsWithBalance.map(r => (
                      <button key={r.id} onClick={() => resolveOverflow('mes', r.id)} disabled={receiving} className="w-full flex items-center justify-between gap-2 py-2 px-3 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 rounded-lg text-xs">
                        <span className="text-gray-200 truncate"><span className="text-gray-500">{months[r.month-1]}/{r.year}</span> {r.client_name}</span>
                        <span className="text-green-400 font-mono shrink-0">{fmt(r.saldo)}</span>
                      </button>
                    ))}
                    <button onClick={() => setShowMesAnterior(false)} disabled={receiving} className="w-full py-2 border border-gray-700 text-gray-400 hover:bg-gray-800 disabled:opacity-50 rounded-lg text-xs">Voltar</button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex gap-3 mt-5">
                <button onClick={closeReceive} disabled={receiving} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm disabled:opacity-50">Cancelar</button>
                <button onClick={confirmReceive} disabled={receiving || receiveTotal <= 0 || !receivePaidAt} className="flex-1 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium">{receiving ? (editSession ? 'Salvando...' : 'Distribuindo...') : (editSession ? 'Salvar edição' : 'Confirmar')}</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
