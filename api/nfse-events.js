import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import { listarEventos, ROTULOS } from '../lib/nfse-events.js'

// Histórico de eventos de uma emissão (a timeline da tela).
export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const emissionId = parseInt(req.query.emission_id, 10)
  if (!Number.isInteger(emissionId)) {
    return res.status(400).json({ error: 'emission_id é obrigatório' })
  }

  try {
    const sql = neon(process.env.DATABASE_URL)
    const eventos = await listarEventos(sql, emissionId)

    return res.status(200).json({
      success: true,
      // ⚠️ Ordem CRESCENTE (vem assim de listarEventos). O esboço ordenava
      // DESC e a tela desenha de cima para baixo: "Cancelada" apareceria antes
      // de "Criada", com a linha do tempo invertida.
      events: eventos.map((e) => ({
        id: e.id,
        event_type: e.event_type,
        // Rótulo resolvido no servidor, do mesmo mapa que grava os tipos —
        // duas tabelas de tradução divergem no dia em que um tipo é acrescentado.
        label: ROTULOS[e.event_type] || e.event_type,
        event_timestamp: e.event_timestamp,
        received_at: e.received_at,
        origem: e.origem,
        event_data: e.event_data,
      })),
    })
  } catch (err) {
    console.error('[nfse-events] falha:', err.message)
    return res.status(500).json({ error: 'Erro ao listar eventos' })
  }
}
