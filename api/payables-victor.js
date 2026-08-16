import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import { desfazerAbatimentoFiscal } from '../lib/fiscal-unlink.js'
import { statusFor } from '../lib/payment-status.js'
import { CLIENT_PHARMA, CATS, r2, ordenar, consumir, candidatosDisponiveis, montarNotes } from '../lib/victor-distribution.js'
// Pagamento roteado pelo rateio da apuração (?action=pagar-com-rateio).
import {
  CATEGORIA_KIND, buscarRateios, buscarRateiosPorNotas, planejar, agruparPorPayable, quitacoesPorObrigacao, LIMIAR_FIM,
} from '../lib/victor-rateio.js'
// Quitar a obrigação é parte do pagamento: sem isso a guia continua devida no card de
// Reservas enquanto o dinheiro já saiu do payable — o mesmo valor descontado duas vezes.
import { valorDevido, recalcularObrigacao } from '../lib/fiscal-status.js'
// Estornar tem de devolver o mês de CAIXA junto com o saldo — senão o payable fica
// encalhado no mês do pagamento desfeito. Ver lib/cash-month.js.
import { mesDeCaixaOriginal } from '../lib/cash-month.js'
// O recorte da aba (linhas + enriquecimento fiscal + breakdown por cliente) tem um dono
// só: o GET e o ?action=calcular-distribuicao leem pelo MESMO caminho, senão a tabela
// tabulada e os cards passam a descrever conjuntos de clientes diferentes.
import { carregarRecorte } from '../lib/victor-recorte.js'
// Tabela tabulada: rateio dos totais digitados + cascata Escritório → DAS → INSS →
// Lucro → Serviço. Agregação sobre o breakdown, não um segundo motor.
import { montarTabulado, CATEGORIAS_ENTRADA } from '../lib/victor-tabulado.js'
// Rastreamento origem → destino (payment_sources). Os writes entram na MESMA transação do
// pagamento: trilha gravada à parte pode sobreviver a um pagamento que falhou, e aí a
// tabela criada para ser a verdade vira a única fonte errada.
import {
  writesDeOrigemDestino, movimentosDoPlano, movimentosDoConsumo,
} from '../lib/payment-source-tracker.js'
// Créditos de compensação do Fabrício e a leitura do rastreamento.
import { compensacoesDisponiveis, rastreamentoOD } from '../lib/fabricio-compensation.js'

// Recalcula o pai de um payable_victor após alterar seus pagamentos.
async function recalcVictorParent(sql, payable_id) {
  const agg = await sql`SELECT COALESCE(SUM(amount),0) AS s, MAX(paid_at) AS last FROM payable_payments WHERE payable_type='victor' AND payable_id=${payable_id}`
  const s = parseFloat(agg[0].s) || 0
  const last = agg[0].last || null
  const pr = await sql`SELECT total_amount FROM payables_victor WHERE id=${payable_id}`
  const tot = parseFloat(pr[0]?.total_amount) || 0
  const st = statusFor(s, tot)
  if (last) {
    await sql`UPDATE payables_victor SET paid_amount=${s.toFixed(2)}, status=${st}, paid_at=${last} WHERE id=${payable_id}`
    return
  }
  // Zerou os pagamentos: o mês de caixa volta ao do recebimento do cliente. `consumir()`
  // o havia sobrescrito com a data da distribuição, e mantê-lo aqui esconderia o payable
  // de qualquer distribuição anterior àquela data.
  const cx = await mesDeCaixaOriginal(sql, 'victor', payable_id)
  if (cx) await sql`UPDATE payables_victor SET paid_amount=${s.toFixed(2)}, status=${st}, paid_at=NULL, payment_month=${cx.pmonth}, payment_year=${cx.pyear} WHERE id=${payable_id}`
  else await sql`UPDATE payables_victor SET paid_amount=${s.toFixed(2)}, status=${st}, paid_at=NULL WHERE id=${payable_id}`
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
  // ANTES de apagar: se esta sessão quitou obrigações fiscais (o que ?action=pagar-com-rateio
  // faz), desfazer o abatimento inteiro. O DELETE abaixo levaria as fiscal_allocations junto
  // pelo CASCADE, mas os fiscal_payments de 'abatimento' sobreviveriam e ninguém recalcularia
  // a obrigação — o DAS seguiria marcado como pago com o dinheiro de volta no saldo do Victor.
  // É o mesmo cuidado que o PATCH ?action=estornar já tomava; a edição de sessão não tomava.
  await desfazerAbatimentoFiscal(sql, ids)
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
    // Rastreamento: origem exata (cliente, competência, lucro × serviço) e destino rateado
    // entre as categorias digitadas — ver movimentosDoConsumo().
    const trilha = movimentosDoConsumo({ applied, lista, despesas })
    await sql.transaction([...writes, ...writesDeOrigemDestino(sql, {
      company_id, movimentos: trilha, when, notes_sessao: notes,
    })])
    return res.status(200).json({ mode: 'geral', applied, leftover: restante, rastreado: trilha.length })
  }

  // FLOW B — especifico
  const target = candidatos.find(rec => rec.id === Number(payable_id))
  if (!target) return res.status(404).json({ error: 'Registro alvo não encontrado ou sem saldo' })
  const targetSaldo = target._saldo

  // Cabe tudo no alvo → paga normalmente e encerra
  if (total <= targetSaldo + 0.005) {
    const { writes, applied } = consumir(sql, total, [target], when, notes)
    const trilha = movimentosDoConsumo({ applied, lista: [target], despesas })
    await sql.transaction([...writes, ...writesDeOrigemDestino(sql, {
      company_id, movimentos: trilha, when, notes_sessao: notes,
    })])
    return res.status(200).json({ mode: 'especifico', done: true, rastreado: trilha.length })
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
  // `candidatos` cobre o alvo e o pool da sobra — movimentosDoConsumo casa cada `applied`
  // com o seu record por id, então basta passar a lista inteira.
  const trilha = movimentosDoConsumo({ applied, lista: candidatos, despesas })
  await sql.transaction([...writes, ...writesDeOrigemDestino(sql, {
    company_id, movimentos: trilha, when, notes_sessao: notes,
  })])
  return res.status(200).json({ mode: 'especifico', done: true, applied, leftover, rastreado: trilha.length })
}

