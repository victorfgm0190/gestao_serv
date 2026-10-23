import { neon } from '@neondatabase/serverless'
import { requireAdmin } from '../lib/admin-auth.js'
import { recalcularDia } from './time-entries.js'

// OPERAÇÕES ADMINISTRATIVAS EM MASSA.
//
// Protegido por requireAdmin (Bearer $ADMIN_SECRET) — nunca por requireAuth. Isto aqui
// desfaz meses inteiros de faturamento; não pode estar a um clique de distância de uma
// sessão comum logada na tela.
//
// POST ?action=estornar-periodo  { company_id, year, month_from, month_to, dry_run }
// POST ?action=migrate-billing-type   (idempotente — tipo de cobrança da regra financeira)
//
// ── Por que estornar e não marcar status='estornado' ────────────────────────────────
// Nenhuma destas tabelas tem 'estornado' no vocabulário de status:
//   invoices            pendente | recebido
//   receivables         pendente | pago
//   payables_*          pendente | parcial | pago
//   fiscal_obligations  previsto | apurado | parcial | pago
// Gravar um valor fora dessa lista não "arquiva" o registro: ele some dos filtros de
// todas as telas, escapa do CASE de recalcularObrigacao() e de statusFor(), e sai do
// `status IN ('pendente','parcial')` de candidatosDisponiveis() — a cascata de consumo
// passaria a ignorá-lo em silêncio. E sobrescrever `status`/`notes` sem guardar o valor
// anterior é irreversível, o oposto de auditoria.
//
// O estorno REAL já existe no sistema (invoices PATCH estorno, receivables PATCH
// estorno, fiscal ?action=estornar-distribuicao). Esta rota só aplica essa mesma
// cascata a um período inteiro, na ordem inversa da criação. O resultado é o estado
// anterior ao faturamento: fatura e recebível voltam a `pendente` e podem ser
// refaturados ou excluídos pela tela normalmente.

const num = (v) => parseFloat(v) || 0

// Só o que o faturamento gerou. Payables lançados à mão (origin IS NULL) são dado do
// usuário, não subproduto da fatura — apagá-los junto seria perda silenciosa.
const GERADO_PELO_FATURAMENTO = 'faturamento'

