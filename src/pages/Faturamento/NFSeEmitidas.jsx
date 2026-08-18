import { useState, useEffect, useCallback, Fragment } from 'react'
import { useOutletContext } from 'react-router-dom'
import NFSeTimeline from '../../components/NFSeTimeline'
import NFSeCancelModal from '../../components/NFSeCancelModal'

// Status em que o cancelamento faz sentido — a mesma lista de api/nfse-cancel.js.
const CANCELAVEIS = new Set(['enviada', 'autorizada'])

// Lista das NFS-e emitidas, com download do XML e do DANFSE.
//
// ⚠️ O download NÃO usa `window.location.href = '/api/...'`. Aquela navegação
// sai fora do fetch, e o interceptor de src/lib/session.js só injeta o
// Authorization em chamadas de fetch — a requisição chegaria sem token, tomaria
// 401 e o navegador salvaria um arquivo .xml contendo `{"error":"Não
// autenticado"}`. Pior: o interceptor derruba a sessão no 401, então clicar em
// "baixar" deslogaria o usuário. Aqui o arquivo vem por fetch e vira blob.

const badges = {
  // Vocabulário real gravado por api/nfse-emit.js. O esboço usava
  // submitted/approved/rejected, que não são gravados por lugar nenhum — TODA
  // linha cairia no default e um erro apareceria como "📤 Enviada".
  enviada: ['bg-blue-900/40 text-blue-300 border-blue-700', '📤 Enviada'],
  autorizada: ['bg-green-900/40 text-green-300 border-green-700', '✅ Autorizada'],
  erro: ['bg-red-900/40 text-red-300 border-red-700', '❌ Erro'],
  cancelada: ['bg-gray-800 text-gray-400 border-gray-600', '🚫 Cancelada'],
}

const brl = (v) =>
  v === null || v === undefined || !Number.isFinite(Number(v))
    ? '—'
    : Number(v).toFixed(2).replace('.', ',')

const dataBR = (v) => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}

