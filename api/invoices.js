import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import { desfazerAbatimentoFiscal } from '../lib/fiscal-unlink.js'
import { contratoComRegra, contratoDosApontamentos } from '../lib/financial-rule.js'
import { apurarCompetencia } from './fiscal-obligations.js'

// Competência fiscal de uma fatura: a data de EMISSÃO da nota, não o mês de referência.
// Mesmo critério de chaveCompetencia() em api/fiscal-obligations.js — uma NF de dezembro
// emitida em janeiro é tributada em janeiro.
function competenciaDaFatura(inv) {
  if (inv.emission_date) {
    const d = new Date(inv.emission_date)
    return { m: d.getUTCMonth() + 1, y: d.getUTCFullYear() }
  }
  return { m: Number(inv.month), y: Number(inv.year) }
}

const round = (n) => parseFloat((Number(n) || 0).toFixed(2))

// Deriva mês/ano de caixa a partir da data prevista de recebimento (payment_date).
// Sem data, cai na competência (mês/ano do faturamento).
function paymentPeriod(payment_date, fbMonth, fbYear) {
  if (payment_date) {
    const [y, m] = String(payment_date).slice(0, 10).split('-').map(Number)
    if (y && m) return { pmonth: m, pyear: y }
  }
  return { pmonth: fbMonth, pyear: fbYear }
}

// Resolve o % usado na fatura: usa o valor enviado pelo frontend se presente,
// senão cai no valor cadastrado (fallback)
function resolvePct(used, fallback) {
  if (used !== undefined && used !== null && used !== '') return parseFloat(used) || 0
  return parseFloat(fallback) || 0
}

// Split cadastrado. Não usar `|| 50`: um split legítimo de 0% (cliente 100/0)
// é falsy e viraria 50%, pagando Fabrício indevidamente.
function splitPct(value, fallback) {
  const n = parseFloat(value)
  return isNaN(n) ? fallback : n
}

// CONTRATO FIXO (billing_type = 'contract' / 'mensal')
export function calcContrato(contract, opts = {}) {
  const base = parseFloat(contract.contract_value) || 0
  const victor_fixo = parseFloat(contract.victor_fixed) || 0
  const victor_pct = splitPct(contract.remainder_victor_pct, 50)
  const fab_pct = splitPct(contract.remainder_fabricio_pct, 50)
  const taxClient = resolvePct(opts.tax_client_percent_used, contract.tax_client_percent)
  const taxReal = resolvePct(opts.tax_percentage_used, contract.has_tax ? contract.tax_percentage : 0)

  const nf = taxClient > 0 && taxClient < 100 ? base / (1 - taxClient / 100) : base
  const diff_nf = Math.max(nf - base, 0)              // 100% Victor
  const restante = Math.max(base - victor_fixo, 0)
  const victor_lucro = restante * (victor_pct / 100)
  const fabricio = restante * (fab_pct / 100)
  const victor_total = victor_fixo + victor_lucro + diff_nf
  const tax_amount = nf * (taxReal / 100)             // imposto real pago por Victor (sobre a NF)

  return {
    invoice_value: round(nf),
    contract_value: round(base),
    tax_amount: round(tax_amount),
    tax_percentage_used: taxReal,
    tax_client_percent_used: taxClient,
    victor_service: round(victor_fixo),
    victor_profit: round(victor_lucro),
    victor_tax_diff: round(diff_nf),
    victor_total: round(victor_total),
    fabricio_total: round(fabricio),
  }
}

