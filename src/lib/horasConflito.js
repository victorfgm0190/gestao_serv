// Sobreposição de horário entre apontamentos (calendário e modal "Lançar horas").
// Um apontamento vira até dois segmentos em minutos: [início, intervalo) e
// [fim do intervalo, final). Sem hora inicial/final não há como comparar — o
// apontamento é ignorado em vez de virar conflito presumido.

function minutos(hhmm) {
  if (!hhmm) return null
  const [h, m] = String(hhmm).split(':').map(Number)
  if (!Number.isFinite(h)) return null
  return h * 60 + (Number.isFinite(m) ? m : 0)
}

export function segmentos(e) {
  const ini = minutos(e?.hora_inicial)
  const fim = minutos(e?.hora_final)
  if (ini == null || fim == null || fim <= ini) return []
  const ii = minutos(e.intervalo_inicio)
  const fi = minutos(e.intervalo_fim)
  if (ii != null && fi != null && ii > ini && fi < fim && fi > ii) {
    return [[ini, ii], [fi, fim]]
  }
  return [[ini, fim]]
}

// Encostar (12:00 termina, 12:00 começa) não é conflito.
export function sobrepoe(a, b) {
  const sa = segmentos(a)
  const sb = segmentos(b)
  return sa.some(([a1, a2]) => sb.some(([b1, b2]) => a1 < b2 && b1 < a2))
}

export function faixaHorario(e) {
  if (!e?.hora_inicial || !e?.hora_final) return null
  return `${e.hora_inicial.slice(0, 5)}–${e.hora_final.slice(0, 5)}`
}
