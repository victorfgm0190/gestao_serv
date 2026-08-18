-- ============================================================================
-- NFS-e — ETAPA 6: histórico de eventos da nota
-- ============================================================================
-- ⚠️ A tabela `nfse_events` é lida e escrita pelo cancelamento, pelo webhook e
--    pelo endpoint de histórico da etapa 6 — e não existia. Todo INSERT
--    falharia com "relation does not exist".
-- ============================================================================

CREATE TABLE IF NOT EXISTS nfse_events (
  id SERIAL PRIMARY KEY,

  -- CASCADE: o evento existe POR CAUSA da emissão. Apagada a emissão, um
  -- histórico órfão afirmaria fatos sobre uma nota que não está mais lá —
  -- o mesmo motivo de fiscal_allocations.payable_payment_id.
  nfse_emission_id INT NOT NULL REFERENCES nfse_emissions(id) ON DELETE CASCADE,

  event_type VARCHAR(50) NOT NULL,
  event_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),  -- quando o fato ocorreu
  event_data JSONB,
  received_at TIMESTAMP NOT NULL DEFAULT NOW(),      -- quando NÓS soubemos
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',     -- sistema | webhook

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nfse_events_emission
  ON nfse_events(nfse_emission_id, event_timestamp DESC);

-- ⚠️ Webhook é entregue mais de uma vez por desenho (o emissor reenvia quando
--    não recebe 2xx a tempo). Sem esta chave, cada redelivery vira uma linha
--    nova e a timeline mostra "Aprovada" três vezes seguidas.
CREATE UNIQUE INDEX IF NOT EXISTS idx_nfse_events_unico
  ON nfse_events(nfse_emission_id, event_type, event_timestamp);