// CONTRATO POR HORA (billing_type = 'hora' / 'agenda')
export function calcAgenda(entries, rule, opts = {}) {
  const total_hours = entries.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0)
  const valor_hora = parseFloat(rule.hourly_rate) || 0
  const victor_fixo_hora = parseFloat(rule.victor_fixed_per_hour) || 0
  const victor_pct = splitPct(rule.remainder_victor_pct, 50)
  const fab_pct = splitPct(rule.remainder_fabricio_pct, 50)
  const taxReal = resolvePct(opts.tax_percentage_used, rule.has_tax ? rule.tax_percentage : 0)
  const taxClient = resolvePct(opts.tax_client_percent_used, 0)

  // Serviço × deslocamento. gross_value já soma serviço + deslocamento faturado (0 quando
  // 'nao_cobrado', com a taxa de deslocamento correta). Deslocamento = gross - serviço.
  const service_value = entries.reduce((s, e) => s + (parseFloat(e.hours) || 0) * valor_hora, 0)
  const bruto = entries.reduce((s, e) => {
    const g = parseFloat(e.gross_value)
    return s + (isNaN(g) ? (parseFloat(e.hours) || 0) * valor_hora : g)
  }, 0)
  const displacement_value = Math.max(bruto - service_value, 0)

  const tax = bruto * (taxReal / 100)                // imposto real sobre a NF cheia
  const net = bruto - tax                            // líquido total
  // Deslocamento: 100% Victor, FORA do split — mas com imposto proporcional deduzido.
  const displacement_net = displacement_value * (1 - taxReal / 100)
  // Fixo do Victor sobre a hora BRUTA, limitado ao líquido disponível. Sem o teto,
  // quando o fixo iguala o valor/hora (fixo 85 x hora 85) Victor levaria os 850
  // cheios de um bruto do qual o imposto já saiu, deixando-o sem lastro.
  const pool_servico = Math.max(net - displacement_net, 0)
  const victor_servico = Math.min(total_hours * victor_fixo_hora, pool_servico)
  // Só o serviço líquido (net - fixo - deslocamento líquido) é dividido Victor/Fabrício.
  const restante = Math.max(net - victor_servico - displacement_net, 0)
  const victor_lucro = restante * (victor_pct / 100)
  const fabricio = restante * (fab_pct / 100)
  const nf = taxClient > 0 && taxClient < 100 ? bruto / (1 - taxClient / 100) : bruto
  const diff_nf = Math.max(nf - bruto, 0)            // 100% Victor (gross-up do imposto do cliente)
  const victor_total = victor_servico + displacement_net + victor_lucro + diff_nf

  return {
    invoice_value: round(nf),
    contract_value: round(bruto),
    tax_amount: round(tax),
    tax_percentage_used: taxReal,
    tax_client_percent_used: taxClient,
    victor_service: round(victor_servico),
    // Deslocamento líquido (100% Victor) somado ao lucro para os componentes fecharem no total.
    victor_profit: round(victor_lucro + displacement_net),
    victor_tax_diff: round(diff_nf),
    victor_total: round(victor_total),
    fabricio_total: round(fabricio),
    displacement_value: round(displacement_value),
    displacement_net: round(displacement_net),
    total_hours,
  }
}

// CONTRATO POR PROJETO (billing_type = 'por_projeto') — fatura UMA parcela.
// Imposto sempre primeiro; depois um valor prioritário do Victor sai do líquido
// e só o restante é dividido por %Victor / %Fabrício.
//   percent_victor → prioridade = líquido × projeto_victor_pct
//   fixed_victor   → prioridade = projeto_victor_fixed
//   direct_split   → sem prioridade, divide o líquido inteiro
//   expenses       → prioridade = projeto_expenses (reembolso 100% Victor)
export function calcProjeto(contract, installment, opts = {}) {
  const base = parseFloat(installment.value) || 0
  const victor_pct = splitPct(contract.remainder_victor_pct, 50)
  const fab_pct = splitPct(contract.remainder_fabricio_pct, 50)
  const taxClient = resolvePct(opts.tax_client_percent_used, contract.tax_client_percent)
  const taxReal = resolvePct(opts.tax_percentage_used, contract.has_tax ? contract.tax_percentage : 0)

  const tax_amount = base * (taxReal / 100)   // imposto sempre primeiro
  const net = base - tax_amount

  const mode = contract.projeto_split_mode || 'direct_split'
  let priority = 0
  if (mode === 'percent_victor') priority = net * ((parseFloat(contract.projeto_victor_pct) || 0) / 100)
  else if (mode === 'fixed_victor') priority = parseFloat(contract.projeto_victor_fixed) || 0
  else if (mode === 'expenses') priority = parseFloat(contract.projeto_expenses) || 0
  priority = Math.min(Math.max(priority, 0), net)   // nunca excede o líquido

  const restante = Math.max(net - priority, 0)
  const victor_lucro = restante * (victor_pct / 100)
  const fabricio = restante * (fab_pct / 100)

  const nf = taxClient > 0 && taxClient < 100 ? base / (1 - taxClient / 100) : base
  const diff_nf = Math.max(nf - base, 0)            // gross-up do imposto do cliente → 100% Victor
  const victor_total = priority + victor_lucro + diff_nf

  return {
    invoice_value: round(nf),
    contract_value: round(base),
    tax_amount: round(tax_amount),
    tax_percentage_used: taxReal,
    tax_client_percent_used: taxClient,
    victor_service: round(priority),
    victor_profit: round(victor_lucro),
    victor_tax_diff: round(diff_nf),
    victor_total: round(victor_total),
    fabricio_total: round(fabricio),
    projeto_split_mode: mode,
    net_value: round(net),
  }
}

