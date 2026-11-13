import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { todayBR } from '../lib/dateUtils'
import HorasCalendar from '../components/HorasCalendar'
import LoteAgendas from '../components/LoteAgendas'
import { buscarOutraEmpresa, invalidarApontamentos } from '../lib/apontamentosCache'
import { semDescricao } from '../lib/semDescricao'
import { sobrepoe, faixaHorario } from '../lib/horasConflito'
import { calcular } from '../../lib/time-entry-calc.js'
import { tipoDaRegra, valoresDaRegra, chaveData, cotaDaDiaria, ROTULO_COBRANCA } from '../../lib/billing-type.js'

const BADGE_COBRANCA = {
  hora: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400',
  diaria: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400',
  projeto: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400',
}

function decimalToHHMM(decimal) {
  if (!decimal && decimal !== 0) return '--:--'
  const totalMinutes = Math.round(parseFloat(decimal) * 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export default function TimeEntries() {
  const { activeCompany, setActiveCompany, companies = [] } = useOutletContext()
  const outraEmpresa = companies.find(c => c.id !== activeCompany.id) || null
  const [entries, setEntries] = useState([])
  const [clients, setClients] = useState([])
  const [rules, setRules] = useState([])
  const [contracts, setContracts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth() + 1)
  const [filterYear, setFilterYear] = useState(new Date().getFullYear())
  const [form, setForm] = useState({
    client_id: '',
    contract_id: '',
    entry_date: todayBR(),
    hora_inicial: '',
    intervalo_inicio: '',
    intervalo_fim: '',
    hora_final: '',
    description: '',
    hours_fuel: '0',
    despesas_deslocamento: '0',
    notes: '',
  })
  const [preview, setPreview] = useState(null)
  const [editEntry, setEditEntry] = useState(null)
  const [filterClient, setFilterClient] = useState('')
  const [clientContracts, setClientContracts] = useState([])
  const [contractsLoading, setContractsLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')
  // Lista | Calendário, lembrado por navegador. localStorage pode lançar
  // (aba privada, site data bloqueado) — sem ele a tela abre em Lista.
  const [view, setView] = useState(() => {
    try { return localStorage.getItem('horas_view') === 'calendario' ? 'calendario' : 'lista' } catch { return 'lista' }
  })
  function mudarView(v) {
    setView(v)
    try { localStorage.setItem('horas_view', v) } catch { /* sem persistência */ }
  }
  // Apontamentos da OUTRA empresa no mesmo mês — só leitura, só no calendário,
  // para ver os dias já ocupados. Nunca entram em total, card ou Excel.
  const [mostrarOutra, setMostrarOutra] = useState(() => {
    try { return localStorage.getItem('horas_cal_outra_empresa') !== 'false' } catch { return true }
  })
  function mudarMostrarOutra(v) {
    setMostrarOutra(v)
    try { localStorage.setItem('horas_cal_outra_empresa', String(v)) } catch { /* sem persistência */ }
  }
  const [outraEntries, setOutraEntries] = useState([])
  const outraId = outraEmpresa?.id
  useEffect(() => {
    setOutraEntries([])
    if (view !== 'calendario' || !mostrarOutra || !outraId) return
    let vivo = true
    buscarOutraEmpresa(outraId, [`${filterYear}-${String(filterMonth).padStart(2, '0')}-01`])
      .then(lista => { if (vivo) setOutraEntries(lista) })
    // Troca rápida de mês/empresa: a resposta antiga não pode sobrescrever a nova.
    return () => { vivo = false }
  }, [view, mostrarOutra, outraId, filterMonth, filterYear])

  // Aviso de conflito do modal individual: busca a outra empresa no mês da DATA do
  // formulário, em qualquer visão e com o toggle do calendário ligado ou não.
  const [modalOutras, setModalOutras] = useState([])
  useEffect(() => {
    if (!showModal || !outraId || !form.entry_date) { setModalOutras([]); return }
    let vivo = true
    buscarOutraEmpresa(outraId, [form.entry_date]).then(lista => { if (vivo) setModalOutras(lista) })
    return () => { vivo = false }
  }, [showModal, outraId, form.entry_date])

  // Lote: modal + modo "Selecionar dias" do calendário.
  const [loteDias, setLoteDias] = useState(null) // null = fechado; [] = pelo cabeçalho
  const [selecionando, setSelecionando] = useState(false)
  const [selecionados, setSelecionados] = useState([])
  const [filtroSemDesc, setFiltroSemDesc] = useState(false)
  const [toast, setToast] = useState('')
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 4000)
    return () => clearTimeout(t)
  }, [toast])
  function sairDaSelecao() { setSelecionando(false); setSelecionados([]) }
  useEffect(() => {
    if (!selecionando || loteDias) return
    const onKey = (ev) => { if (ev.key === 'Escape') sairDaSelecao() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selecionando, loteDias])
  // Trocar empresa ou mês abandona a seleção (os dias eram de outra tela).
  useEffect(() => { sairDaSelecao(); setLoteDias(null) }, [activeCompany, filterMonth, filterYear])
  function loteConcluido({ created, skipped }) {
    setLoteDias(null)
    sairDaSelecao()
    setToast(`${created} agenda${created === 1 ? '' : 's'} lançada${created === 1 ? '' : 's'}${skipped ? ` (${skipped} pulada${skipped === 1 ? '' : 's'})` : ''}`)
    fetchAll()
  }

  useEffect(() => { fetchAll() }, [activeCompany, filterMonth, filterYear])
  useEffect(() => { setFilterClient('') }, [activeCompany, filterMonth])

  // Fecha o modal ao trocar de empresa. Sem isso, editar um lançamento da
  // Lumen e trocar para Imperium antes de salvar enviava o id da Lumen com o
  // company_id da Imperium — migrando o registro de empresa silenciosamente.
  useEffect(() => {
    setShowModal(false)
    setEditEntry(null)
    setForm(f => ({ ...f, client_id: '', contract_id: '' }))
    setClientContracts([])
    setPreview(null)
    setErro('')
  }, [activeCompany])

  async function fetchAll() {
    setLoading(true)
    try {
      const [entriesRes, clientsRes, rulesRes, contractsRes] = await Promise.all([
        fetch(`/api/time-entries?company_id=${activeCompany.id}&month=${filterMonth}&year=${filterYear}`),
        fetch(`/api/clients?company_id=${activeCompany.id}`),
        fetch(`/api/financial-rules?company_id=${activeCompany.id}`),
        fetch(`/api/contracts?company_id=${activeCompany.id}`),
      ])
      setEntries((await entriesRes.json()).entries || [])
      setClients((await clientsRes.json()).clients || [])
      setRules((await rulesRes.json()).rules || [])
      setContracts((await contractsRes.json()).contracts || [])
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }

  function timeToDecimal(time) {
    if (!time) return 0
    const [h, m] = time.split(':').map(Number)
    return h + m / 60
  }

  function calcHoras(f) {
    if (!f.hora_inicial || !f.hora_final) return 0
    const inicio = timeToDecimal(f.hora_inicial)
    const fim = timeToDecimal(f.hora_final)
    let intervalo = 0
    if (f.intervalo_inicio && f.intervalo_fim) {
      intervalo = timeToDecimal(f.intervalo_fim) - timeToDecimal(f.intervalo_inicio)
    }
    return Math.max(fim - inicio - intervalo, 0)
  }

  // Contrato do preview: o SELECIONADO no formulário, nunca "o primeiro ativo do
  // cliente". O Bokada tem dois (5 por hora e 10 mensal) e a regra de deslocamento
  // saía do errado. `clientContracts` é a lista carregada ao escolher o cliente;
  // `contracts` (a empresa inteira) cobre o instante em que openEdit ainda não a
  // resolveu.
  function contratoSelecionado(f) {
    const id = f?.contract_id
    if (!id) return null
    return clientContracts.find(c => String(c.id) === String(id))
      || contracts.find(c => String(c.id) === String(id))
      || null
  }

  // A regra vem do contrato — espelha lib/financial-rule.js no backend. Buscar pelo
  // cliente pegava a primeira das duas do Bokada: com "Bokada(Renato) 85" selecionado
  // o preview mostrava R$ 6.000 de bruto (regra #12, R$ 1.500/h, split 50/50) onde o
  // contrato dá R$ 340 (regra #8, R$ 85/h, 100/0) — e divergia do que era gravado.
  function regraDoContrato(contrato) {
    if (!contrato) return null
    if (!contrato.financial_rule_id) {
      console.warn(`Contrato ${contrato.id} (${contrato.name}) sem regra financeira vinculada.`)
      return null
    }
    const rule = rules.find(r => String(r.id) === String(contrato.financial_rule_id))
    if (!rule) console.warn(`Regra ${contrato.financial_rule_id} do contrato ${contrato.id} não está na lista carregada.`)
    return rule || null
  }

  // Preview pela MESMA função que o backend grava (lib/time-entry-calc.js). Antes a
  // fórmula era copiada aqui e só batia com o backend por disciplina.
  function calcPreview(f) {
    const contrato = contratoSelecionado(f)
    const rule = regraDoContrato(contrato)
    const hours = calcHoras(f)
    if (!rule || !hours) { setPreview(null); return }
    const tipo = tipoDaRegra(rule)

    // Diária: a cota desta OS depende das irmãs da mesma data (no mês carregado).
    let cota = null
    let osNoDia = 1
    if (tipo === 'diaria') {
      const irmas = entries.filter(e => String(e.contract_id) === String(f.contract_id)
        && chaveData(e.entry_date) === f.entry_date && (!editEntry || e.id !== editEntry.id))
      osNoDia = irmas.length + 1
      cota = cotaDaDiaria(rule, osNoDia, osNoDia - 1)
    }

    const c = calcular(hours, rule, f.hours_fuel, contrato, f.despesas_deslocamento, cota)
    const deslocTipo = contrato?.deslocamento_tipo || 'nao_cobrado'
    const despesas = deslocTipo === 'hora_despesas' ? (parseFloat(f.despesas_deslocamento) || 0) : 0
    setPreview({
      hours: hours.toFixed(2),
      tipo,
      liquido: tipo !== 'hora' && !!rule.is_net_value,
      osNoDia,
      unitario: valoresDaRegra(rule).unitario,
      gross: c.gross_value.toFixed(2),
      tax: c.tax_amount.toFixed(2),
      net: c.net_value.toFixed(2),
      desloc: c.valor_deslocamento.toFixed(2),
      despesas: despesas.toFixed(2),
      cobrado: deslocTipo !== 'nao_cobrado',
      victor: c.victor_share.toFixed(2),
      fabricio: c.fabricio_share.toFixed(2),
    })
  }

  function updateForm(field, value) {
    const nf = { ...form, [field]: value }
    setForm(nf)
    calcPreview(nf)
  }

  function onContractChange(contractId) {
    const ct = clientContracts.find(c => String(c.id) === String(contractId))
    const dh = ct && parseFloat(ct.displacement_hours) > 0 ? String(ct.displacement_hours) : '0'
    const nf = { ...form, contract_id: contractId, hours_fuel: dh }
    setForm(nf)
    calcPreview(nf)
  }

  async function loadContractsForClient(clientId) {
    if (!clientId) { setClientContracts([]); return }
    setContractsLoading(true)
    try {
      const r = await fetch(`/api/contracts?client_id=${clientId}`)
      setClientContracts((await r.json()).contracts || [])
    } catch(e) { console.error(e); setClientContracts([]) }
    finally { setContractsLoading(false) }
  }

  // `data` (YYYY-MM-DD) vem do clique num dia do calendário; o botão do
  // cabeçalho passa um evento, que é ignorado.
  function openNew(data) {
    setEditEntry(null)
    const entry_date = typeof data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : todayBR()
    setForm({ client_id: '', contract_id: '', entry_date, hora_inicial: '', intervalo_inicio: '', intervalo_fim: '', hora_final: '', description: '', hours_fuel: '0', despesas_deslocamento: '0', notes: '' })
    setClientContracts([])
    setPreview(null)
    setShowModal(true)
  }

  async function save() {
    if (!form.client_id || !form.contract_id || !form.hora_inicial || !form.hora_final || !form.entry_date) return
    if (saving) return
    setSaving(true)
    setErro('')
    try {
      const method = editEntry ? 'PUT' : 'POST'
      const body = editEntry
        ? { ...form, company_id: activeCompany.id, id: editEntry.id }
        : { ...form, company_id: activeCompany.id }
      const res = await fetch('/api/time-entries', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      // Antes o status era ignorado: um 500 fechava o modal e limpava o
      // formulário, e o usuário achava que tinha salvo.
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErro(data.error || 'Não foi possível salvar o lançamento.')
        return
      }
      invalidarApontamentos(activeCompany.id)
      closeModal()
      fetchAll()
    } catch {
      setErro('Erro de conexão com o servidor.')
    } finally {
      setSaving(false)
    }
  }

  function closeModal() {
    setShowModal(false)
    setEditEntry(null)
    setForm({ client_id: '', contract_id: '', entry_date: todayBR(), hora_inicial: '', intervalo_inicio: '', intervalo_fim: '', hora_final: '', description: '', hours_fuel: '0', despesas_deslocamento: '0', notes: '' })
    setClientContracts([])
    setPreview(null)
    setErro('')
  }

  async function deleteEntry(id) {
    if (!confirm('Excluir este lançamento?')) return
    await fetch('/api/time-entries', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    invalidarApontamentos(activeCompany.id)
    fetchAll()
  }

  function openEdit(entry) {
    setEditEntry(entry)
    loadContractsForClient(entry.client_id)
    const f = {
      client_id: String(entry.client_id || ''),
      contract_id: String(entry.contract_id || ''),
      entry_date: entry.entry_date ? entry.entry_date.split('T')[0] : todayBR(),
      hora_inicial: entry.hora_inicial || '',
      intervalo_inicio: entry.intervalo_inicio || '',
      intervalo_fim: entry.intervalo_fim || '',
      hora_final: entry.hora_final || '',
      description: entry.description || '',
      hours_fuel: entry.horas_deslocamento || '0',
      despesas_deslocamento: entry.despesas_deslocamento || '0',
      notes: entry.notes || '',
    }
    setForm(f)
    calcPreview(f)
    setShowModal(true)
  }

  function slugify(str) {
    return String(str)
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
  }

  async function exportToExcel() {
    try {
      let url = `/api/export-os?company_id=${activeCompany.id}&month=${filterMonth}&year=${filterYear}`
      if (filterClient) url += `&client_id=${filterClient}`
      const res = await fetch(url)
      if (!res.ok) { alert('Erro ao gerar Excel'); return }
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const monthsShort = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']
      const clientName = filterClient
        ? (clientsWithEntries.find(c => String(c.id) === String(filterClient))?.name || 'cliente')
        : 'todos'
      a.href = objectUrl
      a.download = `horas_${slugify(clientName)}_${monthsShort[filterMonth-1]}_${filterYear}.xlsx`
      a.click()
      URL.revokeObjectURL(objectUrl)
    } catch(e) {
      alert('Erro ao exportar: ' + e.message)
    }
  }

  const fmt = (v) => v != null ? `R$ ${parseFloat(v).toFixed(2).replace('.', ',')}` : '-'
  // Clientes com lançamentos no período (derivado de todos os entries, não dos filtrados)
  const clientsWithEntries = Array.from(
    entries.reduce((map, e) => {
      if (e.client_id != null && !map.has(e.client_id)) map.set(e.client_id, e.client_name || 'Sem cliente')
      return map
    }, new Map())
  ).map(([id, name]) => ({ id, name }))
  const filteredEntries = entries
    .filter(e => !filterClient || String(e.client_id) === String(filterClient))
    .filter(e => !filtroSemDesc || semDescricao(e))
  const qtdSemDesc = entries.filter(e => (!filterClient || String(e.client_id) === String(filterClient)) && semDescricao(e)).length
  const totalVictor = filteredEntries.reduce((s, e) => s + (parseFloat(e.victor_share) || 0), 0)
  const totalFab = filteredEntries.reduce((s, e) => s + (parseFloat(e.fabricio_share) || 0), 0)
  const totalHoras = filteredEntries.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0)
  const totalBruto = filteredEntries.reduce((s, e) => s + (parseFloat(e.gross_value) || 0), 0)
  // Imposto e líquido vêm GRAVADOS no apontamento (lib/time-entry-calc.js) — não
  // recalcular aqui. Lançamento antigo sem net_value cai em bruto − imposto.
  const totalImposto = filteredEntries.reduce((s, e) => s + (parseFloat(e.tax_amount) || 0), 0)
  const totalLiquido = filteredEntries.reduce((s, e) => {
    const net = parseFloat(e.net_value)
    if (e.net_value != null && e.net_value !== '' && !Number.isNaN(net)) return s + net
    return s + (parseFloat(e.gross_value) || 0) - (parseFloat(e.tax_amount) || 0)
  }, 0)
  // Demonstrativo: separa a parte de Victor em serviço (fixo/hora), deslocamento e
  // lucro (restante do victor_share). O fixo/hora sai da regra do CONTRATO do
  // lançamento — pela regra do cliente, uma linha do Bokada por hora era decomposta
  // com o fixo de R$ 800 da regra de projeto e o "lucro" saía negativo.
  // Regra de cobrança de um apontamento (via contrato) e quantas OS dividem a data.
  const regraDaEntrada = (e) => {
    const ct = contracts.find(c => String(c.id) === String(e.contract_id))
    return ct ? rules.find(r => String(r.id) === String(ct.financial_rule_id)) || null : null
  }
  const osPorDia = entries.reduce((m, e) => {
    const k = `${e.contract_id}|${chaveData(e.entry_date)}`
    m.set(k, (m.get(k) || 0) + 1)
    return m
  }, new Map())
  const breakdown = filteredEntries.reduce((acc, e) => {
    const rule = regraDaEntrada(e)
    const tipo = rule ? tipoDaRegra(rule) : 'hora'
    const hours = parseFloat(e.hours) || 0
    const victorTotal = parseFloat(e.victor_share) || 0
    const valorDesloc = parseFloat(e.valor_deslocamento) || 0
    // Fixo do Victor: por hora = horas × fixo/h; diária = a fração da diária desta OS;
    // projeto = 0 (o fixo mensal está na fatura, não na OS). Imposto por fora (valor
    // líquido) também entra no victor_share e fica dentro de "lucro" aqui.
    const n = osPorDia.get(`${e.contract_id}|${chaveData(e.entry_date)}`) || 1
    const victorServico = !rule ? 0
      : tipo === 'hora' ? hours * (parseFloat(rule.victor_fixed_per_hour) || 0)
      : tipo === 'diaria' && parseFloat(e.gross_value) > 0 ? (parseFloat(rule.victor_fixed_daily) || 0) / n
      : 0
    acc.desloc += valorDesloc
    acc.servico += victorServico
    acc.lucro += victorTotal - valorDesloc - victorServico
    return acc
  }, { servico: 0, desloc: 0, lucro: 0 })
  // Card de um apontamento — usado pela lista e pelo painel do dia do calendário.
  const renderEntry = (e) => (
    <div key={e.id} className="bg-surface shadow-sm dark:shadow-none border border-border rounded-xl p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400 text-xs rounded-full">{e.client_name || 'Sem cliente'}</span>
            <span className="text-subtle text-xs">{new Date(e.entry_date).toLocaleDateString('pt-BR', {timeZone:'UTC'})}</span>
            <span className="text-subtle text-xs font-mono">{decimalToHHMM(e.hours)}</span>
            {e.hora_inicial && e.hora_final && (
              <span className="text-faint text-xs font-mono">{e.hora_inicial}→{e.hora_final}{e.intervalo_inicio ? ` (int: ${e.intervalo_inicio}-${e.intervalo_fim})` : ''}</span>
            )}
            {parseFloat(e.horas_deslocamento) > 0 && (
              <span className="text-yellow-700 dark:text-yellow-600 text-xs">🚗 {e.horas_deslocamento}h desloc.</span>
            )}
            {parseFloat(e.despesas_deslocamento) > 0 && (
              <span className="text-yellow-700 dark:text-yellow-600 text-xs">💸 {fmt(e.despesas_deslocamento)} despesas</span>
            )}
          </div>
          {e.contract_name && (
            <p className="text-subtle text-xs mb-1">📄 {e.contract_name}</p>
          )}
          {semDescricao(e)
        ? <p className="text-amber-700 dark:text-amber-300/80 text-xs" title="Sem descrição">📝 Sem descrição — edite para completar</p>
        : <p className="text-text text-sm">{e.description}</p>}
          {(() => {
            // Por diária/projeto as horas são só demonstrativo: o valor segue a regra.
            const rule = regraDaEntrada(e)
            const tipo = rule ? tipoDaRegra(rule) : 'hora'
            if (tipo === 'hora') return null
            const n = osPorDia.get(`${e.contract_id}|${chaveData(e.entry_date)}`) || 1
            const nota = tipo === 'projeto'
              ? 'incluso no fixo mensal'
              : parseFloat(e.gross_value) > 0
                ? (n > 1 ? `1 diária na data, dividida entre ${n} OS` : '1 diária')
                : 'diária da data já cobrada'
            return (
              <div className="flex items-center gap-2 mt-1 text-xs">
                <span className={`px-2 py-0.5 rounded-full font-medium ${BADGE_COBRANCA[tipo]}`}>{ROTULO_COBRANCA[tipo]}</span>
                <span className="text-subtle">horas informativas · {nota}</span>
              </div>
            )
          })()}
          <div className="flex gap-4 mt-2 text-xs">
            <span className="text-subtle">{regraDaEntrada(e)?.is_net_value && tipoDaRegra(regraDaEntrada(e)) !== 'hora' ? 'NF' : 'Bruto'}: <span className="text-text-3">{fmt(e.gross_value)}</span></span>
            {parseFloat(e.tax_amount) > 0 && <span className="text-subtle">Imposto: <span className="text-red-700 dark:text-red-400">-{fmt(e.tax_amount)}</span></span>}
            <span className="text-subtle">Victor: <span className="text-victor">{fmt(e.victor_share)}</span></span>
            <span className="text-subtle">Fab: <span className="text-fabricio">{fmt(e.fabricio_share)}</span></span>
          </div>
        </div>
        <div className="flex gap-3 shrink-0">
          <button onClick={() => openEdit(e)} className="text-faint hover:text-blue-700 dark:hover:text-blue-400 text-sm transition-colors">Editar</button>
          <button onClick={() => deleteEntry(e.id)} className="text-faint hover:text-red-700 dark:hover:text-red-400 text-sm transition-colors">Excluir</button>
        </div>
      </div>
    </div>
  )
  const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

  return (
    <div className="p-8 min-w-0 max-w-full">
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-text">Apontamento de Horas</h2>
          <p className="text-muted text-sm mt-1">{activeCompany.name}</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <div className="flex bg-surface-2 rounded-lg p-0.5">
            {[['lista', 'Lista'], ['calendario', 'Calendário']].map(([v, rot]) => (
              <button key={v} onClick={() => mudarView(v)} className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === v ? 'bg-surface-4 text-text' : 'text-muted hover:text-text'}`}>{rot}</button>
            ))}
          </div>
          {entries.length > 0 && (
            <button
              onClick={exportToExcel}
              className="px-4 py-2 bg-green-700 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              📥 Exportar Excel
            </button>
          )}
          <button onClick={() => setLoteDias([])} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-text-2 rounded-lg text-sm font-medium transition-colors">
            🗓️ Lançar em lote
          </button>
          <button onClick={openNew} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors">
            + Lançar horas
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap items-center">
        {months.map((m, i) => (
          <button key={i} onClick={() => setFilterMonth(i+1)} className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filterMonth === i+1 ? 'bg-blue-600 text-white' : 'bg-surface-2 text-muted hover:bg-surface-3'}`}>{m}</button>
        ))}
        <input type="number" value={filterYear} onChange={e=>setFilterYear(e.target.value)} className="ml-2 w-20 bg-surface-2 border border-border-strong rounded-lg px-2 py-1 text-text text-xs focus:outline-none"/>
      </div>

      {clientsWithEntries.length > 0 && (
        <div className="flex gap-2 mb-6 flex-wrap">
          <button
            onClick={() => setFilterClient('')}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filterClient === '' ? 'bg-surface-4 text-text' : 'bg-surface-2 text-muted hover:bg-surface-3'
            }`}
          >
            Todos os clientes
          </button>
          {clientsWithEntries.map(c => (
            <button
              key={c.id}
              onClick={() => setFilterClient(String(c.id))}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filterClient === String(c.id) ? 'bg-indigo-600 text-white' : 'bg-surface-2 text-muted hover:bg-surface-3'
              }`}
            >
              {c.name}
            </button>
          ))}
          <button
            onClick={() => setFiltroSemDesc(v => !v)}
            title="OS lançadas sem descrição, para completar depois"
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filtroSemDesc ? 'bg-amber-600 text-white' : 'bg-surface-2 text-amber-700 dark:text-amber-300/80 hover:bg-surface-3'
            }`}
          >
            📝 Sem descrição{qtdSemDesc ? ` (${qtdSemDesc})` : ''}
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4 mb-6 min-w-0">
        <div className="bg-surface shadow-sm dark:shadow-none border border-border rounded-xl p-4">
          <p className="text-muted text-xs mb-1">Total horas</p>
          <p className="text-text text-xl font-bold">{decimalToHHMM(totalHoras)}</p>
          <p className="text-subtle text-xs mt-1">Bruto: <span className="text-text-3">{fmt(totalBruto)}</span></p>
          {totalImposto > 0 && (
            <p className="text-subtle text-xs">Imposto: <span className="text-red-700 dark:text-red-400">-{fmt(totalImposto)}</span></p>
          )}
          <p className="text-subtle text-xs">Líquido: <span className="text-text font-semibold">{fmt(totalLiquido)}</span></p>
        </div>
        <div className="bg-surface shadow-sm dark:shadow-none border border-border rounded-xl p-4">
          <p className="text-muted text-xs mb-2">Victor</p>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between text-subtle">
              <span>Serviço</span>
              <span className="text-blue-700 dark:text-blue-300">{fmt(breakdown.servico)}</span>
            </div>
            <div className="flex justify-between text-subtle">
              <span>Deslocamento</span>
              <span className="text-blue-700 dark:text-blue-300">{fmt(breakdown.desloc)}</span>
            </div>
            <div className="flex justify-between text-subtle">
              <span>Lucro</span>
              <span className="text-blue-700 dark:text-blue-300">{fmt(breakdown.lucro)}</span>
            </div>
          </div>
          <div className="flex justify-between mt-2 pt-2 border-t border-border-strong">
            <span className="text-text-3 text-sm font-medium">TOTAL</span>
            <span className="text-victor text-lg font-bold">{fmt(totalVictor)}</span>
          </div>
        </div>
        <div className="bg-surface shadow-sm dark:shadow-none border border-border rounded-xl p-4">
          <p className="text-muted text-xs mb-2">Fabrício</p>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between text-subtle">
              <span>Lucro</span>
              <span className="text-purple-700 dark:text-purple-300">{fmt(totalFab)}</span>
            </div>
          </div>
          <div className="flex justify-between mt-2 pt-2 border-t border-border-strong">
            <span className="text-text-3 text-sm font-medium">TOTAL</span>
            <span className="text-fabricio text-lg font-bold">{fmt(totalFab)}</span>
          </div>
        </div>
      </div>

      {loading && view === 'calendario' ? <div className="text-subtle text-sm">Carregando...</div> : view === 'calendario' ? (
        <HorasCalendar
          entries={filteredEntries}
          year={filterYear}
          month={filterMonth}
          fmt={fmt}
          renderEntry={renderEntry}
          onNewOnDay={openNew}
          outras={outraEntries}
          ativa={activeCompany}
          outra={outraEmpresa}
          mostrarOutra={mostrarOutra}
          onToggleOutra={mudarMostrarOutra}
          onVerNaOutra={() => outraEmpresa && setActiveCompany?.(outraEmpresa)}
          selecionando={selecionando}
          selecionados={selecionados}
          onIniciarSelecao={() => { setSelecionados([]); setSelecionando(true) }}
          onAlternarSelecionado={(k) => setSelecionados(ss => (ss.includes(k) ? ss.filter(x => x !== k) : [...ss, k]))}
          onLimparSelecao={() => setSelecionados([])}
          onCancelarSelecao={sairDaSelecao}
          onLancarSelecionados={() => selecionados.length && setLoteDias([...selecionados].sort())}
        />
      ) : loading ? <div className="text-subtle text-sm">Carregando...</div> : filteredEntries.length === 0 ? (
        <div className="text-center py-16 text-faint"><p className="text-4xl mb-3">⏱️</p><p>Nenhum lançamento neste período.</p></div>
      ) : (
        <div className="space-y-3">
          {filteredEntries.map(renderEntry)}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface shadow-sm dark:shadow-none border border-border rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-text mb-4">{editEntry ? 'Editar lançamento' : 'Lançar horas'}</h3>
            <div className="space-y-3">
              <select value={form.client_id} onChange={e=>{ const v = e.target.value; const nf = {...form, client_id: v, contract_id: ''}; setForm(nf); calcPreview(nf); loadContractsForClient(v) }} className="w-full bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-blue-500">
                <option value="">Selecione o cliente</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div className="flex flex-col gap-1">
                <select value={form.contract_id} onChange={e=>onContractChange(e.target.value)} disabled={!form.client_id || contractsLoading || clientContracts.length === 0} className="w-full bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50">
                  <option value="">{contractsLoading ? 'Carregando contratos...' : 'Selecione o contrato'}</option>
                  {clientContracts.map(ct => (
                    <option key={ct.id} value={ct.id}>
                      {ct.name} — {(() => { const r = regraDoContrato(ct); return r ? ROTULO_COBRANCA[tipoDaRegra(r)] : (ct.billing_type === 'hora' ? 'Por hora' : ct.billing_type === 'dia' ? 'Por dia' : 'Fixo/Mensal') })()}
                    </option>
                  ))}
                </select>
                {form.client_id && !contractsLoading && clientContracts.length === 0 && (
                  <p className="text-amber-700 dark:text-amber-400 text-xs">Este cliente não possui contrato ativo. Cadastre um contrato antes de lançar horas.</p>
                )}
              </div>
              <input type="date" value={form.entry_date} onChange={e=>updateForm('entry_date',e.target.value)} className="w-full bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-blue-500"/>

              {/* Horários */}
              <div className="bg-surface-2 rounded-xl p-4 space-y-3">
                <p className="text-muted text-xs font-medium uppercase tracking-wider">Horários</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-subtle text-xs mb-1 block">Hora inicial</label>
                    <input type="time" value={form.hora_inicial} onChange={e=>updateForm('hora_inicial',e.target.value)} className="w-full bg-surface-3 border border-border-stronger rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-blue-500"/>
                  </div>
                  <div>
                    <label className="text-subtle text-xs mb-1 block">Hora final</label>
                    <input type="time" value={form.hora_final} onChange={e=>updateForm('hora_final',e.target.value)} className="w-full bg-surface-3 border border-border-stronger rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-blue-500"/>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-subtle text-xs mb-1 block">Intervalo início</label>
                    <input type="time" value={form.intervalo_inicio} onChange={e=>updateForm('intervalo_inicio',e.target.value)} className="w-full bg-surface-3 border border-border-stronger rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-blue-500"/>
                  </div>
                  <div>
                    <label className="text-subtle text-xs mb-1 block">Intervalo fim</label>
                    <input type="time" value={form.intervalo_fim} onChange={e=>updateForm('intervalo_fim',e.target.value)} className="w-full bg-surface-3 border border-border-stronger rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-blue-500"/>
                  </div>
                </div>
                {preview && (
                  <div className="text-center pt-1">
                    <span className="text-text font-bold text-lg">{decimalToHHMM(preview.hours)}</span>
                    <span className="text-subtle text-xs ml-2">total calculado</span>
                  </div>
                )}
              </div>

              {(() => {
                // Aviso, não trava: só compara com o que já está carregado (mês
                // em tela, visão Calendário com a outra empresa ligada).
                const conflitos = modalOutras.filter(o => chaveData(o.entry_date) === form.entry_date && sobrepoe(form, o))
                if (!conflitos.length) return null
                return (
                  <p className="text-amber-700 dark:text-amber-300 text-xs bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/30 rounded-lg px-3 py-2">
                    ⚠️ Você já tem horas na {outraEmpresa?.name} neste dia: {conflitos.map(o => `${faixaHorario(o)} (${o.client_name || 'Sem cliente'})`).join(', ')}
                  </p>
                )
              })()}
              <textarea placeholder="Descrição da atividade" value={form.description} onChange={e=>updateForm('description',e.target.value)} rows={3} className="w-full bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-text text-sm placeholder-subtle focus:outline-none focus:border-blue-500 resize-none"/>
              <input placeholder="Horas de deslocamento (opcional)" type="number" step="0.5" value={form.hours_fuel} onChange={e=>updateForm('hours_fuel',e.target.value)} className="w-full bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-text text-sm placeholder-subtle focus:outline-none focus:border-blue-500"/>
              {contratoSelecionado(form)?.deslocamento_tipo === 'hora_despesas' && (
                <input placeholder="Despesas de deslocamento (R$) — pedágio + combustível + almoço" type="number" step="0.01" value={form.despesas_deslocamento} onChange={e=>updateForm('despesas_deslocamento',e.target.value)} className="w-full bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-text text-sm placeholder-subtle focus:outline-none focus:border-blue-500"/>
              )}
              <input placeholder="Observações" value={form.notes} onChange={e=>updateForm('notes',e.target.value)} className="w-full bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-text text-sm placeholder-subtle focus:outline-none focus:border-blue-500"/>

              {preview && (
                <div className="bg-surface-2 rounded-xl p-4 space-y-2 text-sm">
                  <p className="text-muted text-xs font-medium uppercase tracking-wider mb-2">Preview do cálculo</p>
                  {preview.tipo === 'diaria' && (
                    <p className="text-emerald-700 dark:text-emerald-400 text-xs">
                      Por diária: horas só informativas. {preview.osNoDia > 1
                        ? `Já há ${preview.osNoDia - 1} OS neste contrato nesta data — a diária (${fmt(preview.unitario)}) é dividida entre as ${preview.osNoDia}.`
                        : `1 diária = ${fmt(preview.unitario)}${preview.liquido ? ' líquido' : ''}.`}
                    </p>
                  )}
                  {preview.tipo === 'projeto' && <p className="text-amber-700 dark:text-amber-400 text-xs">Por projeto: OS só demonstrativa — o valor está no fixo mensal da fatura.</p>}
                  <div className="flex justify-between"><span className="text-muted">{preview.liquido ? 'NF (líquido + imposto por fora)' : 'Bruto'}</span><span className="text-text">R$ {preview.gross}</span></div>
                  <div className="flex justify-between"><span className="text-muted">{preview.liquido ? 'Imposto (por fora, → Victor)' : 'Imposto'}</span><span className="text-red-700 dark:text-red-400">{preview.liquido ? '' : '-'}R$ {preview.tax}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Líquido</span><span className="text-text">R$ {preview.net}</span></div>
                  {parseFloat(preview.desloc) > 0 && <div className="flex justify-between"><span className="text-muted">{preview.cobrado ? 'Deslocamento cobrado' : 'Deslocamento (Victor)'}{parseFloat(preview.despesas) > 0 ? ' + despesas' : ''}</span><span className="text-yellow-700 dark:text-yellow-400">R$ {preview.desloc}</span></div>}
                  <div className="border-t border-border-strong pt-2 mt-2">
                    <div className="flex justify-between"><span className="text-muted">Victor</span><span className="text-victor font-medium">R$ {preview.victor}</span></div>
                    <div className="flex justify-between mt-1"><span className="text-muted">Fabrício</span><span className="text-fabricio font-medium">R$ {preview.fabricio}</span></div>
                  </div>
                </div>
              )}
            </div>
            {erro && (
              <p className="mt-3 text-red-700 dark:text-red-400 text-xs bg-red-50 dark:bg-red-500/10 border border-red-300 dark:border-red-500/30 rounded-lg px-3 py-2">{erro}</p>
            )}
            <div className="flex gap-3 mt-5">
              <button onClick={closeModal} className="flex-1 py-2 bg-surface-2 hover:bg-surface-3 text-text-3 rounded-lg text-sm transition-colors">Cancelar</button>
              <button onClick={save} disabled={saving || !form.client_id || !form.contract_id} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors">{saving ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}

      {loteDias && (
        <LoteAgendas
          key={loteDias.join(',') || 'cabecalho'}
          activeCompany={activeCompany}
          outraEmpresa={outraEmpresa}
          clients={clients}
          rules={rules}
          diasIniciais={loteDias}
          mesRef={{ year: Number(filterYear), month: filterMonth }}
          onClose={() => setLoteDias(null)}
          onDone={loteConcluido}
        />
      )}

      {toast && (
        <div className="fixed top-4 right-4 z-[60] bg-emerald-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg">{toast}</div>
      )}
    </div>
  )
}
