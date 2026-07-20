// Data de hoje no fuso do Brasil (America/Sao_Paulo) como YYYY-MM-DD.
//
// Substitui `new Date().toISOString().split('T')[0]`, que devolve a data em
// UTC: entre 21h e meia-noite no horário de Brasília isso já é o dia seguinte.
// Não era só cosmético — paid_at define o MÊS DE CAIXA, então um pagamento
// feito dia 30/06 às 22h era lançado em julho.
//
// 'sv-SE' é usado porque o locale sueco formata como YYYY-MM-DD nativamente.
export function todayBR() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
}
