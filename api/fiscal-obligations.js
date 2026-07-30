import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import {
  calcularImpostos, parametrosFiscais, proLaboreDoMes,
  faixaFor, tabelaDoAnexo, FATOR_R_MIN, INSS_RATE, INSS_TETO,
} from '../lib/taxCalc.js'
import { valorDevido, recalcularObrigacao } from '../lib/fiscal-status.js'
import { sincronizarLinhasFiscais } from '../lib/fiscal-lines.js'
import { ordenar, consumir, candidatosDisponiveis, montarNotes } from '../lib/victor-distribution.js'
import { recalcularInvoice, consolidar } from '../lib/fiscal-redistribution.js'

// Data de hoje em ISO. Isolado para o fuso: new Date() no servidor da Vercel é UTC.
const todayISO = () => new Date().toISOString().slice(0, 10)

// APURAÇÃO FISCAL — DAS / INSS / Honorários.
//
// Previsão de caixa, NÃO contabilidade formal (mesma ressalva de lib/taxCalc.js).
// Separa três coisas que antes viviam coladas numa string em payable_payments.notes:
//   fiscal_obligations  → o que a empresa deve no mês (previsto × apurado × pago)
//   fiscal_allocations  → quanto disso cabe a cada cliente
//   fiscal_payments     → quando a guia foi efetivamente quitada (outro endpoint)
//
// POST  ?action=apurar                 { company_id, month, year }  → calcula e grava (idempotente)
// PATCH ?action=lancar-guia            { obligation_id, amount_actual, due_date, doc_number }
// PATCH ?action=corrigir-escritorio    { obligation_id, imposto_real }  → guia + re-rateio + prévia
// POST  ?action=recalcular             { company_id, month, year, aplicar }  → redistribuição
// POST  ?action=distribuir             { company_id, month, year }  → abate dos payables do Victor
// POST  ?action=estornar-distribuicao  { company_id, month, year }  → desfaz o abatimento
// GET   ?company_id&month&year                                      → lê o que já foi apurado
//       com `calculo`: a memória de cálculo do mês (faturamento → RBT12 → Fator R →
//       anexo → DAS/INSS/escritório), pelo mesmo caminho do ?action=apurar

const round2 = (v) => Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100
// numeric do Postgres chega como string no driver — sem isso, `a + b` concatena.
const num = (v) => parseFloat(v) || 0

// Saldo em aberto de uma obrigação: o devido menos o que já foi quitado.
// É o que pode ser distribuído; o valor cheio já embute pagamentos anteriores.
const saldoObrigacao = (o) => Math.max(round2(valorDevido(o) - num(o.paid_amount)), 0)

// Os parâmetros da apuração (percentual, piso, honorários) e a fórmula do pró-labore
// vêm de lib/taxCalc.js — `parametrosFiscais` e `proLaboreDoMes`. Ficam lá porque a
// previsão da tela e o Billing.jsx usam exatamente as mesmas, e antes cada um tinha
// a sua cópia divergindo em silêncio.
const KINDS = ['das', 'inss', 'honorarios']

// Competência da NF = mês de EMISSÃO, resolvida no SQL (ver `comp_year`/`comp_month`
// na consulta). Faturas antigas sem `emission_date` caem no par (year, month) da própria
// fatura — filtrar por `emission_date IS NOT NULL` as faria sumir da apuração,
// subestimando o faturamento e, com ele, o DAS.
// Derivar isso em JS não funciona: o driver devolve `date` como objeto Date, e
// `String(date)` não é ISO — o parse caía no fallback e jogava NF de julho em junho.
const chaveCompetencia = (inv) => ({ y: Number(inv.comp_year), m: Number(inv.comp_month) })

// Fatura tributável = a que gera nota. `require_nf = false` é o contrato de cliente que
// não pede NF (Minas): fatura, recebe e paga normalmente, mas não existe para o fisco.
// Só `false` exclui — coluna nula (fatura anterior à migração) continua tributável.
const temNf = (inv) => inv.require_nf !== false


// Janela de 12 meses terminando no mês apurado (inclusive).
function janela12(month, year) {
  const fim = year * 12 + (month - 1)
  return { inicio: fim - 11, fim }
}
const chaveOrdinal = ({ y, m }) => y * 12 + (m - 1)

// RBT12 + folha dos 12 meses, proporcionalizados enquanto a empresa não tem 12
// meses de faturamento (LC 123, art. 18 §2 — receita bruta proporcional).
// Ambos usam o MESMO divisor, senão o Fator R sairia distorcido.
// `params` chega até aqui porque a folha histórica é reconstruída pela mesma regra
// do mês corrente. Se só a chamada do mês usasse os parâmetros do banco, o Fator R
// continuaria calculado sobre 28%/1621 fixos e discordaria do pró-labore apurado.
function acumular12(invoices, month, year, salariosMensais, params) {
  const { inicio, fim } = janela12(month, year)
  const porMes = new Map()
  for (const inv of invoices) {
    const k = chaveOrdinal(chaveCompetencia(inv))
    if (k < inicio || k > fim) continue
    porMes.set(k, (porMes.get(k) || 0) + num(inv.invoice_value))
  }
  const meses = porMes.size
  if (!meses) return { rbt12: 0, folha12: 0, meses: 0, proporcionalizado: false }

  let receita = 0
  let folha = 0
  for (const fatMes of porMes.values()) {
    receita += fatMes
    // Folha reconstruída pela mesma regra do mês corrente: o pró-labore é derivado
    // do faturamento, não é dado guardado, então o histórico se recalcula.
    folha += proLaboreDoMes(fatMes, params) + salariosMensais
  }
  const proporcionalizado = meses < 12
  const fator = proporcionalizado ? 12 / meses : 1
  return {
    rbt12: round2(receita * fator),
    folha12: round2(folha * fator),
    meses,
    proporcionalizado,
  }
}

// Rateia `total` entre as faturas proporcionalmente ao valor da NF. O resíduo do
// arredondamento vai para a maior fatia, garantindo que a soma feche no centavo.
function ratear(total, invoices, totalFaturamento) {
  if (!totalFaturamento || !invoices.length) return []
  const partes = invoices.map((inv) => {
    const peso = num(inv.invoice_value) / totalFaturamento
    return { inv, peso, amount: round2(total * peso) }
  })
  const soma = round2(partes.reduce((s, p) => s + p.amount, 0))
  const residuo = round2(total - soma)
  if (Math.abs(residuo) >= 0.01) {
    const maior = partes.reduce((a, b) => (b.peso > a.peso ? b : a))
    maior.amount = round2(maior.amount + residuo)
  }
  return partes
}

