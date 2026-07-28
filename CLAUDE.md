## IDENTIFICAÇÃO DO PROJETO

Este é o projeto **SITE PROJETO VICTOR — gestao_serv**.

**REGRA OBRIGATÓRIA:** Toda resposta deve começar com:
`🔷 PROJETO: SITE PROJETO VICTOR — gestao_serv`

E terminar com:
`🔷 FIM — SITE PROJETO VICTOR — gestao_serv`

Isso é necessário porque o usuário trabalha com múltiplos projetos simultaneamente.

---

# CLAUDE.md — Contexto do Projeto gestao_serv

> Estado atual do projeto (atualizado 2026-07). Documento gerado a partir da
> leitura completa de `/api`, `/src` e do banco Neon em produção.

---

## 1. Visão geral

- **Stack:** React 19 + Vite 8 + Tailwind CSS 3 (tema escuro) no frontend;
  Vercel Serverless Functions (ESM) em `/api/` no backend.
- **Banco:** Neon PostgreSQL (projeto `gestao_serv`), acessado via
  `@neondatabase/serverless`. Conexão por `process.env.DATABASE_URL`.
- **Repositório:** GitHub `victorfgm0190/gestao_serv`, branch principal `main`.
- **Deploy:** Vercel (Pro). Push em `main` → deploy automático.
- **Domínios:** `gestao-serv.vercel.app` / `lumendev.com.br`.
- **Roteamento SPA:** `vercel.json` reescreve tudo para `/index.html`.
- **Cron:** `vercel.json` agenda `/api/cron-sync` a cada 10 min (`*/10 * * * *`).

### 🔒 Regra crítica
**O Neon NUNCA é acessado direto do browser.** Todo acesso ao banco passa por
endpoints em `/api/`. Não criar código no frontend que fale com o Neon.

### Dependências principais
`@neondatabase/serverless`, `exceljs` (export Excel), `imap-simple` +
`mailparser` (ingestão de e-mail), `react-router-dom` 7, `dotenv`.
`xlsx` também está presente. Lint: `oxlint`.

---

## 2. Empresas e clientes

### Empresas (tabela `companies`)
- **Lumen** — `company_id = 1` (cor `#3B82F6`)
- **Imperium** — `company_id = 2` (cor `#8B5CF6`)

O switcher de empresa fica no `Layout.jsx` (lista fixa no frontend). Toda tela
recebe `activeCompany` via `useOutletContext()`.

### Clientes Lumen (company_id = 1)
| id | Nome | Domínio |
|----|------|---------|
| 7  | Pharmalog/ANB | — |
| 8  | SteelDek | — |
| 9  | Eurofral | — |
| 10 | Nutribom | — |
| 11 | LecaCau | — |
| 12 | Hidronorth | — |
| 13 | Bokada | — |
| 14 | Enpla (Atria) | — |
| 15 | Minas Distribuicao | — |

### Clientes Imperium (company_id = 2)
| id | Nome | Domínio(s) / regra de e-mail |
|----|------|------------------------------|
| 1  | Braga | bragacont.com.br |
| 2  | Dental | higimaster.com.br, dentalclean.com.br |
| 3  | The Best Açaí | ogrupothebest.com |
| 4  | Ucelo | ucelo.com.br + e-mail `no_reply@alerts.runrun.it` |
| 5  | Bokada | bokada.com.br |
| 6  | Sunstar | sunstar.com |

> Regras de classificação de e-mail vivem na tabela `email_rules` (só há regras
> cadastradas para Imperium). Ver seção 4 (`email-rules.js`, `ingest-email.js`).

---

## 3. Banco de dados — tabelas, colunas e tipos

Consultar sempre que necessário:
```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
```

### `companies`
`id` int · `name` varchar · `color` varchar · `created_at` timestamp

### `clients`
`id` int · `company_id` int · `name` varchar · `email_domain` varchar · `created_at` timestamp

### `projects`
`id` int · `company_id` int · `client_id` int · `name` varchar · `created_at` timestamp
> Legado (modelo antigo por projeto). O sistema hoje trabalha por cliente.

### `email_rules`
`id` int · `company_id` int · `rule_type` varchar (`domain`|`email`|`keyword`) ·
`rule_value` varchar · `target_client_id` int · `target_project_id` int · `created_at` timestamp

### `demands`
`id` int · `company_id` int · `client_id` int · `project_id` int ·
`sender_email` varchar · `sender_name` varchar · `subject` varchar · `body` text ·
`received_at` timestamp · `status` varchar · `origin` varchar (`email`|`manual`) · `created_at` timestamp

### `financial_rules`
`id` int · `project_id` int (legado) · `client_id` int · `hourly_rate` numeric ·
`has_tax` bool · `tax_percentage` numeric · `victor_fixed_per_hour` numeric ·
`has_fuel` bool · `fuel_value` numeric · `remainder_victor_pct` numeric ·
`remainder_fabricio_pct` numeric · `created_at` timestamp

### `contracts`
`id` int · `company_id` int · `client_id` int · `name` varchar ·
`billing_type` varchar (`contract`|`mensal`|`hora`|`dia`) · `contract_value` numeric ·
`victor_fixed` numeric · `remainder_victor_pct` numeric · `remainder_fabricio_pct` numeric ·
`has_tax` bool · `tax_percentage` numeric · `is_active` bool · `notes` text · `created_at` timestamp ·
`deslocamento_tipo` varchar (`nao_cobrado`|`hora`|`hora_despesas`) · `deslocamento_valor_hora` numeric ·
`financial_rule_id` int · `tax_client_percent` numeric · `require_nf` bool NOT NULL default true

### `contract_months`
`id` int · `contract_id` int · `company_id` int · `client_id` int · `month` int · `year` int ·
`invoice_value` numeric · `contract_value` numeric · `victor_share` numeric · `fabricio_share` numeric ·
`tax_amount` numeric · `net_value` numeric · `notes` text · `created_at` timestamp

