// Linha do tempo de uma NFS-e.
//
// ⚠️ Sem lucide-react — não é dependência do projeto, e importá-la quebra o
// build. Emoji é o vocabulário das outras telas.
//
// ⚠️ Os eventos chegam em ordem CRESCENTE do endpoint e são desenhados nessa
// ordem. Ordenar DESC (como fazia o esboço) e desenhar de cima para baixo põe
// "Cancelada" antes de "Criada" — a linha do tempo ao contrário.

const ICONES = {
  'nfse.criada': '📝',
  'nfse.assinada': '🔏',
  'nfse.enviada': '📤',
  'nfse.autorizada': '✅',
  'nfse.rejeitada': '⛔',
  'nfse.cancelada': '🚫',
  'nfse.cancelamento_sincronizado': '🚫',
  'nfse.erro': '❌',
}

const CORES = {
  'nfse.autorizada': 'text-green-400',
  'nfse.rejeitada': 'text-red-400',
  'nfse.cancelada': 'text-red-400',
  'nfse.cancelamento_sincronizado': 'text-red-400',
  'nfse.erro': 'text-red-400',
  'nfse.enviada': 'text-yellow-400',
}

const dataHora = (v) => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR')
}

export default function NFSeTimeline({ events = [] }) {
  if (!events?.length) {
    return <p className="text-gray-500 text-sm">Nenhum evento registrado.</p>
  }

  return (
    <div className="space-y-0">
      {events.map((ev, i) => {
        const dados = ev.event_data || {}
        const detalhe = dados.motivo || dados.erro || dados.status_original || null
        return (
          <div key={ev.id ?? i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="text-base leading-none pt-0.5">{ICONES[ev.event_type] || '•'}</span>
              {i < events.length - 1 && <div className="w-px flex-1 bg-gray-700 my-1" />}
            </div>
            <div className="pb-3 min-w-0">
              <p className={`text-sm font-semibold ${CORES[ev.event_type] || 'text-gray-200'}`}>
                {/* O rótulo vem do servidor, do mesmo mapa que grava os tipos.
                    Um segundo dicionário aqui divergiria no dia em que um tipo
                    novo fosse acrescentado — e o evento apareceria cru. */}
                {ev.label || ev.event_type}
                {ev.origem === 'webhook' && (
                  <span className="ml-2 text-[10px] font-normal text-gray-500 uppercase">via webhook</span>
                )}
                {/* ⚠️ 'manual' não é detalhe de origem: o fato não foi
                    observado por nós nem entregue pelo emissor — foi declarado
                    por uma pessoa. Sem a etiqueta, um cancelamento sincronizado
                    lê-se como evento do fisco. */}
                {ev.origem === 'manual' && (
                  <span className="ml-2 text-[10px] font-normal text-amber-500 uppercase">registro manual</span>
                )}
              </p>
              <p className="text-xs text-gray-500">{dataHora(ev.event_timestamp)}</p>
              {detalhe && <p className="text-xs text-gray-400 mt-0.5 break-words">{String(detalhe)}</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
