import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'

const STATUS_OPTIONS = ['nova', 'pendente', 'em análise', 'em andamento', 'resolvida', 'cancelada']

const STATUS_COLORS = {
  'nova': 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400',
  'em análise': 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-400',
  'pendente': 'bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-400',
  'em andamento': 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-400',
  'resolvida': 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400',
  'cancelada': 'bg-subtle/20 text-muted',
}

export default function Demands() {
  const { activeCompany } = useOutletContext()
  const [demands, setDemands] = useState([])
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterClient, setFilterClient] = useState('')
  const [form, setForm] = useState({
    sender_name: '',
    sender_email: '',
    subject: '',
    body: '',
    status: 'nova',
  })
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    fetchAll()
  }, [activeCompany])

  // Fecha o modal ao trocar de empresa: o save envia company_id da empresa
  // ativa, então um modal aberto gravaria na empresa errada.
  useEffect(() => {
    setShowModal(false)
    setForm({ sender_name: '', sender_email: '', subject: '', body: '', status: 'nova' })
    setErro('')
    setFilterClient('')
  }, [activeCompany])

  async function fetchAll() {
    setLoading(true)
    try {
      const [demandsRes, clientsRes] = await Promise.all([
        fetch(`/api/demands?company_id=${activeCompany.id}`),
        fetch(`/api/clients?company_id=${activeCompany.id}`),
      ])
      const demandsData = await demandsRes.json()
      const clientsData = await clientsRes.json()
      setDemands(demandsData.demands || [])
      setClients(clientsData.clients || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function fetchDemands() {
    try {
      const res = await fetch(`/api/demands?company_id=${activeCompany.id}`)
      const data = await res.json()
      setDemands(data.demands || [])
    } catch (e) {
      console.error(e)
    }
  }

  function closeModal() {
    setShowModal(false)
    setForm({ sender_name: '', sender_email: '', subject: '', body: '', status: 'nova' })
    setErro('')
  }

  async function createDemand() {
    if (saving) return
    setSaving(true)
    setErro('')
    try {
      const res = await fetch('/api/demands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, company_id: activeCompany.id }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErro(data.error || 'Não foi possível salvar a demanda.')
        return
      }
      closeModal()
      fetchDemands()
    } catch {
      setErro('Erro de conexão com o servidor.')
    } finally {
      setSaving(false)
    }
  }

  async function updateStatus(id, status) {
    try {
      const res = await fetch('/api/demands', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      // O select é controlado por d.status: numa falha ele voltava sozinho ao
      // valor antigo, sem nenhuma mensagem — parecia um bug aleatório.
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert('Não foi possível alterar o status: ' + (data.error || 'erro no servidor'))
      }
      fetchDemands()
    } catch {
      alert('Erro de conexão ao alterar o status.')
    }
  }

  async function syncEmails() {
    setSyncing(true)
    try {
      const res = await fetch('/api/ingest-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: activeCompany.id }),
      })
      const data = await res.json()
      const falhas = data.errors?.length || 0
      if (data.success) {
        alert(`Sincronização concluída: ${data.imported} e-mail(s) importado(s).`)
        fetchDemands()
      } else if (data.imported > 0) {
        // Sucesso parcial: parte entrou, parte falhou. Os que falharam continuam
        // não lidos no servidor e serão tentados de novo na próxima sincronização.
        alert(`Sincronização parcial: ${data.imported} importado(s), ${falhas} com erro.\n\nOs que falharam serão tentados novamente.`)
        fetchDemands()
      } else {
        alert('Erro: ' + (data.error || `Falha na sincronização (${falhas} erro(s)).`))
      }
    } catch (e) {
      alert('Erro de conexão com o servidor.')
    } finally {
      setSyncing(false)
    }
  }

  const getClientName = (client_id) => {
    if (!client_id) return null
    const client = clients.find(c => c.id === client_id)
    return client ? client.name : null
  }

  const filtered = demands.filter(d => {
    if (filterStatus && d.status !== filterStatus) return false
    if (filterClient && String(d.client_id) !== String(filterClient)) return false
    return true
  })

  const clientsWithDemands = clients.filter(c =>
    demands.some(d => String(d.client_id) === String(c.id))
  )

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-text">Demandas</h2>
          <p className="text-muted text-sm mt-1">{activeCompany.name}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={syncEmails}
            disabled={syncing}
            className="px-4 py-2 bg-surface-3 hover:bg-surface-4 disabled:opacity-50 text-text rounded-lg text-sm font-medium transition-colors"
          >
            {syncing ? 'Sincronizando...' : '📧 Sincronizar e-mails'}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            + Nova demanda
          </button>
        </div>
      </div>

      {/* Filtro por cliente */}
      {clientsWithDemands.length > 0 && (
        <div className="flex gap-2 mb-3 flex-wrap">
          <button
            onClick={() => setFilterClient('')}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filterClient === '' ? 'bg-surface-4 text-text' : 'bg-surface-2 text-muted hover:bg-surface-3'
            }`}
          >
            Todos os clientes
          </button>
          {clientsWithDemands.map(c => (
            <button
              key={c.id}
              onClick={() => setFilterClient(String(c.id))}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filterClient === String(c.id) ? 'bg-indigo-600 text-white' : 'bg-surface-2 text-muted hover:bg-surface-3'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* Filtro por status */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {STATUS_OPTIONS.map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filterStatus === s ? 'bg-surface-4 text-text' : 'bg-surface-2 text-muted hover:bg-surface-3'
            }`}
          >
            {s}
          </button>
        ))}
        <button
          onClick={() => setFilterStatus('')}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            filterStatus === '' ? 'bg-surface-4 text-text' : 'bg-surface-2 text-muted hover:bg-surface-3'
          }`}
        >
          Todos
        </button>
      </div>

      {/* Contador */}
      <p className="text-subtle text-xs mb-4">{filtered.length} demanda(s)</p>

      {/* List */}
      {loading ? (
        <div className="text-subtle text-sm">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-faint">
          <p className="text-4xl mb-3">📭</p>
          <p>Nenhuma demanda encontrada.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(d => (
            <div key={d.id} className="bg-surface shadow-sm dark:shadow-none border border-border rounded-xl p-4 hover:border-border-strong transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {getClientName(d.client_id) && (
                      <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400 text-xs rounded-full font-medium">
                        {getClientName(d.client_id)}
                      </span>
                    )}
                  </div>
                  <p className="text-text font-medium truncate">{d.subject || '(sem assunto)'}</p>
                  <p className="text-muted text-sm mt-1">{d.sender_name} {d.sender_email ? `<${d.sender_email}>` : ''}</p>
                  {d.body && <p className="text-subtle text-sm mt-2 line-clamp-2">{d.body}</p>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <select
                    value={d.status}
                    onChange={e => updateStatus(d.id, e.target.value)}
                    className="bg-surface-2 border border-border-strong text-text-3 text-xs rounded-lg px-2 py-1"
                  >
                    {STATUS_OPTIONS.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[d.status] || 'bg-surface-3 text-text-3'}`}>
                    {d.status}
                  </span>
                </div>
              </div>
              <p className="text-faint text-xs mt-3">
                {d.received_at ? new Date(d.received_at).toLocaleDateString('pt-BR', {timeZone:'UTC'}) : new Date(d.created_at).toLocaleDateString('pt-BR', {timeZone:'UTC'})}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface shadow-sm dark:shadow-none border border-border rounded-2xl p-6 w-full max-w-lg">
            <h3 className="text-lg font-bold text-text mb-4">Nova demanda</h3>
            <div className="space-y-3">
              <input
                placeholder="Nome do remetente"
                value={form.sender_name}
                onChange={e => setForm(f => ({ ...f, sender_name: e.target.value }))}
                className="w-full bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-text text-sm placeholder-subtle focus:outline-none focus:border-blue-500"
              />
              <input
                placeholder="E-mail do remetente"
                value={form.sender_email}
                onChange={e => setForm(f => ({ ...f, sender_email: e.target.value }))}
                className="w-full bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-text text-sm placeholder-subtle focus:outline-none focus:border-blue-500"
              />
              <input
                placeholder="Assunto"
                value={form.subject}
                onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                className="w-full bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-text text-sm placeholder-subtle focus:outline-none focus:border-blue-500"
              />
              <textarea
                placeholder="Descrição / corpo da mensagem"
                value={form.body}
                onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                rows={4}
                className="w-full bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-text text-sm placeholder-subtle focus:outline-none focus:border-blue-500 resize-none"
              />
              <select
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="w-full bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-blue-500"
              >
                {STATUS_OPTIONS.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            {erro && (
              <p className="mt-3 text-red-700 dark:text-red-400 text-xs bg-red-50 dark:bg-red-500/10 border border-red-300 dark:border-red-500/30 rounded-lg px-3 py-2">{erro}</p>
            )}
            <div className="flex gap-3 mt-5">
              <button
                onClick={closeModal}
                className="flex-1 py-2 bg-surface-2 hover:bg-surface-3 text-text-3 rounded-lg text-sm transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={createDemand}
                disabled={saving}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
              >
                {saving ? 'Salvando...' : 'Criar demanda'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