export default function NFSeEmitidas() {
  const { activeCompany } = useOutletContext()

  const [emissions, setEmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [baixando, setBaixando] = useState(null) // `${id}:${tipo}`
  const [erro, setErro] = useState(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [aberta, setAberta] = useState(null)        // id da emissão expandida
  const [eventos, setEventos] = useState({})        // id → eventos
  const [cancelando, setCancelando] = useState(null)
  const limit = 20

  const buscar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const res = await fetch(
        `/api/nfse-list?company_id=${activeCompany.id}&page=${page}&limit=${limit}`
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setEmissions(data.emissions || [])
      setTotal(data.pagination?.total || 0)
    } catch (err) {
      setErro(err.message)
      setEmissions([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [activeCompany.id, page])

  // Trocar de empresa volta para a primeira página: manter a página 3 de uma
  // empresa ao entrar noutra que tem 1 página mostra uma lista vazia.
  useEffect(() => { setPage(1) }, [activeCompany.id])
  useEffect(() => { buscar() }, [buscar])

  // Os eventos só são buscados quando a linha é aberta, e ficam em cache: uma
  // lista de 20 notas faria 20 chamadas de histórico que ninguém pediu.
  const alternar = async (id) => {
    if (aberta === id) { setAberta(null); return }
    setAberta(id)
    if (eventos[id]) return
    try {
      const res = await fetch(`/api/nfse-events?emission_id=${id}`)
      const data = await res.json()
      if (res.ok) setEventos((e) => ({ ...e, [id]: data.events || [] }))
    } catch (err) {
      console.error('Erro ao buscar eventos:', err)
    }
  }

  const baixar = async (emissao, tipo) => {
    const rota = tipo === 'xml' ? 'nfse-download-xml' : 'nfse-download-danfse'
    setBaixando(`${emissao.id}:${tipo}`)
    setErro(null)
    try {
      const res = await fetch(`/api/${rota}?emission_id=${emissao.id}`)
      if (!res.ok) {
        // O corpo do erro é JSON; ler como blob esconderia a mensagem.
        let msg = `HTTP ${res.status}`
        try { msg = (await res.json())?.error || msg } catch { /* resposta não-JSON */ }
        throw new Error(msg)
      }
      const blob = await res.blob()

      // Reaproveita o nome que o servidor mandou no Content-Disposition; ele já
      // vem higienizado de lá.
      const cd = res.headers.get('content-disposition') || ''
      const nome = cd.match(/filename="([^"]+)"/)?.[1]
        || `${tipo === 'xml' ? 'NFSe' : 'DANFSE'}_${emissao.id}.${tipo === 'xml' ? 'xml' : 'pdf'}`

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = nome
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Sem o revoke, cada download deixa o arquivo inteiro preso na memória
      // da aba até o reload.
      URL.revokeObjectURL(url)
    } catch (err) {
      setErro(`Falha ao baixar ${tipo.toUpperCase()}: ${err.message}`)
    } finally {
      setBaixando(null)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-bold text-white">📋 NFS-e emitidas</h1>
        <span
          className="px-2 py-1 rounded text-xs font-medium text-white"
          style={{ backgroundColor: activeCompany.color }}
        >
          {activeCompany.name}
        </span>
      </div>

      {erro && (
        <div className="p-3 rounded text-sm border bg-red-900/30 text-red-300 border-red-700">
          ❌ {erro}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400">Carregando…</p>
      ) : emissions.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
          <p className="text-gray-400">
            Nenhuma NFS-e emitida para a {activeCompany.name}.
          </p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-gray-300">
              <thead className="bg-gray-800 border-b border-gray-700 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">NFS-e</th>
                  <th className="px-4 py-3 text-left">Cliente</th>
                  <th className="px-4 py-3 text-right">Valor</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Envio</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {emissions.map((e) => {
                  const [cor, rotulo] = badges[e.status] || [
                    'bg-gray-800 text-gray-400 border-gray-600', `❔ ${e.status || 'desconhecido'}`,
                  ]
                  return (
                    // Fragment COM key: o elemento raiz de um map precisa de
                    // chave, e a forma curta <> nao aceita uma.
                    <Fragment key={e.id}>
                    <tr className="border-b border-gray-800 hover:bg-gray-800/60">
                      <td className="px-4 py-3 font-mono text-blue-400">
                        {e.nfseNumber ? `#${e.nfseNumber}` : <span className="text-gray-500">s/ número</span>}
                        {e.ambiente === 2 && (
                          <span className="ml-2 text-[10px] text-amber-400 font-sans">homolog.</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{e.cliente}</td>
                      <td className="px-4 py-3 text-right font-mono">{brl(e.valor)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-semibold border ${cor}`}>
                          {rotulo}
                        </span>
                        {e.erro && (
                          <p className="text-xs text-red-400 mt-1 max-w-xs truncate" title={e.erro}>
                            {e.erro}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">{dataBR(e.emittedAt)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                        {/* Emissão sem XML não tem o que baixar — o botão diz isso
                            em vez de levar a um 404. */}
                        <button
                          onClick={() => baixar(e, 'xml')}
                          disabled={!e.temXml || baixando === `${e.id}:xml`}
                          title={e.temXml ? 'Baixar XML assinado' : 'Sem XML nesta emissão'}
                          className="px-3 py-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
                        >
                          {baixando === `${e.id}:xml` ? '⏳' : '📄'} XML
                        </button>
                        <button
                          onClick={() => baixar(e, 'pdf')}
                          disabled={!e.temXml || baixando === `${e.id}:pdf`}
                          title={e.temXml ? 'Baixar DANFSE em PDF' : 'Sem XML nesta emissão'}
                          className="px-3 py-1 bg-green-700 hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
                        >
                          {baixando === `${e.id}:pdf` ? '⏳' : '📥'} PDF
                        </button>
                        <button
                          onClick={() => alternar(e.id)}
                          title="Histórico da nota"
                          className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded transition-colors"
                        >
                          {aberta === e.id ? '▲' : '▼'} Histórico
                        </button>
                        {CANCELAVEIS.has(e.status) && (
                          <button
                            onClick={() => setCancelando(e)}
                            className="px-3 py-1 bg-red-800 hover:bg-red-700 text-white text-xs rounded transition-colors"
                          >
                            🚫 Cancelar
                          </button>
                        )}
                      </td>
                    </tr>
                    {aberta === e.id && (
                      <tr className="border-b border-gray-800 bg-gray-950/60">
                        <td colSpan={6} className="px-6 py-4">
                          <p className="text-xs uppercase tracking-wider text-gray-500 mb-3">
                            Histórico da nota
                          </p>
                          {eventos[e.id]
                            ? <NFSeTimeline events={eventos[e.id]} />
                            : <p className="text-gray-500 text-sm">Carregando…</p>}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 bg-gray-800 border-t border-gray-700 flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs text-gray-400">
              {total === 0
                ? 'Nenhum registro'
                : `Mostrando ${(page - 1) * limit + 1}–${Math.min(page * limit, total)} de ${total}`}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-white text-xs rounded transition-colors"
              >
                ← Anterior
              </button>
              <span className="text-xs text-gray-400">Página {page} de {totalPages}</span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages}
                className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-white text-xs rounded transition-colors"
              >
                Próxima →
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelando && (
        <NFSeCancelModal
          emission={cancelando}
          onClose={() => setCancelando(null)}
          onSuccess={() => {
            setCancelando(null)
            // O histórico em cache descreve o estado ANTES do cancelamento;
            // mantê-lo mostraria a nota como cancelada e a timeline sem o
            // evento que a cancelou.
            setEventos((e) => ({ ...e, [cancelando.id]: undefined }))
            setAberta(null)
            buscar()
          }}
        />
      )}
    </div>
  )
}
