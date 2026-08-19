import { useState } from 'react'
import XmlPrevia from './XmlPrevia'

// Re-emitir a nota da MESMA fatura, depois de a anterior ter sido cancelada.
//
// ⚠️ Duas etapas, como o cancelamento e a substituição: /api/nfse-emit é
// prévia-por-padrão e transmitir cria um documento fiscal na Receita.
//
// ⚠️ Sem lucide-react — não é dependência do projeto e importá-la quebra o
// build. Emoji é o vocabulário das outras telas.
//
// ⚠️ Sem header Authorization à mão: o interceptor de src/lib/session.js já o
// injeta em toda chamada /api/ (e a chave do token é `gestao_serv_token`, não
// `jwt`).
//
// ⚠️ O VALOR NÃO É EDITÁVEL AQUI, e não é esquecimento. `invoices.invoice_value`
// é DERIVADO pelo calculador (contrato × horas × impostos) junto com o split
// Victor/Fabrício; não existe rota que aceite um valor solto, e gravar um
// deixaria a nota discordando dos payables que a fatura gerou. Trocar o valor é
// editar a fatura em /billing — enquanto ela estiver pendente. O que a prévia
// mostra é o valor que a fatura tem AGORA, lido do backend.

const brl = (v) =>
  v === null || v === undefined || !Number.isFinite(Number(v))
    ? '—'
    : `R$ ${Number(v).toFixed(2).replace('.', ',')}`

