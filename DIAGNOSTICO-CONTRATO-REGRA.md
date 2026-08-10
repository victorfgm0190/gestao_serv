# Diagnóstico — Vínculo Contrato ↔ Regra Financeira

**Projeto:** SITE PROJETO VICTOR — gestao_serv
**Data:** 2026-08-10
**Método:** introspecção direta do Neon (`information_schema` + `pg_constraint` + `pg_indexes`) + leitura de `/api`, `/src`, `/lib`
**Escopo:** diagnóstico apenas — nenhuma alteração de código ou de banco foi feita.

---

## TL;DR

> **O vínculo já existe no banco e na tela — mas o faturamento não o usa.**

- `contracts.financial_rule_id` **existe**, tem **FK**, e está **100% preenchido** (10/10 contratos).
- `Contracts.jsx` **já força** a escolha da regra (dois guards no frontend).
- **Porém:** `api/invoices.js` (e mais 5 arquivos) **ignoram `contracts.financial_rule_id`** e buscam a regra por
  `SELECT * FROM financial_rules WHERE client_id = X LIMIT 1`.
- Existe **1 cliente com 2 regras** (Bokada, `client_id = 13`) e **2 contratos**. O `LIMIT 1` **sem `ORDER BY`** decide qual regra vale — hoje acerta por coincidência de ordem física da heap, não por regra.

O trabalho que falta é **de backend**, não de UI nem de schema.

---

## 1. Schema Neon — DDL atual

### 1.1 `contracts`

```sql
CREATE TABLE contracts (
  id                       integer      NOT NULL DEFAULT nextval('contracts_id_seq'),
  company_id               integer      NULL,
  client_id                integer      NULL,
  name                     varchar(200) NOT NULL,
  billing_type             varchar(20)  NULL DEFAULT 'contract',
  contract_value           numeric(10,2) NULL,
  victor_fixed             numeric(10,2) NULL,
  remainder_victor_pct     numeric(5,2) NULL DEFAULT 50,
  remainder_fabricio_pct   numeric(5,2) NULL DEFAULT 50,
  has_tax                  boolean      NULL DEFAULT false,
  tax_percentage           numeric(5,2) NULL,
  is_active                boolean      NULL DEFAULT true,
  notes                    text         NULL,
  created_at               timestamp    NULL DEFAULT now(),
  deslocamento_tipo        varchar(20)  NULL DEFAULT 'nao_cobrado',
  deslocamento_valor_hora  numeric(10,2) NULL DEFAULT 0,
  financial_rule_id        integer      NULL,          -- ⬅ EXISTE, mas NULLABLE
  tax_client_percent       numeric(5,2) NULL DEFAULT 0,
  displacement_hours       numeric(5,2) NULL DEFAULT 0,
  cnpj                     varchar(30)  NULL,
  projeto_split_mode       varchar(20)  NULL DEFAULT 'direct_split',
  projeto_victor_pct       numeric(5,2) NULL DEFAULT 0,
  projeto_victor_fixed     numeric(10,2) NULL DEFAULT 0,
  projeto_expenses         numeric(10,2) NULL DEFAULT 0,
  require_nf               boolean      NOT NULL DEFAULT true,

  CONSTRAINT contracts_pkey                    PRIMARY KEY (id),
  CONSTRAINT contracts_company_id_fkey         FOREIGN KEY (company_id)        REFERENCES companies(id),
  CONSTRAINT contracts_client_id_fkey          FOREIGN KEY (client_id)         REFERENCES clients(id),
  CONSTRAINT contracts_financial_rule_id_fkey  FOREIGN KEY (financial_rule_id) REFERENCES financial_rules(id)
);
-- Índices: APENAS contracts_pkey. Nenhum índice em financial_rule_id, client_id ou company_id.
```

**Respostas diretas:**

| Pergunta | Resposta |
|---|---|
| Tem `financial_rule_id`? | ✅ **SIM** |
| É obrigatório (`NOT NULL`)? | ❌ **NÃO** — é nullable |
| Tem FK? | ✅ **SIM** — `contracts_financial_rule_id_fkey` (sem `ON DELETE`, ou seja, `NO ACTION`) |
| Tem índice? | ❌ **NÃO** |
| Quantos contratos estão sem regra? | **0 de 10** — a coluna já está 100% preenchida |

