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
`id` int · `name` varchar · `email_domain` varchar · `created_at` timestamp
> ⚠️ **Não há `company_id` aqui** (conferido no banco em 2026-08-05; esta doc afirmava que
> havia). Os JOINs são sempre `clients c ON c.id = <tabela>.client_id`, e o recorte por
> empresa vem da tabela dona da linha (`invoices.company_id`, `payables_*.company_id`…).

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
`paid_at` date · `status` varchar · `notes` text · `created_at` timestamp · `origin` varchar · `invoice_id` int ·
`payment_month` int · `payment_year` int (mês de caixa) ·
`kind` varchar(20) NOT NULL default `'manual'` (classificação de lançamento manual — o
imposto **não** vira linha aqui; ver "Composição fiscal na aba Pagar Victor") ·
`lucro_antes_escritorio` numeric · `lucro_antes_inss` numeric · `lucro_antes_das` numeric ·
`capital_proprio` numeric (saldo corrente da cascata Escritório → INSS → DAS; o fim da
cascata é o próprio `profit_amount` — ver "Cascata do lucro persistida")

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
| `payables-victor.js` | GET/POST `?action=pagar-distribuido\|pagar-com-rateio`/PATCH/DELETE | Contas a pagar Victor. Valor em `total_amount` (`service_amount`+`profit_amount`). Traz `payments[]`. `?action=pagar-com-rateio` paga cada categoria pelos payables que `fiscal_allocations` aponta como donos daquele imposto, com fallback no Pharmalog (ver seção 6); prévia por padrão, grava só com `aplicar: true`. |
| `payable-payments.js` | GET/POST/DELETE | Múltiplos pagamentos por payable; recalcula `status`/`paid_amount` do pai (pendente/parcial/pago). |
| `fiscal-obligations.js` | GET/POST `?action=apurar\|recalcular`/PATCH `?action=lancar-guia\|corrigir-escritorio` | **Apuração fiscal.** Calcula RBT12 e folha dos 12 meses (proporcionalizados enquanto houver < 12 meses), Fator R, pró-labore (`max(28% do faturamento, R$ 1.621)`), DAS, INSS e honorários; grava `fiscal_obligations` e rateia por cliente em `fiscal_allocations` (proporcional à NF). Idempotente: reapurar substitui o rateio. GET lê o apurado do mês/ano com as alocações. `PATCH ?action=lancar-guia` grava `amount_actual`/`due_date`/`doc_number` quando a guia oficial chega (só sobrescreve os campos enviados); `amount_actual: null` desfaz o lançamento — e **refaz o rateio** com o valor real. `POST ?action=recalcular` é a **redistribuição**: compara a provisão de imposto da fatura (`invoices.tax_amount`) com o custo fiscal real rateado e devolve o antes/depois do que o Victor recebe; é **prévia por padrão** e só grava com `aplicar: true`. `PATCH ?action=corrigir-escritorio` = lançar guia + rerateio + prévia, numa chamada. |
| `fiscal-payments.js` | GET/POST `?action=pagar`/DELETE | **Quitação da guia.** Múltiplos pagamentos por obrigação. `paid_amount`/`status` da obrigação são sempre **re-somados** de `fiscal_payments` (nunca incrementados), em transação com o INSERT/DELETE. Estornar tudo devolve a obrigação a `apurado` (se a guia oficial já chegou) ou `previsto`. Usa o `PAID_EPSILON` de `lib/payment-status.js`. |
| `export-os.js` | GET | Gera Excel (ExcelJS) das horas do mês, opcionalmente filtrado por `client_id`. |
| `export-payables-fabricio.js` | GET/POST | Excel do demonstrativo da aba Pagar Fab. Aceita `month`/`year`/`client_id`/`status`/`mode` e reaplica em JS **a mesma** lógica de recorte da tela — visão de data, status (vocabulário `all`/`pendente_parcial`) **e a ocultação dos R$ 0,00**. Totais por coluna, congelamento do cabeçalho, autofiltro e nota de rodapé com as duas cascatas. |
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
| `/financial` | `Financial.jsx` | 4 abas: A Receber, Pagar Fab, Pagar Victor, Histórico. Filtro pill de mês + status. Múltiplos pagamentos, estorno, "Receber" (distribui entre payables do Victor). Oculta registros R$ 0,00 nas abas de Pagar. No card de Previsão de Impostos: memória de cálculo e **✏️ Editar valores** (lança as guias reais da competência e redistribui). Em Pagar Fab: demonstrativo em cascata no modal e export Excel. | receivables, payables-*, payable-payments, clients, fiscal-obligations, export-payables-fabricio |
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

