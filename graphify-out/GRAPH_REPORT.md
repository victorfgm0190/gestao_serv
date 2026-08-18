# Graph Report - gestao_serv  (2026-08-18)

## Corpus Check
- 104 files · ~165,342 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 747 nodes · 1403 edges · 47 communities (37 shown, 10 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.6)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1603cbbb`
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
- cron-nfse-check.test.js
- vercel.json
- FiscalObligations.jsx
- payment-source-tracker.js
- Diagnóstico — "a cascata está zerando o saldo do Pharmalog com os impostos"
- email-ingest.js
- dependencies
- destinoDe
- Billing.jsx
- taxCalc.js
- Financial
- package.json
- scripts
- exceljs
- node-forge
- react-dom
- react-router-dom
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
1. `requireAuth()` - 50 edges
2. `r2()` - 31 edges
3. `6. Regras de negócio financeiro` - 25 edges
4. `3. Banco de dados — tabelas, colunas e tipos` - 24 edges
5. `react` - 19 edges
6. `valorDevido()` - 17 edges
7. `handler()` - 16 edges
8. `Breakdown por cliente na aba Pagar Victor (`lib/victor-breakdown.js`) — 2026-08-10` - 16 edges
9. `pagarComRateio()` - 15 edges
10. `recalcularObrigacao()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `chamar()` --calls--> `handler()`  [EXTRACTED]
  lib/cron-nfse-check.test.js → api/cron-nfse-check.js
- `handler()` --calls--> `requireAuth()`  [EXTRACTED]
  api/demands.js → lib/auth.js
- `handler()` --calls--> `requireAuth()`  [EXTRACTED]
  api/email-rules.js → lib/auth.js
- `handler()` --calls--> `requireAuth()`  [EXTRACTED]
  api/export-os.js → lib/auth.js
- `handler()` --calls--> `requireAuth()`  [EXTRACTED]
  api/export-payables-fabricio.js → lib/auth.js

## Import Cycles
- None detected.

## Communities (47 total, 10 thin omitted)

### Community 0 - "main.jsx"
Cohesion: 0.07
Nodes (39): react, companies, Layout(), useNotifications(), clearToken(), getToken(), getUser(), installFetchInterceptor() (+31 more)

### Community 1 - "dependencies"
Cohesion: 0.06
Nodes (30): 1.1 `contracts`, 1.2 `financial_rules`, 1.3 `invoices` — como referencia regra/contrato, 1.4 Índices — panorama, 1.5 ⚠️ CLAUDE.md está defasado, 1. Schema Neon — DDL atual, 2.1 `api/contracts.js`, 2.2 `api/financial-rules.js` (+22 more)

### Community 2 - "devDependencies"
Cohesion: 0.12
Nodes (17): autoprefixer, oxlint, devDependencies, autoprefixer, oxlint, postcss, tailwindcss, @types/react (+9 more)

### Community 3 - "Financial.jsx"
Cohesion: 0.05
Nodes (44): 6. Regras de negócio financeiro, ⚠️ "A cascata parou no meio do Pharmalog" — não parou (2026-08-15), 🐞 A regra financeira vinha do cliente, sorteada pela heap — corrigido 2026-08-10, ⚠️ ABSORVEU não é consumo — o lucro que o imposto comeu, Breakdown por cliente na aba Pagar Victor (`lib/victor-breakdown.js`) — 2026-08-10, Cascata do lucro persistida — 2026-07-30, Composição fiscal na aba Pagar Victor — 2026-07-28, Contrato fixo (`billing_type = 'contract'` ou `'mensal'`) (+36 more)

### Community 4 - "6. Regras de negócio financeiro"
Cohesion: 0.13
Nodes (43): acumular12(), apurar(), brl(), calcularApuracao(), chaveCompetencia(), chaveOrdinal(), contextoRedistribuicao(), corrigirEscritorio() (+35 more)

### Community 5 - "payables-victor.js"
Cohesion: 0.06
Nodes (75): handler(), periodFromDate(), recalcParent(), TABLES, calcularDistribuicao(), estornarSessao(), handler(), pagarCompensacao() (+67 more)

### Community 6 - ".oxlintrc.json"
Cohesion: 0.25
Nodes (7): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, oxc, warn

