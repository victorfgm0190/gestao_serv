# Graph Report - gestao_serv  (2026-08-18)

## Corpus Check
- 95 files · ~159,342 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 697 nodes · 1314 edges · 38 communities (32 shown, 6 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.6)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `357aad89`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- main.jsx
- dependencies
- devDependencies
- Financial.jsx
- 6. Regras de negócio financeiro
- payables-victor.js
- .oxlintrc.json
- Financial.jsx
- valorDevido
- payable-payments.js
- time-entries.js
- taxCalc.js
- CryptoManager
- export-payables-fabricio.js
- FiscalObligations.jsx
- vercel.json
- Billing.jsx
- payment-source-tracker.js
- Diagnóstico — "a cascata está zerando o saldo do Pharmalog com os impostos"
- email-ingest.js
- Financial
- destinoDe
- CLAUDE.md — Contexto do Projeto gestao_serv
- What You Must Do When Invoked
- graphify reference: extra exports and benchmark
- graphify reference: query, path, explain
- graphify reference: add a URL and watch a folder
- graphify reference: commit hook and native CLAUDE.md integration
- graphify reference: incremental update and cluster-only
- React + Vite
- graphify reference: GitHub clone and cross-repo merge
- graphify reference: transcribe video and audio
- CLAUDE.md
- extraction-spec.md