// A fatura emite nota? Herdado do contrato no momento da emissão e CONGELADO na
// fatura: `require_nf` é dado de competência, e desligar a NF de um contrato hoje não
// pode reescrever notas já emitidas (o mês delas já foi apurado com elas dentro).
// Fatura sem contrato (modelo legado) segue exigindo NF — o default seguro.
// Quem lê isto é api/fiscal-obligations.js: fatura com `false` fica fora de DAS, INSS,
// Fator R, RBT12 e rateio, mas continua em "A Receber" e nos payables normalmente.
async function requireNfDoContrato(sql, contract, contract_id) {
  if (contract) return contract.require_nf !== false
  if (!contract_id) return true
  const rows = await sql`SELECT require_nf FROM contracts WHERE id = ${contract_id} LIMIT 1`
  return rows[0]?.require_nf !== false
}

// Tomador da NF, herdado do contrato e CONGELADO na fatura — pela mesma razão de
// `require_nf` logo acima: trocar o tomador do contrato hoje não pode reescrever
// para quem uma nota já emitida foi endereçada.
//
// NULL significa "emitir para o próprio `client_id` da fatura", inclusive quando o
// contrato aponta para ele — um jeito só de escrever a mesma coisa. Quem lê isto é a
// emissão (api/nfse-emit.js, api/nfse-substituir.js e lib/nfse-setup-check.js),
// sempre por COALESCE(i.invoice_client_id, i.client_id).
//
// ⚠️ Muda SÓ o tomador do documento fiscal. O `client_id` da fatura segue sendo o
// dono do serviço: rateio Victor/Fabrício, regra financeira, recebível, payables e
// apuração continuam todos por ele.
async function tomadorDoContrato(sql, contrato, contract_id, client_id) {
  let alvo = contrato ? contrato.invoice_client_id : null
  if (!contrato && contract_id) {
    const rows = await sql`SELECT invoice_client_id FROM contracts WHERE id = ${contract_id} LIMIT 1`
    alvo = rows[0]?.invoice_client_id ?? null
  }
  if (!alvo) return null
  return Number(alvo) === Number(client_id) ? null : Number(alvo)
}

