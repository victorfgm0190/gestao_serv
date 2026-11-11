// Tema claro/escuro. A classe "dark" no <html> é aplicada antes do React pelo script
// inline do index.html; aqui só se lê e alterna. Escolha em localStorage "theme".
export function temaAtual() {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function aplicarTema(tema) {
  document.documentElement.classList.toggle('dark', tema === 'dark')
  try { localStorage.setItem('theme', tema) } catch { /* sem persistência: vale só nesta aba */ }
}
