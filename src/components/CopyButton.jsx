import { useState } from 'react'

// Botão pequeno que copia um texto para a área de transferência e exibe
// "Copiado!" por ~1,5s como feedback.
export default function CopyButton({ value, label = 'Copiar', className = '' }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    const text = String(value ?? '')
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Fallback para navegadores/contextos sem Clipboard API
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch { /* noop */ }
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${copied ? 'bg-green-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'} ${className}`}
    >
      {copied ? 'Copiado!' : label}
    </button>
  )
}
