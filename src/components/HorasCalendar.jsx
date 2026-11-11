import { useEffect, useState } from 'react'
import { chaveData } from '../../lib/billing-type.js'
import { todayBR } from '../lib/dateUtils'

// Visão calendário do Apontamento de Horas. Não busca nada: recebe os mesmos
// `entries` (já filtrados por empresa/mês/ano/cliente) que a lista usa.
//
// ⚠️ Datas: tudo é agrupado pela STRING 'YYYY-MM-DD' (chaveData). Nunca
// `new Date('YYYY-MM-DD')` — isso é meia-noite UTC e, em America/Sao_Paulo,
// cai no dia anterior. Datas da grade são montadas com new Date(ano, mês, dia),
// que é local.

const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const DIAS_EXTENSO = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']

// Paleta fixa de 8 cores; o índice sai do client_id, então o mesmo cliente tem
// a mesma cor em todo o calendário (e entre meses).
const PALETA = [
  'bg-blue-500/20 text-blue-300',
  'bg-emerald-500/20 text-emerald-300',
  'bg-amber-500/20 text-amber-300',
  'bg-purple-500/20 text-purple-300',
  'bg-pink-500/20 text-pink-300',
  'bg-cyan-500/20 text-cyan-300',
  'bg-orange-500/20 text-orange-300',
  'bg-lime-500/20 text-lime-300',
]

