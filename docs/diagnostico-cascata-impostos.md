# Diagnóstico — "a cascata está zerando o saldo do Pharmalog com os impostos"

> 2026-08-14 · investigação, **nenhuma alteração de lógica foi feita**.
> Conferido contra a produção (Lumen, `company_id = 1`, competência 01/2026).

---

## TL;DR

O que zera o Pharmalog **não é a cascata das telas** — é uma gravação no banco:
`aplicarDelta()` (`lib/fiscal-redistribution.js:34`), aplicada pelo
`POST /api/fiscal-obligations?action=recalcular&aplicar=true`
(`api/fiscal-obligations.js:888-924`), que **subtrai o imposto real de
`profit_amount` e depois de `service_amount`** do payable do Victor.

E há uma segunda leitura errada na premissa do chamado: **os impostos NÃO estão
zerados hoje** — eles aparecem como pendentes, com o valor cheio. O que está
zerado é o **LUCRO**.

---

## Estado real hoje (produção, 01/2026)

`carregarRecorte()` — a mesma função que alimenta a aba Pagar Victor:

| Cliente | lucro (saldo) | serviço (saldo) | DAS | INSS | Escritório | impostos |
|---|---|---|---|---|---|---|
| Pharmalog/ANB | **0,00** | 8.243,79 | 586,50 | 301,07 | 139,11 | **1.026,68 pendentes** |
| Bokada | **0,00** | 684,65 | 45,90 | 23,56 | 10,89 | **80,35 pendentes** |
| Minas (sem NF) | 0,00 | 1.466,25 | — | — | — | 0,00 |

Os impostos estão **todos em aberto** (`pago = 0`, `saldo = devido`), porque não
existe nenhuma linha `fiscal_allocations.basis = 'consumo_payable'` nem
`fiscal_payments` de abatimento no banco.

O que mudou foi o payable:

| payable | fatura (o que a NF prometeu) | payable hoje | diferença |
|---|---|---|---|
| #28 Pharmalog (NF 6) | serviço 8.500,00 · lucro 295,38 | serviço **8.452,95** · lucro **0,00** | −342,43 |
| #42 Bokada (NF 11) | serviço 711,45 · lucro 0,00 | serviço **684,65** · lucro 0,00 | −26,80 |

E 342,43 = 1.026,68 (imposto real) − 684,25 (provisão de 7% retida na NF).
26,80 = 80,35 − 53,55. **A cascata do imposto real já foi aplicada e gravada.**

⚠️ Sobre os números do chamado: **Pharmalog 1.026,56 confere** (é o rateio pela
guia oficial: 632,39 + 150,00 + 324,50 = 1.106,89, cabendo 1.026,55 ao Pharmalog).
**Bokada 108,90 não confere** — o rateio dele é **80,35** (45,90 + 23,56 + 10,89),
e é proporcional à NF (765,00 de 10.540,00). Vale confirmar de onde saiu o 108,90
antes de mexer em qualquer coisa.

⚠️ O lucro do **Bokada é 0,00 por contrato**, não pela cascata: o split dele é
100/0 (`financial_rules #8`), então `invoices.victor_profit` já nasce zero. Ali
não há nada a "devolver".

---

## Resposta às 4 perguntas

### 1. Em qual arquivo/função os impostos entram na cascata?

São **três lugares distintos**, e só o primeiro grava:

| # | Onde | O que faz | Grava? |
|---|---|---|---|
| **A** | `lib/fiscal-redistribution.js:34` `aplicarDelta()` — chamada por `recalcularInvoice()` (`:151`) e aplicada em `api/fiscal-obligations.js:918-924` | `delta = imposto real − provisão` é subtraído do **lucro** e, no que não couber, do **serviço**. É o que zerou o #28. | **SIM** (UPDATE em `payables_victor`) |
| **B** | `lib/victor-rateio.js:145` `debitar()` / `:179` `planejarCategoria()` (passo 2, fallback) | Ao **pagar** uma guia por abatimento (`?action=pagar-com-rateio`), o dinheiro sai do saldo do payable — lucro primeiro, serviço depois. | **SIM** (`payable_payments`) |
| **C** | `src/pages/Financial.jsx:151` `alocarCascataDist()` (linha 158: `passos = alvo ? [[alvo], ['lucro','servico']] : [['lucro','servico']]`) e `lib/victor-tabulado.js:227-275` (o `pool` de excedentes desce para `lucro` → `servico`) | Simulação na tela: o que é digitado numa categoria fiscal e não cabe na linha dela desce para Lucro/Serviço. | **NÃO** (só exibição) |

O caso relatado é o **A**. Ele acontece antes e independentemente de qualquer
digitação na tela.

Detalhe importante: o payable **nasce correto** — `api/receivables.js:117` e
`api/invoices.js:372` inserem `victor_service` e `victor_profit + victor_tax_diff`
puros, sem imposto. A absorção é sempre um passo posterior.

### 2. Qual é a ordem de consumo hoje?

Três arrays, alinhados desde 2026-08-12:

```js
// lib/victor-rateio.js:75 — motor que grava o pagamento
const ORDEM_CATEGORIA = ['honorarios','das','inss','escritorio','pro_labore','lucros','demais']

// lib/victor-tabulado.js:61 — linhas da tabela tabulada
export const ORDEM_LINHAS = ['escritorio','das','inss','lucro','servico']

// src/pages/Financial.jsx:91 / :106 — painel do modal Receber
const DIST_LINHAS        = ['escritorio','das','inss','lucro','servico']
const DIST_ORDEM_ENTRADA = ['honorarios','escritorio','das','inss','pro_labore','lucros','demais']
```