### Linhas fiscais materializadas (`lib/fiscal-lines.js`) — 2026-07-28

`sincronizarLinhasFiscais(sql, company_id, month, year)` espelha `fiscal_obligations` como
linhas em `payables_victor`: uma por (empresa, mês, ano, `kind`), com `origin='fiscal'`,
`client_id` NULL e `payment_month/year` no vencimento (ou no mês seguinte). Idempotente —
UPDATE quando já existe, DELETE quando a obrigação some (reapuração que deixou de gerar DAS).

Chamada por `?action=apurar`, `lancar-guia`, `corrigir-escritorio` e pelos dois caminhos de
`api/fiscal-payments.js`. `paid_amount`/`status` são **copiados** da obrigação, nunca
calculados — mesmo princípio de `lib/fiscal-status.js`, um dono só por registro.

**São marcadores de leitura, não contas a pagar ao Victor.** A tabela guarda o que a empresa
**deve a ele**; imposto tem o sinal oposto. Por isso ficam fora de:
- `candidatosDisponiveis()` (`origin IS DISTINCT FROM 'fiscal'`) — sem isso a distribuição
  consumiria a linha do DAS para pagar o próprio DAS;
- `distSource` no `Financial.jsx` — a prévia tem de bater com o backend;
- os totais da aba (`availableData` sai de `payData`) e do `Dashboard.jsx`;
- `api/admin.js ?action=estornar-periodo`, que agora as apaga junto com a apuração — são
  derivadas, ao contrário dos lançamentos manuais (`origin` NULL/`manual`), que sobrevivem.

Não têm botão de pagar: a quitação continua sendo em `/fiscal`, via `fiscal_payments`. Dois
canais de pagamento para a mesma guia é como o `paid_amount` de um dos dois passa a mentir.

### Mês sem faturamento agora é apurado — 2026-07-28

`?action=apurar` respondia **404 e não gravava nada** quando o mês não tinha NF. Mas mês seco
não é mês sem obrigação: o pró-labore cai no piso (`proLaboreDoMes`) e há 11% sobre ele a
recolher, mais os honorários do escritório — **R$ 328,31/mês** (INSS R$ 178,31 + R$ 150) que
o sistema simplesmente escondia.

Agora o DAS é o único que some (`kindsDoMes` filtra), e não como R$ 0,00: uma obrigação zerada
nasceria `'pago'` (ver `statusObrigacao`) e poluiria a tela com uma guia que nunca existiu. Se
o mês **passou** a não ter faturamento (a NF foi excluída), o DAS apurado antes é apagado —
mas só se ninguém o tocou (`amount_actual IS NULL AND paid_amount = 0`): guia lançada ou
pagamento registrado é decisão humana e não se desfaz por reapuração.

### Reapuração ao emitir a NF — 2026-07-28

`POST /api/invoices` chama `apurarCompetencia(sql, company_id, m, y)` — exportada de
`api/fiscal-obligations.js`, que captura `{status, payload}` de `apurar` sem HTTP (mesmo
padrão do `raw` de `recalcular`). A competência é a **data de emissão**, não o mês de
referência.

