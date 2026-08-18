import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import { verificarSetup } from '../lib/nfse-setup-check.js'

// Diagnóstico do setup de NFS-e.
//
// GET /api/nfse-validate-setup?company_id=1[&invoice_id=37]
//
// ⚠️ Responde 200 em TODOS os casos em que a consulta funcionou, com
// `pronto: true|false`. O esboço devolvia 422 quando faltava dado — mas o que
// se pergunta aqui é justamente "falta alguma coisa?", e "falta" é a resposta
// certa, não um erro do pedido. Com 422 a tela de configuração precisaria
// tratar a resposta normal como falha, e o interceptor de erro do front
// mostraria um alerta a cada visita à página.
export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const companyId = parseInt(req.query.company_id, 10)
  if (!Number.isInteger(companyId)) {
    return res.status(400).json({ error: 'company_id é obrigatório' })
  }
  const invoiceId = Number.isInteger(parseInt(req.query.invoice_id, 10))
    ? parseInt(req.query.invoice_id, 10)
    : null

  try {
    const sql = neon(process.env.DATABASE_URL)
    const r = await verificarSetup(sql, companyId, invoiceId)

    // A ação é derivada do que falta, não de um texto fixo: mandar "acesse
    // Configurações" quando o que falta é o CNPJ do CLIENTE manda a pessoa
    // para a tela errada.
    const acoes = []
    if (r.emitente.faltando.length) acoes.push('Preencha os dados da empresa em Configuração → Emitente NFS-e.')
    if (!r.certificado.presente) acoes.push('Envie o certificado A1 em Configuração → Certificado NFS-e.')
    else if (!r.certificado.valido) acoes.push(`Renove o certificado: ${r.certificado.motivo}.`)
    if (r.tomador?.faltando?.length) acoes.push(`Complete o cadastro de "${r.tomador.cliente}" em Clientes.`)

    return res.status(200).json({
      success: true,
      pronto: r.pronto,
      mensagem: r.pronto
        ? 'Tudo configurado para emitir NFS-e.'
        : `Faltam ${r.faltando.length} item(ns) para emitir.`,
      campos_faltantes: r.faltando.map((f) => f.rotulo),
      faltando: r.faltando,
      acao: acoes.join(' ') || null,
      emitente: r.emitente,
      certificado: r.certificado,
      tomador: r.tomador,
    })
  } catch (err) {
    console.error('[nfse-validate-setup] falha:', err.message)
    return res.status(500).json({ error: 'Erro ao validar a configuração' })
  }
}
