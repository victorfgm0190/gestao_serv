// OS TRÊS MOMENTOS DO IMPOSTO, POR CLIENTE.
//
// O custo fiscal de um cliente muda três vezes ao longo do mês, e até aqui a aba só
// mostrava o último estado — o que faz o número "mudar sozinho" entre duas visitas à
// tela sem que nada explique por quê.
//
//   1. PRÉVIO  — antes da NF. O trabalho já foi feito (horas apontadas) ou já é devido
//                (contrato mensal), mas a nota não saiu. O imposto é a PROVISÃO que a
//                fatura vai reter, mais INSS e escritório estimados pelo mês.
//   2. REAL    — a apuração rodou (?action=apurar). O DAS deixa de ser a provisão do
//                contrato e passa a ser a alíquota efetiva do Simples sobre o mês.
//   3. FINAL   — a guia oficial chegou (?action=lancar-guia / corrigir-escritorio).
//                `amount_actual` substitui o estimado e o rateio é refeito.
//
// São as MESMAS três etapas que lib/fiscal-redistribution.js já percorre (a tabela em
// CLAUDE.md, "Redistribuição fiscal"). Este módulo não cria um quarto caminho: ele lê
// cada etapa de onde ela já mora e as coloca lado a lado.
//
// ⚠️ O QUE O MOMENTO 1 *NÃO* É. Os 7% de `contracts.tax_percentage` não são o DAS. São a
// provisão que a nota retém do bruto antes do split com o Fabrício; o DAS sai da tabela
// do Simples (lib/taxCalc.js), depende do faturamento do mês inteiro e da RBT12, e só
// existe depois da apuração. Chamar a provisão de "DAS prévio" na tela é aceitável como
// rótulo — é o que o Victor reserva —, mas tratá-la como DAS no CÓDIGO criaria um segundo
// dono do número do imposto, que é a classe de bug que este projeto já pagou duas vezes
// (o pró-labore com três donos, a regra financeira sorteada pela heap). Por isso a
// provisão aqui nunca é recalculada: sai de `invoices.tax_amount` para o que já foi
// faturado e de `contracts.tax_percentage` para o que ainda não foi.
//
// ⚠️ INSS E ESCRITÓRIO NÃO SÃO PROPORCIONAIS À NOTA — são valores do MÊS. O INSS é 11%
// sobre o pró-labore (que tem piso, então um mês magro paga o mesmo que um mês seco) e o
// escritório é um valor fechado. Por isso os dois são calculados sobre o mês inteiro e
// só então rateados por peso de faturamento, exatamente como `?action=apurar` faz. Somar
// "o INSS de cada nota" daria tantos pisos quantas fossem as notas.

import { proLaboreDoMes, calcINSS, parametrosFiscais } from './taxCalc.js'
import { r2 } from './victor-distribution.js'

const num = (v) => parseFloat(v) || 0

// Contrato sem NF (hoje só a Minas) não existe para o fisco. O predicado é o mesmo de
// `temNf` em api/fiscal-obligations.js — só `false` exclui, coluna nula é tributável — e
// está aplicado nas três queries como `IS DISTINCT FROM false`, para o filtro rodar no
// banco em vez de trazer a linha e descartá-la aqui.

// Gross-up do imposto cobrado do cliente por fora, igual a `calcContrato`/`calcAgenda`
// em api/invoices.js. A base do tributo é a NF, não o valor combinado.
const comGrossUp = (base, taxClientPct) => {
  const p = num(taxClientPct)
  return p > 0 ? r2(base / (1 - p / 100)) : r2(base)
}