// NÚCLEO DA APURAÇÃO — lê e calcula, não escreve nada.
//
// Existe separado por um motivo específico: a memória de cálculo da tela /fiscal precisa
// mostrar de onde saiu cada número, e o único jeito de ela não mentir é sair do MESMO
// caminho que grava a obrigação. Duplicar as fórmulas do outro lado repetiria a história
// do pró-labore (três lugares recalculando de formas diferentes, três números).
// Quem escreve é `apurar`; quem só lê é a memória no GET.
async function calcularApuracao(sql, company_id, m, y) {
  const settings = (await sql`
    SELECT * FROM company_settings WHERE company_id = ${company_id} LIMIT 1`)[0] || {}
  const salariosMensais = num(settings.salarios_mensal)
  const params = parametrosFiscais(settings)

  // Uma leitura só: alimenta faturamento do mês, RBT12 e rateio.
  const invoices = await sql`
    SELECT id, client_id, invoice_value, tax_amount, require_nf,
           EXTRACT(YEAR  FROM COALESCE(emission_date, make_date(year, month, 1)))::int AS comp_year,
           EXTRACT(MONTH FROM COALESCE(emission_date, make_date(year, month, 1)))::int AS comp_month
    FROM invoices WHERE company_id = ${company_id}`

  // Contrato sem NF (cliente que não pede nota) não gera tributo: fica fora do
  // faturamento do mês, da RBT12, do Fator R e do rateio por cliente. Continua
  // faturado e a receber — o que sai é só o lado fiscal.
  const tributaveis = invoices.filter(temNf)
  const doMes = tributaveis.filter((inv) => {
    const k = chaveCompetencia(inv)
    return k.y === y && k.m === m
  })
  const semNfDoMes = invoices.filter((inv) => {
    if (temNf(inv)) return false
    const k = chaveCompetencia(inv)
    return k.y === y && k.m === m
  })
  const faturamento = round2(doMes.reduce((s, inv) => s + num(inv.invoice_value), 0))
  const faturamentoSemNf = round2(semNfDoMes.reduce((s, inv) => s + num(inv.invoice_value), 0))

  const { rbt12, folha12, meses, proporcionalizado } = acumular12(tributaveis, m, y, salariosMensais, params)
  const prolabore = proLaboreDoMes(faturamento, params)

  // taxCalc calcula internamente rbt12 = faturamento_medio_mensal × 12 e
  // fatorR = folhaMensal / faturamento_medio_mensal. Alimentando as médias dos 12 meses,
  // ele reproduz exatamente RBT12 e Fator R acumulados — e a correção do epsilon na
  // fronteira dos 28% vem junto, sem duplicar a tabela do Simples aqui.
  //
  // A folha vai por `opts` porque aqui ela é somada mês a mês: aplicar a fórmula sobre a
  // média daria outro número quando o piso pega em parte dos meses e não em outros.
  const impostos = calcularImpostos({
    regime: settings.regime || 'simples_iii',
    faturamento_medio_mensal: rbt12 / 12,
    salarios_mensal: 0,
    iss_percent: settings.iss_percent,
  }, faturamento, { prolabore, folhaMensal: folha12 / 12 })

  // INSS é sobre o pró-labore DO MÊS (11% até o teto), não sobre a média da folha —
  // por isso `opts.prolabore` acima; o taxCalc já devolve o INSS certo.
  const inss = impostos.inss
  const das = round2(impostos.das ?? 0)
  const honorarios = params.honorarios_mensal

  const snapshot = {
    rbt12,
    rbt12_meses: meses,
    rbt12_proporcionalizado: proporcionalizado,
    folha12,
    fatorR: impostos.fatorR,
    anexo: impostos.anexo,
    aliquota_efetiva: impostos.aliquotaEfetiva ?? null,
    regime: impostos.regime,
    faturamento_mes: faturamento,
    prolabore,
    prolabore_no_piso: prolabore === params.prolabore_minimo,
    // Os parâmetros agora variam por empresa e mudam no tempo (o piso sobe todo
    // janeiro). Congelá-los no snapshot é o que permite reler uma apuração antiga
    // e entender com que regras ela foi feita.
    params,
    apurado_em: new Date().toISOString(),
  }

  return {
    settings, params, salariosMensais,
    doMes, semNfDoMes, faturamento, faturamentoSemNf,
    rbt12, folha12, meses, proporcionalizado,
    prolabore, impostos, das, inss, honorarios, snapshot,
  }
}

// Formatação para as fórmulas da memória. Feita à mão, sem Intl: a string sai do
// servidor e precisa ser idêntica em qualquer runtime, inclusive num Node sem ICU
// completo, onde toLocaleString('pt-BR') cai silenciosamente para o formato inglês.
const brl = (v) => {
  const n = Number(v) || 0
  const [i, d] = Math.abs(n).toFixed(2).split('.')
  return `${n < 0 ? '-' : ''}R$ ${i.replace(/\B(?=(\d{3})+$)/g, '.')},${d}`
}
const pctStr = (v, casas = 2) => `${((Number(v) || 0) * 100).toFixed(casas).replace('.', ',')}%`

// MEMÓRIA DE CÁLCULO — responde "de onde veio esse número?".
//
// Puro: recebe o resultado de `calcularApuracao` e só o traduz em fórmulas legíveis.
// Não recalcula nada — se recalculasse, a explicação poderia divergir do valor
// explicado, que é exatamente o defeito que ela existe para eliminar.
//
// `gravado` × `valor`: o valor é o recálculo de AGORA, o gravado é o que está na
// obrigação. Divergência entre os dois não é erro — significa que o mês mudou depois
// da apuração (NF emitida, editada ou excluída) e precisa ser reapurado.
function memoriaDeCalculo(a, obligations = [], semNfDetalhado = []) {
  const {
    params, faturamento, faturamentoSemNf, semNfDoMes, doMes,
    rbt12, folha12, meses, proporcionalizado, prolabore, impostos, das, inss, honorarios,
  } = a

  const gravadoDe = (kind, calculado) => {
    const ob = obligations.find((o) => o.kind === kind)
    if (!ob) return null
    const estimado = num(ob.amount_estimated)
    return {
      id: ob.id,
      estimado,
      guia: ob.amount_actual === null || ob.amount_actual === undefined ? null : num(ob.amount_actual),
      devido: round2(valorDevido(ob)),
      status: ob.status,
      divergente: Math.abs(round2(estimado - calculado)) >= 0.01,
    }
  }

  const simples = impostos.regime !== 'lucro_presumido'
  const faixa = simples ? faixaFor(tabelaDoAnexo(impostos.anexo), rbt12) : null
  const aliq = impostos.aliquotaEfetiva ?? 0
  const noTeto = prolabore > INSS_TETO
  const noPiso = prolabore === params.prolabore_minimo

  return {
    // Sem faturamento tributável o ?action=apurar responde 404 e não grava nada. A
    // memória continua sendo montada (as fórmulas explicam por que deu zero), mas a
    // tela precisa saber que isto é uma conta hipotética — o pró-labore no piso faria
    // aparecer um INSS de R$ 178,31 num mês em que nada foi faturado.
    apuravel: faturamento > 0,
    faturamento_total_mes: round2(faturamento + faturamentoSemNf),
    faturamento_tributavel: faturamento,
    faturas: { tributaveis: doMes.length, total: doMes.length + semNfDoMes.length },
    // Destaque da tela: é a diferença entre o que o mês faturou e o que ele tributou.
    faturas_sem_nf: {
      quantidade: semNfDoMes.length,
      valor: faturamentoSemNf,
      faturas: semNfDetalhado,
      formula: semNfDoMes.length
        ? `${brl(faturamento + faturamentoSemNf)} faturado − ${brl(faturamentoSemNf)} sem NF = ${brl(faturamento)} tributável`
        : null,
    },
    rbt12: {
      valor: rbt12,
      meses,
      proporcionalizado,
      formula: proporcionalizado
        ? `soma de ${meses} mês(es) de NF × 12/${meses} (proporcionalizada, LC 123 art. 18 §2) = ${brl(rbt12)}`
        : `soma das NF dos últimos 12 meses = ${brl(rbt12)}`,
    },
    fator_r: simples ? {
      valor: impostos.fatorR,
      folha12,
      minimo: FATOR_R_MIN,
      atende: impostos.anexo === 'III',
      formula: `folha 12m ${brl(folha12)} ÷ receita 12m ${brl(rbt12)} = ${pctStr(impostos.fatorR)} ` +
               `(${impostos.anexo === 'III' ? '≥' : '<'} ${pctStr(FATOR_R_MIN, 0)} → Anexo ${impostos.anexo})`,
    } : null,
    anexo_simples: simples ? {
      anexo: impostos.anexo,
      faixa: { ate: faixa.max, aliquota_nominal: faixa.rate, deducao: faixa.deduct },
      aliquota_efetiva: aliq,
      formula: `faixa até ${brl(faixa.max)}: (${brl(rbt12)} × ${pctStr(faixa.rate)} − ${brl(faixa.deduct)}) ` +
               `÷ ${brl(rbt12)} = ${pctStr(aliq)}`,
    } : null,
    das: simples ? {
      taxa: pctStr(aliq),
      base: faturamento,
      formula: `${brl(faturamento)} × ${pctStr(aliq)} = ${brl(das)}`,
      valor: das,
      gravado: gravadoDe('das', das),
    } : null,
    prolabore: {
      percentual: params.prolabore_percentual,
      piso: params.prolabore_minimo,
      no_piso: noPiso,
      valor: prolabore,
      formula: `máx(${brl(faturamento)} × ${pctStr(params.prolabore_percentual, 0)} = ` +
               `${brl(round2(faturamento * params.prolabore_percentual))}; piso ${brl(params.prolabore_minimo)}) = ${brl(prolabore)}`,
    },
    inss: {
      taxa: pctStr(INSS_RATE, 0),
      base: Math.min(prolabore, INSS_TETO),
      formula: `${brl(Math.min(prolabore, INSS_TETO))} × ${pctStr(INSS_RATE, 0)} = ${brl(inss)}` +
               (noTeto ? ` (pró-labore ${brl(prolabore)} limitado ao teto ${brl(INSS_TETO)})` : ''),
      valor: inss,
      gravado: gravadoDe('inss', inss),
    },
    escritorio: {
      formula: `valor fixo mensal de honorários contábeis (Configurações) = ${brl(honorarios)}`,
      valor: honorarios,
      gravado: gravadoDe('honorarios', honorarios),
    },
    // Lucro presumido não tem DAS nem anexo; os tributos vêm prontos do taxCalc.
    itens_lucro_presumido: simples ? null : impostos.itens,
    // pro_labore e escritorio vieram da migração de victor_reserves: são digitados e a
    // apuração não os recalcula. Aparecem à parte para o total da memória fechar com
    // os cards da tela, sem fingir que saíram de uma fórmula.
    lancados_a_mao: obligations
      .filter((o) => !KINDS.includes(o.kind))
      .map((o) => ({ id: o.id, kind: o.kind, valor: round2(valorDevido(o)), status: o.status })),
    total: {
      calculado: round2(das + inss + honorarios),
      formula: `DAS ${brl(das)} + INSS ${brl(inss)} + escritório ${brl(honorarios)} = ${brl(round2(das + inss + honorarios))}`,
      gravado: obligations.length
        ? round2(obligations.reduce((s, o) => s + valorDevido(o), 0))
        : null,
    },
  }
}