### Community 7 - "Financial.jsx"
Cohesion: 0.07
Nodes (27): ALL_VICTOR_CATEGORIES, BREAKDOWN_CATEGORIA_MOTOR, BREAKDOWN_CATEGORIAS, BREAKDOWN_LABEL, CAT_LABEL, DIST_ENTRADA_LINHA, DIST_KIND_LINHA, DIST_LINHA_LABEL (+19 more)

### Community 8 - "valorDevido"
Cohesion: 0.49
Nodes (10): absorverDelta(), agregado(), aplicarDelta(), cascataDoLucro(), consolidar(), linha(), num(), r2() (+2 more)

### Community 9 - "payable-payments.js"
Cohesion: 0.09
Nodes (33): handler(), parseCompanyIds(), handler(), splitPct(), handler(), requerNf(), splitPct(), handler() (+25 more)

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

### Community 14 - "cron-nfse-check.test.js"
Cohesion: 0.09
Nodes (23): destinatarioDe(), DESTINATARIOS, handler(), handler(), chamar(), hoje, naoVigente, recemVencido (+15 more)

### Community 16 - "FiscalObligations.jsx"
Cohesion: 0.18
Nodes (12): fmt(), MemoriaCalculo(), Passo(), KIND_LABEL, dataBR(), FiscalObligations(), fmt(), KIND_ICON (+4 more)

### Community 17 - "payment-source-tracker.js"
Cohesion: 0.31
Nodes (10): DESTINO_POR_CATEGORIA, linhaDeSaldoDe(), movimento(), movimentosDaAbsorcao(), movimentosDoConsumo(), movimentosDoPlano(), num(), quebrarConsumo() (+2 more)

### Community 18 - "Diagnóstico — "a cascata está zerando o saldo do Pharmalog com os impostos""
Cohesion: 0.18
Nodes (10): 1. Em qual arquivo/função os impostos entram na cascata?, 2. Qual é a ordem de consumo hoje?, 3. Os impostos têm flag/status diferente dos outros?, 4. Para corrigir, o que precisa mudar?, Achado secundário (bug real, independente), Arquivos a tocar quando a decisão vier, Diagnóstico — "a cascata está zerando o saldo do Pharmalog com os impostos", Estado real hoje (produção, 01/2026) (+2 more)

### Community 19 - "email-ingest.js"
Cohesion: 0.44
Nodes (7): handler(), handler(), classify(), fetchEmailsFromAccount(), imperiumAccounts(), ingestAccounts(), makeImapConfig()

### Community 20 - "dependencies"
Cohesion: 0.13
Nodes (15): dotenv, imap-simple, mailparser, @neondatabase/serverless, nodemailer, dependencies, dotenv, imap-simple (+7 more)

### Community 22 - "Billing.jsx"
Cohesion: 0.22
Nodes (10): parametrosFiscais(), CopyButton(), todayBR(), Billing(), fetchFiscalParams(), months, SPLIT_MODE_LABEL, splitPct() (+2 more)

### Community 23 - "taxCalc.js"
Cohesion: 0.24
Nodes (12): aliquotaEfetiva(), calcINSS(), calcularImpostos(), faixaFor(), PARAMS_PADRAO, proLaboreDoMes(), r2(), SIMPLES_III (+4 more)

### Community 24 - "Financial"
Cohesion: 0.28
Nodes (9): alocarCascataDist(), cents(), Financial(), modoDaCategoria(), parseNotesToAmounts(), proportionalCats(), RECEIVE_INPUTS, RECEIVE_VICTOR_CATEGORIES (+1 more)

### Community 25 - "package.json"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 26 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, build, dev, lint, preview

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
- **270 isolated node(s):** `$schema`, `oxc`, `react/rules-of-hooks`, `warn`, `DESTINATARIOS` (+265 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `requireAuth()` connect `payable-payments.js` to `6. Regras de negócio financeiro`, `payables-victor.js`, `time-entries.js`, `export-payables-fabricio.js`, `cron-nfse-check.test.js`, `email-ingest.js`?**
  _High betweenness centrality (0.121) - this node is a cross-community bridge._
- **Why does `react` connect `main.jsx` to `.oxlintrc.json`, `Financial.jsx`, `FiscalObligations.jsx`, `Billing.jsx`, `taxCalc.js`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **What connects `$schema`, `oxc`, `react/rules-of-hooks` to the rest of the system?**
  _270 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `main.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.07127882599580712 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._
- **Should `Financial.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.045454545454545456 - nodes in this community are weakly interconnected._