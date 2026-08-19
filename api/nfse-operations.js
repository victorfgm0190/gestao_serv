import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import { ROTULOS_OPERACAO } from '../lib/nfse-operations.js'

// Histórico de operações de NFS-e, com os XMLs enviados e recebidos.
//
// GET /api/nfse-operations?company_id=1[&invoice_id=][&nfse_emission_id=][&status=][&page=][&limit=]
//   → lista com PRÉVIA dos XMLs (não o conteúdo inteiro)
// GET /api/nfse-operations?id=12&parte=enviado|resposta
//   → baixa o XML inteiro daquela operação
//
// ⚠️ A lista NÃO devolve os XMLs completos, e isso não é economia de bytes: um
// par (DPS assinada + NFS-e autorizada) passa de 10 KB, e 50 operações viram
// meio megabyte a cada abertura de tela — para exibir 500 caracteres de cada.
// É a mesma razão pela qual /api/nfse-list não seleciona `xml_assinado`. Quem
// quer o documento inteiro pede por `?id=&parte=`, e recebe um arquivo.
//
// ⚠️ `company_id` é OBRIGATÓRIO na lista. Sem ele o esboço montava
// `WHERE 1=1` sem ORDER BY e sem LIMIT: qualquer usuário autenticado puxaria a
// tabela inteira — as duas empresas, com todos os XMLs assinados dentro.

const PREVIA = 2000   // caracteres de XML devolvidos na lista

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const sql = neon(process.env.DATABASE_URL)

  // ---- download de uma parte ------------------------------------------------
  const idDownload = parseInt(req.query.id, 10)
  if (Number.isInteger(idDownload)) {
    return baixar(req, res, sql, idDownload)
  }

  const companyId = parseInt(req.query.company_id, 10)
  if (!Number.isInteger(companyId)) {
    return res.status(400).json({ error: 'company_id é obrigatório' })
  }

  // ⚠️ Teto no limit pelo mesmo motivo de /api/nfse-list: `limit=100000`
  // puxaria a tabela inteira, e aqui cada linha carrega duas prévias de XML.
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25))
  const offset = (page - 1) * limit

  const nInvoice = parseInt(req.query.invoice_id, 10)
  const filtroInvoice = Number.isInteger(nInvoice) ? nInvoice : null
  const nEmissao = parseInt(req.query.nfse_emission_id, 10)
  const filtroEmissao = Number.isInteger(nEmissao) ? nEmissao : null
  const filtroStatus = ['enviado', 'sucesso', 'erro'].includes(req.query.status)
    ? req.query.status : null
  const filtroTipo = ['emit', 'substitute', 'cancel', 'consult', 'sync'].includes(req.query.tipo)
    ? req.query.tipo : null

  try {
    // ⚠️ Tudo por tagged template com filtros opcionais no formato
    // `(${x}::int IS NULL OR coluna = ${x}::int)` — o driver do Neon não compõe
    // fragmentos de SQL, então montar a cláusula por concatenação e chamar
    // `sql(string)` simplesmente não funciona (a mesma nota de /api/nfse-list).
    const linhas = await sql`
      -- ⚠️ ::int nos BIGSERIAL/BIGINT: bigint chega como STRING no JSON, e
      -- comparar '57' com 57 dá false — qualquer comparação de id na tela
      -- falharia em silêncio. Mesma razão do ::int no COUNT(*).
      SELECT o.id::int AS id, o.operation_type, o.status, o.erro_mensagem, o.erro_codigo,
             o.http_status, o.ambiente, o.dps_number,
             o.enviado_em, o.respondido_em, o.created_at,
             o.invoice_id::int AS invoice_id, o.nfse_emission_id::int AS nfse_emission_id,
             i.invoice_number,
             COALESCE(NULLIF(cl.razao_social, ''), cl.name) AS cliente,
             ne.nfse_number, ne.chave_acesso,
             o.json_resposta,
             LEFT(o.xml_enviado,  ${PREVIA}) AS xml_enviado_previa,
             LEFT(o.xml_resposta, ${PREVIA}) AS xml_resposta_previa,
             -- length() sobre a coluna inteira: é o que diz à tela se a prévia
             -- foi truncada, sem trafegar o XML para descobrir.
             length(o.xml_enviado)  AS xml_enviado_tamanho,
             length(o.xml_resposta) AS xml_resposta_tamanho
      FROM nfse_operations o
      LEFT JOIN invoices i ON i.id = o.invoice_id
      LEFT JOIN clients  cl ON cl.id = i.client_id
      LEFT JOIN nfse_emissions ne ON ne.id = o.nfse_emission_id
      WHERE o.company_id = ${companyId}
        AND (${filtroInvoice}::int IS NULL OR o.invoice_id = ${filtroInvoice}::int)
        AND (${filtroEmissao}::int IS NULL OR o.nfse_emission_id = ${filtroEmissao}::int)
        AND (${filtroStatus}::text IS NULL OR o.status = ${filtroStatus}::text)
        AND (${filtroTipo}::text IS NULL OR o.operation_type = ${filtroTipo}::text)
      ORDER BY o.enviado_em DESC NULLS LAST, o.id DESC
      LIMIT ${limit} OFFSET ${offset}`

    // COUNT(*) volta como bigint → string no JSON sem o ::int.
    const [{ total }] = await sql`
      SELECT COUNT(*)::int AS total FROM nfse_operations o
      WHERE o.company_id = ${companyId}
        AND (${filtroInvoice}::int IS NULL OR o.invoice_id = ${filtroInvoice}::int)
        AND (${filtroEmissao}::int IS NULL OR o.nfse_emission_id = ${filtroEmissao}::int)
        AND (${filtroStatus}::text IS NULL OR o.status = ${filtroStatus}::text)
        AND (${filtroTipo}::text IS NULL OR o.operation_type = ${filtroTipo}::text)`

    return res.status(200).json({
      success: true,
      count: linhas.length,
      operations: linhas.map((o) => ({
        id: o.id,
        tipo: o.operation_type,
        // Rótulo resolvido no servidor, do mesmo mapa que grava os tipos —
        // duas tabelas de tradução divergem no dia em que um tipo é criado.
        rotulo: ROTULOS_OPERACAO[o.operation_type] || o.operation_type,
        status: o.status,
        erroMensagem: o.erro_mensagem,
        erroCodigo: o.erro_codigo,
        httpStatus: o.http_status,
        ambiente: o.ambiente,
        dpsNumber: o.dps_number,
        enviadoEm: o.enviado_em,
        respondidoEm: o.respondido_em,
        invoiceId: o.invoice_id,
        invoiceNumber: o.invoice_number,
        cliente: o.cliente,
        emissionId: o.nfse_emission_id,
        nfseNumber: o.nfse_number,
        chaveAcesso: o.chave_acesso,
        jsonResposta: o.json_resposta,
        xmlEnviado: {
          previa: o.xml_enviado_previa,
          tamanho: o.xml_enviado_tamanho ?? 0,
          truncado: (o.xml_enviado_tamanho ?? 0) > PREVIA,
        },
        xmlResposta: {
          previa: o.xml_resposta_previa,
          tamanho: o.xml_resposta_tamanho ?? 0,
          truncado: (o.xml_resposta_tamanho ?? 0) > PREVIA,
        },
      })),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    })
  } catch (err) {
    console.error('[nfse-operations] falha:', err.message)
    return res.status(500).json({ error: 'Erro ao listar operações' })
  }
}

