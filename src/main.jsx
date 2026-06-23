import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Demands from './pages/Demands'
import EmailRules from './pages/EmailRules'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="demands" element={<Demands />} />
          <Route path="email-rules" element={<EmailRules />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>
)