A apuração é do **mês inteiro**, nunca da nota. É a única forma correta: o DAS depende do
faturamento do mês e da RBT12, o INSS tem piso mensal e os honorários são valor fechado.
Calcular por NF faria duas notas no mesmo mês gerarem dois pisos de INSS e dois honorários, e
deixaria o DAS da primeira desatualizado assim que a segunda saísse.

**Best-effort de propósito:** faturar não pode falhar porque a apuração recusou. O caso normal
de recusa é 409 (mês já distribuído nos payables do Victor), que exige estorno consciente — a
fatura fica gravada e o aviso volta em `apuracao.error` na resposta do POST.

### Composição fiscal na aba Pagar Victor — 2026-07-28

Cada payable de faturamento mostra agora **quanto do imposto real do mês coube àquela NF**,
quebrado em DAS / INSS / Honorários, com a linha "Coberto por: provisão da NF + lucro +
serviço". A fonte é `fiscal_allocations` (`basis='proporcional_nf'`) — a MESMA da tabela
"Custo por cliente" da tela `/fiscal`. Montado no GET de `api/payables-victor.js`; nenhum
cálculo no browser.

**O imposto não vira linha em `payables_victor`, e isso é decisão, não omissão.** Ele já está
descontado do que o Victor recebe: a provisão de 7% é retida na fatura e o excedente desce
pela cascata lucro→serviço de `lib/fiscal-redistribution.js`. Materializar DAS/INSS/honorários
como registros descontaria o mesmo imposto duas vezes e — o pior — os colocaria em
`candidatosDisponiveis()`, fazendo a distribuição consumir a linha do DAS como se fosse
dinheiro a receber do Victor. A tabela guarda o que a empresa **deve ao Victor**; imposto tem
o sinal oposto e mora em `fiscal_obligations`.

Pelo mesmo motivo o imposto **não pode ser calculado por NF**: DAS depende do faturamento do
mês inteiro e da RBT12, INSS tem piso mensal (duas NFs no mês gerariam dois pisos de R$ 1.621)
e honorários são R$ 150 fechados por mês. A apuração é mensal e o rateio por cliente é o que
traz o número de volta para a fatura.

`a_redistribuir` é o excedente que a apuração já rateou mas o `?action=recalcular` ainda não
aplicou — enquanto for ≠ 0, o valor exibido do payable ainda é o da fatura. Vira um aviso
âmbar na linha, com o caminho (`/fiscal`) para aplicar. Caso real em Jan/2026: Pharmalog com
imposto real de R$ 1.026,55 contra provisão de R$ 684,25 — R$ 342,30 pendentes.

`payables_victor.kind` (`VARCHAR(20) NOT NULL DEFAULT 'manual'`, índice
`(company_id, year, month, kind)`) existe desde 2026-07-28 para classificar lançamentos
**manuais**. Nenhuma linha é criada com kind fiscal: serviço e lucro continuam sendo colunas
(`service_amount`/`profit_amount`) de um registro único por fatura, e muita coisa depende
disso (`fiscal-redistribution` indexa payable por `invoice_id`, o preview do GET, o estorno).

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

### Três visões de data (competência / fiscal / caixa) — 2026-07-30

O toggle do `/financial` tinha duas visões e passou a ter três, porque são três datas
mesmo — e elas divergem de verdade. O payable 28 (Pharmalog, Lumen) é o caso didático:

| visão | fonte | valor no id 28 |
|-------|-------|----------------|
| **competência** | `payables_victor.month/year` | 01/2026 (serviço prestado) |
| **fiscal** | `invoices.emission_date` | 02/2026 (NF emitida) |
| **caixa** | `payables_victor.payment_month/year` | 07/2026 (dinheiro entrou) |

**Nenhuma coluna nova foi criada** — `invoices.emission_date` já existia (22 de 24 faturas
preenchidas) e é a mesma data que `faturasDoMes()` usa para agrupar a apuração. O que
faltava era expor: `emission_date` entrou no SELECT de `payables-victor`, `payables-fabricio`
e `receivables` (as três abas precisam concordar na visão ativa).