### `time_entries`
`id` int · `company_id` int · `client_id` int · `project_id` int · `entry_date` date ·
`description` text · `hours` numeric · `hourly_rate` numeric · `gross_value` numeric ·
`tax_amount` numeric · `net_value` numeric · `victor_share` numeric · `fabricio_share` numeric ·
`fuel_cost` numeric · `notes` text · `created_at` timestamp ·
`hora_inicial` varchar · `intervalo_inicio` varchar · `intervalo_fim` varchar · `hora_final` varchar ·
`horas_deslocamento` numeric · `valor_deslocamento` numeric · `despesas_deslocamento` numeric · `contract_id` int

### `invoices`
`id` int · `company_id` int · `client_id` int · `contract_id` int · `month` int · `year` int ·
`invoice_number` varchar · `invoice_value` numeric (NF) · `contract_value` numeric (base/bruto) ·
`tax_amount` numeric (imposto real) · `victor_service` numeric · `victor_profit` numeric ·
`victor_tax_diff` numeric (diff NF → Victor) · `victor_total` numeric · `fabricio_total` numeric ·
`billing_type` varchar (`contract`|`agenda`) · `time_entry_ids` int[] · `receivable_id` int ·
`status` varchar (`pendente`|`recebido`) · `notes` text · `created_at` timestamp ·
`require_nf` bool NOT NULL default true

### `receivables`
`id` int · `company_id` int · `client_id` int · `month` int · `year` int · `description` varchar ·
`amount` numeric · `paid_amount` numeric · `paid_at` date · `status` varchar · `notes` text ·
`created_at` timestamp · `origin` varchar (`faturamento`|null) · `invoice_id` int

### `payables_fabricio`
`id` int · `company_id` int · `client_id` int · `month` int · `year` int · `description` varchar ·
`amount` numeric · `paid_amount` numeric · `paid_at` date · `payment_method` varchar ·
`is_compensation` bool · `compensation_notes` text · `status` varchar · `notes` text ·
`created_at` timestamp · `origin` varchar · `invoice_id` int

### `payables_victor`
`id` int · `company_id` int · `client_id` int · `month` int · `year` int · `description` varchar ·
`service_amount` numeric · `profit_amount` numeric · `total_amount` numeric · `paid_amount` numeric ·
`paid_at` date · `status` varchar · `notes` text · `created_at` timestamp · `origin` varchar · `invoice_id` int

### `payable_payments` (múltiplos pagamentos por payable)
`id` int · `payable_type` varchar (`victor`|`fabricio`) · `payable_id` int · `amount` numeric ·
`paid_at` date · `notes` text · `created_at` timestamp

### `company_settings` (configuração fiscal por empresa)
`id` int · `company_id` int · `regime` varchar (`simples_iii`|`simples_v`|`lucro_presumido`) ·
`faturamento_medio_mensal` numeric · `salarios_mensal` numeric · `iss_percent` numeric ·
`prolabore_percentual` numeric (default 0.28) · `prolabore_minimo` numeric (default 1621.00) ·
`honorarios_mensal` numeric (default 150.00) · `updated_at` timestamp
> `UNIQUE (company_id)`. Escrita **só** por `api/settings.js` — não criar endpoint
> paralelo para os mesmos campos. Os três parâmetros alimentam a apuração de
> `api/fiscal-obligations.js`; o piso acompanha o salário mínimo e muda todo janeiro.
>
> ⚠️ **Não existe coluna de pró-labore.** Ele é **derivado**:
> `proLaboreDoMes(faturamento, settings) = max(faturamento × percentual, piso)`,
> em `lib/taxCalc.js`. A coluna `prolabore_mensal` existiu como cache desse cálculo
> e foi removida em 2026-07-25 — três lugares a recalculavam de formas diferentes
> (Billing com 28% fixo sem piso, apuração com os parâmetros, previsão lendo a coluna)
> e os números divergiam. Ao mexer em pró-labore, use a função, não recrie a coluna.

### Apuração fiscal (DAS/INSS/Honorários) — criadas 2026-07-25

Separam três eventos que antes viviam colapsados em `payable_payments.notes`:
**apurar a obrigação**, **ratear entre clientes** e **quitar a guia**.
API em `api/fiscal-obligations.js` + `api/fiscal-payments.js`; tela em `/fiscal`.

#### `fiscal_obligations` — o que a empresa deve, por competência
`id` int · `company_id` int · `month` int · `year` int ·
`kind` varchar (`das`|`inss`|`honorarios`|`pro_labore`|`escritorio`) ·
`amount_estimated` numeric (apuração interna, via `taxCalc.js`) ·
`amount_actual` numeric (valor da guia oficial) · `base_amount` numeric (faturamento) ·
`rate_used` numeric (alíquota efetiva) · `calc_snapshot` jsonb (`{rbt12, fatorR, anexo, prolabore}` congelado p/ auditoria) ·
`due_date` date · `doc_number` varchar (nº da guia) · `paid_amount` numeric ·
`status` varchar (`previsto`|`apurado`|`parcial`|`pago`) · `notes` text ·
`created_at` timestamp · `updated_at` timestamp
> `UNIQUE (company_id, month, year, kind)` — uma obrigação por tipo/competência.
> Substituiu `victor_reserves` (4 categorias, sem cliente e sem ciclo de vida), migrada
> e removida em 2026-07-25. Os `kind` `pro_labore` e `escritorio` vieram de lá: são
> lançados à mão e o `?action=apurar` não os recalcula, então sobrevivem a reapurações.

#### `fiscal_payments` — quitação da guia (múltiplos pagamentos)
`id` int · `obligation_id` int **FK → fiscal_obligations ON DELETE CASCADE** ·
`amount` numeric · `paid_at` date · `method` varchar (`boleto`|`pix`|`darf`|`abatimento`) ·
`notes` text · `created_at` timestamp
> Espelha o padrão de `payable_payments`. `paid_at` aqui é quando a **guia** foi paga —
> distinto de `payable_payments.paid_at`, que é quando se descontou dos clientes.