// Saldo em aberto de uma obrigação. Cópia deliberada da de api/fiscal-obligations.js:
// é uma linha derivada de `valorDevido`, e exportá-la de lá criaria uma dependência
// circular (fiscal-obligations já importa deste módulo o motor de distribuição).
const saldoObrigacao = (o) => Math.max(r2(valorDevido(o) - (parseFloat(o.paid_amount) || 0)), 0)

// POST ?action=pagar-com-rateio — pagamento roteado pelo rateio da apuração.
//
// Diferença para o ?action=pagar-distribuido, que continua existindo: lá as categorias
// viram um pool único consumido do mês mais antigo ao mais novo, e nada liga o INSS do
// Pharmalog ao payable do Pharmalog. Aqui cada categoria é consumida PRIMEIRO dos
// payables que `fiscal_allocations` aponta como donos daquele imposto (ancorados pela NF,
// não pelo mês — ver lib/victor-rateio.js), e o que sobrar cai no Pharmalog e depois nos
// demais.
//
// Grava exatamente os TRÊS registros do ?action=distribuir — payable_payments,
// fiscal_allocations (basis='consumo_payable') e fiscal_payments (method='abatimento') —
// de propósito: é essa tripla que lib/fiscal-unlink.js e o "Estornar abatimento" da tela
// /fiscal sabem desfazer. Uma tabela nova para o mesmo elo deixaria o estorno cego.
//
// Prévia por padrão, como o ?action=recalcular: só grava com `aplicar: true`.
async function pagarComRateio(sql, req, res) {
  const {
    company_id, competencia_mes, competencia_ano,
    pagamentos = [], data_pagamento, paid_at, aplicar = false,
  } = req.body || {}

  if (!company_id || !competencia_mes || !competencia_ano) {
    return res.status(400).json({ error: 'company_id, competencia_mes e competencia_ano são obrigatórios' })
  }
  const mes = Number(competencia_mes)
  const ano = Number(competencia_ano)
  const when = String(data_pagamento || paid_at || new Date().toISOString().slice(0, 10)).slice(0, 10)

  // Normaliza as categorias recebidas. Categoria desconhecida é erro, não silêncio: um
  // typo viraria um pagamento sem rateio e sem quitação, indistinguível de "não tem rateio".
  const itens = []
  const despesas = {}
  for (const pg of (Array.isArray(pagamentos) ? pagamentos : [])) {
    const categoria = String(pg?.categoria || '').trim()
    if (!(categoria in CATEGORIA_KIND)) {
      return res.status(400).json({ error: `Categoria inválida: "${categoria}". Use uma de: ${Object.keys(CATEGORIA_KIND).join(', ')}` })
    }
    const valor = r2(parseFloat(pg?.valor) || 0)
    if (valor <= 0) continue
    // `client_id` opcional: o breakdown por cliente manda "o INSS do Pharmalog", o modal
    // "Receber" manda só "INSS" e deixa o rateio escolher. Ver planejarCategoria().
    const client_id = pg?.client_id == null || pg.client_id === '' ? null : Number(pg.client_id)
    if (client_id !== null && !Number.isFinite(client_id)) {
      return res.status(400).json({ error: `client_id inválido em "${categoria}"` })
    }
    // Serviço e lucro são o saldo do próprio payable: sem alvo não há o que pagar, só a
    // cascata genérica — que é justamente o que o breakdown por cliente veio substituir.
    if (client_id === null && (categoria === 'servico' || categoria === 'lucro')) {
      return res.status(400).json({ error: `A categoria "${categoria}" exige client_id` })
    }
    // `invoice_ids`: as notas do card que originou o valor. Prende o consumo ao mesmo
    // recorte que a tela exibiu — ver planejarCategoria().
    const invoice_ids = Array.isArray(pg?.invoice_ids)
      ? pg.invoice_ids.map(Number).filter(Number.isFinite)
      : null
    itens.push({ categoria, kind: CATEGORIA_KIND[categoria], valor, client_id, invoice_ids })
    despesas[categoria] = r2((despesas[categoria] || 0) + valor)
  }
  if (!itens.length) return res.status(400).json({ error: 'Informe ao menos uma categoria com valor maior que zero' })
  const total = r2(itens.reduce((s, i) => s + i.valor, 0))

  // Teto de caixa: o MAIOR entre o mês do pagamento e a competência pedida — mesma regra
  // do pagarDistribuido. Nunca se consome caixa que ainda não entrou, e a competência
  // entra no máximo porque o rateio de um mês pode apontar para payables cujo caixa é
  // posterior à data digitada.
  const [payY, payM] = when.split('-').map(Number)
  const curKey = Math.max(payM ? payY * 100 + payM : 0, ano * 100 + mes)

  // ⚠️ QUANDO OS ITENS TRAZEM NOTAS, ELAS MANDAM — não a competência recebida.
  //
  // `competencia_mes/ano` vem do FILTRO da tela, e ele quase nunca é a competência da
  // apuração: as NFs de janeiro são emitidas em fevereiro, e o rateio delas mora em 02.
  // Com o filtro em janeiro, a busca por competência voltava vazia — o pagamento não
  // achava fatia, descia para o fallback e debitava o SERVIÇO. É a mesma âncora que abre
  // lib/victor-rateio.js: a NOTA, não o mês.
  //
  // Sem `invoice_ids` (o modal "Receber" não os manda) vale a competência, como antes.
  const notasPedidas = [...new Set(itens.flatMap((i) => i.invoice_ids || []))]
  const [candidatos, rateios] = await Promise.all([
    candidatosDisponiveis(sql, company_id, curKey),
    notasPedidas.length
      ? buscarRateiosPorNotas(sql, company_id, notasPedidas)
      : buscarRateios(sql, company_id, mes, ano),
  ])

  // As obrigações saem dos rateios encontrados — a guia a quitar é a que a alocação
  // aponta, não a que o mês do filtro sugere. Cair na competência só quando não há rateio
  // nenhum preserva o aviso `sem_obrigacao` para o mês realmente não apurado.
  const obIds = [...new Set(rateios.map((r) => Number(r.obligation_id)).filter(Boolean))]
  const obrigacoes = obIds.length
    ? await sql`SELECT * FROM fiscal_obligations WHERE company_id = ${company_id} AND id = ANY(${obIds})`
    : await sql`SELECT * FROM fiscal_obligations WHERE company_id = ${company_id} AND month = ${mes} AND year = ${ano}`
  const obPorKind = new Map(obrigacoes.map((o) => [o.kind, o]))

  const plano = planejar({ pagamentos: itens, rateios, candidatos })

  // ── COMPETÊNCIA DAS LINHAS DE RATEIO ───────────────────────────────────────────────
  //
  // A alocação `sem_debito` aponta para a NOTA, e o payable dela pode não estar entre os
  // candidatos — basta estar QUITADO (é o caso normal: paga-se o imposto depois de receber
  // o serviço) ou com o recebível pendente. `planejarCategoria` tira `month`/`year` do
  // payable disponível, então nesses casos vinham nulos.
  //
  // ⚠️ Isso derrubava o pagamento inteiro com 500: `payment_sources.month/year` são NOT
  // NULL, o INSERT violava a constraint e a transação inteira ia junto — a guia não era
  // quitada e o usuário via só "erro interno". Caso real: pagar os R$ 139,11 de Honorários
  // do Pharmalog com o payable #28 já quitado.
  //
  // A competência sai do payable da nota (qualquer status) e, se a nota ainda não gerou
  // payable, da própria fatura. O último recurso é a competência pedida — nunca nulo.
  const semComp = plano.alocacoes.filter((a) => a.month == null || a.year == null)
  if (semComp.length) {
    const invIds = [...new Set(semComp.map((a) => Number(a.invoice_id)).filter(Boolean))]
    const ctx = invIds.length
      ? await sql`
          SELECT i.id AS invoice_id, i.month AS inv_month, i.year AS inv_year,
                 pv.id AS payable_id, pv.month AS pv_month, pv.year AS pv_year
          FROM invoices i
          LEFT JOIN payables_victor pv ON pv.invoice_id = i.id
          WHERE i.id = ANY(${invIds})`
      : []
    const porInv = new Map(ctx.map((c) => [Number(c.invoice_id), c]))
    for (const a of semComp) {
      const c = porInv.get(Number(a.invoice_id))
      a.month = c?.pv_month ?? c?.inv_month ?? mes
      a.year = c?.pv_year ?? c?.inv_year ?? ano
      // O payable serve só para a resposta: a linha não o debita (`sem_debito`).
      if (a.payable_id == null && c?.payable_id != null) a.payable_id = c.payable_id
    }
  }

  // Nomes dos clientes para a resposta (candidatosDisponiveis traz só payables_victor.*).
  const clientIds = [...new Set(plano.alocacoes.map((a) => a.client_id).filter(Boolean))]
  const nomes = new Map()
  if (clientIds.length) {
    for (const c of await sql`SELECT id, name FROM clients WHERE id = ANY(${clientIds})`) nomes.set(Number(c.id), c.name)
  }

  // Três situações que a tela precisa distinguir e que antes se pareciam:
  const faltando = plano.por_categoria.filter((c) => c.restante > LIMIAR_FIM)
    .map((c) => ({ categoria: c.categoria, valor: c.valor, restante: c.restante, client_id: c.client_id }))
  // Categoria fiscal cuja obrigação não existe no mês: competência não apurada. Não é
  // erro — o pagamento vira fallback puro —, mas sem avisar parece que o rateio falhou.
  const sem_obrigacao = [...new Set(itens.filter((i) => i.kind && !obPorKind.has(i.kind)).map((i) => i.categoria))]
  // Obrigação já quitada: pagar de novo debitaria o payable e superquitaria a guia.
  // Deduplicado por kind: no breakdown por cliente a mesma guia chega em várias entradas
  // (uma por cliente), e repetir o aviso uma vez por linha só empilharia texto.
  const ja_quitadas = [...new Map(
    itens
      .filter((i) => i.kind && obPorKind.has(i.kind) && saldoObrigacao(obPorKind.get(i.kind)) <= LIMIAR_FIM)
      .map((i) => [i.kind, { categoria: i.categoria, kind: i.kind, obligation_id: obPorKind.get(i.kind).id }]),
  ).values()]

  const quitacoes = quitacoesPorObrigacao(plano.por_categoria, obPorKind, saldoObrigacao)

  const alocacoesOut = plano.alocacoes.map((a) => ({
    ordem: a.ordem,
    categoria: a.categoria,
    tipo: a.tipo,
    cliente_id: a.client_id,
    cliente_nome: nomes.get(Number(a.client_id)) || null,
    valor: a.valor,
    competencia: { mes: a.month, ano: a.year },
    payable_id: a.payable_id,
    invoice_id: a.invoice_id,
    de_lucro: a.de_lucro,
    de_servico: a.de_servico,
    fonte: a.tipo === 'rateio'
      ? `fiscal_allocations.id:${a.alocacao_id}`
      : `payables_victor.id:${a.payable_id}`,
  }))

  const resumo = {
    total,
    consumido: r2(plano.alocacoes.reduce((s, a) => s + a.valor, 0)),
    nao_coberto: r2(faltando.reduce((s, f) => s + f.restante, 0)),
    por_categoria: plano.por_categoria.map((c) => ({
      categoria: c.categoria, kind: c.kind, valor: c.valor, restante: c.restante,
      client_id: c.client_id,
      cliente_nome: c.client_id == null ? null : nomes.get(Number(c.client_id)) || null,
      de_rateio: r2(c.alocacoes.filter((a) => a.tipo === 'rateio').reduce((s, a) => s + a.valor, 0)),
      de_fallback: r2(c.alocacoes.filter((a) => a.tipo !== 'rateio').reduce((s, a) => s + a.valor, 0)),
      rateios_sem_saldo: c.rateios_sem_saldo,
    })),
    quitacoes,
    sem_obrigacao,
    ja_quitadas,
    competencia: { mes, ano },
    paid_at: when,
  }

  // ── PRÉVIA ────────────────────────────────────────────────────────────────────────
  if (aplicar !== true) {
    return res.status(200).json({ preview: true, alocacoes: alocacoesOut, resumo })
  }

  // ── APLICAR ───────────────────────────────────────────────────────────────────────
  // Recusas só valem na gravação: na prévia o problema é mostrado, não bloqueado.
  if (ja_quitadas.length) {
    return res.status(422).json({
      error: `Já quitado nesta competência: ${ja_quitadas.map((q) => q.categoria).join(', ')}. Estorne o abatimento em /fiscal antes de pagar de novo.`,
      alocacoes: alocacoesOut, resumo,
    })
  }
  if (faltando.length) {
    const f = faltando[0]
    // Com alvo, o motivo é outro: não é que falte saldo no geral, é que falta NAQUELE
    // cliente — e o valor não escorre para outro justamente porque o usuário o escolheu.
    const ondeF = f.client_id == null
      ? 'os lançamentos disponíveis não cobrem o valor'
      : `${nomes.get(Number(f.client_id)) || `cliente ${f.client_id}`} não tem esse saldo disponível`
    return res.status(422).json({
      error: `Faltam ${f.restante.toFixed(2)} para ${f.categoria}: ${ondeF}. Ajuste o valor ou a data do pagamento.`,
      alocacoes: alocacoesOut, resumo,
    })
  }
  // Sem alocação E sem quitação não há o que gravar. Com quitação e sem alocação há: é o
  // caso normal do pagamento de imposto — a fatia rateada quita a guia sem debitar
  // lançamento nenhum (o excedente do tributo já foi absorvido na redistribuição), e
  // recusar aqui inviabilizaria justamente esse caminho.
  if (!plano.alocacoes.length && !quitacoes.length) {
    return res.status(422).json({
      error: `Nenhum lançamento disponível para consumir em ${String(mes).padStart(2, '0')}/${ano}. Só entram os que já foram recebidos do cliente e cujo mês de caixa não é posterior à data do pagamento.`,
      resumo,
    })
  }

  // Uma string de notes para a sessão inteira (não uma por categoria): é o par
  // (paid_at, notes) que identifica a sessão para a edição e o estorno, e é o formato que
  // parseNotesToReceiveCats() lê na tela. A quebra por categoria vive nas alocações.
  // ⚠️ Só as categorias que REALMENTE consumiram saldo entram no notes.
  //
  // A string é lida de volta por parseNotesToReceiveCats() (Financial.jsx) como "o que este
  // pagamento tirou do lançamento". Sob a Opção 1, uma sessão de "Lucros 8.900 + DAS 586,50"
  // debita 8.900 e paga a guia com caixa — gravar o DAS aqui faria a tela afirmar que o
  // lançamento cobriu 9.486,50, e reeditar a sessão tentaria devolver um dinheiro que nunca
  // saiu dele.
  const despesasConsumo = {}
  for (const c of plano.por_categoria) {
    if (c.sem_consumo) continue
    despesasConsumo[c.categoria] = r2((despesasConsumo[c.categoria] || 0) + c.valor)
  }
  const notes = montarNotes(despesasConsumo)
  const porPayable = agruparPorPayable(plano.alocacoes)
  const porId = new Map(candidatos.map((c) => [c.id, c]))

  const writes = []
  for (const p of porPayable) {
    const rec = porId.get(p.payable_id)
    const totalRec = r2(parseFloat(rec.total_amount) || 0)
    const newPaid = r2((parseFloat(rec.paid_amount) || 0) + p.valor)
    writes.push(sql`
      INSERT INTO payable_payments (payable_type, payable_id, amount, paid_at, notes, payment_month, payment_year)
      VALUES ('victor', ${p.payable_id}, ${p.valor}, ${when}, ${notes}, ${payM || null}, ${payY || null})`)
    writes.push(sql`
      UPDATE payables_victor SET paid_amount = ${newPaid}, status = ${statusFor(newPaid, totalRec)},
        paid_at = ${when}, payment_month = ${payM || null}, payment_year = ${payY || null}
      WHERE id = ${p.payable_id}`)
  }

  // O elo obrigação ↔ payable ↔ pagamento. `payable_payment_id` sai de um SELECT porque
  // o driver do Neon não devolve RETURNING de dentro de uma transação em lote — o INSERT
  // do pagamento está antes nesta mesma lista, então já é visível.
  //
  // `ORDER BY pp.id DESC LIMIT 1` é a diferença para o ?action=distribuir, que faz o
  // mesmo SELECT sem limite: se o payable já tivesse um pagamento com o MESMO
  // (paid_at, notes) de uma sessão anterior, aquele INSERT ... SELECT casaria duas linhas
  // e gravaria a alocação em dobro. Com o LIMIT, a linha mais nova é sempre a nossa.
  //
  // Fallback também gera alocação: o dinheiro saiu de um cliente que a apuração não
  // vinculou a esta despesa, mas a obrigação quitada é a mesma — sem a linha, o estorno
  // não teria como devolver esse pedaço.
  const ligacoes = []
  for (const a of plano.alocacoes) {
    // `sem_debito`: a fatia do rateio foi paga sem tirar dinheiro do payable, então não há
    // `payable_payments` a que amarrar a alocação — o SELECT abaixo não casaria nada e o
    // INSERT gravaria zero linhas de qualquer forma. Sair aqui deixa isso explícito.
    if (a.sem_debito) continue
    const ob = a.kind ? obPorKind.get(a.kind) : null
    if (!ob) continue  // 'demais'/'lucros' não são obrigação: viram só payable_payments
    ligacoes.push(sql`
      INSERT INTO fiscal_allocations
        (obligation_id, client_id, invoice_id, payable_victor_id, payable_payment_id,
         amount, from_service, from_profit, basis)
      SELECT ${ob.id}, ${a.client_id}, ${a.invoice_id || null}, ${a.payable_id}, pp.id,
             ${a.valor}, ${a.de_servico}, ${a.de_lucro}, 'consumo_payable'
      FROM payable_payments pp
      WHERE pp.payable_type = 'victor' AND pp.payable_id = ${a.payable_id}
        AND pp.paid_at = ${when} AND pp.notes = ${notes}
      ORDER BY pp.id DESC LIMIT 1`)
  }

  // `method` distingue os dois mundos, e não é cosmético: lib/fiscal-unlink.js desfaz os
  // pagamentos de 'abatimento' quando o payable que os originou é estornado. Um pagamento
  // 'direto' não nasceu de payable nenhum (Opção 1), então tem de sobreviver a esse estorno
  // — quem o desfaz é o DELETE de /api/fiscal-payments, na tela /fiscal.
  const quitacoesSql = quitacoes.map((q) => sql`
    INSERT INTO fiscal_payments (obligation_id, amount, paid_at, method, notes)
    VALUES (${q.obligation_id}, ${q.valor}, ${when},
            ${q.sem_consumo ? 'direto' : 'abatimento'},
            ${q.sem_consumo
              ? 'Guia paga pela aba Pagar Victor (caixa próprio — não abate o saldo do Victor)'
              : 'Pago com rateio por cliente (aba Pagar Victor)'})`)

  // Rastreamento origem → destino. Aqui NADA é estimado: o plano já sabe o cliente, a
  // competência, a categoria e a quebra lucro/serviço de cada alocação.
  //
  // ⚠️ Categoria de imposto GERA movimento desde a cascata de 2026-08-15 — as linhas
  // `sem_debito`, com a linha de saldo consumida como origem (`escritorio`/`das`/`inss`) e
  // `payment_id` NULL, porque não houve `payable_payments` a que amarrá-las. Só o
  // transbordo sobre o rateio aparece como `profit`/`service`.
  const trilha = movimentosDoPlano(plano)
  const trilhaSql = writesDeOrigemDestino(sql, {
    company_id, movimentos: trilha, when, notes_sessao: notes,
  })

  await sql.transaction([...writes, ...ligacoes, ...quitacoesSql, ...trilhaSql])
  // Fora da transação: recalcularObrigacao re-soma fiscal_payments, que só existe depois
  // do commit. Nunca `paid_amount + valor` — a soma real corrige divergências em vez de
  // acumulá-las.
  for (const q of quitacoes) await recalcularObrigacao(sql, q.obligation_id)

  return res.status(200).json({
    status: 'sucesso',
    alocacoes: alocacoesOut,
    resumo,
    payables_afetados: porPayable,
    notes,
    rastreado: trilha.length,
  })
}

