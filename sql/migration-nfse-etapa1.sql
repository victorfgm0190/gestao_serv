-- ============================================================================
-- NFS-e — ETAPA 1: estrutura de banco (tomador, serviço, certificado, emissão)
-- ============================================================================
-- Aditiva e idempotente: só ADD COLUMN IF NOT EXISTS / CREATE ... IF NOT EXISTS.
-- Nenhuma coluna existente é alterada ou removida.
--
-- ⚠️ Sintaxe: PostgreSQL NÃO aceita `ADD COLUMN IF NOT EXISTS (a, b, c)`.
--    Cada coluna precisa da sua própria cláusula ADD COLUMN. A forma com lista
--    entre parênteses é erro de sintaxe e aborta a migration inteira.
-- ============================================================================


-- ===== ALTER TABLE: clients (Tomador do Serviço) ============================
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS cpf_cnpj          VARCHAR(18),
  ADD COLUMN IF NOT EXISTS endereco          VARCHAR(255),
  ADD COLUMN IF NOT EXISTS numero            VARCHAR(10),
  ADD COLUMN IF NOT EXISTS complemento       VARCHAR(100),
  ADD COLUMN IF NOT EXISTS bairro            VARCHAR(100),
  ADD COLUMN IF NOT EXISTS cep               VARCHAR(10),
  ADD COLUMN IF NOT EXISTS municipio_codigo  VARCHAR(10),
  ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMP DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_clients_cpf_cnpj ON clients(cpf_cnpj);


-- ===== ALTER TABLE: invoices (Serviço Prestado) =============================
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS municipio_codigo   VARCHAR(10),
  ADD COLUMN IF NOT EXISTS nbs_codigo         VARCHAR(8),
  ADD COLUMN IF NOT EXISTS codigo_tributacao  VARCHAR(10),
  ADD COLUMN IF NOT EXISTS descricao_nfse     TEXT,
  ADD COLUMN IF NOT EXISTS aliquota_iss       DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS competencia        DATE,
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMP DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_invoices_municipio   ON invoices(municipio_codigo);
CREATE INDEX IF NOT EXISTS idx_invoices_competencia ON invoices(competencia);


-- ===== CREATE TABLE: nfse_certificates ======================================
-- Certificado A1 (.pfx) e senha, ambos cifrados em AES-256-GCM por
-- lib/crypto-manager.js. O IV é gravado à parte (hex, 16 bytes = 32 chars).
CREATE TABLE IF NOT EXISTS nfse_certificates (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL UNIQUE REFERENCES companies(id),

  certificate_pfx_encrypted BYTEA NOT NULL,
  certificate_pfx_iv VARCHAR(32) NOT NULL,

  certificate_password_encrypted VARCHAR(512) NOT NULL,
  certificate_password_iv VARCHAR(32) NOT NULL,

  certificate_thumbprint VARCHAR(64),
  certificate_subject VARCHAR(255),
  certificate_valid_from TIMESTAMP,
  certificate_valid_until TIMESTAMP,

  uploaded_by INT,
  uploaded_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nfse_cert_company    ON nfse_certificates(company_id);
CREATE INDEX IF NOT EXISTS idx_nfse_cert_thumbprint ON nfse_certificates(certificate_thumbprint);


-- ===== CREATE TABLE: nfse_certificate_alerts ================================
-- Avisos de vencimento do certificado (A1 vale 1 ano).
CREATE TABLE IF NOT EXISTS nfse_certificate_alerts (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id),
  alert_type VARCHAR(50),
  certificate_valid_until TIMESTAMP,
  days_remaining INT,
  severity VARCHAR(20),
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP,
  notified_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_company ON nfse_certificate_alerts(company_id);
CREATE INDEX IF NOT EXISTS idx_alerts_unread  ON nfse_certificate_alerts(is_read, company_id);


-- ===== CREATE TABLE: nfse_emissions =========================================
-- Uma linha por DPS enviada. Guarda o XML assinado e a resposta crua da API
-- nacional — são a prova do que foi transmitido, não dado derivado.
--
-- ⚠️ invoice_id sem ON DELETE: apagar uma fatura que já tem NFS-e emitida é
--    recusado pelo banco (violação de FK). É deliberado — a nota existe na
--    prefeitura e não some porque a fatura foi estornada aqui. Quando a ETAPA
--    de estorno chegar, converter isso num 403 explícito, como já se faz com
--    payable pago em api/invoices.js.
CREATE TABLE IF NOT EXISTS nfse_emissions (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id),
  invoice_id INT REFERENCES invoices(id),

  nfse_number BIGINT,
  nsu VARCHAR(36),
  protocol VARCHAR(36),
  status VARCHAR(50),
  dps_number INT,

  xml_assinado TEXT,
  json_response JSONB,

  competencia DATE,
  valor_servico NUMERIC(15,2),
  valor_tributos NUMERIC(15,2),
  municipio_codigo VARCHAR(10),
  cnae_codigo VARCHAR(7),

  submitted_at TIMESTAMP,
  approved_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nfse_emissions_company ON nfse_emissions(company_id);
CREATE INDEX IF NOT EXISTS idx_nfse_emissions_invoice ON nfse_emissions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_nfse_emissions_status  ON nfse_emissions(status);
