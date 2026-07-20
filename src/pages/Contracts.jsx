import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'

const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

const EMPTY_FORM = {
  client_id: '', name: '', cnpj: '', billing_type: 'mensal', contract_value: '', victor_fixed: '',
  remainder_victor_pct: '50', remainder_fabricio_pct: '50',
  has_tax: false, tax_percentage: '', tax_client_percent: '', tax_client_nf: '', notes: '',
  deslocamento_tipo: 'nao_cobrado', deslocamento_valor_hora: '', displacement_hours: '', financial_rule_id: '',
  projeto_split_mode: 'direct_split', projeto_victor_pct: '', projeto_victor_fixed: '', projeto_expenses: '',
}

const SPLIT_MODE_LABEL = {
  percent_victor: 'Victor % primeiro, depois split',
  fixed_victor: 'Victor valor fixo, depois split',
  direct_split: 'Split direto (sem prioridade)',
  expenses: 'Despesas p/ Victor, depois split',
}

export default function Contracts() {
  const { activeCompany } = useOutletContext()
  const [contracts, setContracts] = useState([])
  const [clients, setClients] = useState([])
  const [contractMonths, setContractMonths] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showMonthModal, setShowMonthModal] = useState(false)
  const [editContract, setEditContract] = useState(null)
  const [selectedContract, setSelectedContract] = useState(null)
  const [filterYear, setFilterYear] = useState(new Date().getFullYear())
  const [form, setForm] = useState(EMPTY_FORM)
  const [clientRules, setClientRules] = useState([])
  const [rulesLoading, setRulesLoading] = useState(false)
  const [installments, setInstallments] = useState([])
  const [deletedInstallments, setDeletedInstallments] = useState([])
  const [savingContract, setSavingContract] = useState(false)
  const [monthForm, setMonthForm] = useState({
    contract_id: '', client_id: '', month: new Date().getMonth() + 1,
    year: new Date().getFullYear(), invoice_value: '', notes: '',
  })

  useEffect(() => { fetchAll() }, [activeCompany, filterYear])

  async function fetchAll() {
    setLoading(true)
    try {
      const [cr, cl, cm] = await Promise.all([
        fetch(`/api/contracts?company_id=${activeCompany.id}`),
        fetch(`/api/clients?company_id=${activeCompany.id}`),
        fetch(`/api/contract-months?company_id=${activeCompany.id}&year=${filterYear}`),
      ])
      setContracts((await cr.json()).contracts || [])
      setClients((await cl.json()).clients || [])
      setContractMonths((await cm.json()).months || [])
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }

  async function loadRulesForClient(clientId) {
    if (!clientId) { setClientRules([]); return }
    setRulesLoading(true)
    try {
      const r = await fetch(`/api/financial-rules?client_id=${clientId}`)
      setClientRules((await r.json()).rules || [])
    } catch(e) { console.error(e); setClientRules([]) }
    finally { setRulesLoading(false) }
  }

  function openNew() {
    setEditContract(null)
    setForm(EMPTY_FORM)
    setClientRules([])
    setInstallments([])
    setDeletedInstallments([])
    setShowModal(true)
  }

  async function loadInstallments(contractId) {
    if (!contractId) { setInstallments([]); return }
    try {
      const r = await fetch(`/api/project-installments?contract_id=${contractId}`)
      setInstallments((await r.json()).installments || [])
    } catch(e) { console.error(e); setInstallments([]) }
  }

  function addInstallment() {
    setInstallments(list => [...list, {
      _key: `new-${Date.now()}-${list.length}`,
      installment_number: list.length + 1,
      description: '', value: '', due_date: '',
      status: 'pendente', invoice_id: null,
    }])
  }

  function updateInstallment(idx, patch) {
    setInstallments(list => list.map((it, i) => i === idx ? { ...it, ...patch } : it))
  }

  function removeInstallment(idx) {
    const it = installments[idx]
    if (it.invoice_id) { alert('Parcela já faturada. Estorne a fatura antes de excluir.'); return }
    if (it.id) setDeletedInstallments(d => [...d, it.id])
    setInstallments(list => list.filter((_, i) => i !== idx))
  }

  // Salva/atualiza/remove as parcelas de um contrato por projeto.
  async function persistInstallments(contractId) {
    for (const id of deletedInstallments) {
      await fetch(`/api/project-installments?id=${id}`, { method: 'DELETE' })
    }
    for (const [i, it] of installments.entries()) {
      if (it.invoice_id) continue   // faturada: imutável
      const body = {
        contract_id: contractId,
        installment_number: i + 1,
        description: it.description || null,
        value: parseFloat(it.value) || 0,
        due_date: it.due_date || null,
      }
      if (it.id) {
        await fetch(`/api/project-installments?id=${it.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
      } else {
        await fetch('/api/project-installments', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
      }
    }
  }

  async function saveContract() {
    if (!form.client_id || !form.name || !form.financial_rule_id) return
    const isProjeto = form.billing_type === 'por_projeto'
    // Por projeto: o valor vem da soma das parcelas, então exige ao menos uma.
    if (isProjeto ? installments.length === 0 : !form.contract_value) return
    if (savingContract) return
    setSavingContract(true)
    try {
      const payload = isProjeto
        ? { ...form, contract_value: installmentsTotal, victor_fixed: 0 }
        : form
      const method = editContract ? 'PATCH' : 'POST'
      const body = editContract ? { id: editContract.id, ...payload, is_active: true } : { ...payload, company_id: activeCompany.id }
      const res = await fetch('/api/contracts', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      const contractId = editContract ? editContract.id : data.contract?.id
      if (!contractId) { alert('Erro ao salvar contrato: ' + (data.error || 'Falha')); return }
      if (isProjeto) await persistInstallments(contractId)

      setShowModal(false)
      setEditContract(null)
      setForm(EMPTY_FORM)
      setClientRules([])
      setInstallments([])
      setDeletedInstallments([])
      fetchAll()
    } catch(e) {
      console.error(e)
      alert('Erro ao salvar contrato.')
    } finally {
      setSavingContract(false)
    }
  }

  async function saveMonth() {
    if (!monthForm.contract_id) return
    await fetch('/api/contract-months', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...monthForm, company_id: activeCompany.id }) })
    setShowMonthModal(false)
    setMonthForm({ contract_id: '', client_id: '', month: new Date().getMonth() + 1, year: new Date().getFullYear(), invoice_value: '', notes: '' })
    fetchAll()
  }

  async function deleteContract(id) {
    if (!confirm('Excluir contrato?')) return
    await fetch('/api/contracts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    fetchAll()
  }

  async function deleteMonth(id) {
    if (!confirm('Excluir este lançamento?')) return
    await fetch('/api/contract-months', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    fetchAll()
  }

  function openEdit(c) {
    setEditContract(c)
    const base = parseFloat(c.contract_value) || 0
    const pct = parseFloat(c.tax_client_percent) || 0
    const nf = base > 0 && pct > 0 && pct < 100 ? (base / (1 - pct / 100)).toFixed(2) : ''
    setForm({ client_id: c.client_id, name: c.name, cnpj: c.cnpj || '', billing_type: c.billing_type || 'mensal', contract_value: c.contract_value, victor_fixed: c.victor_fixed, remainder_victor_pct: c.remainder_victor_pct, remainder_fabricio_pct: c.remainder_fabricio_pct, has_tax: c.has_tax, tax_percentage: c.tax_percentage || '', tax_client_percent: c.tax_client_percent || '', tax_client_nf: nf, notes: c.notes || '', deslocamento_tipo: c.deslocamento_tipo || 'nao_cobrado', deslocamento_valor_hora: c.deslocamento_valor_hora || '', displacement_hours: c.displacement_hours || '', financial_rule_id: c.financial_rule_id ? String(c.financial_rule_id) : '', projeto_split_mode: c.projeto_split_mode || 'direct_split', projeto_victor_pct: c.projeto_victor_pct || '', projeto_victor_fixed: c.projeto_victor_fixed || '', projeto_expenses: c.projeto_expenses || '' })
    loadRulesForClient(c.client_id)
    setDeletedInstallments([])
    if ((c.billing_type || 'mensal') === 'por_projeto') loadInstallments(c.id)
    else setInstallments([])
    setShowModal(true)
  }

  function openMonth(c) {
    setSelectedContract(c)
    setMonthForm(f => ({ ...f, contract_id: c.id, client_id: c.client_id, invoice_value: c.contract_value }))
    setShowMonthModal(true)
  }

  // Base do gross-up: por projeto é a soma das parcelas; nos demais, o valor do contrato.
  function taxBase() {
    return form.billing_type === 'por_projeto'
      ? installments.reduce((s, it) => s + (parseFloat(it.value) || 0), 0)
      : parseFloat(form.contract_value) || 0
  }

  function onTaxPercentChange(v) {
    const base = taxBase()
    const percent = parseFloat(v)
    let nf = ''
    if (base > 0 && !isNaN(percent) && percent < 100) {
      nf = (base / (1 - percent / 100)).toFixed(2)
    }
    setForm(f => ({ ...f, tax_client_percent: v, tax_client_nf: nf }))
  }

  function onTaxNfChange(v) {
    const base = taxBase()
    const nf = parseFloat(v)
    let percent = ''
    if (!isNaN(nf) && nf > 0) {
      percent = ((nf - base) / nf * 100).toFixed(2)
    }
    setForm(f => ({ ...f, tax_client_nf: v, tax_client_percent: percent }))
  }

  const fmt = (v) => v != null ? `R$ ${parseFloat(v).toFixed(2).replace('.', ',')}` : '-'
  const isProjeto = form.billing_type === 'por_projeto'
  const installmentsTotal = installments.reduce((s, it) => s + (parseFloat(it.value) || 0), 0)
  const valuePlaceholder = form.billing_type === 'hora' ? 'Valor por hora (R$)' : form.billing_type === 'dia' ? 'Valor por dia (R$)' : 'Valor do contrato líquido (R$)'
  const victorPlaceholder = form.billing_type === 'hora' ? 'Valor fixo Victor por hora (R$)' : form.billing_type === 'dia' ? 'Valor fixo Victor por dia (R$)' : 'Valor fixo Victor (R$)'
  const BILLING_BADGE = {
    mensal: { label: 'Mensal', cls: 'bg-gray-700 text-gray-300' },
    hora: { label: 'Por hora', cls: 'bg-blue-500/20 text-blue-400' },
    dia: { label: 'Por dia', cls: 'bg-green-500/20 text-green-400' },
    por_projeto: { label: 'Por projeto', cls: 'bg-amber-500/20 text-amber-400' },
  }
  const DESLOC_LABEL = {
    nao_cobrado: 'Não cobrado ao cliente',
    hora: 'Cobrado por hora',
    hora_despesas: 'Cobrado por hora + despesas',
  }
  const totalVictor = contractMonths.reduce((s, m) => s + (parseFloat(m.victor_share) || 0), 0)
  const totalFab = contractMonths.reduce((s, m) => s + (parseFloat(m.fabricio_share) || 0), 0)

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Contratos</h2>
          <p className="text-gray-400 text-sm mt-1">{activeCompany.name}</p>
        </div>
        <button onClick={openNew} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium">+ Novo contrato</button>
      </div>

      {/* Contratos ativos */}
      <h3 className="text-gray-400 text-xs uppercase tracking-wider mb-3">Contratos ativos</h3>
      <div className="space-y-3 mb-8">
        {contracts.filter(c => c.is_active).map(c => (
          <div key={c.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-white font-semibold">{c.name}</p>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${(BILLING_BADGE[c.billing_type] || BILLING_BADGE.mensal).cls}`}>{(BILLING_BADGE[c.billing_type] || BILLING_BADGE.mensal).label}</span>
                </div>
                <p className="text-indigo-400 text-sm">{c.client_name}</p>
                <div className="flex gap-4 mt-2 text-xs text-gray-400">
                  <span>Contrato: <span className="text-white">{fmt(c.contract_value)}</span></span>
                  {c.billing_type === 'por_projeto'
                    ? <span>Divisão: <span className="text-amber-400">{SPLIT_MODE_LABEL[c.projeto_split_mode] || SPLIT_MODE_LABEL.direct_split}</span></span>
                    : <span>Victor fixo: <span className="text-blue-400">{fmt(c.victor_fixed)}</span></span>}
                  <span>Restante: <span className="text-green-400">{c.remainder_victor_pct}% V / {c.remainder_fabricio_pct}% F</span></span>
                  {c.has_tax && <span>Imposto: <span className="text-red-400">{c.tax_percentage}%</span></span>}
                  <span>Deslocamento: <span className="text-gray-300">{DESLOC_LABEL[c.deslocamento_tipo] || DESLOC_LABEL.nao_cobrado}{(c.deslocamento_tipo === 'hora' || c.deslocamento_tipo === 'hora_despesas') && parseFloat(c.deslocamento_valor_hora) > 0 ? ` (${fmt(c.deslocamento_valor_hora)}/h)` : ''}</span></span>
                </div>
                {parseFloat(c.tax_client_percent) > 0 && (() => {
                  const base = parseFloat(c.contract_value) || 0
                  const tax = parseFloat(c.tax_client_percent) || 0
                  if (c.billing_type === 'hora') {
                    const imposto = base * tax / 100
                    return (
                      <div className="flex gap-4 mt-1 text-xs text-gray-400">
                        <span>Valor hora bruto: <span className="text-white">{fmt(base)}</span></span>
                        <span>Imposto estimado/hora: <span className="text-red-400">{fmt(imposto)}</span></span>
                        <span>Valor hora líquido: <span className="text-green-400">{fmt(base - imposto)}</span></span>
                      </div>
                    )
                  }
                  const nf = base / (1 - tax / 100)
                  return (
                    <div className="flex gap-4 mt-1 text-xs text-gray-400">
                      <span>Base: <span className="text-white">{fmt(base)}</span></span>
                      <span>NF estimada: <span className="text-white">{fmt(nf)}</span></span>
                      <span>Imposto estimado: <span className="text-red-400">{fmt(nf - base)}</span></span>
                    </div>
                  )
                })()}
              </div>
              <div className="flex gap-2">
                <button onClick={() => openMonth(c)} className="px-3 py-1 bg-green-700 hover:bg-green-600 text-white rounded-lg text-xs">+ Mês</button>
                <button onClick={() => openEdit(c)} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-xs">Editar</button>
                <button onClick={() => deleteContract(c.id)} className="text-gray-600 hover:text-red-400 text-xs">Excluir</button>
              </div>
            </div>
          </div>
        ))}
        {contracts.filter(c => c.is_active).length === 0 && (
          <div className="text-center py-8 text-gray-600"><p>Nenhum contrato ativo.</p></div>
        )}
      </div>

      {/* Lançamentos mensais */}
      <div className="flex items-center gap-4 mb-4">
        <h3 className="text-gray-400 text-xs uppercase tracking-wider">Lançamentos mensais</h3>
        <input type="number" value={filterYear} onChange={e=>setFilterYear(e.target.value)} className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white text-xs focus:outline-none"/>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">Victor {filterYear}</p>
          <p className="text-blue-400 text-xl font-bold">{fmt(totalVictor)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">Fabrício {filterYear}</p>
          <p className="text-purple-400 text-xl font-bold">{fmt(totalFab)}</p>
        </div>
      </div>

      <div className="space-y-3">
        {contractMonths.map(m => (
          <div key={m.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-400 text-xs rounded-full">{m.client_name}</span>
                <span className="text-gray-400 text-xs">{months[m.month - 1]}/{m.year}</span>
              </div>
              <p className="text-white text-sm">{m.contract_name}</p>
              <div className="flex gap-4 mt-1 text-xs">
                <span className="text-gray-500">NF: <span className="text-gray-300">{fmt(m.invoice_value)}</span></span>
                <span className="text-gray-500">Líq: <span className="text-gray-300">{fmt(m.net_value)}</span></span>
                <span className="text-gray-500">Victor: <span className="text-blue-400">{fmt(m.victor_share)}</span></span>
                <span className="text-gray-500">Fab: <span className="text-purple-400">{fmt(m.fabricio_share)}</span></span>
              </div>
            </div>
            <button onClick={() => deleteMonth(m.id)} className="text-gray-600 hover:text-red-400 text-xs">Excluir</button>
          </div>
        ))}
      </div>

      {/* Modal contrato */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-white mb-4">{editContract ? 'Editar contrato' : 'Novo contrato'}</h3>
            <div className="space-y-3">
              {!editContract && (
                <select value={form.client_id} onChange={e=>{ const v = e.target.value; setForm(f=>({...f,client_id:v,financial_rule_id:''})); loadRulesForClient(v) }} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                  <option value="">Selecione o cliente</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400 font-medium">Regra Financeira</label>
                <select value={form.financial_rule_id} onChange={e=>setForm(f=>({...f,financial_rule_id:e.target.value}))} disabled={!form.client_id || rulesLoading || clientRules.length === 0} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50">
                  <option value="">{rulesLoading ? 'Carregando regras...' : 'Selecione a regra financeira'}</option>
                  {clientRules.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.client_name} — {r.hourly_rate ? `${fmt(r.hourly_rate)}/h` : `${fmt(r.victor_fixed_per_hour)} fixo`}
                    </option>
                  ))}
                </select>
                {form.client_id && !rulesLoading && clientRules.length === 0 && (
                  <p className="text-amber-400 text-xs">Este cliente não possui regra financeira. Cadastre uma antes de criar o contrato.</p>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400 font-medium">Nome do contrato</label>
                <input placeholder="Nome do contrato (ex: Stelldeck Renovação Mensal)" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400 font-medium">CNPJ (para emissão de NF)</label>
                <input placeholder="Ex: 12.345.678/0001-90 ou alfanumérico" value={form.cnpj} onChange={e=>setForm(f=>({...f,cnpj:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
              </div>
              <select value={form.billing_type} onChange={e=>setForm(f=>({...f,billing_type:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                <option value="mensal">Mensal (valor fixo por mês)</option>
                <option value="hora">Por hora</option>
                <option value="dia">Por dia</option>
                <option value="por_projeto">Por projeto (parcelas)</option>
              </select>

              <div className="bg-gray-800/50 rounded-xl p-3 space-y-2">
                <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">Deslocamento</p>
                <select value={form.deslocamento_tipo} onChange={e=>setForm(f=>({...f,deslocamento_tipo:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                  <option value="nao_cobrado">Não cobrado ao cliente</option>
                  <option value="hora">Cobrado por hora</option>
                  <option value="hora_despesas">Cobrado por hora + despesas (pedágio/combustível/almoço)</option>
                </select>
                {form.deslocamento_tipo !== 'nao_cobrado' && (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400 font-medium">Horas de deslocamento</label>
                    <input placeholder="0" type="number" step="0.5" value={form.displacement_hours} onChange={e=>setForm(f=>({...f,displacement_hours:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                  </div>
                )}
                {form.deslocamento_tipo !== 'nao_cobrado' && (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400 font-medium">Valor hora deslocamento (R$)</label>
                    <input placeholder="Vazio usa o valor/hora do contrato" type="number" value={form.deslocamento_valor_hora} onChange={e=>setForm(f=>({...f,deslocamento_valor_hora:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                  </div>
                )}
              </div>
              {!isProjeto && (
                <>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400 font-medium">Valor do contrato líquido</label>
                    <input placeholder={valuePlaceholder} type="number" value={form.contract_value} onChange={e=>setForm(f=>({...f,contract_value:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400 font-medium">Valor fixo Victor</label>
                    <input placeholder={victorPlaceholder} type="number" value={form.victor_fixed} onChange={e=>setForm(f=>({...f,victor_fixed:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                  </div>
                </>
              )}

              {isProjeto && (
                <>
                  <div className="bg-gray-800/50 rounded-xl p-3 space-y-2">
                    <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">Divisão do projeto</p>
                    <select value={form.projeto_split_mode} onChange={e=>setForm(f=>({...f,projeto_split_mode:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                      <option value="direct_split">Split direto — divide o líquido por %V/%F</option>
                      <option value="percent_victor">% Victor primeiro, depois split do restante</option>
                      <option value="fixed_victor">Valor fixo Victor primeiro, depois split do restante</option>
                      <option value="expenses">Despesas 100% Victor, depois split do restante</option>
                    </select>
                    {form.projeto_split_mode === 'percent_victor' && (
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-400 font-medium">% Victor sobre o líquido (antes do split)</label>
                        <input placeholder="Ex: 30" type="number" step="0.01" value={form.projeto_victor_pct} onChange={e=>setForm(f=>({...f,projeto_victor_pct:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                      </div>
                    )}
                    {form.projeto_split_mode === 'fixed_victor' && (
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-400 font-medium">Valor fixo Victor por parcela (R$)</label>
                        <input placeholder="Ex: 2000.00" type="number" step="0.01" value={form.projeto_victor_fixed} onChange={e=>setForm(f=>({...f,projeto_victor_fixed:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                      </div>
                    )}
                    {form.projeto_split_mode === 'expenses' && (
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-400 font-medium">Despesas por parcela — reembolso 100% Victor (R$)</label>
                        <input placeholder="Ex: 500.00" type="number" step="0.01" value={form.projeto_expenses} onChange={e=>setForm(f=>({...f,projeto_expenses:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                      </div>
                    )}
                    <p className="text-gray-500 text-xs">Imposto sempre primeiro. Depois sai a parte prioritária do Victor e só o restante é dividido por %V/%F.</p>
                  </div>

                  <div className="bg-gray-800/50 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">Parcelas</p>
                      <button type="button" onClick={addInstallment} className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs">+ Adicionar parcela</button>
                    </div>
                    {installments.length === 0 ? (
                      <p className="text-gray-500 text-xs py-2">Nenhuma parcela. Adicione ao menos uma para salvar o contrato.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-500 text-left">
                              <th className="pb-1 pr-2 font-medium w-8">Nº</th>
                              <th className="pb-1 pr-2 font-medium">Descrição</th>
                              <th className="pb-1 pr-2 font-medium w-24">Valor (R$)</th>
                              <th className="pb-1 pr-2 font-medium w-32">Vencimento</th>
                              <th className="pb-1 font-medium w-8"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {installments.map((it, idx) => (
                              <tr key={it.id || it._key}>
                                <td className="py-1 pr-2 text-gray-400">{idx + 1}</td>
                                <td className="py-1 pr-2">
                                  <input placeholder="Ex: Entrada" value={it.description || ''} disabled={!!it.invoice_id} onChange={e=>updateInstallment(idx,{description:e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white text-xs placeholder-gray-600 focus:outline-none focus:border-blue-500 disabled:opacity-50"/>
                                </td>
                                <td className="py-1 pr-2">
                                  <input placeholder="0.00" type="number" step="0.01" value={it.value ?? ''} disabled={!!it.invoice_id} onChange={e=>updateInstallment(idx,{value:e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white text-xs placeholder-gray-600 focus:outline-none focus:border-blue-500 disabled:opacity-50"/>
                                </td>
                                <td className="py-1 pr-2">
                                  <input type="date" value={it.due_date ? String(it.due_date).slice(0,10) : ''} disabled={!!it.invoice_id} onChange={e=>updateInstallment(idx,{due_date:e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white text-xs focus:outline-none focus:border-blue-500 disabled:opacity-50"/>
                                </td>
                                <td className="py-1 text-right">
                                  {it.invoice_id
                                    ? <span className="text-amber-400" title="Parcela faturada">🔒</span>
                                    : <button type="button" onClick={()=>removeInstallment(idx)} className="text-gray-600 hover:text-red-400" title="Excluir parcela">🗑</button>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-gray-700 pt-2 text-xs">
                      <span className="text-gray-400">Valor do contrato (soma das parcelas)</span>
                      <span className="text-white font-semibold">{fmt(installmentsTotal)}</span>
                    </div>
                  </div>
                </>
              )}
              <div className="flex gap-3">
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-xs text-gray-400 font-medium">% Victor</label>
                  <input placeholder="% Victor restante" type="number" value={form.remainder_victor_pct} onChange={e=>setForm(f=>({...f,remainder_victor_pct:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-xs text-gray-400 font-medium">% Fabrício</label>
                  <input placeholder="% Fabrício restante" type="number" value={form.remainder_fabricio_pct} onChange={e=>setForm(f=>({...f,remainder_fabricio_pct:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                </div>
              </div>
              <label className="flex items-center gap-2 text-gray-300 text-sm cursor-pointer">
                <input type="checkbox" checked={form.has_tax} onChange={e=>setForm(f=>({...f,has_tax:e.target.checked}))} className="rounded"/>
                Tem imposto sobre a nota?
              </label>
              {form.has_tax && <input placeholder="% imposto" type="number" value={form.tax_percentage} onChange={e=>setForm(f=>({...f,tax_percentage:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>}
              {form.has_tax && (() => {
                const base = taxBase()
                const nf = parseFloat(form.tax_client_nf)
                const imposto = !isNaN(nf) ? nf - base : (parseFloat(form.tax_client_percent) > 0 && base > 0 && parseFloat(form.tax_client_percent) < 100 ? base / (1 - parseFloat(form.tax_client_percent) / 100) - base : 0)
                return (
                  <div className="bg-gray-800/50 rounded-xl p-3 space-y-2">
                    <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">Imposto cobrado do cliente</p>
                    <div className="flex gap-3">
                      <div className="flex flex-col gap-1 flex-1">
                        <label className="text-xs text-gray-400 font-medium">% Imposto cobrado do cliente</label>
                        <input placeholder="Ex: 9.20" type="number" step="0.01" value={form.tax_client_percent} onChange={e=>onTaxPercentChange(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                      </div>
                      <div className="flex flex-col gap-1 flex-1">
                        <label className="text-xs text-gray-400 font-medium">Valor NF (bruto)</label>
                        <input placeholder="Ex: 1762.12" type="number" step="0.01" value={form.tax_client_nf} onChange={e=>onTaxNfChange(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
                      </div>
                    </div>
                    <p className="text-gray-500 text-xs">Ex: 9,20% → NF = base / (1 − 0,092)</p>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-gray-400">Imposto estimado:</span>
                      <span className="text-red-400 font-medium">{fmt(imposto)}</span>
                    </div>
                    {!isNaN(nf) && nf < base && (
                      <p className="text-red-400 text-xs">Valor NF menor que o valor base — verifique o imposto</p>
                    )}
                  </div>
                )
              })()}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400 font-medium">Observações</label>
                <textarea placeholder="Observações" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"/>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={()=>{setShowModal(false);setEditContract(null)}} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Cancelar</button>
              <button onClick={saveContract} disabled={!form.financial_rule_id || savingContract || (isProjeto && installments.length === 0)} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium">{savingContract ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal lançamento mensal */}
      {showMonthModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-white mb-1">Lançar mês</h3>
            <p className="text-indigo-400 text-sm mb-4">{selectedContract?.name}</p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <select value={monthForm.month} onChange={e=>setMonthForm(f=>({...f,month:parseInt(e.target.value)}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                  {months.map((m,i) => <option key={i} value={i+1}>{m}</option>)}
                </select>
                <input type="number" value={monthForm.year} onChange={e=>setMonthForm(f=>({...f,year:parseInt(e.target.value)}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"/>
              </div>
              <input placeholder="Valor da nota fiscal (R$)" type="number" value={monthForm.invoice_value} onChange={e=>setMonthForm(f=>({...f,invoice_value:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
              <textarea placeholder="Observações" value={monthForm.notes} onChange={e=>setMonthForm(f=>({...f,notes:e.target.value}))} rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"/>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={()=>setShowMonthModal(false)} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Cancelar</button>
              <button onClick={saveMonth} className="flex-1 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium">Lançar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