async function apurar(sql, req, res) {
  const { company_id, month, year } = req.body
  if (!company_id || !month || !year) {
    return res.status(400).json({ error: 'company_id, month e year são obrigatórios' })
  }
  const m = Number(month)
  const y = Number(year)

  // Mês já distribuído não pode ser reapurado em silêncio: o rateio novo sairia
  // com valores diferentes dos que foram efetivamente abatidos dos payables, e o
  // registro do abatimento passaria a apontar para uma base que não existe mais.
  // Estornar a distribuição primeiro é o caminho normal.
  const distribuido = (await sql`
    SELECT count(*)::int n FROM fiscal_allocations a
    JOIN fiscal_obligations o ON o.id = a.obligation_id
    WHERE o.company_id = ${company_id} AND o.month = ${m} AND o.year = ${y}
      AND a.payable_victor_id IS NOT NULL`)[0].n
  if (distribuido > 0) {
    return res.status(409).json({
      error: 'Este mês já foi distribuído nos lançamentos do Victor. Estorne a distribuição (?action=estornar-distribuicao) antes de reapurar.',
    })
  }

  const {
    doMes, semNfDoMes, faturamento, impostos, prolabore, das, inss, honorarios, snapshot,
    rbt12, folha12, meses, proporcionalizado,
  } = await calcularApuracao(sql, company_id, m, y)

  // Mês sem faturamento tributável NÃO é mês sem obrigação. O DAS some (incide sobre
  // receita que não houve), mas o INSS continua devido: o pró-labore cai no piso e o
  // `proLaboreDoMes` já o devolve, então há 11% sobre o piso a recolher. O escritório
  // cobra os honorários do mesmo jeito.
  //
  // Até 2026-07-28 esta função respondia 404 aqui e não gravava nada — um mês seco
  // simplesmente não existia para o sistema, escondendo dinheiro realmente devido
  // (com o piso de R$ 1.621: INSS R$ 178,31 + honorários R$ 150 = R$ 328,31/mês).
  const semFaturamento = faturamento <= 0

  // Uma obrigação por tipo. base_amount/rate_used diferem por tipo: o DAS incide
  // sobre o faturamento, o INSS sobre o pró-labore, honorários são valor fechado.
  const valores = {
    das: { amount: das, base: faturamento, rate: impostos.aliquotaEfetiva ?? null },
    inss: { amount: inss, base: prolabore, rate: INSS_RATE },
    honorarios: { amount: honorarios, base: null, rate: null },
  }
  // Sem faturamento o DAS não é gravado como R$ 0,00 — ele não existe. Uma obrigação
  // zerada nasceria com status 'pago' (ver statusObrigacao) e poluiria a tela com uma
  // guia que nunca houve.
  const kindsDoMes = semFaturamento ? KINDS.filter((k) => k !== 'das') : KINDS

  const upserts = []
  for (const kind of kindsDoMes) {
    const v = valores[kind]
    const row = (await sql`
      INSERT INTO fiscal_obligations
        (company_id, month, year, kind, amount_estimated, base_amount, rate_used, calc_snapshot, status)
      VALUES
        (${company_id}, ${m}, ${y}, ${kind}, ${v.amount}, ${v.base}, ${v.rate},
         ${JSON.stringify(snapshot)}::jsonb, 'previsto')
      ON CONFLICT (company_id, month, year, kind) DO UPDATE SET
        amount_estimated = EXCLUDED.amount_estimated,
        base_amount      = EXCLUDED.base_amount,
        rate_used        = EXCLUDED.rate_used,
        calc_snapshot    = EXCLUDED.calc_snapshot,
        updated_at       = now()
      RETURNING *`)[0]
    upserts.push(row)
  }

  // O mês passou a não ter faturamento (a única NF foi excluída ou editada para outra
  // competência): o DAS apurado antes tem de sair, senão fica cobrando imposto sobre
  // receita que já não existe. Só se ninguém mexeu nele — guia lançada ou pagamento
  // registrado é decisão humana e não se apaga por reapuração.
  let dasRemovido = false
  if (semFaturamento) {
    const apagados = await sql`
      DELETE FROM fiscal_obligations
      WHERE company_id = ${company_id} AND month = ${m} AND year = ${y} AND kind = 'das'
        AND amount_actual IS NULL AND COALESCE(paid_amount, 0) = 0
      RETURNING id`
    dasRemovido = apagados.length > 0
  }

  // O status nunca é decidido aqui. O UPSERT grava 'previsto' só na criação e não
  // toca no status ao reapurar; quem resolve é o recalcularObrigacao, que conhece as
  // regras todas: nada devido = 'pago' (senão uma obrigação de R$ 0,00 nasceria
  // pendente e não teria como ser quitada, já que pagar exige amount > 0), guia
  // oficial lançada = 'apurado', e pagamentos já registrados = 'parcial'/'pago'.
  const obligations = (await sql.transaction(
    upserts.map((o) => recalcularObrigacao(sql, o.id)),
  )).map((r) => r[0])

  // Rateio. Reapurar substitui o rateio anterior — sem isso rodar duas vezes
  // duplicaria tudo (fiscal_allocations não tem UNIQUE que segure).
  //
  // O filtro por `basis` é essencial: as linhas 'consumo_payable' guardam
  // `payable_victor_id`/`payable_payment_id`, os únicos ponteiros para o abatimento já
  // feito nos payables do Victor. Apagá-las junto deixava os `payable_payments`
  // órfãos (estornar-distribuicao passava a dizer "não foi distribuído") e derrubava
  // a guarda dos 409 do distribuir, liberando uma segunda distribuição sobre os
  // mesmos saldos. A guarda no topo desta função já impede chegar aqui distribuído,
  // mas o DELETE fica restrito ao rateio de qualquer forma — defesa em profundidade.
  const ids = obligations.map((o) => o.id)
  await sql`
    DELETE FROM fiscal_allocations
    WHERE obligation_id = ANY(${ids}) AND basis = 'proporcional_nf'`

  const writes = []
  let alocadas = 0
  for (const ob of obligations) {
    for (const p of ratear(num(ob.amount_estimated), doMes, faturamento)) {
      // `provisioned` só faz sentido no DAS: invoices.tax_amount é a provisão de imposto
      // que já foi descontada daquele cliente no faturamento. A diferença para o rateio
      // real é o ajuste — a reconciliação que antes ninguém calculava.
      const provisioned = ob.kind === 'das' ? round2(num(p.inv.tax_amount)) : 0
      writes.push(sql`
        INSERT INTO fiscal_allocations
          (obligation_id, client_id, invoice_id, amount, provisioned, adjustment, basis)
        VALUES
          (${ob.id}, ${p.inv.client_id}, ${p.inv.id}, ${p.amount}, ${provisioned},
           ${round2(p.amount - provisioned)}, 'proporcional_nf')`)
      alocadas++
    }
  }
  if (writes.length) await sql.transaction(writes)

  // Espelha as obrigações como linhas na aba Pagar Victor.
  const linhas = await sincronizarLinhasFiscais(sql, company_id, m, y)

  return res.status(200).json({
    linhas_fiscais: linhas,
    sem_faturamento: semFaturamento,
    das_removido: dasRemovido,
    apuracao: {
      faturamento, rbt12, folha12, meses_rbt12: meses, proporcionalizado,
      fatorR: impostos.fatorR, anexo: impostos.anexo,
      aliquota_efetiva: impostos.aliquotaEfetiva ?? null,
      prolabore, das, inss, honorarios,
      total: round2(das + inss + honorarios),
    },
    obligations: obligations.map((o) => ({
      id: o.id, kind: o.kind, amount_estimated: num(o.amount_estimated),
      base_amount: num(o.base_amount), status: o.status,
    })),
    allocations: alocadas,
    // O que ficou de fora, explícito: um faturamento menor que o esperado tem de ter
    // uma explicação visível, senão parece erro de apuração.
    sem_nf: {
      faturas: semNfDoMes.length,
      valor: round2(semNfDoMes.reduce((s, inv) => s + num(inv.invoice_value), 0)),
    },
  })
}