// Carrega contrato + parcela para uma fatura por projeto. Retorna { error } se algo falhar.
async function loadProjeto(sql, contract_id, installment_id) {
  if (!installment_id) return { error: 'Selecione a parcela a faturar.' }
  const inst = await sql`SELECT * FROM project_installments WHERE id = ${installment_id} LIMIT 1`
  if (!inst.length) return { error: 'Parcela não encontrada' }
  const contracts = await sql`SELECT * FROM contracts WHERE id = ${contract_id || inst[0].contract_id} LIMIT 1`
  if (!contracts.length) return { error: 'Contrato não encontrado' }
  return { installment: inst[0], contract: contracts[0] }
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  const sql = neon(process.env.DATABASE_URL)

  if (req.method === 'GET') {
    const { company_id, client_id, year } = req.query
    const invoices = client_id
      ? await sql`SELECT i.*, c.name as client_name, ct.name as contract_name FROM invoices i LEFT JOIN clients c ON c.id = i.client_id LEFT JOIN contracts ct ON ct.id = i.contract_id WHERE i.company_id = ${company_id} AND i.client_id = ${client_id} ORDER BY i.year DESC, i.month DESC`
      : await sql`SELECT i.*, c.name as client_name, ct.name as contract_name FROM invoices i LEFT JOIN clients c ON c.id = i.client_id LEFT JOIN contracts ct ON ct.id = i.contract_id WHERE i.company_id = ${company_id} AND i.year = ${year||new Date().getFullYear()} ORDER BY i.month DESC, c.name ASC`
    return res.status(200).json({ invoices })
  }

  if (req.method === 'POST') {
    const { company_id, client_id, contract_id, month, year, invoice_number, billing_type, time_entry_ids, installment_id, notes, tax_percentage_used, tax_client_percent_used, payment_date, emission_date } = req.body
    try {
      let calc
      let contrato = null
      // Contrato efetivo da fatura. Na agenda pode não vir do modal (o seletor não é
      // obrigatório) e ser derivado dos apontamentos — daí ser `let`. O valor final é
      // o que vai para `invoices.contract_id`, o que impede novas faturas órfãs como
      // as 11 antigas que ficaram sem nenhum contrato registrado.
      let contratoId = contract_id || null
      if (billing_type === 'projeto') {
        const loaded = await loadProjeto(sql, contract_id, installment_id)
        if (loaded.error) return res.status(400).json({ error: loaded.error })
        if (loaded.installment.invoice_id) {
          return res.status(400).json({ error: 'Esta parcela já foi faturada.' })
        }
        contrato = loaded.contract
        contratoId = loaded.contract.id
        calc = calcProjeto(loaded.contract, loaded.installment, { tax_percentage_used, tax_client_percent_used })
      } else if (billing_type === 'contract') {
        const contracts = await sql`SELECT * FROM contracts WHERE id = ${contract_id} LIMIT 1`
        if (!contracts.length) return res.status(404).json({ error: 'Contrato não encontrado' })
        contrato = contracts[0]
        calc = calcContrato(contracts[0], { tax_percentage_used, tax_client_percent_used })
      } else {
        // A regra sai do contrato, nunca do cliente — ver lib/financial-rule.js.
        const entries = await sql`SELECT * FROM time_entries WHERE id = ANY(${time_entry_ids}::int[])`
        const alvo = contratoId ? { contract_id: contratoId } : contratoDosApontamentos(entries)
        if (alvo.error) return res.status(422).json({ error: alvo.error })
        const resolvido = await contratoComRegra(sql, alvo.contract_id, { company_id })
        if (resolvido.error) return res.status(422).json({ error: resolvido.error })
        contrato = resolvido.contrato
        contratoId = resolvido.contrato.id
        calc = calcAgenda(entries, resolvido.rule, { tax_percentage_used, tax_client_percent_used })
      }

      const require_nf = await requireNfDoContrato(sql, contrato, contratoId)
      const invoiceClientId = await tomadorDoContrato(sql, contrato, contratoId, client_id)
      const { pmonth, pyear } = paymentPeriod(payment_date, month, year)

      // Os ids são reservados antes das escritas. Motivo: a fatura precisa do
      // receivable_id e a descrição do recebível precisa do id da fatura —
      // dependência circular que um array de escritas não resolve. Conhecendo
      // os dois ids de antemão, o UPDATE de ligação some e as escritas cabem
      // numa transação única (antes eram 4 statements soltos: falhar no meio
      // deixava fatura órfã sem recebível).
      const seq = await sql`
        SELECT nextval(pg_get_serial_sequence('invoices','id')) AS inv_id,
               nextval(pg_get_serial_sequence('receivables','id')) AS rec_id`
      const invId = Number(seq[0].inv_id)
      const recId = Number(seq[0].rec_id)
      const descricao = `Fatura ${invoice_number || '#' + invId} - ${month}/${year}`

      const writes = [
        sql`
          INSERT INTO invoices (id, company_id, client_id, contract_id, month, year, invoice_number, invoice_value, contract_value, tax_amount, victor_service, victor_profit, victor_tax_diff, victor_total, fabricio_total, billing_type, time_entry_ids, notes, payment_date, emission_date, receivable_id, require_nf, invoice_client_id)
          VALUES (${invId}, ${company_id}, ${client_id}, ${contratoId}, ${month}, ${year}, ${invoice_number||null}, ${calc.invoice_value}, ${calc.contract_value}, ${calc.tax_amount}, ${calc.victor_service}, ${calc.victor_profit}, ${calc.victor_tax_diff}, ${calc.victor_total}, ${calc.fabricio_total}, ${billing_type||'contract'}, ${time_entry_ids||null}, ${notes||null}, ${payment_date||null}, ${emission_date||null}, ${recId}, ${require_nf}, ${invoiceClientId})
          RETURNING *
        `,
        sql`
          INSERT INTO receivables (id, company_id, client_id, month, year, description, amount, notes, origin, payment_month, payment_year)
          VALUES (${recId}, ${company_id}, ${client_id}, ${month}, ${year}, ${descricao}, ${calc.invoice_value}, ${notes||null}, 'faturamento', ${pmonth}, ${pyear})
          RETURNING *
        `,
      ]

      if (billing_type === 'projeto') {
        writes.push(sql`UPDATE project_installments SET invoice_id = ${invId}, status = 'faturado' WHERE id = ${installment_id}`)
      }

      const results = await sql.transaction(writes)

      // A NF entrou: a competência dela precisa ser reapurada com as tabelas reais
      // (DAS pela alíquota efetiva do Simples, INSS sobre o pró-labore, honorários),
      // e as linhas fiscais da aba Pagar Victor, ressincronizadas.
      //
      // A apuração é do MÊS INTEIRO, não desta nota. É a única forma correta: o DAS
      // depende do faturamento do mês e da RBT12, o INSS tem piso mensal e os honorários
      // são um valor fechado por mês. Calcular por NF faria duas notas no mesmo mês
      // gerarem dois pisos de INSS e dois honorários, e deixaria o DAS da primeira
      // desatualizado assim que a segunda fosse emitida.
      //
      // Best-effort de propósito: faturar não pode falhar porque a apuração recusou.
      // O caso normal de recusa é 409 (mês já distribuído nos payables do Victor), que
      // exige estorno consciente — a fatura fica gravada e o aviso volta na resposta.
      const comp = competenciaDaFatura(results[0][0])
      let apuracao = null
      try {
        const r = await apurarCompetencia(sql, company_id, comp.m, comp.y)
        apuracao = r.status === 200
          ? { ok: true, competencia: comp, ...r.payload.apuracao, linhas_fiscais: r.payload.linhas_fiscais }
          : { ok: false, competencia: comp, error: r.payload?.error || 'Não foi possível reapurar a competência.' }
      } catch (e) {
        apuracao = { ok: false, competencia: comp, error: e.message }
      }

      return res.status(201).json({ invoice: results[0][0], receivable: results[1][0], breakdown: calc, apuracao })
    } catch (error) {
      return res.status(500).json({ error: error.message })
    }
  }

  if (req.method === 'PATCH') {
    const { id, status, paid_at } = req.body
    try {
      const invoices = await sql`SELECT * FROM invoices WHERE id = ${id} LIMIT 1`
      if (!invoices.length) return res.status(404).json({ error: 'Fatura não encontrada' })
      const inv = invoices[0]

      if (status === 'estorno') {
        if (inv.status !== 'recebido') {
          return res.status(400).json({ error: 'Apenas faturas recebidas podem ser estornadas.' })
        }
        // Bloquear estorno se algum payable gerado já foi pago
        const fabPago = await sql`SELECT id FROM payables_fabricio WHERE invoice_id = ${id} AND status = 'pago' LIMIT 1`
        const vicPago = await sql`SELECT id FROM payables_victor WHERE invoice_id = ${id} AND status = 'pago' LIMIT 1`
        if (fabPago.length || vicPago.length) {
          return res.status(400).json({ error: 'Não é possível estornar. Os lançamentos de Pagar Fabrício e/ou Pagar Victor já foram pagos. Desfaça os pagamentos primeiro.' })
        }
        // Reverter receivable
        if (inv.receivable_id) {
          await sql`UPDATE receivables SET status='pendente', paid_at=NULL, paid_amount=NULL WHERE id=${inv.receivable_id}`
        }
        // Desfaz o abatimento fiscal antes de apagar os payables. A trava acima só
        // recusa payable com status 'pago'; um payable PARCIALMENTE consumido pela
        // distribuição passava direto e a obrigação ficava quitada sem lastro.
        const vicIds = await sql`SELECT id FROM payables_victor WHERE invoice_id = ${id}`
        const fabIds = await sql`SELECT id FROM payables_fabricio WHERE invoice_id = ${id}`
        await desfazerAbatimentoFiscal(sql, vicIds.map(r=>r.id), { ignorarPayables: vicIds.map(r=>r.id) })
        // Pagamentos primeiro: payable_payments.payable_id NÃO tem FK, então apagar o
        // payable direto deixava os pagamentos órfãos, invisíveis e insomáveis.
        if (vicIds.length) await sql`DELETE FROM payable_payments WHERE payable_type='victor' AND payable_id = ANY(${vicIds.map(r=>r.id)})`
        if (fabIds.length) await sql`DELETE FROM payable_payments WHERE payable_type='fabricio' AND payable_id = ANY(${fabIds.map(r=>r.id)})`
        // Remover payables gerados por esta fatura
        await sql`DELETE FROM payables_fabricio WHERE invoice_id = ${id}`
        await sql`DELETE FROM payables_victor WHERE invoice_id = ${id}`
        // Liberar a parcela do projeto para ser faturada de novo
        await sql`UPDATE project_installments SET invoice_id = NULL, status = 'pendente' WHERE invoice_id = ${id}`
        // Reverter status da fatura, com o rastro do estorno preservado em notes.
        await sql`
          UPDATE invoices SET
            status = 'pendente',
            notes = COALESCE(NULLIF(notes,'') || ' | ', '') || 'Estornado em ' ||
                    to_char(now() AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')
          WHERE id = ${id}`
        return res.status(200).json({ success: true, action: 'estorno' })
      }

      await sql`UPDATE invoices SET status = ${status} WHERE id = ${id}`

      if (status === 'recebido' && inv.receivable_id) {
        await sql`UPDATE receivables SET status='pago', paid_at=${paid_at}, paid_amount=${inv.invoice_value} WHERE id=${inv.receivable_id}`

        const clients = await sql`SELECT name FROM clients WHERE id = ${inv.client_id} LIMIT 1`
        const client_name = clients[0]?.name || 'Cliente'
        const desc = `${client_name} - ${inv.month}/${inv.year}`
        // Mês de caixa = data real do recebimento (paid_at); depois payment_date da fatura; por fim competência.
        const { pmonth, pyear } = paymentPeriod(paid_at || inv.payment_date, inv.month, inv.year)

        await sql`INSERT INTO payables_fabricio (company_id, client_id, month, year, description, amount, origin, invoice_id, payment_month, payment_year) VALUES (${inv.company_id}, ${inv.client_id}, ${inv.month}, ${inv.year}, ${desc}, ${inv.fabricio_total}, 'faturamento', ${inv.id}, ${pmonth}, ${pyear})`

        await sql`INSERT INTO payables_victor (company_id, client_id, month, year, description, service_amount, profit_amount, total_amount, origin, invoice_id, payment_month, payment_year) VALUES (${inv.company_id}, ${inv.client_id}, ${inv.month}, ${inv.year}, ${desc}, ${inv.victor_service}, ${parseFloat(inv.victor_profit)+parseFloat(inv.victor_tax_diff)}, ${inv.victor_total}, 'faturamento', ${inv.id}, ${pmonth}, ${pyear})`
      }

      return res.status(200).json({ success: true })
    } catch (error) {
      return res.status(500).json({ error: error.message })
    }
  }

  if (req.method === 'PUT') {
    // `client_id` saiu do destructure: só existia para buscar a regra pelo cliente.
    // A fatura não pode trocar de cliente numa edição de qualquer forma.
    const { id, invoice_number, notes, billing_type, time_entry_ids, installment_id, contract_id, tax_percentage_used, tax_client_percent_used, payment_date, emission_date } = req.body
    try {
      const invoices = await sql`SELECT * FROM invoices WHERE id = ${id} LIMIT 1`
      if (!invoices.length) return res.status(404).json({ error: 'Fatura não encontrada' })
      const inv = invoices[0]

      if (inv.status === 'recebido') {
        return res.status(400).json({ error: 'Não é possível editar uma fatura já recebida. Estorne primeiro.' })
      }

      let calc
      let contrato = null
      let contratoId = contract_id || inv.contract_id || null
      if (billing_type === 'projeto') {
        // Sem installment_id no body, recalcula em cima da parcela já vinculada à fatura.
        let instId = installment_id
        if (!instId) {
          const linked = await sql`SELECT id FROM project_installments WHERE invoice_id = ${id} ORDER BY id ASC LIMIT 1`
          instId = linked[0]?.id
        }
        const loaded = await loadProjeto(sql, contratoId, instId)
        if (loaded.error) return res.status(400).json({ error: loaded.error })
        contrato = loaded.contract
        contratoId = loaded.contract.id
        calc = calcProjeto(loaded.contract, loaded.installment, { tax_percentage_used, tax_client_percent_used })
      } else if (billing_type === 'contract') {
        const contracts = await sql`SELECT * FROM contracts WHERE id = ${contratoId} LIMIT 1`
        if (!contracts.length) return res.status(404).json({ error: 'Contrato não encontrado' })
        contrato = contracts[0]
        calc = calcContrato(contracts[0], { tax_percentage_used, tax_client_percent_used })
      } else {
        // Mesma resolução do POST: a regra sai do contrato, nunca do cliente.
        const ids = time_entry_ids || inv.time_entry_ids
        const entries = await sql`SELECT * FROM time_entries WHERE id = ANY(${ids}::int[])`
        const alvo = contratoId ? { contract_id: contratoId } : contratoDosApontamentos(entries)
        if (alvo.error) return res.status(422).json({ error: alvo.error })
        const resolvido = await contratoComRegra(sql, alvo.contract_id, { company_id: inv.company_id })
        if (resolvido.error) return res.status(422).json({ error: resolvido.error })
        contrato = resolvido.contrato
        contratoId = resolvido.contrato.id
        calc = calcAgenda(entries, resolvido.rule, { tax_percentage_used, tax_client_percent_used })
      }

      // payment_date: usa o enviado; se a chave não veio no body, mantém o atual.
      const newPaymentDate = payment_date !== undefined ? (payment_date || null) : inv.payment_date
      // emission_date: mesma regra — só sobrescreve se a chave veio no body.
      const newEmissionDate = emission_date !== undefined ? (emission_date || null) : inv.emission_date
      const { pmonth, pyear } = paymentPeriod(newPaymentDate, inv.month, inv.year)
      // A fatura só é editável enquanto pendente, então reler o contrato aqui é a
      // última chance de a nota pegar a regra de NF vigente antes de virar histórico.
      const require_nf = await requireNfDoContrato(sql, contrato, contratoId)
      const invoiceClientId = await tomadorDoContrato(sql, contrato, contratoId, inv.client_id)

      const updated = await sql`
        UPDATE invoices SET
          invoice_number = ${invoice_number || null},
          require_nf = ${require_nf},
          invoice_client_id = ${invoiceClientId},
          -- Persiste o contrato resolvido: se ele veio dos apontamentos, deixar a
          -- coluna nula faria a próxima edição derivá-lo de novo do zero.
          contract_id = ${contratoId},
          invoice_value = ${calc.invoice_value},
          contract_value = ${calc.contract_value},
          tax_amount = ${calc.tax_amount},
          victor_service = ${calc.victor_service},
          victor_profit = ${calc.victor_profit},
          victor_tax_diff = ${calc.victor_tax_diff},
          victor_total = ${calc.victor_total},
          fabricio_total = ${calc.fabricio_total},
          notes = ${notes || null},
          payment_date = ${newPaymentDate},
          emission_date = ${newEmissionDate}
        WHERE id = ${id}
        RETURNING *
      `

      if (inv.receivable_id) {
        await sql`UPDATE receivables SET amount = ${calc.invoice_value}, description = ${`Fatura ${invoice_number || '#'+id} - ${inv.month}/${inv.year}`}, payment_month = ${pmonth}, payment_year = ${pyear} WHERE id = ${inv.receivable_id}`
      }

      return res.status(200).json({ invoice: updated[0], breakdown: calc })
    } catch (error) {
      return res.status(500).json({ error: error.message })
    }
  }

  if (req.method === 'DELETE') {
    const { id } = req.body
    try {
      const invoices = await sql`SELECT * FROM invoices WHERE id = ${id} LIMIT 1`
      if (!invoices.length) return res.status(404).json({ error: 'Fatura não encontrada' })
      const inv = invoices[0]

      if (inv.status === 'recebido') {
        return res.status(400).json({ error: 'Não é possível excluir uma fatura já recebida. Estorne primeiro.' })
      }

      if (inv.receivable_id) {
        await sql`DELETE FROM receivables WHERE id = ${inv.receivable_id}`
      }

      await sql`DELETE FROM payables_fabricio WHERE invoice_id = ${id}`
      await sql`DELETE FROM payables_victor WHERE invoice_id = ${id}`
      // Libera a parcela antes de apagar a fatura, senão ela fica presa em 'faturado'.
      await sql`UPDATE project_installments SET invoice_id = NULL, status = 'pendente' WHERE invoice_id = ${id}`
      await sql`DELETE FROM invoices WHERE id = ${id}`

      return res.status(200).json({ success: true })
    } catch (error) {
      return res.status(500).json({ error: error.message })
    }
  }

  res.status(405).json({ error: 'Method not allowed' })
}
