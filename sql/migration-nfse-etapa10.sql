-- ============================================================================
-- Numerador da DPS separado por AMBIENTE
-- ============================================================================
-- ⚠️ `ultimo_dps` era um contador só para os dois ambientes. Homologação
--    consumiu as DPS 1 e 2; produção começou na 3. O número é controlado pelo
--    FISCO por (série + número + município + CNPJ) DENTRO de cada ambiente,
--    então:
--      · a série de produção nasceu com um buraco (1 e 2 nunca existiram lá);
--      · e o pior — um teste em homologação passa a consumir números da
--        PRODUÇÃO, empurrando a numeração fiscal real para frente sem que
--        nenhuma nota tenha sido emitida.
--    `ultimo_dps` fica sendo o de produção; homologação ganha o seu.
ALTER TABLE nfse_emitter_settings
  ADD COLUMN IF NOT EXISTS ultimo_dps_homolog INT NOT NULL DEFAULT 0;
