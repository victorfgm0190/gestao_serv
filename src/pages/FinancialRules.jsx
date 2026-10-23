import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { tipoDaRegra, ROTULO_COBRANCA } from '../../lib/billing-type.js'

const FORM_VAZIO = {
  client_id: '', billing_type: 'hora',
  hourly_rate: '', victor_fixed_per_hour: '',
  daily_rate: '', victor_fixed_daily: '',
  monthly_fixed_value: '', victor_fixed_monthly: '',
  is_net_value: false,
  has_tax: false, tax_percentage: '',
  has_fuel: false, fuel_value: '',
  remainder_victor_pct: '50', remainder_fabricio_pct: '50',
}

// Rótulos dos dois campos de valor, por tipo. Todo input tem label visível — antes os
// dois valores do modal só tinham placeholder e, preenchidos, viravam "1500,00" e
// "1500,00" sem dizer qual era qual.
const CAMPOS_VALOR = {
  hora: [['hourly_rate', 'Valor hora (R$)'], ['victor_fixed_per_hour', 'Victor fixo por hora (R$)']],
  diaria: [['daily_rate', 'Valor da diária (R$)'], ['victor_fixed_daily', 'Victor fixo por diária (R$)']],
  projeto: [['monthly_fixed_value', 'Valor fixo mensal (R$)'], ['victor_fixed_monthly', 'Victor fixo mensal (R$)']],
}

const BADGE_COBRANCA = {
  hora: 'bg-blue-500/20 text-blue-400',
  diaria: 'bg-emerald-500/20 text-emerald-400',
  projeto: 'bg-amber-500/20 text-amber-400',
}

const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500'