// Baixa o XML inteiro de uma operação, como arquivo — o mesmo desenho de
// /api/nfse-download-xml.
async function baixar(req, res, sql, id) {
  const parte = String(req.query.parte || 'enviado').toLowerCase()
  if (!['enviado', 'resposta'].includes(parte)) {
    return res.status(400).json({ error: "parte deve ser 'enviado' ou 'resposta'" })
  }

  try {
    const [o] = await sql`
      SELECT id, company_id, operation_type, nfse_emission_id, invoice_id,
             enviado_em, xml_enviado, xml_resposta, json_resposta
      FROM nfse_operations WHERE id = ${id}`
    if (!o) return res.status(404).json({ error: 'Operação não encontrada' })

    const xml = parte === 'enviado' ? o.xml_enviado : o.xml_resposta
    if (!xml) {
      // ⚠️ Ausência tem CAUSA, e ela muda o que fazer. Consulta e sincronização
      // não enviam documento; um cancelamento recusado não recebe XML de volta,
      // só o JSON com o motivo — que continua acessível na lista.
      return res.status(404).json({
        error: parte === 'enviado'
          ? 'Esta operação não enviou XML'
          : 'Esta operação não recebeu XML de resposta',
        detalhe: parte === 'enviado'
          ? 'Consulta e sincronização não transmitem documento assinado.'
          : 'Recusa do SEFIN e cancelamento aceito devolvem só JSON — veja a resposta na lista.',
        tem_json: Boolean(o.json_resposta),
      })
    }

    const parteNome = (v) => String(v ?? '').replace(/[^\w.-]/g, '')
    const nome = [
      'operacao', parteNome(o.id), parteNome(o.operation_type), parte,
    ].filter(Boolean).join('_')

    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${nome}.xml"`)
    return res.status(200).send(xml)
  } catch (err) {
    console.error('[nfse-operations] falha no download:', err.message)
    return res.status(500).json({ error: 'Erro ao baixar XML da operação' })
  }
}
