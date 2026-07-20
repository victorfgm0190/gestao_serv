import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { todayBR } from '../lib/dateUtils'
import CopyButton from '../components/CopyButton'

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
const receiveCategoryTotal = (cats) => RECEIVE_VICTOR_CATEGORIES.reduce((s, [k]) => s + (parseFloat(cats[k]) || 0), 0)
const RECEIVE_LABEL_TO_KEY = Object.fromEntries(RECEIVE_VICTOR_CATEGORIES.map(([k, label]) => [label, k]))
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
  const [filterYear, setFilterYear] = useState(new Date().getFullYear())
  const [histType, setHistType] = useState('receivables')
  const [histClient, setHistClient] = useState('')
  const [form, setForm] = useState({ client_id: '', month: new Date().getMonth() + 1, year: new Date().getFullYear(), description: '', amount: '', service_amount: '', profit_amount: '', notes: '' })
  const [payForm, setPayForm] = useState({ paid_amount: '', paid_at: todayBR(), payment_method: '', is_compensation: false, compensation_notes: '', notes: '', status: 'pago' })
  const [modalPayments, setModalPayments] = useState([])
  const [newPay, setNewPay] = useState({ amount: '', paid_at: todayBR(), notes: '' })
  const [estornoConfirm, setEstornoConfirm] = useState(null)
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth() + 1)
  const [filterStatus, setFilterStatus] = useState('all')
  const [mode, setMode] = useState('competencia') // 'competencia' (mês do faturamento) | 'caixa' (mês do recebimento)
  const [victorCats, setVictorCats] = useState(EMPTY_VICTOR_CATS)
  const [showReceiveModal, setShowReceiveModal] = useState(false)
  const [receiveCats, setReceiveCats] = useState(EMPTY_RECEIVE_CATS)
  const [receivePaidAt, setReceivePaidAt] = useState(todayBR())
  const [editSession, setEditSession] = useState(null) // { paid_at, notes, affected[] } quando editando uma sessão
  const [reserves, setReserves] = useState({ das: '', pro_labore: '', inss: '', escritorio: '', notes: '' })
  const [savingReserves, setSavingReserves] = useState(false)
  const [breakdownView, setBreakdownView] = useState('geral') // 'geral' | 'cliente' — detalhamento de categorias
  const [receiving, setReceiving] = useState(false)
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
    setErroModal(''); setErroPay(''); setErroPayments(''); setErroReceive('')
  }, [activeCompany])
  // Reservas do Victor exibidas no card da aba (mês/ano/empresa do filtro ativo).
  useEffect(() => { if (tab === 'victor') fetchReserves() }, [tab, filterMonth, filterYear, activeCompany])

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
      fetchAll()
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
      setPayForm({ paid_amount: '', paid_at: todayBR(), payment_method: '', is_compensation: false, compensation_notes: '', notes: '', status: 'pago' })
      fetchAll()
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
      fetchAll()
    } catch {
      setErroPayments('Erro de conexão com o servidor.')
    } finally {
      setAddingPay(false)
    }
  }

  async function fetchPendingVictor() {
    try {
      // No modo caixa, restringe a lista de distribuição ao mês/ano de caixa do filtro ativo.
      const params = new URLSearchParams({ status: 'pendente,parcial', company_id: activeCompany.id, year: filterYear, mode })
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
  async function fetchReserves() {
    const { rm, ry } = reserveRefPeriod()
    try {
      const res = await fetch(`/api/victor-reserves?company_id=${activeCompany.id}&month=${rm}&year=${ry}`)
      const d = (await res.json()).data || {}
      const s = (v) => parseFloat(v) ? String(parseFloat(v)) : ''
      setReserves({ das: s(d.das), pro_labore: s(d.pro_labore), inss: s(d.inss), escritorio: s(d.escritorio), notes: d.notes || '' })
    } catch (e) { console.error(e) }
  }
  async function saveReserves() {
    const { rm, ry } = reserveRefPeriod()
    setSavingReserves(true)
    try {
      await fetch('/api/victor-reserves', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: activeCompany.id, month: rm, year: ry,
          das: parseFloat(reserves.das) || 0, pro_labore: parseFloat(reserves.pro_labore) || 0,
          inss: parseFloat(reserves.inss) || 0, escritorio: parseFloat(reserves.escritorio) || 0,
          notes: reserves.notes || null,
        }),
      })
    } catch (e) { console.error(e) } finally { setSavingReserves(false) }
  }

  // Flow A — Pagar Geral (não vinculado a um registro específico)
  async function openReceive() {
    setReceiveCats(EMPTY_RECEIVE_CATS)
    setReceivePaidAt(todayBR())
    setPendingVictor([])
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
      await fetchAll()
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
      await fetchAll()
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
      fetchAll()
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
    fetchAll()
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
    fetchAll()
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
    fetchAll()
  }

  const fmt = (v) => v != null ? `R$ ${parseFloat(v).toFixed(2).replace('.', ',')}` : '-'
  // Mês/ano efetivos conforme a visão: caixa usa payment_month/year; competência usa month/year.
  const effMonth = (r) => mode === 'caixa' ? (r.payment_month ?? r.month) : r.month
  const effYear = (r) => mode === 'caixa' ? (r.payment_year ?? r.year) : r.year
  const isPreview = (r) => r.is_preview === true
  const isPayTab = tab === 'victor' || tab === 'fabricio'
  const baseData = tab === 'receivables' ? receivables : tab === 'fabricio' ? payablesFab : payablesVictor
  const monthFiltered = filterMonth === ''
    ? baseData
    : baseData.filter(r => Number(effMonth(r)) === Number(filterMonth))
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
  // Disponível = manual (sem recebível) ou recebível do cliente já pago/parcial. Pendente = aguardando.
  const isAvailable = (r) => !r.receivable_status || r.receivable_status === 'pago' || r.receivable_status === 'parcial'
  const availableData = isPayTab ? currentData.filter(isAvailable) : currentData
  const waitingData = isPayTab ? currentData.filter(r => !isAvailable(r)) : []
  const previewTotal = previewData.reduce((s, r) => s + (parseFloat(r.amount || r.total_amount) || 0), 0)
  const victorCatTotal = victorCategoryTotal(victorCats)
  const receiveTotal = receiveCategoryTotal(receiveCats)

  // Painel "Distribuição do saldo" (somente visual) — consome receiveTotal em tempo real.
  // Mês de referência = filtro ativo da tela (não o mês do calendário). "Todos" cai no mês atual.
  const refMonth = filterMonth === '' ? (new Date().getMonth() + 1) : Number(filterMonth)
  const refYear = Number(filterYear) || new Date().getFullYear()
  const REF_KEY = refYear * 100 + refMonth
  // Chave de CAIXA do registro (payment_month/year, com fallback na competência).
  const payKey = (r) => (Number(r.payment_year) || r.year) * 100 + (Number(r.payment_month) || r.month)
  // Na edição, a referência precisa cobrir o mês de CAIXA mais recente entre os payables da sessão
  // (senão algum registro restaurado ficaria fora da redistribuição).
  const effectiveRefKey = editSession && editSession.affected.length
    ? Math.max(REF_KEY, ...editSession.affected.map(a => payKey(a)))
    : REF_KEY
  const effRefMonth = effectiveRefKey % 100
  const effRefYear = Math.floor(effectiveRefKey / 100)
  const saldoOf = (r) => Math.round(((parseFloat(r.total_amount) || 0) - (parseFloat(r.paid_amount) || 0)) * 100) / 100
  // Fonte da distribuição: só payables disponíveis (recebível do cliente pago/parcial ou manual).
  // No modo edição, restaura os saldos consumidos pela sessão que será estornada.
  const distSource = (() => {
    const availablePending = pendingVictor.filter(isAvailable)
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
  const sortedPending = [...distSource]
    .filter(r => saldoOf(r) > 0)
    .filter(r => payKey(r) <= effectiveRefKey)  // nunca consome mês de CAIXA futuro ao período ativo
    .sort((a, b) => {
      // Idêntico ao backend (ordenar): competência ASC — mês mais antigo primeiro.
      const ka = a.year * 100 + a.month, kb = b.year * 100 + b.month
      if (ka !== kb) return ka - kb          // competência ASC (mais antigo primeiro)
      if (a.client_id === 7 && b.client_id !== 7) return -1  // Pharmalog/ANB primeiro
      if (b.client_id === 7 && a.client_id !== 7) return 1
      return saldoOf(b) - saldoOf(a)         // restante por saldo desc
    })
  // Flow B: no específico o alvo é consumido primeiro
  const orderedPending = receiveTarget
    ? [...sortedPending.filter(r => r.id === receiveTarget.id), ...sortedPending.filter(r => r.id !== receiveTarget.id)]
    : sortedPending
  // Meses anteriores com saldo (para o sub-painel "Ir para mês anterior")
  const prevMonthsWithBalance = sortedPending
    .filter(r => payKey(r) < effectiveRefKey && (!receiveTarget || r.id !== receiveTarget.id))
    .map(r => ({ id: r.id, client_name: r.client_name, month: r.month, year: r.year, saldo: saldoOf(r) }))
  let distPool = Math.round(receiveTotal * 100) / 100
  const distRows = orderedPending.map(r => {
    const saldo = saldoOf(r)
    const consumed = Math.min(distPool, saldo)
    const liquido = Math.round((saldo - consumed) * 100) / 100
    distPool = Math.round((distPool - consumed) * 100) / 100
    const state = consumed <= 0 ? 'full' : liquido <= 0 ? 'zero' : 'partial'
    return { id: r.id, month: r.month, year: r.year, client_name: r.client_name, saldo, liquido, state }
  })
  const distOverflow = distPool > 0.005 ? distPool : 0

  // Reservas do mês (ficam no caixa) e saldo disponível para distribuir.
  const reservesTotal = ['das', 'pro_labore', 'inss', 'escritorio'].reduce((s, k) => s + (parseFloat(reserves[k]) || 0), 0)
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
                {(item.status === 'pago' || item.status === 'parcial') && (
                  <button onClick={() => estornarPayable(item)} className="px-3 py-1 border border-red-500/60 text-red-400 hover:bg-red-500/10 rounded-lg text-xs">↩ Estornar</button>
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

      {/* Toggle Competência x Caixa */}
      <div className="flex gap-2 mb-4 items-center">
        <span className="text-gray-500 text-xs uppercase tracking-wider mr-1">Visão:</span>
        <div className="flex gap-1 bg-gray-900 p-1 rounded-xl w-fit">
          <button onClick={() => setMode('competencia')} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${mode === 'competencia' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>Competência</button>
          <button onClick={() => setMode('caixa')} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${mode === 'caixa' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>Caixa</button>
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
            title={`DAS: ${fmt(reserves.das||0)} | Pro Labore: ${fmt(reserves.pro_labore||0)} | INSS: ${fmt(reserves.inss||0)} | Escritório: ${fmt(reserves.escritorio||0)}`}
            className="text-left bg-gray-900 border border-amber-500/30 rounded-xl p-4 hover:border-amber-500/60 transition-colors"
          >
            <p className="text-gray-400 text-xs mb-1">🏦 Reservas do mês</p>
            <p className={`text-lg font-bold ${reservesTotal > 0 ? 'text-orange-400' : 'text-gray-500'}`}>{fmt(reservesTotal)}</p>
            {reservesTotal > 0 ? (
              <p className="text-gray-500 text-[11px] mt-1 leading-tight">DAS: {fmt(reserves.das||0)} | Pro Labore: {fmt(reserves.pro_labore||0)} | INSS: {fmt(reserves.inss||0)} | Escritório: {fmt(reserves.escritorio||0)}</p>
            ) : (
              <p className="text-gray-600 text-[11px] mt-1">Não configurado</p>
            )}
          </button>
        )}
      </div>
        )
      })()}

      <p className="text-gray-500 text-xs mb-4 -mt-2">
        {mode === 'caixa' ? 'Visualizando por caixa (mês do recebimento)' : 'Visualizando por competência (mês do faturamento)'}
      </p>

      {(tab === 'victor' || tab === 'fabricio') && (
        <div className="flex gap-2 items-center mb-4 flex-wrap">
          {statusFilter}
          {tab === 'victor' && (
            <button onClick={openReceive} className="ml-auto px-4 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium">Receber</button>
          )}
        </div>
      )}

      {tab === 'receivables' && (
        <div className="mb-4">{statusFilter}</div>
      )}

      {loading ? <div className="text-gray-500 text-sm">Carregando...</div> : (currentData.length === 0 && previewData.length === 0) ? (
        <div className="text-center py-16 text-gray-600"><p className="text-4xl mb-3">📂</p><p>Nenhum registro encontrado.</p></div>
      ) : (
        <div className="space-y-6">
          {availableData.length > 0 && (
            <div className="space-y-3">
              {isPayTab && (waitingData.length > 0 || previewData.length > 0) && (
                <p className="text-xs font-medium uppercase tracking-wider text-green-400/80">✅ Disponível para pagar</p>
              )}
              {availableData.map(item => renderRow(item, false))}
            </div>
          )}
          {isPayTab && waitingData.length > 0 && (
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
                  <div className="flex gap-4 mt-1 text-xs">
                    <span className="text-gray-500">Total: <span className="text-white font-medium">{fmt(item.amount || item.total_amount)}</span></span>
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
                  {payForm.is_compensation && <textarea placeholder="Detalhe da compensação" value={payForm.compensation_notes} onChange={e=>setPayForm(f=>({...f,compensation_notes:e.target.value}))} rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"/>}
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
      {showReceiveModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-white mb-1">{editSession ? 'Editar recebimento — Pagar Victor' : receiveTarget ? 'Pagar — Pagar Victor' : 'Receber — Pagar Victor'}</h3>
            {receiveTarget && (
              <p className="text-gray-400 text-xs mb-4">Alvo: {receiveTarget.client_name} — {months[receiveTarget.month-1]}/{receiveTarget.year} · Saldo: {fmt((parseFloat(receiveTarget.total_amount)||0) - (parseFloat(receiveTarget.paid_amount)||0))}</p>
            )}
            {editSession && (
              <p className="text-gray-400 text-xs mb-4">Editando a sessão de {new Date(editSession.paid_at).toLocaleDateString('pt-BR', {timeZone:'UTC'})}. Ao confirmar, a distribuição anterior é substituída.</p>
            )}
            {!receiveTarget && !editSession && <div className="mb-4" />}
            <div className="space-y-3">
              {/* Reservas do mês — ficam no caixa para impostos/despesas futuras */}
              <div className="bg-amber-500/5 border border-amber-500/30 rounded-xl p-3 space-y-2">
                <p className="text-amber-300 text-xs font-medium uppercase tracking-wider">🏦 Reservas do mês (ficam no caixa)</p>
                <div className="grid grid-cols-2 gap-2">
                  {[['das','DAS'],['pro_labore','Pro Labore'],['inss','INSS'],['escritorio','Escritório']].map(([key,label]) => (
                    <div key={key} className="flex flex-col gap-1">
                      <label className="text-xs text-gray-400 font-medium">{label} (R$)</label>
                      <input type="number" placeholder="0" value={reserves[key]} onChange={e=>setReserves(r=>({...r,[key]:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-amber-500"/>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-gray-300">Total reservas: <span className="text-orange-400 font-bold">{fmt(reservesTotal)}</span></p>
                  <button onClick={saveReserves} disabled={savingReserves} className="px-3 py-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium">{savingReserves ? 'Salvando...' : '💾 Salvar reservas'}</button>
                </div>
                <p className="text-gray-600 text-[11px]">Salvo para {(() => { const {rm,ry} = reserveRefPeriod(); return `${months[rm-1]}/${ry}` })()} — editável a qualquer momento</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {RECEIVE_VICTOR_CATEGORIES.map(([key, label]) => (
                  <div key={key} className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400 font-medium">{label} (R$)</label>
                    <input type="number" placeholder="0" value={receiveCats[key]} onChange={e=>setReceiveCats(c=>({...c,[key]:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400 font-medium">Data do pagamento</label>
                <input type="date" value={receivePaidAt} onChange={e=>setReceivePaidAt(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
              </div>

              {/* Distribuição do saldo — painel visual em tempo real */}
              <div className="bg-gray-950/60 border border-gray-800 rounded-xl p-3">
                <p className="text-gray-300 text-xs font-medium uppercase tracking-wider mb-2">Distribuição do saldo</p>
                {distRows.length === 0 ? (
                  <p className="text-gray-600 text-xs text-center py-2">Nenhum saldo pendente</p>
                ) : (
                  <div className="space-y-1">
                    {distRows.map(d => (
                      <div key={d.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className={`truncate ${d.state === 'zero' ? 'text-gray-600' : 'text-gray-300'}`}>
                          <span className="text-gray-500">{months[d.month-1]}/{d.year}</span> {d.client_name}
                        </span>
                        <span className="shrink-0 font-mono text-right whitespace-nowrap">
                          <span className="text-gray-500">Saldo: {fmt(d.saldo)}</span>
                          <span className="text-gray-600"> → </span>
                          <span className={
                            d.state === 'zero' ? 'text-gray-600 line-through'
                            : d.state === 'partial' ? 'text-yellow-400'
                            : 'text-green-400'
                          }>Líquido: {fmt(d.liquido)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {distOverflow > 0 && (
                  <p className="text-red-400 text-xs mt-2">⚠️ Valor excede o saldo disponível em {fmt(distOverflow)}</p>
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