// ─────────────────────────────────────────────────────────────────────────────────────
// FATURAMENTO PREVISTO DO MÊS
//
// Três parcelas, e as três precisam estar aqui para o Momento 1 não subestimar o imposto:
//
//   emitido        NFs que já saíram no mês (competência = data de emissão, a mesma de
//                  `faturasDoMes`). Entram porque o Momento 1 e o 2 têm de descrever a
//                  MESMA base — o que muda entre eles é a alíquota, não o faturamento.
//   horas          time_entries que nenhuma fatura consumiu ainda. `invoices.time_entry_ids`
//                  é o vínculo; um apontamento está faturado quando seu id aparece em
//                  algum array.
//   contratos      contrato fixo/mensal ativo que ainda não gerou nota no mês. Não tem
//                  apontamento nenhum — o valor é devido pelo calendário, não pelas horas —
//                  então sem esta parcela um mês só de contratos mensais preveria zero.
//
// ⚠️ O mês das horas sai de `entry_date`, não de month/year: time_entries não tem essas
// colunas. E o mês do contrato é o mês pedido, porque a competência de um contrato mensal
// é o próprio mês — não há emissão de que derivá-la.
//
// ⚠️ `projetarContratos: false` PRECISA ser passado para meses já fechados, e é por isso
// que a opção existe. `contracts` não tem data de início nem de fim: um contrato mensal
// ativo hoje parece ativo desde sempre, e "sem nota no mês" seria lido como pendência em
// todo mês anterior à sua criação. Os três contratos fixos do banco faturaram apenas
// 06-07/2026 (SteelDek), 04/2026 (ALEX) e 07-08/2026 (Bokada) — sem o corte, janeiro
// apareceria devendo R$ 6.000 de um contrato que ainda nem existia, e a previsão do mês
// fechado ficaria maior que o faturamento real dele.
//
// Num mês fechado a ausência de nota é informação: não foi faturado, e ponto. A projeção
// por calendário só faz sentido do mês corrente em diante, onde a nota ainda pode sair.
// As horas apontadas continuam entrando em qualquer mês — ali existe registro do trabalho,
// não uma inferência a partir do calendário.
export async function buscarFaturamentoPrevisto(sql, company_id, mes, ano, { projetarContratos = true } = {}) {
  const m = Number(mes)
  const y = Number(ano)

  const [emitidas, horas, contratos] = await Promise.all([
    // NFs do mês pela data de EMISSÃO, com o mesmo COALESCE de faturasDoMes: fatura antiga
    // sem `emission_date` cai no par (year, month) dela própria. Filtrar por
    // `emission_date IS NOT NULL` a faria sumir e subestimaria a base.
    sql`
      SELECT i.client_id, i.id AS invoice_id, i.invoice_value, i.tax_amount
      FROM invoices i
      WHERE i.company_id = ${company_id}
        AND i.require_nf IS DISTINCT FROM false
        AND EXTRACT(YEAR  FROM COALESCE(i.emission_date, make_date(i.year, i.month, 1)))::int = ${y}
        AND EXTRACT(MONTH FROM COALESCE(i.emission_date, make_date(i.year, i.month, 1)))::int = ${m}`,

    sql`
      SELECT te.client_id,
             SUM(te.gross_value)                       AS bruto,
             SUM(te.hours)                             AS horas,
             COUNT(*)                                  AS lancamentos,
             MAX(COALESCE(ct.tax_client_percent, 0))   AS tax_client_percent,
             MAX(CASE WHEN ct.has_tax THEN ct.tax_percentage ELSE 0 END) AS tax_percentage
      FROM time_entries te
      LEFT JOIN contracts ct ON ct.id = te.contract_id
      WHERE te.company_id = ${company_id}
        AND EXTRACT(YEAR  FROM te.entry_date)::int = ${y}
        AND EXTRACT(MONTH FROM te.entry_date)::int = ${m}
        AND COALESCE(ct.require_nf, true) IS DISTINCT FROM false
        AND NOT EXISTS (
          SELECT 1 FROM invoices i
          WHERE i.company_id = te.company_id AND te.id = ANY(i.time_entry_ids)
        )
      GROUP BY te.client_id`,

    // Contrato fixo ativo sem nota no mês. `billing_type` 'contract' e 'mensal' são o
    // mesmo caso com dois rótulos no banco (ver api/invoices.js).
    !projetarContratos ? [] : sql`
      SELECT ct.id AS contract_id, ct.client_id, ct.name,
             ct.contract_value,
             COALESCE(ct.tax_client_percent, 0) AS tax_client_percent,
             CASE WHEN ct.has_tax THEN ct.tax_percentage ELSE 0 END AS tax_percentage
      FROM contracts ct
      WHERE ct.company_id = ${company_id}
        AND ct.is_active = true
        AND ct.billing_type IN ('contract','mensal')
        AND ct.require_nf IS DISTINCT FROM false
        AND COALESCE(ct.contract_value, 0) > 0
        AND NOT EXISTS (
          SELECT 1 FROM invoices i
          WHERE i.contract_id = ct.id AND i.month = ${m} AND i.year = ${y}
        )`,
  ])

  const porCliente = new Map()
  const pega = (cid) => {
    const k = Number(cid)
    if (!porCliente.has(k)) {
      porCliente.set(k, {
        client_id: k,
        emitido: 0, provisao_emitida: 0, invoice_ids: [],
        nao_faturado: 0, provisao_prevista: 0,
        horas: 0, lancamentos: 0, contratos: [],
      })
    }
    return porCliente.get(k)
  }

  for (const i of emitidas) {
    if (i.client_id == null) continue
    const c = pega(i.client_id)
    c.emitido = r2(c.emitido + num(i.invoice_value))
    // A provisão do que já foi faturado é DADO, não estimativa: está gravada na nota.
    c.provisao_emitida = r2(c.provisao_emitida + num(i.tax_amount))
    c.invoice_ids.push(Number(i.invoice_id))
  }

  for (const h of horas) {
    if (h.client_id == null) continue
    const c = pega(h.client_id)
    const nf = comGrossUp(num(h.bruto), h.tax_client_percent)
    c.nao_faturado = r2(c.nao_faturado + nf)
    c.provisao_prevista = r2(c.provisao_prevista + r2(nf * (num(h.tax_percentage) / 100)))
    c.horas = r2(c.horas + num(h.horas))
    c.lancamentos += Number(h.lancamentos) || 0
  }

  for (const ct of contratos) {
    if (ct.client_id == null) continue
    const c = pega(ct.client_id)
    const nf = comGrossUp(num(ct.contract_value), ct.tax_client_percent)
    c.nao_faturado = r2(c.nao_faturado + nf)
    c.provisao_prevista = r2(c.provisao_prevista + r2(nf * (num(ct.tax_percentage) / 100)))
    c.contratos.push({ contract_id: Number(ct.contract_id), nome: ct.name, valor: nf })
  }

  let base = 0
  for (const c of porCliente.values()) {
    c.base = r2(c.emitido + c.nao_faturado)
    c.provisao = r2(c.provisao_emitida + c.provisao_prevista)
    base = r2(base + c.base)
  }

  return { porCliente, base, mes: m, ano: y, contratos_projetados: projetarContratos }
}