### 1.2 `financial_rules`

```sql
CREATE TABLE financial_rules (
  id                      integer      NOT NULL DEFAULT nextval('financial_rules_id_seq'),
  project_id              integer      NULL,          -- legado (todos NULL)
  hourly_rate             numeric(10,2) NULL,
  has_tax                 boolean      NULL DEFAULT false,
  tax_percentage          numeric(5,2) NULL,
  victor_fixed_per_hour   numeric(10,2) NULL,
  has_fuel                boolean      NULL DEFAULT false,
  fuel_value              numeric(10,2) NULL,
  remainder_victor_pct    numeric(5,2) NULL,
  remainder_fabricio_pct  numeric(5,2) NULL,
  created_at              timestamp    NULL DEFAULT now(),
  client_id               integer      NULL,
  tipo                    varchar(20)  NULL DEFAULT 'hora',   -- 'hora' | 'por_projeto'

  CONSTRAINT financial_rules_pkey           PRIMARY KEY (id),
  CONSTRAINT financial_rules_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id)
);
-- Índices: APENAS financial_rules_pkey.
-- ⚠️ NÃO há UNIQUE (client_id) — nada impede N regras por cliente. E já há um caso real.
-- ⚠️ NÃO há company_id — o recorte por empresa vem via client_companies.
```

### 1.3 `invoices` — como referencia regra/contrato

```sql
-- ... colunas financeiras conforme CLAUDE.md ...
  contract_id     integer NULL,   -- FK invoices_contract_id_fkey → contracts(id)
  emission_date   date    NULL,
  payment_date    date    NULL,
  require_nf      boolean NOT NULL DEFAULT true
-- ❌ NÃO EXISTE invoices.financial_rule_id
```

| | |
|---|---|
| Referencia contrato? | ✅ `contract_id` (nullable, com FK) |
| Referencia regra? | ❌ **Não existe** `financial_rule_id` em `invoices` |
| Faturas sem `contract_id` | **11 de 26** (todas `billing_type = 'agenda'`) |

Distribuição real:

| `billing_type` | faturas | com `contract_id` |
|---|---|---|
| `contract` | 5 | 5 |
| `agenda` | 21 | 10 |

> As 11 faturas órfãs são as antigas, geradas antes de o `agendaForm.contract_id` existir. Nenhuma delas guarda com que regra foi calculada.

### 1.4 Índices — panorama

Índices **não-PK** em todo o banco (apenas 3):

```
idx_fiscal_allocations_client_obligation  (client_id, obligation_id)
idx_payables_victor_kind                  (company_id, year, month, kind)
idx_project_installments_contract         (contract_id)
```

Ou seja: **nenhuma FK de `contracts`, `financial_rules`, `invoices`, `time_entries`, `receivables` ou `payables_*` está indexada.** Em volume atual (26 faturas, 63 apontamentos) isso é irrelevante para performance — mas o `financial_rule_id` passa a ser lido em todo faturamento depois da correção.

### 1.5 ⚠️ CLAUDE.md está defasado

Itens presentes no banco e **ausentes** da documentação:

- **`client_companies`** — tabela N:N `(client_id, company_id)` com `UNIQUE` e `ON DELETE CASCADE`. Já é usada por `financial-rules.js:31`. A doc ainda diz que o recorte por empresa vem da tabela dona da linha.
- `financial_rules.tipo` (`'hora'` | `'por_projeto'`)
- `contracts.cnpj`, `displacement_hours`, `projeto_split_mode`, `projeto_victor_pct`, `projeto_victor_fixed`, `projeto_expenses`
- `invoices.emission_date` (documentada só em passagem), `invoices.payment_date`
- **`project_installments`** — parcelas de contrato por projeto, com FKs para `contracts` (CASCADE) e `invoices` (SET NULL)
- `billing_type = 'por_projeto'` (contratos) e `'projeto'` (faturas)
- Clientes 16 (ALEX - LEILOES) e 17 (LECACAU) não constam na tabela de clientes da doc

---

## 2. APIs

### 2.1 `api/contracts.js`