// PATCH ?action=lancar-guia — a guia oficial chegou.
// Grava o valor real (amount_actual), vencimento e nº do documento. A partir daí o
// valor devido passa a ser este, não mais a estimativa: quem manda nisso é o
// valorDevido() de lib/fiscal-status.js, respeitado também pelo fiscal-payments.js.
async function lancarGuia(sql, req, res) {
  const { obligation_id, amount_actual, due_date, doc_number, notes } = req.body || {}
  if (!obligation_id || amount_actual === undefined) {
    return res.status(400).json({ error: 'obligation_id e amount_actual são obrigatórios' })
  }
  // null explícito é aceito de propósito: desfaz o lançamento e devolve a obrigação
  // à estimativa (guia cancelada / lançada por engano).
  const valor = amount_actual === null || amount_actual === '' ? null : round2(amount_actual)
  if (valor !== null && valor < 0) {
    return res.status(400).json({ error: 'amount_actual não pode ser negativo' })
  }

  const rows = await sql`SELECT * FROM fiscal_obligations WHERE id = ${obligation_id} LIMIT 1`
  if (!rows.length) return res.status(404).json({ error: 'Obrigação não encontrada' })

  // COALESCE preserva o que não veio no corpo: retificar só o valor da guia não pode
  // apagar o vencimento e o nº do documento já cadastrados. Mesmo padrão do PATCH de
  // api/settings.js. Os casts são necessários porque um parâmetro nulo sem tipo
  // deixa o Postgres sem conseguir inferir o tipo do COALESCE.
  //
  // O status sai do recalcularObrigacao na mesma transação — nunca calculado aqui,
  // senão esta rota e o fiscal-payments.js divergiriam sobre o mesmo registro.
  const [, atualizado] = await sql.transaction([
    sql`
      UPDATE fiscal_obligations SET
        amount_actual = ${valor}::numeric,
        due_date      = COALESCE(${due_date ?? null}::date, due_date),
        doc_number    = COALESCE(${doc_number ?? null}::varchar, doc_number),
        notes         = COALESCE(${notes ?? null}::text, notes),
        updated_at    = now()
      WHERE id = ${obligation_id}`,
    recalcularObrigacao(sql, obligation_id),
  ])

  const ob = atualizado[0]

  // Rateio refeito com o valor da guia. Antes disto o `fiscal_allocations.amount`
  // ficava congelado na estimativa e a tabela "Custo por cliente" seguia mostrando
  // número velho depois que a guia oficial chegava.
  const doMes = await faturasDoMes(sql, ob.company_id, ob.month, ob.year)
  const faturamento = round2(doMes.reduce((s, i) => s + num(i.invoice_value), 0))
  if (faturamento > 0) await rerateiarObrigacao(sql, ob, doMes, faturamento)
  await sincronizarLinhasFiscais(sql, ob.company_id, ob.month, ob.year)

  const total = valorDevido(ob)
  const pago = num(ob.paid_amount)
  return res.status(200).json({
    obligation: ob,
    summary: {
      total_amount: total,
      amount_estimated: num(ob.amount_estimated),
      // Quanto a guia real diverge da apuração interna.
      diferenca_vs_estimado: valor === null ? null : round2(total - num(ob.amount_estimated)),
      paid_amount: pago,
      remaining: Math.max(round2(total - pago), 0),
      status: ob.status,
    },
  })
}

