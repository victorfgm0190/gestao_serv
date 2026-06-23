import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Demands from './pages/Demands'
import EmailRules from './pages/EmailRules'
import FinancialRules from './pages/FinancialRules'
import TimeEntries from './pages/TimeEntries'
import Contracts from './pages/Contracts'
import Financial from './pages/Financial'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="demands" element={<Demands />} />
          <Route path="email-rules" element={<EmailRules />} />
          <Route path="financial-rules" element={<FinancialRules />} />
          <Route path="time-entries" element={<TimeEntries />} />
          <Route path="contracts" element={<Contracts />} />
          <Route path="financial" element={<Financial />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>
)