#### `fiscal_allocations` — rateio por cliente
`id` int · `obligation_id` int **FK → fiscal_obligations ON DELETE CASCADE** ·
`client_id` int · `invoice_id` int (âncora da base) · `payable_victor_id` int ·
`payable_payment_id` int **FK → payable_payments ON DELETE CASCADE** ·
`amount` numeric (rateado p/ o cliente) · `provisioned` numeric (`invoices.tax_amount` original) ·
`adjustment` numeric (`amount - provisioned`, a reconciliação) ·
`from_service` numeric · `from_profit` numeric ·
`basis` varchar (`proporcional_nf`) · `created_at` timestamp
> Índice `idx_fiscal_allocations_client_obligation (client_id, obligation_id)`.
> Duas origens de linha: `basis='proporcional_nf'` (rateio criado pelo `?action=apurar`,
> sem payable) e `basis='consumo_payable'` (criada pelo `?action=distribuir`, com
> `payable_victor_id` + `payable_payment_id` preenchidos). O `payable_payment_id` é o
> que permite estornar **só** os pagamentos daquela distribuição.
> Substitui o parse de
> `payable_payments.notes` (`parseNotesToAmounts`/`proportionalCats` em `Financial.jsx`),
> que hoje infere o rateio de uma string no browser.
> `from_service`/`from_profit` passaram a ser gravados pelo `?action=recalcular`: dizem
> de onde saiu o imposto daquele cliente (o lucro absorve antes do serviço).

### Redistribuição fiscal (`lib/fiscal-redistribution.js`) — 2026-07-26

A fatura desconta uma **provisão** de imposto (`contracts.tax_percentage`, hoje 7%);
o custo **real** só se conhece na apuração (alíquota efetiva do Simples + INSS +
honorários, rateados por cliente). A diferença — que já era gravada em
`fiscal_allocations.adjustment` e **nunca lida por ninguém** — agora volta para o que
o Victor recebe, em três etapas que leem a mesma base:

| Etapa | Gatilho | Imposto real vem de |
|-------|---------|---------------------|
| 1 | fatura emitida | `invoices.tax_amount` (provisão) — é o baseline |
| 2 | `?action=apurar` | rateio de `amount_estimated` |
| 3 | `?action=corrigir-escritorio` | rateio de `amount_actual` (guia oficial) |

Regras do motor:
- **Cascata:** o lucro do Victor absorve primeiro, o serviço só depois; o que não couber
  vira `nao_coberto` (sai do capital próprio, nunca vira payable negativo).
- **Idempotente:** o delta é sempre medido contra o baseline da FATURA, nunca contra o
  payable já ajustado — recalcular duas vezes não desconta duas vezes.
- **Só Victor.** `fabricio_total` não é tocado: o percentual dele foi acordado na fatura,
  e o DAS/INSS sai do CNPJ do Victor. Mudar isso é decisão de negócio, não de código.
- **Prévia por padrão.** Nada financeiro é gravado sem `aplicar: true`; payable com
  pagamento já registrado trava a aplicação (409) até ser estornado.

### `monthly_closings` / `payments`
Tabelas do fechamento mensal (modelo antigo). Pouco/ não usadas pelas telas atuais.

---

## 4. APIs ativas (`/api/`)

Todas exportam um `handler(req, res)` default e instanciam
`neon(process.env.DATABASE_URL)`.

### 🔒 Autenticação (obrigatória em endpoints novos)
Todo endpoint começa com `if (!requireAuth(req, res)) return` (de `lib/auth.js`).
Exceções, cada uma com proteção própria:
- `login.js` — público (é o endpoint de entrada).
- `cron-sync.js` — `Bearer $CRON_SECRET` ou header `x-vercel-cron`.
- `users.js` — `requireMaster` (só o ADMIN_USER).
- `migrate-*.js`, `recalc-*.js` — `requireAdmin` (`Bearer $ADMIN_SECRET`).

**Ao criar um endpoint novo, adicione o `requireAuth`** — sem ele a rota nasce
pública na internet.

Variáveis de ambiente exigidas: `JWT_SECRET` (≥16 chars), `ADMIN_USER`,
`ADMIN_PASS`. Sem `JWT_SECRET` a API inteira responde 503 (falha fechada).

No frontend, o token é anexado por um interceptor global de `fetch`
(`src/lib/session.js`), instalado em `main.jsx` — não é preciso passar header
em cada chamada.