// POST ?action=distribuir — abate as despesas fiscais apuradas do que o Victor recebe.
//
// NÃO recalcula lucro. Victor e Fabrício já vêm de invoices (calcContrato/calcAgenda/
// calcProjeto), e os payables por cliente já existem desde que o recebível foi pago.
// Aqui só se consome esses saldos, na mesma cascata do ?action=pagar-distribuido —
// a diferença é que o pool vem da apuração em vez de ser digitado no modal.
//
// Grava `fiscal_allocations.payable_victor_id` em cada payable efetivamente consumido,
// fechando o elo entre a obrigação e de quem ela foi descontada.
async function distribuir(sql, req, res) {
  const { company_id, month, year, paid_at, reference_month, reference_year, incluir_previsto = false } = req.body || {}
  if (!company_id || !month || !year) {
    return res.status(400).json({ error: 'company_id, month e year são obrigatórios' })
  }
  const m = Number(month)
  const y = Number(year)

  const obrigacoes = await sql`
    SELECT * FROM fiscal_obligations
    WHERE company_id = ${company_id} AND month = ${m} AND year = ${y}
    ORDER BY kind`
  if (!obrigacoes.length) {
    return res.status(404).json({ error: 'Nada apurado neste mês. Rode ?action=apurar antes.' })
  }

  // Já distribuído? Reexecutar consumiria os saldos de novo. Estorne primeiro.
  const jaLigadas = await sql`
    SELECT count(*)::int n FROM fiscal_allocations
    WHERE obligation_id = ANY(${obrigacoes.map((o) => o.id)}) AND payable_victor_id IS NOT NULL`
  if (jaLigadas[0].n > 0) {
    return res.status(409).json({
      error: 'Este mês já foi distribuído. Use ?action=estornar-distribuicao antes de refazer.',
    })
  }

  // Por padrão só entram obrigações com valor real — guia lançada (`apurado`) ou já
  // com pagamento. `incluir_previsto` opta por usar a estimativa, para quem quer
  // reservar antes da guia chegar.
  // O pool é o SALDO EM ABERTO, não o valor cheio da obrigação. Usar valorDevido()
  // direto fazia o DAS já quitado no pix entrar inteiro na distribuição: consumia
  // saldo do Victor a mais e gravava fiscal_payments até paid_amount passar do devido.
  const elegivel = (o) => (incluir_previsto ? true : o.status !== 'previsto')
  const usadas = obrigacoes.filter((o) => elegivel(o) && saldoObrigacao(o) > 0)
  const ignoradas = obrigacoes
    .filter((o) => !usadas.includes(o))
    .map((o) => ({
      kind: o.kind,
      status: o.status,
      motivo: o.status !== 'previsto' || incluir_previsto
        ? (num(o.paid_amount) > 0 ? 'já quitada' : 'valor zero')
        : 'ainda previsto',
    }))
  if (!usadas.length) {
    return res.status(400).json({
      error: 'Nenhuma obrigação elegível. Lance a guia oficial (?action=lancar-guia) ou envie incluir_previsto: true.',
      ignoradas,
    })
  }

  // `despesas` usa as chaves de CATS para o notes sair na grafia que o Financial.jsx
  // já sabe ler — o detalhamento por categoria da tela funciona sem alteração.
  const despesas = {}
  let pool = 0
  for (const o of usadas) {
    const v = saldoObrigacao(o)
    despesas[o.kind] = (despesas[o.kind] || 0) + v
    pool = round2(pool + v)
  }
  const notes = montarNotes(despesas)
  const when = (paid_at || todayISO()).slice(0, 10)

  // Mês de caixa de referência: por padrão o próprio mês apurado.
  const curKey = (Number(reference_year) || y) * 100 + (Number(reference_month) || m)
  const candidatos = await candidatosDisponiveis(sql, company_id, curKey)
  const { writes, applied, restante } = consumir(sql, pool, ordenar(candidatos), when, notes)

  if (!applied.length) {
    return res.status(400).json({
      error: 'Nenhum saldo disponível para abater. Só entram payables cujo recebível do cliente já foi pago.',
      pool,
    })
  }

  // Liga cada obrigação aos payables consumidos. Uma alocação por (obrigação, payable):
  // o `amount` é a fatia daquela obrigação no que foi consumido daquele payable,
  // proporcional ao peso da obrigação no pool.
  //
  // `payable_payment_id` sai de um SELECT em vez de vir de um RETURNING porque tudo roda
  // numa transação só — o INSERT do pagamento está antes nesta mesma lista, então já é
  // visível aqui. Guardar o id exato é o que permite estornar apenas os pagamentos DESTA
  // distribuição: apagar por payable_id levaria junto pagamentos anteriores do cliente.
  const consumidoTotal = round2(applied.reduce((s, a) => s + a.consumed, 0))
  const ligacoes = []
  for (const o of usadas) {
    const peso = saldoObrigacao(o) / pool
    for (const a of applied) {
      ligacoes.push(sql`
        INSERT INTO fiscal_allocations
          (obligation_id, client_id, payable_victor_id, payable_payment_id, amount, basis)
        SELECT ${o.id}, ${a.client_id}, ${a.id}, pp.id, ${round2(a.consumed * peso)}, 'consumo_payable'
        FROM payable_payments pp
        WHERE pp.payable_type = 'victor' AND pp.payable_id = ${a.id}
          AND pp.paid_at = ${when} AND pp.notes = ${notes}`)
    }
  }
  // Abater dos payables É a quitação: o imposto saiu do que o Victor tinha a receber.
  // Sem registrar isso, a obrigação continuaria em aberto e o card de Reservas do
  // Financial.jsx seguiria retendo o valor no caixa — descontando o mesmo dinheiro
  // duas vezes, uma no saldo dos payables e outra na reserva.
  //
  // Cada obrigação recebe a fatia do que foi efetivamente consumido (proporcional ao
  // peso dela no pool); com `nao_coberto > 0` isso vira pagamento parcial. O resíduo
  // do arredondamento vai para a maior fatia, para a soma fechar no centavo.
  const cobertura = usadas.map((o) => ({ o, valor: round2(consumidoTotal * (saldoObrigacao(o) / pool)) }))
  const somaCob = round2(cobertura.reduce((s, c) => s + c.valor, 0))
  if (Math.abs(consumidoTotal - somaCob) >= 0.01 && cobertura.length) {
    cobertura.reduce((a, b) => (b.valor > a.valor ? b : a)).valor += round2(consumidoTotal - somaCob)
  }
  const quitacoes = cobertura
    .filter((c) => c.valor > 0.005)
    .map((c) => sql`
      INSERT INTO fiscal_payments (obligation_id, amount, paid_at, method, notes)
      VALUES (${c.o.id}, ${c.valor}, ${when}, 'abatimento', 'Abatido dos lançamentos a pagar do Victor')`)

  await sql.transaction([...writes, ...ligacoes, ...quitacoes])
  // Fora da transação: recalcularObrigacao lê a soma dos fiscal_payments, que só
  // existe depois do commit.
  for (const c of cobertura) await recalcularObrigacao(sql, c.o.id)

  return res.status(200).json({
    distribuicao: {
      pool,
      consumido: consumidoTotal,
      // Sobra = despesa que os saldos disponíveis não cobriram; sai do capital do Victor.
      nao_coberto: round2(restante),
      despesas,
      notes,
      paid_at: when,
    },
    obrigacoes_usadas: usadas.map((o) => ({
      id: o.id, kind: o.kind, valor: saldoObrigacao(o), devido: round2(valorDevido(o)), status: o.status,
    })),
    obrigacoes_ignoradas: ignoradas,
    payables_afetados: applied,
  })
}