| Rota | Situação |
|---|---|
| **GET** | ❌ **Não** traz a regra. O JOIN é só com `clients`: `SELECT c.*, cl.name as client_name FROM contracts c JOIN clients cl ON cl.id = c.client_id` (linhas 23–29 e 32–38). O consumidor recebe `financial_rule_id` como número solto. |
| **POST** | ❌ **Não valida.** Linha 47: `${financial_rule_id \|\| null}` — chamada sem o campo grava `NULL` silenciosamente e retorna **201**. |
| **PUT** | ⚠️ **Não existe.** O método de edição é **PATCH** (linha 56). |
| **PATCH** | ✅ Permite trocar a regra (linha 75) — mas com o mesmo `\|\| null`, sem validação. |
| **DELETE** | Sem proteção; `DELETE FROM contracts WHERE id = ...` direto (linha 95). |

**Response atual do GET** (formato real):

```json
{
  "contracts": [
    {
      "id": 2, "company_id": 1, "client_id": 7, "name": "PHARMALOG HORA",
      "billing_type": "hora", "contract_value": "0.00", "victor_fixed": "0.00",
      "remainder_victor_pct": "50.00", "remainder_fabricio_pct": "50.00",
      "has_tax": true, "tax_percentage": "7.00", "tax_client_percent": "0.00",
      "financial_rule_id": 5,          // ⬅ só o id, sem os dados da regra
      "require_nf": true, "is_active": true,
      "client_name": "Pharmalog/ANB"
    }
  ]
}
```

⚠️ **Armadilha do PATCH:** ele reescreve a linha inteira com os campos do body — chave ausente vira `NULL`. `Billing.jsx:152-168` já convive com isso reenviando tudo à mão (com comentário explicando). Vale a pena tratar junto.

### 2.2 `api/financial-rules.js`

❌ **Não traz nenhuma informação de contratos.** O GET faz JOIN apenas com `clients` (e com `client_companies` no recorte por empresa, linha 31). Não há `COUNT` de contratos, nem lista de ids.

Consequência prática: `DELETE /api/financial-rules` (linha 107) roda direto. Se a regra estiver vinculada a um contrato, a FK barra com erro **500 cru de Postgres** ("violates foreign key constraint"), não com uma mensagem útil.

### 2.3 `api/invoices.js` — 🔴 **o gap central**

**A regra financeira NÃO vem de `contracts.financial_rule_id`.** Vem do cliente:

```js
// invoices.js:231  (POST)
const rules = await sql`SELECT * FROM financial_rules WHERE client_id = ${client_id} LIMIT 1`
if (!rules.length) return res.status(400).json({ error: 'Regra financeira não encontrada' })
calc = calcAgenda(entries, rules[0], { tax_percentage_used, tax_client_percent_used })

// invoices.js:401  (PUT) — idêntico
const rules = await sql`SELECT * FROM financial_rules WHERE client_id = ${client_id || inv.client_id} LIMIT 1`
```

Note que **não há `ORDER BY`**. Com mais de uma regra para o cliente, o Postgres devolve o que estiver primeiro no seq scan — ordem que muda após `UPDATE`, `VACUUM` ou mudança de plano.

Caminho por `billing_type`:

| `billing_type` | Fonte do cálculo | Usa a regra? |
|---|---|---|
| `contract` / `mensal` | `SELECT * FROM contracts WHERE id = ${contract_id}` → `calcContrato` | ❌ Não — usa só as colunas do contrato |
| `projeto` | `loadProjeto(contract_id, installment_id)` → `calcProjeto` | ❌ Não |
| `agenda` (hora) | `financial_rules WHERE client_id LIMIT 1` → `calcAgenda` | ⚠️ **Sim — pelo cliente, ignorando o contrato** |

O `contract_id` **é** recebido no body e **é** gravado na fatura (`invoices.js:255`) — só não é usado para achar a regra.

**Split Victor/Fabrício:** `calcAgenda` lê `remainder_victor_pct` / `remainder_fabricio_pct` **da regra**; `calcContrato` lê **do contrato**. Ou seja, no caminho `agenda` o split vem da regra escolhida pelo `LIMIT 1` — é exatamente aí que a regra errada vira dinheiro errado.

### 2.4 O mesmo padrão em mais 5 lugares

