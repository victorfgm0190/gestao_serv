// RECORTE DA ABA PAGAR VICTOR — a leitura que estava inline no GET de
// api/payables-victor.js, agora com um dono só.
//
// Existe porque passaram a ser DOIS os consumidores do mesmo recorte:
//   GET  /api/payables-victor?breakdown=true          → a lista e os cards por cliente
//   POST /api/payables-victor?action=calcular-distribuicao → a tabela tabulada
//
// Se o segundo montasse a própria query, bastaria um filtro de mês divergir para a tabela
// somar clientes que os cards não mostram — e a diferença apareceria como erro de rateio,
// não como recorte diferente. É a mesma razão pela qual montarBreakdown() recebe as linhas
// já filtradas em vez de ir ao banco: lista, cards e tabela são UMA leitura vista de três
// ângulos.
//
// Nada aqui calcula valor financeiro novo. A cascata sai de lib/fiscal-redistribution.js,
// o rateio de fiscal_allocations e a agregação de lib/victor-breakdown.js.

import { r2 } from './victor-distribution.js'
import { ORDEM_KIND } from './fiscal-lines.js'
import {
  aplicarDelta, absorverDelta, cascataDoLucro, ABSORVER_IMPOSTO_NO_PAYABLE,
} from './fiscal-redistribution.js'
import { montarBreakdown } from './victor-breakdown.js'
import { buscarFaturamentoPrevisto, momentoPrevio } from './victor-momentos.js'