// POST ?action=estornar-distribuicao — desfaz a distribuição de um mês.
async function estornarDistribuicao(sql, req, res) {
  const { company_id, month, year } = req.body || {}
  if (!company_id || !month || !year) {
    return res.status(400).json({ error: 'company_id, month e year são obrigatórios' })
  }
  const obrigacoes = await sql`
    SELECT id FROM fiscal_obligations
    WHERE company_id = ${company_id} AND month = ${Number(month)} AND year = ${Number(year)}`
  if (!obrigacoes.length) return res.status(404).json({ error: 'Nada apurado neste mês' })
  const ids = obrigacoes.map((o) => o.id)

  // Os payables e os PAGAMENTOS desta distribuição vêm das próprias alocações.
  // Apagar por payable_id levaria junto pagamentos anteriores do mesmo cliente —
  // só saem as linhas de payable_payments que esta distribuição criou.
  const ligadas = await sql`
    SELECT DISTINCT payable_victor_id, payable_payment_id FROM fiscal_allocations
    WHERE obligation_id = ANY(${ids}) AND payable_victor_id IS NOT NULL`
  if (!ligadas.length) return res.status(400).json({ error: 'Este mês não foi distribuído' })
  const payableIds = [...new Set(ligadas.map((l) => l.payable_victor_id))]
  const paymentIds = [...new Set(ligadas.map((l) => l.payable_payment_id).filter(Boolean))]

  await sql`DELETE FROM fiscal_allocations WHERE obligation_id = ANY(${ids}) AND payable_victor_id IS NOT NULL`
  if (paymentIds.length) {
    await sql`DELETE FROM payable_payments WHERE payable_type = 'victor' AND id = ANY(${paymentIds})`
  }
  // As quitações geradas pelo abatimento saem junto. `method='abatimento'` as separa
  // de pagamentos que o Victor tenha registrado à mão na tela de apuração, que ficam.
  // Um mês só pode ter uma distribuição ativa (a guarda dos 409), então não há ambiguidade.
  await sql`DELETE FROM fiscal_payments WHERE obligation_id = ANY(${ids}) AND method = 'abatimento'`
  for (const id of ids) await recalcularObrigacao(sql, id)
  // Recalcula cada payable a partir dos pagamentos restantes — nunca por subtração,
  // que acumularia divergência.
  for (const id of payableIds) {
    await sql`
      UPDATE payables_victor p SET
        paid_amount = s.total,
        status = CASE WHEN s.total <= 0.01 THEN 'pendente'
                      WHEN s.total >= p.total_amount - 0.01 THEN 'pago'
                      ELSE 'parcial' END,
        paid_at = s.ultimo
      FROM (SELECT COALESCE(SUM(amount),0) total, MAX(paid_at) ultimo
            FROM payable_payments WHERE payable_type='victor' AND payable_id=${id}) s
      WHERE p.id = ${id}`
  }
  return res.status(200).json({ estornados: payableIds.length, payable_ids: payableIds })
}

// Faturas de uma competência. Mesma resolução de mês do apurar (emissão, com fallback
// no par year/month da própria fatura) — duas regras diferentes jogariam a mesma NF em
// meses distintos conforme a rota.
//
// `comNf` mantém o mesmo recorte do apurar: por padrão só as faturas tributáveis, para
// que o rerateio e a redistribuição enxerguem exatamente a base que gerou a obrigação.
// `comNf: false` inverte o filtro e devolve as excluídas — é como a tela lista o que
// ficou de fora. `COALESCE` porque fatura anterior à migração tem a coluna nula.
async function faturasDoMes(sql, company_id, m, y, { comNf = true } = {}) {
  return sql`
    SELECT * FROM (
      SELECT i.*,
             EXTRACT(YEAR  FROM COALESCE(i.emission_date, make_date(i.year, i.month, 1)))::int AS comp_year,
             EXTRACT(MONTH FROM COALESCE(i.emission_date, make_date(i.year, i.month, 1)))::int AS comp_month
      FROM invoices i WHERE i.company_id = ${company_id}
    ) x
    WHERE x.comp_year = ${y} AND x.comp_month = ${m}
      AND COALESCE(x.require_nf, true) = ${comNf}
    ORDER BY x.id`
}

// Refaz o rateio por cliente de UMA obrigação a partir do valor devido corrente.
// É o elo que faltava entre `lancar-guia` e `fiscal_allocations`: sem isto o custo por
// cliente continuava exibindo a estimativa depois que a guia oficial chegava.
// Devolve o rateio anterior para a resposta poder mostrar antes/depois.
async function rerateiarObrigacao(sql, ob, doMes, faturamento) {
  const anteriores = await sql`
    SELECT * FROM fiscal_allocations
    WHERE obligation_id = ${ob.id} AND basis = 'proporcional_nf'`

  await sql`
    DELETE FROM fiscal_allocations
    WHERE obligation_id = ${ob.id} AND basis = 'proporcional_nf'`

  const writes = []
  for (const p of ratear(round2(valorDevido(ob)), doMes, faturamento)) {
    const provisioned = ob.kind === 'das' ? round2(num(p.inv.tax_amount)) : 0
    writes.push(sql`
      INSERT INTO fiscal_allocations
        (obligation_id, client_id, invoice_id, amount, provisioned, adjustment, basis)
      VALUES
        (${ob.id}, ${p.inv.client_id}, ${p.inv.id}, ${p.amount}, ${provisioned},
         ${round2(p.amount - provisioned)}, 'proporcional_nf')`)
  }
  if (writes.length) await sql.transaction(writes)
  return anteriores
}

// Carrega tudo que a redistribuição de um mês precisa, numa leitura só por tabela.
async function contextoRedistribuicao(sql, company_id, m, y) {
  const doMes = await faturasDoMes(sql, company_id, m, y)
  if (!doMes.length) return { doMes: [], alocacoes: [], payables: new Map() }

  const invIds = doMes.map((i) => i.id)
  const alocacoes = await sql`
    SELECT a.*, o.kind FROM fiscal_allocations a
    JOIN fiscal_obligations o ON o.id = a.obligation_id
    WHERE a.invoice_id = ANY(${invIds})`
  const pv = await sql`
    SELECT * FROM payables_victor WHERE invoice_id = ANY(${invIds})`

  const payables = new Map()
  for (const p of pv) payables.set(Number(p.invoice_id), p)
  return { doMes, alocacoes, payables }
}

