import { useEffect, useMemo, useState } from 'react'
import { calcular } from '../../lib/time-entry-calc.js'
import { tipoDaRegra, chaveData, cotaDaDiaria, ROTULO_COBRANCA } from '../../lib/billing-type.js'
import { sobrepoe, faixaHorario } from '../lib/horasConflito'
import { buscarApontamentos, invalidarApontamentos } from '../lib/apontamentosCache'

// Modal "Lançar em lote": marca vários dias de uma vez, com o mesmo horário e sem
// descrição obrigatória (ela é completada depois, editando cada OS).
//
// A prévia usa a MESMA calcular() do lançamento individual e do backend; quem grava
// é POST /api/time-entries?action=batch, que recalcula tudo no servidor.

const LIMITE = 31
const SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const DDD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const HORARIOS = ['hora_inicial', 'intervalo_inicio', 'intervalo_fim', 'hora_final']

const p2 = (n) => String(n).padStart(2, '0')
const chave = (y, m, d) => `${y}-${p2(m)}-${p2(d)}`
// Datas sempre como string local — nunca new Date('YYYY-MM-DD') (UTC).
const partes = (k) => k.split('-').map(Number)
const diaDaSemana = (k) => { const [y, m, d] = partes(k); return new Date(y, m - 1, d).getDay() }
const rotulo = (k) => { const [, m, d] = partes(k); return `${p2(d)}/${p2(m)} ${DDD[diaDaSemana(k)]}` }
const fmt = (v) => `R$ ${(parseFloat(v) || 0).toFixed(2).replace('.', ',')}`
function hhmm(dec) {
  const min = Math.round((parseFloat(dec) || 0) * 60)
  return `${p2(Math.floor(min / 60))}:${p2(min % 60)}`
}

// Espelho exato de calcularHoras() em api/time-entries.js.
function horasDe(t) {
  const dec = (s) => { if (!s) return 0; const [h, m] = s.split(':').map(Number); return h + m / 60 }
  if (!t.hora_inicial || !t.hora_final) return 0
  const intervalo = t.intervalo_inicio && t.intervalo_fim ? dec(t.intervalo_fim) - dec(t.intervalo_inicio) : 0
  return Math.max(parseFloat((dec(t.hora_final) - dec(t.hora_inicial) - intervalo).toFixed(4)), 0)
}

