import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'

// Lista as NFS-e emitidas por empresa, paginado.
//
// ⚠️ Tudo por tagged template. O esboço montava a SQL por concatenação e
// chamava `sql(query)` com uma string — o driver do Neon é uma tagged template
// e recusa a chamada. Além disso `parseInt(company_id)` de um parâmetro ausente
// dá NaN e produz `WHERE company_id = NaN`, que é erro de sintaxe no Postgres,
// não "nenhum resultado".
export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { company_id, invoice_id } = req.query
  const companyId = parseInt(company_id, 10)
  if (!Number.isInteger(companyId)) {
    return res.status(400).json({ error: 'company_id é obrigatório' })
  }

  // Teto no limit: sem ele, `limit=100000` puxa a tabela inteira — e cada linha
  // carrega o XML assinado, que tem alguns KB. (O SELECT abaixo não traz o XML
  // justamente por isso; o teto protege o resto.)
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20))
  const offset = (page - 1) * limit

  const filtroInvoice = Number.isInteger(parseInt(invoice_id, 10)) ? parseInt(invoice_id, 10) : null

  try {
    const sql = neon(process.env.DATABASE_URL)

    const linhas = await sql`
      SELECT ne.id, ne.nfse_number, ne.nsu, ne.protocol, ne.status, ne.ambiente,
             ne.valor_servico, ne.competencia, ne.submitted_at, ne.approved_at,
             ne.cancelled_at, ne.error_message,
             ne.invoice_id, i.invoice_number,
             -- razao_social e o nome fiscal; a coluna name e apelido de tela
             -- ("Bokada(Renato) 85"). Cai no apelido so quando nao ha o fiscal.
             COALESCE(NULLIF(cl.razao_social, ''), cl.name) AS cliente,
             (ne.xml_assinado IS NOT NULL) AS tem_xml
      FROM nfse_emissions ne
      JOIN invoices i ON i.id = ne.invoice_id
      JOIN clients  cl ON cl.id = i.client_id
      WHERE ne.company_id = ${companyId}
        AND (${filtroInvoice}::int IS NULL OR ne.invoice_id = ${filtroInvoice}::int)
      ORDER BY ne.submitted_at DESC NULLS LAST, ne.id DESC
      LIMIT ${limit} OFFSET ${offset}`

    // COUNT(*) volta como bigint → string no JSON. Sem o ::int, o total
    // aparece entre aspas e `total / limit` só funciona por coerção.
    const [{ total }] = await sql`
      SELECT COUNT(*)::int AS total FROM nfse_emissions
      WHERE company_id = ${companyId}
        AND (${filtroInvoice}::int IS NULL OR invoice_id = ${filtroInvoice}::int)`

    return res.status(200).json({
      success: true,
      emissions: linhas.map((e) => ({
        id: e.id,
        nfseNumber: e.nfse_number,
        nsu: e.nsu,
        protocol: e.protocol,
        status: e.status,
        ambiente: e.ambiente,
        // Valor pode ser nulo numa tentativa que falhou antes de calcular.
        valor: e.valor_servico === null ? null : Number(e.valor_servico),
        competencia: e.competencia,
        cliente: e.cliente,
        invoiceId: e.invoice_id,
        invoiceNumber: e.invoice_number,
        emittedAt: e.submitted_at,
        approvedAt: e.approved_at,
        cancelledAt: e.cancelled_at,
        erro: e.error_message,
        temXml: e.tem_xml,
      })),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    })
  } catch (err) {
    console.error('[nfse-list] falha:', err.message)
    return res.status(500).json({ error: 'Erro ao listar NFS-e' })
  }
}