export default function FinancialRules() {
  const { activeCompany } = useOutletContext()
  const [rules, setRules] = useState([])
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editRule, setEditRule] = useState(null)
  const [showClientModal, setShowClientModal] = useState(false)
  const [clientForm, setClientForm] = useState({ name: '', company_id: '1' })
  const [savingClient, setSavingClient] = useState(false)
  const [form, setForm] = useState(FORM_VAZIO)
  const [erro, setErro] = useState('')

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
    setForm(FORM_VAZIO)
    setErro('')
  }

  function openEdit(r) {
    setEditRule(r)
    setErro('')
    setForm({
      client_id: r.client_id ?? '',
      billing_type: tipoDaRegra(r),
      hourly_rate: r.hourly_rate ?? '',
      victor_fixed_per_hour: r.victor_fixed_per_hour ?? '',
      daily_rate: r.daily_rate ?? '',
      victor_fixed_daily: r.victor_fixed_daily ?? '',
      monthly_fixed_value: r.monthly_fixed_value ?? '',
      victor_fixed_monthly: r.victor_fixed_monthly ?? '',
      is_net_value: !!r.is_net_value,
      has_tax: r.has_tax ?? false,
      tax_percentage: r.tax_percentage ?? '',
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

  const somaSplit = (parseFloat(form.remainder_victor_pct) || 0) + (parseFloat(form.remainder_fabricio_pct) || 0)
  const splitOk = Math.abs(somaSplit - 100) < 0.001

  async function save() {
    setErro('')
    if (!form.client_id) { setErro('Selecione o cliente.'); return }
    const [campoValor, rotuloValor] = CAMPOS_VALOR[form.billing_type][0]
    if (!(parseFloat(form[campoValor]) > 0)) { setErro(`${rotuloValor.replace(' (R$)', '')} é obrigatório.`); return }
    if (!splitOk) { setErro(`% Victor + % Fabrício precisa somar 100% (está ${somaSplit}%).`); return }
    try {
      const url = editRule ? `/api/financial-rules?id=${editRule.id}` : '/api/financial-rules'
      const res = await fetch(url, {
        method: editRule ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      // O status não pode ser ignorado: um 422 fecharia o modal como se tivesse salvo.
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setErro(d.error || 'Não foi possível salvar a regra.')
        return
      }
      setShowModal(false)
      setEditRule(null)
      resetForm()
      fetchAll()
    } catch { setErro('Erro de conexão com o servidor.') }
  }

  async function saveClient() {
    if (!clientForm.name.trim() || savingClient) return
    setSavingClient(true)
    try {
      await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: clientForm.name.trim(), company_id: Number(clientForm.company_id) }),
      })
      setShowClientModal(false)
      setClientForm({ name: '', company_id: '1' })
      fetchAll()
    } catch(e) { console.error(e) }
    finally { setSavingClient(false) }
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
        <div className="flex items-center gap-3">
          <button onClick={() => { setClientForm({ name: '', company_id: String(activeCompany.id) }); setShowClientModal(true) }} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-sm font-medium transition-colors">
            + Novo Cliente
          </button>
          <button onClick={() => { setEditRule(null); resetForm(); setShowModal(true) }} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors">
            + Nova regra
          </button>
        </div>
      </div>

      {loading ? <div className="text-gray-500 text-sm">Carregando...</div> : rules.length === 0 ? (
        <div className="text-center py-16 text-gray-600"><p className="text-4xl mb-3">💰</p><p>Nenhuma regra financeira cadastrada.</p></div>
      ) : (
        <div className="space-y-3">
          {rules.map(r => (
            <div key={r.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-white font-semibold text-lg">{r.client_name}</p>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${BADGE_COBRANCA[tipoDaRegra(r)]}`}>{ROTULO_COBRANCA[tipoDaRegra(r)]}</span>
                    {r.is_net_value && tipoDaRegra(r) !== 'hora' && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-700 text-gray-300">Valor líquido</span>}
                  </div>
                  <div className="flex flex-wrap gap-4 mt-3 text-sm">
                    {tipoDaRegra(r) === 'hora' && <>
                      <span className="text-gray-400">Hora: <span className="text-white">{fmt(r.hourly_rate)}</span></span>
                      <span className="text-gray-400">Victor/h: <span className="text-blue-400">{fmt(r.victor_fixed_per_hour)}</span></span>
                    </>}
                    {tipoDaRegra(r) === 'diaria' && <>
                      <span className="text-gray-400">Diária: <span className="text-white">{fmt(r.daily_rate)}</span></span>
                      {parseFloat(r.victor_fixed_daily) > 0 && <span className="text-gray-400">Victor/diária: <span className="text-blue-400">{fmt(r.victor_fixed_daily)}</span></span>}
                    </>}
                    {tipoDaRegra(r) === 'projeto' && <>
                      <span className="text-gray-400">Fixo mensal: <span className="text-white">{fmt(r.monthly_fixed_value)}</span></span>
                      {parseFloat(r.victor_fixed_monthly) > 0 && <span className="text-gray-400">Victor/mês: <span className="text-blue-400">{fmt(r.victor_fixed_monthly)}</span></span>}
                    </>}
                    {r.has_tax && <span className="text-gray-400">Imposto: <span className="text-red-400">{r.tax_percentage}%{r.is_net_value && tipoDaRegra(r) !== 'hora' ? ' (por fora)' : ''}</span></span>}
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
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400 font-medium">Cliente</label>
                <select value={form.client_id} onChange={e => setForm(f=>({...f,client_id:e.target.value}))} className={inputCls}>
                  <option value="">Selecione o cliente</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400 font-medium">Tipo de cobrança</label>
                <select value={form.billing_type} onChange={e=>setForm(f=>({...f,billing_type:e.target.value}))} className={inputCls}>
                  <option value="hora">Por hora</option>
                  <option value="diaria">Por diária</option>
                  <option value="projeto">Por projeto (fixo mensal)</option>
                </select>
                {form.billing_type === 'diaria' && <p className="text-gray-500 text-xs">Cobra 1 diária por data trabalhada. Várias OS na mesma data = 1 diária; as horas são só demonstrativo.</p>}
                {form.billing_type === 'projeto' && <p className="text-gray-500 text-xs">Cobra o fixo mensal 1× por competência. As OS do mês são só demonstrativo.</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {CAMPOS_VALOR[form.billing_type].map(([campo, rotulo]) => (
                  <div key={campo} className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400 font-medium">{rotulo}</label>
                    <input type="number" step="0.01" placeholder="0,00" value={form[campo]} onChange={e=>setForm(f=>({...f,[campo]:e.target.value}))} className={inputCls}/>
                  </div>
                ))}
              </div>
              {form.billing_type !== 'hora' && (() => {
                const liq = parseFloat(form[CAMPOS_VALOR[form.billing_type][0][0]]) || 0
                const pct = form.has_tax ? (parseFloat(form.tax_percentage) || 0) : 0
                const nf = pct > 0 && pct < 100 ? liq / (1 - pct / 100) : liq
                const un = form.billing_type === 'diaria' ? 'por diária' : 'por mês'
                return (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-gray-300 text-sm cursor-pointer">
                      <input type="checkbox" checked={form.is_net_value} onChange={e=>setForm(f=>({...f,is_net_value:e.target.checked}))} className="rounded"/>
                      Valor informado é líquido (imposto por fora)
                    </label>
                    {form.is_net_value && liq > 0 && (
                      <p className="text-xs bg-gray-800/60 rounded-lg px-3 py-2 text-gray-300">
                        NF {un}: <span className="text-white font-medium">{fmt(nf)}</span>
                        <span className="text-gray-600"> | </span>Líquido: <span className="text-green-400">{fmt(liq)}</span>
                        <span className="text-gray-600"> | </span>Imposto (Victor): <span className="text-orange-400">{fmt(nf - liq)}</span>
                        {!form.has_tax && <span className="block text-gray-500 mt-1">Sem imposto marcado: a NF é o próprio valor líquido.</span>}
                      </p>
                    )}
                    {!form.is_net_value && <p className="text-gray-500 text-xs">Desmarcado: o valor é bruto e o imposto é descontado dele antes do split.</p>}
                  </div>
                )
              })()}
              <label className="flex items-center gap-2 text-gray-300 text-sm cursor-pointer">
                <input type="checkbox" checked={form.has_tax} onChange={e=>setForm(f=>({...f,has_tax:e.target.checked}))} className="rounded"/>
                Tem imposto?
              </label>
              {form.has_tax && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400 font-medium">% Imposto</label>
                  <input placeholder="ex: 7" type="number" step="0.01" value={form.tax_percentage} onChange={e=>setForm(f=>({...f,tax_percentage:e.target.value}))} className={inputCls}/>
                </div>
              )}
              <label className="flex items-center gap-2 text-gray-300 text-sm cursor-pointer">
                <input type="checkbox" checked={form.has_fuel} onChange={e=>setForm(f=>({...f,has_fuel:e.target.checked}))} className="rounded"/>
                Tem deslocamento/combustível?
              </label>
              {form.has_fuel && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400 font-medium">Valor combustível (R$)</label>
                  <input placeholder="0,00" type="number" step="0.01" value={form.fuel_value} onChange={e=>setForm(f=>({...f,fuel_value:e.target.value}))} className={inputCls}/>
                </div>
              )}
              <div className="flex gap-3">
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-xs text-gray-400 font-medium">% Victor</label>
                  <input type="number" step="0.01" value={form.remainder_victor_pct} onChange={e=>setForm(f=>({...f,remainder_victor_pct:e.target.value}))} className={inputCls}/>
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-xs text-gray-400 font-medium">% Fabrício</label>
                  <input type="number" step="0.01" value={form.remainder_fabricio_pct} onChange={e=>setForm(f=>({...f,remainder_fabricio_pct:e.target.value}))} className={inputCls}/>
                </div>
              </div>
              {!splitOk && <p className="text-amber-400 text-xs">% Victor + % Fabrício somam {somaSplit}% — precisam somar 100%.</p>}
              {erro && <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{erro}</p>}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={closeModal} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">Cancelar</button>
              <button onClick={save} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors">Salvar</button>
            </div>
          </div>
        </div>
      )}

      {showClientModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-white mb-4">Novo Cliente</h3>
            <div className="space-y-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400 font-medium">Nome do cliente</label>
                <input autoFocus placeholder="Nome do cliente" value={clientForm.name} onChange={e=>setClientForm(f=>({...f,name:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400 font-medium">Empresa</label>
                <select value={clientForm.company_id} onChange={e=>setClientForm(f=>({...f,company_id:e.target.value}))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                  <option value="1">Lumen</option>
                  <option value="2">Imperium</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => { setShowClientModal(false); setClientForm({ name: '', company_id: '1' }) }} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">Cancelar</button>
              <button onClick={saveClient} disabled={savingClient || !clientForm.name.trim()} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors">{savingClient ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
