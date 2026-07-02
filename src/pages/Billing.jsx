import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import CopyButton from '../components/CopyButton'

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
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth() + 1)
  const [filterClient, setFilterClient] = useState('')
  const [editInvoice, setEditInvoice] = useState(null)
  const [agendaRule, setAgendaRule] = useState(null)
  const [contractForm, setContractForm] = useState({ contract_id:'', month: new Date().getMonth()+1, year: new Date().getFullYear(), invoice_value:'', invoice_number:'', notes:'', tax_percentage_used:'', tax_client_percent_used:'' })
  const [agendaForm, setAgendaForm] = useState({ client_id:'', contract_id:'', month: new Date().getMonth()+1, year: new Date().getFullYear(), invoice_number:'', notes:'', tax_percentage_used:'', tax_client_percent_used:'' })

  useEffect(() => { fetchAll() }, [activeCompany, filterYear])
  useEffect(() => { setFilterClient('') }, [activeCompany, filterMonth, filterYear])

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
    const [teRes, frRes] = await Promise.all([
      fetch(`/api/time-entries?company_id=${activeCompany.id}&month=${month}&year=${year}`),
      fetch(`/api/financial-rules?client_id=${client_id}`),
    ])
    const teData = await teRes.json()
    const frData = await frRes.json()
    setTimeEntries((teData.entries||[]).filter(e => String(e.client_id) === String(client_id)))
    const rule = (frData.rules||[])[0] || null
    setAgendaRule(rule)
    setAgendaForm(f => ({ ...f, tax_percentage_used: rule && rule.has_tax ? String(rule.tax_percentage ?? '') : '0', tax_client_percent_used: f.tax_client_percent_used || '0' }))
    setSelectedEntries([])
  }

  function toggleEntry(id) {
    setSelectedEntries(p => p.includes(id) ? p.filter(x=>x!==id) : [...p,id])
  }

  function onSelectContract(contractId) {
    const c = contracts.find(x => String(x.id) === String(contractId))
    if (!c) { setContractForm(f => ({ ...f, contract_id: contractId })); return }
    const base = parseFloat(c.contract_value) || 0
    const tcp = c.has_tax ? (parseFloat(c.tax_client_percent) || 0) : 0
    const nf = tcp > 0 && tcp < 100 ? base / (1 - tcp / 100) : base
    setContractForm(f => ({
      ...f,
      contract_id: contractId,
      invoice_value: nf ? nf.toFixed(2) : (base ? base.toFixed(2) : ''),
      tax_percentage_used: c.has_tax ? String(c.tax_percentage ?? '') : '0',
      tax_client_percent_used: tcp ? String(tcp) : '0',
    }))
  }

  function onContractClientPctChange(v) {
    const c = contracts.find(x => String(x.id) === String(contractForm.contract_id))
    const base = parseFloat(c?.contract_value) || 0
    const p = parseFloat(v)
    let nf = ''
    if (base > 0 && !isNaN(p) && p < 100) nf = (base / (1 - p / 100)).toFixed(2)
    setContractForm(f => ({ ...f, tax_client_percent_used: v, invoice_value: nf }))
  }

  function onContractNfChange(v) {
    const c = contracts.find(x => String(x.id) === String(contractForm.contract_id))
    const base = parseFloat(c?.contract_value) || 0
    const nf = parseFloat(v)
    let p = ''
    if (!isNaN(nf) && nf > 0) p = ((nf - base) / nf * 100).toFixed(2)
    setContractForm(f => ({ ...f, invoice_value: v, tax_client_percent_used: p }))
  }

  async function updateContractTax(contract, overrides) {
    const body = {
      id: contract.id, name: contract.name, billing_type: contract.billing_type,
      deslocamento_tipo: contract.deslocamento_tipo, deslocamento_valor_hora: contract.deslocamento_valor_hora,
      contract_value: contract.contract_value, victor_fixed: contract.victor_fixed,
      remainder_victor_pct: contract.remainder_victor_pct, remainder_fabricio_pct: contract.remainder_fabricio_pct,
      has_tax: contract.has_tax, tax_percentage: contract.tax_percentage, tax_client_percent: contract.tax_client_percent,
      is_active: contract.is_active, financial_rule_id: contract.financial_rule_id, notes: contract.notes,
      displacement_hours: contract.displacement_hours, cnpj: contract.cnpj,
      ...overrides,
    }
    await fetch('/api/contracts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  }

  // Se o imposto usado na fatura for maior que o cadastrado, oferece atualizar o contrato
  async function maybeUpdateContractTaxes(contract) {
    const usedReal = parseFloat(contractForm.tax_percentage_used) || 0
    const contractReal = parseFloat(contract.tax_percentage) || 0
    const usedClient = parseFloat(contractForm.tax_client_percent_used) || 0
    const contractClient = parseFloat(contract.tax_client_percent) || 0
    let touched = false
    if (usedReal > contractReal) {
      if (confirm(`O imposto real aumentou de ${contractReal}% para ${usedReal}%. Deseja atualizar o contrato automaticamente?`)) {
        await updateContractTax(contract, { tax_percentage: usedReal, has_tax: true }); touched = true
      }
    }
    if (usedClient > contractClient) {
      if (confirm(`O imposto cobrado do cliente aumentou de ${contractClient}% para ${usedClient}%. Deseja atualizar o contrato automaticamente?`)) {
        await updateContractTax(contract, { tax_client_percent: usedClient, has_tax: true }); touched = true
      }
    }
    return touched
  }

  async function saveContractInvoice() {
    const contract = contracts.find(c => String(c.id) === String(contractForm.contract_id))
    if (!contract || !contractForm.invoice_value) return

    await maybeUpdateContractTaxes(contract)

    const isEdit = !!editInvoice
    const method = isEdit ? 'PUT' : 'POST'
    const body = isEdit
      ? { id: editInvoice.id, ...contractForm, billing_type: 'contract', contract_id: contract.id, client_id: contract.client_id }
      : { ...contractForm, company_id: activeCompany.id, client_id: contract.client_id, billing_type: 'contract' }

    const res = await fetch('/api/invoices', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await res.json()
    if (data.invoice || data.success) {
      setShowContractModal(false)
      setEditInvoice(null)
      fetchAll()
      if (data.breakdown) {
        const b = data.breakdown
        alert(`Fatura ${isEdit ? 'atualizada' : 'gerada'}!\n\nA Receber: R$ ${parseFloat(b.invoice_value).toFixed(2)}\n\nVictor serviço: R$ ${parseFloat(b.victor_service).toFixed(2)}\nVictor lucro: R$ ${parseFloat(b.victor_profit).toFixed(2)}\nVictor imposto NF: R$ ${parseFloat(b.victor_tax_diff||0).toFixed(2)}\nVictor TOTAL: R$ ${parseFloat(b.victor_total).toFixed(2)}\nFabrício TOTAL: R$ ${parseFloat(b.fabricio_total).toFixed(2)}`)
      }
    } else {
      alert('Erro: ' + (data.error || 'Falha'))
    }
  }

  async function saveAgendaInvoice() {
    if (!agendaForm.client_id || selectedEntries.length === 0) return
    const isEdit = !!editInvoice
    const method = isEdit ? 'PUT' : 'POST'
    const body = isEdit
      ? { id: editInvoice.id, ...agendaForm, billing_type: 'agenda', time_entry_ids: selectedEntries, client_id: agendaForm.client_id }
      : { ...agendaForm, company_id: activeCompany.id, billing_type: 'agenda', time_entry_ids: selectedEntries }

    const res = await fetch('/api/invoices', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await res.json()
    if (data.invoice || data.success) {
      setShowAgendaModal(false)
      setEditInvoice(null)
      setTimeEntries([])
      setSelectedEntries([])
      fetchAll()
      if (data.breakdown) {
        const b = data.breakdown
        alert(`Fatura ${isEdit ? 'atualizada' : 'gerada'}!\n\nTotal horas: ${b.total_hours?.toFixed(2)}h\nBruto: R$ ${parseFloat(b.invoice_value).toFixed(2)}\nImposto: R$ ${parseFloat(b.tax_amount).toFixed(2)}\n\nVictor serviço: R$ ${parseFloat(b.victor_service).toFixed(2)}\nVictor lucro: R$ ${parseFloat(b.victor_profit).toFixed(2)}\nVictor TOTAL: R$ ${parseFloat(b.victor_total).toFixed(2)}\nFabrício TOTAL: R$ ${parseFloat(b.fabricio_total).toFixed(2)}`)
      }
    } else {
      alert('Erro: ' + (data.error || 'Falha'))
    }
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

  async function estornarFatura(invoice) {
    if (!confirm('Tem certeza que deseja estornar esta fatura? Os lançamentos de Pagar Victor e Pagar Fabrício serão removidos.')) return
    const res = await fetch('/api/invoices', {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ id: invoice.id, status:'estorno' })
    })
    const data = await res.json()
    if (res.status === 400) { alert('⚠️ ' + data.error); return }
    if (data.success) { fetchAll(); alert('Fatura estornada. Lançamentos de Pagar Victor e Fabrício removidos.') }
    else { alert('Erro: ' + (data.error || 'Falha ao estornar')) }
  }

  async function deleteInvoice(id) {
    if (!confirm('Excluir fatura?')) return
    await fetch('/api/invoices', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id }) })
    fetchAll()
  }

  function openEditInvoice(inv) {
    setEditInvoice(inv)
    if (inv.billing_type === 'contract') {
      const c = contracts.find(x => String(x.id) === String(inv.contract_id))
      const base = parseFloat(c?.contract_value) || 0
      const nf = parseFloat(inv.invoice_value) || base
      const tcp = nf > 0 && nf > base ? ((nf - base) / nf * 100).toFixed(2) : (c?.has_tax ? String(c.tax_client_percent ?? '0') : '0')
      setContractForm({
        contract_id: inv.contract_id || '',
        month: inv.month,
        year: inv.year,
        invoice_value: nf ? nf.toFixed(2) : '',
        invoice_number: inv.invoice_number || '',
        notes: inv.notes || '',
        tax_percentage_used: c?.has_tax ? String(c.tax_percentage ?? '') : '0',
        tax_client_percent_used: String(tcp),
      })
      setShowContractModal(true)
    } else {
      setAgendaForm({
        client_id: inv.client_id || '',
        contract_id: inv.contract_id || '',
        month: inv.month,
        year: inv.year,
        invoice_number: inv.invoice_number || '',
        notes: inv.notes || '',
        tax_percentage_used: '',
        tax_client_percent_used: '0',
      })
      fetchEntries(inv.client_id, inv.month, inv.year)
      setShowAgendaModal(true)
    }
  }

  function openContractModal() {
    setEditInvoice(null)
    setContractForm({ contract_id:'', month: new Date().getMonth()+1, year: new Date().getFullYear(), invoice_value:'', invoice_number:'', notes:'', tax_percentage_used:'', tax_client_percent_used:'' })
    setShowContractModal(true)
  }

  function openAgendaModal() {
    setEditInvoice(null)
    setAgendaRule(null)
    setTimeEntries([])
    setSelectedEntries([])
    setAgendaForm({ client_id:'', contract_id:'', month: new Date().getMonth()+1, year: new Date().getFullYear(), invoice_number:'', notes:'', tax_percentage_used:'', tax_client_percent_used:'0' })
    setShowAgendaModal(true)
  }

  const fmt = v => v != null ? `R$ ${parseFloat(v).toFixed(2).replace('.',',')}` : '-'
  const STATUS_COLORS = { pendente:'bg-yellow-500/20 text-yellow-400', recebido:'bg-green-500/20 text-green-400' }

  // Filtros de mês (0 = todos) e cliente aplicados no frontend
  const invoicesByMonth = invoices.filter(inv => filterMonth === 0 || inv.month === filterMonth)
  // Clientes com fatura no mês/ano selecionado (derivado antes do filtro de cliente)
  const clientsWithInvoices = Array.from(
    invoicesByMonth.reduce((map, inv) => {
      if (inv.client_id != null && !map.has(inv.client_id)) map.set(inv.client_id, inv.client_name || 'Sem cliente')
      return map
    }, new Map()),
    ([id, name]) => ({ id, name })
  )
  const filteredInvoices = filterClient
    ? invoicesByMonth.filter(inv => String(inv.client_id) === String(filterClient))
    : invoicesByMonth

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Faturamento</h2>
          <p className="text-gray-400 text-sm mt-1">{activeCompany.name}</p>
        </div>
        <div className="flex gap-2 items-center">
          <button onClick={openContractModal} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium">📄 Contrato</button>
          <button onClick={openAgendaModal} className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-medium">📅 Agenda</button>
        </div>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap items-center">
        <button onClick={() => setFilterMonth(0)} className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filterMonth === 0 ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>Todos</button>
        {months.map((m, i) => (
          <button key={i} onClick={() => setFilterMonth(i+1)} className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filterMonth === i+1 ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{m}</button>
        ))}
        <input type="number" value={filterYear} onChange={e=>setFilterYear(e.target.value)} className="ml-2 w-20 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white text-xs focus:outline-none"/>
      </div>

      {clientsWithInvoices.length > 0 && (
        <div className="flex gap-2 mb-6 flex-wrap">
          <button
            onClick={() => setFilterClient('')}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filterClient === '' ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            Todos os clientes
          </button>
          {clientsWithInvoices.map(c => (
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

      {loading ? <div className="text-gray-500 text-sm">Carregando...</div> : filteredInvoices.length === 0 ? (
        <div className="text-center py-16 text-gray-600"><p className="text-4xl mb-3">🧾</p><p>Nenhuma fatura gerada.</p></div>
      ) : (
        <div className="space-y-3">
          {filteredInvoices.map(inv => (
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
                  {inv.status==='pendente' && (
                    <button onClick={()=>openEditInvoice(inv)} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-xs">✏️ Editar</button>
                  )}
                  {inv.status==='recebido' && (
                    <button onClick={()=>estornarFatura(inv)} className="px-3 py-1 border border-red-500/60 text-red-400 hover:bg-red-500/10 rounded-lg text-xs">↩ Estornar</button>
                  )}
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
            <h3 className="text-lg font-bold text-white mb-4">{editInvoice ? 'Editar Fatura' : 'Gerar Fatura — Contrato'}</h3>
            <div className="space-y-3">
              <select value={contractForm.contract_id} onChange={e=>onSelectContract(e.target.value)} disabled={!!editInvoice} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50">
                <option value="">Selecione o contrato</option>
                {contracts.filter(c=>c.is_active).map(c=><option key={c.id} value={c.id}>{c.name} — {c.client_name}</option>)}
              </select>
              {(() => {
                const c = contracts.find(x => String(x.id) === String(contractForm.contract_id))
                if (!c || !c.cnpj) return null
                return (
                  <div className="flex items-center gap-2 text-xs bg-gray-800/50 rounded-lg px-3 py-2">
                    <span className="text-gray-400 font-medium">CNPJ:</span>
                    <span className="text-white font-mono">{c.cnpj}</span>
                    <CopyButton value={c.cnpj} className="ml-auto" />
                  </div>
                )
              })()}
              <div className="grid grid-cols-2 gap-3">
                <select value={contractForm.month} onChange={e=>setContractForm(f=>({...f,month:parseInt(e.target.value)}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                  {months.map((m,i)=><option key={i} value={i+1}>{m}</option>)}
                </select>
                <input type="number" value={contractForm.year} onChange={e=>setContractForm(f=>({...f,year:parseInt(e.target.value)}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
              </div>

              {(() => {
                const c = contracts.find(x => String(x.id) === String(contractForm.contract_id))
                if (!c) return null
                const base = parseFloat(c.contract_value) || 0
                const victorFixo = parseFloat(c.victor_fixed) || 0
                const victorPct = parseFloat(c.remainder_victor_pct) || 50
                const fabPct = parseFloat(c.remainder_fabricio_pct) || 50
                const taxReal = parseFloat(contractForm.tax_percentage_used) || 0
                const nf = parseFloat(contractForm.invoice_value) || base
                const impostoReal = nf * taxReal / 100
                const diffNf = Math.max(nf - base, 0)
                const restante = Math.max(base - victorFixo, 0)
                const victorLucro = restante * victorPct / 100
                const fabricio = restante * fabPct / 100
                const victorTotal = victorFixo + victorLucro + diffNf
                const taxClient = parseFloat(contractForm.tax_client_percent_used) || 0
                return (
                  <>
                    <div className="bg-gray-800/50 rounded-xl p-3 space-y-2">
                      <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">Impostos</p>
                      <div className="flex gap-3">
                        <div className="flex flex-col gap-1 flex-1">
                          <label className="text-xs text-gray-400 font-medium">% Imposto real (Victor)</label>
                          <input type="number" step="0.01" value={contractForm.tax_percentage_used} onChange={e=>setContractForm(f=>({...f,tax_percentage_used:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
                        </div>
                        {c.has_tax && (
                          <div className="flex flex-col gap-1 flex-1">
                            <label className="text-xs text-gray-400 font-medium">% Imposto cliente</label>
                            <input type="number" step="0.01" value={contractForm.tax_client_percent_used} onChange={e=>onContractClientPctChange(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-400 font-medium">Valor NF (bruto)</label>
                        <input type="number" step="0.01" value={contractForm.invoice_value} onChange={e=>onContractNfChange(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-gray-400">Imposto estimado:</span>
                        <span className="text-red-400 font-medium">{fmt(impostoReal)}</span>
                      </div>
                    </div>

                    <div className="bg-gray-800 rounded-xl p-3 space-y-1 text-xs">
                      <p className="text-gray-400 font-medium uppercase tracking-wider mb-1">Demonstrativo</p>
                      <div className="flex justify-between"><span className="text-gray-400">Valor base</span><span className="text-white">{fmt(base)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-400">% Imposto cobrado</span><span className="text-white">{taxClient.toFixed(2).replace('.',',')}%</span></div>
                      <div className="flex justify-between"><span className="text-gray-400">Valor NF</span><span className="text-white">{fmt(nf)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-400">(-) Imposto real ({taxReal.toFixed(2).replace('.',',')}%)</span><span className="text-red-400">-{fmt(impostoReal)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-400">Diff NF → Victor</span><span className="text-orange-400">+{fmt(diffNf)}</span></div>
                      <div className="border-t border-gray-700 pt-1 mt-1 space-y-1">
                        <div className="flex justify-between"><span className="text-gray-400">Victor fixo</span><span className="text-blue-300">+{fmt(victorFixo)}</span></div>
                        <div className="flex justify-between"><span className="text-gray-400">Victor lucro</span><span className="text-blue-300">+{fmt(victorLucro)}</span></div>
                        <div className="flex justify-between font-semibold"><span className="text-gray-300">Victor total</span><span className="text-blue-400">{fmt(victorTotal)}</span></div>
                      </div>
                      <div className="flex justify-between font-semibold border-t border-gray-700 pt-1"><span className="text-gray-300">Fabrício total</span><span className="text-purple-400">{fmt(fabricio)}</span></div>
                    </div>
                  </>
                )
              })()}

              <input placeholder="Número da NF (opcional)" value={contractForm.invoice_number} onChange={e=>setContractForm(f=>({...f,invoice_number:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
              <textarea placeholder="Observações" value={contractForm.notes} onChange={e=>setContractForm(f=>({...f,notes:e.target.value}))} rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"/>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={()=>{setShowContractModal(false);setEditInvoice(null)}} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Cancelar</button>
              <button onClick={saveContractInvoice} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium">Gerar Fatura</button>
            </div>
          </div>
        </div>
      )}

      {showAgendaModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-white mb-4">{editInvoice ? 'Editar Fatura — Agenda' : 'Gerar Fatura — Por Agenda'}</h3>
            <div className="space-y-3">
              <select value={agendaForm.client_id} onChange={e=>{const v=e.target.value;setAgendaForm(f=>({...f,client_id:v,contract_id:''}));fetchEntries(v,agendaForm.month,agendaForm.year)}} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                <option value="">Selecione o cliente</option>
                {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {agendaForm.client_id && (() => {
                const doCliente = contracts.filter(c => String(c.client_id) === String(agendaForm.client_id))
                const selected = doCliente.find(x => String(x.id) === String(agendaForm.contract_id))
                return (
                  <>
                    <select value={agendaForm.contract_id} onChange={e=>setAgendaForm(f=>({...f,contract_id:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                      <option value="">Selecione o contrato</option>
                      {doCliente.map(c=><option key={c.id} value={c.id}>{c.name} — {c.billing_type === 'hora' ? 'Por hora' : c.billing_type === 'dia' ? 'Por dia' : 'Fixo/Mensal'}</option>)}
                    </select>
                    {selected && selected.cnpj && (
                      <div className="flex items-center gap-2 text-xs bg-gray-800/50 rounded-lg px-3 py-2">
                        <span className="text-gray-400 font-medium">CNPJ:</span>
                        <span className="text-white font-mono">{selected.cnpj}</span>
                        <CopyButton value={selected.cnpj} className="ml-auto" />
                      </div>
                    )}
                  </>
                )
              })()}
              <div className="grid grid-cols-2 gap-3">
                <select value={agendaForm.month} onChange={e=>{const v=parseInt(e.target.value);setAgendaForm(f=>({...f,month:v}));fetchEntries(agendaForm.client_id,v,agendaForm.year)}} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                  {months.map((m,i)=><option key={i} value={i+1}>{m}</option>)}
                </select>
                <input type="number" value={agendaForm.year} onChange={e=>{const v=parseInt(e.target.value);setAgendaForm(f=>({...f,year:v}));fetchEntries(agendaForm.client_id,agendaForm.month,v)}} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400 font-medium">Número da NF</label>
                <input placeholder="Número da NF (opcional)" value={agendaForm.invoice_number} onChange={e=>setAgendaForm(f=>({...f,invoice_number:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
              </div>
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
              {selectedEntries.length > 0 && agendaRule && (() => {
                const selected = timeEntries.filter(e => selectedEntries.includes(e.id))
                const totalHours = selected.reduce((s,e)=>s+(parseFloat(e.hours)||0),0)
                const hourlyRate = parseFloat(agendaRule.hourly_rate) || parseFloat(selected.find(e=>e.hourly_rate)?.hourly_rate) || 0
                const victorFixoHora = parseFloat(agendaRule.victor_fixed_per_hour) || 0
                const victorPct = parseFloat(agendaRule.remainder_victor_pct) || 50
                const fabPct = parseFloat(agendaRule.remainder_fabricio_pct) || 50
                const taxReal = parseFloat(agendaForm.tax_percentage_used) || 0
                const taxClient = parseFloat(agendaForm.tax_client_percent_used) || 0
                const bruto = totalHours * hourlyRate
                const impostoReal = bruto * taxReal / 100
                const net = bruto - impostoReal
                const victorServico = totalHours * victorFixoHora
                const restante = Math.max(net - victorServico, 0)
                const victorLucro = restante * victorPct / 100
                const fabricio = restante * fabPct / 100
                const nf = taxClient > 0 && taxClient < 100 ? bruto / (1 - taxClient / 100) : bruto
                const diffNf = Math.max(nf - bruto, 0)
                const victorTotal = victorServico + victorLucro + diffNf
                const onPct = (v) => { setAgendaForm(f=>({...f,tax_client_percent_used:v})) }
                const onNf = (v) => { const nfv=parseFloat(v); let p=''; if(!isNaN(nfv)&&nfv>0&&bruto>0) p=((nfv-bruto)/nfv*100).toFixed(2); setAgendaForm(f=>({...f,tax_client_percent_used:p})) }
                return (
                  <>
                    <div className="bg-gray-800/50 rounded-xl p-3 space-y-2">
                      <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">Impostos</p>
                      <div className="flex gap-3">
                        <div className="flex flex-col gap-1 flex-1">
                          <label className="text-xs text-gray-400 font-medium">% Imposto real (Victor)</label>
                          <input type="number" step="0.01" value={agendaForm.tax_percentage_used} onChange={e=>setAgendaForm(f=>({...f,tax_percentage_used:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
                        </div>
                        <div className="flex flex-col gap-1 flex-1">
                          <label className="text-xs text-gray-400 font-medium">% Imposto cliente</label>
                          <input type="number" step="0.01" value={agendaForm.tax_client_percent_used} onChange={e=>onPct(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-400 font-medium">Valor NF (bruto)</label>
                        <input type="number" step="0.01" value={nf ? nf.toFixed(2) : ''} onChange={e=>onNf(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-gray-400">Imposto estimado:</span>
                        <span className="text-red-400 font-medium">{fmt(impostoReal)}</span>
                      </div>
                    </div>

                    <div className="bg-gray-800 rounded-xl p-3 space-y-1 text-xs">
                      <p className="text-gray-400 font-medium uppercase tracking-wider mb-1">Demonstrativo</p>
                      <div className="flex justify-between"><span className="text-gray-400">Total de horas</span><span className="text-white">{totalHours.toFixed(2)}h</span></div>
                      <div className="flex justify-between"><span className="text-gray-400">Valor bruto</span><span className="text-white">{fmt(bruto)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-400">% Imposto cobrado</span><span className="text-white">{taxClient.toFixed(2).replace('.',',')}%</span></div>
                      <div className="flex justify-between"><span className="text-gray-400">Valor NF</span><span className="text-white">{fmt(nf)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-400">(-) Imposto real ({taxReal.toFixed(2).replace('.',',')}%)</span><span className="text-red-400">-{fmt(impostoReal)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-400">Diff NF → Victor</span><span className="text-orange-400">+{fmt(diffNf)}</span></div>
                      <div className="border-t border-gray-700 pt-1 mt-1 space-y-1">
                        <div className="flex justify-between"><span className="text-gray-400">Victor fixo</span><span className="text-blue-300">+{fmt(victorServico)}</span></div>
                        <div className="flex justify-between"><span className="text-gray-400">Victor lucro</span><span className="text-blue-300">+{fmt(victorLucro)}</span></div>
                        <div className="flex justify-between font-semibold"><span className="text-gray-300">Victor total</span><span className="text-blue-400">{fmt(victorTotal)}</span></div>
                      </div>
                      <div className="flex justify-between font-semibold border-t border-gray-700 pt-1"><span className="text-gray-300">Fabrício total</span><span className="text-purple-400">{fmt(fabricio)}</span></div>
                    </div>
                  </>
                )
              })()}
              {timeEntries.length===0 && agendaForm.client_id && <p className="text-gray-500 text-sm text-center py-4">Nenhuma agenda encontrada para este cliente/período.</p>}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400 font-medium">Observações</label>
                <textarea placeholder="Observações" value={agendaForm.notes} onChange={e=>setAgendaForm(f=>({...f,notes:e.target.value}))} rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"/>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={()=>{setShowAgendaModal(false);setTimeEntries([]);setSelectedEntries([]);setEditInvoice(null)}} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Cancelar</button>
              <button onClick={saveAgendaInvoice} disabled={selectedEntries.length===0} className="flex-1 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium">Gerar Fatura</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
