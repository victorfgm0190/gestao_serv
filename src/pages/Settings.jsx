import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'

const REGIMES = [
  ['simples_iii', 'Simples Nacional — Anexo III'],
  ['simples_v', 'Simples Nacional — Anexo V'],
  ['lucro_presumido', 'Lucro Presumido'],
]

const EMPTY = { regime: 'simples_iii', receita_bruta_12m: '', folha_12m: '', prolabore_mensal: '', iss_percent: '5' }

export default function Settings() {
  const { activeCompany } = useOutletContext()
  const [form, setForm] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')

  useEffect(() => { fetchSettings() }, [activeCompany])

  async function fetchSettings() {
    setLoading(true)
    setMsg(''); setErro('')
    try {
      const res = await fetch(`/api/settings?company_id=${activeCompany.id}`)
      const data = (await res.json()).data
      if (data) {
        const s = (v) => (v != null && parseFloat(v)) ? String(parseFloat(v)) : ''
        setForm({
          regime: data.regime || 'simples_iii',
          receita_bruta_12m: s(data.receita_bruta_12m),
          folha_12m: s(data.folha_12m),
          prolabore_mensal: s(data.prolabore_mensal),
          iss_percent: data.iss_percent != null ? String(parseFloat(data.iss_percent)) : '5',
        })
      } else {
        setForm(EMPTY)
      }
    } catch (e) { console.error(e); setErro('Falha ao carregar configurações.') }
    finally { setLoading(false) }
  }

  async function save() {
    if (saving) return
    setSaving(true)
    setMsg(''); setErro('')
    try {
      const res = await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: activeCompany.id,
          regime: form.regime,
          receita_bruta_12m: parseFloat(form.receita_bruta_12m) || 0,
          folha_12m: parseFloat(form.folha_12m) || 0,
          prolabore_mensal: parseFloat(form.prolabore_mensal) || 0,
          iss_percent: parseFloat(form.iss_percent) || 0,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErro(data.error || 'Não foi possível salvar.')
        return
      }
      setMsg('Configurações salvas com sucesso.')
    } catch { setErro('Erro de conexão com o servidor.') }
    finally { setSaving(false) }
  }

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const isSimples = form.regime === 'simples_iii' || form.regime === 'simples_v'
  const isLucro = form.regime === 'lucro_presumido'

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Configurações</h2>
        <p className="text-gray-400 text-sm mt-1">Configuração fiscal — {activeCompany.name}</p>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm">Carregando...</div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-5">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400 font-medium uppercase tracking-wider">Regime tributário</label>
            <select value={form.regime} onChange={set('regime')} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
              {REGIMES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400 font-medium uppercase tracking-wider">Receita bruta últimos 12 meses (R$)</label>
            <input type="number" placeholder="0,00" value={form.receita_bruta_12m} onChange={set('receita_bruta_12m')} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
            <p className="text-gray-600 text-[11px]">Usada para achar a faixa do Simples (RBT12).</p>
          </div>

          {form.regime === 'simples_iii' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400 font-medium uppercase tracking-wider">Folha últimos 12 meses (R$)</label>
              <input type="number" placeholder="0,00" value={form.folha_12m} onChange={set('folha_12m')} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
              <p className="text-gray-600 text-[11px]">Salários + pró-labore + encargos. Usada no Fator R (≥ 28% → Anexo III, senão Anexo V).</p>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400 font-medium uppercase tracking-wider">Pró-labore mensal (R$)</label>
            <input type="number" placeholder="0,00" value={form.prolabore_mensal} onChange={set('prolabore_mensal')} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
            <p className="text-gray-600 text-[11px]">Base do INSS (11% até o teto).</p>
          </div>

          {isLucro && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400 font-medium uppercase tracking-wider">ISS municipal (%)</label>
              <input type="number" placeholder="5" value={form.iss_percent} onChange={set('iss_percent')} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"/>
            </div>
          )}

          {isSimples && (
            <p className="text-gray-600 text-xs border-t border-gray-800 pt-4">
              A previsão de impostos usa a faixa do Simples e o INSS sobre o pró-labore.
              O ISS não se aplica separadamente neste regime.
            </p>
          )}

          {msg && <p className="text-green-400 text-sm bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">✅ {msg}</p>}
          {erro && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{erro}</p>}

          <div className="flex justify-end pt-2">
            <button onClick={save} disabled={saving} className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium">{saving ? 'Salvando...' : 'Salvar'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