export default function NFSeReemitirModal({ emission, onClose, onSuccess }) {
  // Nota cancelada por aqui já tem `cancelled_at`: a fatura está liberada e não
  // há nada a sincronizar. Só a que continua 'enviada'/'autorizada' no sistema
  // — cancelada por fora — precisa da declaração.
  const precisaSincronizar = emission?.status !== 'cancelada'

  const [confirmado, setConfirmado] = useState(!precisaSincronizar)
  const [motivo, setMotivo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [aliquota, setAliquota] = useState('')
  const [loading, setLoading] = useState(false)
  const [etapa, setEtapa] = useState('')   // '' | 'sincronizando' | 'montando' | 'transmitindo'
  const [erro, setErro] = useState(null)
  const [detalhe, setDetalhe] = useState(null)
  const [previa, setPrevia] = useState(null)
  const [sincronizada, setSincronizada] = useState(null)

  const corpoEmissao = (transmitir) => {
    const body = { invoice_id: emission.invoiceId, transmitir }
    if (descricao.trim()) body.descricao_servico = descricao.trim()
    // Só manda a alíquota quando ela foi digitada: `aliquota_iss ?? …` no
    // backend trata string vazia como valor válido, e a nota sairia com 0%.
    const a = parseFloat(String(aliquota).replace(',', '.'))
    if (Number.isFinite(a)) body.aliquota_iss = a
    return body
  }

  const emitir = async (transmitir) => {
    setEtapa(transmitir ? 'transmitindo' : 'montando')
    const res = await fetch('/api/nfse-emit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpoEmissao(transmitir)),
    })
    const data = await res.json()
    if (!res.ok) {
      setErro(data?.error || `Falha (HTTP ${res.status})`)
      setDetalhe(
        data?.detalhe
        || (data?.emissao ? `Já existe a emissão ${data.emissao.id} (${data.emissao.status}) para esta fatura.` : null)
        || (data?.faltando?.length ? `Falta preencher: ${data.faltando.map((f) => f.rotulo || f.campo).join(', ')}` : null)
      )
      return null
    }
    return data
  }

  // Sincronizar + prévia numa tacada: enquanto a emissão anterior não estiver
  // marcada como cancelada, /api/nfse-emit responde 409 e nem a prévia sai.
  const gerarPrevia = async () => {
    setLoading(true); setErro(null); setDetalhe(null)
    try {
      if (precisaSincronizar) {
        setEtapa('sincronizando')
        const res = await fetch('/api/nfse-sincronizar-cancelamento', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            emission_id: emission.id,
            motivo: motivo.trim(),
            confirmar: true,
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          setErro(data?.error || `Falha ao sincronizar (HTTP ${res.status})`)
          setDetalhe(data?.detalhe || data?.alternativa || null)
          return
        }
        setSincronizada(data)
      }

      const nova = await emitir(false)
      if (nova) setPrevia(nova)
    } catch (err) {
      setErro(err.message)
    } finally {
      setLoading(false); setEtapa('')
    }
  }

  const transmitir = async () => {
    setLoading(true); setErro(null); setDetalhe(null)
    try {
      const data = await emitir(true)
      if (data) {
        onSuccess?.({
          nfse_cancelada: emission.nfseNumber,
          sincronizada: Boolean(sincronizada) && !sincronizada?.ja_cancelada,
          emissao: data.emissao,
          ambiente: data.ambiente,
        })
      }
    } catch (err) {
      setErro(err.message)
    } finally {
      setLoading(false); setEtapa('')
    }
  }

  const rotuloCarregando = {
    sincronizando: '⏳ Sincronizando…',
    montando: '⏳ Montando a nota…',
    transmitindo: '⏳ Transmitindo…',
  }[etapa]

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-gray-900 rounded-xl p-6 max-w-lg w-full border border-gray-700 my-8">
        <h2 className="text-xl font-bold text-white mb-1">🔄 Re-emitir NFS-e</h2>
        <p className="text-xs text-gray-400 mb-4">
          {emission?.nfseNumber ? `Nota nº ${emission.nfseNumber}` : `Emissão ${emission?.id}`}
          {emission?.cliente ? ` · ${emission.cliente}` : ''} · {brl(emission?.valor)}
        </p>

        {!previa && (
          <div className="space-y-4">
            {precisaSincronizar ? (
              <div className="p-3 bg-red-900/20 border border-red-700/60 rounded text-red-200 text-sm space-y-2">
                <p>
                  ⚠️ Esta nota consta como <strong>{emission?.status}</strong> no sistema.
                  Re-emitir vai marcá-la como cancelada <strong>sem consultar o fisco</strong>.
                </p>
                <p className="text-xs text-red-300">
                  Se ela ainda valer na prefeitura, a fatura fica liberada e o mesmo serviço
                  passa a ter <strong>duas notas</strong>. Para cancelar de verdade, feche
                  aqui e use ⚙️ Ações → 🚫 Cancelar.
                </p>
                <label className="flex items-start gap-2 pt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmado}
                    onChange={(e) => setConfirmado(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="text-sm text-red-100">
                    Confirmo que a NFS-e {emission?.nfseNumber ? `nº ${emission.nfseNumber}` : ''} já
                    foi cancelada no portal.
                  </span>
                </label>
              </div>
            ) : (
              <div className="p-3 bg-gray-800 border border-gray-700 rounded text-gray-300 text-sm">
                🚫 Nota já cancelada no sistema — a fatura está liberada. Nada será
                sincronizado; a re-emissão vai direto para a prévia.
              </div>
            )}

            {precisaSincronizar && (
              <label className="block">
                <span className="text-sm font-semibold text-gray-300 mb-1 block">
                  Motivo do cancelamento no portal (opcional)
                </span>
                <input
                  type="text"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ex.: valor divergente, cancelada pelo contador"
                  maxLength="255"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Fica no histórico da nota — é o que explica, meses depois, por que ela
                  aparece cancelada sem evento do fisco.
                </p>
              </label>
            )}

            {/* ⚠️ O valor da nova nota NÃO é digitado aqui — ver o cabeçalho
                deste arquivo. A prévia mostra o valor que a fatura tem agora. */}
            <div className="p-3 bg-gray-800/60 border border-gray-700 rounded text-xs text-gray-400">
              💰 <strong className="text-gray-300">Valor:</strong> a nova nota sai pelo valor
              atual da fatura, que a prévia mostra antes de transmitir. Para mudá-lo, edite a
              fatura em <span className="text-gray-300">/billing</span> (só enquanto ela estiver
              pendente) — o valor é calculado junto com o split Victor/Fabrício e não pode ser
              digitado avulso.
            </div>

            <label className="block">
              <span className="text-sm font-semibold text-gray-300 mb-1 block">
                Nova descrição do serviço (opcional)
              </span>
              <textarea
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Em branco mantém a descrição da fatura"
                rows="2" maxLength="2000"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none resize-none"
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-gray-300 mb-1 block">
                Alíquota ISS (%) (opcional)
              </span>
              <input
                type="number" step="0.01" min="0"
                value={aliquota}
                onChange={(e) => setAliquota(e.target.value)}
                placeholder="Em branco usa a da fatura / do emitente"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              />
            </label>

            {erro && (
              <div className="p-3 bg-red-900/30 border border-red-700 rounded text-red-300 text-sm">
                ❌ {erro}
                {detalhe && <p className="mt-1 text-xs text-red-200">{detalhe}</p>}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={onClose} disabled={loading}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded transition-colors">
                Fechar
              </button>
              <button onClick={gerarPrevia} disabled={loading || !confirmado}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded transition-colors">
                {loading ? rotuloCarregando : (precisaSincronizar ? '🔓 Sincronizar e gerar prévia' : '👁 Gerar prévia')}
              </button>
            </div>
          </div>
        )}

        {previa && (
          <div className="space-y-4">
            {sincronizada && !sincronizada.ja_cancelada && (
              <div className="p-3 bg-gray-800 border border-gray-700 rounded text-gray-300 text-sm">
                🚫 Nota nº {sincronizada.nfse_cancelada ?? emission?.nfseNumber} marcada como
                cancelada. A fatura {sincronizada.invoice_number ? `${sincronizada.invoice_number} ` : ''}
                está liberada.
              </div>
            )}

            <div className="p-3 bg-amber-900/20 border border-amber-700/50 rounded text-amber-200 text-sm">
              ⚠️ Nada foi transmitido ainda. Confirme para emitir a nova nota de verdade.
            </div>

            <div className="p-3 bg-gray-800 rounded text-sm text-gray-300 space-y-1">
              <p><strong>Cliente:</strong> {previa.resumo?.cliente}</p>
              <p><strong>Valor:</strong> {brl(previa.resumo?.valor_servico)}</p>
              <p><strong>Alíquota ISS:</strong> {previa.resumo?.aliquota_iss}%</p>
              <p><strong>Competência:</strong> {previa.resumo?.competencia}</p>
              <p><strong>DPS nº:</strong> {previa.resumo?.dps_number}</p>
              <p><strong>Ambiente:</strong>{' '}
                <span className={previa.ambiente === 'producao' ? 'text-red-300 font-semibold' : 'text-amber-300'}>
                  {previa.ambiente}
                </span>
              </p>
            </div>

            <XmlPrevia
              xml={previa.xml_assinado}
              nome={`DPS_${previa.resumo?.dps_number || emission?.invoiceId}`}
              titulo="Ver a DPS assinada"
              contexto={[
                `DPS nº ${previa.resumo?.dps_number} — re-emissão da fatura ${emission?.invoiceId}`,
                `Substitui a NFS-e cancelada nº ${emission?.nfseNumber}`,
                `Cliente: ${previa.resumo?.cliente}`,
                `Valor: ${previa.resumo?.valor_servico} · ISS ${previa.resumo?.aliquota_iss}%`,
                `Competência: ${previa.resumo?.competencia} · Ambiente: ${previa.ambiente}`,
              ]}
            />

            {erro && (
              <div className="p-3 bg-red-900/30 border border-red-700 rounded text-red-300 text-sm">
                ❌ {erro}
                {detalhe && <p className="mt-1 text-xs text-red-200">{detalhe}</p>}
              </div>
            )}

            <div className="flex gap-3">
              {/* ⚠️ "Voltar" não desfaz a sincronização: a nota anterior continua
                  marcada como cancelada, porque ela FOI cancelada no portal —
                  o que se está adiando é a nova emissão, não o fato. */}
              <button onClick={() => setPrevia(null)} disabled={loading}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded transition-colors">
                ← Voltar
              </button>
              <button onClick={transmitir} disabled={loading}
                className="flex-1 px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-semibold rounded transition-colors">
                {loading ? rotuloCarregando : '✅ Emitir nova NFS-e'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