| Arquivo | Métodos | O que faz |
|---------|---------|-----------|
| `clients.js` | GET/POST/DELETE | Lista clientes por `company_id`; cria/exclui cliente. |
| `email-rules.js` | GET/POST/DELETE | CRUD de regras de classificação de e-mail (por `company_id`). |
| `demands.js` | GET/POST/PATCH | Lista demandas por empresa; cria demanda manual; atualiza `status`. |
| `ingest-email.js` | POST | Conecta IMAP (Imperium), lê UNSEEN, classifica por regra e insere em `demands`. `company_id=2` apenas. |
| `cron-sync.js` | GET | Igual ao ingest, protegido por `CRON_SECRET`/header `x-vercel-cron`. Chamado pelo cron a cada 10 min. |
| `reclassify-demands.js` | POST | Reaplica regras de e-mail em demandas sem `client_id`. |
| `financial-rules.js` | GET/POST/PUT/DELETE | CRUD de regras financeiras por cliente (`hourly_rate`, `victor_fixed_per_hour`, imposto, split, combustível). |
| `contracts.js` | GET/POST/PATCH/DELETE | CRUD de contratos. Campos: `billing_type`, `contract_value`, `victor_fixed`, split, `has_tax`, `tax_percentage`, **`tax_client_percent`**, deslocamento, `financial_rule_id`. |
| `contract-months.js` | GET/POST/DELETE | Lançamentos mensais de contrato (calculador **legado**, ver seção 6/pendências). |
| `time-entries.js` | GET/POST/PUT/DELETE | Apontamento de horas. Calcula horas a partir de `hora_inicial/intervalo/hora_final`, aplica regra financeira + contrato (deslocamento) e grava split. |
| `invoices.js` | GET/POST/PATCH/PUT/DELETE | **Coração do faturamento.** Gera fatura (contrato ou agenda), cria `receivable`, e ao receber propaga `payables`. Calculador unificado (seção 6). |
| `receivables.js` | GET/POST/PATCH/DELETE | Contas a receber. PATCH `pago` gera payables da fatura; PATCH `estorno` reverte. Protege `origin='faturamento'`. |
| `payables-fabricio.js` | GET/POST/PATCH/DELETE | Contas a pagar Fabrício. Valor no campo `amount`. Traz `payments[]`. |
| `payables-victor.js` | GET/POST/PATCH/DELETE | Contas a pagar Victor. Valor em `total_amount` (`service_amount`+`profit_amount`). Traz `payments[]`. |
| `payable-payments.js` | GET/POST/DELETE | Múltiplos pagamentos por payable; recalcula `status`/`paid_amount` do pai (pendente/parcial/pago). |
| `fiscal-obligations.js` | GET/POST `?action=apurar\|recalcular`/PATCH `?action=lancar-guia\|corrigir-escritorio` | **Apuração fiscal.** Calcula RBT12 e folha dos 12 meses (proporcionalizados enquanto houver < 12 meses), Fator R, pró-labore (`max(28% do faturamento, R$ 1.621)`), DAS, INSS e honorários; grava `fiscal_obligations` e rateia por cliente em `fiscal_allocations` (proporcional à NF). Idempotente: reapurar substitui o rateio. GET lê o apurado do mês/ano com as alocações. `PATCH ?action=lancar-guia` grava `amount_actual`/`due_date`/`doc_number` quando a guia oficial chega (só sobrescreve os campos enviados); `amount_actual: null` desfaz o lançamento — e **refaz o rateio** com o valor real. `POST ?action=recalcular` é a **redistribuição**: compara a provisão de imposto da fatura (`invoices.tax_amount`) com o custo fiscal real rateado e devolve o antes/depois do que o Victor recebe; é **prévia por padrão** e só grava com `aplicar: true`. `PATCH ?action=corrigir-escritorio` = lançar guia + rerateio + prévia, numa chamada. |
| `fiscal-payments.js` | GET/POST `?action=pagar`/DELETE | **Quitação da guia.** Múltiplos pagamentos por obrigação. `paid_amount`/`status` da obrigação são sempre **re-somados** de `fiscal_payments` (nunca incrementados), em transação com o INSERT/DELETE. Estornar tudo devolve a obrigação a `apurado` (se a guia oficial já chegou) ou `previsto`. Usa o `PAID_EPSILON` de `lib/payment-status.js`. |
| `export-os.js` | GET | Gera Excel (ExcelJS) das horas do mês, opcionalmente filtrado por `client_id`. |
| `admin.js` | POST `?action=estornar-periodo` | **Operações em massa** (`requireAdmin`, Bearer `$ADMIN_SECRET`). Estorna uma competência inteira na ordem inversa da criação: apaga a apuração fiscal (CASCADE leva pagamentos e alocações), apaga os payables com `origin='faturamento'` e seus pagamentos, recompõe o saldo de payables de outros meses que a distribuição havia consumido, e devolve recebíveis e faturas a `pendente` — prontos para refaturar. **`dry_run: true` é o padrão**; sem `company_id`+`year`+`month_from`+`month_to` explícitos responde 400 (operação destrutiva não tem valor padrão). Payables lançados à mão (`origin IS NULL`) são preservados. |

### Endpoints de setup/migração one-off (standalone)
`setup-db.js`, `setup-clients.js`, `migrate-financial-rules.js`,
`migrate-time-entries.js`, `migrate-invoices.js`, `migrate-finance-origin.js`,
`migrate-contracts-deslocamento.js`, `migrate-payable-payments.js`.
São endpoints temporários já executados em produção — não fazem parte do fluxo normal.

---

## 5. Telas (`/src/pages/`)

Rotas definidas em `src/main.jsx` dentro de `<Layout>` (sidebar). `App.jsx` é vazio.

| Rota | Página | Funcionalidades | APIs usadas |
|------|--------|-----------------|-------------|
| `/` | `Dashboard.jsx` | Visão consolidada das **duas** empresas: demandas abertas, a receber/pago, horas do mês. | demands, receivables, payables-*, time-entries |
| `/demands` | `Demands.jsx` | Lista/gestão de demandas; sincronizar e-mail (ingest); criar manual; mudar status. | demands, ingest-email, reclassify-demands |
| `/email-rules` | `EmailRules.jsx` | CRUD de regras de classificação de e-mail. | email-rules, clients |
| `/time-entries` | `TimeEntries.jsx` | Apontamento de horas (por horário + intervalo + deslocamento). Filtros pill mês/ano/cliente. Export Excel. | time-entries, clients, financial-rules, contracts, export-os |
| `/financial-rules` | `FinancialRules.jsx` | CRUD de regras financeiras por cliente; também cadastra clientes. | financial-rules, clients |
| `/contracts` | `Contracts.jsx` | CRUD de contratos (vinculados a uma regra financeira). Cálculo bidirecional de imposto do cliente (NF ↔ %). Lançamentos mensais. | contracts, clients, contract-months, financial-rules |
| `/financial` | `Financial.jsx` | 4 abas: A Receber, Pagar Fab, Pagar Victor, Histórico. Filtro pill de mês + status. Múltiplos pagamentos, estorno, "Receber" (distribui entre payables do Victor). Oculta registros R$ 0,00 nas abas de Pagar. No card de Previsão de Impostos: memória de cálculo e **✏️ Editar valores** (lança as guias reais da competência e redistribui). | receivables, payables-*, payable-payments, clients, fiscal-obligations |
| `/fiscal` | `FiscalObligations.jsx` | **Apuração fiscal.** Cards de DAS/INSS/Honorários (estimado × guia × pago), lançamento da guia oficial, múltiplos pagamentos com estorno, tabela de custo por cliente, painel do `calc_snapshot` (RBT12, Fator R, anexo, pró-labore) e abatimento nos payables do Victor. | fiscal-obligations, fiscal-payments |
| `/billing` | `Billing.jsx` | Geração de fatura por Contrato ou por Agenda (horas). Seção "Impostos" editável (imposto real + imposto do cliente, NF bidirecional) e demonstrativo. Filtros pill mês/cliente. | invoices, contracts, clients, time-entries, financial-rules |

