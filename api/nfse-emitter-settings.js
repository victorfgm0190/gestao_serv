import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'

// Dados do emitente da NFS-e (a empresa que presta o serviço).
//
// GET  /api/nfse-emitter-settings?company_id=1
// POST /api/nfse-emitter-settings   { company_id, ...campos }
//
// ⚠️ Nomes de coluna: são `nbs` e `codigo_tributacao_municipal`, não
// `nbs_codigo` e `codigo_tributacao`. E o certificado NÃO mora aqui — ele está
// em `nfse_certificates`, gerenciado por /api/nfse-setup.

// Campos que o POST aceita. Lista explícita para que um campo a mais no corpo
// da requisição não vire coluna gravada por acidente.
const CAMPOS = [
  'cnpj', 'inscricao_municipal', 'razao_social', 'nome_fantasia',
  'endereco', 'numero', 'complemento', 'bairro', 'municipio_codigo', 'uf', 'cep',
  'telefone', 'email',
  'item_lista_servico', 'codigo_tributacao_municipal', 'cnae', 'nbs',
  'aliquota_iss', 'opta_simples', 'regime_especial', 'ambiente', 'serie',
]

const soDigitos = (v) => (v == null ? null : String(v).replace(/\D/g, '') || null)
const texto = (v) => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}
const numero = (v) => {
  if (v === null || v === undefined || String(v).trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return

  const sql = neon(process.env.DATABASE_URL)

  if (req.method === 'GET') {
    const companyId = parseInt(req.query.company_id, 10)
    if (!Number.isInteger(companyId)) {
      return res.status(400).json({ error: 'company_id é obrigatório' })
    }
    try {
      const [linha] = await sql`
        SELECT * FROM nfse_emitter_settings WHERE company_id = ${companyId}`
      return res.status(200).json({ success: true, settings: linha || null })
    } catch (err) {
      console.error('[nfse-emitter-settings] GET falhou:', err.message)
      return res.status(500).json({ error: 'Erro ao carregar as configurações' })
    }
  }

  if (req.method === 'POST') {
    const companyId = parseInt(req.body?.company_id, 10)
    if (!Number.isInteger(companyId)) {
      return res.status(400).json({ error: 'company_id é obrigatório' })
    }

    const b = req.body || {}
    const v = {}
    for (const c of CAMPOS) v[c] = texto(b[c])

    // Documentos e códigos guardados só com dígitos — é assim que entram no
    // XML, e guardar "12.345.678/0001-90" faria a comparação com o que já está
    // gravado depender da máscara que o usuário digitou.
    v.cnpj = soDigitos(b.cnpj)
    v.cep = soDigitos(b.cep)
    v.municipio_codigo = soDigitos(b.municipio_codigo)
    v.cnae = soDigitos(b.cnae)
    v.uf = v.uf ? v.uf.toUpperCase().slice(0, 2) : null
    v.aliquota_iss = numero(b.aliquota_iss)
    v.opta_simples = numero(b.opta_simples) ?? 3
    v.regime_especial = numero(b.regime_especial) ?? 0
    v.ambiente = numero(b.ambiente) ?? 2
    v.serie = v.serie || '00001'

    // ⚠️ Salvar PARCIAL é permitido de propósito. O esboço recusava com 400 no
    // primeiro campo vazio: a configuração fiscal é preenchida em várias
    // sessões (o CNAE e o item da lista vêm do contador), e obrigar tudo de uma
    // vez faz perder o que já foi digitado. Quem diz o que ainda falta é
    // /api/nfse-validate-setup, e a emissão recusa sozinha se faltar algo.
    if (v.cnpj && v.cnpj.length !== 14) {
      return res.status(400).json({ error: `CNPJ deve ter 14 dígitos (tem ${v.cnpj.length})` })
    }
    if (v.cep && v.cep.length !== 8) {
      return res.status(400).json({ error: `CEP deve ter 8 dígitos (tem ${v.cep.length})` })
    }
    if (v.municipio_codigo && v.municipio_codigo.length !== 7) {
      return res.status(400).json({ error: `Código IBGE do município deve ter 7 dígitos (tem ${v.municipio_codigo.length})` })
    }
    if (![1, 2].includes(v.ambiente)) {
      return res.status(400).json({ error: 'ambiente deve ser 1 (produção) ou 2 (homologação)' })
    }

    try {
      const [linha] = await sql`
        INSERT INTO nfse_emitter_settings (
          company_id, cnpj, inscricao_municipal, razao_social, nome_fantasia,
          endereco, numero, complemento, bairro, municipio_codigo, uf, cep,
          telefone, email, item_lista_servico, codigo_tributacao_municipal,
          cnae, nbs, aliquota_iss, opta_simples, regime_especial, ambiente, serie,
          updated_at
        ) VALUES (
          ${companyId}, ${v.cnpj}, ${v.inscricao_municipal}, ${v.razao_social}, ${v.nome_fantasia},
          ${v.endereco}, ${v.numero}, ${v.complemento}, ${v.bairro}, ${v.municipio_codigo}, ${v.uf}, ${v.cep},
          ${v.telefone}, ${v.email}, ${v.item_lista_servico}, ${v.codigo_tributacao_municipal},
          ${v.cnae}, ${v.nbs}, ${v.aliquota_iss}, ${v.opta_simples}, ${v.regime_especial}, ${v.ambiente}, ${v.serie},
          NOW()
        )
        ON CONFLICT (company_id) DO UPDATE SET
          cnpj = EXCLUDED.cnpj,
          inscricao_municipal = EXCLUDED.inscricao_municipal,
          razao_social = EXCLUDED.razao_social,
          nome_fantasia = EXCLUDED.nome_fantasia,
          endereco = EXCLUDED.endereco,
          numero = EXCLUDED.numero,
          complemento = EXCLUDED.complemento,
          bairro = EXCLUDED.bairro,
          municipio_codigo = EXCLUDED.municipio_codigo,
          uf = EXCLUDED.uf,
          cep = EXCLUDED.cep,
          telefone = EXCLUDED.telefone,
          email = EXCLUDED.email,
          item_lista_servico = EXCLUDED.item_lista_servico,
          codigo_tributacao_municipal = EXCLUDED.codigo_tributacao_municipal,
          cnae = EXCLUDED.cnae,
          nbs = EXCLUDED.nbs,
          aliquota_iss = EXCLUDED.aliquota_iss,
          opta_simples = EXCLUDED.opta_simples,
          regime_especial = EXCLUDED.regime_especial,
          ambiente = EXCLUDED.ambiente,
          serie = EXCLUDED.serie,
          updated_at = NOW()
        RETURNING *`

      return res.status(200).json({ success: true, settings: linha })
    } catch (err) {
      console.error('[nfse-emitter-settings] POST falhou:', err.message)
      return res.status(500).json({ error: 'Erro ao salvar as configurações' })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
