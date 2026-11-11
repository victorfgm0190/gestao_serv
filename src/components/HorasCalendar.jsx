import { useEffect, useState } from 'react'
import { chaveData } from '../../lib/billing-type.js'
import { todayBR } from '../lib/dateUtils'
import { sobrepoe, faixaHorario } from '../lib/horasConflito'
import { semDescricao } from '../lib/semDescricao'

// Visão calendário do Apontamento de Horas. Não busca nada: recebe os mesmos
// `entries` (já filtrados por empresa/mês/ano/cliente) que a lista usa, e
// `outras` — os apontamentos da OUTRA empresa no mesmo mês, só para marcar os
// dias já ocupados. `outras` nunca entra em total nenhum: horas e bruto da
// célula somam só a empresa ativa, como os cards e o Excel.
//
// ⚠️ Datas: tudo é agrupado pela STRING 'YYYY-MM-DD' (chaveData). Nunca
// `new Date('YYYY-MM-DD')` — isso é meia-noite UTC e, em America/Sao_Paulo,
// cai no dia anterior. Datas da grade são montadas com new Date(ano, mês, dia),
// que é local.

const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const DIAS_EXTENSO = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const MAX_CHIPS = 3

// Paleta fixa de 8 cores; o índice sai do client_id, então o mesmo cliente tem
// a mesma cor em todo o calendário (e entre meses).
const PALETA = [
  'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300',
  'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300',
  'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300',
  'bg-pink-100 dark:bg-pink-500/20 text-pink-700 dark:text-pink-300',
  'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300',
  'bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300',
  'bg-lime-100 dark:bg-lime-500/20 text-lime-700 dark:text-lime-300',
]

function corDoCliente(clientId) {
  const s = String(clientId ?? '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return PALETA[h % PALETA.length]
}

// Outra empresa: listrado diagonal + borda tracejada + texto cinza.
const CHIP_OUTRA = 'border border-dashed border-border-stronger text-muted'
// Cor das listras por tema em src/index.css (--listrado-*): no escuro é o mesmo rgba de antes.
const LISTRADO_CHIP = { backgroundImage: 'repeating-linear-gradient(135deg, var(--listrado-chip) 0 4px, transparent 4px 8px)' }
const LISTRADO_CELULA = { backgroundImage: 'repeating-linear-gradient(135deg, var(--listrado-celula) 0 6px, transparent 6px 12px)' }

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

function agrupar(lista) {
  const map = new Map()
  for (const e of lista) {
    const k = chaveData(e.entry_date)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(e)
  }
  for (const l of map.values()) {
    l.sort((a, b) => String(a.hora_inicial || '').localeCompare(String(b.hora_inicial || '')) || Number(a.id) - Number(b.id))
  }
  return map
}

const totalHoras = (lista) => lista.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0)
const totalBruto = (lista) => lista.reduce((s, e) => s + (parseFloat(e.gross_value) || 0), 0)

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

const MarcaSemDescricao = () => <span title="Sem descrição" aria-label="Sem descrição" className="mr-0.5">📝</span>

function Chip({ e, outra, sigla, compacto }) {
  const tamanho = compacto ? 'text-[10px] leading-tight px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'
  if (outra) {
    return (
      <span className={`block min-w-0 truncate rounded ${tamanho} ${CHIP_OUTRA}`} style={LISTRADO_CHIP}>
        {sigla} · {e.client_name || 'Sem cliente'} <span className="font-mono">{hhmm(e.hours)}</span>
      </span>
    )
  }
  return (
    <span className={`block min-w-0 truncate rounded ${tamanho} ${corDoCliente(e.client_id)}`}>
      {semDescricao(e) && <MarcaSemDescricao />}{e.client_name || 'Sem cliente'} <span className="font-mono">{hhmm(e.hours)}</span>
    </span>
  )
}

