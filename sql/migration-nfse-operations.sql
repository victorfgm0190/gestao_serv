-- ============================================================================
-- NFS-e — histórico de OPERAÇÕES: o que foi enviado e o que voltou
-- ============================================================================
-- `nfse_emissions` guarda o ESTADO ATUAL de cada nota: uma linha, com o último
-- XML enviado e a última resposta. O que ela não guarda é a SEQUÊNCIA — a
-- emissão que falhou antes da que deu certo, o pedido de cancelamento e o que
-- o fisco respondeu, a consulta que trouxe o XML oficial. Quando o SEFIN
-- recusa alguma coisa, é justamente esse par (enviei isto / recebi aquilo) que
-- se precisa ler, e ele hoje se perde.
--
-- ⚠️ Esta tabela NÃO substitui as colunas de `nfse_emissions`. Ela é a trilha;
--    a emissão continua sendo a verdade sobre o estado da nota. Duas fontes
--    para o mesmo estado é como uma delas passa a mentir.
-- ============================================================================

CREATE TABLE IF NOT EXISTS nfse_operations (
  id BIGSERIAL PRIMARY KEY,

  company_id BIGINT NOT NULL REFERENCES companies(id),
  invoice_id BIGINT REFERENCES invoices(id),

  -- ⚠️ NULO no momento do envio, e é por isso que ele NÃO é NOT NULL: em
  --    api/nfse-emit.js e api/nfse-substituir.js a linha de `nfse_emissions`
  --    só é criada DEPOIS da resposta do SEFIN (o desfecho é que decide o
  --    status e o número da nota). A operação é aberta antes de transmitir e
  --    o vínculo é preenchido quando a emissão passa a existir.
  nfse_emission_id BIGINT REFERENCES nfse_emissions(id) ON DELETE SET NULL,

  -- emit | substitute | cancel | consult | sync
  -- ⚠️ Sem CHECK, seguindo o padrão do resto do schema. Vale a advertência de
  --    sempre: valor fora da lista não é rejeitado — ele some de todo filtro.
  operation_type VARCHAR(50) NOT NULL,

  -- O documento assinado que saiu daqui. NULO em operações sem envio
  -- (consulta, sincronização).
  xml_enviado TEXT,

  -- ⚠️ DUAS colunas porque são duas coisas. `xml_resposta` é o XML de verdade
  --    que o SEFIN devolveu (a NFS-e autorizada); `json_resposta` é o corpo
  --    JSON da resposta HTTP. Guardar `JSON.stringify(resposta)` na coluna de
  --    XML deixaria a tela tentando `JSON.parse` num XML — e perderia o único
  --    documento que interessa quando a nota é autorizada.
  xml_resposta TEXT,
  json_resposta JSONB,

  -- enviado | sucesso | erro
  -- 'enviado' é o estado em que a operação FICA quando a função morre entre o
  -- envio e a resposta: a nota pode ter sido autorizada no fisco sem nós
  -- sabermos. É o estado que se procura quando algo "sumiu".
  status VARCHAR(50),
  erro_mensagem TEXT,
  erro_codigo VARCHAR(50),

  ambiente SMALLINT,             -- 1 produção · 2 homologação
  http_status INT,
  dps_number INT,                -- o número consumido no fisco, quando houve

  enviado_em    TIMESTAMPTZ,
  respondido_em TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operations_invoice  ON nfse_operations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_operations_company  ON nfse_operations(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operations_status   ON nfse_operations(status);
CREATE INDEX IF NOT EXISTS idx_operations_emission ON nfse_operations(nfse_emission_id);

-- ⚠️ Esta chave NÃO protege o fluxo normal, e é importante saber disso: no
--    INSERT que abre a operação `nfse_emission_id` é NULO, e em UNIQUE do
--    Postgres NULOs são sempre distintos entre si. Ela serve ao backfill
--    abaixo e a uma reexecução dele — que é onde a duplicata realmente
--    aconteceria.
CREATE UNIQUE INDEX IF NOT EXISTS idx_operation_unique
  ON nfse_operations(nfse_emission_id, operation_type, enviado_em);


-- ===== BACKFILL do que já existe ===========================================
-- Sem isto a tela nasce vazia para as ~78 emissões já no banco, e a primeira
-- leitura é "o histórico não funciona".
--
-- ⚠️ `AT TIME ZONE 'UTC'`: as colunas de `nfse_emissions` são TIMESTAMP sem
--    fuso e foram gravadas com NOW() num servidor em UTC. Sem o cast
--    explícito, a conversão usaria o TimeZone da sessão e deslocaria toda a
--    trilha histórica em algumas horas.
--
-- ⚠️ O XML do pedido de CANCELAMENTO não é recuperável: ele nunca foi
--    guardado (api/nfse-cancel.js montava, assinava, transmitia e descartava).
--    A linha de backfill do cancelamento fica com `xml_enviado` nulo de
--    propósito — inventar um XML remontado agora seria afirmar que foi aquele
--    que saiu daqui.

-- Emissões e substituições
INSERT INTO nfse_operations (
  company_id, invoice_id, nfse_emission_id, operation_type,
  xml_enviado, xml_resposta, json_resposta,
  status, erro_mensagem, ambiente, dps_number, enviado_em, respondido_em
)
SELECT
  ne.company_id, ne.invoice_id, ne.id,
  CASE WHEN ne.substitui IS NOT NULL THEN 'substitute' ELSE 'emit' END,
  ne.xml_assinado, ne.xml_nfse, ne.json_response,
  CASE WHEN ne.status = 'erro' THEN 'erro' ELSE 'sucesso' END,
  ne.error_message, ne.ambiente, ne.dps_number,
  ne.submitted_at AT TIME ZONE 'UTC',
  COALESCE(ne.approved_at, ne.submitted_at) AT TIME ZONE 'UTC'
FROM nfse_emissions ne
WHERE ne.submitted_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM nfse_operations o
    WHERE o.nfse_emission_id = ne.id
      AND o.operation_type IN ('emit', 'substitute')
  );

-- Cancelamentos transmitidos ao fisco (o marcador é a chave que
-- api/nfse-cancel.js acrescenta ao json_response ao ter o aceite).
INSERT INTO nfse_operations (
  company_id, invoice_id, nfse_emission_id, operation_type,
  xml_resposta, json_resposta, status, ambiente, enviado_em, respondido_em
)
SELECT
  ne.company_id, ne.invoice_id, ne.id, 'cancel',
  NULL, ne.json_response -> 'cancelamento', 'sucesso', ne.ambiente,
  ne.cancelled_at AT TIME ZONE 'UTC', ne.cancelled_at AT TIME ZONE 'UTC'
FROM nfse_emissions ne
WHERE ne.cancelled_at IS NOT NULL
  AND ne.json_response ? 'cancelamento'
  AND NOT EXISTS (
    SELECT 1 FROM nfse_operations o
    WHERE o.nfse_emission_id = ne.id AND o.operation_type = 'cancel'
  );

-- Cancelamentos apenas SINCRONIZADOS (feitos no portal, declarados aqui).
INSERT INTO nfse_operations (
  company_id, invoice_id, nfse_emission_id, operation_type,
  json_resposta, status, ambiente, enviado_em, respondido_em
)
SELECT
  ne.company_id, ne.invoice_id, ne.id, 'sync',
  ne.json_response -> 'sincronizacao_cancelamento', 'sucesso', ne.ambiente,
  ne.cancelled_at AT TIME ZONE 'UTC', ne.cancelled_at AT TIME ZONE 'UTC'
FROM nfse_emissions ne
WHERE ne.json_response ? 'sincronizacao_cancelamento'
  AND NOT EXISTS (
    SELECT 1 FROM nfse_operations o
    WHERE o.nfse_emission_id = ne.id AND o.operation_type = 'sync'
  );
