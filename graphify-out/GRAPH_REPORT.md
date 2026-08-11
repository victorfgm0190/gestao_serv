# Graph Report - gestao_serv  (2026-08-10)

## Corpus Check
- 86 files · ~110,811 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 570 nodes · 1065 edges · 33 communities (28 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1dacff3c`
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
- cron-sync.js
- export-payables-fabricio.js
- Billing.jsx
- vercel.json
- todayBR
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
2. `6. Regras de negócio financeiro` - 22 edges
3. `r2()` - 19 edges
4. `3. Banco de dados — tabelas, colunas e tipos` - 19 edges
5. `react` - 18 edges
6. `valorDevido()` - 17 edges
7. `handler()` - 16 edges
8. `recalcularObrigacao()` - 14 edges
9. `round2()` - 13 edges
10. `num()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `handler()` --calls--> `requireAuth()`  [EXTRACTED]
  api/demands.js → lib/auth.js
- `handler()` --calls--> `requireAuth()`  [EXTRACTED]
  api/email-rules.js → lib/auth.js
- `handler()` --calls--> `requireAuth()`  [EXTRACTED]
  api/export-os.js → lib/auth.js
- `handler()` --calls--> `requireAuth()`  [EXTRACTED]
  api/export-payables-fabricio.js → lib/auth.js
- `acumular12()` --calls--> `proLaboreDoMes()`  [EXTRACTED]
  api/fiscal-obligations.js → lib/taxCalc.js

## Import Cycles
- None detected.

## Communities (33 total, 5 thin omitted)

### Community 0 - "main.jsx"
Cohesion: 0.08
Nodes (36): react, companies, Layout(), useNotifications(), clearToken(), getToken(), getUser(), installFetchInterceptor() (+28 more)

### Community 1 - "dependencies"
Cohesion: 0.06
Nodes (30): 1.1 `contracts`, 1.2 `financial_rules`, 1.3 `invoices` — como referencia regra/contrato, 1.4 Índices — panorama, 1.5 ⚠️ CLAUDE.md está defasado, 1. Schema Neon — DDL atual, 2.1 `api/contracts.js`, 2.2 `api/financial-rules.js` (+22 more)

### Community 2 - "devDependencies"
Cohesion: 0.04
Nodes (45): autoprefixer, dotenv, exceljs, imap-simple, mailparser, @neondatabase/serverless, oxlint, dependencies (+37 more)

### Community 3 - "Financial.jsx"
Cohesion: 0.08
Nodes (26): 6. Regras de negócio financeiro, 🐞 A regra financeira vinha do cliente, sorteada pela heap — corrigido 2026-08-10, Breakdown por cliente na aba Pagar Victor (`lib/victor-breakdown.js`) — 2026-08-10, Cascata do lucro persistida — 2026-07-30, Composição fiscal na aba Pagar Victor — 2026-07-28, Contrato fixo (`billing_type = 'contract'` ou `'mensal'`), Contrato por hora (`billing_type = 'hora'` / fatura `agenda`), Contrato sem NF (`require_nf = false`) — 2026-07-27 (+18 more)

### Community 4 - "6. Regras de negócio financeiro"
Cohesion: 0.11
Nodes (51): acumular12(), apurar(), brl(), calcularApuracao(), chaveCompetencia(), chaveOrdinal(), contextoRedistribuicao(), corrigirEscritorio() (+43 more)

### Community 5 - "payables-victor.js"
Cohesion: 0.09
Nodes (46): handler(), periodFromDate(), recalcParent(), TABLES, estornarSessao(), handler(), pagarComRateio(), pagarDistribuido() (+38 more)

### Community 6 - ".oxlintrc.json"
Cohesion: 0.25
Nodes (7): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, oxc, warn

### Community 7 - "Financial.jsx"
Cohesion: 0.11
Nodes (21): ALL_VICTOR_CATEGORIES, BREAKDOWN_CATEGORIAS, BREAKDOWN_LABEL, CAT_LABEL, DIST_KIND_LABEL, EMPTY_RECEIVE_CATS, EMPTY_VICTOR_CATS, FINANCE_ENDPOINTS (+13 more)

### Community 8 - "valorDevido"
Cohesion: 0.18
Nodes (12): fmt(), MemoriaCalculo(), Passo(), KIND_LABEL, dataBR(), FiscalObligations(), fmt(), KIND_ICON (+4 more)

### Community 9 - "payable-payments.js"
Cohesion: 0.09
Nodes (32): handler(), parseCompanyIds(), handler(), splitPct(), handler(), requerNf(), splitPct(), handler() (+24 more)

### Community 10 - "time-entries.js"
Cohesion: 0.14
Nodes (24): estornarPeriodo(), handler(), num(), apurarCompetencia(), calcAgenda(), calcContrato(), calcProjeto(), competenciaDaFatura() (+16 more)

### Community 11 - "taxCalc.js"
Cohesion: 0.24
Nodes (12): aliquotaEfetiva(), calcINSS(), calcularImpostos(), faixaFor(), PARAMS_PADRAO, proLaboreDoMes(), r2(), SIMPLES_III (+4 more)

### Community 12 - "cron-sync.js"
Cohesion: 0.44
Nodes (7): handler(), handler(), classify(), fetchEmailsFromAccount(), imperiumAccounts(), ingestAccounts(), makeImapConfig()

### Community 13 - "export-payables-fabricio.js"
Cohesion: 0.26
Nodes (13): fiscalParts(), handler(), MESES, num(), periodo(), fetchBreakdowns(), fetchPreviews(), handler() (+5 more)

### Community 14 - "Billing.jsx"
Cohesion: 0.33
Nodes (7): parametrosFiscais(), CopyButton(), Billing(), fetchFiscalParams(), months, SPLIT_MODE_LABEL, splitPct()

### Community 16 - "todayBR"
Cohesion: 0.53
Nodes (3): todayBR(), decimalToHHMM(), TimeEntries()

### Community 39 - "CLAUDE.md — Contexto do Projeto gestao_serv"
Cohesion: 0.04
Nodes (44): 10. Pendências conhecidas, 1. Visão geral, 2. Empresas e clientes, 3. Banco de dados — tabelas, colunas e tipos, 4. APIs ativas (`/api/`), 5. Telas (`/src/pages/`), 7. Contratos existentes no banco, 8. Workflow de desenvolvimento (+36 more)

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
- **203 isolated node(s):** `$schema`, `oxc`, `react/rules-of-hooks`, `warn`, `MESES` (+198 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `requireAuth()` connect `payable-payments.js` to `6. Regras de negócio financeiro`, `payables-victor.js`, `time-entries.js`, `cron-sync.js`, `export-payables-fabricio.js`?**
  _High betweenness centrality (0.095) - this node is a cross-community bridge._
- **Why does `react` connect `main.jsx` to `.oxlintrc.json`, `Financial.jsx`, `valorDevido`, `taxCalc.js`, `Billing.jsx`, `todayBR`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Why does `ORDEM_KIND` connect `payables-victor.js` to `6. Regras de negócio financeiro`, `Financial.jsx`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **What connects `$schema`, `oxc`, `react/rules-of-hooks` to the rest of the system?**
  _203 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `main.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.07908163265306123 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.043478260869565216 - nodes in this community are weakly interconnected._