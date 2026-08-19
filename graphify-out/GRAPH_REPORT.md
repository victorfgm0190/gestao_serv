# Graph Report - gestao_serv  (2026-08-19)

## Corpus Check
- 152 files · ~209,274 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1053 nodes · 2068 edges · 74 communities (60 shown, 14 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 9 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c899fa63`
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
- 8. Workflow de desenvolvimento
- Visão 🔎 Rastreio e uso do crédito de compensação — 2026-08-15
- imap-simple
- mailparser
- CLAUDE.md — Contexto do Projeto gestao_serv
- @neondatabase/serverless
- What You Must Do When Invoked
- @xmldom/xmldom
- graphify reference: extra exports and benchmark
- graphify reference: query, path, explain
- graphify reference: add a URL and watch a folder
- graphify reference: commit hook and native CLAUDE.md integration
- graphify reference: incremental update and cluster-only
- React + Vite
- graphify reference: GitHub clone and cross-repo merge
- graphify reference: transcribe video and audio
- Clientes.jsx
- Login.jsx
- CLAUDE.md
- extraction-spec.md
- dotenv
- exceljs
- pdfkit
- react
- todayBR
- react
- main.jsx
- Dashboard.jsx
- nfse-emitter-settings.js
- MemoriaCalculo.jsx
- NFSeSettings.jsx
- Contracts.jsx
- Clientes.jsx
- EmailRules.jsx
- imap-simple
- nfse-events.js
- dotenv
- payment-source-tracker.js
- contracts.js

## God Nodes (most connected - your core abstractions)
1. `requireAuth()` - 78 edges
2. `r2()` - 31 edges
3. `react` - 27 edges
4. `6. Regras de negócio financeiro` - 25 edges
5. `3. Banco de dados — tabelas, colunas e tipos` - 24 edges
6. `montarDPS()` - 19 edges
7. `valorDevido()` - 17 edges
8. `Financial()` - 17 edges
9. `handler()` - 16 edges
10. `Breakdown por cliente na aba Pagar Victor (`lib/victor-breakdown.js`) — 2026-08-10` - 16 edges

## Surprising Connections (you probably didn't know these)
- `chamar()` --calls--> `handler()`  [EXTRACTED]
  lib/nfse-emit.test.js → api/nfse-emit.js
- `chamar()` --calls--> `handler()`  [EXTRACTED]
  lib/nfse-substituir.test.js → api/nfse-substituir.js
- `Billing()` --indirect_call--> `base()`  [INFERRED]
  src/pages/Billing.jsx → lib/nfse-substituir.test.js
- `Financial()` --indirect_call--> `base()`  [INFERRED]
  src/pages/Financial.jsx → lib/nfse-substituir.test.js
- `handler()` --calls--> `requireAuth()`  [EXTRACTED]
  api/consultar-cnpj.js → lib/auth.js

## Import Cycles
- None detected.

## Communities (74 total, 14 thin omitted)

### Community 0 - "main.jsx"
Cohesion: 0.21
Nodes (13): companies, Layout(), useNotifications(), clearToken(), getToken(), getUser(), installFetchInterceptor(), isLoggedIn() (+5 more)

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
Cohesion: 0.09
Nodes (60): acumular12(), apurar(), brl(), calcularApuracao(), chaveCompetencia(), chaveOrdinal(), contextoRedistribuicao(), corrigirEscritorio() (+52 more)

### Community 5 - "payables-victor.js"
Cohesion: 0.06
Nodes (79): handler(), periodFromDate(), recalcParent(), TABLES, calcularDistribuicao(), estornarSessao(), handler(), pagarCompensacao() (+71 more)

### Community 6 - ".oxlintrc.json"
Cohesion: 0.25
Nodes (7): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, oxc, warn

### Community 7 - "Financial.jsx"
Cohesion: 0.07
Nodes (25): ALL_VICTOR_CATEGORIES, BREAKDOWN_CATEGORIA_MOTOR, BREAKDOWN_CATEGORIAS, BREAKDOWN_LABEL, CAT_LABEL, DIST_ENTRADA_LINHA, DIST_KIND_LINHA, DIST_LINHA_LABEL (+17 more)

### Community 8 - "valorDevido"
Cohesion: 0.17
Nodes (8): buscar(), handler(), HOSTS, NFSeADNClient, URLS_ADN, URLS_SEFIN, extrairChaves(), NFSeSigner

### Community 9 - "payable-payments.js"
Cohesion: 0.11
Nodes (18): handler(), parseCompanyIds(), handler(), splitPct(), handler(), requerNf(), splitPct(), handler() (+10 more)

### Community 10 - "time-entries.js"
Cohesion: 0.14
Nodes (24): estornarPeriodo(), handler(), num(), apurarCompetencia(), calcAgenda(), calcContrato(), calcProjeto(), competenciaDaFatura() (+16 more)

### Community 11 - "taxCalc.js"
Cohesion: 0.10
Nodes (21): 3. Banco de dados — tabelas, colunas e tipos, `clients`, `companies`, `company_settings` (configuração fiscal por empresa), Compensação do Fabrício (`lib/fabricio-compensation.js`) — 2026-08-15, `contract_months`, `contracts`, `demands` (+13 more)

### Community 12 - "CryptoManager"
Cohesion: 0.11
Nodes (8): CryptoManager, adulterado, bufferDecrypt, bufferOriginal, { encrypted: encBin, iv: ivBin }, { encrypted: encSenha, iv: ivSenha }, senhaDecrypt, thumbprint

### Community 13 - "export-payables-fabricio.js"
Cohesion: 0.21
Nodes (19): fiscalParts(), handler(), MESES, num(), periodo(), fetchBreakdowns(), fetchPreviews(), handler() (+11 more)

### Community 14 - "cron-nfse-check.test.js"
Cohesion: 0.12
Nodes (17): destinatarioDe(), DESTINATARIOS, handler(), handler(), chamar(), hoje, naoVigente, recemVencido (+9 more)

### Community 16 - "FiscalObligations.jsx"
Cohesion: 0.08
Nodes (28): handler(), brl(), DANFSEGenerator, formatarCEP(), formatarCompetencia(), formatarData(), formatarDocumento(), ou() (+20 more)

### Community 17 - "payment-source-tracker.js"
Cohesion: 0.05
Nodes (45): adulterado, assinado, attrs, cert, { certificatePem }, chamar(), comCpf, doc (+37 more)

### Community 18 - "Diagnóstico — "a cascata está zerando o saldo do Pharmalog com os impostos""
Cohesion: 0.18
Nodes (10): 1. Em qual arquivo/função os impostos entram na cascata?, 2. Qual é a ordem de consumo hoje?, 3. Os impostos têm flag/status diferente dos outros?, 4. Para corrigir, o que precisa mudar?, Achado secundário (bug real, independente), Arquivos a tocar quando a decisão vier, Diagnóstico — "a cascata está zerando o saldo do Pharmalog com os impostos", Estado real hoje (produção, 01/2026) (+2 more)

### Community 19 - "email-ingest.js"
Cohesion: 0.08
Nodes (24): assinaturaConfere(), config, EVENTO_DE, handler(), lerCorpoCru(), MAPA_STATUS, at, builder (+16 more)

### Community 20 - "dependencies"
Cohesion: 0.12
Nodes (17): axios, imap-simple, @neondatabase/serverless, node-forge, nodemailer, dependencies, axios, imap-simple (+9 more)

### Community 22 - "Billing.jsx"
Cohesion: 0.15
Nodes (16): cnpjValido(), handler(), mapearCNPJ(), ouNulo(), soDigitos(), chamar(), formulario, m (+8 more)

### Community 23 - "taxCalc.js"
Cohesion: 0.50
Nodes (4): 2. Empresas e clientes, Clientes Imperium (company_id = 2), Clientes Lumen (company_id = 1), Empresas (tabela `companies`)

### Community 24 - "Financial"
Cohesion: 0.29
Nodes (13): handler(), handler(), b64url(), checkMasterCredentials(), eq(), hashPassword(), isMasterUsername(), requireMaster() (+5 more)

### Community 25 - "package.json"
Cohesion: 0.20
Nodes (9): name, private, scripts, build, dev, lint, preview, type (+1 more)

### Community 26 - "scripts"
Cohesion: 0.50
Nodes (4): Apuração fiscal (DAS/INSS/Honorários) — criadas 2026-07-25, `fiscal_allocations` — rateio por cliente, `fiscal_obligations` — o que a empresa deve, por competência, `fiscal_payments` — quitação da guia (múltiplos pagamentos)

### Community 27 - "exceljs"
Cohesion: 0.50
Nodes (4): Cascata de origem ao pagar imposto — rateio → Lucro → Serviço (2026-08-15), "Distribuir guia pelo rateio" na visão Cards — 2026-08-15, ⚠️ OPÇÃO 2 — a absorção foi REATIVADA, agora rastreada (2026-08-15), Rastreamento da absorção (`destination_category = 'impostos'`)

### Community 28 - "node-forge"
Cohesion: 0.67
Nodes (3): 4. APIs ativas (`/api/`), 🔒 Autenticação (obrigatória em endpoints novos), Endpoints de setup/migração one-off (standalone)

### Community 29 - "react-dom"
Cohesion: 0.28
Nodes (4): handler(), handler(), sql, token

### Community 31 - "8. Workflow de desenvolvimento"
Cohesion: 0.67
Nodes (3): 8. Workflow de desenvolvimento, Estorno e o abatimento fiscal (`lib/fiscal-unlink.js`) — 2026-07-26, ⚠️ Não existe status `estornado`

### Community 33 - "imap-simple"
Cohesion: 0.23
Nodes (8): dataBR(), FiscalObligations(), fmt(), KIND_ICON, months, pct(), STATUS_STYLE, tudoQuitadoSemGuia()

### Community 39 - "CLAUDE.md — Contexto do Projeto gestao_serv"
Cohesion: 0.15
Nodes (12): 10. Pendências conhecidas, 1. Visão geral, 5. Telas (`/src/pages/`), 7. Contratos existentes no banco, 9. APIs legadas / mortas, CLAUDE.md — Contexto do Projeto gestao_serv, Dependências principais, graphify (+4 more)

### Community 40 - "@neondatabase/serverless"
Cohesion: 0.22
Nodes (10): handler(), CAMPOS_EMITENTE, CAMPOS_TOMADOR, faltantes(), nomes, sql, src, token (+2 more)

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

### Community 51 - "Clientes.jsx"
Cohesion: 0.44
Nodes (7): handler(), handler(), classify(), fetchEmailsFromAccount(), imperiumAccounts(), ingestAccounts(), makeImapConfig()

### Community 52 - "Login.jsx"
Cohesion: 0.20
Nodes (12): t(), alocarCascataDist(), cents(), Financial(), modoDaCategoria(), parseNotesToAmounts(), proportionalCats(), RECEIVE_INPUTS (+4 more)

### Community 55 - "dotenv"
Cohesion: 0.18
Nodes (13): CAMPOS, handler(), numero(), soDigitos(), texto(), BADGES, dataHora(), ICONES (+5 more)

### Community 58 - "react"
Cohesion: 0.24
Nodes (8): baixar(), handler(), ROTULOS_OPERACAO, STATUS_OPERACAO, chamar(), criados, sql, TOKEN

### Community 59 - "todayBR"
Cohesion: 0.25
Nodes (6): attrs, cert, info, keys, p12Der, pfxBuffer

### Community 60 - "react"
Cohesion: 0.14
Nodes (17): brl(), MOTIVOS, NFSeAcoesModal(), MOTIVOS, NFSeCancelModal(), brl(), NFSeReemitirModal(), CORES (+9 more)

### Community 61 - "main.jsx"
Cohesion: 0.16
Nodes (11): setToken(), Demands(), STATUS_COLORS, STATUS_OPTIONS, EmailRules(), RULE_TYPES, FinancialRules(), Login() (+3 more)

### Community 62 - "Dashboard.jsx"
Cohesion: 0.36
Nodes (7): ABERTAS, COMPANIES, Dashboard(), decimalToHHMM(), FinanceBlock(), fmt(), months

### Community 63 - "nfse-emitter-settings.js"
Cohesion: 0.33
Nodes (5): base(), Contracts(), EMPTY_FORM, months, SPLIT_MODE_LABEL

### Community 64 - "MemoriaCalculo.jsx"
Cohesion: 0.18
Nodes (13): PARAMS_PADRAO, react, CopyButton(), brl(), NFSeEmitirModal(), todayBR(), Billing(), fetchFiscalParams() (+5 more)

### Community 65 - "NFSeSettings.jsx"
Cohesion: 0.60
Nodes (3): bufferParaBase64(), dataBR(), NFSeSettings()

### Community 66 - "Contracts.jsx"
Cohesion: 0.22
Nodes (11): aplicarDados(), useCNPJConsulta(), CAMPOS_FISCAIS, Clientes(), COMPANIES, DE_PARA_CNPJ, emptyForm, CAMPOS_TEXTO (+3 more)

### Community 67 - "Clientes.jsx"
Cohesion: 0.32
Nodes (6): handler(), chamar(), criados, criarEmissao(), sql, TOKEN

### Community 69 - "imap-simple"
Cohesion: 0.53
Nodes (4): fmt(), MemoriaCalculo(), Passo(), KIND_LABEL

### Community 70 - "nfse-events.js"
Cohesion: 0.27
Nodes (16): CANCELAVEIS, handler(), handler(), handler(), handler(), SIMPLES_TRAVADO, SUBSTITUIVEIS, EVENTOS (+8 more)

### Community 72 - "payment-source-tracker.js"
Cohesion: 0.31
Nodes (10): DESTINO_POR_CATEGORIA, linhaDeSaldoDe(), movimento(), movimentosDaAbsorcao(), movimentosDoConsumo(), movimentosDoPlano(), num(), quebrarConsumo() (+2 more)

### Community 73 - "contracts.js"
Cohesion: 0.67
Nodes (3): handler(), listarEventos(), ROTULOS

## Knowledge Gaps
- **378 isolated node(s):** `$schema`, `oxc`, `react/rules-of-hooks`, `warn`, `DESTINATARIOS` (+373 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `requireAuth()` connect `payable-payments.js` to `Clientes.jsx`, `6. Regras de negócio financeiro`, `payables-victor.js`, `nfse-events.js`, `valorDevido`, `contracts.js`, `time-entries.js`, `@neondatabase/serverless`, `export-payables-fabricio.js`, `cron-nfse-check.test.js`, `FiscalObligations.jsx`, `Clientes.jsx`, `Billing.jsx`, `dotenv`, `Financial`, `react`, `react-dom`?**
  _High betweenness centrality (0.130) - this node is a cross-community bridge._
- **Why does `react` connect `MemoriaCalculo.jsx` to `main.jsx`, `NFSeSettings.jsx`, `Contracts.jsx`, `imap-simple`, `.oxlintrc.json`, `Financial.jsx`, `dotenv`, `react`, `main.jsx`, `Dashboard.jsx`, `nfse-emitter-settings.js`?**
  _High betweenness centrality (0.067) - this node is a cross-community bridge._
- **Why does `Financial()` connect `Login.jsx` to `MemoriaCalculo.jsx`, `6. Regras de negócio financeiro`, `imap-simple`, `Financial.jsx`, `FiscalObligations.jsx`, `main.jsx`, `nfse-emitter-settings.js`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **What connects `$schema`, `oxc`, `react/rules-of-hooks` to the rest of the system?**
  _378 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._
- **Should `Financial.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.045454545454545456 - nodes in this community are weakly interconnected._