import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'

function decimalToHHMM(decimal) {
  if (!decimal && decimal !== 0) return '--:--'
  const totalMinutes = Math.round(parseFloat(decimal) * 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export default function TimeEntries() {
  const { activeCompany } = useOutletContext()
  const [entries, setEntries] = useState([])
  const [clients, setClients] = useState([])
  const [rules, setRules] = useState([])
  const [contracts, setContracts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth() + 1)
  const [filterYear, setFilterYear] = useState(new Date().getFullYear())
  const [form, setForm] = useState({
    client_id: '',
    contract_id: '',
    entry_date: new Date().toISOString().split('T')[0],
    hora_inicial: '',
    intervalo_inicio: '',
    intervalo_fim: '',
    hora_final: '',
    description: '',
    hours_fuel: '0',
    despesas_deslocamento: '0',
    notes: '',
  })
  const [preview, setPreview] = useState(null)
  const [editEntry, setEditEntry] = useState(null)
  const [filterClient, setFilterClient] = useState('')
  const [clientContracts, setClientContracts] = useState([])
  const [contractsLoading, setContractsLoading] = useState(false)

  useEffect(() => { fetchAll() }, [activeCompany, filterMonth, filterYear])
  useEffect(() => { setFilterClient('') }, [activeCompany, filterMonth])

  async function fetchAll() {
    setLoading(true)
    try {
      const [entriesRes, clientsRes, rulesRes, contractsRes] = await Promise.all([
        fetch(`/api/time-entries?company_id=${activeCompany.id}&month=${filterMonth}&year=${filterYear}`),
        fetch(`/api/clients?company_id=${activeCompany.id}`),
        fetch(`/api/financial-rules?company_id=${activeCompany.id}`),
        fetch(`/api/contracts?company_id=${activeCompany.id}`),
      ])
      setEntries((await entriesRes.json()).entries || [])
      setClients((await clientsRes.json()).clients || [])
      setRules((await rulesRes.json()).rules || [])
      setContracts((await contractsRes.json()).contracts || [])
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }

  function timeToDecimal(time) {
    if (!time) return 0
    const [h, m] = time.split(':').map(Number)
    return h + m / 60
  }

  function calcHoras(f) {
    if (!f.hora_inicial || !f.hora_final) return 0
    const inicio = timeToDecimal(f.hora_inicial)
    const fim = timeToDecimal(f.hora_final)
    let intervalo = 0
    if (f.intervalo_inicio && f.intervalo_fim) {
      intervalo = timeToDecimal(f.intervalo_fim) - timeToDecimal(f.intervalo_inicio)
    }
    return Math.max(fim - inicio - intervalo, 0)
  }

  function contratoDoCliente(client_id) {
    if (!client_id) return null
    const doCliente = contracts.filter(c => String(c.client_id) === String(client_id))
    return doCliente.find(c => c.is_active) || doCliente[0] || null
  }

  function calcPreview(f) {
    const rule = rules.find(r => String(r.client_id) === String(f.client_id))
    const hours = calcHoras(f)
    if (!rule || !hours) { setPreview(null); return }
    const contrato = contratoDoCliente(f.client_id)
    const h = hours
    const hd = parseFloat(f.hours_fuel) || 0
    const despesas = parseFloat(f.despesas_deslocamento) || 0
    const valor_hora = parseFloat(rule.hourly_rate) || 0
    const imposto_pct = rule.has_tax ? (parseFloat(rule.tax_percentage) || 0) / 100 : 0
    const victor_fixo = parseFloat(rule.victor_fixed_per_hour) || 0
    const victor_pct = parseFloat(rule.remainder_victor_pct) || 50
    const fabricio_pct = parseFloat(rule.remainder_fabricio_pct) || 50

    const deslocamento_tipo = contrato?.deslocamento_tipo || 'nao_cobrado'
    const deslocamento_valor_hora = parseFloat(contrato?.deslocamento_valor_hora) || 0
    const valor_hora_desloc = deslocamento_valor_hora || valor_hora

    // Gross: deslocamento cobrado entra no gross quando o contrato cobra
    let gross, gross_desloc
    if (deslocamento_tipo === 'nao_cobrado') {
      gross = h * valor_hora
      gross_desloc = 0
    } else {
      gross = h * valor_hora
      gross_desloc = hd * valor_hora_desloc
    }
    const gross_total = gross + gross_desloc
    const tax = gross_total * imposto_pct
    const net = gross_total - tax
    const valor_hora_liq = valor_hora * (1 - imposto_pct)
    const valor_hora_desloc_liq = valor_hora_desloc * (1 - imposto_pct)

    let v_desloc = 0
    let v_desloc_despesas = 0
    if (deslocamento_tipo === 'nao_cobrado') {
      v_desloc = hd * valor_hora_liq
    } else if (deslocamento_tipo === 'hora') {
      v_desloc = hd * valor_hora_desloc_liq
    } else if (deslocamento_tipo === 'hora_despesas') {
      v_desloc = hd * valor_hora_desloc_liq
      v_desloc_despesas = despesas
    }

    // Split só sobre o líquido das horas de trabalho
    const net_trabalho = gross * (1 - imposto_pct)
    const v_serv = h * victor_fixo
    const restante = Math.max(net_trabalho - v_serv, 0)
    const v_lucro = restante * (victor_pct / 100)
    const fab = restante * (fabricio_pct / 100)
    setPreview({
      hours: h.toFixed(2),
      gross: gross_total.toFixed(2),
      tax: tax.toFixed(2),
      net: net.toFixed(2),
      desloc: (v_desloc + v_desloc_despesas).toFixed(2),
      despesas: v_desloc_despesas.toFixed(2),
      cobrado: deslocamento_tipo !== 'nao_cobrado',
      victor: (v_desloc + v_desloc_despesas + v_serv + v_lucro).toFixed(2),
      fabricio: fab.toFixed(2),
    })
  }

  function updateForm(field, value) {
    const nf = { ...form, [field]: value }
    setForm(nf)
    calcPreview(nf)
  }

  function onContractChange(contractId) {
    const ct = clientContracts.find(c => String(c.id) === String(contractId))
    const dh = ct && parseFloat(ct.displacement_hours) > 0 ? String(ct.displacement_hours) : '0'
    const nf = { ...form, contract_id: contractId, hours_fuel: dh }
    setForm(nf)
    calcPreview(nf)
  }

  async function loadContractsForClient(clientId) {
    if (!clientId) { setClientContracts([]); return }
    setContractsLoading(true)
    try {
      const r = await fetch(`/api/contracts?client_id=${clientId}`)
      setClientContracts((await r.json()).contracts || [])
    } catch(e) { console.error(e); setClientContracts([]) }
    finally { setContractsLoading(false) }
  }

  function openNew() {
    setEditEntry(null)
    setForm({ client_id: '', contract_id: '', entry_date: new Date().toISOString().split('T')[0], hora_inicial: '', intervalo_inicio: '', intervalo_fim: '', hora_final: '', description: '', hours_fuel: '0', despesas_deslocamento: '0', notes: '' })
    setClientContracts([])
    setPreview(null)
    setShowModal(true)
  }

  async function save() {
    if (!form.client_id || !form.contract_id || !form.hora_inicial || !form.hora_final || !form.entry_date) return
    try {
      const method = editEntry ? 'PUT' : 'POST'
      const body = editEntry
        ? { ...form, company_id: activeCompany.id, id: editEntry.id }
        : { ...form, company_id: activeCompany.id }
      await fetch('/api/time-entries', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setShowModal(false)
      setEditEntry(null)
      setForm({ client_id: '', contract_id: '', entry_date: new Date().toISOString().split('T')[0], hora_inicial: '', intervalo_inicio: '', intervalo_fim: '', hora_final: '', description: '', hours_fuel: '0', despesas_deslocamento: '0', notes: '' })
      setClientContracts([])
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

  function openEdit(entry) {
    setEditEntry(entry)
    loadContractsForClient(entry.client_id)
    const f = {
      client_id: String(entry.client_id || ''),
      contract_id: String(entry.contract_id || ''),
      entry_date: entry.entry_date ? entry.entry_date.split('T')[0] : new Date().toISOString().split('T')[0],
      hora_inicial: entry.hora_inicial || '',
      intervalo_inicio: entry.intervalo_inicio || '',
      intervalo_fim: entry.intervalo_fim || '',
      hora_final: entry.hora_final || '',
      description: entry.description || '',
      hours_fuel: entry.horas_deslocamento || '0',
      despesas_deslocamento: entry.despesas_deslocamento || '0',
      notes: entry.notes || '',
    }
    setForm(f)
    calcPreview(f)
    setShowModal(true)
  }

  function slugify(str) {
    return String(str)
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
  }

  async function exportToExcel() {
    try {
      let url = `/api/export-os?company_id=${activeCompany.id}&month=${filterMonth}&year=${filterYear}`
      if (filterClient) url += `&client_id=${filterClient}`
      const res = await fetch(url)
      if (!res.ok) { alert('Erro ao gerar Excel'); return }
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const monthsShort = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']
      const clientName = filterClient
        ? (clientsWithEntries.find(c => String(c.id) === String(filterClient))?.name || 'cliente')
        : 'todos'
      a.href = objectUrl
      a.download = `horas_${slugify(clientName)}_${monthsShort[filterMonth-1]}_${filterYear}.xlsx`
      a.click()
      URL.revokeObjectURL(objectUrl)
    } catch(e) {
      alert('Erro ao exportar: ' + e.message)
    }
  }

  const fmt = (v) => v != null ? `R$ ${parseFloat(v).toFixed(2).replace('.', ',')}` : '-'
  // Clientes com lançamentos no período (derivado de todos os entries, não dos filtrados)
  const clientsWithEntries = Array.from(
    entries.reduce((map, e) => {
      if (e.client_id != null && !map.has(e.client_id)) map.set(e.client_id, e.client_name || 'Sem cliente')
      return map
    }, new Map())
  ).map(([id, name]) => ({ id, name }))
  const filteredEntries = filterClient
    ? entries.filter(e => String(e.client_id) === String(filterClient))
    : entries
  const totalVictor = filteredEntries.reduce((s, e) => s + (parseFloat(e.victor_share) || 0), 0)
  const totalFab = filteredEntries.reduce((s, e) => s + (parseFloat(e.fabricio_share) || 0), 0)
  const totalHoras = filteredEntries.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0)
  const totalBruto = filteredEntries.reduce((s, e) => s + (parseFloat(e.gross_value) || 0), 0)
  // Demonstrativo: separa a parte de Victor em serviço (fixo/hora), deslocamento e
  // lucro (restante do victor_share), recalculados a partir da regra financeira do cliente.
  const breakdown = filteredEntries.reduce((acc, e) => {
    const rule = rules.find(r => String(r.client_id) === String(e.client_id))
    const hours = parseFloat(e.hours) || 0
    const victorTotal = parseFloat(e.victor_share) || 0
    const valorDesloc = parseFloat(e.valor_deslocamento) || 0
    const victorFixoHora = rule ? (parseFloat(rule.victor_fixed_per_hour) || 0) : 0
    const victorServico = hours * victorFixoHora
    acc.desloc += valorDesloc
    acc.servico += victorServico
    acc.lucro += victorTotal - valorDesloc - victorServico
    return acc
  }, { servico: 0, desloc: 0, lucro: 0 })
  const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Apontamento de Horas</h2>
          <p className="text-gray-400 text-sm mt-1">{activeCompany.name}</p>
        </div>
        <div className="flex gap-2">
          {entries.length > 0 && (
            <button
              onClick={exportToExcel}
              className="px-4 py-2 bg-green-700 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              📥 Exportar Excel
            </button>
          )}
          <button onClick={openNew} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors">
            + Lançar horas
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap items-center">
        {months.map((m, i) => (
          <button key={i} onClick={() => setFilterMonth(i+1)} className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filterMonth === i+1 ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{m}</button>
        ))}
        <input type="number" value={filterYear} onChange={e=>setFilterYear(e.target.value)} className="ml-2 w-20 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white text-xs focus:outline-none"/>
      </div>

      {clientsWithEntries.length > 0 && (
        <div className="flex gap-2 mb-6 flex-wrap">
          <button
            onClick={() => setFilterClient('')}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filterClient === '' ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            Todos os clientes
          </button>
          {clientsWithEntries.map(c => (
            <button
              key={c.id}
              onClick={() => setFilterClient(String(c.id))}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filterClient === String(c.id) ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">Total horas</p>
          <p className="text-white text-xl font-bold">{decimalToHHMM(totalHoras)}</p>
          <p className="text-gray-500 text-xs mt-1">Bruto: <span className="text-gray-300">{fmt(totalBruto)}</span></p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-2">Victor</p>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between text-gray-500">
              <span>Serviço</span>
              <span className="text-blue-300">{fmt(breakdown.servico)}</span>
            </div>
            <div className="flex justify-between text-gray-500">
              <span>Deslocamento</span>
              <span className="text-blue-300">{fmt(breakdown.desloc)}</span>
            </div>
            <div className="flex justify-between text-gray-500">
              <span>Lucro</span>
              <span className="text-blue-300">{fmt(breakdown.lucro)}</span>
            </div>
          </div>
          <div className="flex justify-between mt-2 pt-2 border-t border-gray-700">
            <span className="text-gray-300 text-sm font-medium">TOTAL</span>
            <span className="text-blue-400 text-lg font-bold">{fmt(totalVictor)}</span>
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-2">Fabrício</p>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between text-gray-500">
              <span>Lucro</span>
              <span className="text-purple-300">{fmt(totalFab)}</span>
            </div>
          </div>
          <div className="flex justify-between mt-2 pt-2 border-t border-gray-700">
            <span className="text-gray-300 text-sm font-medium">TOTAL</span>
            <span className="text-purple-400 text-lg font-bold">{fmt(totalFab)}</span>
          </div>
        </div>
      </div>

      {loading ? <div className="text-gray-500 text-sm">Carregando...</div> : filteredEntries.length === 0 ? (
        <div className="text-center py-16 text-gray-600"><p className="text-4xl mb-3">⏱️</p><p>Nenhum lançamento neste período.</p></div>
      ) : (
        <div className="space-y-3">
          {filteredEntries.map(e => (
            <div key={e.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-400 text-xs rounded-full">{e.client_name || 'Sem cliente'}</span>
                    <span className="text-gray-500 text-xs">{new Date(e.entry_date).toLocaleDateString('pt-BR', {timeZone:'UTC'})}</span>
                    <span className="text-gray-500 text-xs font-mono">{decimalToHHMM(e.hours)}</span>
                    {e.hora_inicial && e.hora_final && (
                      <span className="text-gray-600 text-xs font-mono">{e.hora_inicial}→{e.hora_final}{e.intervalo_inicio ? ` (int: ${e.intervalo_inicio}-${e.intervalo_fim})` : ''}</span>
                    )}
                    {parseFloat(e.horas_deslocamento) > 0 && (
                      <span className="text-yellow-600 text-xs">🚗 {e.horas_deslocamento}h desloc.</span>
                    )}
                    {parseFloat(e.despesas_deslocamento) > 0 && (
                      <span className="text-yellow-600 text-xs">💸 {fmt(e.despesas_deslocamento)} despesas</span>
                    )}
                  </div>
                  {e.contract_name && (
                    <p className="text-gray-500 text-xs mb-1">📄 {e.contract_name}</p>
                  )}
                  <p className="text-white text-sm">{e.description}</p>
                  <div className="flex gap-4 mt-2 text-xs">
                    <span className="text-gray-500">Bruto: <span className="text-gray-300">{fmt(e.gross_value)}</span></span>
                    {parseFloat(e.tax_amount) > 0 && <span className="text-gray-500">Imposto: <span className="text-red-400">-{fmt(e.tax_amount)}</span></span>}
                    <span className="text-gray-500">Victor: <span className="text-blue-400">{fmt(e.victor_share)}</span></span>
                    <span className="text-gray-500">Fab: <span className="text-purple-400">{fmt(e.fabricio_share)}</span></span>
                  </div>
                </div>
                <div className="flex gap-3 shrink-0">
                  <button onClick={() => openEdit(e)} className="text-gray-600 hover:text-blue-400 text-sm transition-colors">Editar</button>
                  <button onClick={() => deleteEntry(e.id)} className="text-gray-600 hover:text-red-400 text-sm transition-colors">Excluir</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-white mb-4">{editEntry ? 'Editar lançamento' : 'Lançar horas'}</h3>
            <div className="space-y-3">
              <select value={form.client_id} onChange={e=>{ const v = e.target.value; const nf = {...form, client_id: v, contract_id: ''}; setForm(nf); calcPreview(nf); loadContractsForClient(v) }} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                <option value="">Selecione o cliente</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div className="flex flex-col gap-1">
                <select value={form.contract_id} onChange={e=>onContractChange(e.target.value)} disabled={!form.client_id || contractsLoading || clientContracts.length === 0} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50">
                  <option value="">{contractsLoading ? 'Carregando contratos...' : 'Selecione o contrato'}</option>
                  {clientContracts.map(ct => (
                    <option key={ct.id} value={ct.id}>
                      {ct.name} — {ct.billing_type === 'hora' ? 'Por hora' : ct.billing_type === 'dia' ? 'Por dia' : 'Fixo/Mensal'}
                    </option>
                  ))}
                </select>
                {form.client_id && !contractsLoading && clientContracts.length === 0 && (
                  <p className="text-amber-400 text-xs">Este cliente não possui contrato ativo. Cadastre um contrato antes de lançar horas.</p>
                )}
              </div>
              <input type="date" value={form.entry_date} onChange={e=>updateForm('entry_date',e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>

              {/* Horários */}
              <div className="bg-gray-800 rounded-xl p-4 space-y-3">
                <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">Horários</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-gray-500 text-xs mb-1 block">Hora inicial</label>
                    <input type="time" value={form.hora_inicial} onChange={e=>updateForm('hora_inicial',e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
                  </div>
                  <div>
                    <label className="text-gray-500 text-xs mb-1 block">Hora final</label>
                    <input type="time" value={form.hora_final} onChange={e=>updateForm('hora_final',e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-gray-500 text-xs mb-1 block">Intervalo início</label>
                    <input type="time" value={form.intervalo_inicio} onChange={e=>updateForm('intervalo_inicio',e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
                  </div>
                  <div>
                    <label className="text-gray-500 text-xs mb-1 block">Intervalo fim</label>
                    <input type="time" value={form.intervalo_fim} onChange={e=>updateForm('intervalo_fim',e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
                  </div>
                </div>
                {preview && (
                  <div className="text-center pt-1">
                    <span className="text-white font-bold text-lg">{decimalToHHMM(preview.hours)}</span>
                    <span className="text-gray-500 text-xs ml-2">total calculado</span>
                  </div>
                )}
              </div>

              <textarea placeholder="Descrição da atividade" value={form.description} onChange={e=>updateForm('description',e.target.value)} rows={3} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"/>
              <input placeholder="Horas de deslocamento (opcional)" type="number" step="0.5" value={form.hours_fuel} onChange={e=>updateForm('hours_fuel',e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
              {contratoDoCliente(form.client_id)?.deslocamento_tipo === 'hora_despesas' && (
                <input placeholder="Despesas de deslocamento (R$) — pedágio + combustível + almoço" type="number" step="0.01" value={form.despesas_deslocamento} onChange={e=>updateForm('despesas_deslocamento',e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
              )}
              <input placeholder="Observações" value={form.notes} onChange={e=>updateForm('notes',e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>

              {preview && (
                <div className="bg-gray-800 rounded-xl p-4 space-y-2 text-sm">
                  <p className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-2">Preview do cálculo</p>
                  <div className="flex justify-between"><span className="text-gray-400">Bruto</span><span className="text-white">R$ {preview.gross}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Imposto</span><span className="text-red-400">-R$ {preview.tax}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Líquido</span><span className="text-white">R$ {preview.net}</span></div>
                  {parseFloat(preview.desloc) > 0 && <div className="flex justify-between"><span className="text-gray-400">{preview.cobrado ? 'Deslocamento cobrado' : 'Deslocamento (Victor)'}{parseFloat(preview.despesas) > 0 ? ' + despesas' : ''}</span><span className="text-yellow-400">R$ {preview.desloc}</span></div>}
                  <div className="border-t border-gray-700 pt-2 mt-2">
                    <div className="flex justify-between"><span className="text-gray-400">Victor</span><span className="text-blue-400 font-medium">R$ {preview.victor}</span></div>
                    <div className="flex justify-between mt-1"><span className="text-gray-400">Fabrício</span><span className="text-purple-400 font-medium">R$ {preview.fabricio}</span></div>
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={()=>{setShowModal(false);setPreview(null);setEditEntry(null)}} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">Cancelar</button>
              <button onClick={save} disabled={!form.client_id || !form.contract_id} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
