import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import { desfazerAbatimentoFiscal } from '../lib/fiscal-unlink.js'
import { statusFor } from '../lib/payment-status.js'
import { CLIENT_PHARMA, CATS, r2, ordenar, consumir, candidatosDisponiveis, montarNotes } from '../lib/victor-distribution.js'
// Ordem canônica dos kinds — a mesma que a aba usa para exibir. Uma cópia só.
import { ORDEM_KIND } from '../lib/fiscal-lines.js'
// A cascata exibida sai das MESMAS funções que a gravam em ?action=recalcular.
import { aplicarDelta, cascataDoLucro } from '../lib/fiscal-redistribution.js'

// Recalcula o pai de um payable_victor após alterar seus pagamentos.
async function recalcVictorParent(sql, payable_id) {
  const agg = await sql`SELECT COALESCE(SUM(amount),0) AS s, MAX(paid_at) AS last FROM payable_payments WHERE payable_type='victor' AND payable_id=${payable_id}`
  const s = parseFloat(agg[0].s) || 0
  const last = agg[0].last || null
  const pr = await sql`SELECT total_amount FROM payables_victor WHERE id=${payable_id}`
  const tot = parseFloat(pr[0]?.total_amount) || 0
  const st = statusFor(s, tot)
  await sql`UPDATE payables_victor SET paid_amount=${s.toFixed(2)}, status=${st}, paid_at=${last} WHERE id=${payable_id}`
}

// Estorna uma sessão de recebimento (todos os payable_payments com mesmo paid_at + notes)
// da empresa e recalcula os pais afetados. Usado no fluxo de edição.
async function estornarSessao(sql, company_id, sess_paid_at, sess_notes) {
  const sess = await sql`
    SELECT DISTINCT pp.payable_id
    FROM payable_payments pp JOIN payables_victor pv ON pv.id = pp.payable_id
    WHERE pp.payable_type='victor' AND pv.company_id=${company_id}
      AND pp.paid_at=${sess_paid_at} AND pp.notes=${sess_notes}`
  const ids = sess.map(s => s.payable_id)
  if (!ids.length) return []
  await sql`DELETE FROM payable_payments WHERE payable_type='victor' AND payable_id = ANY(${ids}) AND paid_at=${sess_paid_at} AND notes=${sess_notes}`
  for (const id of ids) await recalcVictorParent(sql, id)
  return ids
}

