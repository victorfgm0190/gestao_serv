-- ============================================================================
-- Substituição de NFS-e: o vínculo entre a nota original e a substituta
-- ============================================================================
-- ⚠️ A substituta não "cancela" a original — ela a SUBSTITUI, e quem faz o
--    vínculo é o fisco. Guardar só `cancelled_at` na original perderia a
--    relação, que é justamente o que se pergunta depois: "esta nota foi
--    trocada por qual?".
ALTER TABLE nfse_emissions
  ADD COLUMN IF NOT EXISTS substitui        INT REFERENCES nfse_emissions(id),
  ADD COLUMN IF NOT EXISTS substituida_por  INT REFERENCES nfse_emissions(id);

CREATE INDEX IF NOT EXISTS idx_nfse_emissions_substitui ON nfse_emissions(substitui)
  WHERE substitui IS NOT NULL;

-- ⚠️ O índice de unicidade por fatura precisa aceitar a substituta: a fatura
--    passa a ter DUAS emissões (a substituída e a nova). Sem isto, substituir
--    esbarra na constraint e a nota nova nem é gravada.
DROP INDEX IF EXISTS idx_nfse_emissions_invoice_unica;
CREATE UNIQUE INDEX IF NOT EXISTS idx_nfse_emissions_invoice_unica
  ON nfse_emissions(invoice_id)
  WHERE cancelled_at IS NULL
    AND status NOT IN ('erro', 'substituida');
