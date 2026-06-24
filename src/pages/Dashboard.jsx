import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'

const COMPANIES = [
  { id: 1, name: 'Lumen', badge: 'bg-blue-500/20 text-blue-400' },
  { id: 2, name: 'Imperium', badge: 'bg-orange-500/20 text-orange-400' },
]
const ABERTAS = ['nova', 'pendente', 'em análise', 'em andamento']
const months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

function decimalToHHMM(decimal) {
  if (!decimal && decimal !== 0) return '--:--'
  const totalMinutes = Math.round(parseFloat(decimal) * 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

const fmt = (v) => `R$ ${(parseFloat(v) || 0).toFixed(2).replace('.', ',')}`

export default function Dashboard() {
  useOutletContext() // sempre exibimos as duas empresas, independente da selecionada
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const mesAtual = new Date().getMonth() + 1
  const anoAtual = new Date().getFullYear()

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const results = await Promise.all(COMPANIES.map(async (co) => {
        const [dem, rec, fab, vic, te] = await Promise.all([
          fetch(`/api/demands?company_id=${co.id}`),
          fetch(`/api/receivables?company_id=${co.id}&year=${anoAtual}`),
          fetch(`/api/payables-fabricio?company_id=${co.id}&year=${anoAtual}`),
          fetch(`/api/payables-victor?company_id=${co.id}&year=${anoAtual}`),
          fetch(`/api/time-entries?company_id=${co.id}&month=${mesAtual}&year=${anoAtual}`),
        ])
        return {
          id: co.id,
          demands: (await dem.json()).demands || [],
          receivables: (await rec.json()).data || [],
          fabricio: (await fab.json()).data || [],
          victor: (await vic.json()).data || [],
          entries: (await te.json()).entries || [],
        }
      }))
      setData(results)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  function metrics(d) {
    const noMes = (rows) => rows.filter(r => Number(r.month) === mesAtual)
    const sum = (rows, field) => rows.reduce((s, r) => s + (parseFloat(r[field]) || 0), 0)

    const abertas = d.demands.filter(x => ABERTAS.includes(x.status)).length
    const resolvidasMes = d.demands.filter(x => {
      if (x.status !== 'resolvida') return false
      const dt = new Date(x.received_at || x.created_at)
      return dt.getMonth() + 1 === mesAtual && dt.getFullYear() === anoAtual
    }).length

    const rec = noMes(d.receivables)
    const fab = noMes(d.fabricio)
    const vic = noMes(d.victor)

    const recPrev = sum(rec, 'amount'); const recPago = sum(rec, 'paid_amount')
    const fabPrev = sum(fab, 'amount'); const fabPago = sum(fab, 'paid_amount')
    const vicPrev = sum(vic, 'total_amount'); const vicPago = sum(vic, 'paid_amount')

    const totalHoras = sum(d.entries, 'hours')
    const totalBruto = sum(d.entries, 'gross_value')

    return {
      abertas, resolvidasMes,
      rec: { prev: recPrev, pago: recPago, aberto: recPrev - recPago },
      fab: { prev: fabPrev, pago: fabPago, aberto: fabPrev - fabPago },
      vic: { prev: vicPrev, pago: vicPago, aberto: vicPrev - vicPago },
      totalHoras, totalBruto,
    }
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Dashboard</h2>
        <p className="text-gray-400 text-sm mt-1">{months[mesAtual - 1]} de {anoAtual}</p>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm">Carregando...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {COMPANIES.map(co => {
            const d = data?.find(x => x.id === co.id)
            const m = d ? metrics(d) : null
            return (
              <div key={co.id} className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold ${co.badge}`}>{co.name}</span>
                </div>

                {!m ? (
                  <div className="text-gray-600 text-sm">Sem dados.</div>
                ) : (
                  <>
                    {/* Demandas */}
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                      <p className="text-gray-400 text-xs uppercase tracking-wider mb-3">Demandas</p>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-2xl font-bold text-yellow-400">{m.abertas}</p>
                          <p className="text-gray-500 text-xs mt-1">Abertas</p>
                        </div>
                        <div>
                          <p className="text-2xl font-bold text-green-400">{m.resolvidasMes}</p>
                          <p className="text-gray-500 text-xs mt-1">Resolvidas no mês</p>
                        </div>
                      </div>
                    </div>

                    {/* Financeiro do mês */}
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                      <p className="text-gray-400 text-xs uppercase tracking-wider mb-3">Financeiro do mês</p>
                      <div className="space-y-3">
                        <FinanceBlock label="A Receber" color="text-green-400" prevLabel="Previsto" paidLabel="Recebido" v={m.rec} />
                        <FinanceBlock label="Pagar Fabrício" color="text-purple-400" prevLabel="Previsto" paidLabel="Pago" v={m.fab} />
                        <FinanceBlock label="Pagar Victor" color="text-blue-400" prevLabel="Previsto" paidLabel="Pago" v={m.vic} />
                      </div>
                    </div>

                    {/* Horas do mês */}
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                      <p className="text-gray-400 text-xs uppercase tracking-wider mb-3">Horas do mês</p>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-2xl font-bold text-white">{decimalToHHMM(m.totalHoras)}</p>
                          <p className="text-gray-500 text-xs mt-1">Total horas</p>
                        </div>
                        <div>
                          <p className="text-2xl font-bold text-white">{fmt(m.totalBruto)}</p>
                          <p className="text-gray-500 text-xs mt-1">Total bruto</p>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FinanceBlock({ label, color, prevLabel, paidLabel, v }) {
  return (
    <div className="bg-gray-800/50 rounded-lg p-3">
      <p className={`text-sm font-medium mb-2 ${color}`}>{label}</p>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <p className="text-gray-500">{prevLabel}</p>
          <p className="text-white font-medium">{fmt(v.prev)}</p>
        </div>
        <div>
          <p className="text-gray-500">{paidLabel}</p>
          <p className="text-green-400 font-medium">{fmt(v.pago)}</p>
        </div>
        <div>
          <p className="text-gray-500">Em aberto</p>
          <p className="text-yellow-400 font-medium">{fmt(v.aberto)}</p>
        </div>
      </div>
    </div>
  )
}