O agrupamento é client-side, em `effMonth`/`effYear` (`Financial.jsx`). Sem NF — lançamento
manual, linha `origin='fiscal'` — cai na competência, mesmo `COALESCE` de `faturasDoMes`.

⚠️ **`emission_date` chega como string ISO pelo JSON, mas como `Date` em qualquer consumo
direto do driver.** `String(date)` dá `"Mon Feb 02 2026"`, o `slice(0,10).split('-')` sai sem
hífen e a linha cai no fallback de competência **sem erro nenhum** — a visão fiscal fica
idêntica à de competência e parece que a feature não funciona. `fiscalParts()` normaliza os
dois formatos. Foi exatamente o que aconteceu no primeiro teste desta implementação.

Na visão fiscal o GET devolve **dois anos** de competência (`p.year = ANY([year-1, year])`)
e o ano exato é refiltrado no browser: a NF de dezembro emitida em janeiro tem competência
12/AAAA-1 e data fiscal 01/AAAA, e sem alargar a janela sumiria da tela.

### 🐞 "Receber" gravava zero em silêncio — corrigido 2026-07-30

`?action=pagar-distribuido` comparava dois relógios: o teto (`curKey`) saía do filtro de
**competência** da tela e era comparado, em `candidatosDisponiveis()`, contra o mês de
**caixa** do payable. Como um payable de janeiro é pago em fevereiro POR CONSTRUÇÃO, o caixa
é quase sempre posterior à competência — a regra descartava justamente os payables do mês
que se estava olhando. Caso real: Jan/2026 da Lumen tinha R$ 10.501,35 em aberto e o
"Receber" de R$ 209,16 gravava **zero**, com 200 OK e sem aviso nenhum.

Agora `curKey = max(mês de caixa do paid_at, reference_*)`. É `max` e não só o `paid_at`
porque a **edição de sessão** manda em `reference_*` a competência mais recente já consumida,
e baixar o teto abaixo dela deixaria payables de fora da redistribuição.

O mesmo teto foi espelhado em `effectiveRefKey` (`Financial.jsx`) — os dois lados calculam
igual, senão a prévia da distribuição volta a mentir.

E o pool vazio deixou de responder 200: agora é **422** com a razão. O 200 com `applied: []`
fechava o modal como se tivesse gravado, e o usuário só descobria olhando a lista depois.

### Cascata do lucro persistida — 2026-07-30

`payables_victor` ganhou quatro colunas de **saldo corrente** do waterfall
Escritório → INSS → DAS: `lucro_antes_escritorio`, `lucro_antes_inss`, `lucro_antes_das`
e `capital_proprio` (todas `NUMERIC(10,2) DEFAULT 0`). O fim da cascata é o
`profit_amount` que já existia — não há coluna `lucro_final`.

A fórmula é `cascataDoLucro()` em `lib/fiscal-redistribution.js`, e é **uma só**: grava
pelo `?action=recalcular` (`api/fiscal-obligations.js`) e é recalculada para exibir no GET
de `api/payables-victor.js`. A tela não lê as colunas — elas só são escritas quando a
redistribuição é aplicada, então uma fatura recebida num mês ainda não redistribuído
mostraria a cascata zerada. As colunas são o **histórico**; o display sai da função.

⚠️ **A cascata parte de `victor_profit + victor_tax_diff + invoices.tax_amount`**, não do
`victor_profit` puro. O lucro da fatura já vem líquido da provisão de 7%, que foi retida do
bruto antes do split; partir dele e subtrair DAS/INSS/honorários cheios erraria pela
provisão em toda linha. Com o gross-up a identidade fecha nos dois ramos de `aplicarDelta`:
`lucro_antes_das − das = baseProfit + provisão − real = profit_depois`.

