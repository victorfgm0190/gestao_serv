import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import { calcularImpostos, calcINSS } from '../lib/taxCalc.js'
import { valorDevido, recalcularObrigacao } from '../lib/fiscal-status.js'

// APURAÇÃO FISCAL — DAS / INSS / Honorários.
//
// Previsão de caixa, NÃO contabilidade formal (mesma ressalva de lib/taxCalc.js).
// Separa três coisas que antes viviam coladas numa string em payable_payments.notes:
//   fiscal_obligations  → o que a empresa deve no mês (previsto × apurado × pago)
//   fiscal_allocations  → quanto disso cabe a cada cliente
//   fiscal_payments     → quando a guia foi efetivamente quitada (outro endpoint)
//
// POST  ?action=apurar       { company_id, month, year }   → calcula e grava (idempotente)
// PATCH ?action=lancar-guia  { obligation_id, amount_actual, due_date, doc_number }
//                                                          → guia oficial chegou
// GET   ?company_id&month&year                             → lê o que já foi apurado

const round2 = (v) => Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100
// numeric do Postgres chega como string no driver — sem isso, `a + b` concatena.
const num = (v) => parseFloat(v) || 0

// Regras de negócio da apuração. Confirmadas com o Victor.
const PROLABORE_PCT = 0.28        // Fator R: folha/RBT12 >= 28% mantém o Anexo III
const PROLABORE_MINIMO = 1621.00  // piso — nunca apura pró-labore abaixo disso
const HONORARIOS_MENSAL = 150.00  // honorários do contador (valor fixo)
const KINDS = ['das', 'inss', 'honorarios']

// Competência da NF = mês de EMISSÃO, resolvida no SQL (ver `comp_year`/`comp_month`
// na consulta). Faturas antigas sem `emission_date` caem no par (year, month) da própria
// fatura — filtrar por `emission_date IS NOT NULL` as faria sumir da apuração,
// subestimando o faturamento e, com ele, o DAS.
// Derivar isso em JS não funciona: o driver devolve `date` como objeto Date, e
// `String(date)` não é ISO — o parse caía no fallback e jogava NF de julho em junho.
const chaveCompetencia = (inv) => ({ y: Number(inv.comp_year), m: Number(inv.comp_month) })

// Pró-labore do mês: 28% do faturamento, respeitando o piso.
const proLaboreDoMes = (faturamentoMes) =>
  Math.max(round2(faturamentoMes * PROLABORE_PCT), PROLABORE_MINIMO)

// Janela de 12 meses terminando no mês apurado (inclusive).
function janela12(month, year) {
  const fim = year * 12 + (month - 1)
  return { inicio: fim - 11, fim }
}
const chaveOrdinal = ({ y, m }) => y * 12 + (m - 1)

// RBT12 + folha dos 12 meses, proporcionalizados enquanto a empresa não tem 12
// meses de faturamento (LC 123, art. 18 §2 — receita bruta proporcional).
// Ambos usam o MESMO divisor, senão o Fator R sairia distorcido.
function acumular12(invoices, month, year, salariosMensais) {
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
    // Folha reconstruída pela mesma regra do mês corrente — o pró-labore histórico
    // não é guardado em lugar nenhum (company_settings.prolabore_mensal é um valor só).
    folha += proLaboreDoMes(fatMes) + salariosMensais
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

async function apurar(sql, req, res) {
  const { company_id, month, year } = req.body
  if (!company_id || !month || !year) {
    return res.status(400).json({ error: 'company_id, month e year são obrigatórios' })
  }
  const m = Number(month)
  const y = Number(year)

  const settings = (await sql`
    SELECT * FROM company_settings WHERE company_id = ${company_id} LIMIT 1`)[0] || {}
  const salariosMensais = num(settings.salarios_mensal)

  // Uma leitura só: alimenta faturamento do mês, RBT12 e rateio.
  const invoices = await sql`
    SELECT id, client_id, invoice_value, tax_amount,
           EXTRACT(YEAR  FROM COALESCE(emission_date, make_date(year, month, 1)))::int AS comp_year,
           EXTRACT(MONTH FROM COALESCE(emission_date, make_date(year, month, 1)))::int AS comp_month
    FROM invoices WHERE company_id = ${company_id}`

  const doMes = invoices.filter((inv) => {
    const k = chaveCompetencia(inv)
    return k.y === y && k.m === m
  })
  const faturamento = round2(doMes.reduce((s, inv) => s + num(inv.invoice_value), 0))
  if (faturamento <= 0) {
    return res.status(404).json({ error: 'Nenhum faturamento neste mês' })
  }

  const { rbt12, folha12, meses, proporcionalizado } = acumular12(invoices, m, y, salariosMensais)
  const prolabore = proLaboreDoMes(faturamento)

  // taxCalc calcula internamente rbt12 = faturamento_medio_mensal × 12 e
  // fatorR = (prolabore + salarios) / faturamento_medio_mensal. Alimentando as médias
  // dos 12 meses, ele reproduz exatamente RBT12 e Fator R acumulados — e a correção do
  // epsilon na fronteira dos 28% vem junto, sem duplicar a tabela do Simples aqui.
  const impostos = calcularImpostos({
    regime: settings.regime || 'simples_iii',
    faturamento_medio_mensal: rbt12 / 12,
    prolabore_mensal: folha12 / 12,
    salarios_mensal: 0,
    iss_percent: settings.iss_percent,
  }, faturamento)

  // INSS é sobre o pró-labore DO MÊS (11% até o teto), não sobre a média da folha.
  const inss = calcINSS(prolabore)
  const das = round2(impostos.das ?? 0)
  const honorarios = HONORARIOS_MENSAL

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
    prolabore_no_piso: prolabore === PROLABORE_MINIMO,
    apurado_em: new Date().toISOString(),
  }

  // Uma obrigação por tipo. base_amount/rate_used diferem por tipo: o DAS incide
  // sobre o faturamento, o INSS sobre o pró-labore, honorários são valor fechado.
  const valores = {
    das: { amount: das, base: faturamento, rate: impostos.aliquotaEfetiva ?? null },
    inss: { amount: inss, base: prolabore, rate: 0.11 },
    honorarios: { amount: honorarios, base: null, rate: null },
  }

  const obligations = []
  for (const kind of KINDS) {
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
    obligations.push(row)
  }

  // Rateio. Reapurar substitui o rateio anterior — sem isso rodar duas vezes
  // duplicaria tudo (fiscal_allocations não tem UNIQUE que segure).
  const ids = obligations.map((o) => o.id)
  await sql`DELETE FROM fiscal_allocations WHERE obligation_id = ANY(${ids})`

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

  return res.status(200).json({
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
      return res.status(200).json({ data: obligations })
    }

    if (req.method === 'POST') {
      if (req.query.action === 'apurar') return apurar(sql, req, res)
      return res.status(400).json({ error: 'action inválida. Use ?action=apurar' })
    }

    if (req.method === 'PATCH') {
      if (req.query.action === 'lancar-guia') return lancarGuia(sql, req, res)
      return res.status(400).json({ error: 'action inválida. Use ?action=lancar-guia' })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    console.error('fiscal-obligations:', error)
    return res.status(500).json({ error: error.message })
  }
}