// POST ?action=recalcular — redistribui o resultado do Victor com o imposto REAL.
//
// A fatura embute uma PROVISÃO de imposto (7% do contrato). A apuração produz o custo
// fiscal real (DAS na alíquota efetiva do Simples + INSS + honorários) rateado por
// cliente. Aqui a diferença entre os dois é jogada de volta no que o Victor recebe:
// o lucro absorve primeiro, o serviço só depois (cascata em lib/fiscal-redistribution.js).
//
// Por padrão é PRÉVIA (`aplicar: false`): devolve antes/depois sem tocar em nada.
// Nada financeiro é gravado sem o flag explícito.
// `raw` faz a função devolver { status, payload } em vez de responder — é assim que o
// corrigir-escritorio embute a prévia na resposta dele sem duplicar a lógica.
async function recalcular(sql, req, res, raw = false) {
  const responder = (status, payload) => (raw ? { status, payload } : res.status(status).json(payload))
  const body = req.body || {}
  let { company_id, month, year } = body
  const { invoice_id, aplicar = false, novo_imposto_pct = null } = body

  // Chamada por fatura (assinatura do spec): a competência sai da própria nota.
  if (invoice_id && (!company_id || !month || !year)) {
    const rows = await sql`
      SELECT company_id,
             EXTRACT(YEAR  FROM COALESCE(emission_date, make_date(year, month, 1)))::int AS comp_year,
             EXTRACT(MONTH FROM COALESCE(emission_date, make_date(year, month, 1)))::int AS comp_month
      FROM invoices WHERE id = ${invoice_id} LIMIT 1`
    if (!rows.length) return responder(404, { error: 'Fatura não encontrada' })
    company_id = rows[0].company_id
    year = rows[0].comp_year
    month = rows[0].comp_month
  }
  if (!company_id || !month || !year) {
    return responder(400, { error: 'invoice_id, ou company_id + month + year, são obrigatórios' })
  }
  const m = Number(month)
  const y = Number(year)

  const { doMes, alocacoes, payables } = await contextoRedistribuicao(sql, company_id, m, y)
  const alvo = invoice_id ? doMes.filter((i) => Number(i.id) === Number(invoice_id)) : doMes
  if (!alvo.length) {
    // Fatura existe, mas é de contrato sem NF: não tem imposto real para reconciliar.
    // Sem esta mensagem o erro sairia como "não existe fatura", que é falso.
    if (invoice_id) {
      const fora = await sql`
        SELECT id FROM invoices WHERE id = ${invoice_id} AND require_nf = false LIMIT 1`
      if (fora.length) {
        return responder(400, {
          error: 'Fatura de contrato sem NF: fica fora da apuração fiscal, então não há imposto real a redistribuir.',
        })
      }
    }
    return responder(404, { error: 'Nenhuma fatura nesta competência' })
  }

  // Sem apuração não há imposto real: recalcular aqui zeraria o custo fiscal e
  // devolveria ao Victor a provisão inteira — o oposto do que se quer.
  const temRateio = alocacoes.some((a) => a.basis === 'proporcional_nf')
  const simulando = novo_imposto_pct !== null && novo_imposto_pct !== undefined && novo_imposto_pct !== ''
  if (!temRateio && !simulando) {
    return responder(400, {
      error: 'Mês ainda não apurado. Rode ?action=apurar antes de recalcular (ou envie novo_imposto_pct para simular).',
    })
  }

  const resultados = alvo.map((invoice) => recalcularInvoice({
    invoice,
    alocacoes,
    payable: payables.get(Number(invoice.id)) || null,
    overridePct: novo_imposto_pct,
  }))

  const aplicaveis = resultados.filter((r) => r.aplicavel && r.mudou)
  let aplicados = []
  if (aplicar) {
    if (simulando) {
      return responder(400, { error: 'Simulação (novo_imposto_pct) não pode ser aplicada. Lance a guia oficial e recalcule.' })
    }
    // Payable já pago (inclusive por abatimento da distribuição) tem pagamentos
    // apontando para ele; mexer no total_amount por baixo faria o status e o saldo
    // divergirem dos payable_payments. Estornar primeiro é o caminho.
    const travados = aplicaveis.filter((r) => num(payables.get(Number(r.invoice_id))?.paid_amount) > 0)
    if (travados.length) {
      return responder(409, {
        error: 'Há lançamentos do Victor já pagos/abatidos nesta competência. Estorne os pagamentos (ou a distribuição) antes de redistribuir.',
        payables_travados: travados.map((r) => r.payable_id),
      })
    }

    const writes = []
    for (const r of aplicaveis) {
      const s = r.mudancas.servico_victor.depois
      const p = r.mudancas.lucro_victor.depois
      // A cascata é gravada junto: é o registro auditável de como o lucro foi consumido
      // pelos impostos daquela NF (e de quanto saiu do capital próprio). A tela não
      // depende dela para exibir — o GET de payables-victor recalcula pela MESMA função
      // —, mas sem persistir não há histórico: reapurar o mês reescreveria o passado.
      //
      // `origin IS DISTINCT FROM 'fiscal'` é defesa em profundidade, mesmo idioma de
      // `candidatosDisponiveis()`: linha fiscal é espelho de obrigação da empresa, tem
      // `invoice_id` NULL e nunca chega aqui — mas se chegasse, gravaria uma cascata de
      // lucro em cima de uma linha que não tem lucro nenhum.
      const c = r.cascata
      writes.push(sql`
        UPDATE payables_victor SET
          service_amount = ${s}, profit_amount = ${p}, total_amount = ${round2(s + p)},
          lucro_antes_escritorio = ${c.lucro_antes_escritorio},
          lucro_antes_inss       = ${c.lucro_antes_inss},
          lucro_antes_das        = ${c.lucro_antes_das},
          capital_proprio        = ${c.capital_proprio}
        WHERE id = ${r.payable_id} AND origin IS DISTINCT FROM 'fiscal'`)
      // Registra em cada linha do rateio de onde o imposto daquele cliente saiu.
      // `from_service`/`from_profit` já existiam no schema e nunca haviam sido gravados.
      const totalReal = r.real
      for (const a of alocacoes) {
        if (a.basis !== 'proporcional_nf' || Number(a.invoice_id) !== Number(r.invoice_id)) continue
        const peso = totalReal > 0 ? num(a.amount) / totalReal : 0
        writes.push(sql`
          UPDATE fiscal_allocations SET
            from_service = ${round2(r.from_service * peso)},
            from_profit  = ${round2(r.from_profit * peso)}
          WHERE id = ${a.id}`)
      }
      aplicados.push(r.payable_id)
    }
    if (writes.length) await sql.transaction(writes)
  }

  return responder(200, {
    success: true,
    competencia: { month: m, year: y },
    aplicado: aplicar,
    simulado: simulando,
    mudancas: consolidar(resultados),
    por_fatura: resultados,
    payables_atualizados: aplicados,
    // Faturas que mudaram mas ainda não têm payable: a nota não foi recebida, então
    // não há o que gravar — o novo valor entra sozinho quando o Victor marcar "recebi".
    pendentes_de_recebimento: resultados.filter((r) => r.mudou && !r.aplicavel).map((r) => r.invoice_id),
  })
}

// PATCH ?action=corrigir-escritorio — o escritório mandou o valor real de um imposto.
//
// É `lancar-guia` + as duas coisas que faltavam depois dele: refazer o rateio por
// cliente com o valor novo e devolver o antes/depois do que o Victor recebe.
async function corrigirEscritorio(sql, req, res) {
  const { obligation_id, imposto_real, tipo, due_date, doc_number, notes, aplicar = false } = req.body || {}
  if (!obligation_id || imposto_real === undefined) {
    return res.status(400).json({ error: 'obligation_id e imposto_real são obrigatórios' })
  }
  const valor = imposto_real === null || imposto_real === '' ? null : round2(imposto_real)
  if (valor !== null && valor < 0) {
    return res.status(400).json({ error: 'imposto_real não pode ser negativo' })
  }

  const rows = await sql`SELECT * FROM fiscal_obligations WHERE id = ${obligation_id} LIMIT 1`
  if (!rows.length) return res.status(404).json({ error: 'Obrigação não encontrada' })
  const antesOb = rows[0]
  if (tipo && tipo !== antesOb.kind) {
    return res.status(400).json({ error: `A obrigação ${obligation_id} é do tipo '${antesOb.kind}', não '${tipo}'.` })
  }

  const [, atualizado] = await sql.transaction([
    sql`
      UPDATE fiscal_obligations SET
        amount_actual = ${valor}::numeric,
        due_date      = COALESCE(${due_date ?? null}::date, due_date),
        doc_number    = COALESCE(${doc_number ?? null}::varchar, doc_number),
        notes         = COALESCE(${notes ?? null}::text, notes),
        updated_at    = now()
      WHERE id = ${obligation_id}`,
    recalcularObrigacao(sql, obligation_id),
  ])
  const ob = atualizado[0]

  // Rateio refeito com o valor da guia. Sem faturamento no mês não há como ratear —
  // a obrigação fica gravada e o rateio, vazio.
  const doMes = await faturasDoMes(sql, ob.company_id, ob.month, ob.year)
  const faturamento = round2(doMes.reduce((s, i) => s + num(i.invoice_value), 0))
  if (faturamento > 0) await rerateiarObrigacao(sql, ob, doMes, faturamento)
  await sincronizarLinhasFiscais(sql, ob.company_id, ob.month, ob.year)

  // Antes/depois do resultado do Victor com o rateio novo já valendo. Em `raw`: a guia
  // já está gravada, e um mês sem NF (nada a redistribuir) não pode virar erro da rota.
  req.body = { company_id: ob.company_id, month: ob.month, year: ob.year, aplicar }
  const previa = await recalcular(sql, req, res, true)
  const devido = round2(valorDevido(ob))

  return res.status(200).json({
    obligation: ob,
    summary: {
      total_amount: devido,
      amount_estimated: num(ob.amount_estimated),
      diferenca_vs_estimado: valor === null ? null : round2(devido - num(ob.amount_estimated)),
      // O que a guia do escritório mudou em relação ao valor que valia até agora —
      // é este o número do "MUDOU de X para Y".
      valor_anterior: round2(valorDevido(antesOb)),
      diferenca_vs_anterior: round2(devido - valorDevido(antesOb)),
      paid_amount: num(ob.paid_amount),
      remaining: Math.max(round2(devido - num(ob.paid_amount)), 0),
      status: ob.status,
    },
    redistribuicao: previa.status === 200 ? previa.payload : null,
    aviso: previa.status === 200 ? null : previa.payload.error,
  })
}

