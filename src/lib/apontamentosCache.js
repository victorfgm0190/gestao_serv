// Busca de apontamentos por empresa e por MÊS, com cache na sessão.
//
// Existe para que o aviso de conflito com a outra empresa (e o "já existe OS deste
// cliente neste dia" do lote) funcione em qualquer tela e em qualquer mês — antes
// ele dependia do que a visão Calendário tinha carregado. Um request por mês coberto
// pelas datas; o mesmo /api/time-entries de sempre.
//
// O resultado é só para AVISO: nunca entra em total, card ou Excel.

const TTL_MS = 5 * 60 * 1000
const cache = new Map() // `${companyId}|${ano}-${mes}` → { em, promessa }

function mesesDe(datas) {
  const out = new Set()
  for (const d of datas || []) {
    const s = String(d || '').slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) out.add(s.slice(0, 7))
  }
  return [...out]
}

function buscarMes(companyId, ym) {
  const chave = `${companyId}|${ym}`
  const hit = cache.get(chave)
  if (hit && Date.now() - hit.em < TTL_MS) return hit.promessa
  const [ano, mes] = ym.split('-').map(Number)
  const promessa = fetch(`/api/time-entries?company_id=${companyId}&month=${mes}&year=${ano}`)
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then(d => d.entries || [])
    .catch(e => {
      // Falha não fica em cache: a próxima chamada tenta de novo.
      cache.delete(chave)
      console.error('apontamentosCache:', e)
      return []
    })
  cache.set(chave, { em: Date.now(), promessa })
  return promessa
}

// Apontamentos da empresa nos meses que as `datas` (YYYY-MM-DD) cobrem.
export async function buscarApontamentos(companyId, datas) {
  if (!companyId) return []
  const listas = await Promise.all(mesesDe(datas).map(ym => buscarMes(companyId, ym)))
  return listas.flat()
}

// Nome do pedido original; é a mesma função — "outra" é só quem chama.
export const buscarOutraEmpresa = buscarApontamentos

// Chamar depois de salvar/excluir. Sem companyId limpa tudo.
export function invalidarApontamentos(companyId) {
  if (companyId == null) { cache.clear(); return }
  for (const k of cache.keys()) if (k.startsWith(`${companyId}|`)) cache.delete(k)
}