async function estornarPeriodo(sql, req, res) {
  const { company_id, year, month_from, month_to, dry_run = true } = req.body || {}

  // Sem default em operação destrutiva: um body vazio não pode significar
  // "estorne a empresa inteira". Todos os limites vêm explícitos de quem chama.
  if (!company_id || !year || !month_from || !month_to) {
    return res.status(400).json({
      error: 'company_id, year, month_from e month_to são obrigatórios (sem valores padrão em operação destrutiva).',
      exemplo: { company_id: 1, year: 2026, month_from: 1, month_to: 4, dry_run: true },
    })
  }
  const cid = Number(company_id)
  const y = Number(year)
  const mf = Number(month_from)
  const mt = Number(month_to)
  if (!(mf >= 1 && mf <= 12 && mt >= 1 && mt <= 12 && mf <= mt)) {
    return res.status(400).json({ error: 'month_from/month_to devem estar entre 1 e 12, com month_from <= month_to' })
  }

  // ── Levantamento (sempre roda, inclusive no dry-run) ──────────────────────────────
  // Competência (year/month), a mesma chave que o faturamento usa. NÃO payment_month:
  // o alvo é "as faturas de jan-abr", não "o que caiu no caixa em jan-abr".
  const faturas = await sql`
    SELECT id, client_id, month, year, invoice_number, invoice_value, status, receivable_id
    FROM invoices
    WHERE company_id = ${cid} AND year = ${y} AND month BETWEEN ${mf} AND ${mt}
    ORDER BY month, id`
  const invIds = faturas.map((f) => f.id)

  const pvic = await sql`
    SELECT id, invoice_id, origin, total_amount, paid_amount, status FROM payables_victor
    WHERE company_id = ${cid} AND year = ${y} AND month BETWEEN ${mf} AND ${mt}`
  const pfab = await sql`
    SELECT id, invoice_id, origin, amount, paid_amount, status FROM payables_fabricio
    WHERE company_id = ${cid} AND year = ${y} AND month BETWEEN ${mf} AND ${mt}`

  const pvGerados = pvic.filter((p) => p.origin === GERADO_PELO_FATURAMENTO)
  const pfGerados = pfab.filter((p) => p.origin === GERADO_PELO_FATURAMENTO)
  const pvManuais = pvic.filter((p) => p.origin !== GERADO_PELO_FATURAMENTO)
  const pfManuais = pfab.filter((p) => p.origin !== GERADO_PELO_FATURAMENTO)

  const recIds = faturas.map((f) => f.receivable_id).filter(Boolean)
  const obrigacoes = await sql`
    SELECT id, kind, month, year, status, paid_amount FROM fiscal_obligations
    WHERE company_id = ${cid} AND year = ${y} AND month BETWEEN ${mf} AND ${mt}`
  const obIds = obrigacoes.map((o) => o.id)

  // Pagamentos que serão apagados junto — é o dinheiro que este estorno "desfaz".
  const pagVic = pvGerados.length
    ? await sql`SELECT id, payable_id, amount FROM payable_payments
                WHERE payable_type = 'victor' AND payable_id = ANY(${pvGerados.map((p) => p.id)})`
    : []
  const pagFab = pfGerados.length
    ? await sql`SELECT id, payable_id, amount FROM payable_payments
                WHERE payable_type = 'fabricio' AND payable_id = ANY(${pfGerados.map((p) => p.id)})`
    : []
  const pagFiscal = obIds.length
    ? await sql`SELECT id, obligation_id, amount, method FROM fiscal_payments WHERE obligation_id = ANY(${obIds})`
    : []
  const alocacoes = obIds.length
    ? await sql`SELECT id, obligation_id, payable_victor_id, payable_payment_id
                FROM fiscal_allocations WHERE obligation_id = ANY(${obIds})`
    : []

  // Alocações que consumiram payables FORA da janela: estas apontam para saldos de
  // outros meses que também vão ser destravados. Vale avisar, não bloquear.
  const idsPvJanela = new Set(pvic.map((p) => p.id))
  const consumoExterno = [...new Set(
    alocacoes.filter((a) => a.payable_victor_id && !idsPvJanela.has(a.payable_victor_id))
      .map((a) => a.payable_victor_id),
  )]

  const resumo = {
    periodo: { company_id: cid, year: y, month_from: mf, month_to: mt },
    invoices: { total: faturas.length, recebidas: faturas.filter((f) => f.status === 'recebido').length },
    receivables: recIds.length,
    payables_victor: { do_faturamento: pvGerados.length, manuais_preservados: pvManuais.length },
    payables_fabricio: { do_faturamento: pfGerados.length, manuais_preservados: pfManuais.length },
    fiscal_obligations: obrigacoes.length,
    fiscal_allocations: alocacoes.length,
    pagamentos_apagados: {
      payable_payments_victor: pagVic.length,
      payable_payments_fabricio: pagFab.length,
      fiscal_payments: pagFiscal.length,
      valor_total: Number((
        [...pagVic, ...pagFab, ...pagFiscal].reduce((s, p) => s + num(p.amount), 0)
      ).toFixed(2)),
    },
    payables_de_outros_meses_destravados: consumoExterno.length,
  }

  if (dry_run) {
    return res.status(200).json({
      success: true,
      dry_run: true,
      mensagem: 'Simulação — nada foi alterado. Reenvie com dry_run: false para executar.',
      seria_estornado: resumo,
      faturas: faturas.map((f) => ({
        id: f.id, mes: `${f.month}/${f.year}`, cliente: f.client_id,
        nf: f.invoice_number, valor: num(f.invoice_value), status: f.status,
      })),
    })
  }

  if (!faturas.length && !obrigacoes.length) {
    return res.status(404).json({ error: 'Nada encontrado neste período.', periodo: resumo.periodo })
  }

  // ── Execução, na ordem inversa da criação ────────────────────────────────────────
  // Uma etapa por vez, cada uma derivando do estado real em vez de subtrair valores.
  // A ordem importa: pagamentos antes dos payables (FK), fiscal antes dos payables
  // (as alocações apontam para eles), payables antes dos recebíveis e das faturas.

  // 1. Fiscal. O ON DELETE CASCADE de fiscal_obligations leva fiscal_payments e
  //    fiscal_allocations junto — inclusive as linhas 'consumo_payable', que são o
  //    registro do abatimento. Os payable_payments criados por aquela distribuição
  //    saem no passo 2, junto com os próprios payables.
  if (obIds.length) {
    await sql`DELETE FROM fiscal_obligations WHERE id = ANY(${obIds})`
  }

  // 2. Payables gerados pelo faturamento + seus pagamentos.
  const pvIds = pvGerados.map((p) => p.id)
  const pfIds = pfGerados.map((p) => p.id)
  if (pvIds.length) {
    await sql`DELETE FROM payable_payments WHERE payable_type = 'victor' AND payable_id = ANY(${pvIds})`
    await sql`DELETE FROM payables_victor WHERE id = ANY(${pvIds})`
  }
  // Linhas fiscais são derivadas de fiscal_obligations, que a etapa 1 acabou de apagar.
  // Não são lançamento manual do Victor (esses têm origin NULL/'manual' e são preservados):
  // sem isto sobrariam linhas de DAS/INSS na aba apontando para uma apuração que não existe mais.
  await sql`
    DELETE FROM payables_victor
    WHERE company_id = ${cid} AND year = ${y} AND month BETWEEN ${mf} AND ${mt}
      AND origin = 'fiscal'`
  if (pfIds.length) {
    await sql`DELETE FROM payable_payments WHERE payable_type = 'fabricio' AND payable_id = ANY(${pfIds})`
    await sql`DELETE FROM payables_fabricio WHERE id = ANY(${pfIds})`
  }

  // 2b. Payables de OUTROS meses que a distribuição fiscal havia consumido: os
  //     pagamentos de abatimento morreram no passo 1 (cascade das alocações não —
  //     payable_payments não tem FK para fiscal_allocations), então aqui o saldo é
  //     recomposto a partir dos pagamentos que sobraram. Nunca por subtração.
  if (consumoExterno.length) {
    const paymentIds = alocacoes
      .filter((a) => a.payable_victor_id && consumoExterno.includes(a.payable_victor_id))
      .map((a) => a.payable_payment_id).filter(Boolean)
    if (paymentIds.length) {
      await sql`DELETE FROM payable_payments WHERE payable_type = 'victor' AND id = ANY(${paymentIds})`
    }
    for (const id of consumoExterno) {
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
  }

  // 3. Recebíveis voltam a pendente — mesmo estado do PATCH estorno de receivables.js.
  if (recIds.length) {
    await sql`
      UPDATE receivables SET status = 'pendente', paid_at = NULL, paid_amount = NULL
      WHERE id = ANY(${recIds})`
  }

  // 4. Faturas voltam a pendente e as parcelas de projeto são liberadas para refaturar.
  if (invIds.length) {
    await sql`UPDATE project_installments SET invoice_id = NULL, status = 'pendente' WHERE invoice_id = ANY(${invIds})`
    await sql`UPDATE invoices SET status = 'pendente' WHERE id = ANY(${invIds})`
  }

  return res.status(200).json({
    success: true,
    dry_run: false,
    estornado: resumo,
    mensagem:
      'Período estornado. Faturas e recebíveis voltaram a "pendente" e podem ser refaturados ou ' +
      'excluídos pela tela. Payables e apuração fiscal do período foram removidos; reapure o mês ' +
      'depois de refaturar.',
  })
}


// Tipo de cobrança da regra financeira: 'hora' | 'diaria' | 'projeto' (lib/billing-type.js).
// Idempotente — rodar de novo não altera nada que já esteja migrado.
async function migrateBillingType(sql, req, res) {
  // 1. Colunas. `billing_type` nasce SEM default para que o passo 2 enxergue quais
  //    linhas ainda não foram mapeadas (um DEFAULT 'hora' preencheria todas na hora,
  //    inclusive a regra por projeto do Bokada).
  await sql`ALTER TABLE financial_rules ADD COLUMN IF NOT EXISTS billing_type VARCHAR(20)`
  await sql`ALTER TABLE financial_rules ADD COLUMN IF NOT EXISTS daily_rate NUMERIC(10,2)`
  await sql`ALTER TABLE financial_rules ADD COLUMN IF NOT EXISTS victor_fixed_daily NUMERIC(10,2)`
  await sql`ALTER TABLE financial_rules ADD COLUMN IF NOT EXISTS monthly_fixed_value NUMERIC(10,2)`
  await sql`ALTER TABLE financial_rules ADD COLUMN IF NOT EXISTS victor_fixed_monthly NUMERIC(10,2)`
  await sql`ALTER TABLE financial_rules ADD COLUMN IF NOT EXISTS is_net_value BOOLEAN DEFAULT false`

  // 2. Mapeia o `tipo` antigo. 'por_projeto' → 'projeto'; o resto era por hora.
  const mapeadas = await sql`
    UPDATE financial_rules
    SET billing_type = CASE WHEN tipo = 'por_projeto' THEN 'projeto' ELSE 'hora' END
    WHERE billing_type IS NULL
    RETURNING id, billing_type`
  await sql`ALTER TABLE financial_rules ALTER COLUMN billing_type SET DEFAULT 'hora'`
  await sql`ALTER TABLE financial_rules ALTER COLUMN billing_type SET NOT NULL`
  await sql`UPDATE financial_rules SET is_net_value = false WHERE is_net_value IS NULL`

  // 3. Regra por projeto: o fixo mensal morava em hourly_rate/victor_fixed_per_hour
  //    (Bokada #12: 1.500 / 800, os mesmos do contrato 10). Copia — não move: as
  //    colunas antigas ficam intactas, nenhum valor existente é perdido.
  const projetos = await sql`
    UPDATE financial_rules SET
      monthly_fixed_value = COALESCE(monthly_fixed_value, hourly_rate),
      victor_fixed_monthly = COALESCE(victor_fixed_monthly, victor_fixed_per_hour)
    WHERE billing_type = 'projeto'
      AND (monthly_fixed_value IS NULL OR victor_fixed_monthly IS NULL)
    RETURNING id, monthly_fixed_value, victor_fixed_monthly`

  // 4. Romaneli (regra 21, contrato 15 já cadastrado como 'dia'): decisão do Victor —
  //    diária de R$ 1.500 LÍQUIDA, imposto 9,2% por fora, 100% Victor. Estava como
  //    "por hora" a R$ 1.500/h. Só converte se ainda estiver por hora (idempotente).
  const romaneli = await sql`
    UPDATE financial_rules fr SET
      billing_type = 'diaria', tipo = 'diaria',
      daily_rate = 1500,
      victor_fixed_daily = COALESCE(fr.victor_fixed_daily, fr.victor_fixed_per_hour),
      is_net_value = true, has_tax = true, tax_percentage = 9.2,
      remainder_victor_pct = 100, remainder_fabricio_pct = 0
    FROM clients c
    WHERE fr.id = 21 AND c.id = fr.client_id AND c.name ILIKE 'ROMANELI%'
      AND fr.billing_type = 'hora'
    RETURNING fr.*`

  // 5. Apontamentos em aberto de regras por diária: valor rateado por data.
  //    Os já faturados ficam como estão (recalcularDia os pula).
  const dias = await sql`
    SELECT DISTINCT te.contract_id, te.entry_date
    FROM time_entries te
    JOIN contracts ct ON ct.id = te.contract_id
    JOIN financial_rules fr ON fr.id = ct.financial_rule_id
    WHERE fr.billing_type = 'diaria'`
  for (const d of dias) await recalcularDia(sql, d.contract_id, d.entry_date)

  const regras = await sql`
    SELECT fr.id, c.name AS cliente, fr.billing_type, fr.tipo, fr.hourly_rate, fr.daily_rate,
           fr.monthly_fixed_value, fr.is_net_value, fr.tax_percentage
    FROM financial_rules fr JOIN clients c ON c.id = fr.client_id ORDER BY fr.id`

  return res.status(200).json({
    success: true,
    mapeadas: mapeadas.length,
    projetos_copiados: projetos,
    romaneli: romaneli[0] || 'já migrada',
    dias_recalculados: dias.length,
    regras,
  })
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return
  const sql = neon(process.env.DATABASE_URL)

  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    if (req.query.action === 'estornar-periodo') return estornarPeriodo(sql, req, res)
    if (req.query.action === 'migrate-billing-type') return migrateBillingType(sql, req, res)
    return res.status(400).json({ error: 'action inválida. Use ?action=estornar-periodo ou ?action=migrate-billing-type' })
  } catch (error) {
    console.error('admin:', error)
    return res.status(500).json({ error: error.message })
  }
}