| Arquivo:linha | Query | `ORDER BY`? |
|---|---|---|
| `api/invoices.js:231` | `financial_rules WHERE client_id = X LIMIT 1` | ❌ |
| `api/invoices.js:401` | idem | ❌ |
| `api/time-entries.js:131` (POST) | idem | ❌ |
| `api/time-entries.js:181` (PUT) | idem | ❌ |
| `api/recalc-time-entries.js:68` | idem | ❌ |
| `api/payables-fabricio.js:23` | `... WHERE client_id = i.client_id ORDER BY id LIMIT 1` | ✅ (determinístico, mas ainda por cliente) |
| `api/export-payables-fabricio.js:73,92` | idem | ✅ (idem) |

`time-entries.js` **já sabe** resolver o contrato corretamente (linhas 134–137: usa o `contract_id` explícito, com fallback no ativo mais recente) — mas continua buscando a **regra** pelo cliente, no mesmo bloco. A infraestrutura para a correção já está lá.

### 2.5 🔴 O caso real que expõe o bug

**Cliente 13 — Bokada:**

| Regras | Contratos |
|---|---|
| `#8` — `tipo='hora'`, R$ 85/h, split **100/0** | `#5` — "Bokada(Renato) 85", `billing_type='hora'`, `financial_rule_id=8` |
| `#12` — `tipo='por_projeto'`, R$ 1.500, split **50/50** | `#10` — "BOKADA ALIMENTOS - REFORMA", `billing_type='mensal'`, `financial_rule_id=12` |

Executando hoje a query que o `invoices.js` roda:

```sql
SELECT * FROM financial_rules WHERE client_id = 13 LIMIT 1;
-- → id 8, tipo 'hora', split 100/0
```

Devolve a regra **8** — que **por sorte** é a correta para o contrato 5 (o único que passa por `calcAgenda`; o contrato 10 é `mensal`, e esse caminho nem lê a regra). **O sistema está certo hoje por acaso, não por construção.**

O que quebra isso:
1. Um `UPDATE` na regra 8 (reescreve a tupla no fim da heap) → o `LIMIT 1` passa a devolver a **12** → split vira 50/50 e o Fabrício começa a receber em faturas de hora do Bokada.
2. Qualquer cliente novo com duas regras cai no mesmo sorteio.

É um bug **latente, silencioso e financeiro** — sem erro, sem aviso, direto no split.

---

## 3. Componentes React

### 3.1 `src/pages/Contracts.jsx`

| Item | Status | Evidência |
|---|---|---|
| Dropdown "Selecione a regra financeira" | ✅ **SIM** | linha 375 (`<select value={form.financial_rule_id}>`) |
| Validado como obrigatório | ✅ **SIM (só no frontend)** | linha 137 `if (!form.client_id \|\| !form.name \|\| !form.financial_rule_id) return` + linha 577 botão `disabled={!form.financial_rule_id \|\| ...}` |
| Preview dos dados da regra ao selecionar | ⚠️ **PARCIAL** | O `<option>` mostra `"Cliente — R$ 115,00/h"` (linha 379). **Não** há painel com `victor_fixed_per_hour`, imposto, split, combustível ou `tipo`. |
| Carrega regras filtradas por cliente | ✅ | `loadRulesForClient()` (linha 63) → `GET /api/financial-rules?client_id=` |
| Trata cliente sem regra | ✅ | Aviso âmbar: *"Este cliente não possui regra financeira"* (linha 384) |

⚠️ **A obrigatoriedade é só de UI.** Um `POST /api/contracts` sem `financial_rule_id` (via curl, Postman, ou outra tela) grava `NULL` e retorna 201. O guard do frontend não é uma garantia.

### 3.2 `src/pages/FinancialRules.jsx`

❌ **Não mostra badge nem coluna "Vinculado a X contratos".**

Grep por `contract|Contrato|vinculad` no arquivo: **zero ocorrências**. A tela conhece apenas `financial-rules` e `clients` (linhas 33–34). Não há como saber, ao editar ou excluir uma regra, quais contratos dependem dela.

### 3.3 `src/pages/Billing.jsx`

**Fatura por Contrato / Projeto:** seleciona o contrato (`onSelectContract`, linha 102) e usa as colunas do próprio contrato. A regra não entra. ✅ correto.

**Fatura por Agenda:** 🔴 é aqui que está o problema.

```js
// Billing.jsx:76-84
const [teRes, frRes] = await Promise.all([
  fetch(`/api/time-entries?...`),
  fetch(`/api/financial-rules?client_id=${client_id}`),   // ⬅ por CLIENTE
])
const rule = (frData.rules||[])[0] || null                // ⬅ pega o PRIMEIRO
setAgendaRule(rule)
```