## God Nodes (most connected - your core abstractions)
1. `requireAuth()` - 46 edges
2. `r2()` - 31 edges
3. `6. Regras de negócio financeiro` - 25 edges
4. `3. Banco de dados — tabelas, colunas e tipos` - 24 edges
5. `react` - 18 edges
6. `valorDevido()` - 17 edges
7. `handler()` - 16 edges
8. `Breakdown por cliente na aba Pagar Victor (`lib/victor-breakdown.js`) — 2026-08-10` - 16 edges
9. `pagarComRateio()` - 15 edges
10. `recalcularObrigacao()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `handler()` --calls--> `requireAuth()`  [EXTRACTED]
  api/demands.js → lib/auth.js
- `handler()` --calls--> `requireAuth()`  [EXTRACTED]
  api/email-rules.js → lib/auth.js
- `handler()` --calls--> `requireAuth()`  [EXTRACTED]
  api/export-os.js → lib/auth.js
- `handler()` --calls--> `requireAuth()`  [EXTRACTED]
  api/export-payables-fabricio.js → lib/auth.js
- `distribuir()` --calls--> `candidatosDisponiveis()`  [EXTRACTED]
  api/fiscal-obligations.js → lib/victor-distribution.js

## Import Cycles
- None detected.

## Communities (38 total, 6 thin omitted)

### Community 0 - "main.jsx"
Cohesion: 0.07
Nodes (39): react, companies, Layout(), useNotifications(), clearToken(), getToken(), getUser(), installFetchInterceptor() (+31 more)

### Community 1 - "dependencies"
Cohesion: 0.06
Nodes (30): 1.1 `contracts`, 1.2 `financial_rules`, 1.3 `invoices` — como referencia regra/contrato, 1.4 Índices — panorama, 1.5 ⚠️ CLAUDE.md está defasado, 1. Schema Neon — DDL atual, 2.1 `api/contracts.js`, 2.2 `api/financial-rules.js` (+22 more)

### Community 2 - "devDependencies"
Cohesion: 0.04
Nodes (45): autoprefixer, dotenv, exceljs, imap-simple, mailparser, @neondatabase/serverless, oxlint, dependencies (+37 more)

### Community 3 - "Financial.jsx"
Cohesion: 0.05
Nodes (44): 6. Regras de negócio financeiro, ⚠️ "A cascata parou no meio do Pharmalog" — não parou (2026-08-15), 🐞 A regra financeira vinha do cliente, sorteada pela heap — corrigido 2026-08-10, ⚠️ ABSORVEU não é consumo — o lucro que o imposto comeu, Breakdown por cliente na aba Pagar Victor (`lib/victor-breakdown.js`) — 2026-08-10, Cascata do lucro persistida — 2026-07-30, Composição fiscal na aba Pagar Victor — 2026-07-28, Contrato fixo (`billing_type = 'contract'` ou `'mensal'`) (+36 more)

### Community 4 - "6. Regras de negócio financeiro"
Cohesion: 0.11
Nodes (53): acumular12(), apurar(), brl(), calcularApuracao(), chaveCompetencia(), chaveOrdinal(), contextoRedistribuicao(), corrigirEscritorio() (+45 more)

### Community 5 - "payables-victor.js"
Cohesion: 0.08
Nodes (57): handler(), periodFromDate(), recalcParent(), TABLES, calcularDistribuicao(), estornarSessao(), handler(), pagarCompensacao() (+49 more)

### Community 6 - ".oxlintrc.json"
Cohesion: 0.25
Nodes (7): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, oxc, warn

### Community 7 - "Financial.jsx"
Cohesion: 0.07
Nodes (27): ALL_VICTOR_CATEGORIES, BREAKDOWN_CATEGORIA_MOTOR, BREAKDOWN_CATEGORIAS, BREAKDOWN_LABEL, CAT_LABEL, DIST_ENTRADA_LINHA, DIST_KIND_LINHA, DIST_LINHA_LABEL (+19 more)

### Community 8 - "valorDevido"
Cohesion: 0.15
Nodes (27): ORDEM_KIND, absorverDelta(), agregado(), aplicarDelta(), cascataDoLucro(), consolidar(), linha(), num() (+19 more)

### Community 9 - "payable-payments.js"
Cohesion: 0.09
Nodes (32): handler(), parseCompanyIds(), handler(), splitPct(), handler(), requerNf(), splitPct(), handler() (+24 more)

### Community 10 - "time-entries.js"
Cohesion: 0.14
Nodes (24): estornarPeriodo(), handler(), num(), apurarCompetencia(), calcAgenda(), calcContrato(), calcProjeto(), competenciaDaFatura() (+16 more)

### Community 11 - "taxCalc.js"
Cohesion: 0.06
Nodes (31): 3. Banco de dados — tabelas, colunas e tipos, `?action=pagar-compensacao` — usar o crédito, Apuração fiscal (DAS/INSS/Honorários) — criadas 2026-07-25, Cascata de origem ao pagar imposto — rateio → Lucro → Serviço (2026-08-15), `clients`, `companies`, `company_settings` (configuração fiscal por empresa), Compensação do Fabrício (`lib/fabricio-compensation.js`) — 2026-08-15 (+23 more)

### Community 12 - "CryptoManager"
Cohesion: 0.11
Nodes (8): CryptoManager, adulterado, bufferDecrypt, bufferOriginal, { encrypted: encBin, iv: ivBin }, { encrypted: encSenha, iv: ivSenha }, senhaDecrypt, thumbprint

### Community 13 - "export-payables-fabricio.js"
Cohesion: 0.21
Nodes (19): fiscalParts(), handler(), MESES, num(), periodo(), fetchBreakdowns(), fetchPreviews(), handler() (+11 more)

### Community 14 - "FiscalObligations.jsx"
Cohesion: 0.18
Nodes (12): fmt(), MemoriaCalculo(), Passo(), KIND_LABEL, dataBR(), FiscalObligations(), fmt(), KIND_ICON (+4 more)

### Community 16 - "Billing.jsx"
Cohesion: 0.21
Nodes (10): PARAMS_PADRAO, CopyButton(), todayBR(), Billing(), fetchFiscalParams(), months, SPLIT_MODE_LABEL, splitPct() (+2 more)

### Community 17 - "payment-source-tracker.js"
Cohesion: 0.31
Nodes (10): DESTINO_POR_CATEGORIA, linhaDeSaldoDe(), movimento(), movimentosDaAbsorcao(), movimentosDoConsumo(), movimentosDoPlano(), num(), quebrarConsumo() (+2 more)

### Community 18 - "Diagnóstico — "a cascata está zerando o saldo do Pharmalog com os impostos""
Cohesion: 0.18
Nodes (10): 1. Em qual arquivo/função os impostos entram na cascata?, 2. Qual é a ordem de consumo hoje?, 3. Os impostos têm flag/status diferente dos outros?, 4. Para corrigir, o que precisa mudar?, Achado secundário (bug real, independente), Arquivos a tocar quando a decisão vier, Diagnóstico — "a cascata está zerando o saldo do Pharmalog com os impostos", Estado real hoje (produção, 01/2026) (+2 more)

### Community 19 - "email-ingest.js"
Cohesion: 0.44
Nodes (7): handler(), handler(), classify(), fetchEmailsFromAccount(), imperiumAccounts(), ingestAccounts(), makeImapConfig()

### Community 20 - "Financial"
Cohesion: 0.28
Nodes (9): alocarCascataDist(), cents(), Financial(), modoDaCategoria(), parseNotesToAmounts(), proportionalCats(), RECEIVE_INPUTS, RECEIVE_VICTOR_CATEGORIES (+1 more)

### Community 39 - "CLAUDE.md — Contexto do Projeto gestao_serv"
Cohesion: 0.09
Nodes (22): 10. Pendências conhecidas, 1. Visão geral, 2. Empresas e clientes, 4. APIs ativas (`/api/`), 5. Telas (`/src/pages/`), 7. Contratos existentes no banco, 8. Workflow de desenvolvimento, 9. APIs legadas / mortas (+14 more)

### Community 41 - "What You Must Do When Invoked"
Cohesion: 0.07
Nodes (26): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+18 more)

### Community 43 - "graphify reference: extra exports and benchmark"
Cohesion: 0.22
Nodes (8): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7a - FalkorDB export (only if --falkordb or --falkordb-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 44 - "graphify reference: query, path, explain"
Cohesion: 0.33
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 45 - "graphify reference: add a URL and watch a folder"
Cohesion: 0.50
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 46 - "graphify reference: commit hook and native CLAUDE.md integration"
Cohesion: 0.50
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 47 - "graphify reference: incremental update and cluster-only"
Cohesion: 0.50
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

### Community 48 - "React + Vite"
Cohesion: 0.50
Nodes (3): Expanding the Oxlint configuration, React Compiler, React + Vite

## Knowledge Gaps
- **258 isolated node(s):** `$schema`, `oxc`, `react/rules-of-hooks`, `warn`, `MESES` (+253 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `requireAuth()` connect `payable-payments.js` to `6. Regras de negócio financeiro`, `payables-victor.js`, `time-entries.js`, `export-payables-fabricio.js`, `email-ingest.js`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Why does `react` connect `main.jsx` to `Billing.jsx`, `FiscalObligations.jsx`, `.oxlintrc.json`, `Financial.jsx`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Why does `r2()` connect `payables-victor.js` to `valorDevido`, `6. Regras de negócio financeiro`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **What connects `$schema`, `oxc`, `react/rules-of-hooks` to the rest of the system?**
  _258 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `main.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.07184325108853411 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.043478260869565216 - nodes in this community are weakly interconnected._