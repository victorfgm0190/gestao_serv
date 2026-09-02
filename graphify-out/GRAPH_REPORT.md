# Graph Report - gestao_serv  (2026-09-01)

## Corpus Check
- 160 files · ~218,484 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1089 nodes · 2176 edges · 74 communities (58 shown, 16 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 10 edges (avg confidence: 0.74)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `54b7c221`
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
- payment-source-tracker.js
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
- EmailRules.jsx
- nfse-events.js
- dotenv
- payment-source-tracker.js
- mailparser

## God Nodes (most connected - your core abstractions)
1. `requireAuth()` - 80 edges
2. `r2()` - 31 edges
3. `react` - 29 edges
4. `6. Regras de negócio financeiro` - 27 edges
5. `3. Banco de dados — tabelas, colunas e tipos` - 24 edges
6. `montarDPS()` - 19 edges
7. `signToken()` - 17 edges
8. `valorDevido()` - 17 edges
9. `Financial()` - 17 edges
10. `handler()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `chamar()` --calls--> `handler()`  [EXTRACTED]
  lib/nfse-emit.test.js → api/nfse-emit.js
- `XmlPrevia()` --indirect_call--> `texto()`  [INFERRED]
  src/components/XmlPrevia.jsx → api/nfse-emitter-settings.js
- `chamar()` --calls--> `handler()`  [EXTRACTED]
  lib/nfse-substituir.test.js → api/nfse-substituir.js
- `Billing()` --indirect_call--> `base()`  [INFERRED]
  src/pages/Billing.jsx → lib/nfse-substituir.test.js
- `Financial()` --indirect_call--> `base()`  [INFERRED]
  src/pages/Financial.jsx → lib/nfse-substituir.test.js

## Import Cycles
- None detected.

## Communities (74 total, 16 thin omitted)

### Community 0 - "main.jsx"
Cohesion: 0.18
Nodes (17): react, companies, Layout(), useNotifications(), clearToken(), getToken(), getUser(), installFetchInterceptor() (+9 more)

### Community 1 - "dependencies"
Cohesion: 0.06
Nodes (30): 1.1 `contracts`, 1.2 `financial_rules`, 1.3 `invoices` — como referencia regra/contrato, 1.4 Índices — panorama, 1.5 ⚠️ CLAUDE.md está defasado, 1. Schema Neon — DDL atual, 2.1 `api/contracts.js`, 2.2 `api/financial-rules.js` (+22 more)

### Community 2 - "devDependencies"
Cohesion: 0.12
Nodes (17): autoprefixer, oxlint, devDependencies, autoprefixer, oxlint, postcss, tailwindcss, @types/react (+9 more)

### Community 3 - "Financial.jsx"
Cohesion: 0.04
Nodes (46): 6. Regras de negócio financeiro, ⚠️ "A cascata parou no meio do Pharmalog" — não parou (2026-08-15), 🐞 A regra financeira vinha do cliente, sorteada pela heap — corrigido 2026-08-10, ⚠️ ABSORVEU não é consumo — o lucro que o imposto comeu, Breakdown por cliente na aba Pagar Victor (`lib/victor-breakdown.js`) — 2026-08-10, Cascata do lucro persistida — 2026-07-30, Composição fiscal na aba Pagar Victor — 2026-07-28, Contrato fixo (`billing_type = 'contract'` ou `'mensal'`) (+38 more)

### Community 4 - "6. Regras de negócio financeiro"
Cohesion: 0.11
Nodes (53): acumular12(), apurar(), brl(), calcularApuracao(), chaveCompetencia(), chaveOrdinal(), contextoRedistribuicao(), corrigirEscritorio() (+45 more)

### Community 5 - "payables-victor.js"
Cohesion: 0.23
Nodes (9): MOTIVOS, brl(), MOTIVOS, NFSeAcoesModal(), NFSeCancelModal(), brl(), NFSeEmitirModal(), kb() (+1 more)

### Community 6 - ".oxlintrc.json"
Cohesion: 0.25
Nodes (7): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, oxc, warn

### Community 7 - "Financial.jsx"
Cohesion: 0.07
Nodes (28): CopyButton(), ALL_VICTOR_CATEGORIES, BREAKDOWN_CATEGORIA_MOTOR, BREAKDOWN_CATEGORIAS, BREAKDOWN_LABEL, CAT_LABEL, DIST_ENTRADA_LINHA, DIST_KIND_LINHA (+20 more)

### Community 9 - "payable-payments.js"
Cohesion: 0.12
Nodes (15): handler(), parseCompanyIds(), handler(), splitPct(), handler(), handler(), handler(), handler() (+7 more)

### Community 10 - "time-entries.js"
Cohesion: 0.10
Nodes (29): estornarPeriodo(), handler(), num(), apurarCompetencia(), calcAgenda(), calcContrato(), calcProjeto(), competenciaDaFatura() (+21 more)

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
Nodes (23): assinaturaConfere(), config, EVENTO_DE, handler(), lerCorpoCru(), MAPA_STATUS, at, builder (+15 more)

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
Cohesion: 0.14
Nodes (14): buscar(), handler(), HOSTS, consultarPortal(), handler(), URLS_ADN, URLS_SEFIN, sql (+6 more)

### Community 31 - "8. Workflow de desenvolvimento"
Cohesion: 0.67
Nodes (3): 8. Workflow de desenvolvimento, Estorno e o abatimento fiscal (`lib/fiscal-unlink.js`) — 2026-07-26, ⚠️ Não existe status `estornado`

### Community 33 - "imap-simple"
Cohesion: 0.18
Nodes (12): fmt(), MemoriaCalculo(), Passo(), KIND_LABEL, dataBR(), FiscalObligations(), fmt(), KIND_ICON (+4 more)

### Community 34 - "payment-source-tracker.js"
Cohesion: 0.31
Nodes (10): DESTINO_POR_CATEGORIA, linhaDeSaldoDe(), movimento(), movimentosDaAbsorcao(), movimentosDoConsumo(), movimentosDoPlano(), num(), quebrarConsumo() (+2 more)

### Community 39 - "CLAUDE.md — Contexto do Projeto gestao_serv"
Cohesion: 0.15
Nodes (12): 10. Pendências conhecidas, 1. Visão geral, 5. Telas (`/src/pages/`), 7. Contratos existentes no banco, 9. APIs legadas / mortas, CLAUDE.md — Contexto do Projeto gestao_serv, Dependências principais, graphify (+4 more)

### Community 40 - "@neondatabase/serverless"
Cohesion: 0.15
Nodes (17): handler(), handler(), SIMPLES_TRAVADO, SUBSTITUIVEIS, handler(), CAMPOS_EMITENTE, CAMPOS_TOMADOR, faltantes() (+9 more)

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
Cohesion: 0.24
Nodes (10): t(), alocarCascataDist(), cents(), Financial(), modoDaCategoria(), parseNotesToAmounts(), proportionalCats(), RECEIVE_INPUTS (+2 more)

### Community 55 - "dotenv"
Cohesion: 0.18
Nodes (13): CAMPOS, handler(), numero(), soDigitos(), texto(), BADGES, dataHora(), ICONES (+5 more)

### Community 58 - "react"
Cohesion: 0.13
Nodes (17): handler(), handler(), handler(), baixar(), handler(), sql, token, abrirOperacao() (+9 more)

### Community 59 - "todayBR"
Cohesion: 0.53
Nodes (3): todayBR(), decimalToHHMM(), TimeEntries()

### Community 60 - "react"
Cohesion: 0.18
Nodes (15): brl(), NFSeReemitirModal(), AvisoDeclaracao(), NFSeSincronizarModal(), CORES, dataHora(), ICONES, NFSeTimeline() (+7 more)

### Community 61 - "main.jsx"
Cohesion: 0.70
Nodes (4): handler(), requerNf(), splitPct(), tomadorId()

### Community 62 - "Dashboard.jsx"
Cohesion: 0.36
Nodes (7): ABERTAS, COMPANIES, Dashboard(), decimalToHHMM(), FinanceBlock(), fmt(), months

### Community 63 - "nfse-emitter-settings.js"
Cohesion: 0.33
Nodes (5): base(), Contracts(), EMPTY_FORM, months, SPLIT_MODE_LABEL

### Community 64 - "MemoriaCalculo.jsx"
Cohesion: 0.17
Nodes (18): aliquotaEfetiva(), calcINSS(), calcularImpostos(), faixaFor(), parametrosFiscais(), PARAMS_PADRAO, proLaboreDoMes(), r2() (+10 more)

### Community 65 - "NFSeSettings.jsx"
Cohesion: 0.25
Nodes (6): bufferParaBase64(), dataBR(), NFSeSettings(), Demands(), STATUS_COLORS, STATUS_OPTIONS

### Community 66 - "Contracts.jsx"
Cohesion: 0.22
Nodes (11): aplicarDados(), useCNPJConsulta(), CAMPOS_FISCAIS, Clientes(), COMPANIES, DE_PARA_CNPJ, emptyForm, CAMPOS_TEXTO (+3 more)

### Community 67 - "Clientes.jsx"
Cohesion: 0.06
Nodes (77): handler(), periodFromDate(), recalcParent(), TABLES, calcularDistribuicao(), estornarSessao(), handler(), pagarCompensacao() (+69 more)

### Community 70 - "nfse-events.js"
Cohesion: 0.18
Nodes (15): CANCELAVEIS, handler(), handler(), handler(), EVENTOS, listarEventos(), registrarEvento(), ROTULOS (+7 more)

### Community 72 - "payment-source-tracker.js"
Cohesion: 0.25
Nodes (6): attrs, cert, info, keys, p12Der, pfxBuffer

## Knowledge Gaps
- **387 isolated node(s):** `$schema`, `oxc`, `react/rules-of-hooks`, `warn`, `DESTINATARIOS` (+382 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `requireAuth()` connect `payable-payments.js` to `Clientes.jsx`, `6. Regras de negócio financeiro`, `nfse-events.js`, `@neondatabase/serverless`, `time-entries.js`, `export-payables-fabricio.js`, `cron-nfse-check.test.js`, `FiscalObligations.jsx`, `react-dom`, `Clientes.jsx`, `Billing.jsx`, `dotenv`, `Financial`, `react`, `main.jsx`?**
  _High betweenness centrality (0.126) - this node is a cross-community bridge._
- **Why does `react` connect `main.jsx` to `MemoriaCalculo.jsx`, `NFSeSettings.jsx`, `Contracts.jsx`, `imap-simple`, `payables-victor.js`, `.oxlintrc.json`, `Financial.jsx`, `EmailRules.jsx`, `dotenv`, `todayBR`, `react`, `Dashboard.jsx`, `nfse-emitter-settings.js`?**
  _High betweenness centrality (0.072) - this node is a cross-community bridge._
- **Why does `Financial()` connect `Login.jsx` to `main.jsx`, `MemoriaCalculo.jsx`, `imap-simple`, `Financial.jsx`, `FiscalObligations.jsx`, `todayBR`, `nfse-emitter-settings.js`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **What connects `$schema`, `oxc`, `react/rules-of-hooks` to the rest of the system?**
  _387 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._
- **Should `Financial.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.043478260869565216 - nodes in this community are weakly interconnected._