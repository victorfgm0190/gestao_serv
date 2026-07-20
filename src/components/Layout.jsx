import { useState } from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import useNotifications from '../hooks/useNotifications'
import { getUser, isMaster, logout } from '../lib/session'

const companies = [
  { id: 1, name: 'Lumen', color: '#3B82F6' },
  { id: 2, name: 'Imperium', color: '#8B5CF6' },
]

const navClass = ({ isActive }) =>
  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
    isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
  }`

export default function Layout() {
  const [activeCompany, setActiveCompany] = useState(companies[0])
  const user = getUser()
  const master = isMaster()

  useNotifications(activeCompany)

  return (
    <div className="flex h-screen bg-gray-950 text-white">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-gray-800">
          <h1 className="text-xl font-bold text-white">Gestão Serv</h1>
        </div>

        {/* Company Switcher */}
        <div className="p-4 border-b border-gray-800">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Empresa</p>
          <div className="flex gap-2">
            {companies.map(c => (
              <button
                key={c.id}
                onClick={() => setActiveCompany(c)}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                  activeCompany.id === c.id
                    ? 'text-white shadow-lg'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
                style={activeCompany.id === c.id ? { backgroundColor: c.color } : {}}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            <span>📊</span> Dashboard
          </NavLink>
          <NavLink
            to="/demands"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            <span>📋</span> Demandas
          </NavLink>
          <NavLink
            to="/email-rules"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            <span>⚙️</span> Regras de E-mail
          </NavLink>
          <NavLink
            to="/clientes"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            <span>👥</span> Clientes
          </NavLink>
          <NavLink
            to="/time-entries"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            <span>⏱️</span> Apont. de Horas
          </NavLink>
          <NavLink
            to="/financial-rules"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            <span>💰</span> Regras Financeiras
          </NavLink>
          <NavLink
            to="/contracts"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            <span>📄</span> Contratos
          </NavLink>
          <NavLink
            to="/financial"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            <span>💳</span> Financeiro
          </NavLink>
          <NavLink
            to="/billing"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            <span>🧾</span> Faturamento
          </NavLink>
          {/* Gestão de usuários: exclusiva do administrador master. */}
          {master && (
            <NavLink to="/users" className={navClass}>
              <span>🔑</span> Usuários
            </NavLink>
          )}
        </nav>

        {/* Usuário logado + empresa ativa */}
        <div className="p-4 border-t border-gray-800 space-y-3">
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: activeCompany.color }}
            />
            <span className="text-xs text-gray-400">{activeCompany.name}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm text-white truncate">{user?.name || user?.username || 'Usuário'}</p>
              {master && <p className="text-xs text-amber-400">administrador master</p>}
            </div>
            <button
              onClick={logout}
              title="Sair"
              aria-label="Sair do sistema"
              className="shrink-0 px-3 py-1.5 bg-gray-800 hover:bg-red-500/20 text-gray-400 hover:text-red-400 rounded-lg text-xs transition-colors"
            >
              Sair
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet context={{ activeCompany }} />
      </main>
    </div>
  )
}
