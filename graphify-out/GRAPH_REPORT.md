# Graph Report - C:\projetos\gestao_serv  (2026-07-19)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 193 nodes · 219 edges · 39 communities (34 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `55b43412`
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

## God Nodes (most connected - your core abstractions)
1. `react` - 14 edges
2. `pagarDistribuido()` - 6 edges
3. `Financial()` - 6 edges
4. `scripts` - 5 edges
5. `handler()` - 4 edges
6. `Dashboard()` - 4 edges
7. `plugins` - 3 edges
8. `rules` - 3 edges
9. `resolvePct()` - 3 edges
10. `calcContrato()` - 3 edges

## Surprising Connections (you probably didn't know these)
- `Layout()` --calls--> `useNotifications()`  [EXTRACTED]
  src/components/Layout.jsx → src/hooks/useNotifications.js

## Import Cycles
- None detected.

## Communities (39 total, 5 thin omitted)

### Community 0 - "main.jsx"
Cohesion: 0.11
Nodes (20): react, CopyButton(), companies, Layout(), useNotifications(), Billing(), months, Clientes() (+12 more)

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
Cohesion: 0.52
Nodes (5): calcAgenda(), calcContrato(), handler(), paymentPeriod(), resolvePct()

### Community 9 - "payable-payments.js"
Cohesion: 0.70
Nodes (4): handler(), periodFromDate(), recalcParent(), TABLES

### Community 10 - "time-entries.js"
Cohesion: 0.70
Nodes (4): calcular(), calcularHoras(), handler(), timeToDecimal()

## Knowledge Gaps
- **49 isolated node(s):** `$schema`, `oxc`, `react/rules-of-hooks`, `warn`, `TABLES` (+44 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `main.jsx` to `Financial.jsx`, `.oxlintrc.json`, `Dashboard.jsx`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `package.json`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `devDependencies` to `package.json`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **What connects `$schema`, `oxc`, `react/rules-of-hooks` to the rest of the system?**
  _49 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `main.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.11397849462365592 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._