import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'

// Histórico de OPERAÇÕES de NFS-e: o que foi enviado ao SEFIN e o que voltou.
//
// ⚠️ Sem lucide-react — não é dependência do projeto e importá-la quebra o
// build. O chevron é um caractere (a mesma escolha de NFSeTimeline).
//
// ⚠️ A tela abre JÁ CARREGADA com as operações da empresa ativa. O esboço
// exigia digitar "ID da fatura" para ver qualquer coisa — e ninguém sabe o id
// interno de uma fatura de cabeça. A busca por fatura virou filtro opcional.
//
// ⚠️ Os XMLs chegam como PRÉVIA (2 KB) e são baixados inteiros sob demanda: a
// lista com o conteúdo completo passaria de meio megabyte por abertura de tela,
// para exibir alguns milhares de caracteres. Ver a nota em /api/nfse-operations.

const ICONES = {
  emit: '📤', substitute: '🔄', cancel: '🚫', consult: '🔎', sync: '🔃',
}

const BADGES = {
  sucesso: ['bg-green-900/40 text-green-300 border-green-700', '✅ Sucesso'],
  erro: ['bg-red-900/40 text-red-300 border-red-700', '❌ Erro'],
  // ⚠️ 'enviado' NÃO é "em andamento": é o pedido que saiu e cuja resposta
  // nunca chegou a ser gravada (a função morreu no meio). A nota pode existir
  // no fisco sem existir aqui — por isso âmbar, e não cinza.
  enviado: ['bg-amber-900/40 text-amber-300 border-amber-700', '⚠️ Sem resposta'],
}

const TIPOS = [
  ['', 'Todos os tipos'],
  ['emit', '📤 Emissão'],
  ['substitute', '🔄 Substituição'],
  ['cancel', '🚫 Cancelamento'],
  ['consult', '🔎 Consulta'],
  ['sync', '🔃 Sincronização'],
]

const STATUS = [
  ['', 'Todos os status'],
  ['sucesso', '✅ Sucesso'],
  ['erro', '❌ Erro'],
  ['enviado', '⚠️ Sem resposta'],
]

const dataHora = (v) => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR')
}

const kb = (n) => (!n ? '—' : `${(n / 1024).toFixed(1)} KB`)

