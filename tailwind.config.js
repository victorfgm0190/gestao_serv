/** @type {import('tailwindcss').Config} */

// Tokens semânticos de cor. O valor mora em CSS variables (src/index.css): :root é o tema
// claro e .dark é o escuro — no escuro cada token vale EXATAMENTE o cinza que a classe
// antiga usava (bg-surface = gray-900, text-muted = gray-400…), então o tema escuro não
// muda. As variáveis guardam canais RGB para as opacidades (bg-surface-2/50) funcionarem.
const token = (nome) => `rgb(var(--${nome}) / <alpha-value>)`
const NOMES = [
  'bg', 'surface', 'surface-2', 'surface-3', 'surface-4', 'sidebar',
  'border', 'border-strong', 'border-stronger',
  'text', 'text-1', 'text-2', 'text-3', 'muted', 'subtle', 'faint', 'faintest',
  'primary', 'primary-fg', 'success', 'danger', 'warning', 'victor', 'fabricio',
]

export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: 'class',
  theme: {
    extend: {
      colors: Object.fromEntries(NOMES.map(n => [n, token(n)])),
    },
  },
  plugins: [],
}
