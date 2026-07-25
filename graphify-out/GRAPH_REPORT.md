# Graph Report - gestao_serv  (2026-07-25)

## Corpus Check
- 73 files · ~64,633 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 405 nodes · 677 edges · 29 communities (24 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `df5f4501`
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
- invoices.js
- payable-payments.js
- time-entries.js
- 3. Banco de dados — tabelas, colunas e tipos
- cron-sync.js
- vercel.json
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
2. `3. Banco de dados — tabelas, colunas e tipos` - 18 edges
3. `react` - 17 edges
4. `CLAUDE.md — Contexto do Projeto gestao_serv` - 13 edges
5. `What You Must Do When Invoked` - 12 edges
6. `apurar()` - 11 edges
7. `/graphify` - 11 edges
8. `proLaboreDoMes()` - 10 edges
9. `calcularImpostos()` - 10 edges
10. `distribuir()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `handler()` --calls--> `requireAuth()`  [EXTRACTED]
  api/demands.js → lib/auth.js
- `handler()` --calls--> `requireAuth()`  [EXTRACTED]
  api/email-rules.js → lib/auth.js
- `handler()` --calls--> `requireAuth()`  [EXTRACTED]
  api/export-os.js → lib/auth.js
- `handler()` --calls--> `requireAuth()`  [EXTRACTED]
  api/fiscal-obligations.js → lib/auth.js
- `pagar()` --calls--> `recalcularObrigacao()`  [EXTRACTED]
  api/fiscal-payments.js → lib/fiscal-status.js

## Import Cycles
- None detected.

## Communities (29 total, 5 thin omitted)

### Community 0 - "main.jsx"
Cohesion: 0.07
Nodes (39): react, companies, Layout(), useNotifications(), clearToken(), getToken(), getUser(), installFetchInterceptor() (+31 more)

### Community 1 - "dependencies"
Cohesion: 0.11
Nodes (19): dotenv, exceljs, imap-simple, mailparser, @neondatabase/serverless, dependencies, dotenv, exceljs (+11 more)

### Community 2 - "devDependencies"
Cohesion: 0.07
Nodes (26): autoprefixer, oxlint, devDependencies, autoprefixer, oxlint, postcss, tailwindcss, @types/react (+18 more)

### Community 3 - "Financial.jsx"
Cohesion: 0.11
Nodes (22): CopyButton(), todayBR(), Billing(), fetchFiscalParams(), months, SPLIT_MODE_LABEL, splitPct(), EMPTY_RECEIVE_CATS (+14 more)

### Community 4 - "6. Regras de negócio financeiro"
Cohesion: 0.12
Nodes (37): acumular12(), apurar(), chaveCompetencia(), chaveOrdinal(), distribuir(), estornarDistribuicao(), handler(), janela12() (+29 more)

### Community 5 - "payables-victor.js"
Cohesion: 0.30
Nodes (13): estornar(), handler(), listar(), num(), pagar(), round2(), saldoAberto(), handler() (+5 more)

### Community 6 - ".oxlintrc.json"
Cohesion: 0.25
Nodes (7): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, oxc, warn

### Community 8 - "invoices.js"
Cohesion: 0.44
Nodes (8): calcAgenda(), calcContrato(), calcProjeto(), handler(), loadProjeto(), paymentPeriod(), resolvePct(), splitPct()

### Community 9 - "payable-payments.js"
Cohesion: 0.09
Nodes (33): handler(), parseCompanyIds(), handler(), splitPct(), handler(), splitPct(), handler(), handler() (+25 more)

### Community 10 - "time-entries.js"
Cohesion: 0.32
Nodes (8): handler(), handler(), calcular(), calcularHoras(), handler(), splitPct(), timeToDecimal(), requireAdmin()

### Community 11 - "3. Banco de dados — tabelas, colunas e tipos"
Cohesion: 0.10
Nodes (21): 3. Banco de dados — tabelas, colunas e tipos, Apuração fiscal (DAS/INSS/Honorários) — criadas 2026-07-25, `clients`, `companies`, `company_settings` (configuração fiscal por empresa), `contract_months`, `contracts`, `demands` (+13 more)

### Community 12 - "cron-sync.js"
Cohesion: 0.44
Nodes (7): handler(), handler(), classify(), fetchEmailsFromAccount(), imperiumAccounts(), ingestAccounts(), makeImapConfig()

### Community 39 - "CLAUDE.md — Contexto do Projeto gestao_serv"
Cohesion: 0.07
Nodes (28): 10. Pendências conhecidas, 1. Visão geral, 2. Empresas e clientes, 4. APIs ativas (`/api/`), 5. Telas (`/src/pages/`), 6. Regras de negócio financeiro, 7. Contratos existentes no banco, 8. Workflow de desenvolvimento (+20 more)

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
- **143 isolated node(s):** `$schema`, `oxc`, `react/rules-of-hooks`, `warn`, `KINDS` (+138 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `requireAuth()` connect `payable-payments.js` to `6. Regras de negócio financeiro`, `payables-victor.js`, `invoices.js`, `time-entries.js`, `cron-sync.js`?**
  _High betweenness centrality (0.119) - this node is a cross-community bridge._
- **Why does `react` connect `main.jsx` to `Financial.jsx`, `.oxlintrc.json`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Why does `proLaboreDoMes()` connect `6. Regras de negócio financeiro` to `main.jsx`, `Financial.jsx`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **What connects `$schema`, `oxc`, `react/rules-of-hooks` to the rest of the system?**
  _143 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `main.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.07184325108853411 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._