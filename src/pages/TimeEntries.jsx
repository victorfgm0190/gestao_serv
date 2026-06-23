import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'

export default function TimeEntries() {
  const { activeCompany } = useOutletContext()
  const [entries, setEntries] = useState([])
  const [clients, setClients] = useState([])
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth() + 1)
  const [filterYear, setFilterYear] = useState(new Date().getFullYear())
  const [form, setForm] = useState({
    client_id: '', entry_date: new Date().toISOString().split('T')[0],
    description: '', hours: '', hours_fuel: '0', notes: '',
  })
  const [preview, setPreview] = useState(null)

  useEffect(() => { fetchAll() }, [activeCompany, filterMonth, filterYear])

  async function fetchAll() {
    setLoading(true)
    try {
      const [entriesRes, clientsRes, rulesRes] = await Promise.all([
        fetch(`/api/time-entries?company_id=${activeCompany.id}&month=${filterMonth}&year=${filterYear}`),
        fetch(`/api/clients?company_id=${activeCompany.id}`),
        fetch(`/api/financial-rules?company_id=${activeCompany.id}`),
      ])
      const ed = await entriesRes.json()
      const cd = await clientsRes.json()
      const rd = await rulesRes.json()
      setEntries(ed.entries || [])
      setClients(cd.clients || [])
      setRules(rd.rules || [])
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }

  function calcPreview(f) {
    const rule = rules.find(r => String(r.client_id) === String(f.client_id))
    if (!rule || !f.hours) { setPreview(null); return }
    const h = parseFloat(f.hours) || 0
    const hd = parseFloat(f.hours_fuel) || 0
    const valor_hora = parseFloat(rule.hourly_rate) || 0
    const imposto_pct = rule.has_tax ? (parseFloat(rule.tax_percentage) || 0) / 100 : 0
    const victor_fixo = parseFloat(rule.victor_fixed_per_hour) || 0
    const victor_pct = parseFloat(rule.remainder_victor_pct) || 0
    const fabricio_pct = parseFloat(rule.remainder_fabricio_pct) || 0
    const combustivel = rule.has_fuel ? (parseFloat(rule.fuel_value) || 0) : 0
    const horas_servico = h - hd
    const gross = h * valor_hora
    const tax = gross * imposto_pct
    const net = gross - tax
    const v_desloc = hd * valor_hora * (1 - imposto_pct)
    const v_serv = horas_servico * victor_fixo
    const restante = Math.max(net - v_desloc - v_serv - combustivel, 0)
    const v_lucro = restante * (victor_pct / 100)
    const fab = restante * (fabricio_pct / 100)
    setPreview({
      gross: gross.toFixed(2),
      tax: tax.toFixed(2),
      net: net.toFixed(2),
      victor: (v_desloc + v_serv + v_lucro).toFixed(2),
      fabricio: fab.toFixed(2),
    })
  }

  function updateForm(field, value) {
    const nf = { ...form, [field]: value }
    setForm(nf)
    calcPreview(nf)
  }

  async function save() {
    if (!form.client_id || !form.hours || !form.entry_date) return
    try {
      await fetch('/api/time-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, company_id: activeCompany.id }),
      })
      setShowModal(false)
      setForm({ client_id: '', entry_date: new Date().toISOString().split('T')[0], description: '', hours: '', hours_fuel: '0', notes: '' })
      setPreview(null)
      fetchAll()
    } catch(e) { console.error(e) }
  }

  async function deleteEntry(id) {
    if (!confirm('Excluir este lançamento?')) return
    await fetch('/api/time-entries', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    fetchAll()
  }

  const fmt = (v) => v != null ? `R$ ${parseFloat(v).toFixed(2).replace('.', ',')}` : '-'
  const totalVictor = entries.reduce((s, e) => s + (parseFloat(e.victor_share) || 0), 0)
  const totalFab = entries.reduce((s, e) => s + (parseFloat(e.fabricio_share) || 0), 0)
  const totalHoras = entries.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0)

  const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Apontamento de Horas</h2>
          <p className="text-gray-400 text-sm mt-1">{activeCompany.name}</p>
        </div>
        <button onClick={() => setShowModal(true)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors">
          + Lançar horas
        </button>
      </div>

      {/* Filtro mês/ano */}
      <div className="flex gap-2 mb-6 flex-wrap items-center">
        {months.map((m, i) => (
          <button key={i} onClick={() => setFilterMonth(i+1)} className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filterMonth === i+1 ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{m}</button>
        ))}
        <input type="number" value={filterYear} onChange={e=>setFilterYear(e.target.value)} className="ml-2 w-20 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white text-xs focus:outline-none"/>
      </div>

      {/* Totalizadores */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">Total horas</p>
          <p className="text-white text-xl font-bold">{totalHoras.toFixed(2)}h</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">Victor</p>
          <p className="text-blue-400 text-xl font-bold">{fmt(totalVictor)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">Fabrício</p>
          <p className="text-purple-400 text-xl font-bold">{fmt(totalFab)}</p>
        </div>
      </div>

      {loading ? <div className="text-gray-500 text-sm">Carregando...</div> : entries.length === 0 ? (
        <div className="text-center py-16 text-gray-600"><p className="text-4xl mb-3">⏱️</p><p>Nenhum lançamento neste período.</p></div>
      ) : (
        <div className="space-y-3">
          {entries.map(e => (
            <div key={e.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-400 text-xs rounded-full">{e.client_name || 'Sem cliente'}</span>
                    <span className="text-gray-500 text-xs">{new Date(e.entry_date).toLocaleDateString('pt-BR', {timeZone:'UTC'})}</span>
                    <span className="text-gray-500 text-xs">{e.hours}h</span>
                  </div>
                  <p className="text-white text-sm">{e.description}</p>
                  <div className="flex gap-4 mt-2 text-xs">
                    <span className="text-gray-500">Bruto: <span className="text-gray-300">{fmt(e.gross_value)}</span></span>
                    {e.tax_amount > 0 && <span className="text-gray-500">Imposto: <span className="text-red-400">-{fmt(e.tax_amount)}</span></span>}
                    <span className="text-gray-500">Victor: <span className="text-blue-400">{fmt(e.victor_share)}</span></span>
                    <span className="text-gray-500">Fab: <span className="text-purple-400">{fmt(e.fabricio_share)}</span></span>
                  </div>
                </div>
                <button onClick={() => deleteEntry(e.id)} className="text-gray-600 hover:text-red-400 text-sm transition-colors shrink-0">Excluir</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-white mb-4">Lançar horas</h3>
            <div className="space-y-3">
              <select value={form.client_id} onChange={e=>updateForm('client_id',e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                <option value="">Selecione o cliente</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input type="date" value={form.entry_date} onChange={e=>updateForm('entry_date',e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
              <textarea placeholder="Descrição da atividade" value={form.description} onChange={e=>updateForm('description',e.target.value)} rows={3} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"/>
              <div className="grid grid-cols-2 gap-3">
                <input placeholder="Total de horas" type="number" step="0.5" value={form.hours} onChange={e=>updateForm('hours',e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                <input placeholder="Horas deslocamento" type="number" step="0.5" value={form.hours_fuel} onChange={e=>updateForm('hours_fuel',e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
              </div>
              <input placeholder="Observações" value={form.notes} onChange={e=>updateForm('notes',e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>

              {preview && (
                <div className="bg-gray-800 rounded-xl p-4 space-y-2 text-sm">
                  <p className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-2">Preview do cálculo</p>
                  <div className="flex justify-between"><span className="text-gray-400">Bruto</span><span className="text-white">R$ {preview.gross}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Imposto</span><span className="text-red-400">-R$ {preview.tax}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Líquido</span><span className="text-white">R$ {preview.net}</span></div>
                  <div className="border-t border-gray-700 pt-2 mt-2">
                    <div className="flex justify-between"><span className="text-gray-400">Victor</span><span className="text-blue-400 font-medium">R$ {preview.victor}</span></div>
                    <div className="flex justify-between mt-1"><span className="text-gray-400">Fabrício</span><span className="text-purple-400 font-medium">R$ {preview.fabricio}</span></div>
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={()=>{setShowModal(false);setPreview(null)}} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">Cancelar</button>
              <button onClick={save} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