function corDoCliente(clientId) {
  const s = String(clientId ?? '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return PALETA[h % PALETA.length]
}

function hhmm(decimal) {
  const min = Math.round((parseFloat(decimal) || 0) * 60)
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

const p2 = (n) => String(n).padStart(2, '0')
const chave = (y, m, d) => `${y}-${p2(m)}-${p2(d)}`

// Rótulo de uma chave 'YYYY-MM-DD' sem passar por UTC.
function rotuloDia(k) {
  const [y, m, d] = k.split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay()
  return `${p2(d)}/${p2(m)}/${y} · ${DIAS_EXTENSO[dow]}`
}

function useIsMobile() {
  const query = '(max-width: 767px)'
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMobile(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return mobile
}

export default function HorasCalendar({ entries, year, month, fmt, renderEntry, onNewOnDay }) {
  const [diaAberto, setDiaAberto] = useState(null)
  const isMobile = useIsMobile()
  const y = Number(year)
  const m = Number(month)
  const hoje = todayBR()

  const porDia = entries.reduce((map, e) => {
    const k = chaveData(e.entry_date)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(e)
    return map
  }, new Map())
  for (const lista of porDia.values()) {
    lista.sort((a, b) => String(a.hora_inicial || '').localeCompare(String(b.hora_inicial || '')) || Number(a.id) - Number(b.id))
  }

  // Fecha o painel quando o dia fica vazio (ex.: excluiu o último apontamento)
  // ou quando o mês/cliente trocado o tira da tela.
  const doDia = diaAberto ? porDia.get(diaAberto) || [] : []
  useEffect(() => {
    if (diaAberto && doDia.length === 0) setDiaAberto(null)
  }, [diaAberto, doDia.length])

  const totalHoras = (lista) => lista.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0)
  const totalBruto = (lista) => lista.reduce((s, e) => s + (parseFloat(e.gross_value) || 0), 0)

  function clicarDia(k) {
    if ((porDia.get(k) || []).length > 0) setDiaAberto(k)
    else onNewOnDay(k)
  }

  // Grade: semana começando na segunda. getDay(): 0=dom … 6=sáb → offset seg=0.
  const diasNoMes = new Date(y, m, 0).getDate()
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7
  const totalCelulas = Math.ceil((offset + diasNoMes) / 7) * 7
  const celulas = Array.from({ length: totalCelulas }, (_, i) => {
    const d = i - offset + 1
    return d >= 1 && d <= diasNoMes ? d : null
  })

  const painel = diaAberto && doDia.length > 0 && (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-40 p-4" onClick={() => setDiaAberto(null)}>
      <div className="bg-gray-950 border border-gray-800 rounded-2xl p-5 w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={(ev) => ev.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-lg font-bold text-white capitalize">{rotuloDia(diaAberto)}</h3>
            <p className="text-gray-500 text-xs mt-1">
              {doDia.length} apontamento{doDia.length > 1 ? 's' : ''} · <span className="font-mono text-gray-300">{hhmm(totalHoras(doDia))}</span> · Bruto <span className="text-gray-300">{fmt(totalBruto(doDia))}</span>
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => onNewOnDay(diaAberto)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors">+ Lançar neste dia</button>
            <button onClick={() => setDiaAberto(null)} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs transition-colors">Fechar</button>
          </div>
        </div>
        <div className="space-y-3">{doDia.map(renderEntry)}</div>
      </div>
    </div>
  )

  if (isMobile) {
    const dias = [...porDia.keys()].sort()
    return (
      <>
        {dias.length === 0 ? (
          <div className="text-center py-16 text-gray-600"><p className="text-4xl mb-3">📅</p><p>Nenhum lançamento neste período.</p></div>
        ) : (
          <div className="space-y-3">
            {dias.map(k => {
              const lista = porDia.get(k)
              return (
                <button key={k} onClick={() => setDiaAberto(k)} className={`w-full text-left bg-gray-900 border rounded-xl p-3 ${k === hoje ? 'border-blue-500' : 'border-gray-800'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-white text-sm font-medium capitalize">{rotuloDia(k)}</span>
                    <span className="text-gray-300 text-xs font-mono">{hhmm(totalHoras(lista))}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {lista.map(e => (
                      <span key={e.id} className={`px-2 py-0.5 rounded text-[11px] ${corDoCliente(e.client_id)}`}>
                        {e.client_name || 'Sem cliente'} <span className="font-mono">{hhmm(e.hours)}</span>
                      </span>
                    ))}
                  </div>
                  <p className="text-gray-500 text-[11px] mt-2">Bruto {fmt(totalBruto(lista))}</p>
                </button>
              )
            })}
          </div>
        )}
        {painel}
      </>
    )
  }

  return (
    <>
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="grid grid-cols-7 border-b border-gray-800">
          {DIAS_SEMANA.map((d, i) => (
            <div key={d} className={`px-2 py-2 text-xs font-medium text-center ${i >= 5 ? 'text-gray-500 bg-gray-800/40' : 'text-gray-400'}`}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {celulas.map((d, i) => {
            const fimDeSemana = i % 7 >= 5
            const borda = `border-gray-800 ${i % 7 !== 6 ? 'border-r' : ''} ${i < totalCelulas - 7 ? 'border-b' : ''}`
            if (d === null) {
              return <div key={i} className={`min-h-[110px] ${borda} bg-gray-950/60 opacity-40`} />
            }
            const k = chave(y, m, d)
            const lista = porDia.get(k) || []
            const ehHoje = k === hoje
            return (
              <button
                key={i}
                onClick={() => clicarDia(k)}
                title={lista.length ? 'Ver apontamentos do dia' : 'Lançar horas neste dia'}
                className={`min-h-[110px] p-1.5 text-left flex flex-col gap-1 transition-colors hover:bg-gray-800/60 ${borda} ${fimDeSemana ? 'bg-gray-800/30' : ''} ${ehHoje ? 'ring-2 ring-inset ring-blue-500' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-medium ${ehHoje ? 'text-blue-400' : lista.length ? 'text-white' : 'text-gray-500'}`}>{d}</span>
                  {lista.length > 0 && <span className="text-[11px] font-mono text-gray-300">{hhmm(totalHoras(lista))}</span>}
                </div>
                <div className="flex flex-col gap-0.5 min-w-0">
                  {lista.slice(0, 3).map(e => (
                    <span key={e.id} className={`truncate px-1.5 py-0.5 rounded text-[10px] leading-tight ${corDoCliente(e.client_id)}`}>
                      {e.client_name || 'Sem cliente'} <span className="font-mono">{hhmm(e.hours)}</span>
                    </span>
                  ))}
                  {lista.length > 3 && <span className="text-[10px] text-gray-400 px-1">+{lista.length - 3}</span>}
                </div>
                {lista.length > 0 && <span className="mt-auto text-[10px] text-gray-500">{fmt(totalBruto(lista))}</span>}
              </button>
            )
          })}
        </div>
      </div>
      {painel}
    </>
  )
}