`lucro_final` é aritmético e **pode ser negativo** — nos dois casos reais de Jan/2026 ele é
(Pharmalog −46,92 e Bokada −26,79, o imposto real superando o lucro). O `profit_amount`
gravado é clampado em zero por `aplicarDelta`, o serviço absorve a diferença e só o que
sobrar vira `capital_proprio`. A tela mostra os dois lado a lado: é exatamente aí que o
aporte fica visível.

"Escritório" na cascata é o kind **`honorarios`** (`KINDS = ['das','inss','honorarios']` —
os únicos rateados). O kind `escritorio` é legado da migração de `victor_reserves`, não
gera `fiscal_allocations`, e entra na soma só por defesa.

Junto vai a **conferência** (`r.conferencia`): `imposto real + serviço + lucro + Fabrício`
tem de fechar com `invoices.invoice_value`. Fabrício sai da FATURA, não do payable — é a
decomposição da nota que se confere, e ela existe antes de o recebimento gerar o payable
dele. Tolerância de **R$ 0,05**: a soma atravessa ~6 arredondamentos e o `ratear` joga o
resíduo na maior fatia (Pharmalog Jan/2026 fecha em 9.775,01 contra NF de 9.775,00).

**Backfill não foi feito** — as colunas só se populam quando o mês for redistribuído. Como
o display não depende delas, a tela já está correta; o que falta é o histórico dos meses
antigos.

### Demonstrativo do Fabrício (`lib/fabricio-breakdown.js`) — 2026-08-05

A aba Pagar Fab passou a explicar **como** a fatura chegou ao valor do Fabrício: um
painel em cascata no modal (botão **🧮 Ver cálculo**, presente inclusive nas linhas que
aguardam o cliente e nas de previsão) e um **📥 Exportar Excel** na barra de controles.

`breakdownFabricio(inv)` não recalcula nada — lê as colunas já gravadas em `invoices`
e as remonta na ordem em que o cálculo aconteceu. Roda **só no backend** (GET de
`payables-fabricio.js` e o export), pelo mesmo motivo da memória de cálculo fiscal:
reimplementar a fórmula do lado da explicação a deixaria divergir do valor que ela explica.

⚠️ **A conta intuitiva `(bruto − serviço − imposto) ÷ 2` está errada fora do caso mais
comum.** Ela só fecha em contrato por hora, sem deslocamento e com split 50/50. Os três
desvios, todos presentes no banco:

| Caso | Conta ingênua | Real | Por quê |
|------|---------------|------|---------|
| SteelDek 06/2026 (contrato fixo) | 338,33 | **400,00** | `calcContrato` divide `base − victor_fixed`; o imposto **não** sai antes do split, sai da parte do Victor |
| Eurofral 06/2026 (deslocamento) | 252,86 | **180,32** | deslocamento é 100% Victor e fica fora do split, mas `calcAgenda` o soma dentro de `victor_profit` (invoices.js:118) |
| ALEX 04/2026 (split 100/0) | −210,00 | **0,00** | dividir por 2 inventa valor para quem não tem participação |

Por isso a cascata é ramificada por `billing_type` e o percentual do split é **lido**
(`contracts.remainder_fabricio_pct`, com fallback em `financial_rules`), nunca presumido.

Duas derivações merecem atenção:
- **Base do split:** quando Fabrício tem participação ela é exata (`fabricio_total ÷ %`);
  sem participação (100/0) não é recuperável a partir dele, e o que resta é o que sobrou
  para o Victor.
- **Deslocamento é o resíduo** de `victor_profit − victor_lucro` — a única parte do lucro
  do Victor que não veio do split. Com split 100/0 ele é indistinguível do lucro e cai
  zerado; inofensivo, porque nesses clientes o Fabrício recebe 0 de qualquer forma.

Cada linha carrega `confere`/`desvio` (tolerância de R$ 0,05, a mesma da conferência de
`fiscal-redistribution`): as 24 faturas do banco fecham, e o que não fechar aparece em
vermelho no Excel e com aviso no painel, em vez de passar silenciosamente.