Componentes: `src/components/Layout.jsx` (sidebar + switcher de empresa).
Hook: `src/hooks/useNotifications` (notificações; usado no Layout).

---

## 6. Regras de negócio financeiro

### Memória de cálculo da apuração — 2026-07-27

O GET de `/api/fiscal-obligations` devolve `calculo`: o passo a passo de faturamento →
base tributável → RBT12 → Fator R → anexo/alíquota efetiva → DAS, INSS e escritório, cada
passo com a fórmula em texto e o valor. A tela `/fiscal` abre no botão **💡 Como chegamos
aqui?**.

O mesmo painel abre no card **📊 Previsão de Impostos** da aba Pagar Victor
(`/financial`): é o componente `src/components/MemoriaCalculo.jsx`, compartilhado pelas duas
telas, alimentado pelo mesmo `calculo`. Lá a memória chega de carona no `fetchReserves`, que
já consulta esse endpoint — o botão só alterna, e o fetch próprio é o caminho de exceção.
Como o card calcula por outra base (RBT12 estimada), o painel abre com um aviso comparando os
dois totais quando eles divergem, em vez de deixar a diferença para o usuário descobrir.

O ponto do desenho: o núcleo da apuração foi extraído para `calcularApuracao()` e o
`?action=apurar` e a memória chamam **a mesma função** — a memória não recalcula nada, só
traduz. Reimplementar as fórmulas do lado da explicação repetiria a história do pró-labore
(três donos, três números), com o agravante de a explicação poder divergir do valor que ela
explica. `faixaFor`/`tabelaDoAnexo` passaram a ser exportadas de `lib/taxCalc.js` pelo mesmo
motivo: a faixa do Simples é mostrada, não redigitada.

Detalhes que a memória expõe de propósito:
- `gravado.divergente` — o recálculo de agora não bate com `amount_estimated`. Não é erro:
  é o mês ter mudado (NF emitida/editada/excluída) depois da apuração. Pede reapuração.
- `apuravel: false` — sem faturamento tributável o `apurar` responde 404 e nada é gravado;
  a conta continua sendo exibida, mas marcada como hipotética (o piso do pró-labore faria
  aparecer um INSS de R$ 178,31 num mês sem faturamento nenhum).
- `lancados_a_mao` — `pro_labore` e `escritorio` não saem de fórmula; ficam à parte para o
  total da memória fechar com os cards sem fingir que foram calculados.
- ⚠️ O card "Previsão de Impostos" do `/financial` ainda calcula por conta própria (ver
  abaixo) e pode divergir. O aviso do painel diz **qual** das duas causas está em jogo:
  base diferente (mês de referência × data de emissão) ou RBT12 diferente.

As strings de fórmula são formatadas por `brl`/`pctStr` locais, sem `Intl`: num runtime sem
ICU completo, `toLocaleString('pt-BR')` cai em silêncio para o formato inglês.

### Lançar as guias do contador pelo `/financial` — 2026-07-28

O card **📊 Previsão de Impostos** (aba Pagar Victor) ganhou **✏️ Editar valores**: um modal
que lança de uma vez os valores reais de todas as obrigações da competência, sem precisar ir
ao `/fiscal` card a card. Campo em branco = remover o lançamento e voltar a valer o apurado.

Ordem das chamadas, que é o ponto do desenho:
1. um `PATCH ?action=corrigir-escritorio` **por obrigação alterada**, com `aplicar: false` —
   grava `amount_actual` e refaz o rateio por cliente;
2. **um** `POST ?action=recalcular` com `aplicar: true`, ao final — é ele que reescreve os
   payables do Victor.

Aplicar a cada guia também daria o número certo (o motor mede sempre contra o baseline da
FATURA, não contra o payable já ajustado), mas reescreveria os payables N vezes e o
"antes/depois" exibido seria o da última guia, não o da correção inteira. O checkbox
"Atualizar os lançamentos do Victor" vem marcado; desmarcá-lo grava só as guias e deixa a
prévia para o `/fiscal`.

O botão fica desabilitado sem apuração no mês: a guia é lançada **sobre** uma obrigação
existente, e é ela que carrega o `obligation_id`. Não há endpoint para criar obrigação à mão
— `pro_labore` e `escritorio` só existem porque vieram da migração de `victor_reserves`, e
não existe `kind` de "despesas".

O card em si continua sendo **previsão** — ele estima a partir do faturamento do mês e não
muda quando a guia chega. Por isso o bloco **📄 Guias oficiais lançadas** aparece embaixo
quando há `amount_actual`: sem ele a leitura é de que salvar não fez efeito. O que muda de
verdade é o card de Reservas, a memória de cálculo e a lista de Pagar Victor.

### Contrato sem NF (`require_nf = false`) — 2026-07-27

Cliente que não pede nota (hoje só a **Minas Distribuicao**, contrato 4) fatura, recebe e
gera payables como qualquer outro — mas **não existe para o fisco**. A fatura herda
`require_nf` do contrato **na emissão** e o congela: é dado de competência, e desligar a NF
de um contrato hoje não pode reescrever notas já emitidas e apuradas.

Fica de fora de tudo que é fiscal, sempre pelo mesmo predicado (`temNf`, só `false` exclui —
coluna nula é tributável):
- `apurar` — faturamento do mês, RBT12, folha do Fator R e rateio por cliente;
- `faturasDoMes({ comNf })` — a base do rerateio (`lancar-guia`, `corrigir-escritorio`) e da
  redistribuição, para que o rateio enxergue exatamente a base que gerou a obrigação;
