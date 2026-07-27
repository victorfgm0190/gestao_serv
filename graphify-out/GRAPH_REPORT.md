# Graph Report - gestao_serv  (2026-07-27)

## Corpus Check
- 78 files · ~78,967 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 458 nodes · 827 edges · 31 communities (26 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7f9d165f`
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
- FiscalObligations.jsx
- invoices.js
- payable-payments.js
- time-entries.js
- 3. Banco de dados — tabelas, colunas e tipos
- cron-sync.js
- fiscal-payments.js
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
1. `requireAuth()` - 44 edges
2. `3. Banco de dados — tabelas, colunas e tipos` - 19 edges
3. `react` - 18 edges
4. `handler()` - 16 edges
5. `round2()` - 13 edges
6. `num()` - 13 edges
7. `valorDevido()` - 13 edges
8. `CLAUDE.md — Contexto do Projeto gestao_serv` - 13 edges
9. `distribuir()` - 12 edges
10. `recalcularObrigacao()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `handler()` --calls--> `requireAuth()`  [EXTRACTED]
  api/demands.js → lib/auth.js
- `handler()` --calls--> `requireAuth()`  [EXTRACTED]
  api/email-rules.js → lib/auth.js
- `handler()` --calls--> `requireAuth()`  [EXTRACTED]
  api/export-os.js → lib/auth.js
- `acumular12()` --calls--> `proLaboreDoMes()`  [EXTRACTED]
  api/fiscal-obligations.js → lib/taxCalc.js
- `calcularApuracao()` --calls--> `calcularImpostos()`  [EXTRACTED]
  api/fiscal-obligations.js → lib/taxCalc.js

## Import Cycles
- None detected.

## Communities (31 total, 5 thin omitted)

### Community 0 - "main.jsx"
Cohesion: 0.08
Nodes (36): react, companies, Layout(), useNotifications(), clearToken(), getToken(), getUser(), installFetchInterceptor() (+28 more)

### Community 1 - "dependencies"
Cohesion: 0.11
Nodes (19): dotenv, exceljs, imap-simple, mailparser, @neondatabase/serverless, dependencies, dotenv, exceljs (+11 more)

### Community 2 - "devDependencies"
Cohesion: 0.07
Nodes (26): autoprefixer, oxlint, devDependencies, autoprefixer, oxlint, postcss, tailwindcss, @types/react (+18 more)

### Community 3 - "Financial.jsx"
Cohesion: 0.08
Nodes (36): aliquotaEfetiva(), calcINSS(), calcularImpostos(), faixaFor(), parametrosFiscais(), PARAMS_PADRAO, proLaboreDoMes(), r2() (+28 more)

### Community 4 - "6. Regras de negócio financeiro"
Cohesion: 0.16
Nodes (37): acumular12(), apurar(), brl(), calcularApuracao(), chaveCompetencia(), chaveOrdinal(), contextoRedistribuicao(), corrigirEscritorio() (+29 more)

### Community 5 - "payables-victor.js"
Cohesion: 0.24
Nodes (16): handler(), periodFromDate(), recalcParent(), TABLES, estornarSessao(), handler(), pagarDistribuido(), recalcVictorParent() (+8 more)

### Community 6 - ".oxlintrc.json"
Cohesion: 0.25
Nodes (7): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, oxc, warn

### Community 7 - "FiscalObligations.jsx"
Cohesion: 0.18
Nodes (12): fmt(), MemoriaCalculo(), Passo(), KIND_LABEL, dataBR(), FiscalObligations(), fmt(), KIND_ICON (+4 more)

### Community 8 - "invoices.js"
Cohesion: 0.23
Nodes (13): calcAgenda(), calcContrato(), calcProjeto(), handler(), loadProjeto(), paymentPeriod(), requireNfDoContrato(), resolvePct() (+5 more)

### Community 9 - "payable-payments.js"
Cohesion: 0.09
Nodes (31): handler(), parseCompanyIds(), handler(), splitPct(), handler(), requerNf(), splitPct(), handler() (+23 more)

### Community 10 - "time-entries.js"
Cohesion: 0.24
Nodes (11): estornarPeriodo(), handler(), num(), handler(), handler(), calcular(), calcularHoras(), handler() (+3 more)

### Community 11 - "3. Banco de dados — tabelas, colunas e tipos"
Cohesion: 0.09
Nodes (22): 3. Banco de dados — tabelas, colunas e tipos, Apuração fiscal (DAS/INSS/Honorários) — criadas 2026-07-25, `clients`, `companies`, `company_settings` (configuração fiscal por empresa), `contract_months`, `contracts`, `demands` (+14 more)

### Community 12 - "cron-sync.js"
Cohesion: 0.44
Nodes (7): handler(), handler(), classify(), fetchEmailsFromAccount(), imperiumAccounts(), ingestAccounts(), makeImapConfig()

### Community 14 - "fiscal-payments.js"
Cohesion: 0.68
Nodes (7): estornar(), handler(), listar(), num(), pagar(), round2(), saldoAberto()

### Community 39 - "CLAUDE.md — Contexto do Projeto gestao_serv"
Cohesion: 0.06
Nodes (32): 10. Pendências conhecidas, 1. Visão geral, 2. Empresas e clientes, 4. APIs ativas (`/api/`), 5. Telas (`/src/pages/`), 6. Regras de negócio financeiro, 7. Contratos existentes no banco, 8. Workflow de desenvolvimento (+24 more)

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
- **150 isolated node(s):** `$schema`, `oxc`, `react/rules-of-hooks`, `warn`, `TABLES` (+145 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `requireAuth()` connect `payable-payments.js` to `6. Regras de negócio financeiro`, `payables-victor.js`, `invoices.js`, `time-entries.js`, `cron-sync.js`, `fiscal-payments.js`?**
  _High betweenness centrality (0.120) - this node is a cross-community bridge._
- **Why does `react` connect `main.jsx` to `Financial.jsx`, `.oxlintrc.json`, `FiscalObligations.jsx`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Why does `calcularImpostos()` connect `Financial.jsx` to `6. Regras de negócio financeiro`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **What connects `$schema`, `oxc`, `react/rules-of-hooks` to the rest of the system?**
  _150 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `main.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.07908163265306123 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._