// ─────────────────────────────────────────────────────────────────────────────────────
// MOMENTO 1 — o imposto previsto do mês, rateado por peso de faturamento.
//
// `settings` é a linha de company_settings. As três contas saem das funções de
// lib/taxCalc.js que a apuração usa; nenhuma constante é redigitada aqui — o piso do
// pró-labore muda todo janeiro e um `1621` solto neste arquivo envelheceria calado.
//
// O resíduo do arredondamento vai para a maior fatia, como em `ratear()`: sem isso a
// soma das fatias não fecha com o total e a tela mostra um centavo órfão.
export function momentoPrevio({ porCliente, base, settings }) {
  const params = parametrosFiscais(settings)
  const prolabore = proLaboreDoMes(base, settings)
  const inssMes = calcINSS(prolabore)
  const escritorioMes = r2(params.honorarios_mensal)

  const clientes = [...porCliente.values()]
  const pesos = clientes.map((c) => ({
    client_id: c.client_id,
    peso: base > 0 ? c.base / base : 0,
    base: c.base,
    // O "DAS prévio" é a PROVISÃO — gravada na nota quando ela existe, calculada pelo
    // percentual do contrato quando não. Nunca a alíquota do Simples: essa é o Momento 2.
    das: c.provisao,
  }))

  const distribuir = (total, campo) => {
    if (!clientes.length || total <= 0) {
      for (const p of pesos) p[campo] = 0
      return
    }
    for (const p of pesos) p[campo] = r2(total * p.peso)
    const soma = r2(pesos.reduce((s, p) => s + p[campo], 0))
    const residuo = r2(total - soma)
    if (Math.abs(residuo) >= 0.01) {
      const maior = pesos.reduce((a, b) => (b.peso > a.peso ? b : a))
      maior[campo] = r2(maior[campo] + residuo)
    }
  }
  distribuir(inssMes, 'inss')
  distribuir(escritorioMes, 'escritorio')

  const mapa = new Map()
  for (const p of pesos) {
    mapa.set(p.client_id, {
      das: p.das,
      inss: p.inss,
      escritorio: p.escritorio,
      total: r2(p.das + p.inss + p.escritorio),
      base: p.base,
      peso: r2(p.peso * 100),
    })
  }

  return {
    clientes: mapa,
    mes: { base, prolabore, inss: inssMes, escritorio: escritorioMes, das: r2(pesos.reduce((s, p) => s + p.das, 0)) },
    params,
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────
// MOMENTOS 2 e 3, a partir do rateio que já existe.
//
// `fiscal_allocations` guarda UM estado por vez: o `?action=lancar-guia` refaz o rateio
// com `amount_actual` e sobrescreve o que havia sido rateado de `amount_estimated`. Ler
// os dois lá é impossível — o anterior não existe mais.
//
// A saída é reconstruir os dois pela PROPORÇÃO, não por um segundo rateio: `ratear()` é
// proporcional ao valor da NF, então o peso de um cliente numa guia é o mesmo qualquer que
// seja o valor rateado. Com `peso = fatia / total_rateado` valem
//
//     real_i  = peso_i × amount_estimated
//     final_i = peso_i × amount_actual
//
// e as duas linhas fecham com a guia sem depender de qual delas está gravada agora. Um
// segundo motor de rateio aqui divergiria do primeiro no arredondamento e faria a soma
// das fatias não bater com a guia — visível como centavos que aparecem e somem.
export function momentosDaLinha(l) {
  const total = num(l.obrigacao_total)
  const peso = total > 0 ? num(l.amount) / total : 0
  const estimado = l.obrigacao_estimado == null ? null : num(l.obrigacao_estimado)
  const oficial = l.obrigacao_real == null ? null : num(l.obrigacao_real)
  return {
    peso,
    real: estimado == null ? null : r2(estimado * peso),
    // `null` (guia não lançada) é diferente de zero (guia de R$ 0,00). A tela mostra
    // "aguardando guia" no primeiro caso e um valor no segundo.
    final: oficial == null ? null : r2(oficial * peso),
  }
}