// Carrega as linhas do recorte e, opcionalmente, o breakdown por cliente.
//
//   company_id, year, month, status, mode   os mesmos parâmetros da query string do GET
//   comBreakdown                            monta o breakdown (uma query a mais)
//   momento                                 qual dos três a tela abre destacando
//
// Devolve { rows, breakdown, anos, fiscal } — `anos` e `fiscal` porque o chamador ainda
// precisa deles para a previsão (include_preview), que segue no endpoint.
export async function carregarRecorte(sql, {
  company_id, year, month, status, mode, comBreakdown = false, momento = null,
} = {}) {
  const caixa = mode === 'caixa'  // caixa filtra por payment_month/payment_year
  // Visão fiscal: agrupa pela data de EMISSÃO da NF (invoices.emission_date), que é a
  // competência que o fisco enxerga — a mesma de `faturasDoMes` em fiscal-obligations.
  // O agrupamento em si é do frontend (effMonth/effYear); aqui só se garante que a
  // linha venha na resposta: uma NF de dezembro emitida em janeiro tem competência
  // 12/AAAA-1 e data fiscal 01/AAAA, e sem alargar a janela ela sumiria da visão.
  // A filtragem exata por ano fiscal é client-side, sobre este superconjunto.
  const fiscal = mode === 'fiscal'
  const anos = fiscal ? [Number(year) - 1, Number(year)] : [Number(year)]
  // ⚠️ Na visão fiscal `month` NÃO pode entrar na query: as colunas do payable são de
  // COMPETÊNCIA, e o recorte fiscal é por data de emissão. Filtrar `p.month = 2` traria
  // os payables de competência fevereiro — cujas notas saíram em março —, e o recorte
  // por emissão feito depois zeraria o conjunto inteiro. O mês da visão fiscal é
  // aplicado sobre `emission_date`, adiante (e no frontend, para a lista).
  const monthSql = fiscal ? null : month
  const statusList = status ? String(status).split(',').map(s => s.trim()).filter(Boolean) : []
  let rows
  if (statusList.length && caixa) {
    // Caixa: pendentes/parciais até o mês de caixa do filtro (inclusive), acumulando meses anteriores.
    // Ordem SEMPRE por competência (year/month asc) — distribuição segue mês mais antigo primeiro.
    rows = month
      ? await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount, i.emission_date, rcv.status as receivable_status FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN receivables rcv ON rcv.id = i.receivable_id WHERE p.company_id = ${company_id} AND p.status = ANY(${statusList}) AND (p.payment_year < ${year} OR (p.payment_year = ${year} AND p.payment_month <= ${month})) ORDER BY p.year ASC, p.month ASC, p.created_at ASC`
      : await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount, i.emission_date, rcv.status as receivable_status FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN receivables rcv ON rcv.id = i.receivable_id WHERE p.company_id = ${company_id} AND p.status = ANY(${statusList}) AND p.payment_year = ${year} ORDER BY p.year ASC, p.month ASC, p.created_at ASC`
  } else if (statusList.length) {
    // Competência (padrão): todos os pendentes/parciais, mês mais antigo primeiro (year/month asc).
    rows = await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount, i.emission_date, rcv.status as receivable_status FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN receivables rcv ON rcv.id = i.receivable_id WHERE p.company_id = ${company_id} AND p.status = ANY(${statusList}) ORDER BY p.year ASC, p.month ASC, p.created_at ASC`
  } else if (caixa) {
    rows = month
      ? await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount, i.emission_date, rcv.status as receivable_status FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN receivables rcv ON rcv.id = i.receivable_id WHERE p.company_id = ${company_id} AND p.payment_year = ${year} AND p.payment_month = ${month} ORDER BY p.payment_month DESC, p.created_at DESC`
      : await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount, i.emission_date, rcv.status as receivable_status FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN receivables rcv ON rcv.id = i.receivable_id WHERE p.company_id = ${company_id} AND p.payment_year = ${year} ORDER BY p.payment_month DESC, p.created_at DESC`
  } else {
    rows = monthSql
      ? await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount, i.emission_date, rcv.status as receivable_status FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN receivables rcv ON rcv.id = i.receivable_id WHERE p.company_id = ${company_id} AND p.year = ANY(${anos}) AND p.month = ${monthSql} ORDER BY p.month DESC, p.created_at DESC`
      : await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount, i.emission_date, rcv.status as receivable_status FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN receivables rcv ON rcv.id = i.receivable_id WHERE p.company_id = ${company_id} AND p.year = ANY(${anos}) ORDER BY p.month DESC, p.created_at DESC`
  }
  const ids = rows.map(r => r.id)
  let payments = []
  if (ids.length) {
    payments = await sql`SELECT * FROM payable_payments WHERE payable_type = 'victor' AND payable_id = ANY(${ids}) ORDER BY paid_at DESC, id DESC`
  }
  const byId = {}
  for (const p of payments) { (byId[p.payable_id] ||= []).push(p) }
  for (const r of rows) { r.payments = byId[r.id] || [] }
  let breakdown = null

  // Composição fiscal da fatura que gerou o payable: quanto do imposto real do mês
  // coube a esta NF, por tipo, e de onde o dinheiro saiu.
  //
  // É LEITURA, não linha nova. O imposto nunca vira um payable: ele já está descontado
  // do que o Victor recebe — parte pela provisão retida na fatura (invoices.tax_amount),
  // o excedente pela cascata lucro→serviço de lib/fiscal-redistribution.js. Materializar
  // DAS/INSS/honorários como registros em payables_victor descontaria o mesmo imposto
  // duas vezes e, pior, os colocaria em `candidatosDisponiveis` — a distribuição passaria
  // a consumir a linha do DAS como se fosse dinheiro a receber.
  //
  // A fonte é fiscal_allocations (basis='proporcional_nf'), a MESMA de que sai a tabela
  // "Custo por cliente" da tela /fiscal. Rateio e from_service/from_profit já são
  // gravados pelo ?action=apurar e pelo ?action=recalcular; aqui só se lê.
  const invIds = [...new Set(rows.map((r) => r.invoice_id).filter(Boolean))]
  if (invIds.length) {
    const [taxes, allocs, consumidoPorPayable] = await Promise.all([
      // `require_nf` vem junto porque a tabela tabulada exclui o cliente sem nota (a
      // Minas): sem NF ele não entra no rateio de DAS/INSS/Escritório, e o Victor recebe
      // e paga esse contrato à parte. Ver lib/victor-tabulado.js.
      sql`
        SELECT id, tax_amount, invoice_value, victor_service, victor_profit,
               victor_tax_diff, fabricio_total, require_nf
        FROM invoices WHERE id = ANY(${invIds})`,
      // `obrigacao_total` = o rateio INTEIRO daquela obrigação, não só a parte das notas
      // desta consulta. É o denominador do percentual que a tela mostra ("INSS 92,74%").
      // Vem por CTE na mesma query — uma ida ao banco, e um dono só para o percentual:
      // calculá-lo no browser como fatia/soma-dos-visíveis daria 100% sempre que a tela
      // estivesse filtrada num mês, que é o caso normal.
      sql`
        WITH alvo AS (
          SELECT DISTINCT obligation_id FROM fiscal_allocations
          WHERE basis = 'proporcional_nf' AND invoice_id = ANY(${invIds})
        ), tot AS (
          SELECT fa.obligation_id, SUM(fa.amount) AS total
          FROM fiscal_allocations fa
          JOIN alvo ON alvo.obligation_id = fa.obligation_id
          WHERE fa.basis = 'proporcional_nf'
          GROUP BY fa.obligation_id
        )
        SELECT a.invoice_id, o.kind,
               SUM(a.amount)                      AS amount,
               SUM(COALESCE(a.from_service, 0))   AS from_service,
               SUM(COALESCE(a.from_profit, 0))    AS from_profit,
               MAX(t.total)                       AS obrigacao_total,
               -- Uma NF pertence a UMA competência (pela emissão) e há uma obrigação por
               -- kind/competência (UNIQUE), então o MAX aqui é exato, não uma escolha.
               -- Serve para deduplicar o denominador do percentual: um cliente com duas
               -- NFs na mesma guia não pode contá-la duas vezes.
               MAX(a.obligation_id)               AS obligation_id,
               -- Os dois valores da obrigação, para reconstruir os momentos 2 e 3.
               -- fiscal_allocations guarda só o rateio VIGENTE: quando a guia é lançada,
               -- o rerateio sobrescreve o que fora rateado do estimado. Com o estimado e o
               -- oficial em mãos, momentosDaLinha() recompõe os dois pela proporção, sem
               -- um segundo motor de rateio para divergir do primeiro no arredondamento.
               MAX(o.amount_estimated)            AS obrigacao_estimado,
               MAX(o.amount_actual)               AS obrigacao_real,
               -- Quanto da GUIA já foi pago (fiscal_payments, re-somado por
               -- recalcularObrigacao). Sob a Opção 1 é daqui que sai o "pago" de cada
               -- linha: o imposto não é mais abatido de payable, é quitado com caixa, e a
               -- fatia do cliente no que foi pago é a mesma proporção do rateio.
               MAX(o.paid_amount)                 AS obrigacao_pago
        FROM fiscal_allocations a
        JOIN fiscal_obligations o ON o.id = a.obligation_id
        JOIN tot t ON t.obligation_id = a.obligation_id
        WHERE a.basis = 'proporcional_nf' AND a.invoice_id = ANY(${invIds})
        GROUP BY a.invoice_id, o.kind`,
      // Quanto de cada imposto JÁ saiu do saldo deste payable (`consumo_payable`, gravado
      // pelo ?action=distribuir e pelo ?action=pagar-com-rateio).
      //
      // Sem isto, a linha de imposto do painel "Distribuição do saldo" mostraria o rateio
      // cheio mesmo depois de quitado, e um segundo pagamento da mesma guia pareceria
      // devido. É por payable (não por cliente, como o breakdown da aba) porque o painel
      // lista LANÇAMENTOS, e a mesma guia pode alcançar dois deles.
      sql`
        SELECT a.payable_victor_id, o.kind, SUM(a.amount) AS amount
        FROM fiscal_allocations a
        JOIN fiscal_obligations o ON o.id = a.obligation_id
        WHERE a.basis = 'consumo_payable' AND a.payable_victor_id = ANY(${ids})
        GROUP BY a.payable_victor_id, o.kind`,
    ])
    // payable_id → { kind: já consumido }
    const pagoPorPayable = new Map()
    for (const c of consumidoPorPayable) {
      const pid = Number(c.payable_victor_id)
      if (!pagoPorPayable.has(pid)) pagoPorPayable.set(pid, {})
      pagoPorPayable.get(pid)[c.kind] = r2((pagoPorPayable.get(pid)[c.kind] || 0) + (parseFloat(c.amount) || 0))
    }
    const provisao = new Map(taxes.map((t) => [Number(t.id), parseFloat(t.tax_amount) || 0]))
    const faturas = new Map(taxes.map((t) => [Number(t.id), t]))
    const porFatura = new Map()
    for (const a of allocs) {
      const k = Number(a.invoice_id)
      if (!porFatura.has(k)) porFatura.set(k, [])
      const total = parseFloat(a.obrigacao_total) || 0
      const amount = parseFloat(a.amount) || 0
      porFatura.get(k).push({
        kind: a.kind,
        amount,
        from_service: parseFloat(a.from_service) || 0,
        from_profit: parseFloat(a.from_profit) || 0,
        // Fatia desta NF na guia do mês. `obrigacao_total` é o denominador completo.
        obrigacao_total: total,
        obligation_id: a.obligation_id == null ? null : Number(a.obligation_id),
        percentual: total > 0 ? r2((amount / total) * 100) : null,
        // `null` = guia oficial ainda não lançada, distinto de uma guia de R$ 0,00.
        obrigacao_estimado: a.obrigacao_estimado == null ? null : parseFloat(a.obrigacao_estimado),
        obrigacao_real: a.obrigacao_real == null ? null : parseFloat(a.obrigacao_real),
        obrigacao_pago: parseFloat(a.obrigacao_pago) || 0,
      })
    }
    for (const r of rows) {
      // ⚠️ `require_nf` fica na LINHA, não só na fatura: a tabela tabulada precisa dele
      // mesmo quando a nota não gerou rateio nenhum (mês não apurado). Só `false` exclui —
      // nulo é tributável, o mesmo predicado `temNf` de api/fiscal-obligations.js.
      const inv0 = faturas.get(Number(r.invoice_id))
      if (inv0) r.require_nf = inv0.require_nf
      const base = porFatura.get(Number(r.invoice_id))
      if (!base?.length) continue
      base.sort((a, b) => ORDEM_KIND.indexOf(a.kind) - ORDEM_KIND.indexOf(b.kind))
      // Cópia por LINHA, não a referência do mapa por fatura: `pago`/`saldo` são do
      // payable, e mutar o objeto compartilhado vazaria o consumo de um para o outro se
      // duas linhas apontassem para a mesma nota.
      const jaPago = pagoPorPayable.get(Number(r.id)) || {}
      const linhas = base.map((l) => {
        // Duas origens para o "já pago" desta fatia, e o MAIOR vence — nunca a soma:
        //
        //   1. `consumo_payable`  abatimento histórico: saiu do saldo DESTE payable.
        //      Sob a Opção 1 não se cria mais nenhum, mas os antigos continuam válidos.
        //   2. a fatia proporcional de `fiscal_obligations.paid_amount` — a guia foi paga
        //      com caixa, e a parte desta NF nela caiu junto.
        //
        // Somar contaria duas vezes: todo abatimento também gravava fiscal_payments, então
        // ele JÁ está dentro de `paid_amount`. O max é o piso certo — a guia pode ter sido
        // quitada só em parte, e por outro cliente.
        const abatido = r2(jaPago[l.kind] || 0)
        const rateado = l.obrigacao_total > 0
          ? r2((l.amount / l.obrigacao_total) * l.obrigacao_pago)
          : 0
        const pago = Math.max(abatido, rateado)
        return { ...l, pago, pago_abatido: abatido, pago_guia: rateado, saldo: r2(Math.max(l.amount - pago, 0)) }
      })
      const total = r2(linhas.reduce((s, l) => s + l.amount, 0))
      const do_servico = r2(linhas.reduce((s, l) => s + l.from_service, 0))
      const do_lucro = r2(linhas.reduce((s, l) => s + l.from_profit, 0))
      const provisionado = provisao.get(Number(r.invoice_id)) ?? 0

      // Cascata do lucro (Escritório → INSS → DAS) para exibição.
      //
      // Calculada aqui, e não lida das colunas, porque as colunas só são escritas por
      // `?action=recalcular` com `aplicar: true`: fatura recebida cujo mês ainda não foi
      // redistribuído mostraria uma cascata toda zerada — pior que não mostrar nada.
      // Como sai das mesmas duas funções exportadas que fazem a gravação, os dois
      // caminhos não têm como divergir (as colunas continuam sendo o histórico).
      const inv = faturas.get(Number(r.invoice_id))
      if (inv) {
        const porKind = {}
        for (const l of linhas) porKind[l.kind] = r2((porKind[l.kind] || 0) + l.amount)
        const baseService = r2(parseFloat(inv.victor_service) || 0)
        const baseProfit = r2((parseFloat(inv.victor_profit) || 0) + (parseFloat(inv.victor_tax_diff) || 0))
        // `aplicarDelta` (a matemática) e `absorverDelta` (o que de fato acontece) são
        // duas perguntas diferentes e a cascata precisa das duas: quanto o imposto COMERIA
        // do lucro é o que a cascata ilustra; quanto ele DE FATO tirou do payable é zero
        // sob a Opção 1 — e é esse par que as colunas ORIGINAL/ABSORVEU da tela mostram.
        const hipotetico = aplicarDelta(baseService, baseProfit, r2(total - provisionado))
        const alvo = absorverDelta(baseService, baseProfit, r2(total - provisionado))
        r.cascata = cascataDoLucro({
          baseProfit, provisionado, porKind, nao_coberto: alvo.nao_coberto,
        })
        // Absorção REAL, para a tela não ter de deduzi-la de `lucro_antes_escritorio`
        // menos `profit_amount` — subtração que, com o payable já intacto, devolveria a
        // provisão de 7% como se fosse absorção.
        r.cascata.absorvido_lucro = alvo.from_profit
        r.cascata.absorvido_servico = alvo.from_service
        // Quanto o imposto TERIA comido, se ainda fosse absorvido. Puramente informativo.
        r.cascata.comeria_do_lucro = hipotetico.from_profit
        r.cascata.comeria_do_servico = hipotetico.from_service
        // Dupla checagem da decomposição da NF. A identidade que tem de fechar:
        //   NF = imposto real + serviço Victor + lucro Victor + Fabrício
        // (o gross-up do imposto do cliente já está dentro de victor_tax_diff → lucro).
        // Fabrício sai da FATURA, não do payable: é a decomposição da nota que se está
        // conferindo, e ela existe mesmo antes de o recebimento gerar o payable dele.
        const fabricio = r2(parseFloat(inv.fabricio_total) || 0)
        const nf = r2(parseFloat(inv.invoice_value) || 0)
        const soma = r2(total + (parseFloat(r.service_amount) || 0) + (parseFloat(r.profit_amount) || 0) + fabricio)
        const diferenca = r2(soma - nf)
        // Tolerância de centavo: a soma atravessa ~6 arredondamentos independentes (um
        // por kind rateado, mais serviço, lucro e Fabrício), e o `ratear` ainda joga o
        // resíduo na maior fatia. Caso real em Jan/2026: Pharmalog fecha em 9.775,01
        // contra NF de 9.775,00. Abaixo de R$ 0,05 é arredondamento, não erro.
        // ⚠️ Sob a Opção 1 esta identidade PASSA A NÃO FECHAR, e não é erro.
        //
        // A NF reteve a provisão de 7%; o imposto real é maior. Enquanto o excedente era
        // descontado do Victor, ele saía da soma e a conta fechava. Agora ele fica devido
        // ao fisco e sai do caixa da empresa — então a decomposição da nota sobra
        // exatamente pelo excedente. Caso real: NF 6 fecha em 10.117,44 contra 9.775,00,
        // e os 342,44 são o imposto que a nota não reteve.
        //
        // Marcado como explicado em vez de silenciado: o desvio continua visível (é um
        // custo que alguém tem de pagar), só não é mais reportado como conta errada.
        const excedente_fiscal = r2(total - provisionado)
        r.conferencia = {
          nf, fabricio, soma, diferenca, excedente_fiscal,
          explicado_pelo_excedente: Math.abs(r2(diferenca - excedente_fiscal)) <= 0.05,
          confere: Math.abs(diferenca) <= 0.05,
        }
      }

      r.fiscal = {
        linhas, total, provisionado, do_servico, do_lucro,
        // Excedente do imposto real sobre a provisão que ainda NÃO foi absorvido pelo
        // payable. Diferente de zero = a apuração já rateou, mas o ?action=recalcular
        // nunca foi aplicado — o Victor ainda está vendo o valor da provisão.
        //
        // ⚠️ Zero por definição sob a Opção 1: nada mais é redistribuído, então não há
        // pendência de redistribuição. Mantido calculado (e não removido) porque a conta
        // volta a valer se ABSORVER_IMPOSTO_NO_PAYABLE voltar a `true`.
        //
        // Sem este corte a tela avisaria "R$ 342,43 de imposto ainda não redistribuído" em
        // TODA nota, para sempre, apontando para um botão em /fiscal que não faz mais nada.
        a_redistribuir: ABSORVER_IMPOSTO_NO_PAYABLE
          ? r2(total - provisionado - do_servico - do_lucro)
          : 0,
      }
    }
  }

  // ── BREAKDOWN POR CLIENTE ──────────────────────────────────────────────────────
  // Só quando a aba pede: é uma query a mais, e o Dashboard e o Histórico consomem
  // este mesmo recorte sem precisar dela.
  //
  // Montado sobre as linhas já filtradas e enriquecidas, e não numa rota própria:
  // a lista e o breakdown passam a ser a mesma leitura vista de dois ângulos, então não
  // há recorte de mês/visão para divergir entre eles.
  //
  // Fora do `if (invIds.length)` de propósito: um mês só com lançamentos manuais não tem
  // fatura nenhuma e mesmo assim tem serviço/lucro a pagar por cliente.
  //
  // O percentual do rateio NÃO é consultado aqui: `r.fiscal.linhas` já traz
  // `obrigacao_total` (CTE da query acima) e montarBreakdown() acumula numerador e
  // denominador. Uma query a menos e um dono só para a fatia.
  if (comBreakdown) {
    // Quanto de cada imposto já foi PAGO, por cliente — o que o breakdown usa para fechar
    // o saldo das três categorias fiscais.
    //
    // Sai das linhas que acabaram de ser montadas (`l.pago`), e não mais de uma query
    // própria sobre `consumo_payable`. Duas razões:
    //
    //   1. sob a Opção 1 a guia é quitada com caixa e não gera `consumo_payable` nenhum —
    //      a query devolveria zero e o card mostraria o imposto eternamente em aberto,
    //      mesmo depois de pago em /fiscal;
    //   2. um dono só. `l.pago` já resolve abatimento antigo × fatia da guia paga (ver o
    //      `Math.max` acima), e o card passa a somar exatamente o que a linha do painel
    //      mostra — divergir aí seria o mesmo card afirmando dois saldos.
    //
    // ⚠️ Muda a ATRIBUIÇÃO em um caso: quando o INSS do Pharmalog saiu, no passado, do
    // saldo do Bokada (fallback), a query antiga creditava o pagamento ao Bokada — quem
    // teve o saldo debitado. Aqui ele conta para o Pharmalog, o dono do imposto. É o que
    // faz sentido agora: ninguém mais paga imposto de outro com saldo, e o que o card
    // responde é "quanto do MEU imposto já foi pago".
    // Somado sobre `alvo` (definido logo abaixo), não sobre `rows`: na visão fiscal a
    // query devolve dois anos de propósito, e contar o pago das linhas que o breakdown não
    // exibe daria um saldo menor que o das próprias categorias.
    const consumosDe = (linhas) => {
      const acc = new Map()
      for (const r of linhas) {
        const cid = r.client_id == null ? null : Number(r.client_id)
        if (cid == null) continue
        for (const l of r.fiscal?.linhas || []) {
          if (!(l.pago > 0)) continue
          if (!acc.has(cid)) acc.set(cid, {})
          acc.get(cid)[l.kind] = r2((acc.get(cid)[l.kind] || 0) + l.pago)
        }
      }
      return acc
    }

    // Recorte da visão FISCAL. As outras duas já vieram recortadas pela query (month
    // filtra p.month na competência e p.payment_month no caixa); a fiscal não pode —
    // ela agrupa por `invoices.emission_date`, e a query devolve de propósito um
    // superconjunto de dois anos para a NF de dezembro emitida em janeiro aparecer.
    // Sem refiltrar aqui o breakdown cobriria o ano inteiro enquanto a lista ao lado
    // mostra um mês, e a diferença passaria por erro de cálculo.
    //
    // ⚠️ `emission_date` chega como Date pelo driver e como string ISO pelo JSON — o
    // mesmo tropeço documentado em CLAUDE.md, onde String(date) virava "Mon Feb 02 2026"
    // e o split('-') caía no fallback de competência sem erro nenhum.
    const alvo = !fiscal ? rows : rows.filter((r) => {
      const d = r.emission_date
      const iso = d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10)
      const [ey, em] = iso.split('-').map(Number)
      const y = Number.isFinite(ey) ? ey : Number(r.year)
      const m = Number.isFinite(em) ? em : Number(r.month)
      return y === Number(year) && (!month || m === Number(month))
    })

    // ── MOMENTO 1 (PRÉVIO) ────────────────────────────────────────────────────────
    // Precisa de um mês: o pró-labore tem piso mensal e o escritório é valor fechado,
    // então "a previsão de todos os meses" não é uma soma, é um erro de categoria (seria
    // um piso de INSS por mês somado com outro). Sem filtro de mês a previsão é omitida
    // e a tela mostra só os momentos 2 e 3, que são por competência de verdade.
    const hoje = new Date()
    const curKey = hoje.getFullYear() * 100 + (hoje.getMonth() + 1)

    const mesPrevisao = month ? Number(month) : null
    let previo = null
    let previsao = null
    if (mesPrevisao) {
      const settings = (await sql`
        SELECT * FROM company_settings WHERE company_id = ${company_id} LIMIT 1`)[0] || {}
      // Mês fechado não projeta contrato mensal — ver buscarFaturamentoPrevisto().
      const projetarContratos = (Number(year) * 100 + mesPrevisao) >= curKey
      const fat = await buscarFaturamentoPrevisto(sql, company_id, mesPrevisao, Number(year), { projetarContratos })
      previo = momentoPrevio({ porCliente: fat.porCliente, base: fat.base, settings })
      previsao = {
        mes: fat.mes, ano: fat.ano, base: fat.base,
        contratos_projetados: fat.contratos_projetados,
        ...previo.mes,
        detalhe: [...fat.porCliente.values()].map((c) => ({
          client_id: c.client_id,
          emitido: c.emitido,
          nao_faturado: c.nao_faturado,
          base: c.base,
          horas: c.horas,
          lancamentos: c.lancamentos,
          contratos: c.contratos,
        })).filter((d) => d.base > 0),
      }
    }

    // Nomes: o breakdown recebe as linhas de payables_victor (que já trazem
    // `client_name` do JOIN), mas a previsão pode conter cliente que ainda não tem
    // payable nenhum — e aí o nome não vem de lugar algum.
    const nomes = new Map()
    const idsPrev = [...(previo?.clientes?.keys() || [])]
    if (idsPrev.length) {
      for (const c of await sql`SELECT id, name FROM clients WHERE id = ANY(${idsPrev})`) {
        nomes.set(Number(c.id), c.name)
      }
    }

    // `curKey` (acima) é o teto de caixa de HOJE — o mesmo que candidatosDisponiveis()
    // aplicará no pagamento. É a data corrente, não o mês do filtro: a restrição real é
    // "não consumir dinheiro que ainda não entrou", e quem a define é o calendário.
    // Olhar abril em março mostra os saldos, mas eles ficam marcados como bloqueados —
    // que é a informação que faltava, já que a recusa do backend era silenciosa.
    breakdown = montarBreakdown({ rows: alvo, consumos: consumosDe(alvo), nomes, previo, curKey })
    breakdown.previsao = previsao
    breakdown.caixa = {
      mes_referencia: hoje.getMonth() + 1,
      ano_referencia: hoje.getFullYear(),
      bloqueado: breakdown.totais.bloqueado_futuro,
    }
    // `?momento=` só diz qual dos três a tela abre destacando — os três vêm sempre.
    // Devolver um só faria a comparação exigir três requisições, e o valor de pôr as
    // etapas lado a lado é justamente vê-las juntas.
    const pedido = String(momento || '').trim()
    breakdown.momento = ['previo', 'real', 'final'].includes(pedido) ? pedido : null
  }

  return { rows, breakdown, anos, fiscal, caixa }
}
