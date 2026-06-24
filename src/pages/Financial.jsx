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
  const [form, setForm] = useState({ client_id: '', month: new Date().getMonth() + 1, year: new Date().getFullYear(), description: '', amount: '', service_amount: '', profit_amount: '', notes: '' })
  const [payForm, setPayForm] = useState({ paid_amount: '', paid_at: new Date().toISOString().split('T')[0], payment_method: '', is_compensation: false, compensation_notes: '', status: 'pago' })

  useEffect(() => { fetchAll() }, [activeCompany, filterYear])

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
    setPayForm({ paid_amount: '', paid_at: new Date().toISOString().split('T')[0], payment_method: '', is_compensation: false, compensation_notes: '', status: 'pago' })
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
  const currentData = tab === 'receivables' ? receivables : tab === 'fabricio' ? payablesFab : payablesVictor
  const totalAmount = currentData.reduce((s, r) => s + (parseFloat(r.amount || r.total_amount) || 0), 0)
  const totalPaid = currentData.reduce((s, r) => s + (parseFloat(r.paid_amount) || 0), 0)
  const totalOpen = totalAmount - totalPaid

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Financeiro</h2>
          <p className="text-gray-400 text-sm mt-1">{activeCompany.name}</p>
        </div>
        <div className="flex gap-2">
          <input type="number" value={filterYear} onChange={e=>setFilterYear(e.target.value)} className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white text-sm focus:outline-none"/>
          <button onClick={() => setShowModal(true)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium">+ Novo</button>
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-1 mb-6 bg-gray-900 p-1 rounded-xl w-fit">
        {[['receivables','💰 A Receber'],['fabricio','👷 Pagar Fab'],['victor','👤 Pagar Victor']].map(([key,label]) => (
          <button key={key} onClick={() => setTab(key)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === key ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>{label}</button>
        ))}
      </div>

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
                  {item.status !== 'pago' && (
                    <button onClick={() => { setShowPayModal(item); setPayForm(f => ({...f, paid_amount: item.amount || item.total_amount})) }} className="px-3 py-1 bg-green-700 hover:bg-green-600 text-white rounded-lg text-xs">Pagar</button>
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
              <input placeholder="Descrição" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
              {tab === 'victor' ? (
                <>
                  <input placeholder="Valor serviço (R$)" type="number" value={form.service_amount} onChange={e=>setForm(f=>({...f,service_amount:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                  <input placeholder="Valor lucro (R$)" type="number" value={form.profit_amount} onChange={e=>setForm(f=>({...f,profit_amount:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                </>
              ) : (
                <input placeholder="Valor (R$)" type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
              )}
              <textarea placeholder="Observações" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"/>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={()=>setShowModal(false)} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Cancelar</button>
              <button onClick={save} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium">Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal pagamento */}
      {showPayModal && (
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
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={()=>setShowPayModal(null)} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Cancelar</button>
              <button onClick={() => pay(showPayModal)} className="flex-1 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium">Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
