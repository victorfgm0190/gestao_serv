-- ============================================================================
-- NFS-e: guardar a NOTA AUTORIZADA, não só a DPS enviada
-- ============================================================================
-- O SEFIN devolve `nfseXmlGZipB64` — o XML da NFS-e autorizada, com o
-- prestador preenchido pelo cadastro nacional e o número da nota. É o
-- documento fiscal; a DPS é só o pedido. Guardar apenas a DPS deixaria o
-- DANFSE sem razão social e sem endereço do prestador, que por exigência do
-- SEFIN (E0121/E0128) NÃO podem ser enviados na DPS.
ALTER TABLE nfse_emissions
  ADD COLUMN IF NOT EXISTS xml_nfse     TEXT,
  ADD COLUMN IF NOT EXISTS chave_acesso VARCHAR(60);

CREATE INDEX IF NOT EXISTS idx_nfse_emissions_chave
  ON nfse_emissions(chave_acesso) WHERE chave_acesso IS NOT NULL;

-- ⚠️ O número da DPS não pode ser derivado de MAX(dps_number): apagar (ou
-- perder) uma linha reinicia a contagem, e o SEFIN recusa com E0014 —
-- "série + número + município + CNPJ já existe em uma NFS-e gerada". O número
-- é consumido no FISCO, não aqui, então o contador tem de ser monotônico e
-- independente das linhas de emissão.
ALTER TABLE nfse_emitter_settings
  ADD COLUMN IF NOT EXISTS ultimo_dps INT NOT NULL DEFAULT 0;
