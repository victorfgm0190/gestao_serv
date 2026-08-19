// Histórico de eventos de uma NFS-e. Um dono só para o vocabulário — o mesmo
// motivo pelo qual `CATS` mora ao lado de `montarNotes()`: tipo de evento
// gravado com um nome e lido com outro some da timeline sem erro nenhum.

export const EVENTOS = {
  CRIADA: 'nfse.criada',
  ASSINADA: 'nfse.assinada',
  ENVIADA: 'nfse.enviada',
  AUTORIZADA: 'nfse.autorizada',
  REJEITADA: 'nfse.rejeitada',
  CANCELADA: 'nfse.cancelada',
  SUBSTITUIDA: 'nfse.substituida',
  ERRO: 'nfse.erro',
  // Cancelamento feito NO PORTAL, por fora deste sistema, e apenas registrado
  // aqui. Tipo próprio de propósito: gravá-lo como CANCELADA faria a timeline
  // afirmar que nós cancelamos a nota — e é justamente a diferença entre um
  // fato que observamos e um que nos foi declarado.
  CANCELAMENTO_SINCRONIZADO: 'nfse.cancelamento_sincronizado',
}

export const ROTULOS = {
  [EVENTOS.CRIADA]: 'Criada',
  [EVENTOS.ASSINADA]: 'Assinada',
  [EVENTOS.ENVIADA]: 'Enviada ao ADN',
  [EVENTOS.AUTORIZADA]: 'Autorizada',
  [EVENTOS.REJEITADA]: 'Rejeitada',
  [EVENTOS.CANCELADA]: 'Cancelada',
  [EVENTOS.SUBSTITUIDA]: 'Substituída',
  [EVENTOS.ERRO]: 'Erro',
  [EVENTOS.CANCELAMENTO_SINCRONIZADO]: 'Cancelamento sincronizado do portal',
}

/**
 * Grava um evento.
 *
 * ⚠️ `ON CONFLICT DO NOTHING` sobre (emissão, tipo, instante): webhook é
 * reentregue por desenho quando o emissor não recebe 2xx a tempo, e sem isso a
 * timeline mostraria "Autorizada" três vezes.
 *
 * ⚠️ Nunca lança. O evento é registro auxiliar — deixar o cancelamento falhar
 * porque a linha de histórico não entrou seria trocar o essencial pelo
 * acessório. A falha vai para o log.
 */
export async function registrarEvento(sql, emissionId, tipo, dados = {}, opts = {}) {
  const { origem = 'sistema', quando = null } = opts
  try {
    const [linha] = await sql`
      INSERT INTO nfse_events
        (nfse_emission_id, event_type, event_timestamp, event_data, origem)
      VALUES
        (${emissionId}, ${tipo}, ${quando ? new Date(quando) : new Date()},
         ${JSON.stringify(dados ?? {})}, ${origem})
      ON CONFLICT (nfse_emission_id, event_type, event_timestamp) DO NOTHING
      RETURNING id`
    return linha?.id ?? null
  } catch (err) {
    console.error(`[nfse-events] falha ao registrar ${tipo}:`, err.message)
    return null
  }
}

export async function listarEventos(sql, emissionId) {
  return sql`
    SELECT id, nfse_emission_id, event_type, event_timestamp, event_data, received_at, origem
    FROM nfse_events
    WHERE nfse_emission_id = ${emissionId}
    ORDER BY event_timestamp ASC, id ASC`
}