- previsão de impostos (`Financial.jsx`) e `faturamento_medio_mensal` (`Billing.jsx`).

`?action=distribuir` **não** foi filtrado de propósito: ele consome saldo dos payables do
Victor para quitar a guia, o que é origem de caixa, não incidência de tributo — o payable da
Minas continua elegível. Mudar isso é decisão de negócio.

A tela `/fiscal` mostra o que ficou de fora (`sem_nf` no GET), para que um DAS menor que o
faturamento do mês não pareça erro de apuração.

### Dois tipos de imposto (distintos!)
1. **`tax_percentage`** — imposto **real** pago por Victor (ex.: 7%).
   **Desconta do bruto antes de dividir** entre Victor e Fabrício.
2. **`tax_client_percent`** — imposto **cobrado do cliente** por fora (ex.: 9,20%).
   **Majora o valor da NF** (gross-up). A diferença NF−base vai 100% para Victor.

### Contrato fixo (`billing_type = 'contract'` ou `'mensal'`)
```
base   = contract_value
NF     = tax_client_percent > 0 ? base / (1 - tax_client_percent/100) : base
diffNF = NF - base                              → 100% Victor
imposto_real = NF × tax_percentage/100          (informativo; sai da parte do Victor)
Victor   = victor_fixed + (base - victor_fixed) × victor_pct/100 + diffNF
Fabrício = (base - victor_fixed) × fabricio_pct/100
```

### Contrato por hora (`billing_type = 'hora'` / fatura `agenda`)
```
bruto   = hourly_rate × horas
imposto = bruto × tax_percentage/100
liquido = bruto - imposto
Victor fixo = victor_fixed_per_hour × horas
restante    = liquido - Victor fixo
Victor lucro = restante × victor_pct/100
Fabrício     = restante × fabricio_pct/100
NF      = tax_client_percent > 0 ? bruto / (1 - tax_client_percent/100) : bruto
diffNF  = NF - bruto                             → 100% Victor
Victor total = Victor fixo + Victor lucro + diffNF
```

O calculador está unificado em `api/invoices.js` (`calcContrato` e `calcAgenda`).
Ele recebe do frontend `tax_percentage_used` e `tax_client_percent_used` (percentuais
efetivamente usados na fatura, que podem diferir dos cadastrados no contrato — o
frontend oferece atualizar o contrato quando o valor digitado é maior).

### Split Victor/Fabrício
Definido por `remainder_victor_pct` / `remainder_fabricio_pct` (na regra financeira
e/ou no contrato). Padrão 50/50. Alguns clientes são 100/0 (só Victor).

### Deslocamento (por contrato)
`deslocamento_tipo`: `nao_cobrado` | `hora` | `hora_despesas`.
As **horas de deslocamento faturadas vão 100% para Victor** (fora do split com
Fabrício). Lógica em `api/time-entries.js` (`calcular`). Configurável em `deslocamento_valor_hora`.

### Fluxo de faturamento
1. Gera fatura (`invoices` POST) → cria `receivable` automaticamente (`origin='faturamento'`).
2. Marca receber como pago → cria `payables_victor` + `payables_fabricio` (`origin='faturamento'`).
3. **Registros com `origin='faturamento'` são protegidos** — não deletar direto
   (retorna 403). Para remover, **estornar a fatura/recebimento**.
4. Estorno verifica se algum payable já foi pago; se sim, bloqueia.

### Múltiplos pagamentos
`payable_payments` guarda cada pagamento; `payable-payments.js` recalcula o status
do pai: soma 0 → `pendente`; 0 < soma < total → `parcial`; soma ≥ total → `pago`.

---

## 7. Contratos existentes no banco

```sql
SELECT c.id, cl.name AS cliente, c.name AS contrato, c.billing_type,
       c.financial_rule_id, c.tax_client_percent
FROM contracts c JOIN clients cl ON cl.id = c.client_id ORDER BY c.id;
```

| id | Cliente | Contrato | billing_type | rule_id | tax_client_% | tax_% | has_tax |
|----|---------|----------|--------------|---------|--------------|-------|---------|
| 1 | SteelDek | Stelldek | contract | 6 | 9,20 | 7 | sim |
| 2 | Pharmalog/ANB | PHARMALOG HORA | hora | 5 | 0 | 7 | sim |
| 3 | Eurofral | EUROFRAL POR HORA | hora | 7 | 0 | 7 | sim |
| 4 | Minas Distribuicao | Minas(Borsato)115 | hora | 10 | 0 | 7 | sim |
| 5 | Bokada | Bokada(Renato) 85 | hora | 8 | 0 | 7 | sim |
| 6 | Enpla (Atria) | Enpla hora 90 | hora | 9 | 0 | 7 | sim |

### Regras financeiras vinculadas (`financial_rules`)
| id | Cliente | hourly_rate | victor_fixed/h | tax_% | split V/F |
|----|---------|-------------|----------------|-------|-----------|
| 5 | Pharmalog/ANB | 115,00 | 100,00 | 7 | 50/50 |
| 6 | SteelDek | 1600,00 | 800,00 | — | 50/50 |
| 7 | Eurofral | 156,00 | 100,00 | 7 | 50/50 |
| 8 | Bokada | 85,00 | 85,00 | 7 | 100/0 |
| 9 | Enpla (Atria) | 90,00 | 90,00 | 7 | 100/0 |
| 10 | Minas Distribuicao | 115,00 | 115,00 | 7 | 100/0 |

> No contrato fixo do SteelDek, `hourly_rate=1600` é reaproveitado como valor do
> contrato e `victor_fixed_per_hour=800` como o fixo do Victor.

---

## 8. Workflow de desenvolvimento