**Linhas previstas no Excel (2026-08-05).** A definição de "previsto" — fatura emitida
cujo recebível ainda não foi pago, logo sem payable (`NOT EXISTS`) — virou
`fetchPreviews()`, exportada de `api/payables-fabricio.js` e usada pela tela **e** pelo
export. Duplicar a query faria o `NOT EXISTS` e o filtro de status do recebível divergirem,
e a divergência só apareceria como uma linha a mais (ou a menos) num arquivo baixado.

Na planilha elas vão **depois** das efetivadas, em itálico cinza, e ficam **fora do total
efetivado** — na tela também não entram nos totalizadores da aba, têm card próprio
("🔮 Previsto cliente"). Por isso os totais usam `SUMIF` sobre a coluna Status
(`"<>previsto"` / `"previsto"`) e não `SUM`: a tabela continua contígua (autofiltro e
tabela dinâmica seguem funcionando) e as três somas permanecem fórmulas vivas. Somar tudo
junto faria a planilha afirmar um valor a pagar que ainda não é devido.

⚠️ Previsão **não** passa pelo corte de R$ 0,00 — na tela o filtro de zerados roda sobre
`realMonthFiltered`, que já excluiu as previsões. E some quando o status pedido é `pago`,
espelhando `previewData` em `Financial.jsx`.

O checkbox **"Incluir linhas previstas"** (ao lado do botão de export) manda
`include_preview`; o default é **true**, e só o `'false'` explícito recorta — chamada sem
o parâmetro continua trazendo a planilha completa. Fica desabilitado com o filtro `pago`,
onde marcar não teria efeito (previsão é, por definição, fatura ainda não paga). A escolha
vai para o subtítulo da planilha: sem isso, um arquivo sem previstas é indistinguível de
um mês que simplesmente não tinha nenhuma.

**O export tem de espelhar TODO o recorte da tela, não só o filtro explícito.** A primeira
versão aplicava visão de data, mês, cliente e status — e ainda assim trazia 22 linhas onde
a tela mostrava 8, porque faltava a regra implícita: as abas de Pagar **ocultam os
lançamentos de R$ 0,00** (`nonZeroFiltered` em `Financial.jsx`). As 14 linhas excedentes
eram os clientes de split 100/0 (Bokada, Enpla, Minas, ALEX), cuja fatura não gera nada
para o Fabrício. O sintoma enganava: uma planilha cheia de R$ 0,00 lê-se como "nenhum
filtro foi aplicado", e o suspeito óbvio vira o filtro de status — que estava correto.
Ao mexer no export, conferir contra `currentData`/`payData`, não contra os query params.

**Nomes de coluna:** não existem `gross_amount`, `victor_servico` nem `invoice_date` em
`invoices` — são `contract_value`, `victor_service` e `emission_date`. O GET expõe os dois
primeiros com os nomes de consumo e mantém `emission_date` (já usado pela visão fiscal).
O merge do breakdown é uma query separada por `invoice_id`, e não colunas novas nos quatro
SELECTs de payables: o driver do Neon não compõe fragmentos, então cada coluna seria
escrita 4×. Mesmo padrão do merge de `payments`.

### 🐞 A regra financeira vinha do cliente, sorteada pela heap — corrigido 2026-08-10

Os cinco pontos de cálculo (`invoices` POST/PUT, `time-entries` POST/PUT e
`recalc-time-entries`) buscavam a regra com `financial_rules WHERE client_id = X LIMIT 1`
— **sem `ORDER BY`**. Com mais de uma regra por cliente, quem decidia era a ordem física
da heap.

