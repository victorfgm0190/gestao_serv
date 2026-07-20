import { useState, useEffect } from 'react'
import { isMaster } from '../lib/session'

const EMPTY = { name: '', username: '', password: '', is_admin: false, is_active: true }

export default function Users() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [salvando, setSalvando] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)

  const master = isMaster()

  useEffect(() => { if (master) fetchUsers() }, [master])

  async function fetchUsers() {
    setLoading(true)
    setErro('')
    try {
      const res = await fetch('/api/users')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Falha ao carregar usuários')
      setUsers(data.users || [])
    } catch (e) {
      setErro(e.message)
    } finally {
      setLoading(false)
    }
  }

  function openNew() {
    setEditUser(null)
    setForm(EMPTY)
    setErro('')
    setShowModal(true)
  }

  function openEdit(u) {
    setEditUser(u)
    // Senha em branco = manter a atual.
    setForm({ name: u.name, username: u.username, password: '', is_admin: u.is_admin, is_active: u.is_active })
    setErro('')
    setShowModal(true)
  }

  async function salvar() {
    if (salvando) return
    if (!form.name.trim() || !form.username.trim()) {
      setErro('Nome e usuário são obrigatórios.')
      return
    }
    if (!editUser && !form.password) {
      setErro('Defina uma senha para o novo usuário.')
      return
    }
    if (form.password && form.password.length < 6) {
      setErro('A senha deve ter ao menos 6 caracteres.')
      return
    }
    setSalvando(true)
    setErro('')
    try {
      const url = editUser ? `/api/users?id=${editUser.id}` : '/api/users'
      const res = await fetch(url, {
        method: editUser ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Falha ao salvar')
      setShowModal(false)
      setEditUser(null)
      setForm(EMPTY)
      fetchUsers()
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(u) {
    try {
      const res = await fetch(`/api/users?id=${u.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Falha ao excluir')
      setConfirmDel(null)
      fetchUsers()
    } catch (e) {
      setErro(e.message)
      setConfirmDel(null)
    }
  }

  if (!master) {
    return (
      <div className="p-8">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
          <p className="text-4xl mb-3">🔒</p>
          <p className="text-white font-semibold">Acesso restrito</p>
          <p className="text-gray-400 text-sm mt-1">Apenas o administrador master pode gerenciar usuários.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Usuários</h2>
          <p className="text-gray-400 text-sm mt-1">Quem pode acessar o sistema</p>
        </div>
        <button onClick={openNew} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors">
          + Novo usuário
        </button>
      </div>

      {erro && !showModal && (
        <p className="mb-4 text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{erro}</p>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
        <p className="text-gray-400 text-xs">
          O administrador master vem das variáveis de ambiente e sempre tem acesso, mesmo sem constar nesta lista.
          Ele não aparece aqui e não pode ser excluído.
        </p>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm">Carregando...</div>
      ) : users.length === 0 ? (
        <div className="text-center py-16 text-gray-600">
          <p className="text-4xl mb-3">👤</p>
          <p>Nenhum usuário cadastrado além do master.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {users.map(u => (
            <div key={u.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-white font-semibold">{u.name}</p>
                  {u.is_admin && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400">admin</span>}
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.is_active ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
                    {u.is_active ? 'ativo' : 'inativo'}
                  </span>
                </div>
                <p className="text-gray-400 text-sm mt-1">@{u.username}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button onClick={() => openEdit(u)} className="text-gray-400 hover:text-blue-400 text-sm transition-colors">Editar</button>
                <button onClick={() => setConfirmDel(u)} className="text-gray-600 hover:text-red-400 text-sm transition-colors">Excluir</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-white mb-4">{editUser ? 'Editar usuário' : 'Novo usuário'}</h3>
            <div className="space-y-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-400 font-medium">Nome</span>
                <input autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500" placeholder="Nome completo"/>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-400 font-medium">Usuário (login)</span>
                <input autoComplete="off" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500" placeholder="ex: fabricio"/>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-400 font-medium">
                  Senha {editUser && <span className="text-gray-500">(deixe em branco para manter)</span>}
                </span>
                <input type="password" autoComplete="new-password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500" placeholder="mínimo 6 caracteres"/>
              </label>
              <label className="flex items-center gap-2 text-gray-300 text-sm cursor-pointer">
                <input type="checkbox" checked={form.is_admin} onChange={e => setForm(f => ({ ...f, is_admin: e.target.checked }))} className="rounded"/>
                Marcar como admin
              </label>
              <label className="flex items-center gap-2 text-gray-300 text-sm cursor-pointer">
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} className="rounded"/>
                Ativo (pode entrar no sistema)
              </label>
            </div>

            {erro && (
              <p className="mt-3 text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{erro}</p>
            )}

            <div className="flex gap-3 mt-5">
              <button onClick={() => { setShowModal(false); setEditUser(null); setErro('') }} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">Cancelar</button>
              <button onClick={salvar} disabled={salvando} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors">
                {salvando ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDel && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-white mb-2">Excluir usuário</h3>
            <p className="text-gray-400 text-sm mb-5">
              Excluir <span className="text-white font-medium">{confirmDel.name}</span> (@{confirmDel.username})? Esta ação não pode ser desfeita.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDel(null)} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">Cancelar</button>
              <button onClick={() => excluir(confirmDel)} className="flex-1 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-medium transition-colors">Excluir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
