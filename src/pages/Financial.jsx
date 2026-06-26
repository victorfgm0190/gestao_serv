import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'

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
const receiveCategorySummary = (cats) => RECEIVE_VICTOR_CATEGORIES.filter(([k]) => parseFloat(cats[k]) > 0).map(([k, label]) => `${label}: R$${String(parseFloat(cats[k])).replace('.', ',')}`).join(' | ')

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
  const [payForm, setPayForm] = useState({ paid_amount: '', paid_at: new Date().toISOString().split('T')[0], payment_method: '', is_compensation: false, compensation_notes: '', notes: '', status: 'pago' })
  const [modalPayments, setModalPayments] = useState([])
  const [newPay, setNewPay] = useState({ amount: '', paid_at: new Date().toISOString().split('T')[0], notes: '' })
  const [estornoConfirm, setEstornoConfirm] = useState(null)
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth() + 1)
  const [filterStatus, setFilterStatus] = useState('all')
  const [victorCats, setVictorCats] = useState(EMPTY_VICTOR_CATS)
  const [showReceiveModal, setShowReceiveModal] = useState(false)
  const [receiveCats, setReceiveCats] = useState(EMPTY_RECEIVE_CATS)
  const [receiving, setReceiving] = useState(false)

  useEffect(() => { fetchAll() }, [activeCompany, filterYear])
  useEffect(() => { setHistClient('') }, [histType, filterYear, activeCompany])

  async function fetchAll() {
    setLoading(true)
    try {
      const [cl, rec, fab, vic] = await Promise.all([
        fetch(`/api/clients?company_id=${activeCompany.id}`),
        fetch(`/api/receivables?company_id=${activeCompany.id}&year=${filterYear}`),
        fetch(`/api/payables-fabricio?company_id=${activeCompany.id}&year=${filterYear}`),
        fetch(`/api/payables-victor?company_id=${activeCompany.id}&year=${filterYear}`),
      ])
      setClients((await cl.json()).clients || [])
      setReceivables((await rec.json()).data || [])
      setPayablesFab((await fab.json()).data || [])
      setPayablesVictor((await vic.json()).data || [])
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }

  async function save() {
    const body = tab === 'victor'
      ? { ...form, company_id: activeCompany.id }
      : { ...form, company_id: activeCompany.id }
    await fetch(FINANCE_ENDPOINTS[tab], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setShowModal(false)
    setForm({ client_id: '', month: new Date().getMonth() + 1, year: new Date().getFullYear(), description: '', amount: '', service_amount: '', profit_amount: '', notes: '' })
    fetchAll()
  }

  async function pay(item) {
    await fetch(FINANCE_ENDPOINTS[tab], {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, ...payForm }),
    })
    setShowPayModal(null)
    setPayForm({ paid_amount: '', paid_at: new Date().toISOString().split('T')[0], payment_method: '', is_compensation: false, compensation_notes: '', notes: '', status: 'pago' })
    fetchAll()
  }

  async function openPayments(item) {
    setShowPayModal(item)
    setNewPay({ amount: '', paid_at: new Date().toISOString().split('T')[0], notes: '' })
    setVictorCats(EMPTY_VICTOR_CATS)
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
    await fetch('/api/payable-payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payable_type: tab, payable_id: showPayModal.id, amount, paid_at: newPay.paid_at, notes }),
    })
    setNewPay({ amount: '', paid_at: new Date().toISOString().split('T')[0], notes: '' })
    setVictorCats(EMPTY_VICTOR_CATS)
    await loadPayments(showPayModal)
    fetchAll()
  }

  function openReceive() {
    setReceiveCats(EMPTY_RECEIVE_CATS)
    setShowReceiveModal(true)
  }

  async function confirmReceive() {
    let pool = Math.round(receiveCategoryTotal(receiveCats) * 100) / 100
    if (pool <= 0) return
    const notes = receiveCategorySummary(receiveCats)
    const paid_at = new Date().toISOString().split('T')[0]
    // Registros pendentes/parciais, ordenados do menor saldo restante para o maior
    const targets = payablesVictor
      .filter(r => r.status === 'pendente' || r.status === 'parcial')
      .map(r => ({ id: r.id, remaining: Math.round(((parseFloat(r.total_amount) || 0) - (parseFloat(r.paid_amount) || 0)) * 100) / 100 }))
      .filter(r => r.remaining > 0)
      .sort((a, b) => a.remaining - b.remaining)

    setReceiving(true)
    try {
      for (const t of targets) {
        if (pool <= 0) break
        const pay = Math.round(Math.min(pool, t.remaining) * 100) / 100
        if (pay <= 0) continue
        await fetch('/api/payable-payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payable_type: 'victor', payable_id: t.id, amount: pay, paid_at, notes }),
        })
        pool = Math.round((pool - pay) * 100) / 100
      }
      setShowReceiveModal(false)
      setReceiveCats(EMPTY_RECEIVE_CATS)
      await fetchAll()
    } finally {
      setReceiving(false)
    }
  }

  async function deletePayment(p) {
    await fetch('/api/payable-payments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, payable_type: tab, payable_id: showPayModal.id }),
    })
    setEstornoConfirm(null)
    await loadPayments(showPayModal)
    fetchAll()
  }

  async function estornar(item) {
    if (!confirm('Estornar este recebimento? Os lançamentos de Pagar Victor e Pagar Fabrício gerados por esta fatura serão removidos.')) return
    const res = await fetch('/api/receivables', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, status: 'estorno' })
    })
    const data = await res.json()
    if (res.status === 400) { alert('⚠️ ' + data.error); return }
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
  const baseData = tab === 'receivables' ? receivables : tab === 'fabricio' ? payablesFab : payablesVictor
  const monthFiltered = (tab === 'victor' || tab === 'fabricio') && filterMonth !== ''
    ? baseData.filter(r => Number(r.month) === Number(filterMonth))
    : baseData
  const currentData = filterStatus === 'all'
    ? monthFiltered
    : monthFiltered.filter(r => filterStatus === 'pendente_parcial' ? (r.status === 'pendente' || r.status === 'parcial') : r.status === filterStatus)
  const victorCatTotal = victorCategoryTotal(victorCats)
  const receiveTotal = receiveCategoryTotal(receiveCats)
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
  const totalAmount = currentData.reduce((s, r) => s + (parseFloat(r.amount || r.total_amount) || 0), 0)
  const totalPaid = currentData.reduce((s, r) => s + (parseFloat(r.paid_amount) || 0), 0)
  const totalOpen = totalAmount - totalPaid

  // Histórico: registros pagos do tipo selecionado
  const histSource = histType === 'receivables' ? receivables : histType === 'fabricio' ? payablesFab : payablesVictor
  const histPaidAll = histSource.filter(r => r.status === 'pago' || r.status === 'parcial')
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
          <input type="number" value={filterYear} onChange={e=>setFilterYear(e.target.value)} className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white text-sm focus:outline-none"/>
          {tab !== 'historico' && (
            <button onClick={() => setShowModal(true)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium">+ Novo</button>
          )}
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-1 mb-6 bg-gray-900 p-1 rounded-xl w-fit">
        {[['receivables','💰 A Receber'],['fabricio','👷 Pagar Fab'],['victor','👤 Pagar Victor'],['historico','📜 Histórico']].map(([key,label]) => (
          <button key={key} onClick={() => setTab(key)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === key ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>{label}</button>
        ))}
      </div>

      {tab !== 'historico' && (<>
      {/* Totalizadores */}
      <div className="grid grid-cols-3 gap-4 mb-6">
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
      </div>

      {(tab === 'victor' || tab === 'fabricio') && (
        <div className="flex gap-2 items-center mb-4 flex-wrap">
          <span className="text-gray-500 text-xs uppercase tracking-wider mr-1">Mês:</span>
          <select value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500">
            <option value="">Todos</option>
            {months.map((m,i) => <option key={i} value={i+1}>{m}</option>)}
          </select>
          <span className="text-gray-500 text-xs uppercase tracking-wider ml-2 mr-1">Ano:</span>
          <input type="number" value={filterYear} onChange={e=>setFilterYear(e.target.value)} className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"/>
          <div className="ml-2">{statusFilter}</div>
          {tab === 'victor' && (
            <button onClick={openReceive} className="ml-auto px-4 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium">Receber</button>
          )}
        </div>
      )}

      {tab === 'receivables' && (
        <div className="mb-4">{statusFilter}</div>
      )}

      {loading ? <div className="text-gray-500 text-sm">Carregando...</div> : currentData.length === 0 ? (
        <div className="text-center py-16 text-gray-600"><p className="text-4xl mb-3">📂</p><p>Nenhum registro encontrado.</p></div>
      ) : (
        <div className="space-y-3">
          {currentData.map(item => (
            <div key={item.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-400 text-xs rounded-full">{item.client_name}</span>
                    <span className="text-gray-500 text-xs">{months[item.month-1]}/{item.year}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[item.status] || 'bg-gray-700 text-gray-400'}`}>{item.status}</span>
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
                    {item.paid_at && <span className="text-gray-500">Em: <span className="text-gray-300">{new Date(item.paid_at).toLocaleDateString('pt-BR')}</span></span>}
                    {item.is_compensation && <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded-full">Compensação</span>}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {tab === 'receivables' ? (
                    <>
                      {item.status !== 'pago' && (
                        <button onClick={() => { setShowPayModal(item); setPayForm(f => ({...f, paid_amount: item.amount || item.total_amount})) }} className="px-3 py-1 bg-green-700 hover:bg-green-600 text-white rounded-lg text-xs">Pagar</button>
                      )}
                      {item.status === 'pago' && (
                        <button onClick={() => estornar(item)} className="px-3 py-1 border border-red-500/60 text-red-400 hover:bg-red-500/10 rounded-lg text-xs">↩ Estornar</button>
                      )}
                    </>
                  ) : (
                    item.status === 'pendente' ? (
                      <button onClick={() => openPayments(item)} className="px-3 py-1 bg-green-700 hover:bg-green-600 text-white rounded-lg text-xs">Pagar</button>
                    ) : (
                      <button onClick={() => openPayments(item)} className="px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white rounded-lg text-xs">Ver Pagamentos</button>
                    )
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
          ))}
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
                    <span className="text-gray-500 text-xs">{months[item.month-1]}/{item.year}</span>
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
            <div className="flex gap-3 mt-5">
              <button onClick={()=>setShowModal(false)} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Cancelar</button>
              <button onClick={save} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium">Salvar</button>
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
              <input type="date" value={payForm.paid_at} onChange={e=>setPayForm(f=>({...f,paid_at:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
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
            <div className="flex gap-3 mt-5">
              <button onClick={()=>setShowPayModal(null)} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Cancelar</button>
              <button onClick={() => pay(showPayModal)} className="flex-1 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium">Confirmar</button>
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
                  <input type="date" value={newPay.paid_at} onChange={e=>setNewPay(f=>({...f,paid_at:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
                  <p className="text-sm text-gray-300">Total a pagar: <span className="text-green-400 font-bold">{fmt(victorCatTotal)}</span></p>
                  <button onClick={addPayment} disabled={victorCatTotal <= 0 || !newPay.paid_at} className="w-full py-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium">Registrar Pagamento</button>
                </>
              ) : (
                <>
                  <input placeholder="Valor (R$)" type="number" value={newPay.amount} onChange={e=>setNewPay(f=>({...f,amount:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                  <input type="date" value={newPay.paid_at} onChange={e=>setNewPay(f=>({...f,paid_at:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
                  <textarea placeholder="Observação" value={newPay.notes} onChange={e=>setNewPay(f=>({...f,notes:e.target.value}))} rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"/>
                  <button onClick={addPayment} disabled={!newPay.amount || !newPay.paid_at} className="w-full py-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium">Registrar Pagamento</button>
                </>
              )}
            </div>

            <button onClick={()=>setShowPayModal(null)} className="w-full mt-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Fechar</button>
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
              <button onClick={()=>deletePayment(estornoConfirm)} className="flex-1 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-medium">Estornar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Receber — distribui valor entre os registros pendentes/parciais do Victor */}
      {showReceiveModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-white mb-4">Receber — Pagar Victor</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {RECEIVE_VICTOR_CATEGORIES.map(([key, label]) => (
                  <div key={key} className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400 font-medium">{label} (R$)</label>
                    <input type="number" placeholder="0" value={receiveCats[key]} onChange={e=>setReceiveCats(c=>({...c,[key]:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                  </div>
                ))}
              </div>
              <p className="text-sm text-gray-300 border-t border-gray-800 pt-3">Total a distribuir: <span className="text-green-400 font-bold">{fmt(receiveTotal)}</span></p>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={()=>setShowReceiveModal(false)} disabled={receiving} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm disabled:opacity-50">Cancelar</button>
              <button onClick={confirmReceive} disabled={receiving || receiveTotal <= 0} className="flex-1 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium">{receiving ? 'Distribuindo...' : 'Confirmar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