1. **Victor descreve** o que precisa (em linguagem natural).
2. **Claude.ai** transforma em um prompt técnico detalhado.
3. **Claude Code** implementa no diretório `C:\projetos\gestao_serv`.
4. **Vercel** faz deploy automático ao dar push em `main`.

Convenções dos prompts:
- Todo prompt **começa com o aviso do diretório** (`C:\projetos\gestao_serv`) e o
  contexto de stack.
- Todo prompt **termina com:** "Build, commit e push ao finalizar."
- Confirmar lógica financeira com Victor antes de implementar mudanças de cálculo.

Ambiente (Windows):
- Shell primário PowerShell; Bash (POSIX) também disponível.
- Build: `npm run build` (Vite). Lint: `npm run lint` (oxlint).
- Migrações de banco: criar endpoint temporário em `/api/`, rodar contra o
  `DATABASE_URL` do `.env`, confirmar e remover — sem commitar a migração.

---

### Estorno e o abatimento fiscal (`lib/fiscal-unlink.js`) — 2026-07-26

`?action=distribuir` quita obrigações consumindo saldo dos payables do Victor, deixando
três registros amarrados: `payable_payments` (o dinheiro saindo), `fiscal_allocations`
(`basis='consumo_payable'`, o elo) e `fiscal_payments` (`method='abatimento'`, a quitação).

Os estornos do lado do faturamento apagavam só o primeiro. A FK
`fiscal_allocations.payable_payment_id ON DELETE CASCADE` levava o segundo junto, mas o
**terceiro sobrevivia** e ninguém recalculava a obrigação: o DAS seguia marcado como pago
enquanto o dinheiro voltava para o Victor — o mesmo valor contado duas vezes. E sem
alocação com `payable_victor_id`, o "Estornar abatimento" da tela `/fiscal` passava a
dizer "não foi distribuído", deixando o estado sem conserto pela interface.

`desfazerAbatimentoFiscal(sql, payableIds)` é chamado por `payables-victor.js`,
`receivables.js` e `invoices.js` **antes** de apagarem qualquer coisa. A unidade de
reversão é o **mês**, não o payable: a distribuição é um pool rateado entre vários
payables e o `?action=distribuir` já trata o mês como atômico.
`payables-fabricio.js` não chama — Fabrício não participa da distribuição fiscal
(`candidatosDisponiveis` só lê `payables_victor`).

Junto foi corrigido em `invoices.js`: o estorno apagava os payables **sem** apagar antes
os `payable_payments`, e `payable_payments.payable_id` não tem FK — os pagamentos ficavam
órfãos. A trava existente só recusa payable com status `pago`, então um payable
parcialmente consumido pela distribuição passava direto.

### ⚠️ Não existe status `estornado`
Os vocabulários reais são: `invoices` pendente|recebido · `receivables` pendente|pago ·
`payables_*` pendente|parcial|pago · `fiscal_obligations` previsto|apurado|parcial|pago.
Gravar um status fora dessa lista não arquiva o registro — ele sai dos filtros de todas
as telas, escapa do CASE de `recalcularObrigacao()` e do `status IN ('pendente','parcial')`
de `candidatosDisponiveis()`, e a cascata de consumo passa a ignorá-lo em silêncio.
Estorno é reversão de verdade (apagar o que a fatura gerou e voltar a `pendente`), não
marcação — e é semanticamente correto: estornar um payable não o mata, devolve-o a
`pendente`, porque o valor continua devido; estornar uma fatura a devolve a `pendente`
justamente para poder ser refaturada.

A **auditoria** que se quer de um "estornado" vive em `notes`, preservando o conteúdo
anterior em vez de sobrescrevê-lo:
```sql
notes = COALESCE(NULLIF(notes,'') || ' | ', '') || 'Estornado em ' ||
        to_char(now() AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI') ||
        COALESCE(' (' || ${motivo}::text || ')', '')
```
Fica repetido em cada rota porque o driver do Neon não compõe fragmentos: uma tagged
template aninhada viraria parâmetro, não SQL. As rotas aceitam `motivo` opcional no body.
Ver `api/admin.js`, `lib/fiscal-unlink.js` e os PATCH `estorno`/`estornar` de
`invoices.js`, `receivables.js`, `payables-victor.js` e `payables-fabricio.js`.

## 9. APIs legadas / mortas

- **`finance.js`** — ⚠️ LEGADO/MORTO. Não usar, não modificar.
- `contract-months.js` — calculador **antigo** (não considera `tax_client_percent`
  nem os dois tipos de imposto de forma unificada). Ver pendências.
- Tabela `projects` e `financial_rules.project_id` — modelo antigo por projeto,
  substituído por cliente.
- Tabelas `monthly_closings` / `payments` — fechamento mensal antigo.

---

## 10. Pendências conhecidas

- [x] 🐞 **Fator R travava no Anexo V** — corrigido com epsilon. `Billing.jsx:202`
      grava `prolabore = faturamento × 0.28`, exatamente na fronteira; em ponto
      flutuante `1316.35 / 4701.25 = 0.27999999999999997`, e o `fatorR >= 0.28`
      literal dava **false**, caindo no Anexo V (15,5%) em vez do III (6%).
      Agora `fatorR >= FATOR_R_MIN - FATOR_R_EPSILON` (`taxCalc.js`), com
      `FATOR_R_EPSILON = 1e-9`. Impacto: DAS de 2026 caiu R$ 5.189,94 no acumulado
      (~R$ 447/mês). **Nada foi reprocessado** — nenhuma obrigação fiscal havia sido
      gravada ainda; se o Victor já recolheu DAS pelo valor antigo, a diferença é
      crédito a apurar com a contabilidade, fora do sistema.
- [x] **`victor_reserves` → `fiscal_obligations`** — migrada (4 linhas, jul/2026,
      R$ 2.658,00) e a tabela + `api/victor-reserves.js` removidos. O card de Reservas
      da aba Pagar Victor passou a **ler** a apuração em vez de ter valores digitados:
      mostra o que ainda falta pagar (devido − pago), então cai sozinho conforme as
      guias são quitadas. Editar é em `/fiscal`.