// POST ?action=pagar-compensacao — realiza um crédito de compensação do Fabrício.
//
// O crédito nasce em `payment_sources` com `payment_id NULL` quando um lançamento do
// Fabrício é marcado como compensação (ver lib/fabricio-compensation.js). "Pagar" aqui
// significa USÁ-LO: o valor quita um lançamento que a empresa deve ao Victor, sem sair
// caixa novo — que é exatamente o que a compensação é (o Fabrício deixou de receber, então
// esse dinheiro fica na empresa e vai para o Victor).
//
// ── POR QUE NÃO É O QUE A ESPECIFICAÇÃO DESCREVIA ─────────────────────────────────────
//
// O passo 4 do PROMPT 4 propunha `INSERT INTO payable_payments (…, category, amount_paid)
// VALUES ('victor', NULL, …)`. Três coisas impedem:
//   • não existem as colunas `category` nem `amount_paid` — são `amount` e `notes`;
//   • `payable_id` é NOT NULL, então não há pagamento "solto";
//   • um pagamento sem payable não teria pai para recalcular, e sumiria de todas as telas,
//     que leem por `payable_id`.
//
// Ligar o crédito a um payable REAL resolve as três de uma vez e ainda dá sentido ao
// `payment_id`: o crédito sai de "disponível" no instante em que vira pagamento, sem
// coluna de estado nova.
//
// ⚠️ O alvo é do MESMO CLIENTE da origem. A compensação do Pharmalog quita o Pharmalog:
// usar o crédito de um cliente para quitar outro desfaria a única coisa que esta tabela
// existe para responder — de onde veio o dinheiro.
async function pagarCompensacao(sql, req, res) {
  const { compensation_id, company_id, payable_id = null, paid_at = null } = req.body || {}
  if (!compensation_id || !company_id) {
    return res.status(400).json({ error: 'compensation_id e company_id são obrigatórios' })
  }

  const cred = (await sql`
    SELECT ps.*, c.name AS client_name FROM payment_sources ps
    LEFT JOIN clients c ON c.id = ps.client_id
    WHERE ps.id = ${compensation_id} AND ps.company_id = ${company_id}
      AND ps.source_type = 'compensation_fabricio' AND ps.payment_id IS NULL
    LIMIT 1`)[0]
  if (!cred) {
    return res.status(404).json({ error: 'Crédito de compensação não encontrado, ou já foi usado.' })
  }

  const valor = r2(cred.amount)
  const when = String(paid_at || new Date().toISOString().slice(0, 10)).slice(0, 10)
  const [payY, payM] = when.split('-').map(Number)
  const curKey = Math.max(payM ? payY * 100 + payM : 0, cred.year * 100 + cred.month)

  // Mesmas regras de sempre: só payable cujo recebível já foi pago e cujo caixa não é
  // futuro. Restringido ao cliente da origem.
  const todos = await candidatosDisponiveis(sql, company_id, curKey)
  const doCliente = ordenar(todos.filter((c) => Number(c.client_id) === Number(cred.client_id)))
  const alvo = payable_id
    ? doCliente.find((c) => c.id === Number(payable_id))
    : doCliente[0]

  if (!alvo) {
    return res.status(422).json({
      error: `${cred.client_name || 'O cliente'} não tem lançamento em aberto para receber esta compensação. O crédito continua disponível.`,
      credito: valor,
    })
  }
  // Consumo parcial deixaria metade do crédito usado e metade não, e a linha de
  // payment_sources é uma só — não há onde registrar a sobra sem quebrá-la em duas.
  if (valor > alvo._saldo + 0.005) {
    return res.status(422).json({
      error: `O crédito (${valor.toFixed(2)}) é maior que o saldo do lançamento escolhido (${alvo._saldo.toFixed(2)}). Escolha outro lançamento ou registre a diferença como pagamento normal.`,
      credito: valor, saldo_alvo: alvo._saldo, payable_id: alvo.id,
    })
  }

  // `payment_sources.notes` já vem no formato "Compensação Fabrício: <origem>" — prefixar
  // de novo produzia "Compensação Fabrício: Compensação Fabrício: Pharmalog…" no extrato.
  const notes = cred.notes?.startsWith('Compensação Fabrício')
    ? cred.notes
    : `Compensação Fabrício: ${cred.notes || `${cred.client_name} ${cred.month}/${cred.year}`}`
  const { writes, applied } = consumir(sql, valor, [alvo], when, notes)
  if (!writes.length) {
    return res.status(422).json({ error: 'Nada a consumir no lançamento escolhido.' })
  }

  // O `payment_id` do pagamento recém-inserido, pelo mesmo caminho de
  // fiscal_allocations e do tracker: o driver do Neon não devolve RETURNING dentro de
  // transação em lote. `ORDER BY id DESC LIMIT 1` garante a linha nova.
  writes.push(sql`
    UPDATE payment_sources SET payment_id = (
      SELECT pp.id FROM payable_payments pp
      WHERE pp.payable_type = 'victor' AND pp.payable_id = ${alvo.id}
        AND pp.paid_at = ${when} AND pp.notes = ${notes}
      ORDER BY pp.id DESC LIMIT 1
    ), updated_at = NOW()
    WHERE id = ${compensation_id}`)

  await sql.transaction(writes)
  return res.status(200).json({
    status: 'sucesso',
    compensation_id: Number(compensation_id),
    amount: valor,
    aplicado_em: applied[0],
    notes,
  })
}

