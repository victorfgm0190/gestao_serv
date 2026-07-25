import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { todayBR } from '../lib/dateUtils'

// APURAÇÃO FISCAL — DAS / INSS / Honorários.
//
// Front de api/fiscal-obligations.js + api/fiscal-payments.js. O fluxo é sequencial e
// a tela reflete isso: apurar → lançar a guia oficial → quitar → abater dos payables
// do Victor. Cada etapa só habilita a seguinte.
//
// Nenhum cálculo acontece aqui: valores, rateio e status vêm todos do backend.

const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

const KIND_LABEL = { das: 'DAS', inss: 'INSS', honorarios: 'Honorários' }
const KIND_ICON = { das: '🏛️', inss: '🧾', honorarios: '📋' }

const STATUS_STYLE = {
  previsto: 'bg-gray-700 text-gray-300',
  apurado: 'bg-blue-500/20 text-blue-300 border border-blue-500/40',
  parcial: 'bg-amber-500/20 text-amber-300 border border-amber-500/40',
  pago: 'bg-green-500/20 text-green-300 border border-green-500/40',
}

const fmt = (v) => `R$ ${(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pct = (v) => `${((Number(v) || 0) * 100).toFixed(2)}%`
// Datas do Postgres chegam como ISO em UTC; sem timeZone:'UTC' o dia volta um.
const dataBR = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—')

export default function FiscalObligations() {
  const { activeCompany } = useOutletContext()
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [obligations, setObligations] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')
  const [guiaModal, setGuiaModal] = useState(null)
  const [pagtoModal, setPagtoModal] = useState(null)
  const [payments, setPayments] = useState([])

  useEffect(() => { fetchObligations() }, [activeCompany, month, year])

  async function fetchObligations() {
    setLoading(true); setMsg(''); setErro('')
    try {
      const res = await fetch(`/api/fiscal-obligations?company_id=${activeCompany.id}&year=${year}&month=${month}`)
      setObligations(res.ok ? ((await res.json()).data || []) : [])
    } catch (e) { console.error(e); setErro('Falha ao carregar a apuração.') }
    finally { setLoading(false) }
  }

  // Toda ação passa por aqui: mesma trava de concorrência, mesmo tratamento de erro.
  async function acao(chave, url, body, sucesso) {
    if (busy) return
    setBusy(chave); setMsg(''); setErro('')
    try {
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(data.error || 'Não foi possível concluir a operação.'); return null }
      setMsg(typeof sucesso === 'function' ? sucesso(data) : sucesso)
      await fetchObligations()
      return data
    } catch { setErro('Erro de conexão com o servidor.'); return null }
    finally { setBusy('') }
  }

  const apurar = () => acao('apurar', '/api/fiscal-obligations?action=apurar',
    { company_id: activeCompany.id, month, year },
    (d) => `Apurado: DAS ${fmt(d.apuracao.das)} · INSS ${fmt(d.apuracao.inss)} · Honorários ${fmt(d.apuracao.honorarios)}. ` +
           `Anexo ${d.apuracao.anexo} (Fator R ${pct(d.apuracao.fatorR)}), ${d.allocations} rateios por cliente.`)

  const distribuir = (incluir_previsto) => acao('distribuir', '/api/fiscal-obligations?action=distribuir',
    { company_id: activeCompany.id, month, year, incluir_previsto },
    (d) => `Abatido ${fmt(d.distribuicao.consumido)} de ${d.payables_afetados.length} lançamento(s) do Victor.` +
           (d.distribuicao.nao_coberto > 0 ? ` Sem saldo para ${fmt(d.distribuicao.nao_coberto)} — sai do capital próprio.` : ''))

  const estornarDistribuicao = () => acao('estornar-dist', '/api/fiscal-obligations?action=estornar-distribuicao',
    { company_id: activeCompany.id, month, year }, 'Distribuição estornada; os saldos do Victor voltaram.')

  async function salvarGuia(e) {
    e.preventDefault()
    const f = guiaModal
    if (busy) return
    setBusy('guia'); setMsg(''); setErro('')
    try {
      const res = await fetch('/api/fiscal-obligations?action=lancar-guia', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          obligation_id: f.id,
          // String vazia = remover o lançamento e voltar à estimativa.
          amount_actual: f.amount_actual === '' ? null : parseFloat(f.amount_actual),
          due_date: f.due_date || null,
          doc_number: f.doc_number || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(data.error || 'Não foi possível salvar a guia.'); return }
      setMsg(f.amount_actual === ''
        ? 'Lançamento removido; a obrigação voltou ao valor estimado.'
        : `Guia de ${KIND_LABEL[f.kind]} lançada: ${fmt(data.summary.total_amount)}` +
          (data.summary.diferenca_vs_estimado ? ` (${data.summary.diferenca_vs_estimado > 0 ? '+' : ''}${fmt(data.summary.diferenca_vs_estimado)} vs. o estimado).` : '.'))
      setGuiaModal(null)
      await fetchObligations()
    } catch { setErro('Erro de conexão com o servidor.') }
    finally { setBusy('') }
  }

  async function abrirPagamentos(ob) {
    setPagtoModal({ ob, amount: '', paid_at: todayBR(), method: 'pix' })
    setPayments([])
    try {
      const res = await fetch(`/api/fiscal-payments?obligation_id=${ob.id}`)
      if (res.ok) setPayments((await res.json()).payments || [])
    } catch (e) { console.error(e) }
  }

  async function registrarPagamento(e) {
    e.preventDefault()
    const f = pagtoModal
    if (busy) return
    setBusy('pagar'); setErro('')
    try {
      const res = await fetch('/api/fiscal-payments?action=pagar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ obligation_id: f.ob.id, amount: parseFloat(f.amount), paid_at: f.paid_at, method: f.method }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(data.error || 'Não foi possível registrar o pagamento.'); return }
      setMsg(`Pagamento de ${fmt(f.amount)} registrado.` +
        (data.overpaid > 0 ? ` Atenção: ${fmt(data.overpaid)} acima do devido.` : '') +
        (data.summary.remaining > 0 ? ` Faltam ${fmt(data.summary.remaining)}.` : ' Obrigação quitada.'))
      await abrirPagamentos({ ...f.ob, id: f.ob.id })
      await fetchObligations()
    } catch { setErro('Erro de conexão com o servidor.') }
    finally { setBusy('') }
  }

  async function estornarPagamento(id) {
    if (busy) return
    setBusy('estorno-pag'); setErro('')
    try {
      const res = await fetch(`/api/fiscal-payments?payment_id=${id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(data.error || 'Não foi possível estornar.'); return }
      setMsg('Pagamento estornado.')
      await abrirPagamentos(pagtoModal.ob)
      await fetchObligations()
    } catch { setErro('Erro de conexão com o servidor.') }
    finally { setBusy('') }
  }

  // ---- estado derivado ----
  const apurado = obligations.length > 0
  const snapshot = obligations[0]?.calc_snapshot || null
  // O rateio da apuração (proporcional_nf) é o que mostra o custo por cliente;
  // as linhas de consumo_payable são o registro do abatimento, não o rateio.
  const rateio = {}
  let distribuido = false
  for (const ob of obligations) {
    for (const a of ob.allocations || []) {
      if (a.payable_victor_id) { distribuido = true; continue }
      const k = a.client_name || `Cliente ${a.client_id}`
      rateio[k] ||= { das: 0, inss: 0, honorarios: 0, total: 0 }
      rateio[k][ob.kind] = (rateio[k][ob.kind] || 0) + (parseFloat(a.amount) || 0)
      rateio[k].total += parseFloat(a.amount) || 0
    }
  }
  const rateioLista = Object.entries(rateio).sort((a, b) => b[1].total - a[1].total)
  const totalDevido = obligations.reduce((s, o) => s + (o.amount_actual != null ? Number(o.amount_actual) : Number(o.amount_estimated) || 0), 0)
  const totalPago = obligations.reduce((s, o) => s + (Number(o.paid_amount) || 0), 0)
  const temPrevisto = obligations.some((o) => o.status === 'previsto')
  const tudoQuitado = apurado && obligations.every((o) => o.status === 'pago')

  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-white">Apuração Fiscal</h2>
          <p className="text-gray-400 text-sm mt-1">
            DAS, INSS e honorários de {months[month - 1]}/{year} — {activeCompany.name}
          </p>
        </div>
        <button onClick={apurar} disabled={!!busy}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
          {busy === 'apurar' ? 'Apurando...' : apurado ? 'Reapurar mês' : 'Apurar mês'}
        </button>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap items-center">
        {months.map((m, i) => (
          <button key={i} onClick={() => setMonth(i + 1)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${month === i + 1 ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{m}</button>
        ))}
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white text-xs ml-2">
          {[year - 1, year, year + 1].filter((v, i, a) => a.indexOf(v) === i).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {msg && <p className="mb-4 text-green-300 text-sm bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">✅ {msg}</p>}
      {erro && <p className="mb-4 text-red-300 text-sm bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">⚠️ {erro}</p>}

      {loading ? (
        <p className="text-gray-500 text-sm">Carregando...</p>
      ) : !apurado ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
          <p className="text-gray-400 text-sm">Nada apurado para {months[month - 1]}/{year}.</p>
          <p className="text-gray-600 text-xs mt-1">
            Apurar calcula DAS, INSS e honorários a partir das notas emitidas no mês e rateia por cliente.
            Reapurar depois é seguro: pagamentos e guias já lançadas são preservados.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3 mb-6">
            {obligations.map((ob) => {
              const devido = ob.amount_actual != null ? Number(ob.amount_actual) : Number(ob.amount_estimated)
              const pago = Number(ob.paid_amount) || 0
              const falta = Math.max(devido - pago, 0)
              return (
                <div key={ob.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span>{KIND_ICON[ob.kind]}</span>
                      <h3 className="text-white font-semibold">{KIND_LABEL[ob.kind] || ob.kind}</h3>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_STYLE[ob.status] || STATUS_STYLE.previsto}`}>{ob.status}</span>
                  </div>

                  <p className="text-2xl font-bold text-white">{fmt(devido)}</p>
                  {ob.amount_actual != null ? (
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      guia oficial · estimado era {fmt(ob.amount_estimated)}
                    </p>
                  ) : (
                    <p className="text-[11px] text-gray-500 mt-0.5">estimado — guia ainda não lançada</p>
                  )}

                  <dl className="mt-3 space-y-1 text-xs">
                    <div className="flex justify-between"><dt className="text-gray-500">Pago</dt><dd className="text-gray-300">{fmt(pago)}</dd></div>
                    <div className="flex justify-between"><dt className="text-gray-500">Falta</dt><dd className={falta > 0 ? 'text-amber-400' : 'text-green-400'}>{fmt(falta)}</dd></div>
                    <div className="flex justify-between"><dt className="text-gray-500">Vencimento</dt><dd className="text-gray-300">{dataBR(ob.due_date)}</dd></div>
                    {ob.doc_number && <div className="flex justify-between"><dt className="text-gray-500">Guia nº</dt><dd className="text-gray-300">{ob.doc_number}</dd></div>}
                    {ob.base_amount != null && (
                      <div className="flex justify-between">
                        <dt className="text-gray-500">Base</dt>
                        <dd className="text-gray-400">{fmt(ob.base_amount)}{ob.rate_used != null ? ` × ${pct(ob.rate_used)}` : ''}</dd>
                      </div>
                    )}
                  </dl>

                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => setGuiaModal({
                        id: ob.id, kind: ob.kind,
                        amount_actual: ob.amount_actual != null ? String(Number(ob.amount_actual)) : '',
                        due_date: ob.due_date ? String(ob.due_date).slice(0, 10) : '',
                        doc_number: ob.doc_number || '',
                        estimado: ob.amount_estimated,
                      })}
                      className="flex-1 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-xs">
                      Lançar guia
                    </button>
                    <button onClick={() => abrirPagamentos(ob)}
                      className="flex-1 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-xs">
                      Pagamentos
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <h3 className="text-white font-semibold text-sm mb-1">Custo por cliente</h3>
              <p className="text-gray-600 text-[11px] mb-4">
                Rateio proporcional ao valor da NF de cada cliente no mês.
              </p>
              {!rateioLista.length ? (
                <p className="text-gray-500 text-xs">Sem rateio — o mês não teve faturamento por cliente.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 border-b border-gray-800">
                        <th className="text-left font-medium py-2">Cliente</th>
                        <th className="text-right font-medium py-2">DAS</th>
                        <th className="text-right font-medium py-2">INSS</th>
                        <th className="text-right font-medium py-2">Honorários</th>
                        <th className="text-right font-medium py-2">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rateioLista.map(([cliente, v]) => (
                        <tr key={cliente} className="border-b border-gray-800/60">
                          <td className="py-2 text-gray-300">{cliente}</td>
                          <td className="py-2 text-right text-gray-400">{fmt(v.das)}</td>
                          <td className="py-2 text-right text-gray-400">{fmt(v.inss)}</td>
                          <td className="py-2 text-right text-gray-400">{fmt(v.honorarios)}</td>
                          <td className="py-2 text-right text-white font-medium">{fmt(v.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold text-sm mb-3">Total do mês</h3>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-gray-500">Devido</span><span className="text-white font-bold">{fmt(totalDevido)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Pago</span><span className="text-gray-300">{fmt(totalPago)}</span></div>
                  <div className="flex justify-between border-t border-gray-800 pt-1 mt-1">
                    <span className="text-gray-500">Em aberto</span>
                    <span className={totalDevido - totalPago > 0.005 ? 'text-amber-400' : 'text-green-400'}>{fmt(Math.max(totalDevido - totalPago, 0))}</span>
                  </div>
                </div>
                {snapshot && (
                  <dl className="mt-4 pt-3 border-t border-gray-800 space-y-1 text-[11px]">
                    <div className="flex justify-between"><dt className="text-gray-600">Faturamento</dt><dd className="text-gray-400">{fmt(snapshot.faturamento_mes)}</dd></div>
                    <div className="flex justify-between"><dt className="text-gray-600">RBT12{snapshot.rbt12_proporcionalizado ? ` (${snapshot.rbt12_meses}m proporcional.)` : ''}</dt><dd className="text-gray-400">{fmt(snapshot.rbt12)}</dd></div>
                    <div className="flex justify-between"><dt className="text-gray-600">Pró-labore</dt><dd className="text-gray-400">{fmt(snapshot.prolabore)}{snapshot.prolabore_no_piso ? ' (piso)' : ''}</dd></div>
                    <div className="flex justify-between"><dt className="text-gray-600">Fator R</dt><dd className={snapshot.fatorR >= 0.28 ? 'text-green-400' : 'text-amber-400'}>{pct(snapshot.fatorR)}</dd></div>
                    <div className="flex justify-between"><dt className="text-gray-600">Anexo</dt><dd className="text-gray-400">{snapshot.anexo} · {pct(snapshot.aliquota_efetiva)}</dd></div>
                  </dl>
                )}
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold text-sm mb-1">Abater do Victor</h3>
                <p className="text-gray-600 text-[11px] mb-3">
                  Consome estas despesas dos lançamentos a pagar do Victor, do mês mais antigo
                  para o mais novo. Só entram lançamentos cujo cliente já pagou.
                </p>
                {distribuido ? (
                  <>
                    <p className="text-green-300 text-xs mb-3">✅ Já abatido neste mês.</p>
                    <button onClick={estornarDistribuicao} disabled={!!busy}
                      className="w-full px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 rounded-lg text-xs">
                      {busy === 'estornar-dist' ? 'Estornando...' : 'Estornar abatimento'}
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => distribuir(false)} disabled={!!busy || tudoQuitadoSemGuia(obligations)}
                      className="w-full px-3 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium">
                      {busy === 'distribuir' ? 'Abatendo...' : 'Abater guias lançadas'}
                    </button>
                    {temPrevisto && (
                      <button onClick={() => distribuir(true)} disabled={!!busy}
                        className="w-full mt-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 rounded-lg text-xs">
                        Abater incluindo estimativas
                      </button>
                    )}
                    <p className="text-gray-600 text-[11px] mt-2">
                      {temPrevisto
                        ? 'Há obrigações ainda sem guia oficial. O primeiro botão ignora essas; o segundo usa o valor estimado.'
                        : 'Todas as guias já foram lançadas.'}
                    </p>
                  </>
                )}
                {tudoQuitado && <p className="text-gray-600 text-[11px] mt-2">Todas as obrigações estão quitadas.</p>}
              </div>
            </div>
          </div>
        </>
      )}

      {guiaModal && (
        <Modal onClose={() => setGuiaModal(null)} title={`Guia oficial — ${KIND_LABEL[guiaModal.kind]}`}>
          <form onSubmit={salvarGuia} className="space-y-4">
            <p className="text-gray-500 text-[11px]">
              Valor apurado internamente: {fmt(guiaModal.estimado)}. Ao lançar a guia, o valor
              oficial passa a ser o devido. Deixe em branco para desfazer o lançamento.
            </p>
            <Campo label="Valor da guia (R$)">
              <input type="number" step="0.01" value={guiaModal.amount_actual}
                onChange={(e) => setGuiaModal((f) => ({ ...f, amount_actual: e.target.value }))}
                placeholder={String(guiaModal.estimado)} className={inputCls} autoFocus />
            </Campo>
            <Campo label="Vencimento">
              <input type="date" value={guiaModal.due_date}
                onChange={(e) => setGuiaModal((f) => ({ ...f, due_date: e.target.value }))} className={inputCls} />
            </Campo>
            <Campo label="Nº do documento">
              <input type="text" value={guiaModal.doc_number}
                onChange={(e) => setGuiaModal((f) => ({ ...f, doc_number: e.target.value }))}
                placeholder="ex.: DAS-07/2026" className={inputCls} />
            </Campo>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setGuiaModal(null)} className="px-4 py-2 text-gray-400 hover:text-white text-sm">Cancelar</button>
              <button type="submit" disabled={!!busy} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
                {busy === 'guia' ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {pagtoModal && (
        <Modal onClose={() => setPagtoModal(null)} title={`Pagamentos — ${KIND_LABEL[pagtoModal.ob.kind]}`}>
          <form onSubmit={registrarPagamento} className="grid grid-cols-3 gap-3">
            <Campo label="Valor (R$)">
              <input type="number" step="0.01" required value={pagtoModal.amount}
                onChange={(e) => setPagtoModal((f) => ({ ...f, amount: e.target.value }))} className={inputCls} autoFocus />
            </Campo>
            <Campo label="Data">
              <input type="date" required value={pagtoModal.paid_at}
                onChange={(e) => setPagtoModal((f) => ({ ...f, paid_at: e.target.value }))} className={inputCls} />
            </Campo>
            <Campo label="Forma">
              <select value={pagtoModal.method}
                onChange={(e) => setPagtoModal((f) => ({ ...f, method: e.target.value }))} className={inputCls}>
                <option value="pix">Pix</option>
                <option value="darf">DARF</option>
                <option value="boleto">Boleto</option>
                <option value="outro">Outro</option>
              </select>
            </Campo>
            <div className="col-span-3 flex justify-end">
              <button type="submit" disabled={!!busy} className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
                {busy === 'pagar' ? 'Registrando...' : 'Registrar pagamento'}
              </button>
            </div>
          </form>

          <div className="mt-5 pt-4 border-t border-gray-800">
            <h4 className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-2">Histórico</h4>
            {!payments.length ? (
              <p className="text-gray-600 text-xs">Nenhum pagamento registrado.</p>
            ) : (
              <ul className="space-y-1">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between text-xs bg-gray-800/60 rounded-lg px-3 py-2">
                    <span className="text-gray-300">{fmt(p.amount)}</span>
                    <span className="text-gray-500">{dataBR(p.paid_at)} · {p.method || '—'}</span>
                    <button onClick={() => estornarPagamento(p.id)} disabled={!!busy}
                      className="text-red-400 hover:text-red-300 disabled:opacity-50">Estornar</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}

// Sem guia lançada em nenhuma obrigação, "Abater guias lançadas" não tem o que fazer —
// o backend responderia 400. Desabilitar aqui evita o erro em vez de exibi-lo.
function tudoQuitadoSemGuia(obligations) {
  return !obligations.some((o) => o.status !== 'previsto')
}

const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500'

function Campo({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-400 font-medium uppercase tracking-wider">{label}</label>
      {children}
    </div>
  )
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">{title}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-sm">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