- [ ] **Apuração fiscal — o que falta.** Já feito: `api/fiscal-obligations.js`
      (`?action=apurar`, `lancar-guia`, `distribuir`, `estornar-distribuicao`, GET),
      `api/fiscal-payments.js` (quitação), `lib/fiscal-status.js` (status da obrigação)
      e `lib/victor-distribution.js` (cascata de consumo — motor único do
      `pagar-distribuido` e do `distribuir`). O ciclo apurar → lançar guia → quitar →
      abater dos payables está fechado pela API, e a tela `/fiscal`
      (`src/pages/FiscalObligations.jsx`) cobre o ciclo inteiro. O backend fiscal está
      completo.
- [x] **Redistribuição do imposto real** — feito em 2026-07-26. `lib/fiscal-redistribution.js`
      + `?action=recalcular` + `?action=corrigir-escritorio`; `lancar-guia` passou a refazer
      o rateio. A tela `/fiscal` mostra as três etapas com antes/depois e um botão explícito
      de aplicar. Validado contra o caso Bokada (765 a 7%): só DAS a 6% → Victor 711,45 →
      719,10; com INSS e escritório → 685,98.
- [x] 🐞 **Reapurar mês distribuído apagava o vínculo do abatimento** — o DELETE do rateio
      em `?action=apurar` não filtrava `basis` e levava junto as linhas `consumo_payable`,
      deixando `payable_payments` órfãos (o estorno passava a dizer "não foi distribuído")
      e derrubando a guarda dos 409, o que liberava uma segunda distribuição sobre os mesmos
      saldos. Agora o DELETE é restrito a `proporcional_nf` e reapurar mês distribuído
      responde 409 pedindo o estorno antes.
- [x] 🐞 **`?action=distribuir` ignorava o que já fora pago** — o pool usava `valorDevido()`
      cheio em vez do saldo em aberto, então uma guia quitada no pix entrava inteira de novo
      na distribuição e `paid_amount` passava do devido. Agora o pool é o saldo.
- [x] **Honorários e piso do pró-labore hardcoded** — feito: viraram
      `company_settings.prolabore_percentual` / `prolabore_minimo` / `honorarios_mensal`,
      editáveis por `api/settings.js` (PATCH parcial). As constantes em
      `api/fiscal-obligations.js` sobraram só como fallback (`PARAMS_PADRAO`) para
      empresa sem linha cadastrada. Os parâmetros usados ficam congelados em
      `calc_snapshot.params`, então uma apuração antiga continua legível depois que
      o piso mudar.
- [x] **Pró-labore: dois donos** — resolvido de vez. O pró-labore deixou de ser dado
      guardado e virou cálculo: `proLaboreDoMes()` em `lib/taxCalc.js` é a fórmula
      única usada pela apuração, pelo Billing e pela previsão da tela. A coluna
      `company_settings.prolabore_mensal` (cache) foi removida, e com ela o problema
      de sincronização — não há mais valor para ficar defasado. `Settings.jsx` passou
      a editar os parâmetros (percentual, piso, honorários) em vez do valor final.
      Previsão e apuração agora dão exatamente o mesmo INSS (jul/2026: 178,31).
- [ ] **RBT12 estimada — parcialmente resolvido (2026-07-27).** O card "Previsão de
      Impostos" do `/financial` deixou de ler `company_settings.faturamento_medio_mensal`:
      a RBT12 dele passou a ser o **faturamento real do mês** (NFs com `require_nf`,
      somadas em `fetchTaxPreview`) × 12. Aquele campo é escrito pelo `Billing.jsx` com o
      total de **um** mês e envelhece — em Jan/2026 ele valia 24.100 (de fevereiro)
      enquanto o mês faturava 10.540, o que jogava a empresa na 2ª faixa e previa R$
      1.163,98 onde cabiam R$ 957,03 (alíquota 7,96% × 6%).
      **O que falta:** o card ainda anualiza um mês (× 12) em vez de somar os 12 meses
      reais como o `acumular12` da apuração, e ainda agrupa a NF pelo campo `month` da
      fatura, enquanto a apuração agrupa pela **data de emissão** — uma NF de dezembro
      emitida em janeiro cai em meses diferentes nas duas telas. Fechar isso é alimentar o
      card pelo `calculo` do GET de `/api/fiscal-obligations` em vez de recalcular no
      browser; muda o mês em que cada NF aparece no card, então é decisão do Victor.
      `faturamento_medio_mensal` continua existindo e sendo escrito pelo Billing — hoje
      só a tela de Configurações o usa.
- [ ] **Lumen IMAP** (`victor@lumendev.com.br`) — ingestão de e-mail só cobre Imperium hoje.
- [ ] **Migrations faltantes** para popular `time_entries.contract_id` e
      `contracts.financial_rule_id` em registros antigos (colunas já existem no schema).
- [ ] **Unificar o calculador do `contract-months.js`** com a lógica de `invoices.js`
      (impostos duplos, deslocamento).
- [ ] **Deslocamento no faturamento por agenda** — o calculador de fatura
      (`calcAgenda`) usa `horas × hourly_rate`, sem aplicar a lógica de deslocamento
      de `time-entries.js`.
- [x] **Autenticação nos endpoints** — feito: login JWT (8h) + `requireAuth` em
      todos os endpoints. Ver seção 4. Trocar `ADMIN_PASS` do valor inicial.
- [ ] Regras financeiras/contratos para os demais clientes Lumen (Nutribom, LecaCau,
      Hidronorth) e Imperium.
- [ ] Editar/rotacionar senha do banco; DNS `lumendev.com.br`.

---

## Observações para Claude Code
- Windows: no PowerShell usar cmdlets nativos; via Bash usar sintaxe POSIX.
- Não criar endpoints/queries que acessem o Neon direto do frontend.
- Confirmar lógica financeira com Victor antes de implementar.
- Ao terminar uma tarefa: **build, commit e push**.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