E o mais revelador: o modal de agenda **tem** um seletor de contrato (`agendaForm.contract_id`, linha 773), o valor **é** enviado no POST (linha 291) e **é** gravado na fatura — mas **nem o frontend nem o backend o usam para escolher a regra**. O elo está montado e desligado dos dois lados.

---

## 4. Gap Analysis

> Objetivo: *"Cada contrato tem obrigatoriamente 1 regra vinculada, e ao puxar contrato, os dados da regra vêm junto."*

### 4.1 Banco de dados

- [x] ~~Adicionar coluna `financial_rule_id` em `contracts`~~ — **já existe**
- [x] ~~Criar FK para `financial_rules`~~ — **já existe** (`contracts_financial_rule_id_fkey`)
- [x] ~~Backfill dos contratos existentes~~ — **desnecessário**: 10/10 já preenchidos
- [ ] **Tornar `financial_rule_id` `NOT NULL`** → `ALTER TABLE contracts ALTER COLUMN financial_rule_id SET NOT NULL;` (seguro hoje: zero linhas nulas)
- [ ] **Criar índice** → `CREATE INDEX idx_contracts_financial_rule ON contracts(financial_rule_id);`
- [ ] **Criar índice** em `contracts(client_id)` e `contracts(company_id)` (nenhuma FK da tabela é indexada)
- [ ] Avaliar `ON DELETE RESTRICT` explícito na FK (hoje é o default `NO ACTION`, que já barra — mas com erro cru)
- [ ] *(opcional, decisão de negócio)* Registrar em `invoices` **qual regra** gerou a fatura — hoje a nota não guarda essa rastreabilidade. Ver §4.5.

### 4.2 API — contratos e regras

- [ ] **`GET /api/contracts`: JOIN com `financial_rules`**, devolvendo os dados aninhados (`rule: { hourly_rate, victor_fixed_per_hour, has_tax, tax_percentage, remainder_victor_pct, remainder_fabricio_pct, tipo, has_fuel, fuel_value }`). São **duas** queries a alterar (com e sem `client_id`, linhas 23 e 32).
- [ ] **`POST /api/contracts`: validar `financial_rule_id`** → 400 se ausente; 400 se a regra não pertencer ao `client_id` informado (evita vincular a regra do cliente errado, que a FK sozinha não impede).
- [ ] **`PATCH /api/contracts`: mesma validação** (linha 75).
- [ ] **`GET /api/financial-rules`: `COUNT` de contratos vinculados** (`LEFT JOIN contracts ... GROUP BY`), devolvendo `contracts_count` e, de preferência, `contract_names`.
- [ ] **`DELETE /api/financial-rules`: bloquear com 409** e mensagem clara quando houver contrato vinculado, em vez de deixar estourar o 500 da FK.

### 4.3 API — faturamento (🔴 prioridade máxima)

- [ ] **`api/invoices.js:231` (POST)** — resolver a regra pelo contrato:
      `contract_id` → `contracts.financial_rule_id` → `financial_rules.id`.
      Fallback por `client_id` **com `ORDER BY id`** apenas quando não houver contrato.
- [ ] **`api/invoices.js:401` (PUT)** — idêntico.
- [ ] **`api/time-entries.js:131` e `:181`** — resolver a regra pelo contrato já resolvido nas linhas 134–137, em vez de repetir a busca por cliente.
- [ ] **`api/recalc-time-entries.js:68`** — idem (usa `e.contract_id`, já disponível na linha).
- [ ] **`api/payables-fabricio.js:23`** e **`api/export-payables-fabricio.js:73,92`** — trocar o LATERAL por cliente pelo `financial_rule_id` do contrato da fatura. Menos urgente: já são determinísticos e só alimentam o *fallback* de split quando `i.contract_id` é nulo (as 11 faturas antigas).
- [ ] **Guarda mínima imediata:** adicionar `ORDER BY id` em **todo** `financial_rules ... LIMIT 1` restante. Não resolve o problema, mas elimina o não-determinismo enquanto o resto é feito.

### 4.4 Frontend

