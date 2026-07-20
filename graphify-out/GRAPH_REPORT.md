# Graph Report - gestao_serv  (2026-07-19)

## Corpus Check
- 64 files · ~54,184 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 322 nodes · 347 edges · 53 communities (41 shown, 12 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b2196587`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- main.jsx
- dependencies
- devDependencies
- Financial.jsx
- payables-victor.js
- .oxlintrc.json
- Dashboard.jsx
- invoices.js
- payable-payments.js
- time-entries.js
- clients.js
- cron-sync.js
- ingest-email.js
- receivables.js
- vercel.json
- contract-months.js
- contracts.js
- financial-rules.js
- CLAUDE.md — Contexto do Projeto gestao_serv
- 3. Banco de dados — tabelas, colunas e tipos
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
1. `3. Banco de dados — tabelas, colunas e tipos` - 16 edges
2. `react` - 14 edges
3. `CLAUDE.md — Contexto do Projeto gestao_serv` - 13 edges
4. `What You Must Do When Invoked` - 12 edges
5. `/graphify` - 11 edges
6. `graphify reference: extra exports and benchmark` - 8 edges
7. `6. Regras de negócio financeiro` - 8 edges
8. `handler()` - 6 edges
9. `pagarDistribuido()` - 6 edges
10. `Financial()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `handler()` --calls--> `calcular()`  [EXTRACTED]
  api/recalc-time-entries.js → api/time-entries.js
- `Layout()` --calls--> `useNotifications()`  [EXTRACTED]
  src/components/Layout.jsx → src/hooks/useNotifications.js

## Import Cycles
- None detected.

## Communities (53 total, 12 thin omitted)

### Community 0 - "main.jsx"
Cohesion: 0.12
Nodes (19): react, companies, Layout(), useNotifications(), Clientes(), COMPANIES, emptyForm, Contracts() (+11 more)

### Community 1 - "dependencies"
Cohesion: 0.11
Nodes (19): dotenv, exceljs, imap-simple, mailparser, @neondatabase/serverless, dependencies, dotenv, exceljs (+11 more)

### Community 2 - "devDependencies"
Cohesion: 0.07
Nodes (26): autoprefixer, oxlint, devDependencies, autoprefixer, oxlint, postcss, tailwindcss, @types/react (+18 more)

### Community 3 - "Financial.jsx"
Cohesion: 0.12
Nodes (18): CopyButton(), Billing(), months, SPLIT_MODE_LABEL, splitPct(), EMPTY_RECEIVE_CATS, EMPTY_VICTOR_CATS, FINANCE_ENDPOINTS (+10 more)

### Community 5 - "payables-victor.js"
Cohesion: 0.42
Nodes (8): CATS, consumir(), estornarSessao(), handler(), ordenar(), pagarDistribuido(), r2(), recalcVictorParent()

### Community 6 - ".oxlintrc.json"
Cohesion: 0.25
Nodes (7): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, oxc, warn

### Community 7 - "Dashboard.jsx"
Cohesion: 0.36
Nodes (7): ABERTAS, COMPANIES, Dashboard(), decimalToHHMM(), FinanceBlock(), fmt(), months

### Community 8 - "invoices.js"
Cohesion: 0.44
Nodes (8): calcAgenda(), calcContrato(), calcProjeto(), handler(), loadProjeto(), paymentPeriod(), resolvePct(), splitPct()

### Community 9 - "payable-payments.js"
Cohesion: 0.70
Nodes (4): handler(), periodFromDate(), recalcParent(), TABLES

### Community 10 - "time-entries.js"
Cohesion: 0.46
Nodes (6): handler(), calcular(), calcularHoras(), handler(), splitPct(), timeToDecimal()

### Community 39 - "CLAUDE.md — Contexto do Projeto gestao_serv"
Cohesion: 0.07
Nodes (26): 10. Pendências conhecidas, 1. Visão geral, 2. Empresas e clientes, 4. APIs ativas (`/api/`), 5. Telas (`/src/pages/`), 6. Regras de negócio financeiro, 7. Contratos existentes no banco, 8. Workflow de desenvolvimento (+18 more)

### Community 40 - "3. Banco de dados — tabelas, colunas e tipos"
Cohesion: 0.12
Nodes (16): 3. Banco de dados — tabelas, colunas e tipos, `clients`, `companies`, `contract_months`, `contracts`, `demands`, `email_rules`, `financial_rules` (+8 more)

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
- **132 isolated node(s):** `$schema`, `oxc`, `react/rules-of-hooks`, `warn`, `TABLES` (+127 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `main.jsx` to `Financial.jsx`, `.oxlintrc.json`, `Dashboard.jsx`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `CLAUDE.md — Contexto do Projeto gestao_serv` connect `CLAUDE.md — Contexto do Projeto gestao_serv` to `3. Banco de dados — tabelas, colunas e tipos`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `devDependencies`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **What connects `$schema`, `oxc`, `react/rules-of-hooks` to the rest of the system?**
  _132 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `main.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.11576354679802955 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._