// POST ?action=pagar-distribuido — Etapa 2: consumo de saldos entre múltiplos payables_victor.
async function pagarDistribuido(sql, req, res) {
  const { company_id, despesas = {}, mode, payable_id, overflow_action = null, overflow_target_id = null, paid_at, reference_month, reference_year, edit_session = null } = req.body

  let total = 0
  for (const k of Object.keys(CATS)) total = r2(total + (parseFloat(despesas[k]) || 0))
  if (total <= 0) return res.status(400).json({ error: 'Total de despesas deve ser maior que zero' })
  const notes = montarNotes(despesas)
  const when = paid_at || new Date().toISOString().split('T')[0]

  // Edição: estorna a sessão original (após validar o total) antes de redistribuir — restaura os saldos.
  if (edit_session && edit_session.paid_at && edit_session.notes) {
    await estornarSessao(sql, company_id, edit_session.paid_at, edit_session.notes)
  }

  // Teto do que pode ser consumido = mês de CAIXA da data do pagamento.
  //
  // Saía do filtro de competência da tela (`reference_month/year`) e era comparado, em
  // candidatosDisponiveis(), contra o mês de caixa do payable — dois relógios diferentes.
  // Como um payable de janeiro é pago em fevereiro POR CONSTRUÇÃO, o caixa é quase sempre
  // posterior à competência, e a regra "caixa <= competência do filtro" descartava
  // justamente os payables do mês que se estava olhando. Caso real: Jan/2026 da Lumen
  // tinha R$ 10.501,35 em aberto e o "Receber" gravava zero, com 200 OK e sem aviso.
  //
  // A regra que se quer é "não consumir caixa que ainda não entrou", e quem define isso é
  // a data do pagamento — a mesma que o `consumir()` já usa para gravar payment_month/year.
  // `reference_month/year` continua aceito como fallback (compatibilidade com chamadas
  // antigas) e é o que a edição de sessão envia quando cobre competências mais recentes.
  //
  // É o MAIOR entre os dois, não o do pagamento puro: ao editar uma sessão, o frontend
  // manda em `reference_*` a competência mais recente que a sessão já havia consumido, e
  // baixar o teto abaixo dela deixaria de fora payables que precisam ser redistribuídos.
  const now = new Date()
  const [payY, payM] = String(when).slice(0, 10).split('-').map(Number)
  const keyPagamento = payM ? payY * 100 + payM : 0
  const refMonth = reference_month ? Number(reference_month) : now.getMonth() + 1
  const refYear = reference_year ? Number(reference_year) : now.getFullYear()
  const curKey = Math.max(keyPagamento, refYear * 100 + refMonth)

  const candidatos = await candidatosDisponiveis(sql, company_id, curKey)

  // FLOW A — geral
  if (mode === 'geral') {
    const lista = ordenar(candidatos)
    const { writes, applied, restante } = consumir(sql, total, lista, when, notes)
    // Pool vazio não é sucesso. Antes daqui saía 200 com applied:[] e o modal fechava
    // como se tivesse gravado — o usuário só descobria olhando a lista depois.
    if (!writes.length) {
      return res.status(422).json({
        error: lista.length === 0
          ? `Nenhum lançamento disponível para consumir em ${String(refMonth).padStart(2, '0')}/${refYear}. Só entram os que já foram recebidos do cliente e cujo mês de caixa não é posterior à data do pagamento.`
          : 'Os lançamentos disponíveis já estão quitados — não há saldo a consumir.',
        candidatos: lista.length,
        leftover: restante,
      })
    }
    await sql.transaction(writes)
    return res.status(200).json({ mode: 'geral', applied, leftover: restante })
  }

  // FLOW B — especifico
  const target = candidatos.find(rec => rec.id === Number(payable_id))
  if (!target) return res.status(404).json({ error: 'Registro alvo não encontrado ou sem saldo' })
  const targetSaldo = target._saldo

  // Cabe tudo no alvo → paga normalmente e encerra
  if (total <= targetSaldo + 0.005) {
    const { writes } = consumir(sql, total, [target], when, notes)
    await sql.transaction(writes)
    return res.status(200).json({ mode: 'especifico', done: true })
  }

  const overflow = r2(total - targetSaldo)

  // Primeira chamada com sobra e sem decisão → não grava nada, pede decisão ao usuário
  if (!overflow_action) {
    return res.status(200).json({ mode: 'especifico', needsDecision: true, overflow, targetSaldo, target_id: target.id })
  }

  // Com decisão: paga o alvo cheio + distribui a sobra conforme a opção escolhida
  const others = candidatos.filter(rec => rec.id !== target.id)
  const targetFull = consumir(sql, targetSaldo, [target], when, notes)
  let writes = [...targetFull.writes]
  const applied = [...targetFull.applied]

  let poolList = []
  if (overflow_action === 'nada') {
    poolList = []
  } else if (overflow_action === 'pharma') {
    poolList = ordenar(others.filter(rec => rec.client_id === CLIENT_PHARMA))
  } else if (overflow_action === 'demais') {
    poolList = ordenar(others.filter(rec => rec.client_id !== CLIENT_PHARMA))
  } else if (overflow_action === 'mes') {
    const chosen = others.filter(rec => rec.id === Number(overflow_target_id))
    const rest = ordenar(others.filter(rec => rec.id !== Number(overflow_target_id)))
    poolList = [...chosen, ...rest]
  } else {
    return res.status(400).json({ error: 'overflow_action inválido' })
  }

  let leftover = overflow
  if (poolList.length) {
    const dist = consumir(sql, overflow, poolList, when, notes)
    writes = writes.concat(dist.writes)
    applied.push(...dist.applied)
    leftover = dist.restante
  }
  await sql.transaction(writes)
  return res.status(200).json({ mode: 'especifico', done: true, applied, leftover })
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  const sql = neon(process.env.DATABASE_URL)
  if (req.method === 'GET') {
    // Info da sessão de recebimento (para edição): payables afetados + valor consumido na sessão.
    if (req.query.action === 'sessao') {
      const { company_id, paid_at, notes } = req.query
      const pays = await sql`
        SELECT pp.payable_id, SUM(pp.amount) AS session_amount
        FROM payable_payments pp JOIN payables_victor pv ON pv.id = pp.payable_id
        WHERE pp.payable_type='victor' AND pv.company_id=${company_id}
          AND pp.paid_at=${paid_at} AND pp.notes=${notes}
        GROUP BY pp.payable_id`
      const ids = pays.map(p => p.payable_id)
      let affected = []
      if (ids.length) {
        const rows = await sql`SELECT p.*, c.name AS client_name FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = ANY(${ids})`
        const amt = {}
        for (const p of pays) amt[p.payable_id] = parseFloat(p.session_amount) || 0
        affected = rows.map(r => ({ ...r, session_amount: amt[r.id] || 0 }))
      }
      return res.status(200).json({ paid_at, notes, affected })
    }
    const { company_id, year, month, status, mode } = req.query
    const caixa = mode === 'caixa'  // caixa filtra por payment_month/payment_year
    // Visão fiscal: agrupa pela data de EMISSÃO da NF (invoices.emission_date), que é a
    // competência que o fisco enxerga — a mesma de `faturasDoMes` em fiscal-obligations.
    // O agrupamento em si é do frontend (effMonth/effYear); aqui só se garante que a
    // linha venha na resposta: uma NF de dezembro emitida em janeiro tem competência
    // 12/AAAA-1 e data fiscal 01/AAAA, e sem alargar a janela ela sumiria da visão.
    // A filtragem exata por ano fiscal é client-side, sobre este superconjunto.
    const fiscal = mode === 'fiscal'
    const anos = fiscal ? [Number(year) - 1, Number(year)] : [Number(year)]
    const statusList = status ? status.split(',').map(s => s.trim()).filter(Boolean) : []
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
      rows = month
        ? await sql`SELECT p.*, c.name as client_name, i.invoice_value as invoice_amount, i.emission_date, rcv.status as receivable_status FROM payables_victor p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN receivables rcv ON rcv.id = i.receivable_id WHERE p.company_id = ${company_id} AND p.year = ANY(${anos}) AND p.month = ${month} ORDER BY p.month DESC, p.created_at DESC`
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
      const [taxes, allocs] = await Promise.all([
        sql`
          SELECT id, tax_amount, invoice_value, victor_service, victor_profit,
                 victor_tax_diff, fabricio_total
          FROM invoices WHERE id = ANY(${invIds})`,
        sql`
          SELECT a.invoice_id, o.kind,
                 SUM(a.amount)                      AS amount,
                 SUM(COALESCE(a.from_service, 0))   AS from_service,
                 SUM(COALESCE(a.from_profit, 0))    AS from_profit
          FROM fiscal_allocations a
          JOIN fiscal_obligations o ON o.id = a.obligation_id
          WHERE a.basis = 'proporcional_nf' AND a.invoice_id = ANY(${invIds})
          GROUP BY a.invoice_id, o.kind`,
      ])
      const provisao = new Map(taxes.map((t) => [Number(t.id), parseFloat(t.tax_amount) || 0]))
      const faturas = new Map(taxes.map((t) => [Number(t.id), t]))
      const porFatura = new Map()
      for (const a of allocs) {
        const k = Number(a.invoice_id)
        if (!porFatura.has(k)) porFatura.set(k, [])
        porFatura.get(k).push({
          kind: a.kind,
          amount: parseFloat(a.amount) || 0,
          from_service: parseFloat(a.from_service) || 0,
          from_profit: parseFloat(a.from_profit) || 0,
        })
      }
      for (const r of rows) {
        const linhas = porFatura.get(Number(r.invoice_id))
        if (!linhas?.length) continue
        linhas.sort((a, b) => ORDEM_KIND.indexOf(a.kind) - ORDEM_KIND.indexOf(b.kind))
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
          const alvo = aplicarDelta(baseService, baseProfit, r2(total - provisionado))
          r.cascata = cascataDoLucro({
            baseProfit, provisionado, porKind, nao_coberto: alvo.nao_coberto,
          })
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
          r.conferencia = { nf, fabricio, soma, diferenca, confere: Math.abs(diferenca) <= 0.05 }
        }

        r.fiscal = {
          linhas, total, provisionado, do_servico, do_lucro,
          // Excedente do imposto real sobre a provisão que ainda NÃO foi absorvido pelo
          // payable. Diferente de zero = a apuração já rateou, mas o ?action=recalcular
          // nunca foi aplicado — o Victor ainda está vendo o valor da provisão.
          a_redistribuir: r2(total - provisionado - do_servico - do_lucro),
        }
      }
    }

    // Previsão: recebíveis pendentes/parciais (cliente ainda não pagou) que ainda não geraram
    // payable. Retornados como entradas "previsto" (is_preview) usando invoices.victor_total.
    if (req.query.include_preview === 'true') {
      const prev = caixa
        ? await sql`SELECT r.id AS receivable_id, r.month, r.year, r.payment_month, r.payment_year, c.name AS client_name, i.id AS invoice_id, i.victor_total FROM receivables r JOIN invoices i ON i.receivable_id = r.id LEFT JOIN clients c ON c.id = r.client_id WHERE r.company_id = ${company_id} AND r.status IN ('pendente','parcial') AND r.payment_year = ${year} AND NOT EXISTS (SELECT 1 FROM payables_victor pv WHERE pv.invoice_id = i.id)`
        : await sql`SELECT r.id AS receivable_id, r.month, r.year, r.payment_month, r.payment_year, c.name AS client_name, i.id AS invoice_id, i.victor_total, i.emission_date FROM receivables r JOIN invoices i ON i.receivable_id = r.id LEFT JOIN clients c ON c.id = r.client_id WHERE r.company_id = ${company_id} AND r.status IN ('pendente','parcial') AND r.year = ANY(${anos}) AND NOT EXISTS (SELECT 1 FROM payables_victor pv WHERE pv.invoice_id = i.id)`
      for (const p of prev) {
        rows.push({
          id: 'preview_' + p.receivable_id,
          client_name: p.client_name,
          month: p.month, year: p.year,
          payment_month: p.payment_month, payment_year: p.payment_year,
          emission_date: p.emission_date,
          total_amount: p.victor_total,
          status: 'previsto', origin: 'faturamento', is_preview: true,
          receivable_status: 'pendente', invoice_id: p.invoice_id, payments: [],
        })
      }
    }
    return res.status(200).json({ data: rows })
  }
  if (req.method === 'POST') {
    if (req.query.action === 'pagar-distribuido') return pagarDistribuido(sql, req, res)
    const { company_id, client_id, month, year, description, service_amount, profit_amount, notes } = req.body
    const total = (parseFloat(service_amount)||0) + (parseFloat(profit_amount)||0)
    const result = await sql`INSERT INTO payables_victor (company_id, client_id, month, year, description, service_amount, profit_amount, total_amount, notes, payment_month, payment_year) VALUES (${company_id}, ${client_id}, ${month}, ${year}, ${description}, ${service_amount||0}, ${profit_amount||0}, ${total.toFixed(2)}, ${notes||null}, ${month}, ${year}) RETURNING *`
    return res.status(201).json({ data: result[0] })
  }
  if (req.method === 'PATCH') {
    // Estorno: remove todos os pagamentos e volta o lançamento para pendente. Sempre permitido.
    if (req.query.action === 'estornar') {
      const id = req.query.id || req.body?.id
      if (!id) return res.status(400).json({ error: 'id obrigatório' })

      // ANTES de apagar os pagamentos: se este saldo foi consumido por uma distribuição
      // fiscal, desfazer o abatimento inteiro daquele mês. Sem isto a obrigação continuava
      // marcada como paga (os fiscal_payments de abatimento sobreviviam) enquanto o
      // dinheiro voltava para o Victor — o mesmo valor contado duas vezes.
      const fiscal = await desfazerAbatimentoFiscal(sql, [id], { ignorarPayables: [id] })

      await sql`DELETE FROM payable_payments WHERE payable_type = 'victor' AND payable_id = ${id}`
      const motivo = req.body?.motivo || null
      const result = await sql`
        UPDATE payables_victor SET
          status = 'pendente', paid_amount = 0, paid_at = NULL,
          notes = COALESCE(NULLIF(notes,'') || ' | ', '') || 'Estornado em ' ||
                  to_char(now() AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI') ||
                  COALESCE(' (' || ${motivo}::text || ')', '')
        WHERE id = ${id} RETURNING *`
      if (!result.length) return res.status(404).json({ error: 'Registro não encontrado' })
      return res.status(200).json({ data: result[0], action: 'estornar', fiscal })
    }
    const { id, paid_amount, paid_at, status, notes } = req.body
    const result = await sql`UPDATE payables_victor SET paid_amount=${paid_amount}, paid_at=${paid_at||null}, status=${status}, notes=${notes||null} WHERE id=${id} RETURNING *`
    return res.status(200).json({ data: result[0] })
  }
  if (req.method === 'DELETE') {
    const { id } = req.body
    const rows = await sql`SELECT origin FROM payables_victor WHERE id = ${id}`
    if (rows.length && rows[0].origin === 'faturamento') {
      return res.status(403).json({ error: 'Este registro foi gerado pelo Faturamento. Para removê-lo, estorne o recebimento da fatura correspondente.' })
    }
    await sql`DELETE FROM payables_victor WHERE id = ${id}`
    return res.status(200).json({ success: true })
  }
  res.status(405).json({ error: 'Method not allowed' })
}
