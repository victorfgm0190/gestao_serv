import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import './index.css'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Demands from './pages/Demands'
import EmailRules from './pages/EmailRules'
import Clientes from './pages/Clientes'
import FinancialRules from './pages/FinancialRules'
import TimeEntries from './pages/TimeEntries'
import Contracts from './pages/Contracts'
import Financial from './pages/Financial'
import Billing from './pages/Billing'
import Login from './pages/Login'
import Users from './pages/Users'
import Settings from './pages/Settings'
import { installFetchInterceptor, isLoggedIn } from './lib/session'

// Anexa o token em toda chamada /api/ e trata 401 de forma central.
// Precisa rodar antes do primeiro render.
installFetchInterceptor()

// Guarda de rota. É só conveniência de navegação — quem realmente barra o
// acesso aos dados é o requireAuth no backend.
function Protegido({ children }) {
  const location = useLocation()
  if (!isLoggedIn()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return children
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={isLoggedIn() ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/" element={<Protegido><Layout /></Protegido>}>
          <Route index element={<Dashboard />} />
          <Route path="demands" element={<Demands />} />
          <Route path="email-rules" element={<EmailRules />} />
          <Route path="clientes" element={<Clientes />} />
          <Route path="financial-rules" element={<FinancialRules />} />
          <Route path="time-entries" element={<TimeEntries />} />
          <Route path="contracts" element={<Contracts />} />
          <Route path="financial" element={<Financial />} />
          <Route path="billing" element={<Billing />} />
          <Route path="settings" element={<Settings />} />
          <Route path="users" element={<Users />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>
)
