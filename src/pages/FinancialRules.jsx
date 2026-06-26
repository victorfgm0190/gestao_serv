import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'

export default function FinancialRules() {
  const { activeCompany } = useOutletContext()
  const [rules, setRules] = useState([])
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editRule, setEditRule] = useState(null)
  const [form, setForm] = useState({
    client_id: '',
    hourly_rate: '',
    has_tax: false,
    tax_percentage: '',
    victor_fixed_per_hour: '',
    has_fuel: false,
    fuel_value: '',
    remainder_victor_pct: '50',
    remainder_fabricio_pct: '50',
  })

  useEffect(() => { fetchAll() }, [activeCompany])

  async function fetchAll() {
    setLoading(true)
    try {
      const [rulesRes, clientsRes] = await Promise.all([
        fetch(`/api/financial-rules?company_id=${activeCompany.id}`),
        fetch(`/api/clients?company_id=${activeCompany.id}`),
      ])
      const rd = await rulesRes.json()
      const cd = await clientsRes.json()
      setRules(rd.rules || [])
      setClients(cd.clients || [])
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }

  function resetForm() {
    setForm({ client_id: '', hourly_rate: '', has_tax: false, tax_percentage: '', victor_fixed_per_hour: '', has_fuel: false, fuel_value: '', remainder_victor_pct: '50', remainder_fabricio_pct: '50' })
  }

  function openEdit(r) {
    setEditRule(r)
    setForm({
      client_id: r.client_id ?? '',
      hourly_rate: r.hourly_rate ?? '',
      has_tax: r.has_tax ?? false,
      tax_percentage: r.tax_percentage ?? '',
      victor_fixed_per_hour: r.victor_fixed_per_hour ?? '',
      has_fuel: r.has_fuel ?? false,
      fuel_value: r.fuel_value ?? '',
      remainder_victor_pct: r.remainder_victor_pct ?? '50',
      remainder_fabricio_pct: r.remainder_fabricio_pct ?? '50',
    })
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setEditRule(null)
    resetForm()
  }

  async function save() {
    if (!form.client_id || !form.hourly_rate) return
    try {
      const url = editRule ? `/api/financial-rules?id=${editRule.id}` : '/api/financial-rules'
      await fetch(url, {
        method: editRule ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      setShowModal(false)
      setEditRule(null)
      resetForm()
      fetchAll()
    } catch(e) { console.error(e) }
  }

  async function deleteRule(id) {
    if (!confirm('Excluir esta regra?')) return
    await fetch('/api/financial-rules', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    fetchAll()
  }

  const fmt = (v) => v != null ? `R$ ${parseFloat(v).toFixed(2).replace('.', ',')}` : '-'

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Regras Financeiras</h2>
          <p className="text-gray-400 text-sm mt-1">{activeCompany.name}</p>
        </div>
        <button onClick={() => { setEditRule(null); resetForm(); setShowModal(true) }} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors">
          + Nova regra
        </button>
      </div>

      {loading ? <div className="text-gray-500 text-sm">Carregando...</div> : rules.length === 0 ? (
        <div className="text-center py-16 text-gray-600"><p className="text-4xl mb-3">💰</p><p>Nenhuma regra financeira cadastrada.</p></div>
      ) : (
        <div className="space-y-3">
          {rules.map(r => (
            <div key={r.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-white font-semibold text-lg">{r.client_name}</p>
                  <div className="flex flex-wrap gap-4 mt-3 text-sm">
                    <span className="text-gray-400">Hora: <span className="text-white">{fmt(r.hourly_rate)}</span></span>
                    {r.has_tax && <span className="text-gray-400">Imposto: <span className="text-red-400">{r.tax_percentage}%</span></span>}
                    <span className="text-gray-400">Victor/h: <span className="text-blue-400">{fmt(r.victor_fixed_per_hour)}</span></span>
                    {r.has_fuel && <span className="text-gray-400">Combustível: <span className="text-yellow-400">{fmt(r.fuel_value)}</span></span>}
                    <span className="text-gray-400">Restante: <span className="text-green-400">{r.remainder_victor_pct}% Victor / {r.remainder_fabricio_pct}% Fab</span></span>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button onClick={() => openEdit(r)} className="text-gray-400 hover:text-blue-400 text-sm transition-colors">Editar</button>
                  <button onClick={() => deleteRule(r.id)} className="text-gray-600 hover:text-red-400 text-sm transition-colors">Excluir</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-white mb-4">{editRule ? 'Editar regra financeira' : 'Nova regra financeira'}</h3>
            <div className="space-y-3">
              <select value={form.client_id} onChange={e => setForm(f=>({...f,client_id:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                <option value="">Selecione o cliente</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input placeholder="Valor hora bruto (R$)" type="number" value={form.hourly_rate} onChange={e=>setForm(f=>({...f,hourly_rate:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
              <input placeholder="Valor fixo Victor por hora (R$)" type="number" value={form.victor_fixed_per_hour} onChange={e=>setForm(f=>({...f,victor_fixed_per_hour:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
              <label className="flex items-center gap-2 text-gray-300 text-sm cursor-pointer">
                <input type="checkbox" checked={form.has_tax} onChange={e=>setForm(f=>({...f,has_tax:e.target.checked}))} className="rounded"/>
                Tem imposto?
              </label>
              {form.has_tax && <input placeholder="% de imposto (ex: 7)" type="number" value={form.tax_percentage} onChange={e=>setForm(f=>({...f,tax_percentage:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>}
              <label className="flex items-center gap-2 text-gray-300 text-sm cursor-pointer">
                <input type="checkbox" checked={form.has_fuel} onChange={e=>setForm(f=>({...f,has_fuel:e.target.checked}))} className="rounded"/>
                Tem deslocamento/combustível?
              </label>
              {form.has_fuel && <input placeholder="Valor combustível (R$)" type="number" value={form.fuel_value} onChange={e=>setForm(f=>({...f,fuel_value:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>}
              <div className="flex gap-3">
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-xs text-gray-400 font-medium">% Victor</label>
                  <input placeholder="% restante Victor" type="number" value={form.remainder_victor_pct} onChange={e=>setForm(f=>({...f,remainder_victor_pct:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-xs text-gray-400 font-medium">% Fabrício</label>
                  <input placeholder="% restante Fabrício" type="number" value={form.remainder_fabricio_pct} onChange={e=>setForm(f=>({...f,remainder_fabricio_pct:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={closeModal} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">Cancelar</button>
              <button onClick={save} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
