import { useState } from 'react'

// Cancelamento de NFS-e. Duas etapas, pelo mesmo motivo da emissão: o backend
// é prévia-por-padrão e cancelar é irreversível do lado do fisco.
//
// ⚠️ Os motivos têm CÓDIGO, não só texto. O ADN classifica o cancelamento pelo
// código (`cMotivo`); mandar apenas a frase livre, como no esboço, deixa o
// evento sem classificação.

const MOTIVOS = [
  { codigo: '1', texto: 'Erro na emissão' },
  { codigo: '2', texto: 'Serviço não prestado' },
  { codigo: '3', texto: 'Duplicidade da nota' },
  { codigo: '9', texto: 'Outro' },
]

export default function NFSeCancelModal({ emission, onClose, onSuccess }) {
  const [codigo, setCodigo] = useState(MOTIVOS[0].codigo)
  const [observacoes, setObservacoes] = useState('')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState(null)
  const [detalhe, setDetalhe] = useState(null)
  const [previa, setPrevia] = useState(null)

  const chamar = async (transmitir) => {
    setLoading(true); setErro(null); setDetalhe(null)
    try {
      const res = await fetch('/api/nfse-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emission_id: emission.id,
          codigo_motivo: codigo,
          motivo: MOTIVOS.find((m) => m.codigo === codigo)?.texto,
          observacoes,
          transmitir,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErro(data?.error || `Falha (HTTP ${res.status})`)
        if (data?.detalhe) setDetalhe(data.detalhe)
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

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-gray-900 rounded-xl p-6 max-w-lg w-full border border-gray-700 my-8">
        <h2 className="text-xl font-bold text-red-400 mb-1">🚫 Cancelar NFS-e</h2>
        <p className="text-xs text-gray-400 mb-4">
          {emission?.nfseNumber ? `Nota #${emission.nfseNumber}` : `Emissão ${emission?.id}`}
          {emission?.cliente ? ` · ${emission.cliente}` : ''}
        </p>

        <div className="mb-4 p-3 bg-red-900/25 border border-red-700/60 rounded text-red-300 text-sm">
          ⚠️ O cancelamento é registrado no fisco e não pode ser desfeito por aqui.
        </div>

        {erro && (
          <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded text-red-300 text-sm">
            ❌ {erro}
            {detalhe && <p className="mt-1 text-xs text-red-200">{detalhe}</p>}
          </div>
        )}

        {previa ? (
          <div className="space-y-4">
            <div className="p-3 bg-amber-900/20 border border-amber-700/50 rounded text-amber-200 text-sm">
              ⚠️ Nada foi transmitido ainda. Confirme para cancelar de verdade.
            </div>
            <div className="p-3 bg-gray-800 rounded text-sm text-gray-300 space-y-1">
              <p><strong>Motivo:</strong> {previa.resumo?.motivo}</p>
              <p><strong>Código:</strong> {previa.resumo?.codigo_motivo}</p>
              <p><strong>Ambiente:</strong>{' '}
                <span className={previa.resumo?.ambiente === 'producao' ? 'text-red-300 font-semibold' : 'text-amber-300'}>
                  {previa.resumo?.ambiente}
                </span>
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setPrevia(null)} disabled={loading}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded transition-colors">
                ← Voltar
              </button>
              <button onClick={() => chamar(true)} disabled={loading}
                className="flex-1 px-4 py-2 bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold rounded transition-colors">
                {loading ? '⏳ Cancelando…' : '🚫 Confirmar cancelamento'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
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
              <span className="text-sm font-semibold text-gray-300 mb-1 block">Observações (opcional)</span>
              <textarea
                value={observacoes} onChange={(e) => setObservacoes(e.target.value)}
                placeholder="Detalhes que ajudem a entender o cancelamento depois"
                rows="3" maxLength="200"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none resize-none"
              />
              <p className="text-xs text-gray-500 mt-1">{observacoes.length}/200</p>
            </label>

            <div className="flex gap-3">
              <button onClick={onClose} disabled={loading}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded transition-colors">
                Manter a nota
              </button>
              <button onClick={() => chamar(false)} disabled={loading}
                className="flex-1 px-4 py-2 bg-red-700/80 hover:bg-red-700 disabled:opacity-50 text-white font-semibold rounded transition-colors">
                {loading ? '⏳ Montando…' : '👁 Gerar prévia'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