O Bokada (`client_id` 13) tem duas: **#8** (hora, R$ 85/h, split 100/0) e **#12**
(por_projeto, R$ 1.500/h, split 50/50). Reproduzido em produção: um
`UPDATE financial_rules SET hourly_rate = hourly_rate WHERE id = 8` — que **não muda
valor nenhum**, só reescreve a tupla no fim da heap — fez a query virar de #8 para #12.
Num apontamento de 9h isso é bruto de R$ 765 → **R$ 13.500** e Fabrício de R$ 0 →
**R$ 2.677,50**. Sem erro, sem aviso: os dois números são plausíveis.

A regra agora sai do **contrato** (`contracts.financial_rule_id`), via
`contratoComRegra()` em `lib/financial-rule.js` — dono único, para os cinco pontos não
voltarem a divergir. O vínculo já existia (FK, preenchido em 10/10 contratos); só não
era lido. Nenhuma migração foi necessária.

Decisões que acompanham:
- **Fallback recusado, não substituído.** Sem contrato → **422** com a razão. Cair na
  regra do cliente é o próprio bug com outra roupa. `time-entries` perdeu junto o
  fallback "contrato ativo mais recente do cliente" — eram dois sorteios encadeados, e
  a tela já exige o contrato (63/63 lançamentos têm `contract_id`).
- **Na agenda o contrato pode vir dos apontamentos** (`contratoDosApontamentos`): o
  seletor do modal não é obrigatório, e as 11 faturas antigas sem `contract_id` provam
  que a chamada sem ele acontece. Apontamentos de contratos diferentes são **recusados**,
  não arbitrados — aplicar a regra de um ao valor do outro é a mesma classe de erro.
- **O contrato resolvido é gravado** em `invoices.contract_id` (POST e PUT). Sem isso a
  próxima edição o derivaria do zero, e novas faturas nasceriam órfãs como as 11 antigas.
- **Faturas antigas não foram tocadas.** As 11 sem contrato estão todas `recebido`, e o
  PUT já recusa fatura recebida — o caminho é inalcançável para elas.

`payables-fabricio.js` e `export-payables-fabricio.js` ainda leem a regra por cliente,
mas com `ORDER BY id` e só como *fallback* de exibição do split quando a fatura não tem
contrato. Não entram em cálculo gravado.

### Pagamento com rateio (`lib/victor-rateio.js`) — 2026-08-10

`?action=pagar-distribuido` soma todas as categorias num **pool único** e o consome do mês
mais antigo ao mais novo. Isso paga o valor certo e no cliente errado: nada liga o INSS do
Pharmalog ao payable do Pharmalog — as categorias sobrevivem só como texto em
`payable_payments.notes`. `?action=pagar-com-rateio` é a alternativa: cada categoria é
consumida **primeiro dos payables que `fiscal_allocations` aponta como donos daquele
imposto**, e só o excedente cai no fallback (Pharmalog inteiro, depois os demais).

O rateio é a fonte da verdade sobre "de quem é este imposto" — é ele que a `/fiscal` exibe
em "Custo por cliente" e que `lib/fiscal-redistribution.js` usa para devolver o excedente ao
Victor. Pagar por outro critério faz o dinheiro sair de um cliente e o custo continuar
registrado em outro.

⚠️ **A âncora é a NOTA, não o mês.** `fiscal_allocations.invoice_id` →
`payables_victor.invoice_id`. Buscar o payable por `month/year = competência da apuração`
parece equivalente e não é, porque a apuração agrupa pela **data de emissão**: a competência
02/2026 rateia as invoices 6 e 11, cujos payables (28 e 42) têm `month = 1`; os payables com
`month = 2` (45, 44, 43) são das invoices 7, 12 e 21, rateadas em **03/2026**. Pelo mês, o
INSS de uma nota seria descontado de outra — sem erro, sem aviso.

Três decisões que fazem o resto encaixar:

- **Grava a MESMA tripla do `?action=distribuir`** — `payable_payments` +
  `fiscal_allocations` (`basis='consumo_payable'`) + `fiscal_payments`
  (`method='abatimento'`). Não há tabela nova: é essa tripla que `lib/fiscal-unlink.js`, o
  `?action=estornar-distribuicao` e o "Estornar abatimento" da `/fiscal` sabem desfazer, e
  a FK `payable_payment_id ON DELETE CASCADE` é o que permite estornar só esta sessão. Um
  registro paralelo deixaria os três estornos cegos.
