import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import * as XLSX from 'xlsx'

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
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth() + 1)
  const [filterYear, setFilterYear] = useState(new Date().getFullYear())
  const [form, setForm] = useState({
    client_id: '',
    entry_date: new Date().toISOString().split('T')[0],
    hora_inicial: '',
    intervalo_inicio: '',
    intervalo_fim: '',
    hora_final: '',
    description: '',
    hours_fuel: '0',
    notes: '',
  })
  const [preview, setPreview] = useState(null)
  const [editEntry, setEditEntry] = useState(null)

  useEffect(() => { fetchAll() }, [activeCompany, filterMonth, filterYear])

  async function fetchAll() {
    setLoading(true)
    try {
      const [entriesRes, clientsRes, rulesRes] = await Promise.all([
        fetch(`/api/time-entries?company_id=${activeCompany.id}&month=${filterMonth}&year=${filterYear}`),
        fetch(`/api/clients?company_id=${activeCompany.id}`),
        fetch(`/api/financial-rules?company_id=${activeCompany.id}`),
      ])
      setEntries((await entriesRes.json()).entries || [])
      setClients((await clientsRes.json()).clients || [])
      setRules((await rulesRes.json()).rules || [])
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

  function calcPreview(f) {
    const rule = rules.find(r => String(r.client_id) === String(f.client_id))
    const hours = calcHoras(f)
    if (!rule || !hours) { setPreview(null); return }
    const h = hours
    const hd = parseFloat(f.hours_fuel) || 0
    const valor_hora = parseFloat(rule.hourly_rate) || 0
    const imposto_pct = rule.has_tax ? (parseFloat(rule.tax_percentage) || 0) / 100 : 0
    const victor_fixo = parseFloat(rule.victor_fixed_per_hour) || 0
    const victor_pct = parseFloat(rule.remainder_victor_pct) || 0
    const fabricio_pct = parseFloat(rule.remainder_fabricio_pct) || 0
    const horas_servico = h - hd
    const gross = h * valor_hora
    const tax = gross * imposto_pct
    const net = gross - tax
    const v_desloc = hd * valor_hora * (1 - imposto_pct)
    const v_serv = horas_servico * victor_fixo
    const restante = Math.max(net - v_desloc - v_serv, 0)
    const v_lucro = restante * (victor_pct / 100)
    const fab = restante * (fabricio_pct / 100)
    setPreview({
      hours: h.toFixed(2),
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
    if (!form.client_id || !form.hora_inicial || !form.hora_final || !form.entry_date) return
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
      setForm({ client_id: '', entry_date: new Date().toISOString().split('T')[0], hora_inicial: '', intervalo_inicio: '', intervalo_fim: '', hora_final: '', description: '', hours_fuel: '0', notes: '' })
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
    setForm({
      client_id: String(entry.client_id || ''),
      entry_date: entry.entry_date ? entry.entry_date.split('T')[0] : new Date().toISOString().split('T')[0],
      hora_inicial: entry.hora_inicial || '',
      intervalo_inicio: entry.intervalo_inicio || '',
      intervalo_fim: entry.intervalo_fim || '',
      hora_final: entry.hora_final || '',
      description: entry.description || '',
      hours_fuel: entry.horas_deslocamento || '0',
      notes: entry.notes || '',
    })
    setPreview(null)
    setShowModal(true)
  }

  function exportToExcel() {
    const monthNames = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO']
    const monthName = monthNames[filterMonth - 1]

    function decimalToTimeStr(decimal) {
      if (!decimal) return ''
      const totalMinutes = Math.round(parseFloat(decimal) * 60)
      const hours = Math.floor(totalMinutes / 60)
      const minutes = totalMinutes % 60
      return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:00`
    }

    function timeStrToDecimal(timeStr) {
      if (!timeStr) return null
      const [h, m] = timeStr.split(':').map(Number)
      return (h * 60 + m) / 1440
    }

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([])

    // Título
    XLSX.utils.sheet_add_aoa(ws, [[`Ordens de Serviço - ${monthName} ${filterYear}`]], { origin: 'A2' })

    // Cabeçalho
    XLSX.utils.sheet_add_aoa(ws, [['TECNICO', 'DATA', 'CLIENTE', 'ATIVIDADES', 'HORAINICIAL', 'INTERVALO', '', 'HORAFINAL', 'TOTAL']], { origin: 'A4' })

    // Dados
    const rows = entries.map(e => {
      const dateVal = e.entry_date ? new Date(e.entry_date) : null
      const dateSerial = dateVal ? (dateVal.getTime() / 86400000) + 25569 - (dateVal.getTimezoneOffset() / 1440) : ''
      const horaInicial = timeStrToDecimal(e.hora_inicial)
      const intervaloInicio = timeStrToDecimal(e.intervalo_inicio)
      const intervaloFim = timeStrToDecimal(e.intervalo_fim)
      const horaFinal = timeStrToDecimal(e.hora_final)
      const totalDecimal = parseFloat(e.hours) / 24

      return [
        'VICTOR',
        dateSerial,
        e.client_name || '',
        e.description || '',
        horaInicial,
        intervaloInicio,
        intervaloFim,
        horaFinal,
        totalDecimal
      ]
    })

    XLSX.utils.sheet_add_aoa(ws, rows, { origin: 'A5' })

    // Formatos de data e hora
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
    for (let r = 4; r < 4 + rows.length; r++) {
      const dateCellRef = XLSX.utils.encode_cell({ r, c: 1 })
      if (ws[dateCellRef]) ws[dateCellRef].z = 'dd/mm/yyyy'

      const timeCols = [4, 5, 6, 7]
      timeCols.forEach(c => {
        const ref = XLSX.utils.encode_cell({ r, c })
        if (ws[ref] && ws[ref].v != null) ws[ref].z = 'hh:mm:ss'
      })

      const totalRef = XLSX.utils.encode_cell({ r, c: 8 })
      if (ws[totalRef]) ws[totalRef].z = '[h]:mm:ss'
    }

    // Total geral na linha após os dados
    const totalRow = 4 + rows.length + 1
    const totalDecimalAll = entries.reduce((s,e) => s + parseFloat(e.hours||0), 0) / 24
    XLSX.utils.sheet_add_aoa(ws, [[totalDecimalAll]], { origin: { r: totalRow, c: 8 } })
    const totalCellRef = XLSX.utils.encode_cell({ r: totalRow, c: 8 })
    if (ws[totalCellRef]) ws[totalCellRef].z = '[h]:mm:ss'

    // Larguras das colunas
    ws['!cols'] = [
      { wch: 8 },  // TECNICO
      { wch: 12 }, // DATA
      { wch: 15 }, // CLIENTE
      { wch: 60 }, // ATIVIDADES
      { wch: 10 }, // HORAINICIAL
      { wch: 10 }, // INTERVALO inicio
      { wch: 10 }, // INTERVALO fim
      { wch: 10 }, // HORAFINAL
      { wch: 10 }, // TOTAL
    ]

    XLSX.utils.book_append_sheet(wb, ws, 'Planilha1')
    XLSX.writeFile(wb, `OS_${monthName}_${filterYear}.xlsx`)
  }

  const fmt = (v) => v != null ? `R$ ${parseFloat(v).toFixed(2).replace('.', ',')}` : '-'
  const totalVictor = entries.reduce((s, e) => s + (parseFloat(e.victor_share) || 0), 0)
  const totalFab = entries.reduce((s, e) => s + (parseFloat(e.fabricio_share) || 0), 0)
  const totalHoras = entries.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0)
  // Demonstrativo: separa a parte de Victor em serviço (deslocamento + fixo/hora,
  // recalculados a partir da regra financeira do cliente) e lucro (restante do victor_share).
  const breakdown = entries.reduce((acc, e) => {
    const rule = rules.find(r => String(r.client_id) === String(e.client_id))
    const hours = parseFloat(e.hours) || 0
    const horasDesloc = parseFloat(e.horas_deslocamento) || 0
    const victorTotal = parseFloat(e.victor_share) || 0
    const valorDesloc = parseFloat(e.valor_deslocamento) || 0
    const victorFixoHora = rule ? (parseFloat(rule.victor_fixed_per_hour) || 0) : 0
    const victorServico = Math.max(hours - horasDesloc, 0) * victorFixoHora
    const servico = valorDesloc + victorServico
    acc.servico += servico
    acc.lucro += victorTotal - servico
    return acc
  }, { servico: 0, lucro: 0 })
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
          <button onClick={() => setShowModal(true)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors">
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

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">Total horas</p>
          <p className="text-white text-xl font-bold">{decimalToHHMM(totalHoras)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-2">Victor</p>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between text-gray-500">
              <span>Serviço</span>
              <span className="text-blue-300">{fmt(breakdown.servico)}</span>
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
                    <span className="text-gray-500 text-xs font-mono">{decimalToHHMM(e.hours)}</span>
                    {e.hora_inicial && e.hora_final && (
                      <span className="text-gray-600 text-xs font-mono">{e.hora_inicial}→{e.hora_final}{e.intervalo_inicio ? ` (int: ${e.intervalo_inicio}-${e.intervalo_fim})` : ''}</span>
                    )}
                    {parseFloat(e.horas_deslocamento) > 0 && (
                      <span className="text-yellow-600 text-xs">🚗 {e.horas_deslocamento}h desloc.</span>
                    )}
                  </div>
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
              <select value={form.client_id} onChange={e=>updateForm('client_id',e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                <option value="">Selecione o cliente</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
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
              <button onClick={()=>{setShowModal(false);setPreview(null);setEditEntry(null)}} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">Cancelar</button>
              <button onClick={save} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
