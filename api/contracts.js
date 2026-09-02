import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'

// Split cadastrado. Não usar `|| 50`: 0 é um split legítimo (cliente 100/0)
// e seria gravado como 50%.
function splitPct(value, fallback) {
  const n = parseFloat(value)
  return isNaN(n) ? fallback : n
}

// Emite nota? Só `false` explícito desliga — cliente antigo que não manda a chave
// (ou manda '' de um form) continua exigindo NF, que é o comportamento seguro:
// contrato sem NF sai inteiro da apuração fiscal.
const requerNf = (v) => !(v === false || v === 'false' || v === 0 || v === '0')

// Tomador da NF quando ele NÃO é o cliente do contrato (ex.: quem presta serviço à
// Bokada mas fatura contra a holding). Vazio, inválido ou igual ao próprio cliente
// grava NULL: "emitir para o cliente base" tem UM jeito de ser escrito, senão a
// leitura precisaria testar as duas formas em todo consumidor.
//
// ⚠️ É SÓ o tomador da nota. `client_id` continua mandando em rateio Victor/Fabrício,
// regra financeira, recebível e apuração — trocar o tomador não muda de quem é o
// serviço.
const tomadorId = (v) => {
  const n = parseInt(v, 10)
  return Number.isInteger(n) && n > 0 ? n : null
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  const sql = neon(process.env.DATABASE_URL)

  if (req.method === 'GET') {
    const { company_id, client_id } = req.query
    if (client_id) {
      const contracts = await sql`
        SELECT c.*, cl.name as client_name,
               ic.name as invoice_client_name, ic.cpf_cnpj as invoice_client_cpf_cnpj
        FROM contracts c
        JOIN clients cl ON cl.id = c.client_id
        LEFT JOIN clients ic ON ic.id = c.invoice_client_id
        WHERE c.client_id = ${client_id} AND c.is_active = true
        ORDER BY c.id ASC
      `
      return res.status(200).json({ contracts })
    }
    const contracts = await sql`
      SELECT c.*, cl.name as client_name,
             ic.name as invoice_client_name, ic.cpf_cnpj as invoice_client_cpf_cnpj
      FROM contracts c
      JOIN clients cl ON cl.id = c.client_id
      LEFT JOIN clients ic ON ic.id = c.invoice_client_id
      WHERE c.company_id = ${company_id}
      ORDER BY c.is_active DESC, cl.name ASC
    `
    return res.status(200).json({ contracts })
  }

  if (req.method === 'POST') {
    const { company_id, client_id, invoice_client_id, name, billing_type, contract_value, victor_fixed, remainder_victor_pct, remainder_fabricio_pct, has_tax, tax_percentage, tax_client_percent, notes, deslocamento_tipo, deslocamento_valor_hora, displacement_hours, cnpj, financial_rule_id, projeto_split_mode, projeto_victor_pct, projeto_victor_fixed, projeto_expenses, require_nf } = req.body
    try {
      const result = await sql`
        INSERT INTO contracts (company_id, client_id, name, billing_type, contract_value, victor_fixed, remainder_victor_pct, remainder_fabricio_pct, has_tax, tax_percentage, tax_client_percent, notes, deslocamento_tipo, deslocamento_valor_hora, displacement_hours, cnpj, financial_rule_id, projeto_split_mode, projeto_victor_pct, projeto_victor_fixed, projeto_expenses, require_nf, invoice_client_id)
        VALUES (${company_id}, ${client_id}, ${name}, ${billing_type || 'contract'}, ${contract_value || 0}, ${victor_fixed || 0}, ${splitPct(remainder_victor_pct, 50)}, ${splitPct(remainder_fabricio_pct, 50)}, ${has_tax || false}, ${tax_percentage || null}, ${tax_client_percent || 0}, ${notes || null}, ${deslocamento_tipo || 'nao_cobrado'}, ${deslocamento_valor_hora || 0}, ${displacement_hours || 0}, ${cnpj || null}, ${financial_rule_id || null}, ${projeto_split_mode || 'direct_split'}, ${projeto_victor_pct || 0}, ${projeto_victor_fixed || 0}, ${projeto_expenses || 0}, ${requerNf(require_nf)}, NULLIF(${tomadorId(invoice_client_id)}::int, ${client_id}::int))
        RETURNING *
      `
      return res.status(201).json({ contract: result[0] })
    } catch (error) {
      return res.status(500).json({ error: error.message })
    }
  }

  if (req.method === 'PATCH') {
    const { id, ...fields } = req.body
    try {
      const result = await sql`
        UPDATE contracts SET
          name = ${fields.name},
          billing_type = ${fields.billing_type || 'mensal'},
          deslocamento_tipo = ${fields.deslocamento_tipo || 'nao_cobrado'},
          deslocamento_valor_hora = ${fields.deslocamento_valor_hora || 0},
          displacement_hours = ${fields.displacement_hours || 0},
          cnpj = ${fields.cnpj || null},
          contract_value = ${fields.contract_value},
          victor_fixed = ${fields.victor_fixed},
          remainder_victor_pct = ${fields.remainder_victor_pct},
          remainder_fabricio_pct = ${fields.remainder_fabricio_pct},
          has_tax = ${fields.has_tax},
          tax_percentage = ${fields.tax_percentage},
          tax_client_percent = ${fields.tax_client_percent || 0},
          is_active = ${fields.is_active},
          financial_rule_id = ${fields.financial_rule_id || null},
          projeto_split_mode = ${fields.projeto_split_mode || 'direct_split'},
          projeto_victor_pct = ${fields.projeto_victor_pct || 0},
          projeto_victor_fixed = ${fields.projeto_victor_fixed || 0},
          projeto_expenses = ${fields.projeto_expenses || 0},
          -- NULLIF contra a COLUNA client_id (não contra o body): o PATCH não troca o
          -- cliente do contrato, e assim "o tomador é o próprio cliente" cai em NULL
          -- sem precisar de uma leitura extra para descobrir quem ele é.
          invoice_client_id = NULLIF(${tomadorId(fields.invoice_client_id)}::int, client_id),
          -- COALESCE preserva o valor atual quando a chave não veio no corpo: um PATCH
          -- de outra tela (ou de um cliente antigo) não pode religar a NF em silêncio.
          require_nf = COALESCE(${fields.require_nf === undefined ? null : requerNf(fields.require_nf)}::boolean, require_nf),
          notes = ${fields.notes}
        WHERE id = ${id}
        RETURNING *
      `
      return res.status(200).json({ contract: result[0] })
    } catch (error) {
      return res.status(500).json({ error: error.message })
    }
  }

  if (req.method === 'DELETE') {
    const { id } = req.body
    await sql`DELETE FROM contracts WHERE id = ${id}`
    return res.status(200).json({ success: true })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
