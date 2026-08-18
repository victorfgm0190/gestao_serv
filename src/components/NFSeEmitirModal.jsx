import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'

// Emissão de NFS-e a partir de uma fatura.
//
// ⚠️ Duas etapas, porque o backend é prévia-por-padrão: a primeira chamada
// monta e assina o XML sem transmitir nada; só o botão de confirmação manda
// `transmitir: true`. Emitir cria documento fiscal na Receita — botão único
// tornaria isso um clique acidental.
//
// ⚠️ Nenhum header Authorization à mão: o interceptor de src/lib/session.js já
// injeta o token (e a chave é `gestao_serv_token`, não `jwt`).
//
// ⚠️ O valor é `invoice_value`. `valor_total` não existe em invoices — o
// esboço exibia `R$ undefined` no resumo e mandava a alíquota sobre NaN.

const brl = (v) =>
  v === null || v === undefined || !Number.isFinite(Number(v))
    ? '—'
    : `R$ ${Number(v).toFixed(2).replace('.', ',')}`

export default function NFSeEmitirModal({ invoice, onClose, onSuccess }) {
  const valorNF = Number(invoice?.invoice_value ?? invoice?.contract_value ?? 0)

  const [descricao, setDescricao] = useState(invoice?.descricao_nfse || '')
  const [aliquota, setAliquota] = useState(
    invoice?.aliquota_iss === null || invoice?.aliquota_iss === undefined ? '' : String(invoice.aliquota_iss)
  )
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState(null)
  const [faltando, setFaltando] = useState(null)
  const [previa, setPrevia] = useState(null)
  const [setup, setSetup] = useState(null)

  // ⚠️ A checagem roda ao ABRIR, não antes de transmitir como o esboço propunha.
  // O 422 da emissão já traz a mesma lista (as duas leem lib/nfse-setup-check.js),
  // então validar de novo no clique só repetiria a resposta — depois de a pessoa
  // ter escrito a descrição e a alíquota. Aparecendo na abertura, ela vê o que
  // falta antes de digitar qualquer coisa.
  useEffect(() => {
    if (!invoice?.company_id) return
    let vivo = true
    fetch(`/api/nfse-validate-setup?company_id=${invoice.company_id}&invoice_id=${invoice.id}`)
      .then((r) => r.json())
      .then((d) => { if (vivo) setSetup(d) })
      .catch(() => {})
    return () => { vivo = false }
  }, [invoice?.company_id, invoice?.id])

  const corpo = (transmitir) => ({
    invoice_id: invoice.id,
    transmitir,
    ...(descricao.trim() ? { descricao_servico: descricao.trim() } : {}),
    ...(aliquota !== '' ? { aliquota_iss: Number(aliquota) } : {}),
  })

  const chamar = async (transmitir) => {
    setLoading(true); setErro(null); setFaltando(null)
    try {
      const res = await fetch('/api/nfse-emit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo(transmitir)),
      })
      const data = await res.json()
      if (!res.ok) {
        setErro(data?.error || `Falha (HTTP ${res.status})`)
        // O 422 traz a lista do que falta cadastrar — mostrar item a item evita
        // a caça de campo em campo.
        if (Array.isArray(data?.faltando)) setFaltando(data.faltando)
        return
      }
      if (data.preview) setPrevia(data)
      else onSuccess?.(data)
    } catch (err) {
      setErro(err.message)
    } finally {
      setLoading(false)
    }
  }

  const issEstimado = aliquota !== '' && Number.isFinite(Number(aliquota))
    ? valorNF * (Number(aliquota) / 100)
    : null

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-gray-900 rounded-xl p-6 max-w-lg w-full border border-gray-700 my-8">
        <h2 className="text-xl font-bold text-white mb-1">📄 Emitir NFS-e</h2>
        <p className="text-xs text-gray-400 mb-4">
          {invoice?.client_name} · {invoice?.month}/{invoice?.year}
          {invoice?.invoice_number ? ` · NF ${invoice.invoice_number}` : ''}
        </p>

        {setup && !setup.pronto && (
          <div className="mb-4 p-3 bg-amber-900/20 border border-amber-700 rounded text-amber-200 text-sm">
            ⚠️ {setup.mensagem}
            <ul className="mt-2 space-y-0.5 list-disc list-inside text-xs text-amber-100">
              {setup.campos_faltantes?.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
            <p className="mt-2 text-xs">
              <Link to="/configuracao/nfse-emitente" className="underline hover:text-white">
                Configurar emitente
              </Link>
              {' · '}
              <Link to="/clientes" className="underline hover:text-white">Clientes</Link>
            </p>
          </div>
        )}

        {erro && (
          <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded text-red-300 text-sm">
            ❌ {erro}
            {faltando?.length > 0 && (
              <ul className="mt-2 space-y-0.5 list-disc list-inside text-xs text-red-200">
                {faltando.map((f, i) => <li key={i}>{f.rotulo || f.campo || String(f)}</li>)}
              </ul>
            )}
          </div>
        )}

        {previa ? (
          <div className="space-y-4">
            <div className="p-3 bg-amber-900/20 border border-amber-700/50 rounded text-amber-200 text-sm">
              ⚠️ Nada foi transmitido ainda. Confira e confirme para emitir de verdade.
            </div>
            <div className="p-3 bg-gray-800 rounded text-sm text-gray-300 space-y-1">
              <p><strong>Cliente:</strong> {previa.resumo?.cliente}</p>
              <p><strong>Valor do serviço:</strong> {brl(previa.resumo?.valor_servico)}</p>
              <p><strong>Alíquota ISS:</strong> {previa.resumo?.aliquota_iss}%</p>
              <p><strong>Competência:</strong> {previa.resumo?.competencia}</p>
              <p><strong>Ambiente:</strong>{' '}
                <span className={previa.ambiente === 'producao' ? 'text-red-300 font-semibold' : 'text-amber-300'}>
                  {previa.ambiente === 'producao' ? 'PRODUÇÃO (nota real)' : 'homologação (sem valor fiscal)'}
                </span>
              </p>
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer text-gray-400 hover:text-gray-200">Ver XML assinado</summary>
              <pre className="mt-2 p-2 bg-gray-950 border border-gray-800 rounded max-h-48 overflow-auto text-[10px] text-gray-400 whitespace-pre-wrap break-all">
                {previa.xml_assinado}
              </pre>
            </details>
            <div className="flex gap-3">
              <button onClick={() => setPrevia(null)} disabled={loading}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded transition-colors">
                ← Voltar
              </button>
              <button onClick={() => chamar(true)} disabled={loading}
                className="flex-1 px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-semibold rounded transition-colors">
                {loading ? '⏳ Transmitindo…' : '✅ Confirmar e transmitir'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-semibold text-gray-300 mb-1 block">Descrição do serviço</span>
              <textarea
                value={descricao} onChange={(e) => setDescricao(e.target.value)}
                placeholder="Em branco usa a descrição da fatura"
                rows="3" maxLength="2000"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none resize-none"
              />
              <p className="text-xs text-gray-500 mt-1">{descricao.length}/2000</p>
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-gray-300 mb-1 block">Alíquota ISS (%)</span>
              <input
                type="number" step="0.01" min="0" max="100" value={aliquota}
                onChange={(e) => setAliquota(e.target.value)}
                placeholder="Em branco usa a alíquota cadastrada do emitente"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              />
            </label>

            <div className="p-3 bg-gray-800 rounded text-sm text-gray-300 space-y-1">
              <p><strong>Valor da NF:</strong> {brl(valorNF)}</p>
              {/* Só estima quando há alíquota digitada — "R$ 0,00" ao lado de
                  "ISS" se lê como isenção. */}
              <p><strong>ISS estimado:</strong> {issEstimado === null ? '— (usa a alíquota do emitente)' : brl(issEstimado)}</p>
            </div>

            <div className="flex gap-3">
              <button onClick={onClose} disabled={loading}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded transition-colors">
                Fechar
              </button>
              <button onClick={() => chamar(false)} disabled={loading}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded transition-colors">
                {loading ? '⏳ Montando…' : '👁 Gerar prévia'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
