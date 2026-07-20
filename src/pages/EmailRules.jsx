import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'

const RULE_TYPES = [
  { value: 'domain', label: 'Domínio (@empresa.com)' },
  { value: 'email', label: 'E-mail exato' },
  { value: 'keyword', label: 'Palavra-chave no assunto' },
]

export default function EmailRules() {
  const { activeCompany } = useOutletContext()
  const [rules, setRules] = useState([])
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ rule_type: 'domain', rule_value: '', target_client_id: '' })
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    fetchAll()
  }, [activeCompany])

  // Fecha o modal ao trocar de empresa: target_client_id apontaria para um
  // cliente da outra empresa e o save envia o company_id da empresa ativa.
  useEffect(() => {
    setShowModal(false)
    setForm({ rule_type: 'domain', rule_value: '', target_client_id: '' })
    setErro('')
  }, [activeCompany])

  async function fetchAll() {
    setLoading(true)
    try {
      const [rulesRes, clientsRes] = await Promise.all([
        fetch(`/api/email-rules?company_id=${activeCompany.id}`),
        fetch(`/api/clients?company_id=${activeCompany.id}`),
      ])
      const rulesData = await rulesRes.json()
      const clientsData = await clientsRes.json()
      setRules(rulesData.rules || [])
      setClients(clientsData.clients || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  function closeModal() {
    setShowModal(false)
    setForm({ rule_type: 'domain', rule_value: '', target_client_id: '' })
    setErro('')
  }

  async function createRule() {
    if (!form.rule_value || !form.target_client_id) return
    if (saving) return
    setSaving(true)
    setErro('')
    try {
      const res = await fetch('/api/email-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, company_id: activeCompany.id }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErro(data.error || 'Não foi possível salvar a regra.')
        return
      }
      closeModal()
      fetchAll()
    } catch {
      setErro('Erro de conexão com o servidor.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteRule(id) {
    if (!confirm('Excluir esta regra?')) return
    try {
      await fetch('/api/email-rules', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      fetchAll()
    } catch (e) {
      console.error(e)
    }
  }

  const ruleTypeLabel = (type) => RULE_TYPES.find(r => r.value === type)?.label || type

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Regras de Classificação</h2>
          <p className="text-gray-400 text-sm mt-1">{activeCompany.name}</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          + Nova regra
        </button>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm">Carregando...</div>
      ) : rules.length === 0 ? (
        <div className="text-center py-16 text-gray-600">
          <p className="text-4xl mb-3">📬</p>
          <p>Nenhuma regra cadastrada.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map(rule => (
            <div key={rule.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <span className="px-2 py-1 bg-gray-800 text-gray-400 text-xs rounded-lg">
                  {ruleTypeLabel(rule.rule_type)}
                </span>
                <span className="text-white font-mono text-sm">{rule.rule_value}</span>
                <span className="text-gray-500 text-sm">→</span>
                <span className="text-blue-400 text-sm font-medium">{rule.client_name || '(cliente não encontrado)'}</span>
              </div>
              <button
                onClick={() => deleteRule(rule.id)}
                className="text-gray-600 hover:text-red-400 transition-colors text-sm"
              >
                Excluir
              </button>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-white mb-4">Nova regra</h3>
            <div className="space-y-3">
              <select
                value={form.rule_type}
                onChange={e => setForm(f => ({ ...f, rule_type: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              >
                {RULE_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <input
                placeholder={form.rule_type === 'domain' ? 'empresa.com.br' : form.rule_type === 'email' ? 'nome@empresa.com' : 'palavra-chave'}
                value={form.rule_value}
                onChange={e => setForm(f => ({ ...f, rule_value: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <select
                value={form.target_client_id}
                onChange={e => setForm(f => ({ ...f, target_client_id: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              >
                <option value="">Selecione o cliente</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            {erro && (
              <p className="mt-3 text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{erro}</p>
            )}
            <div className="flex gap-3 mt-5">
              <button
                onClick={closeModal}
                className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={createRule}
                disabled={saving}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
              >
                {saving ? 'Salvando...' : 'Salvar regra'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
