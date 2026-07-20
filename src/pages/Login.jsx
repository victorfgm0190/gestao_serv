import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { setToken } from '../lib/session'

export default function Login() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ username: '', password: '' })
  const [erro, setErro] = useState('')
  const [entrando, setEntrando] = useState(false)

  async function entrar(e) {
    e?.preventDefault()
    if (entrando) return
    if (!form.username.trim() || !form.password) {
      setErro('Preencha usuário e senha.')
      return
    }
    setEntrando(true)
    setErro('')
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: form.username.trim(), password: form.password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.token) {
        setErro(data.error || 'Não foi possível entrar.')
        return
      }
      setToken(data.token)
      navigate('/', { replace: true })
    } catch {
      setErro('Erro de conexão com o servidor.')
    } finally {
      setEntrando(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-4">
      <form onSubmit={entrar} className="w-full max-w-sm bg-gray-900 border border-gray-800 rounded-2xl p-8">
        <h1 className="text-2xl font-bold text-white mb-1">Gestão Serv</h1>
        <p className="text-gray-400 text-sm mb-6">Entre para continuar</p>

        <div className="space-y-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-400 font-medium">Usuário</span>
            <input
              autoFocus
              autoComplete="username"
              value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
              placeholder="usuário"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-400 font-medium">Senha</span>
            <input
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
              placeholder="••••••••"
            />
          </label>
        </div>

        {erro && (
          <p className="mt-3 text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {erro}
          </p>
        )}

        <button
          type="submit"
          disabled={entrando}
          className="w-full mt-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
        >
          {entrando ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
