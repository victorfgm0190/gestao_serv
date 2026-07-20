# Graph Report - gestao_serv  (2026-07-19)

## Corpus Check
- 63 files · ~53,177 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 314 nodes · 330 edges · 55 communities (46 shown, 9 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ffff0247`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- main.jsx
- dependencies
- devDependencies
- Financial.jsx
- package.json
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
- CLAUDE.md — Contexto do Projeto gestao_serv
- 3. Banco de dados — tabelas, colunas e tipos
- What You Must Do When Invoked
- /graphify
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
- `Layout()` --calls--> `useNotifications()`  [EXTRACTED]
  src/components/Layout.jsx → src/hooks/useNotifications.js

## Import Cycles
- None detected.

## Communities (55 total, 9 thin omitted)

### Community 0 - "main.jsx"
Cohesion: 0.10
Nodes (23): react, CopyButton(), companies, Layout(), useNotifications(), Billing(), months, SPLIT_MODE_LABEL (+15 more)

### Community 1 - "dependencies"
Cohesion: 0.11
Nodes (19): dotenv, exceljs, imap-simple, mailparser, @neondatabase/serverless, dependencies, dotenv, exceljs (+11 more)

### Community 2 - "devDependencies"
Cohesion: 0.12
Nodes (17): autoprefixer, oxlint, devDependencies, autoprefixer, oxlint, postcss, tailwindcss, @types/react (+9 more)

### Community 3 - "Financial.jsx"
Cohesion: 0.17
Nodes (13): EMPTY_RECEIVE_CATS, EMPTY_VICTOR_CATS, FINANCE_ENDPOINTS, Financial(), months, parseNotesToAmounts(), proportionalCats(), RECEIVE_LABEL_TO_KEY (+5 more)

### Community 4 - "package.json"
Cohesion: 0.20
Nodes (9): name, private, scripts, build, dev, lint, preview, type (+1 more)

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
Cohesion: 0.40
Nodes (8): calcAgenda(), calcContrato(), calcProjeto(), handler(), loadProjeto(), paymentPeriod(), resolvePct(), splitPct()

### Community 9 - "payable-payments.js"
Cohesion: 0.70
Nodes (4): handler(), periodFromDate(), recalcParent(), TABLES

### Community 10 - "time-entries.js"
Cohesion: 0.70
Nodes (4): calcular(), calcularHoras(), handler(), timeToDecimal()

### Community 39 - "CLAUDE.md — Contexto do Projeto gestao_serv"
Cohesion: 0.07
Nodes (26): 10. Pendências conhecidas, 1. Visão geral, 2. Empresas e clientes, 4. APIs ativas (`/api/`), 5. Telas (`/src/pages/`), 6. Regras de negócio financeiro, 7. Contratos existentes no banco, 8. Workflow de desenvolvimento (+18 more)

### Community 40 - "3. Banco de dados — tabelas, colunas e tipos"
Cohesion: 0.12
Nodes (16): 3. Banco de dados — tabelas, colunas e tipos, `clients`, `companies`, `contract_months`, `contracts`, `demands`, `email_rules`, `financial_rules` (+8 more)

### Community 41 - "What You Must Do When Invoked"
Cohesion: 0.13
Nodes (15): Part A - Structural extraction for code files, Part B - Semantic extraction (parallel subagents), Part C - Merge AST + semantic into final extraction, Step 0 - GitHub repos and multi-path merge (only if a URL or several paths), Step 1 - Ensure graphify is installed, Step 2.5 - Video and audio (only if video files detected), Step 2 - Detect files, Step 3 - Extract entities and relationships (+7 more)

### Community 42 - "/graphify"
Cohesion: 0.17
Nodes (11): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, PowerShell 5.1: Vertical scrolling stops working (+3 more)

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
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `main.jsx` to `Financial.jsx`, `.oxlintrc.json`, `Dashboard.jsx`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `CLAUDE.md — Contexto do Projeto gestao_serv` connect `CLAUDE.md — Contexto do Projeto gestao_serv` to `3. Banco de dados — tabelas, colunas e tipos`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `package.json`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **What connects `$schema`, `oxc`, `react/rules-of-hooks` to the rest of the system?**
  _132 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `main.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.09982174688057041 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._