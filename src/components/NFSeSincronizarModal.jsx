import { useState } from 'react'

// Registrar, no sistema, um cancelamento que foi feito NO PORTAL — sem
// re-emitir nada. É o atalho da lista: até aqui só dava para sincronizar
// entrando no fluxo de 🔄 Re-emitir, que emite outra nota em seguida.
//
// ⚠️ ISTO É UMA DECLARAÇÃO, NÃO UMA VERIFICAÇÃO — e não por falta de tentativa.
// O esboço pedia um `/api/nfse-status-portal` que consultasse o fisco e só
// sincronizasse se a nota constasse cancelada lá. Sondado contra a PRODUÇÃO com
// o certificado da Lumen, em 2026-08-19:
//
//   GET  /SefinNacional/nfse/{chave}           → 200, e o XML da nota
//   GET  /SefinNacional/nfse/{chave}/eventos   → 405 (a rota só aceita POST)
//
// e o XML devolvido não tem NADA de cancelamento: nem <evento>, nem <dhCanc>,
// nem <xJust>. A nota nº 26 — que este sistema marca como cancelada — volta do
// SEFIN com `cStat=100`, exatamente igual à nº 27, que está válida. A consulta
// devolve o DOCUMENTO AUTORIZADO; o cancelamento vive no fluxo de eventos, que
// não tem leitura por aqui.
//
// Um botão apoiado nessa consulta responderia "ainda válida no portal" para
// TODA nota, inclusive as canceladas de verdade — errado justamente na única
// direção que ele existe para detectar. Por isso a confirmação explícita
// continua sendo humana.

export function AvisoDeclaracao({ nfseNumber, status, confirmado, onConfirmar }) {
  return (
    <div className="p-3 bg-red-900/20 border border-red-700/60 rounded text-red-200 text-sm space-y-2">
      <p>
        ⚠️ Esta nota consta como <strong>{status}</strong> no sistema. Sincronizar vai
        marcá-la como cancelada <strong>sem consultar o fisco</strong>.
      </p>
      <p className="text-xs text-red-300">
        O SEFIN não expõe o cancelamento na consulta por chave — a nota cancelada volta
        igual à válida (<code>cStat=100</code>). Se ela ainda valer na prefeitura, a fatura
        fica liberada e o mesmo serviço passa a ter <strong>duas notas</strong>. Para
        cancelar de verdade, use ⚙️ Ações → 🚫 Cancelar.
      </p>
      <label className="flex items-start gap-2 pt-1 cursor-pointer">
        <input
          type="checkbox" checked={confirmado}
          onChange={(e) => onConfirmar(e.target.checked)}
          className="mt-0.5"
        />
        <span className="text-sm text-red-100">
          Confirmo que a NFS-e {nfseNumber ? `nº ${nfseNumber}` : ''} já foi cancelada no portal.
        </span>
      </label>
    </div>
  )
}

export default function NFSeSincronizarModal({ emission, onClose, onSuccess }) {
  const [confirmado, setConfirmado] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState(null)
  const [detalhe, setDetalhe] = useState(null)

  const sincronizar = async () => {
    setLoading(true); setErro(null); setDetalhe(null)
    try {
      const res = await fetch('/api/nfse-sincronizar-cancelamento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // ⚠️ `confirmar: true` é obrigatório no endpoint. O esboço mandava só
        // o emission_id e tomaria 400 — a sincronização nunca aconteceria, e o
        // `alert` de sucesso apareceria do mesmo jeito, porque ele nem olhava
        // a resposta.
        body: JSON.stringify({
          emission_id: emission.id,
          motivo: motivo.trim(),
          confirmar: true,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErro(data?.error || `Falha (HTTP ${res.status})`)
        setDetalhe(data?.detalhe || data?.alternativa || null)
        return
      }
      onSuccess?.(data)
    } catch (err) {
      setErro(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-gray-900 rounded-xl p-6 max-w-lg w-full border border-gray-700 my-8">
        <h2 className="text-xl font-bold text-white mb-1">🔄 Sincronizar cancelamento</h2>
        <p className="text-xs text-gray-400 mb-4">
          {emission?.nfseNumber ? `Nota nº ${emission.nfseNumber}` : `Emissão ${emission?.id}`}
          {emission?.cliente ? ` · ${emission.cliente}` : ''}
        </p>

        <div className="space-y-4">
          <AvisoDeclaracao
            nfseNumber={emission?.nfseNumber}
            status={emission?.status}
            confirmado={confirmado}
            onConfirmar={setConfirmado}
          />

          <label className="block">
            <span className="text-sm font-semibold text-gray-300 mb-1 block">
              Motivo do cancelamento no portal (opcional)
            </span>
            <input
              type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: valor divergente, cancelada pelo contador"
              maxLength="255"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
            <p className="text-xs text-gray-500 mt-1">
              Fica no histórico da nota — é o que explica, meses depois, por que ela
              aparece cancelada sem evento do fisco.
            </p>
          </label>

          <p className="text-xs text-gray-500">
            Só marca a nota como cancelada e libera a fatura. Para já emitir a substituta
            na mesma passada, use <strong className="text-gray-400">🔄 Re-emitir</strong>.
          </p>

          {erro && (
            <div className="p-3 bg-red-900/30 border border-red-700 rounded text-red-300 text-sm">
              ❌ {erro}
              {detalhe && <p className="mt-1 text-xs text-red-200">{detalhe}</p>}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={onClose} disabled={loading}
              className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded transition-colors">
              Manter como está
            </button>
            <button onClick={sincronizar} disabled={loading || !confirmado}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded transition-colors">
              {loading ? '⏳ Sincronizando…' : '🔄 Marcar como cancelada'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