export default function HorasCalendar({
  entries, outras = [], year, month, fmt, renderEntry, onNewOnDay,
  ativa, outra, mostrarOutra, onToggleOutra, onVerNaOutra,
  // Modo "Selecionar dias" (lote). O estado mora na página: o modal do lote o lê.
  selecionando = false, selecionados = [], onIniciarSelecao, onAlternarSelecionado,
  onLimparSelecao, onCancelarSelecao, onLancarSelecionados,
}) {
  const [diaAberto, setDiaAberto] = useState(null)
  const isMobile = useIsMobile()
  const y = Number(year)
  const m = Number(month)
  const hoje = todayBR()
  const siglaOutra = outra ? outra.name.slice(0, 3).toUpperCase() : ''

  const porDia = agrupar(entries)
  const porDiaOutra = agrupar(mostrarOutra ? outras : [])

  const conflitoNoDia = (k) => {
    const a = porDia.get(k) || []
    const o = porDiaOutra.get(k) || []
    return a.some(x => o.some(z => sobrepoe(x, z)))
  }

  // Fecha o painel quando o dia fica vazio (ex.: excluiu o último apontamento)
  // ou quando o mês/cliente trocado o tira da tela.
  const doDia = diaAberto ? porDia.get(diaAberto) || [] : []
  const doDiaOutra = diaAberto ? porDiaOutra.get(diaAberto) || [] : []
  const vazio = doDia.length + doDiaOutra.length === 0
  useEffect(() => {
    if (diaAberto && vazio) setDiaAberto(null)
  }, [diaAberto, vazio])

  function clicarDia(k) {
    if (selecionando) { onAlternarSelecionado(k); return }
    // Dia com horas só na outra empresa também abre o painel: é ali que se vê
    // o horário ocupado antes de lançar (e o painel tem "+ Lançar neste dia").
    if ((porDia.get(k) || []).length + (porDiaOutra.get(k) || []).length > 0) setDiaAberto(k)
    else onNewOnDay(k)
  }

  function verNaOutra() {
    setDiaAberto(null)
    onVerNaOutra()
  }

  // Grade: semana começando na segunda. getDay(): 0=dom … 6=sáb → offset seg=0.
  const diasNoMes = new Date(y, m, 0).getDate()
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7
  const totalCelulas = Math.ceil((offset + diasNoMes) / 7) * 7
  const celulas = Array.from({ length: totalCelulas }, (_, i) => {
    const d = i - offset + 1
    return d >= 1 && d <= diasNoMes ? d : null
  })

  const marcados = new Set(selecionados)
  const toggle = (
    <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
      {outra ? (
        <label className="inline-flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
          <input type="checkbox" checked={!!mostrarOutra} onChange={(ev) => onToggleOutra(ev.target.checked)} className="accent-blue-500" />
          Mostrar {outra.name}
        </label>
      ) : <span />}
      {selecionando ? (
        <span className="text-xs text-blue-700 dark:text-blue-300">Modo seleção: clique nos dias para marcar · Esc para sair</span>
      ) : (
        <button onClick={onIniciarSelecao} className="px-3 py-1 bg-surface-2 hover:bg-surface-3 text-text-3 rounded-lg text-xs transition-colors">☑ Selecionar dias</button>
      )}
    </div>
  )

  const barraSelecao = selecionando && (
    <>
      <div className="h-16" />
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 bg-surface border border-blue-300 dark:border-blue-500/50 shadow-xl rounded-xl px-4 py-2.5 flex items-center gap-3 flex-wrap max-w-[calc(100vw-2rem)]">
        <span className="text-sm text-text">{selecionados.length} dia{selecionados.length === 1 ? '' : 's'} selecionado{selecionados.length === 1 ? '' : 's'}</span>
        <button onClick={onLimparSelecao} disabled={!selecionados.length} className="px-3 py-1 bg-surface-2 hover:bg-surface-3 disabled:opacity-40 text-text-3 rounded-lg text-xs">Limpar</button>
        <button onClick={onCancelarSelecao} className="px-3 py-1 bg-surface-2 hover:bg-surface-3 text-text-3 rounded-lg text-xs">Cancelar</button>
        <button onClick={onLancarSelecionados} disabled={!selecionados.length} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg text-xs font-medium">Lançar nos {selecionados.length} dias</button>
      </div>
    </>
  )

  const painel = diaAberto && !vazio && (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-40 p-4" onClick={() => setDiaAberto(null)}>
      <div className="bg-bg border border-border rounded-2xl p-5 w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={(ev) => ev.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-text capitalize">{rotuloDia(diaAberto)}</h3>
            <p className="text-subtle text-xs mt-1">
              {doDia.length} apontamento{doDia.length === 1 ? '' : 's'} na {ativa?.name} · <span className="font-mono text-text-3">{hhmm(totalHoras(doDia))}</span> · Bruto <span className="text-text-3">{fmt(totalBruto(doDia))}</span>
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => onNewOnDay(diaAberto)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors">+ Lançar neste dia</button>
            <button onClick={() => setDiaAberto(null)} className="px-3 py-1.5 bg-surface-2 hover:bg-surface-3 text-text-3 rounded-lg text-xs transition-colors">Fechar</button>
          </div>
        </div>

        {conflitoNoDia(diaAberto) && (
          <p className="mb-3 text-amber-700 dark:text-amber-300 text-xs bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/30 rounded-lg px-3 py-2">⚠️ Conflito de horário com {outra?.name} neste dia.</p>
        )}

        {doDia.length > 0 && <div className="space-y-3">{doDia.map(renderEntry)}</div>}

        {doDiaOutra.length > 0 && (
          <div className="mt-5">
            <div className="flex items-center justify-between gap-3 mb-2">
              <p className="text-muted text-xs font-medium uppercase tracking-wider">{outra?.name} (somente leitura)</p>
              <button onClick={verNaOutra} className="px-3 py-1 bg-surface-2 hover:bg-surface-3 text-text-3 rounded-lg text-xs transition-colors">Ver na {outra?.name} →</button>
            </div>
            <div className="space-y-2">
              {doDiaOutra.map(e => (
                <div key={e.id} className={`rounded-xl p-3 ${CHIP_OUTRA}`} style={LISTRADO_CHIP}>
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <span className="text-text-3 font-medium">{siglaOutra} · {e.client_name || 'Sem cliente'}</span>
                    <span className="font-mono">{hhmm(e.hours)}</span>
                    {faixaHorario(e) && (
                      <span className="font-mono text-subtle">{faixaHorario(e)}{e.intervalo_inicio ? ` (int: ${e.intervalo_inicio}-${e.intervalo_fim})` : ''}</span>
                    )}
                  </div>
                  {e.description && <p className="text-muted text-sm mt-1">{e.description}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )

  const legenda = mostrarOutra && outra && (
    <div className="flex items-center gap-3 mt-3 text-[11px] text-subtle flex-wrap">
      <span className="inline-flex items-center gap-1.5"><span className="inline-block w-6 h-3 rounded bg-blue-100 dark:bg-blue-500/20" /> {ativa?.name}</span>
      <span>·</span>
      <span className="inline-flex items-center gap-1.5"><span className={`inline-block w-6 h-3 rounded ${CHIP_OUTRA}`} style={LISTRADO_CHIP} /> {outra.name}</span>
    </div>
  )

  if (isMobile) {
    const dias = [...new Set([...porDia.keys(), ...porDiaOutra.keys()])].sort()
    return (
      <>
        {toggle}
        {dias.length === 0 ? (
          <div className="text-center py-16 text-faint"><p className="text-4xl mb-3">📅</p><p>Nenhum lançamento neste período.</p></div>
        ) : (
          <div className="space-y-3">
            {dias.map(k => {
              const lista = porDia.get(k) || []
              const listaOutra = porDiaOutra.get(k) || []
              return (
                <button
                  key={k}
                  onClick={() => (selecionando ? onAlternarSelecionado(k) : setDiaAberto(k))}
                  className={`w-full min-w-0 text-left bg-surface shadow-sm dark:shadow-none border rounded-xl p-3 ${marcados.has(k) ? 'border-blue-500 ring-2 ring-blue-500' : k === hoje ? 'border-blue-500' : 'border-border'}`}
                  style={lista.length === 0 ? LISTRADO_CELULA : undefined}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-text text-sm font-medium capitalize truncate">{marcados.has(k) && '✓ '}{conflitoNoDia(k) && '⚠️ '}{rotuloDia(k)}</span>
                    {lista.length > 0 && <span className="text-text-3 text-xs font-mono shrink-0">{hhmm(totalHoras(lista))}</span>}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {lista.map(e => <Chip key={e.id} e={e} />)}
                    {listaOutra.map(e => <Chip key={`o${e.id}`} e={e} outra sigla={siglaOutra} />)}
                  </div>
                  {lista.length > 0 && <p className="text-subtle text-[11px] mt-2">Bruto {fmt(totalBruto(lista))}</p>}
                </button>
              )
            })}
          </div>
        )}
        {legenda}
        {barraSelecao}
        {painel}
      </>
    )
  }

  return (
    <>
      {toggle}
      <div className="bg-surface shadow-sm dark:shadow-none border border-border rounded-xl overflow-hidden min-w-0">
        <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] border-b border-border">
          {DIAS_SEMANA.map((d, i) => (
            <div key={d} className={`min-w-0 px-2 py-2 text-xs font-medium text-center ${i >= 5 ? 'text-subtle bg-surface-2 dark:bg-surface-2/40' : 'text-muted'}`}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-[repeat(7,minmax(0,1fr))]">
          {celulas.map((d, i) => {
            const fimDeSemana = i % 7 >= 5
            const borda = `border-border ${i % 7 !== 6 ? 'border-r' : ''} ${i < totalCelulas - 7 ? 'border-b' : ''}`
            if (d === null) {
              return <div key={i} className={`min-w-0 min-h-[110px] ${borda} bg-surface-3/60 dark:bg-bg/60 opacity-50 dark:opacity-40`} />
            }
            const k = chave(y, m, d)
            const lista = porDia.get(k) || []
            const listaOutra = porDiaOutra.get(k) || []
            // Empresa ativa primeiro; a outra só ocupa as vagas que sobrarem.
            const todos = [...lista.map(e => ({ e, outra: false })), ...listaOutra.map(e => ({ e, outra: true }))]
            const ehHoje = k === hoje
            const soOutra = lista.length === 0 && listaOutra.length > 0
            const conflito = conflitoNoDia(k)
            const marcado = marcados.has(k)
            return (
              <button
                key={i}
                onClick={() => clicarDia(k)}
                title={selecionando ? (marcado ? 'Desmarcar' : 'Marcar para o lote') : todos.length ? 'Ver apontamentos do dia' : 'Lançar horas neste dia'}
                style={soOutra ? LISTRADO_CELULA : undefined}
                className={`relative min-w-0 overflow-hidden min-h-[110px] p-1.5 text-left flex flex-col gap-1 transition-colors hover:bg-surface-2/60 ${borda} ${fimDeSemana ? 'bg-surface-2/70 dark:bg-surface-2/30' : ''} ${marcado ? 'ring-2 ring-inset ring-blue-400 bg-blue-50 dark:bg-blue-500/10' : ehHoje ? 'ring-2 ring-inset ring-blue-500' : ''}`}
              >
                <div className="flex items-start justify-between gap-1 min-w-0">
                  <span className={`text-xs font-medium ${ehHoje ? 'text-blue-700 dark:text-blue-400' : lista.length ? 'text-text' : 'text-subtle'}`}>
                    {marcado && <span className="text-blue-700 dark:text-blue-300 mr-1">✓</span>}{d}{conflito && <span className="ml-1" title={`Conflito de horário com ${outra?.name}`}>⚠️</span>}
                  </span>
                  <div className="text-right leading-tight">
                    {lista.length > 0 && <div className="text-[11px] font-mono text-text-3">{hhmm(totalHoras(lista))}</div>}
                    {listaOutra.length > 0 && <div className="text-[10px] font-mono text-subtle">+ {siglaOutra} {hhmm(totalHoras(listaOutra))}</div>}
                  </div>
                </div>
                <div className="flex flex-col gap-0.5 min-w-0">
                  {todos.slice(0, MAX_CHIPS).map(({ e, outra: o }) => (
                    <Chip key={`${o ? 'o' : 'a'}${e.id}`} e={e} outra={o} sigla={siglaOutra} compacto />
                  ))}
                  {todos.length > MAX_CHIPS && <span className="text-[10px] text-muted px-1">+{todos.length - MAX_CHIPS}</span>}
                </div>
                {lista.length > 0 && <span className="mt-auto text-[10px] text-subtle truncate">{fmt(totalBruto(lista))}</span>}
              </button>
            )
          })}
        </div>
      </div>
      {legenda}
      {barraSelecao}
      {painel}
    </>
  )
}