// Apuração chamada de dentro do servidor, sem HTTP. Usada por api/invoices.js para
// recalcular a competência assim que uma NF é emitida.
//
// Reaproveita `apurar` inteiro em vez de reimplementar o miolo: as guardas que importam
// (mês já distribuído responde 409, reapuração substitui só o rateio 'proporcional_nf')
// são justamente o que não pode divergir entre os dois caminhos. Mesmo padrão do `raw`
// de `recalcular`, que já devolve { status, payload } para o corrigir-escritorio.
export async function apurarCompetencia(sql, company_id, month, year) {
  let status = 200
  let payload = null
  const captura = {
    status(s) { status = s; return this },
    json(p) { payload = p; return this },
  }
  await apurar(sql, { body: { company_id, month, year } }, captura)
  return { status, payload }
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  const sql = neon(process.env.DATABASE_URL)

  try {
    if (req.method === 'GET') {
      const { company_id, month, year } = req.query
      if (!company_id || !year) {
        return res.status(400).json({ error: 'company_id e year são obrigatórios' })
      }
      const obligations = month
        ? await sql`
            SELECT * FROM fiscal_obligations
            WHERE company_id = ${company_id} AND year = ${year} AND month = ${month}
            ORDER BY month, kind`
        : await sql`
            SELECT * FROM fiscal_obligations
            WHERE company_id = ${company_id} AND year = ${year}
            ORDER BY month, kind`

      const ids = obligations.map((o) => o.id)
      let allocations = []
      if (ids.length) {
        allocations = await sql`
          SELECT a.*, c.name AS client_name, o.kind
          FROM fiscal_allocations a
          JOIN fiscal_obligations o ON o.id = a.obligation_id
          LEFT JOIN clients c ON c.id = a.client_id
          WHERE a.obligation_id = ANY(${ids})
          ORDER BY o.kind, c.name`
      }
      const byOb = {}
      for (const a of allocations) (byOb[a.obligation_id] ||= []).push(a)
      for (const o of obligations) o.allocations = byOb[o.id] || []

      // Faturas de contrato sem NF na competência. Vão para a tela como nota de rodapé
      // da apuração: elas explicam a distância entre o que o mês faturou e o que o mês
      // tributou. Independem de já ter havido apuração.
      let semNf = []
      if (month) {
        const fora = await faturasDoMes(sql, company_id, Number(month), Number(year), { comNf: false })
        if (fora.length) {
          const nomes = await sql`
            SELECT id, name FROM clients WHERE id = ANY(${[...new Set(fora.map((i) => i.client_id))]})`
          const porId = new Map(nomes.map((c) => [Number(c.id), c.name]))
          semNf = fora.map((i) => ({
            invoice_id: i.id,
            client_id: i.client_id,
            client_name: porId.get(Number(i.client_id)) || 'Cliente',
            invoice_value: num(i.invoice_value),
          }))
        }
      }

      // Memória de cálculo do mês: passo a passo do faturamento até DAS/INSS/escritório.
      // Roda o MESMO `calcularApuracao` do ?action=apurar, então o que ela explica é
      // literalmente o que a apuração gravaria agora. Existe mesmo sem mês apurado —
      // aí ela é a previsão, e é justamente quando mais se quer conferir a conta.
      let calculo = null
      if (month) {
        const a = await calcularApuracao(sql, company_id, Number(month), Number(year))
        calculo = memoriaDeCalculo(a, obligations, semNf)
      }

      // Prévia da redistribuição do mês (nunca grava). É o que alimenta o painel de
      // etapas da tela: a fatura é a ETAPA 1, o rateio corrente é a 2 ou a 3.
      let redistribuicao = null
      if (month && obligations.length) {
        const m = Number(month)
        const y = Number(year)
        const { doMes, alocacoes, payables } = await contextoRedistribuicao(sql, company_id, m, y)
        const resultados = doMes.map((invoice) => recalcularInvoice({
          invoice, alocacoes, payable: payables.get(Number(invoice.id)) || null,
        }))
        // Faturamento apurado × faturamento de hoje: se uma NF foi emitida, editada ou
        // excluída depois da apuração, o mês está defasado e precisa ser reapurado.
        const faturamentoAtual = round2(doMes.reduce((s, i) => s + num(i.invoice_value), 0))
        const faturamentoApurado = round2(num(obligations[0]?.calc_snapshot?.faturamento_mes))
        redistribuicao = {
          mudancas: resultados.length ? consolidar(resultados) : null,
          por_fatura: resultados,
          // A guia oficial já chegou para pelo menos uma obrigação → ETAPA 3.
          etapa: obligations.some((o) => o.amount_actual !== null) ? 3 : 2,
          faturamento_atual: faturamentoAtual,
          faturamento_apurado: faturamentoApurado,
          desatualizado: Math.abs(faturamentoAtual - faturamentoApurado) >= 0.01,
        }
      }
      return res.status(200).json({ data: obligations, redistribuicao, sem_nf: semNf, calculo })
    }

    if (req.method === 'POST') {
      if (req.query.action === 'apurar') return apurar(sql, req, res)
      if (req.query.action === 'recalcular') return recalcular(sql, req, res)
      if (req.query.action === 'distribuir') return distribuir(sql, req, res)
      if (req.query.action === 'estornar-distribuicao') return estornarDistribuicao(sql, req, res)
      return res.status(400).json({ error: 'action inválida. Use apurar, recalcular, distribuir ou estornar-distribuicao' })
    }

    if (req.method === 'PATCH') {
      if (req.query.action === 'lancar-guia') return lancarGuia(sql, req, res)
      if (req.query.action === 'corrigir-escritorio') return corrigirEscritorio(sql, req, res)
      return res.status(400).json({ error: 'action inválida. Use lancar-guia ou corrigir-escritorio' })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    console.error('fiscal-obligations:', error)
    return res.status(500).json({ error: error.message })
  }
}
