import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'

const STATUS_OPTIONS = ['nova', 'em análise', 'pendente', 'em andamento', 'resolvida', 'cancelada']

const STATUS_COLORS = {
  'nova': 'bg-blue-500/20 text-blue-400',
  'em análise': 'bg-yellow-500/20 text-yellow-400',
  'pendente': 'bg-orange-500/20 text-orange-400',
  'em andamento': 'bg-purple-500/20 text-purple-400',
  'resolvida': 'bg-green-500/20 text-green-400',
  'cancelada': 'bg-gray-500/20 text-gray-400',
}

export default function Demands() {
  const { activeCompany } = useOutletContext()
  const [demands, setDemands] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const [form, setForm] = useState({
    sender_name: '',
    sender_email: '',
    subject: '',
    body: '',
    status: 'nova',
  })

  useEffect(() => {
    fetchDemands()
  }, [activeCompany])

  async function fetchDemands() {
    setLoading(true)
    try {
      const res = await fetch(`/api/demands?company_id=${activeCompany.id}`)
      const data = await res.json()
      setDemands(data.demands || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function createDemand() {
    try {
      await fetch('/api/demands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, company_id: activeCompany.id }),
      })
      setShowModal(false)
      setForm({ sender_name: '', sender_email: '', subject: '', body: '', status: 'nova' })
      fetchDemands()
    } catch (e) {
      console.error(e)
    }
  }

  async function updateStatus(id, status) {
    try {
      await fetch('/api/demands', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      fetchDemands()
    } catch (e) {
      console.error(e)
    }
  }

  const filtered = filterStatus ? demands.filter(d => d.status === filterStatus) : demands

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Demandas</h2>
          <p className="text-gray-400 text-sm mt-1">{activeCompany.name}</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          + Nova demanda
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <button
          onClick={() => setFilterStatus('')}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            filterStatus === '' ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          Todos
        </button>
        {STATUS_OPTIONS.map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filterStatus === s ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-gray-500 text-sm">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-600">
          <p className="text-4xl mb-3">📭</p>
          <p>Nenhuma demanda encontrada.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(d => (
            <div key={d.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium truncate">{d.subject || '(sem assunto)'}</p>
                  <p className="text-gray-400 text-sm mt-1">{d.sender_name} {d.sender_email ? `<${d.sender_email}>` : ''}</p>
                  {d.body && <p className="text-gray-500 text-sm mt-2 line-clamp-2">{d.body}</p>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <select
                    value={d.status}
                    onChange={e => updateStatus(d.id, e.target.value)}
                    className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg px-2 py-1"
                  >
                    {STATUS_OPTIONS.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[d.status] || 'bg-gray-700 text-gray-300'}`}>
                    {d.status}
                  </span>
                </div>
              </div>
              <p className="text-gray-600 text-xs mt-3">
                {d.received_at ? new Date(d.received_at).toLocaleDateString('pt-BR') : new Date(d.created_at).toLocaleDateString('pt-BR')}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-lg">
            <h3 className="text-lg font-bold text-white mb-4">Nova demanda</h3>
            <div className="space-y-3">
              <input
                placeholder="Nome do remetente"
                value={form.sender_name}
                onChange={e => setForm(f => ({ ...f, sender_name: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <input
                placeholder="E-mail do remetente"
                value={form.sender_email}
                onChange={e => setForm(f => ({ ...f, sender_email: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <input
                placeholder="Assunto"
                value={form.subject}
                onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <textarea
                placeholder="Descrição / corpo da mensagem"
                value={form.body}
                onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                rows={4}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
              />
              <select
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              >
                {STATUS_OPTIONS.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={createDemand}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Criar demanda
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