// POST ?action=calcular-distribuicao — a tabela tabulada da aba Pagar Victor.
//
// Recebe os totais digitados e devolve, por cliente e por categoria, BRUTO / % / LÍQUIDO.
// NÃO GRAVA NADA e não tem `aplicar`: a absorção é exibição, como pedido. O pagamento
// continua sendo o ?action=pagar-com-rateio, cuja semântica de abatimento é diferente —
// ver a advertência 1 no topo de lib/victor-tabulado.js antes de ligar os dois.
//
// Exposto também como POST /api/payable-payments?action=calculate-distribution, que é o
// caminho da especificação; o handler é este, para não haver dois motores.
export async function calcularDistribuicao(sql, req, res) {
  const b = req.body || {}
  const company_id = b.company_id
  if (!company_id) return res.status(400).json({ error: 'company_id é obrigatório' })

  // `month` aceita "2026-01" (formato da spec) ou o par month/year numérico que o resto
  // da tela usa. Um só campo com dois formatos evita o frontend ter de converter e
  // errar a virada de ano.
  let mes = b.month
  let ano = b.year
  if (typeof mes === 'string' && mes.includes('-')) {
    const [y, m] = mes.split('-').map(Number)
    ano = y; mes = m
  }
  mes = mes == null || mes === '' ? null : Number(mes)
  ano = ano == null || ano === '' ? null : Number(ano)
  if (!ano || !Number.isFinite(ano)) return res.status(400).json({ error: 'Informe o ano (ou month no formato "AAAA-MM")' })
  if (mes != null && (!Number.isFinite(mes) || mes < 1 || mes > 12)) {
    return res.status(400).json({ error: `Mês inválido: ${b.month}` })
  }

  // Categoria desconhecida é erro, não silêncio: um typo viraria um valor digitado que
  // some da distribuição sem aviso, e o total da tabela não fecharia com o que foi pedido.
  const pagamentos = {}
  for (const [k, v] of Object.entries(b.payments || b.pagamentos || {})) {
    if (!CATEGORIAS_ENTRADA.includes(k)) {
      return res.status(400).json({ error: `Categoria inválida: "${k}". Use uma de: ${CATEGORIAS_ENTRADA.join(', ')}` })
    }
    pagamentos[k] = parseFloat(v) || 0
  }

  // MESMO recorte do GET da aba — ver lib/victor-recorte.js. Se a tabela montasse a
  // própria query, um filtro divergindo bastaria para ela somar clientes que os cards
  // não mostram.
  const { breakdown } = await carregarRecorte(sql, {
    company_id, year: ano, month: mes, mode: b.mode || 'competencia', comBreakdown: true,
  })

  const tabulado = montarTabulado({ breakdown, pagamentos })
  return res.status(200).json({
    success: true,
    competencia: { mes, ano },
    ...tabulado,
  })
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  const sql = neon(process.env.DATABASE_URL)
  if (req.method === 'GET') {
    // Créditos de compensação do Fabrício ainda não usados (`payment_id IS NULL`) e o
    // rastreamento origem → destino do recorte. Duas leituras da MESMA tabela: a primeira
    // é o subconjunto com ação pendente, a segunda é tudo.
    if (req.query.action === 'compensacoes' || req.query.action === 'rastreamento') {
      const { company_id, month, year } = req.query
      if (!company_id) return res.status(400).json({ error: 'company_id é obrigatório' })
      const filtro = {
        month: month === undefined || month === '' ? null : Number(month),
        year: year === undefined || year === '' ? null : Number(year),
      }
      const data = req.query.action === 'compensacoes'
        ? await compensacoesDisponiveis(sql, Number(company_id), filtro)
        : await rastreamentoOD(sql, Number(company_id), filtro)
      return res.status(200).json({ data })
    }
    // O que foi PAGO num mês/ano de caixa — as duas naturezas, com o que precisa para
    // estornar. Alimenta o bloco "Valores pagos" da barra de rateio.
    //
    // ⚠️ SÓ GUIAS FISCAIS (decisão do Victor, 2026-08-16). Pró-labore e Lucros saíram —
    // eles são `payable_payments` (saldo do Victor consumido), não quitação de obrigação, e
    // continuam com estorno na seção "Lançamentos com pagamento" e no card do modal.
    //
    // ⚠️ `honorarios` ENTRA no filtro, e isso não é detalhe: a especificação pedia
    // `kind IN ('escritorio','das','inss')` — literalmente —, e o "Escritório" da tela é o
    // kind `honorarios` (os R$ 150 da contabilidade, o único rateado). Conferido no banco:
    // o filtro literal devolve ZERO pagamentos; com honorarios, devolve o único que existe.
    // O kind `escritorio` fica junto por ser o legado da migração de victor_reserves.
    //
    // `fiscal_payments` não tem `company_id`, `kind` nem `payment_date`: os dois primeiros
    // vêm da obrigação pelo JOIN, e a data é `paid_at`.
    //
    // O filtro é a data do PAGAMENTO, não a competência — é o mês que o usuário digitou na
    // barra, e o que ele quer ver é "o que paguei neste mês".
    if (req.query.action === 'pagos-do-mes') {
      const { company_id, month, year } = req.query
      if (!company_id || !month || !year) {
        return res.status(400).json({ error: 'company_id, month e year são obrigatórios' })
      }
      const m = Number(month)
      const y = Number(year)
      // Competência em foco na aba (opcional). Ver a explicação das DUAS datas abaixo.
      const cm = req.query.competencia_mes ? Number(req.query.competencia_mes) : null
      const cy = req.query.competencia_ano ? Number(req.query.competencia_ano) : null
      // Escritório na tela = kind `honorarios`; `escritorio` é o legado sem rateio.
      const KINDS_FISCAIS = ['honorarios', 'escritorio', 'das', 'inss']

      // ⚠️ DUAS DATAS, e confundi-las esvaziava a lista.
      //
      //   paid_at              quando o dinheiro saiu     (15/08/2026)
      //   o.month/o.year       de que mês é a guia        (competência 02/2026)
      //
      // Um pagamento de agosto quita uma guia de fevereiro — é o normal, não a exceção.
      // Filtrando só por `paid_at`, quem procurava "as guias de fevereiro" via a seção
      // vazia com o pagamento existindo. Agora entra o que foi PAGO no mês da data OU o que
      // pertence à COMPETÊNCIA em foco, sem duplicar; cada linha diz as duas datas.
      const guias = await sql`
        SELECT fp.id, fp.amount, fp.paid_at, fp.method, fp.notes,
               o.id AS obligation_id, o.kind, o.month AS competencia_mes, o.year AS competencia_ano
        FROM fiscal_payments fp
        JOIN fiscal_obligations o ON o.id = fp.obligation_id
        WHERE o.company_id = ${company_id}
          AND o.kind = ANY(${KINDS_FISCAIS})
          AND (
            (EXTRACT(MONTH FROM fp.paid_at) = ${m} AND EXTRACT(YEAR FROM fp.paid_at) = ${y})
            OR (${cm}::int IS NOT NULL AND o.month = ${cm}::int AND o.year = ${cy}::int)
          )
        ORDER BY fp.id`

      // ⚠️ TODAS as outras guias pagas da empresa, fora do recorte.
      //
      // Sem isto a seção sumia em silêncio numa combinação banal: com o filtro da aba em
      // "todos os meses", `refMonth` vira o MÊS ATUAL, então "data 15/02 + filtro todos"
      // procurava (pago em fevereiro) OU (competência agosto) — e devolvia zero com o
      // pagamento existindo. A tela precisa poder dizer "não é aqui, é ali", em vez de
      // não mostrar nada.
      const outras = await sql`
        SELECT fp.id, fp.amount, fp.paid_at, fp.method,
               o.kind, o.month AS competencia_mes, o.year AS competencia_ano
        FROM fiscal_payments fp
        JOIN fiscal_obligations o ON o.id = fp.obligation_id
        WHERE o.company_id = ${company_id}
          AND o.kind = ANY(${KINDS_FISCAIS})
          AND NOT (
            (EXTRACT(MONTH FROM fp.paid_at) = ${m} AND EXTRACT(YEAR FROM fp.paid_at) = ${y})
            OR (${cm}::int IS NOT NULL AND o.month = ${cm}::int AND o.year = ${cy}::int)
          )
        ORDER BY fp.paid_at DESC, fp.id DESC
        LIMIT 20`

      // `lancamentos` continua na resposta, sempre vazio, para não quebrar quem já lê o
      // formato. O estorno deles vive na seção "Lançamentos com pagamento".
      return res.status(200).json({ mes: m, ano: y, guias, outras, lancamentos: [] })
    }
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
    // Linhas + breakdown saem de lib/victor-recorte.js — o MESMO recorte que o
    // ?action=calcular-distribuicao lê para montar a tabela tabulada. Duas queries
    // paralelas para a mesma aba bastaria uma divergir de mês para a tabela somar
    // clientes que os cards não mostram, e a diferença apareceria como erro de rateio.
    const { rows, breakdown, anos, caixa } = await carregarRecorte(sql, {
      company_id, year, month, status, mode,
      comBreakdown: req.query.breakdown === 'true',
      momento: req.query.momento,
    })

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
    return res.status(200).json({ data: rows, breakdown })
  }
  if (req.method === 'POST') {
    if (req.query.action === 'pagar-distribuido') return pagarDistribuido(sql, req, res)
    if (req.query.action === 'pagar-com-rateio') return pagarComRateio(sql, req, res)
    if (req.query.action === 'calcular-distribuicao') return calcularDistribuicao(sql, req, res)
    if (req.query.action === 'pagar-compensacao') return pagarCompensacao(sql, req, res)
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
      // O mês de caixa também é estornado: sem isto o registro volta a `pendente` mas
      // continua datado no mês em que a distribuição o consumiu, e some das listas.
      const cx = await mesDeCaixaOriginal(sql, 'victor', id)
      const result = await sql`
        UPDATE payables_victor SET
          status = 'pendente', paid_amount = 0, paid_at = NULL,
          payment_month = COALESCE(${cx?.pmonth ?? null}, payment_month),
          payment_year  = COALESCE(${cx?.pyear ?? null}, payment_year),
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