- **Ordem das categorias é fixa** (`ORDEM_CATEGORIA`: das → inss → honorarios → escritorio →
  pro_labore → lucros → demais), não a ordem digitada. As com rateio têm alvo definido; uma
  categoria de fallback puro processada antes esvaziaria o payable do Pharmalog que o INSS
  dele precisa logo em seguida. Caso real conferido: `demais 8.400 + inss 324,63` mantém o
  rateio do INSS intacto e joga a despesa no que sobrou.
- **Fallback também quita a guia.** Se o INSS do Pharmalog saiu do saldo do Bokada (payable
  indisponível), a guia foi paga do mesmo jeito. Por isso a quitação é por CATEGORIA, não
  pela soma das linhas `tipo:'rateio'`. O teto é `saldoObrigacao` — pagar R$ 500 de uma guia
  de R$ 324,63 debita o payable, mas grava R$ 324,63 na obrigação e devolve o `excedente`.

Diferenças deliberadas em relação ao `?action=distribuir`:

| | `distribuir` | `pagar-com-rateio` |
|---|---|---|
| origem dos valores | apuração | digitados no modal |
| ordem de consumo | competência ASC, Pharmalog desempata | rateio primeiro; fallback = Pharmalog inteiro, depois os demais |
| trava contra duplicar | 409 por MÊS (qualquer elo) | 422 por CATEGORIA (obrigação já quitada) |
| `payable_payment_id` | `SELECT` sem limite | `ORDER BY pp.id DESC LIMIT 1` |

A trava por categoria substitui a do mês porque aqui pagar honorários em fevereiro e INSS em
março é uso normal — bloquear o mês inteiro impediria o segundo. O `LIMIT 1` corrige um bug
latente do `distribuir`: com um pagamento anterior de mesmo `(paid_at, notes)`, o
`INSERT … SELECT` casa duas linhas e grava a alocação em dobro.

**`ordenarFallback` é intencionalmente diferente de `ordenar()`** (`victor-distribution.js`),
onde a competência manda e o Pharmalog só desempata dentro do mês. Aqui a regra é "sem rateio
→ Pharmalog", e ele vem antes mesmo que outro cliente tenha competência mais antiga.

`de_lucro`/`de_servico` (gravados em `from_profit`/`from_service`) são **informativos**:
`payables_victor` tem um `paid_amount` único, não há duas colunas de pago para debitar. O
split segue a cascata de `aplicarDelta` — o lucro absorve primeiro —, inclusive na hipótese
sobre pagamentos anteriores.

Rateio que não pôde ser consumido (recebível pendente, caixa futuro, payable sem saldo) vira
`rateios_sem_saldo` com o motivo, e o valor **desce para o fallback** em vez de sumir. Sem
esse registro, o INSS do Pharmalog saindo do Bokada parece erro de cálculo.

O modal do "Receber" ganhou o checkbox **"Pagar pelo rateio da apuração"**, só no Flow A — o
Flow B (alvo específico) e a edição de sessão continuam no `pagar-distribuido`, porque lá o
usuário já escolheu o destino à mão. A prévia sai do **backend** (`aplicar: false`), não de
uma cópia da cascata no browser: prévia e gravação divergindo é exatamente o bug do teto de
caixa que o "Receber" já teve.

Junto foi corrigido em `estornarSessao` (edição de sessão): ele apagava os `payable_payments`
sem chamar `desfazerAbatimentoFiscal`, então os `fiscal_payments` de abatimento sobreviveriam
a uma sessão criada por esta rota — a obrigação seguiria paga com o dinheiro de volta no
saldo do Victor. Mesma correção que o `PATCH ?action=estornar` já tinha.

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
