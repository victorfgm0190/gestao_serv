# CLAUDE.md — Contexto do Projeto gestao_serv

## Stack
- React + Vite + Tailwind CSS (tema escuro)
- Vercel Serverless Functions em /api/ (Vercel Pro)
- Neon PostgreSQL (projeto: gestao_serv)
- Deploy: gestao-serv.vercel.app / lumendev.com.br

## Regra crítica
Neon nunca é acessado direto do browser — todo acesso passa por /api/

## Empresas
- Lumen (company_id=1)
- Imperium (company_id=2)

## Clientes Imperium (company_id=2)
- Braga (id=1, domínio: bragacont.com.br)
- Dental (id=2, domínios: higimaster.com.br, dentalclean.com.br)
- The Best Açaí (id=3, domínio: ogrupothebest.com)
- Ucelo (id=4, domínio: ucelo.com.br)
- Bokada (id=5, domínio: bokada.com.br)
- Sunstar (id=6, domínio: sunstar.com)

## Clientes Lumen (company_id=1)
- Pharmalog/ANB (id=7)
- SteelDek (id=8)
- Eurofral (id=9)
- Nutribom (id=10)
- LecaCau (id=11)
- Hidronorth (id=12)

## APIs ativas
receivables.js, payables-fabricio.js, payables-victor.js, payable-payments.js,
demands.js, clients.js, email-rules.js, financial-rules.js, time-entries.js,
contracts.js, contract-months.js, invoices.js, ingest-email.js,
reclassify-demands.js, export-os.js, billing.js, admin.js

⚠️ finance.js é LEGADO/MORTO — não usar, não modificar.

## IMAP Imperium
- comercial@imperiumprotheus.com → imap.titan.email porta 993
- victor@imperiumprotheus.com → imap.titan.email porta 993
- Regra especial: no_reply@alerts.runrun.it → Ucelo

## Regras financeiras

### Modelo por hora (ex: Pharmalog)
1. Valor hora bruto (ex: R$ 115)
2. Desconta imposto % (ex: 7%)
3. Desconta valor fixo Victor/hora (ex: R$ 100)
4. Restante divide entre Victor e Fabrício (ex: 50/50)

### Modelo contrato fixo (ex: SteelDek)
1. Valor contrato líquido (ex: R$ 1.600)
2. Victor fixo (ex: R$ 800)
3. Restante (R$ 800) divide 50/50
4. Diferença da NF vai 100% para Victor (imposto)

### Deslocamento
- Configurado por contrato: nao_cobrado / hora / hora_despesas
- Horas de deslocamento faturadas vão 100% para Victor (fora do split com Fabrício)

## Fluxo de Faturamento
1. Gera fatura → cria receivable automaticamente
2. Marca como recebido → cria payables_victor + payables_fabricio automaticamente
3. Registros com origin='faturamento' são protegidos — não deletar diretamente
4. Reverter: estornar a fatura correspondente (verifica se payables já foram pagos antes)

## Sistema de Múltiplos Pagamentos (Etapa 8)
- Tabela payable_payments: cada pagamento é um registro separado
- payable-payments.js: GET lista, POST adiciona e recalcula status, DELETE remove e recalcula
- Status calculado: soma=0 → pendente; 0<soma<total → parcial; soma>=total → pago
- Financial.jsx: botão "Pagar" (pendente), "Ver Pagamentos" (parcial/pago) com estorno individual
- ⚠️ Após deploy: chamar POST /api/migrate-payable-payments uma vez

## Migrações executadas em produção
POST /api/admin?action=migrate-etapa6
POST /api/admin?action=migrate-etapa7
POST /api/migrate-invoices
POST /api/migrate-financial-rules
POST /api/migrate-time-entries
POST /api/migrate-finance-origin
POST /api/setup-clients
POST /api/migrate-payable-payments  ← chamar após próximo deploy

## Pendências
- [ ] Lumen IMAP (victor@lumendev.com.br)
- [ ] Regras financeiras para Eurofral, SteelDek, demais Lumen
- [ ] Editar regras financeiras pela UI
- [ ] Excel export filtrado por cliente
- [ ] Persistir filtros ao navegar entre telas
- [ ] Limpeza de faturas de teste órfãs no banco
- [ ] Rotação de senha do banco
- [ ] DNS lumendev.com.br (TXT _vercel + A record na Hostinger)

## Observações para Claude Code
- Windows CMD: usar `type` (não `cat`), `dir` (não `ls`)
- Confirmar lógica financeira com Victor antes de implementar
- Todo prompt termina com: "Build, commit e push ao finalizar."
- Não criar endpoints que acessem Neon direto do frontend
