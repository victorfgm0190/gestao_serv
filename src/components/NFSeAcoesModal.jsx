import { useState } from 'react'

// Ações sobre uma NFS-e já autorizada: substituir ou cancelar.
//
// ⚠️ O CANCELAMENTO NÃO É REIMPLEMENTADO AQUI. Ele delega para o
// NFSeCancelModal que já existe — que tem os códigos de motivo, a prévia em
// duas etapas e o tratamento do 422 quando falta a chave. Duplicar o fluxo
// criaria dois lugares para corrigir quando o SEFIN mudar alguma regra.
//
// ⚠️ SUBSTITUIR NÃO CORRIGE VALOR no Simples ME/EPP. O SEFIN recusa com E0063
// (competência, tomador e valor não podem mudar) — verificado contra o serviço
// real. O formulário diz isso de saída, em vez de deixar a pessoa preencher e
// levar a recusa depois.

const MOTIVO_MIN = 15

const MOTIVOS = [
  { codigo: '01', texto: 'Desenquadramento de NFS-e' },
  { codigo: '02', texto: 'Enquadramento de NFS-e' },
  { codigo: '03', texto: 'Inclusão/alteração de dados cadastrais' },
  { codigo: '04', texto: 'Correção de dados do serviço' },
]

const brl = (v) =>
  v === null || v === undefined || !Number.isFinite(Number(v))
    ? '—'
    : `R$ ${Number(v).toFixed(2).replace('.', ',')}`