- [ ] **`Billing.jsx:78-83`** — quando `agendaForm.contract_id` estiver preenchido, usar a regra **do contrato** (que virá aninhada no GET de contratos após §4.2) em vez de `rules[0]` por cliente. Sem isso, a prévia da tela diverge do que o backend grava.
- [ ] **`Contracts.jsx`** — painel de preview abaixo do dropdown, mostrando os campos da regra selecionada (valor/hora, fixo/hora, imposto, split V/F, tipo, combustível). Hoje só há o rótulo do `<option>`.
- [ ] **`Contracts.jsx`** — exibir a regra vinculada **no card do contrato** na listagem (hoje não aparece em lugar nenhum fora do modal).
- [ ] **`FinancialRules.jsx`** — badge "🔗 N contratos" por regra, com tooltip dos nomes; e bloquear/avisar no botão de excluir quando `contracts_count > 0`.

### 4.5 Decisões que precisam do Victor (não implementar sem confirmar)

1. **Faturas antigas sem `contract_id` (11 de 26).** Vincular retroativamente ao contrato do cliente? São faturas já emitidas, apuradas e (em parte) recebidas — mexer nelas toca a apuração fiscal. Recomendação: **deixar como está** e só passar a exigir `contract_id` nas novas.
2. **Gravar `financial_rule_id` na fatura?** Daria rastreabilidade ("esta NF usou a regra X"), no mesmo espírito do `require_nf` congelado na emissão. Custo: mais uma coluna e um ponto de escrita. Recomendação: **sim**, mas depois de §4.3 estar estável.
3. **`UNIQUE (client_id, tipo)` em `financial_rules`?** Impediria duplicatas acidentais. Mas Bokada já tem `hora` + `por_projeto` (legítimo), e nada garante que não haja um caso futuro de duas regras do mesmo tipo. Recomendação: **não** — o vínculo pelo contrato resolve sem precisar restringir.
4. **Fallback quando o contrato não tem regra.** Depois do `NOT NULL` isso não deve acontecer; a pergunta é se o faturamento deve **falhar com 400** ou **cair na regra do cliente**. Recomendação: **falhar**, e alto — silêncio aqui foi o que gerou o problema atual.

---

## 5. Plano de ação — ordenado por impacto

### 🔴 P0 — Corrige risco financeiro ativo

| # | Ação | Arquivo | Esforço |
|---|---|---|---|
| 1 | Resolver a regra **pelo contrato** no POST e PUT de faturas | `api/invoices.js:231,401` | ~30 min |
| 2 | `ORDER BY id` em todo `financial_rules ... LIMIT 1` remanescente | `time-entries.js`, `recalc-time-entries.js`, `invoices.js` | ~10 min |
| 3 | Resolver a regra pelo contrato no apontamento de horas | `api/time-entries.js:131,181` | ~20 min |

> **Por que P0:** hoje o split Victor/Fabrício do cliente 13 depende da ordem física da heap. Um `UPDATE` na regra 8 muda o resultado do faturamento sem nenhum aviso. Os itens 1–3 são independentes do resto — dá para fazer e subir hoje.

### 🟠 P1 — Torna o vínculo real (não só convenção)

| # | Ação | Arquivo | Esforço |
|---|---|---|---|
| 4 | Validar `financial_rule_id` obrigatório no POST/PATCH (+ conferir que a regra é do mesmo cliente) | `api/contracts.js:43,75` | ~20 min |
| 5 | `ALTER TABLE contracts ALTER COLUMN financial_rule_id SET NOT NULL` | migração one-off | ~5 min |
| 6 | `CREATE INDEX` em `contracts(financial_rule_id, client_id, company_id)` | migração one-off | ~5 min |

> **Ordem importa:** item 4 **antes** do 5. Com o `NOT NULL` primeiro, um POST sem o campo passa a estourar erro cru de Postgres em vez de 400 legível.

### 🟡 P2 — "Os dados da regra vêm junto"

| # | Ação | Arquivo | Esforço |
|---|---|---|---|
| 7 | `GET /api/contracts` com JOIN → `rule: {...}` aninhado | `api/contracts.js:23,32` | ~20 min |
| 8 | `Billing.jsx` usa a regra do contrato na agenda | `src/pages/Billing.jsx:78-83` | ~30 min |
| 9 | Preview da regra no modal de contrato | `src/pages/Contracts.jsx:375` | ~30 min |
| 10 | Regra vinculada visível no card do contrato | `src/pages/Contracts.jsx` | ~15 min |