export default function NFSeOperacoes() {
  const { activeCompany } = useOutletContext()

  const [operacoes, setOperacoes] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [expandido, setExpandido] = useState(null)
  const [baixando, setBaixando] = useState(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  // Filtros aplicados (o que a query usa) × digitado (o que está no input).
  // Separados para a fatura só filtrar ao clicar/Enter — refazer a busca a cada
  // dígito dispara uma query por tecla.
  const [tipo, setTipo] = useState('')
  const [status, setStatus] = useState('')
  const [invoiceDigitado, setInvoiceDigitado] = useState('')
  const [invoiceFiltro, setInvoiceFiltro] = useState('')
  const limit = 25

  const buscar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const q = new URLSearchParams({
        company_id: String(activeCompany.id), page: String(page), limit: String(limit),
      })
      if (tipo) q.set('tipo', tipo)
      if (status) q.set('status', status)
      if (invoiceFiltro) q.set('invoice_id', invoiceFiltro)

      const res = await fetch(`/api/nfse-operations?${q}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setOperacoes(data.operations || [])
      setTotal(data.pagination?.total || 0)
    } catch (err) {
      setErro(err.message)
      setOperacoes([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [activeCompany.id, page, tipo, status, invoiceFiltro])

  // Trocar de empresa ou de filtro volta para a primeira página: manter a
  // página 3 num recorte que tem 1 página mostra uma lista vazia.
  useEffect(() => { setPage(1) }, [activeCompany.id, tipo, status, invoiceFiltro])
  useEffect(() => { buscar() }, [buscar])

  const urlXml = (op, parte) => `/api/nfse-operations?id=${op.id}&parte=${parte}`

  // ⚠️ Download por fetch + blob, nunca `window.location.href`. Aquela
  // navegação sai fora do fetch e o interceptor de src/lib/session.js não
  // injeta o Authorization: o arquivo salvo seria um .xml com
  // {"error":"Não autenticado"} dentro — e o 401 ainda derrubaria a sessão.
  const buscarXml = async (op, parte) => {
    const res = await fetch(urlXml(op, parte))
    if (!res.ok) {
      let msg = `HTTP ${res.status}`
      try {
        const j = await res.json()
        msg = [j?.error, j?.detalhe].filter(Boolean).join(' — ') || msg
      } catch { /* resposta não-JSON */ }
      throw new Error(msg)
    }
    return { texto: await res.text(), nome: nomeDoArquivo(res, op, parte) }
  }

  const nomeDoArquivo = (res, op, parte) => {
    const cd = res.headers.get('content-disposition') || ''
    return cd.match(/filename="([^"]+)"/)?.[1] || `operacao_${op.id}_${parte}.xml`
  }

  const baixar = async (op, parte) => {
    setBaixando(`${op.id}:${parte}`)
    setErro(null)
    try {
      const { texto, nome } = await buscarXml(op, parte)
      const href = URL.createObjectURL(new Blob([texto], { type: 'application/xml' }))
      const a = document.createElement('a')
      a.href = href
      a.download = nome
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Sem o revoke, cada download deixa o arquivo preso na memória da aba.
      URL.revokeObjectURL(href)
    } catch (err) {
      setErro(`Falha ao baixar o XML ${parte}: ${err.message}`)
    } finally {
      setBaixando(null)
    }
  }

  // ⚠️ Copia os XMLs INTEIROS, não as prévias truncadas: colar um XML cortado
  // em 2 KB para depurar é pior que não colar nada — a recusa do SEFIN costuma
  // estar num campo que a prévia não alcança.
  const copiarParaDebug = async (op) => {
    setBaixando(`${op.id}:copia`)
    setErro(null)
    try {
      const [enviado, resposta] = await Promise.all([
        op.xmlEnviado?.tamanho ? buscarXml(op, 'enviado').then((r) => r.texto).catch(() => null) : null,
        op.xmlResposta?.tamanho ? buscarXml(op, 'resposta').then((r) => r.texto).catch(() => null) : null,
      ])

      const bloco = (titulo, corpo) => `\n=== ${titulo} ===\n${corpo || '(nenhum)'}\n`
      const texto = [
        `Operação #${op.id} — ${op.rotulo}`,
        `Status: ${op.status}${op.httpStatus ? ` (HTTP ${op.httpStatus})` : ''}`,
        `Ambiente: ${op.ambiente === 1 ? 'produção' : 'homologação'}`,
        `Enviado em: ${dataHora(op.enviadoEm)}`,
        `Respondido em: ${dataHora(op.respondidoEm)}`,
        op.invoiceNumber ? `Fatura: ${op.invoiceNumber} (id ${op.invoiceId})` : `Fatura id: ${op.invoiceId ?? '—'}`,
        op.nfseNumber ? `NFS-e nº ${op.nfseNumber}` : null,
        op.dpsNumber ? `DPS nº ${op.dpsNumber}` : null,
        op.erroMensagem ? `Erro: ${op.erroCodigo ? `[${op.erroCodigo}] ` : ''}${op.erroMensagem}` : null,
        bloco('XML ENVIADO', enviado),
        bloco('XML DE RESPOSTA', resposta),
        bloco('JSON DE RESPOSTA', op.jsonResposta ? JSON.stringify(op.jsonResposta, null, 2) : null),
      ].filter((l) => l !== null).join('\n')

      await navigator.clipboard.writeText(texto)
      setAviso(`Operação #${op.id} copiada (${(texto.length / 1024).toFixed(1)} KB).`)
    } catch (err) {
      // clipboard exige contexto seguro (https/localhost) — dizer isso evita a
      // leitura de que o botão está quebrado.
      setErro(`Não foi possível copiar: ${err.message}`)
    } finally {
      setBaixando(null)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-bold text-white">🧾 Operações NFS-e</h1>
        <span
          className="px-2 py-1 rounded text-xs font-medium text-white"
          style={{ backgroundColor: activeCompany.color }}
        >
          {activeCompany.name}
        </span>
      </div>
      <p className="text-sm text-gray-400">
        Cada envio ao SEFIN e a resposta que voltou — inclusive as tentativas recusadas,
        que não deixam rastro na lista de notas.
      </p>

      {/* FILTROS */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-gray-500">Tipo</span>
          <select
            value={tipo} onChange={(e) => setTipo(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:border-blue-500 focus:outline-none"
          >
            {TIPOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-gray-500">Status</span>
          <select
            value={status} onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:border-blue-500 focus:outline-none"
          >
            {STATUS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
        </label>

        <label className="flex flex-col gap-1 flex-1 min-w-[180px]">
          <span className="text-xs uppercase tracking-wider text-gray-500">Fatura (id)</span>
          <input
            type="number"
            value={invoiceDigitado}
            onChange={(e) => setInvoiceDigitado(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') setInvoiceFiltro(invoiceDigitado.trim()) }}
            placeholder="Em branco = todas"
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
        </label>

        <button
          onClick={() => setInvoiceFiltro(invoiceDigitado.trim())}
          className="px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white text-sm rounded transition-colors"
        >
          🔍 Filtrar
        </button>
        {(tipo || status || invoiceFiltro) && (
          <button
            onClick={() => { setTipo(''); setStatus(''); setInvoiceDigitado(''); setInvoiceFiltro('') }}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition-colors"
          >
            ✕ Limpar
          </button>
        )}
      </div>

      {erro && (
        <div className="p-3 rounded text-sm border bg-red-900/30 text-red-300 border-red-700">
          ❌ {erro}
        </div>
      )}

      {aviso && (
        <div className="p-3 rounded text-sm border bg-green-900/30 text-green-300 border-green-700 flex items-start gap-3">
          <span className="flex-1">✅ {aviso}</span>
          <button onClick={() => setAviso(null)} className="text-green-400 hover:text-green-200">✕</button>
        </div>
      )}

      {loading ? (
        <p className="text-gray-400">Carregando…</p>
      ) : operacoes.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center space-y-2">
          <p className="text-gray-400">
            Nenhuma operação {tipo || status || invoiceFiltro ? 'com esses filtros' : `para a ${activeCompany.name}`}.
          </p>
          {!tipo && !status && !invoiceFiltro && (
            <p className="text-xs text-gray-500">
              A trilha começa na próxima emissão, cancelamento ou consulta ao portal.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {operacoes.map((op) => {
            const [cor, rotulo] = BADGES[op.status] || [
              'bg-gray-800 text-gray-400 border-gray-600', `❔ ${op.status || 'desconhecido'}`,
            ]
            const aberto = expandido === op.id
            return (
              <div key={op.id} className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandido(aberto ? null : op.id)}
                  className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-gray-800/60 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-lg">{ICONES[op.tipo] || '•'}</span>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-100">
                        {op.rotulo}
                        {op.nfseNumber && (
                          <span className="ml-2 font-mono text-sm text-blue-400">#{op.nfseNumber}</span>
                        )}
                        {op.ambiente === 2 && (
                          <span className="ml-2 text-[10px] text-amber-400">homolog.</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {dataHora(op.enviadoEm)}
                        {op.cliente ? ` · ${op.cliente}` : ''}
                        {op.invoiceNumber ? ` · fatura ${op.invoiceNumber}` : ''}
                        {op.dpsNumber ? ` · DPS ${op.dpsNumber}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`px-2 py-1 rounded text-xs font-semibold border ${cor}`}>
                      {rotulo}
                    </span>
                    <span className={`text-gray-500 transition-transform ${aberto ? 'rotate-180' : ''}`}>▼</span>
                  </div>
                </button>

                {aberto && (
                  <div className="px-4 py-4 border-t border-gray-800 bg-gray-950/60 space-y-4">
                    {op.status === 'enviado' && (
                      <div className="p-3 bg-amber-900/20 border border-amber-700/50 rounded text-amber-200 text-sm">
                        ⚠️ O pedido saiu e a resposta nunca foi gravada — a função caiu entre
                        os dois. {op.dpsNumber ? `A DPS nº ${op.dpsNumber} já foi consumida no fisco. ` : ''}
                        A nota pode existir no SEFIN sem existir aqui; confira no portal antes
                        de emitir de novo.
                      </div>
                    )}

                    {op.erroMensagem && (
                      <div className="p-3 bg-red-900/30 border border-red-700 rounded">
                        <p className="text-sm font-semibold text-red-300">
                          Recusa do SEFIN{op.httpStatus ? ` (HTTP ${op.httpStatus})` : ''}
                        </p>
                        <p className="text-xs text-red-200 mt-1 break-words">{op.erroMensagem}</p>
                        {op.erroCodigo && (
                          <p className="text-xs text-red-200 mt-1">Código: {op.erroCodigo}</p>
                        )}
                      </div>
                    )}

                    <XmlBloco
                      titulo="📤 XML enviado"
                      legenda="A DPS assinada que saiu daqui — o pedido, não a nota."
                      dados={op.xmlEnviado}
                      vazio="Esta operação não transmite documento assinado."
                      onBaixar={() => baixar(op, 'enviado')}
                      baixando={baixando === `${op.id}:enviado`}
                    />

                    <XmlBloco
                      titulo="📥 XML de resposta"
                      legenda="A NFS-e autorizada que o SEFIN devolveu — este é o documento fiscal."
                      dados={op.xmlResposta}
                      vazio="O SEFIN não devolveu XML nesta operação (só o JSON abaixo)."
                      onBaixar={() => baixar(op, 'resposta')}
                      baixando={baixando === `${op.id}:resposta`}
                    />

                    {op.jsonResposta && Object.keys(op.jsonResposta).length > 0 && (
                      <div>
                        <p className="text-sm font-semibold text-gray-300 mb-1">📦 Resposta (JSON)</p>
                        <pre className="bg-gray-900 border border-gray-800 p-3 rounded text-xs text-gray-400 max-h-48 overflow-auto font-mono whitespace-pre-wrap break-all">
                          {JSON.stringify(op.jsonResposta, null, 2)}
                        </pre>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-3 items-center pt-1">
                      <button
                        onClick={() => copiarParaDebug(op)}
                        disabled={baixando === `${op.id}:copia`}
                        className="px-4 py-2 bg-purple-800 hover:bg-purple-700 disabled:opacity-50 text-white text-sm rounded font-semibold transition-colors"
                      >
                        {baixando === `${op.id}:copia` ? '⏳ Montando…' : '📋 Copiar tudo para depurar'}
                      </button>
                      <span className="text-xs text-gray-500">
                        Copia os XMLs inteiros, não a prévia recortada.
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          <div className="px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg flex items-center justify-between flex-wrap gap-2">
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
    </div>
  )
}

// ⚠️ A prévia diz que É prévia e quanto ficou de fora. Um XML cortado sem aviso
// lê-se como XML incompleto — e o campo que o SEFIN recusou costuma estar
// justamente depois do corte.
function XmlBloco({ titulo, legenda, dados, vazio, onBaixar, baixando }) {
  const tem = Boolean(dados?.tamanho)
  return (
    <div>
      <p className="text-sm font-semibold text-gray-300">{titulo}</p>
      <p className="text-xs text-gray-500 mb-2">{legenda}</p>
      {!tem ? (
        <p className="text-xs text-gray-600 italic">{vazio}</p>
      ) : (
        <>
          <pre className="bg-gray-900 border border-gray-800 p-3 rounded text-xs text-gray-400 max-h-48 overflow-auto font-mono whitespace-pre-wrap break-all">
            {dados.previa}
          </pre>
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={onBaixar}
              disabled={baixando}
              className="px-3 py-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white text-xs rounded transition-colors"
            >
              {baixando ? '⏳' : '⬇️'} Baixar XML completo
            </button>
            <span className="text-xs text-gray-500">
              {kb(dados.tamanho)}
              {dados.truncado ? ' · prévia recortada acima' : ' · íntegro acima'}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
