import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'

const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

export default function Billing() {
  const { activeCompany } = useOutletContext()
  const [invoices, setInvoices] = useState([])
  const [contracts, setContracts] = useState([])
  const [clients, setClients] = useState([])
  const [timeEntries, setTimeEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [showContractModal, setShowContractModal] = useState(false)
  const [showAgendaModal, setShowAgendaModal] = useState(false)
  const [selectedEntries, setSelectedEntries] = useState([])
  const [filterYear, setFilterYear] = useState(new Date().getFullYear())
  const [contractForm, setContractForm] = useState({ contract_id:'', month: new Date().getMonth()+1, year: new Date().getFullYear(), invoice_value:'', invoice_number:'', notes:'' })
  const [agendaForm, setAgendaForm] = useState({ client_id:'', month: new Date().getMonth()+1, year: new Date().getFullYear(), invoice_number:'', notes:'' })

  useEffect(() => { fetchAll() }, [activeCompany, filterYear])

  async function fetchAll() {
    setLoading(true)
    try {
      const [inv, ct, cl] = await Promise.all([
        fetch(`/api/invoices?company_id=${activeCompany.id}&year=${filterYear}`),
        fetch(`/api/contracts?company_id=${activeCompany.id}`),
        fetch(`/api/clients?company_id=${activeCompany.id}`),
      ])
      setInvoices((await inv.json()).invoices || [])
      setContracts((await ct.json()).contracts || [])
      setClients((await cl.json()).clients || [])
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }

  async function fetchEntries(client_id, month, year) {
    if (!client_id) return
    const res = await fetch(`/api/time-entries?company_id=${activeCompany.id}&month=${month}&year=${year}`)
    const data = await res.json()
    setTimeEntries((data.entries||[]).filter(e => String(e.client_id) === String(client_id)))
    setSelectedEntries([])
  }

  function toggleEntry(id) {
    setSelectedEntries(p => p.includes(id) ? p.filter(x=>x!==id) : [...p,id])
  }

  async function saveContractInvoice() {
    const contract = contracts.find(c => String(c.id) === String(contractForm.contract_id))
    if (!contract || !contractForm.invoice_value) return
    const res = await fetch('/api/invoices', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ ...contractForm, company_id: activeCompany.id, client_id: contract.client_id, billing_type:'contract' })
    })
    const data = await res.json()
    if (data.invoice) {
      setShowContractModal(false)
      fetchAll()
      const b = data.breakdown
      alert(`Fatura gerada!\n\nA Receber: R$ ${parseFloat(b.invoice_value).toFixed(2)}\n\nDemonstrativo:\nVictor serviço: R$ ${parseFloat(b.victor_service).toFixed(2)}\nVictor lucro: R$ ${parseFloat(b.victor_profit).toFixed(2)}\nVictor imposto NF: R$ ${parseFloat(b.victor_tax_diff).toFixed(2)}\nVictor TOTAL: R$ ${parseFloat(b.victor_total).toFixed(2)}\nFabrício TOTAL: R$ ${parseFloat(b.fabricio_total).toFixed(2)}`)
    } else { alert('Erro: ' + (data.error||'Falha')) }
  }

  async function saveAgendaInvoice() {
    if (!agendaForm.client_id || selectedEntries.length === 0) return
    const res = await fetch('/api/invoices', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ ...agendaForm, company_id: activeCompany.id, billing_type:'agenda', time_entry_ids: selectedEntries })
    })
    const data = await res.json()
    if (data.invoice) {
      setShowAgendaModal(false)
      setTimeEntries([])
      setSelectedEntries([])
      fetchAll()
      const b = data.breakdown
      alert(`Fatura gerada!\n\nTotal horas: ${b.total_hours?.toFixed(2)}h\nBruto: R$ ${parseFloat(b.invoice_value).toFixed(2)}\nImposto: R$ ${parseFloat(b.tax_amount).toFixed(2)}\n\nVictor serviço: R$ ${parseFloat(b.victor_service).toFixed(2)}\nVictor lucro: R$ ${parseFloat(b.victor_profit).toFixed(2)}\nVictor TOTAL: R$ ${parseFloat(b.victor_total).toFixed(2)}\nFabrício TOTAL: R$ ${parseFloat(b.fabricio_total).toFixed(2)}`)
    } else { alert('Erro: ' + (data.error||'Falha')) }
  }

  async function markReceived(invoice) {
    const paid_at = prompt('Data de recebimento (AAAA-MM-DD):', new Date().toISOString().split('T')[0])
    if (!paid_at) return
    const res = await fetch('/api/invoices', {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ id: invoice.id, status:'recebido', paid_at })
    })
    const data = await res.json()
    if (data.success) { fetchAll(); alert('Recebido! Contas a pagar geradas para Victor e Fabrício.') }
  }

  async function deleteInvoice(id) {
    if (!confirm('Excluir fatura?')) return
    await fetch('/api/invoices', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id }) })
    fetchAll()
  }

  const fmt = v => v != null ? `R$ ${parseFloat(v).toFixed(2).replace('.',',')}` : '-'
  const STATUS_COLORS = { pendente:'bg-yellow-500/20 text-yellow-400', recebido:'bg-green-500/20 text-green-400' }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Faturamento</h2>
          <p className="text-gray-400 text-sm mt-1">{activeCompany.name}</p>
        </div>
        <div className="flex gap-2 items-center">
          <input type="number" value={filterYear} onChange={e=>setFilterYear(e.target.value)} className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white text-sm focus:outline-none"/>
          <button onClick={()=>setShowContractModal(true)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium">📄 Contrato</button>
          <button onClick={()=>setShowAgendaModal(true)} className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-medium">📅 Agenda</button>
        </div>
      </div>

      {loading ? <div className="text-gray-500 text-sm">Carregando...</div> : invoices.length === 0 ? (
        <div className="text-center py-16 text-gray-600"><p className="text-4xl mb-3">🧾</p><p>Nenhuma fatura gerada.</p></div>
      ) : (
        <div className="space-y-3">
          {invoices.map(inv => (
            <div key={inv.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-400 text-xs rounded-full">{inv.client_name}</span>
                    <span className="text-gray-400 text-xs">{months[inv.month-1]}/{inv.year}</span>
                    {inv.invoice_number && <span className="text-gray-500 text-xs">NF: {inv.invoice_number}</span>}
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[inv.status]||'bg-gray-700 text-gray-400'}`}>{inv.status}</span>
                    <span className="text-gray-600 text-xs">{inv.billing_type==='contract'?'📄 Contrato':'📅 Agenda'}</span>
                  </div>
                  {inv.contract_name && <p className="text-gray-400 text-sm mb-2">{inv.contract_name}</p>}
                  <div className="bg-gray-800 rounded-lg p-3 space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-gray-400">Valor NF</span><span className="text-white font-medium">{fmt(inv.invoice_value)}</span></div>
                    {parseFloat(inv.tax_amount)>0 && <div className="flex justify-between"><span className="text-gray-400">Imposto</span><span className="text-red-400">-{fmt(inv.tax_amount)}</span></div>}
                    {parseFloat(inv.victor_tax_diff)>0 && <div className="flex justify-between"><span className="text-gray-400">Diferença NF → imposto Victor</span><span className="text-orange-400">{fmt(inv.victor_tax_diff)}</span></div>}
                    <div className="border-t border-gray-700 pt-1 mt-1 space-y-1">
                      <div className="flex justify-between"><span className="text-gray-400">Victor serviço</span><span className="text-blue-300">{fmt(inv.victor_service)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-400">Victor lucro</span><span className="text-blue-300">{fmt(inv.victor_profit)}</span></div>
                      <div className="flex justify-between font-semibold"><span className="text-gray-300">Victor TOTAL</span><span className="text-blue-400">{fmt(inv.victor_total)}</span></div>
                    </div>
                    <div className="flex justify-between font-semibold border-t border-gray-700 pt-1"><span className="text-gray-300">Fabrício TOTAL</span><span className="text-purple-400">{fmt(inv.fabricio_total)}</span></div>
                  </div>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  {inv.status==='pendente' && <button onClick={()=>markReceived(inv)} className="px-3 py-1 bg-green-700 hover:bg-green-600 text-white rounded-lg text-xs">✓ Recebi</button>}
                  <button onClick={()=>deleteInvoice(inv.id)} className="text-gray-600 hover:text-red-400 text-xs">Excluir</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showContractModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-white mb-4">Gerar Fatura — Contrato</h3>
            <div className="space-y-3">
              <select value={contractForm.contract_id} onChange={e=>setContractForm(f=>({...f,contract_id:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                <option value="">Selecione o contrato</option>
                {contracts.filter(c=>c.is_active).map(c=><option key={c.id} value={c.id}>{c.name} — {c.client_name}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-3">
                <select value={contractForm.month} onChange={e=>setContractForm(f=>({...f,month:parseInt(e.target.value)}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                  {months.map((m,i)=><option key={i} value={i+1}>{m}</option>)}
                </select>
                <input type="number" value={contractForm.year} onChange={e=>setContractForm(f=>({...f,year:parseInt(e.target.value)}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
              </div>
              <input placeholder="Valor da nota fiscal (R$)" type="number" value={contractForm.invoice_value} onChange={e=>setContractForm(f=>({...f,invoice_value:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
              <input placeholder="Número da NF (opcional)" value={contractForm.invoice_number} onChange={e=>setContractForm(f=>({...f,invoice_number:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
              <textarea placeholder="Observações" value={contractForm.notes} onChange={e=>setContractForm(f=>({...f,notes:e.target.value}))} rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"/>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={()=>setShowContractModal(false)} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Cancelar</button>
              <button onClick={saveContractInvoice} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium">Gerar Fatura</button>
            </div>
          </div>
        </div>
      )}

      {showAgendaModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-white mb-4">Gerar Fatura — Por Agenda</h3>
            <div className="space-y-3">
              <select value={agendaForm.client_id} onChange={e=>{const v=e.target.value;setAgendaForm(f=>({...f,client_id:v}));fetchEntries(v,agendaForm.month,agendaForm.year)}} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                <option value="">Selecione o cliente</option>
                {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-3">
                <select value={agendaForm.month} onChange={e=>{const v=parseInt(e.target.value);setAgendaForm(f=>({...f,month:v}));fetchEntries(agendaForm.client_id,v,agendaForm.year)}} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                  {months.map((m,i)=><option key={i} value={i+1}>{m}</option>)}
                </select>
                <input type="number" value={agendaForm.year} onChange={e=>{const v=parseInt(e.target.value);setAgendaForm(f=>({...f,year:v}));fetchEntries(agendaForm.client_id,agendaForm.month,v)}} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
              </div>
              <input placeholder="Número da NF (opcional)" value={agendaForm.invoice_number} onChange={e=>setAgendaForm(f=>({...f,invoice_number:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
              {timeEntries.length > 0 && (
                <div className="bg-gray-800 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-gray-400 text-xs uppercase tracking-wider">Selecione as agendas</p>
                    <button onClick={()=>setSelectedEntries(timeEntries.map(e=>e.id))} className="text-blue-400 text-xs">Selecionar todas</button>
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {timeEntries.map(e=>(
                      <label key={e.id} className="flex items-start gap-2 cursor-pointer hover:bg-gray-700 p-1 rounded">
                        <input type="checkbox" checked={selectedEntries.includes(e.id)} onChange={()=>toggleEntry(e.id)} className="mt-0.5 rounded"/>
                        <div>
                          <p className="text-white text-xs font-medium">{new Date(e.entry_date).toLocaleDateString('pt-BR',{timeZone:'UTC'})} — <span className="text-blue-400">{parseFloat(e.hours).toFixed(2)}h</span></p>
                          {e.hora_inicial && <p className="text-gray-500 text-xs">{e.hora_inicial} → {e.hora_final}{e.intervalo_inicio?` (int: ${e.intervalo_inicio}-${e.intervalo_fim})`:''}</p>}
                          {e.description && <p className="text-gray-500 text-xs truncate">{e.description}</p>}
                        </div>
                      </label>
                    ))}
                  </div>
                  {selectedEntries.length > 0 && (() => {
                    const selected = timeEntries.filter(e => selectedEntries.includes(e.id))
                    const totalHours = selected.reduce((s,e) => s + (parseFloat(e.hours)||0), 0)
                    const totalMins = Math.round(totalHours * 60)
                    const hh = Math.floor(totalMins / 60)
                    const mm = totalMins % 60
                    const horasStr = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`
                    const hourlyRate = parseFloat(selected.find(e=>e.hourly_rate)?.hourly_rate) || 0
                    const grossTotal = selected.reduce((s,e) => s + (parseFloat(e.gross_value)||0), 0)
                    const taxTotal = selected.reduce((s,e) => s + (parseFloat(e.tax_amount)||0), 0)
                    const victorTotal = selected.reduce((s,e) => s + (parseFloat(e.victor_share)||0), 0)
                    const fabricioTotal = selected.reduce((s,e) => s + (parseFloat(e.fabricio_share)||0), 0)
                    const fmt = v => `R$ ${parseFloat(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`
                    return (
                      <div className="bg-gray-700/50 rounded-xl p-3 mt-2 space-y-2 text-xs">
                        <p className="text-blue-400 font-medium">{selectedEntries.length} agenda(s) selecionada(s)</p>
                        <div className="space-y-1.5">
                          <div className="flex justify-between">
                            <span className="text-gray-400">Total de horas</span>
                            <span className="text-white font-bold">{horasStr}</span>
                          </div>
                          {hourlyRate > 0 && (
                            <div className="flex justify-between">
                              <span className="text-gray-400">Valor da hora</span>
                              <span className="text-white">{fmt(hourlyRate)}</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-gray-400">Total bruto</span>
                            <span className="text-white">{fmt(grossTotal)}</span>
                          </div>
                          {taxTotal > 0 && (
                            <div className="flex justify-between">
                              <span className="text-gray-400">Imposto ({((taxTotal/grossTotal)*100).toFixed(1)}%)</span>
                              <span className="text-red-400">-{fmt(taxTotal)}</span>
                            </div>
                          )}
                          <div className="border-t border-gray-600 pt-1.5 space-y-1">
                            <div className="flex justify-between">
                              <span className="text-gray-400">Victor</span>
                              <span className="text-blue-400 font-medium">{fmt(victorTotal)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400">Fabrício</span>
                              <span className="text-purple-400 font-medium">{fmt(fabricioTotal)}</span>
                            </div>
                          </div>
                          <div className="flex justify-between border-t border-gray-600 pt-1.5">
                            <span className="text-white font-semibold">TOTAL A FATURAR</span>
                            <span className="text-green-400 font-bold text-sm">{fmt(grossTotal)}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )}
              {timeEntries.length===0 && agendaForm.client_id && <p className="text-gray-500 text-sm text-center py-4">Nenhuma agenda encontrada para este cliente/período.</p>}
              <textarea placeholder="Observações" value={agendaForm.notes} onChange={e=>setAgendaForm(f=>({...f,notes:e.target.value}))} rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"/>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={()=>{setShowAgendaModal(false);setTimeEntries([]);setSelectedEntries([])}} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Cancelar</button>
              <button onClick={saveAgendaInvoice} disabled={selectedEntries.length===0} className="flex-1 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium">Gerar Fatura</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
