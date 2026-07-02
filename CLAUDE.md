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
`financial_rule_id` int · `tax_client_percent` numeric

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
`status` varchar (`pendente`|`recebido`) · `notes` text · `created_at` timestamp

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

### `monthly_closings` / `payments`
Tabelas do fechamento mensal (modelo antigo). Pouco/ não usadas pelas telas atuais.

---

## 4. APIs ativas (`/api/`)

Todas exportam um `handler(req, res)` default e instanciam
`neon(process.env.DATABASE_URL)`. Sem autenticação (ver Pendências).

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
| `export-os.js` | GET | Gera Excel (ExcelJS) das horas do mês, opcionalmente filtrado por `client_id`. |
| `admin.js` | POST `?action=` | Setup/migração: `setup-db`, `setup-clients`, `migrate-financial-rules`, `migrate-time-entries`, `migrate-etapa6`. |

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
| `/financial` | `Financial.jsx` | 4 abas: A Receber, Pagar Fab, Pagar Victor, Histórico. Filtro pill de mês + status. Múltiplos pagamentos, estorno, "Receber" (distribui entre payables do Victor). Oculta registros R$ 0,00 nas abas de Pagar. | receivables, payables-*, payable-payments, clients |
| `/billing` | `Billing.jsx` | Geração de fatura por Contrato ou por Agenda (horas). Seção "Impostos" editável (imposto real + imposto do cliente, NF bidirecional) e demonstrativo. Filtros pill mês/cliente. | invoices, contracts, clients, time-entries, financial-rules |

Componentes: `src/components/Layout.jsx` (sidebar + switcher de empresa).
Hook: `src/hooks/useNotifications` (notificações; usado no Layout).

---

## 6. Regras de negócio financeiro

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

## 9. APIs legadas / mortas

- **`finance.js`** — ⚠️ LEGADO/MORTO. Não usar, não modificar.
- `contract-months.js` — calculador **antigo** (não considera `tax_client_percent`
  nem os dois tipos de imposto de forma unificada). Ver pendências.
- Tabela `projects` e `financial_rules.project_id` — modelo antigo por projeto,
  substituído por cliente.
- Tabelas `monthly_closings` / `payments` — fechamento mensal antigo.

---

## 10. Pendências conhecidas

- [ ] **Lumen IMAP** (`victor@lumendev.com.br`) — ingestão de e-mail só cobre Imperium hoje.
- [ ] **Migrations faltantes** para popular `time_entries.contract_id` e
      `contracts.financial_rule_id` em registros antigos (colunas já existem no schema).
- [ ] **Unificar o calculador do `contract-months.js`** com a lógica de `invoices.js`
      (impostos duplos, deslocamento).
- [ ] **Deslocamento no faturamento por agenda** — o calculador de fatura
      (`calcAgenda`) usa `horas × hourly_rate`, sem aplicar a lógica de deslocamento
      de `time-entries.js`.
- [ ] **Autenticação nos endpoints** — as rotas `/api/` (exceto `cron-sync`) não
      exigem autenticação. Neon protegido só por não ser exposto ao browser.
- [ ] Regras financeiras/contratos para os demais clientes Lumen (Nutribom, LecaCau,
      Hidronorth) e Imperium.
- [ ] Editar/rotacionar senha do banco; DNS `lumendev.com.br`.

---

## Observações para Claude Code
- Windows: no PowerShell usar cmdlets nativos; via Bash usar sintaxe POSIX.
- Não criar endpoints/queries que acessem o Neon direto do frontend.
- Confirmar lógica financeira com Victor antes de implementar.
- Ao terminar uma tarefa: **build, commit e push**.
