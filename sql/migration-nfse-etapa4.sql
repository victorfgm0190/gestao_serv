-- ============================================================================
-- NFS-e — ETAPA 4: dados do emitente, do tomador e trava de duplicidade
-- ============================================================================
-- Aditiva e idempotente.
--
-- ⚠️ Por que esta migration existe: o endpoint de emissão precisa do CNPJ, da
--    inscrição municipal e do endereço do PRESTADOR, e **nada disso existe no
--    banco** — `companies` tem só (id, name, color, created_at). O esboço da
--    etapa 4 contornava com literais no código:
--
--        inscricaoMunicipal: '123456',       // TODO: buscar do banco
--        logradouro: 'Rua Test', numero: '123', codigo_municipio: '4106902'
--
--    e lia `comp.cnpj`, coluna que não existe (a query falharia). Emitir com
--    esses valores não é um placeholder inofensivo: é um documento fiscal
--    protocolado na Receita com endereço e inscrição de outra pessoa.
-- ============================================================================


-- ===== CREATE TABLE: nfse_emitter_settings ==================================
-- Quem emite a nota. Uma linha por empresa.
CREATE TABLE IF NOT EXISTS nfse_emitter_settings (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL UNIQUE REFERENCES companies(id),

  cnpj VARCHAR(14),
  inscricao_municipal VARCHAR(20),
  razao_social VARCHAR(255),
  nome_fantasia VARCHAR(255),

  endereco VARCHAR(255),
  numero VARCHAR(10),
  complemento VARCHAR(100),
  bairro VARCHAR(100),
  municipio_codigo VARCHAR(7),   -- IBGE, 7 dígitos
  uf VARCHAR(2),
  cep VARCHAR(8),

  telefone VARCHAR(20),
  email VARCHAR(255),

  -- Tributação padrão das notas desta empresa.
  -- opta_simples: 1=não optante, 2=optante MEI, 3=optante (não MEI)
  opta_simples SMALLINT DEFAULT 3,
  regime_especial SMALLINT DEFAULT 0,
  item_lista_servico VARCHAR(10),   -- cTribNac (ex.: '01.06')
  codigo_tributacao_municipal VARCHAR(20),
  cnae VARCHAR(7),
  nbs VARCHAR(9),
  aliquota_iss NUMERIC(5,2),

  -- 1=produção, 2=homologação. Nasce em HOMOLOGAÇÃO de propósito: o padrão de
  -- um sistema fiscal recém-configurado não pode ser transmitir para valer.
  ambiente SMALLINT NOT NULL DEFAULT 2,
  serie VARCHAR(5) NOT NULL DEFAULT '00001',

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nfse_emitter_company ON nfse_emitter_settings(company_id);


-- ===== ALTER TABLE: clients (o que faltava do tomador) ======================
-- A etapa 1 trouxe cpf_cnpj, endereço, número, complemento, bairro, cep e
-- municipio_codigo. Faltam a razão social (o `name` é apelido de tela —
-- "Pharmalog/ANB", "Bokada(Renato) 85"), a UF e os contatos.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS razao_social        VARCHAR(255),
  ADD COLUMN IF NOT EXISTS uf                  VARCHAR(2),
  ADD COLUMN IF NOT EXISTS email               VARCHAR(255),
  ADD COLUMN IF NOT EXISTS telefone            VARCHAR(20),
  ADD COLUMN IF NOT EXISTS inscricao_municipal VARCHAR(20);


-- ===== nfse_emissions: uma nota por fatura ==================================
-- ⚠️ Sem isto, chamar o endpoint de emissão duas vezes protocola DUAS notas
--    fiscais para a mesma fatura — e a segunda não tem como ser desfeita por
--    aqui. O índice é parcial: uma nota cancelada libera nova emissão, e
--    tentativas que falharam (status 'erro') não bloqueiam a próxima.
CREATE UNIQUE INDEX IF NOT EXISTS idx_nfse_emissions_invoice_unica
  ON nfse_emissions(invoice_id)
  WHERE cancelled_at IS NULL AND status <> 'erro';

-- Rastreia a tentativa mesmo quando ela não chega a virar nota.
ALTER TABLE nfse_emissions
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS ambiente      SMALLINT;