E a cascata do **A**, que é a que interessa aqui, é fixa e não tem array:
`lib/fiscal-redistribution.js:103` `cascataDoLucro()` →
**lucro bruto → −Escritório → −INSS → −DAS → lucro final**, com o excedente
descendo para o serviço e, se ainda sobrar, para `capital_proprio`.

### 3. Os impostos têm flag/status diferente dos outros?

Sim, e é justamente por isso que a correção é viável:

- **Não existe linha de imposto em `payables_victor`.** Imposto mora em
  `fiscal_obligations` (`kind = das|inss|honorarios|escritorio|pro_labore`) e o
  rateio por cliente em `fiscal_allocations` (`basis = 'proporcional_nf'`). O
  payable só tem `service_amount` e `profit_amount`.
- Na tela as categorias fiscais são derivadas: `DIST_KIND_LINHA`
  (`Financial.jsx:98`) e `ENTRADA_LINHA` (`victor-tabulado.js:80`) mapeiam
  `kind` → linha. O modo já é derivado disso: `modoDaCategoria()`
  (`Financial.jsx:122`) devolve `'imposto'` ou `'trabalho'`.
- O status do imposto é o da obrigação (`previsto|apurado|parcial|pago`), com
  `paid_amount` próprio — **um "PENDENTE" já existe e está funcionando**.

Ou seja: a separação imposto × trabalho já é estrutural. O que não existe é a
opção de **não descontar** o imposto do que o Victor recebe.

### 4. Para corrigir, o que precisa mudar?

Nada do que o chamado sugere resolve, porque o problema é anterior:

- ❌ *Adicionar status "PENDENTE"* — já existe (`fiscal_obligations.status`), e
  as três categorias já estão pendentes com o valor cheio.
- ❌ *Separar imposto de trabalho na cascata da tela* — já está separado
  (`modoDaCategoria`, dois modos, desde 2026-08-12); e a cascata da tela não é
  quem zerou o Pharmalog.
- ✅ **Filtrar o imposto ANTES da cascata — mas na etapa A, não nas telas:**
  desligar (ou tornar opcional) a absorção de `aplicarDelta()`.

Concretamente, uma das duas:

**Opção 1 — não absorver, só registrar (o que o chamado pede).**
`?action=recalcular&aplicar=true` deixa de fazer o UPDATE de
`service_amount`/`profit_amount` (`api/fiscal-obligations.js:918-924`) e passa a
gravar só a cascata informativa + `from_service`/`from_profit`. O Victor recebe
8.500,00 + 295,38 e os 1.026,68 ficam devidos ao fisco, a serem quitados em
`/fiscal` ou por `?action=pagar-com-rateio`.

**Opção 2 — absorver só a provisão, nunca o excedente.** O delta acima dos 7%
retidos vira obrigação pendente em vez de descer para lucro/serviço.

Nos dois casos, o que vem junto (e é o trabalho real da correção):

1. **Reverter o que já foi absorvido** nos payables existentes — hoje há 2 no
   banco (#28: +342,43; #42: +26,80). É recomputável a partir de `invoices`, mas
   é escrita em dado financeiro e precisa de decisão explícita.
2. **Decidir de onde sai o caixa do imposto.** Hoje o Victor "paga" o excedente
   automaticamente, via redução do que recebe. Sem a absorção, a guia continua
   devida e alguém tem de pagá-la — o `?action=pagar-com-rateio` (caminho B)
   continua debitando o saldo do Victor, então **ele precisa ser revisto junto**,
   ou o imposto volta a sair do lucro na hora do pagamento.
3. `cascataDoLucro()` e as colunas `lucro_antes_*` / `capital_proprio` passam a
   ser puramente informativas (hoje já são recalculadas para exibir).
4. A conferência `imposto + serviço + lucro + Fabrício = NF`
   (`victor-recorte.js:222-235`) continua valendo — muda só quem paga o imposto,
   não a decomposição.

---

## Achado secundário (bug real, independente)

`fiscal.a_redistribuir` está mentindo: mostra **342,43 no #28 e 26,80 no #42**
como se a redistribuição ainda não tivesse sido aplicada — mas ela já foi
(os payables estão reduzidos).

Causa: `a_redistribuir = total − provisionado − from_service − from_profit`
(`lib/victor-recorte.js:243`), e `fiscal_allocations.from_service/from_profit`
estão **zeradas** na competência 02/2026. O `?action=recalcular` grava as duas
coisas na mesma transação (`api/fiscal-obligations.js:931-935`), mas um
`?action=apurar` posterior **apaga e recria** as linhas `proporcional_nf` —
levando junto a marca de "já redistribuído".

Efeito: aviso âmbar permanente na aba ("falta redistribuir") num mês já
redistribuído. Não duplica nada se o Victor clicar de novo (o motor mede contra
o baseline da fatura, é idempotente), mas o aviso é falso.

---

## Arquivos a tocar quando a decisão vier

| Arquivo | Papel |
|---|---|
| `lib/fiscal-redistribution.js` | `aplicarDelta()` — a cascata que grava |
| `api/fiscal-obligations.js:888-940` | aplica o UPDATE nos payables |
| `lib/victor-rateio.js` | pagamento por abatimento (caminho B) |
| `lib/victor-recorte.js:243` | `a_redistribuir` (bug do aviso) |
| `lib/victor-breakdown.js:209,283` | `lucro.devido` sai de `profit_amount` já líquido |
| `src/pages/Financial.jsx:1271-1352` | colunas ORIGINAL/ABSORVEU do painel |
| `lib/victor-tabulado.js` | tabela tabulada (só leitura) |