> Item 7 é pré-requisito do 8 e do 10.

### 🟢 P3 — Higiene e visibilidade

| # | Ação | Arquivo | Esforço |
|---|---|---|---|
| 11 | `COUNT` de contratos no `GET /api/financial-rules` | `api/financial-rules.js:27` | ~15 min |
| 12 | Badge "🔗 N contratos" | `src/pages/FinancialRules.jsx` | ~20 min |
| 13 | `DELETE /api/financial-rules` → 409 com mensagem clara | `api/financial-rules.js:105` | ~10 min |
| 14 | Regra do contrato em `payables-fabricio` e no export | `api/payables-fabricio.js:23`, `export-payables-fabricio.js:73,92` | ~20 min |
| 15 | **Atualizar CLAUDE.md** — `client_companies`, `project_installments`, `financial_rules.tipo`, colunas `projeto_*`, `billing_type='por_projeto'`, clientes 16 e 17 | `CLAUDE.md` | ~30 min |

---

## Apêndice — Estado dos dados

**Contratos (10) — todos com regra vinculada:**

| id | cliente | contrato | billing_type | rule_id | split V/F | require_nf |
|----|---------|----------|--------------|---------|-----------|------------|
| 1 | SteelDek | Stelldek | contract | 6 | 50/50 | ✅ |
| 2 | Pharmalog/ANB | PHARMALOG HORA | hora | 5 | 50/50 | ✅ |
| 3 | Eurofral | EUROFRAL POR HORA | hora | 7 | 50/50 | ✅ |
| 4 | Minas Distribuicao | Minas(Borsato)115 | hora | 10 | 100/0 | ❌ |
| 5 | Bokada | Bokada(Renato) 85 | hora | 8 | 100/0 | ✅ |
| 6 | Enpla (Atria) | Enpla hora 90 | hora | 9 | 100/0 | ✅ |
| 7 | ALEX - LEILOES | ALEX LEILAO | mensal | 11 | 100/0 | ✅ |
| 8 | LECACAU | LECACAU HORAS FABRICIO | hora | 13 | 100/0 | ✅ |
| 9 | Nutribom | NUTRIBOM FABRICIO 100 | hora | 14 | 100/0 | ✅ |
| 10 | Bokada | BOKADA ALIMENTOS - REFORMA | mensal | 12 | 50/50 | ✅ |

**Regras (10) — cada uma usada por exatamente 1 contrato:**

| rule_id | cliente | tipo | R$/h | fixo/h | imposto | split V/F | contratos |
|---------|---------|------|------|--------|---------|-----------|-----------|
| 5 | Pharmalog/ANB | hora | 115,00 | 100,00 | 7% | 50/50 | #2 |
| 6 | SteelDek | hora | 1.600,00 | 800,00 | — | 50/50 | #1 |
| 7 | Eurofral | hora | 156,00 | 100,00 | 7% | 50/50 | #3 |
| 8 | Bokada | hora | 85,00 | 85,00 | 7% | 100/0 | #5 |
| 9 | Enpla (Atria) | hora | 90,00 | 90,00 | 7% | 100/0 | #6 |
| 10 | Minas Distribuicao | hora | 115,00 | 115,00 | 7%¹ | 100/0 | #4 |
| 11 | ALEX - LEILOES | hora | 6.000,00 | 6.000,00 | 7% | 100/0 | #7 |
| 12 | **Bokada** | **por_projeto** | 1.500,00 | 800,00 | 7% | 50/50 | #10 |
| 13 | LECACAU | hora | 100,00 | 100,00 | — | 100/0 | #8 |
| 14 | Nutribom | hora | 100,00 | 100,00 | — | 100/0 | #9 |

¹ Regra 10: `has_tax = false` mas `tax_percentage = 7.00` — o percentual está preenchido com o imposto desligado. Inofensivo hoje (o contrato 4 é `require_nf = false`), mas é uma inconsistência de cadastro.

**Cobertura:** contratos sem regra: **0**. Clientes com >1 regra: **1** (Bokada). Contratos por cliente >1: **1** (Bokada). `time_entries` com `contract_id`: **63/63** ✅. `invoices` com `contract_id`: **15/26** ⚠️.

---

*Diagnóstico gerado a partir do banco em produção e do código em `main` (commit `1bb67f5`). Nenhuma alteração foi aplicada.*