function gerarPeriodo(de, ate, semana) {
  if (!de || !ate || de > ate) return []
  const [y1, m1, d1] = partes(de)
  const fim = ate
  const out = []
  for (let dt = new Date(y1, m1 - 1, d1); ; dt.setDate(dt.getDate() + 1)) {
    const k = chave(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
    if (k > fim || out.length > 400) break
    const idx = (dt.getDay() + 6) % 7 // seg=0 … dom=6
    if (semana[idx]) out.push(k)
  }
  return out
}

const inputCls = 'w-full bg-surface-2 border border-border-strong rounded-lg px-2 py-1.5 text-text text-sm focus:outline-none focus:border-blue-500'

export default function LoteAgendas({ activeCompany, outraEmpresa, clients, rules, diasIniciais, mesRef, onClose, onDone }) {
  const vindoDoCalendario = Array.isArray(diasIniciais) && diasIniciais.length > 0
  const ultimoDia = new Date(mesRef.year, mesRef.month, 0).getDate()

  const [clientId, setClientId] = useState('')
  const [contractId, setContractId] = useState('')
  const [clientContracts, setClientContracts] = useState([])
  const [loadingContracts, setLoadingContracts] = useState(false)
  const [padrao, setPadrao] = useState({ hora_inicial: '09:00', intervalo_inicio: '12:00', intervalo_fim: '13:00', hora_final: '18:00', hours_fuel: '0', despesas_deslocamento: '0' })
  const [description, setDescription] = useState('')
  const [de, setDe] = useState(chave(mesRef.year, mesRef.month, 1))
  const [ate, setAte] = useState(chave(mesRef.year, mesRef.month, ultimoDia))
  const [semana, setSemana] = useState([true, true, true, true, true, false, false])
  const [dias, setDias] = useState(() => (vindoDoCalendario ? [...diasIniciais].sort() : []))
  const [cal, setCal] = useState({ y: mesRef.year, m: mesRef.month })
  const [overrides, setOverrides] = useState({})
  const [pular, setPular] = useState({})
  const [editando, setEditando] = useState(null)
  const [existentes, setExistentes] = useState([])
  const [outras, setOutras] = useState([])
  const [carregandoAvisos, setCarregandoAvisos] = useState(false)
  const [errosServidor, setErrosServidor] = useState({})
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  // Período + dias da semana regeram a lista (só na entrada pelo cabeçalho).
  useEffect(() => {
    if (!vindoDoCalendario) setDias(gerarPeriodo(de, ate, semana))
  }, [de, ate, semana, vindoDoCalendario])

  useEffect(() => {
    const onKey = (ev) => { if (ev.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Avisos: OS existentes da empresa ativa e da outra, nos meses que os dias cobrem
  // (lote pode atravessar meses). Cache por empresa+mês em apontamentosCache.
  const chaveDias = dias.join(',')
  useEffect(() => {
    let vivo = true
    const lista = chaveDias ? chaveDias.split(',') : []
    setCarregandoAvisos(true)
    Promise.all([
      buscarApontamentos(activeCompany.id, lista),
      outraEmpresa ? buscarApontamentos(outraEmpresa.id, lista) : Promise.resolve([]),
    ]).then(([a, o]) => { if (vivo) { setExistentes(a); setOutras(o) } })
      .finally(() => { if (vivo) setCarregandoAvisos(false) })
    return () => { vivo = false }
  }, [chaveDias, activeCompany.id, outraEmpresa])

  async function escolherCliente(id) {
    setClientId(id)
    setContractId('')
    setClientContracts([])
    if (!id) return
    setLoadingContracts(true)
    try {
      const r = await fetch(`/api/contracts?client_id=${id}`)
      const lista = (await r.json()).contracts || []
      setClientContracts(lista)
      if (lista.length === 1) setContractId(String(lista[0].id))
    } catch (e) { console.error(e) } finally { setLoadingContracts(false) }
  }

  const contrato = clientContracts.find(c => String(c.id) === String(contractId)) || null
  const regra = contrato ? rules.find(r => String(r.id) === String(contrato.financial_rule_id)) || null : null
  const regraDe = (ct) => rules.find(r => String(r.id) === String(ct.financial_rule_id))

  const linhas = useMemo(() => dias.map(d => {
    const t = { ...padrao, ...(overrides[d] || {}) }
    const hours = horasDe(t)
    let calc = null
    if (regra && hours > 0) {
      let cota = null
      if (tipoDaRegra(regra) === 'diaria') {
        const n = existentes.filter(e => String(e.contract_id) === String(contrato.id) && chaveData(e.entry_date) === d).length
        cota = cotaDaDiaria(regra, n + 1, n) // a OS nova terá o maior id → última cota
      }
      calc = calcular(hours, regra, padrao.hours_fuel, contrato, padrao.despesas_deslocamento, cota)
    }
    const duplicadas = clientId ? existentes.filter(e => String(e.client_id) === String(clientId) && chaveData(e.entry_date) === d) : []
    const conflitos = outras.filter(o => chaveData(o.entry_date) === d && sobrepoe(t, o))
    const temAviso = duplicadas.length > 0 || conflitos.length > 0
    const pulada = pular[d] ?? temAviso
    return { d, t, hours, calc, duplicadas, conflitos, temAviso, pulada, customizada: !!overrides[d] }
  }), [dias, padrao, overrides, regra, contrato, existentes, outras, clientId, pular])

  const aLancar = linhas.filter(l => !l.pulada)
  const puladas = linhas.length - aLancar.length
  const totHoras = aLancar.reduce((s, l) => s + l.hours, 0)
  const totBruto = aLancar.reduce((s, l) => s + (l.calc?.gross_value || 0), 0)
  const semHoras = aLancar.some(l => l.hours <= 0)
  const podeLancar = !!clientId && !!contractId && aLancar.length > 0 && aLancar.length <= LIMITE && !semHoras && !enviando

  function alternarDia(k) {
    setDias(ds => (ds.includes(k) ? ds.filter(x => x !== k) : [...ds, k].sort()))
  }
  function removerDia(k) {
    setDias(ds => ds.filter(x => x !== k))
  }
  function mudarHorarioLinha(d, campo, valor) {
    setOverrides(o => ({ ...o, [d]: { ...(o[d] || {}), [campo]: valor } }))
  }

  async function lancar() {
    if (!podeLancar) return
    setEnviando(true)
    setErro('')
    setErrosServidor({})
    try {
      const batch = aLancar.map(l => ({
        client_id: clientId,
        contract_id: contractId,
        entry_date: l.d,
        ...Object.fromEntries(HORARIOS.map(h => [h, l.t[h] || ''])),
        hours_fuel: padrao.hours_fuel,
        despesas_deslocamento: padrao.despesas_deslocamento,
        description,
      }))
      const res = await fetch('/api/time-entries?action=batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: activeCompany.id, batch }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErro(data.error || 'Não foi possível lançar o lote.')
        const porData = {}
        for (const e of data.errors || []) if (e.entry_date) porData[e.entry_date] = e.error
        setErrosServidor(porData)
        return
      }
      invalidarApontamentos(activeCompany.id)
      onDone({ created: data.created ?? aLancar.length, skipped: puladas })
    } catch {
      setErro('Erro de conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  // Mini-calendário (entrada pelo cabeçalho): clicar alterna o dia na lista.
  const diasNoMes = new Date(cal.y, cal.m, 0).getDate()
  const offset = (new Date(cal.y, cal.m - 1, 1).getDay() + 6) % 7
  const celulas = Array.from({ length: Math.ceil((offset + diasNoMes) / 7) * 7 }, (_, i) => {
    const d = i - offset + 1
    return d >= 1 && d <= diasNoMes ? d : null
  })
  const navegar = (delta) => setCal(({ y, m }) => {
    const nm = m + delta
    return nm < 1 ? { y: y - 1, m: 12 } : nm > 12 ? { y: y + 1, m: 1 } : { y, m: nm }
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-surface shadow-sm dark:shadow-none border border-border rounded-2xl p-6 w-full max-w-4xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-lg font-bold text-text">Lançar em lote</h3>
            <p className="text-subtle text-xs mt-1">Marca os dias com o mesmo horário. A descrição pode ficar vazia e ser completada depois, editando cada OS.</p>
          </div>
          <button onClick={onClose} className="text-subtle hover:text-text text-sm">✕</button>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <select value={clientId} onChange={e => escolherCliente(e.target.value)} className={inputCls}>
              <option value="">Selecione o cliente *</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={contractId} onChange={e => setContractId(e.target.value)} disabled={!clientId || loadingContracts || clientContracts.length === 0} className={`${inputCls} disabled:opacity-50`}>
              <option value="">{loadingContracts ? 'Carregando contratos...' : 'Selecione o contrato *'}</option>
              {clientContracts.map(ct => {
                const r = regraDe(ct)
                return <option key={ct.id} value={ct.id}>{ct.name} — {r ? ROTULO_COBRANCA[tipoDaRegra(r)] : 'sem regra'}</option>
              })}
            </select>
            {clientId && !loadingContracts && clientContracts.length === 0 && (
              <p className="text-amber-700 dark:text-amber-400 text-xs">Este cliente não possui contrato ativo. Cadastre um contrato antes de lançar horas.</p>
            )}

            <div className="bg-surface-2 rounded-xl p-3 space-y-2">
              <p className="text-muted text-xs font-medium uppercase tracking-wider">Horário padrão (todos os dias)</p>
              <div className="grid grid-cols-4 gap-2">
                {[['hora_inicial', 'Início'], ['intervalo_inicio', 'Int. início'], ['intervalo_fim', 'Int. fim'], ['hora_final', 'Final']].map(([campo, rot]) => (
                  <div key={campo} className="min-w-0">
                    <label className="text-subtle text-[11px] block mb-0.5">{rot}</label>
                    <input type="time" value={padrao[campo]} onChange={e => setPadrao(p => ({ ...p, [campo]: e.target.value }))} className={`${inputCls} px-1`} />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-subtle text-[11px] block mb-0.5">Horas de deslocamento</label>
                  <input type="number" step="0.5" value={padrao.hours_fuel} onChange={e => setPadrao(p => ({ ...p, hours_fuel: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className="text-subtle text-[11px] block mb-0.5">Despesas (R$)</label>
                  <input type="number" step="0.01" value={padrao.despesas_deslocamento} onChange={e => setPadrao(p => ({ ...p, despesas_deslocamento: e.target.value }))} disabled={contrato?.deslocamento_tipo !== 'hora_despesas'} title={contrato?.deslocamento_tipo !== 'hora_despesas' ? 'O contrato não cobra despesas de deslocamento' : ''} className={`${inputCls} disabled:opacity-40`} />
                </div>
              </div>
            </div>
            <textarea placeholder="Descrição (opcional — pode completar depois)" value={description} onChange={e => setDescription(e.target.value)} rows={2} className={`${inputCls} resize-none placeholder-subtle`} />
          </div>

          <div className="space-y-3">
            {vindoDoCalendario ? (
              <p className="text-muted text-xs bg-surface-2 rounded-lg px-3 py-2">{diasIniciais.length} dia(s) selecionado(s) no calendário. Remova na tabela com ✕.</p>
            ) : (
              <>
                <div className="bg-surface-2 rounded-xl p-3 space-y-2">
                  <p className="text-muted text-xs font-medium uppercase tracking-wider">Período</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="date" value={de} onChange={e => setDe(e.target.value)} className={inputCls} />
                    <input type="date" value={ate} onChange={e => setAte(e.target.value)} className={inputCls} />
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {SEMANA.map((s, i) => (
                      <label key={s} className={`px-2 py-1 rounded-md text-xs cursor-pointer select-none ${semana[i] ? 'bg-blue-600 text-white' : 'bg-surface-3 text-muted'}`}>
                        <input type="checkbox" className="hidden" checked={semana[i]} onChange={() => setSemana(w => w.map((v, j) => (j === i ? !v : v)))} />{s}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="bg-surface-2 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <button onClick={() => navegar(-1)} className="text-muted hover:text-text text-xs px-2">‹</button>
                    <span className="text-text-3 text-xs font-medium">{p2(cal.m)}/{cal.y} — clique para marcar/desmarcar</span>
                    <button onClick={() => navegar(1)} className="text-muted hover:text-text text-xs px-2">›</button>
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-center">
                    {SEMANA.map(s => <span key={s} className="text-[10px] text-subtle">{s}</span>)}
                    {celulas.map((d, i) => {
                      if (d === null) return <span key={i} />
                      const k = chave(cal.y, cal.m, d)
                      const on = dias.includes(k)
                      return <button key={i} onClick={() => alternarDia(k)} className={`text-xs rounded py-1 ${on ? 'bg-blue-600 text-white' : 'text-muted hover:bg-surface-3'}`}>{d}</button>
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Pré-visualização */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-muted text-xs font-medium uppercase tracking-wider">Pré-visualização</p>
            {carregandoAvisos && <span className="text-subtle text-xs">verificando OS existentes e {outraEmpresa?.name}…</span>}
          </div>
          {!contractId && <p className="text-subtle text-xs mb-2">Escolha cliente e contrato para calcular os valores.</p>}
          {linhas.length === 0 ? (
            <p className="text-subtle text-sm text-center py-6">Nenhum dia selecionado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-subtle text-left border-b border-border">
                    <th className="py-1.5 pr-2 font-medium">Data</th>
                    <th className="py-1.5 pr-2 font-medium">Horário</th>
                    <th className="py-1.5 pr-2 font-medium text-right">Horas</th>
                    <th className="py-1.5 pr-2 font-medium text-right">Bruto</th>
                    <th className="py-1.5 pr-2 font-medium text-right">Victor</th>
                    <th className="py-1.5 pr-2 font-medium text-right">Fab</th>
                    <th className="py-1.5 pr-2 font-medium">Avisos</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {linhas.map(l => (
                    <tr key={l.d} className={`border-b border-border/60 align-top ${l.pulada ? 'opacity-50' : ''}`}>
                      <td className="py-1.5 pr-2 text-text whitespace-nowrap">{rotulo(l.d)}</td>
                      <td className="py-1.5 pr-2">
                        {editando === l.d ? (
                          <div className="flex gap-1 flex-wrap">
                            {HORARIOS.map(h => (
                              <input key={h} type="time" value={l.t[h]} onChange={e => mudarHorarioLinha(l.d, h, e.target.value)} className="bg-surface-2 border border-border-strong rounded px-1 py-0.5 text-text text-xs w-[5.5rem]" />
                            ))}
                            <button onClick={() => setEditando(null)} className="text-blue-700 dark:text-blue-400 px-1">ok</button>
                          </div>
                        ) : (
                          <button onClick={() => setEditando(l.d)} title="Ajustar o horário só deste dia" className={`font-mono hover:text-blue-700 dark:hover:text-blue-400 ${l.customizada ? 'text-amber-700 dark:text-amber-300' : 'text-text-3'}`}>
                            {faixaHorario(l.t) || '--'}{l.t.intervalo_inicio && l.t.intervalo_fim ? ` (int ${l.t.intervalo_inicio}–${l.t.intervalo_fim})` : ''} ✎
                          </button>
                        )}
                      </td>
                      <td className={`py-1.5 pr-2 text-right font-mono ${l.hours <= 0 ? 'text-red-700 dark:text-red-400' : 'text-text-3'}`}>{hhmm(l.hours)}</td>
                      <td className="py-1.5 pr-2 text-right text-text-3 whitespace-nowrap">{l.calc ? fmt(l.calc.gross_value) : '—'}</td>
                      <td className="py-1.5 pr-2 text-right text-victor whitespace-nowrap">{l.calc ? fmt(l.calc.victor_share) : '—'}</td>
                      <td className="py-1.5 pr-2 text-right text-fabricio whitespace-nowrap">{l.calc ? fmt(l.calc.fabricio_share) : '—'}</td>
                      <td className="py-1.5 pr-2">
                        {l.duplicadas.length > 0 && <p className="text-amber-700 dark:text-amber-300">Já existe OS deste cliente neste dia</p>}
                        {l.conflitos.length > 0 && (
                          <p className="text-amber-700 dark:text-amber-300">Conflito de horário com {outraEmpresa?.name} ({l.conflitos.map(o => `${o.client_name || 'Sem cliente'}, ${faixaHorario(o)}`).join('; ')})</p>
                        )}
                        {(l.temAviso || pular[l.d] !== undefined) && (
                          <label className="inline-flex items-center gap-1 text-muted cursor-pointer">
                            <input type="checkbox" checked={l.pulada} onChange={e => setPular(p => ({ ...p, [l.d]: e.target.checked }))} /> pular
                          </label>
                        )}
                        {errosServidor[l.d] && <p className="text-red-700 dark:text-red-400">{errosServidor[l.d]}</p>}
                      </td>
                      <td className="py-1.5 text-right">
                        <button onClick={() => removerDia(l.d)} title="Remover este dia" className="text-subtle hover:text-red-700 dark:hover:text-red-400 px-1">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {aLancar.length > LIMITE && <p className="mt-3 text-red-700 dark:text-red-400 text-xs">Limite de {LIMITE} agendas por lote ({aLancar.length} selecionadas).</p>}
        {semHoras && <p className="mt-3 text-red-700 dark:text-red-400 text-xs">Há dia com horário sem horas (final antes do início?). Corrija ou remova a linha.</p>}
        {erro && <p className="mt-3 text-red-700 dark:text-red-400 text-xs bg-red-50 dark:bg-red-500/10 border border-red-300 dark:border-red-500/30 rounded-lg px-3 py-2">{erro}</p>}

        <div className="flex items-center justify-between gap-3 mt-5 pt-3 border-t border-border flex-wrap">
          <p className="text-muted text-xs">
            <span className="text-text font-medium">{aLancar.length}</span> dia(s){puladas > 0 && <> · {puladas} pulado(s)</>} · <span className="font-mono text-text">{hhmm(totHoras)}</span> · Bruto <span className="text-text">{fmt(totBruto)}</span>
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-text-3 rounded-lg text-sm">Cancelar</button>
            <button onClick={lancar} disabled={!podeLancar} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium">
              {enviando ? 'Lançando...' : `Lançar ${aLancar.length} agenda${aLancar.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
