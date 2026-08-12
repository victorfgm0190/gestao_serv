import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import { statusFor, remainingBalance } from '../lib/payment-status.js'
import { mesDeCaixaOriginal } from '../lib/cash-month.js'
// Tabela tabulada da aba Pagar Victor — ver o comentário no dispatch do POST.
import { calcularDistribuicao } from './payables-victor.js'
// Apagar um pagamento que quitou guia por abatimento tem de desfazer a quitação junto —
// ver o comentário no DELETE.
import { desfazerAbatimentoFiscal } from '../lib/fiscal-unlink.js'

// Tabela pai e coluna de total por tipo
const TABLES = {
  victor: { table: 'payables_victor', totalCol: 'total_amount' },
  fabricio: { table: 'payables_fabricio', totalCol: 'amount' },
}

// Deriva mês/ano de caixa de uma data (YYYY-MM-DD). Sem data válida, retorna nulos.
function periodFromDate(date) {
  if (date) {
    const [y, m] = String(date).slice(0, 10).split('-').map(Number)
    if (y && m) return { pmonth: m, pyear: y }
  }
  return { pmonth: null, pyear: null }
}

async function recalcParent(sql, payable_type, payable_id) {
  const cfg = TABLES[payable_type]
  if (!cfg) throw new Error('payable_type inválido')

  // soma dos pagamentos e data mais recente
  const agg = await sql`
    SELECT COALESCE(SUM(amount), 0) AS total, MAX(paid_at) AS last_paid
    FROM payable_payments
    WHERE payable_type = ${payable_type} AND payable_id = ${payable_id}`
  const sum = parseFloat(agg[0].total) || 0
  const lastPaid = agg[0].last_paid || null

  // total do registro pai
  const totalCol = cfg.totalCol
  const parentRows = payable_type === 'victor'
    ? await sql`SELECT total_amount AS total FROM payables_victor WHERE id = ${payable_id}`
    : await sql`SELECT amount AS total FROM payables_fabricio WHERE id = ${payable_id}`
  const total = parseFloat(parentRows[0]?.total) || 0

  const status = statusFor(sum, total)
  const paidAt = status === 'pendente' ? null : lastPaid
  const paidAmount = sum.toFixed(2)

  // Mês de caixa do pai = data do último pagamento.
  //
  // Sem pagamentos (paidAt null) NÃO se preserva o valor atual, como se fazia antes: o valor
  // atual é justamente o mês do pagamento que acabou de ser apagado. Preservá-lo deixava o
  // payable encalhado num mês de caixa futuro, fora do teto de candidatosDisponiveis() e da
  // visão de caixa da aba — silenciosamente. Volta para o mês do recebimento do cliente
  // (ou a competência, se não houver fatura). Ver lib/cash-month.js.
  const { pmonth, pyear } = paidAt
    ? periodFromDate(paidAt)
    : (await mesDeCaixaOriginal(sql, payable_type, payable_id)) || { pmonth: null, pyear: null }

  if (payable_type === 'victor') {
    if (pmonth) await sql`UPDATE payables_victor SET paid_amount=${paidAmount}, paid_at=${paidAt}, status=${status}, payment_month=${pmonth}, payment_year=${pyear} WHERE id=${payable_id}`
    else await sql`UPDATE payables_victor SET paid_amount=${paidAmount}, paid_at=${paidAt}, status=${status} WHERE id=${payable_id}`
  } else {
    if (pmonth) await sql`UPDATE payables_fabricio SET paid_amount=${paidAmount}, paid_at=${paidAt}, status=${status}, payment_month=${pmonth}, payment_year=${pyear} WHERE id=${payable_id}`
    else await sql`UPDATE payables_fabricio SET paid_amount=${paidAmount}, paid_at=${paidAt}, status=${status} WHERE id=${payable_id}`
  }
  return { sum, status, paidAt }
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  const sql = neon(process.env.DATABASE_URL)

  if (req.method === 'GET') {
    const { payable_type, payable_id } = req.query
    const rows = await sql`
      SELECT * FROM payable_payments
      WHERE payable_type = ${payable_type} AND payable_id = ${payable_id}
      ORDER BY paid_at DESC, id DESC`
    return res.status(200).json({ data: rows })
  }

  if (req.method === 'POST') {
    // Caminho da especificação da tabela tabulada. O handler mora em
    // api/payables-victor.js, junto do recorte e do breakdown que ele lê — aqui é só o
    // endereço. Reimplementá-lo daria dois motores para a mesma distribuição, que é a
    // classe de bug que este projeto já pagou três vezes (pró-labore, regra financeira,
    // percentual do rateio).
    if (req.query.action === 'calculate-distribution') return calcularDistribuicao(sql, req, res)

    const { payable_type, payable_id, amount, paid_at, notes } = req.body
    if (!TABLES[payable_type]) return res.status(400).json({ error: 'payable_type inválido' })
    if (!payable_id) return res.status(400).json({ error: 'payable_id obrigatório' })

    // amount entrava direto no INSERT: aceitava nulo, negativo, zero, texto e
    // valor acima do saldo devedor — deixando o pai "pago" com saldo negativo.
    const valor = Number(amount)
    if (!Number.isFinite(valor) || valor <= 0) {
      return res.status(400).json({ error: 'Valor do pagamento deve ser um número maior que zero.' })
    }
    if (!paid_at) return res.status(400).json({ error: 'Data do pagamento é obrigatória.' })

    // O payable precisa existir; sem isso ficava um pagamento órfão permanente,
    // contado em toda soma futura.
    const parent = payable_type === 'victor'
      ? await sql`SELECT total_amount AS total FROM payables_victor WHERE id = ${payable_id} LIMIT 1`
      : await sql`SELECT amount AS total FROM payables_fabricio WHERE id = ${payable_id} LIMIT 1`
    if (!parent.length) return res.status(404).json({ error: 'Lançamento não encontrado' })

    const total = parseFloat(parent[0].total) || 0
    const pago = await sql`
      SELECT COALESCE(SUM(amount), 0) AS s FROM payable_payments
      WHERE payable_type = ${payable_type} AND payable_id = ${payable_id}`
    const jaPago = parseFloat(pago[0].s) || 0
    const restante = remainingBalance(total, jaPago)

    if (valor > restante + 0.01) {
      return res.status(400).json({
        error: `Valor acima do saldo devedor. Restam R$ ${restante.toFixed(2)} deste lançamento.`,
        remaining: Number(restante.toFixed(2)),
      })
    }

    const { pmonth, pyear } = periodFromDate(paid_at)
    const result = await sql`
      INSERT INTO payable_payments (payable_type, payable_id, amount, paid_at, notes, payment_month, payment_year)
      VALUES (${payable_type}, ${payable_id}, ${valor}, ${paid_at}, ${notes || null}, ${pmonth}, ${pyear})
      RETURNING *`
    await recalcParent(sql, payable_type, payable_id)
    return res.status(201).json({ data: result[0] })
  }

  if (req.method === 'DELETE') {
    const id = req.body?.id || req.query?.id
    if (!id) return res.status(400).json({ error: 'id obrigatório' })
    const motivo = req.body?.motivo || null

    // O tipo/id do pai vêm da própria linha, não do body. Antes o DELETE usava só o id e
    // recalculava o payable informado no body: apagar um pagamento do payable 42 e
    // recalcular o 1 deixava o 42 permanentemente com paid_amount e status errados.
    //
    // ⚠️ SELECT antes de apagar (era um DELETE ... RETURNING): o abatimento fiscal precisa
    // ENXERGAR as alocações para saber o que reverter, e elas morrem no CASCADE do DELETE.
    const alvo = await sql`SELECT payable_type, payable_id FROM payable_payments WHERE id = ${id}`
    if (!alvo.length) return res.status(404).json({ error: 'Pagamento não encontrado' })
    const { payable_type, payable_id } = alvo[0]

    // Se este pagamento fazia parte de uma distribuição fiscal, desfazer o abatimento
    // INTEIRO antes de apagar. Sem isto, a FK ON DELETE CASCADE levaria a
    // `fiscal_allocations` junto, mas o `fiscal_payments` de 'abatimento' sobreviveria e
    // ninguém recalcularia a obrigação: o DAS seguiria marcado como pago enquanto o
    // dinheiro volta para o saldo do Victor — o mesmo valor contado duas vezes. É a mesma
    // proteção que payables-victor.js, receivables.js e invoices.js já tomavam; só este
    // caminho (apagar UM pagamento) não a tinha, e ele acabou de ganhar um botão na tela.
    //
    // A unidade de reversão é o MÊS, não o pagamento — ver lib/fiscal-unlink.js. Por isso
    // a resposta devolve o que foi desfeito: estornar um pagamento pode derrubar a
    // distribuição inteira da competência, e a tela precisa poder dizer isso.
    //
    // Fabrício não participa da distribuição fiscal (candidatosDisponiveis só lê
    // payables_victor), então não há o que desamarrar.
    let fiscal = null
    if (payable_type === 'victor') {
      const r = await desfazerAbatimentoFiscal(sql, [payable_id])
      if (r.obrigacoes.length) fiscal = r
    }

    // O desfazer acima pode ter apagado ESTE pagamento junto (ele era parte da
    // distribuição). Só apaga o que sobrou — e a ausência aqui é sucesso, não 404.
    const aindaExiste = await sql`SELECT 1 FROM payable_payments WHERE id = ${id}`
    if (aindaExiste.length) {
      await sql`DELETE FROM payable_payments WHERE id = ${id}`
      await recalcParent(sql, payable_type, payable_id)
    }

    // Trilha de auditoria — o padrão documentado em lib/fiscal-unlink.js. Preserva o que
    // já estava em `notes` em vez de sobrescrever, e NÃO grava status='estornado': esse
    // valor não existe no vocabulário de nenhuma tabela e sumiria dos filtros de todas as
    // telas. Repetido em cada rota porque o driver do Neon não compõe fragmentos.
    const tabela = payable_type === 'victor' ? 'payables_victor' : 'payables_fabricio'
    if (tabela === 'payables_victor') {
      await sql`
        UPDATE payables_victor SET notes = COALESCE(NULLIF(notes,'') || ' | ', '') || 'Estornado em ' ||
          to_char(now() AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI') ||
          COALESCE(' (' || ${motivo}::text || ')', '')
        WHERE id = ${payable_id}`
    } else {
      await sql`
        UPDATE payables_fabricio SET notes = COALESCE(NULLIF(notes,'') || ' | ', '') || 'Estornado em ' ||
          to_char(now() AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI') ||
          COALESCE(' (' || ${motivo}::text || ')', '')
        WHERE id = ${payable_id}`
    }

    return res.status(200).json({ success: true, fiscal })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