export default function NFSeAcoesModal({ emission, onClose, onCancelar, onSuccess }) {
  const [acao, setAcao] = useState('')
  const [codigo, setCodigo] = useState(MOTIVOS[3].codigo)
  const [motivo, setMotivo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState(null)
  const [detalhe, setDetalhe] = useState(null)
  const [previa, setPrevia] = useState(null)

  const chamar = async (transmitir) => {
    setLoading(true); setErro(null); setDetalhe(null)
    try {
      const res = await fetch('/api/nfse-substituir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emission_id: emission.id,
          codigo_motivo: codigo,
          motivo: motivo.trim(),
          ...(descricao.trim() ? { descricao: descricao.trim() } : {}),
          transmitir,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErro(data?.error || `Falha (HTTP ${res.status})`)
        setDetalhe(data?.alternativa || data?.detalhe || null)
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

  const motivoCurto = motivo.trim().length < MOTIVO_MIN

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-gray-900 rounded-xl p-6 max-w-lg w-full border border-gray-700 my-8">
        <h2 className="text-xl font-bold text-white mb-1">⚙️ Ações da NFS-e</h2>
        <p className="text-xs text-gray-400 mb-4">
          {emission?.nfseNumber ? `Nota nº ${emission.nfseNumber}` : `Emissão ${emission?.id}`}
          {emission?.cliente ? ` · ${emission.cliente}` : ''} · {brl(emission?.valor)}
        </p>

        {!acao && (
          <div className="space-y-3">
            <button
              onClick={() => setAcao('substituir')}
              className="w-full px-4 py-3 bg-blue-700 hover:bg-blue-600 text-white rounded font-semibold transition-colors text-left"
            >
              🔄 Substituir
              <span className="block text-xs font-normal text-blue-200 mt-0.5">
                Corrige descrição e dados cadastrais. O valor NÃO pode mudar.
              </span>
            </button>

            <button
              onClick={() => { onClose?.(); onCancelar?.(emission) }}
              className="w-full px-4 py-3 bg-red-800 hover:bg-red-700 text-white rounded font-semibold transition-colors text-left"
            >
              🚫 Cancelar
              <span className="block text-xs font-normal text-red-200 mt-0.5">
                Invalida a nota. É o caminho para corrigir VALOR: cancelar e emitir outra.
              </span>
            </button>

            <button
              onClick={onClose}
              className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
            >
              Fechar
            </button>
          </div>
        )}

        {acao === 'substituir' && !previa && (
          <div className="space-y-4">
            {/* ⚠️ Dito na abertura, não depois da recusa. */}
            <div className="p-3 bg-amber-900/20 border border-amber-700/50 rounded text-amber-200 text-sm">
              ⚠️ A substituta mantém <strong>valor, competência e tomador</strong> da original
              — é exigência do SEFIN para optante do Simples (E0063). Para mudar o valor,
              o caminho é cancelar e emitir outra.
            </div>

            <label className="block">
              <span className="text-sm font-semibold text-gray-300 mb-1 block">Motivo</span>
              <select
                value={codigo} onChange={(e) => setCodigo(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white focus:border-blue-500 focus:outline-none"
              >
                {MOTIVOS.map((m) => (
                  <option key={m.codigo} value={m.codigo}>{m.codigo} — {m.texto}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-gray-300 mb-1 block">
                Descrição do motivo
              </span>
              <textarea
                value={motivo} onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex.: Correcao da descricao do servico prestado"
                rows="2" maxLength="255"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none resize-none"
              />
              {/* O mínimo é do schema nacional (TSMotivo), não uma regra nossa —
                  avisar aqui evita a viagem até a recusa. */}
              <p className={`text-xs mt-1 ${motivoCurto ? 'text-amber-400' : 'text-gray-500'}`}>
                {motivo.trim().length}/{MOTIVO_MIN} mínimo exigido pelo SEFIN
              </p>
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-gray-300 mb-1 block">
                Nova descrição do serviço (opcional)
              </span>
              <textarea
                value={descricao} onChange={(e) => setDescricao(e.target.value)}
                placeholder="Em branco mantém a descrição atual"
                rows="2" maxLength="2000"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none resize-none"
              />
            </label>

            {erro && (
              <div className="p-3 bg-red-900/30 border border-red-700 rounded text-red-300 text-sm">
                ❌ {erro}
                {detalhe && <p className="mt-1 text-xs text-red-200">{detalhe}</p>}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setAcao('')} disabled={loading}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded transition-colors">
                ← Voltar
              </button>
              <button onClick={() => chamar(false)} disabled={loading || motivoCurto}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded transition-colors">
                {loading ? '⏳ Montando…' : '👁 Gerar prévia'}
              </button>
            </div>
          </div>
        )}

        {acao === 'substituir' && previa && (
          <div className="space-y-4">
            <div className="p-3 bg-amber-900/20 border border-amber-700/50 rounded text-amber-200 text-sm">
              ⚠️ Nada foi transmitido ainda. Confirme para substituir de verdade.
            </div>
            <div className="p-3 bg-gray-800 rounded text-sm text-gray-300 space-y-1">
              <p><strong>Substitui:</strong> nota nº {previa.resumo?.substitui?.nfse_number}</p>
              <p><strong>Valor:</strong> {brl(previa.resumo?.valor)} <span className="text-gray-500">(inalterado)</span></p>
              <p><strong>Competência:</strong> {previa.resumo?.competencia}</p>
              <p><strong>Motivo:</strong> {previa.resumo?.codigo_motivo} — {previa.resumo?.motivo}</p>
              <p><strong>Ambiente:</strong>{' '}
                <span className={previa.ambiente === 'producao' ? 'text-red-300 font-semibold' : 'text-amber-300'}>
                  {previa.ambiente}
                </span>
              </p>
            </div>
            {erro && (
              <div className="p-3 bg-red-900/30 border border-red-700 rounded text-red-300 text-sm">
                ❌ {erro}
                {detalhe && <p className="mt-1 text-xs text-red-200">{detalhe}</p>}
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => setPrevia(null)} disabled={loading}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded transition-colors">
                ← Voltar
              </button>
              <button onClick={() => chamar(true)} disabled={loading}
                className="flex-1 px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-semibold rounded transition-colors">
                {loading ? '⏳ Transmitindo…' : '✅ Confirmar substituição'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
