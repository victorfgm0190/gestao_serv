import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import nfseCertManager from '../lib/nfse-cert-manager.js'
import { montarDPS } from '../lib/nfse-xml-builder.js'
import { NFSeSigner } from '../lib/nfse-signer.js'
import { NFSeADNClient } from '../lib/nfse-adn-client.js'

// Emissão de NFS-e a partir de uma fatura.
//
// POST /api/nfse-emit  { invoice_id, transmitir?, descricao_servico?, aliquota_iss? }
//
// ⚠️ PRÉVIA POR PADRÃO. Sem `transmitir: true` o endpoint monta e assina o XML,
// devolve tudo para conferência e NÃO envia nada — o mesmo desenho de
// `?action=recalcular` ("nada financeiro é gravado sem aplicar: true"). Aqui a
// razão é mais forte: transmitir cria um documento fiscal na Receita, e o
// cliente do ADN ainda não foi verificado contra o serviço real.

const CAMPOS_EMITENTE = [
  ['cnpj', 'CNPJ'],
  ['inscricao_municipal', 'Inscrição municipal'],
  ['razao_social', 'Razão social'],
  ['endereco', 'Logradouro'],
  ['numero', 'Número'],
  ['bairro', 'Bairro'],
  ['cep', 'CEP'],
  ['municipio_codigo', 'Código IBGE do município'],
  ['uf', 'UF'],
  ['item_lista_servico', 'Item da lista de serviços'],
]

const CAMPOS_TOMADOR = [
  ['cpf_cnpj', 'CPF/CNPJ'],
  ['endereco', 'Logradouro'],
  ['numero', 'Número'],
  ['bairro', 'Bairro'],
  ['cep', 'CEP'],
  ['municipio_codigo', 'Código IBGE do município'],
]

const faltantes = (linha, campos, prefixo) =>
  campos
    .filter(([col]) => {
      const v = linha?.[col]
      return v === null || v === undefined || String(v).trim() === ''
    })
    .map(([col, rotulo]) => ({ campo: `${prefixo}.${col}`, rotulo: `${prefixo}: ${rotulo}` }))

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { invoice_id, transmitir = false, descricao_servico, aliquota_iss } = req.body || {}
  if (!invoice_id) return res.status(400).json({ error: 'invoice_id é obrigatório' })

  try {
    const sql = neon(process.env.DATABASE_URL)

    // ⚠️ A empresa sai da FATURA, não do corpo da requisição. O esboço fazia
    // `JOIN companies comp ON comp.id = ${company_id}` — um produto cartesiano
    // com uma constante, não uma relação: a fatura de uma empresa podia ser
    // emitida sob o CNPJ da outra sem nada acusar.
    const [inv] = await sql`
      SELECT i.id, i.company_id, i.client_id, i.invoice_value, i.contract_value,
             i.month, i.year, i.emission_date, i.require_nf, i.competencia,
             i.descricao_nfse, i.aliquota_iss, i.municipio_codigo AS invoice_municipio,
             i.invoice_number,
             cl.name AS client_name, cl.razao_social AS client_razao, cl.cpf_cnpj,
             cl.endereco, cl.numero, cl.complemento, cl.bairro, cl.cep,
             cl.municipio_codigo, cl.uf, cl.email, cl.telefone,
             cl.inscricao_municipal AS client_im
      FROM invoices i
      JOIN clients cl ON cl.id = i.client_id
      WHERE i.id = ${invoice_id}`
    if (!inv) return res.status(404).json({ error: 'Fatura não encontrada' })

    // Cliente sem NF não gera nota — é a mesma regra que já tira a Minas da
    // apuração, do rateio e da RBT12. Emitir aqui contradiria tudo isso.
    if (inv.require_nf === false) {
      return res.status(422).json({
        error: 'Este contrato não emite nota fiscal (require_nf = false)',
        cliente: inv.client_name,
      })
    }

    // Idempotência. O índice único cobre a corrida; esta checagem existe para
    // a resposta ser legível em vez de um erro de constraint.
    const [jaEmitida] = await sql`
      SELECT id, nfse_number, protocol, status, submitted_at
      FROM nfse_emissions
      WHERE invoice_id = ${invoice_id} AND cancelled_at IS NULL AND status <> 'erro'`
    if (jaEmitida) {
      return res.status(409).json({
        error: 'Esta fatura já tem NFS-e emitida',
        emissao: jaEmitida,
      })
    }

    const [emit] = await sql`
      SELECT * FROM nfse_emitter_settings WHERE company_id = ${inv.company_id}`
    if (!emit) {
      return res.status(422).json({
        error: 'Emitente não configurado para esta empresa',
        detalhe:
          'Cadastre CNPJ, inscrição municipal, endereço e item da lista de serviços em nfse_emitter_settings.',
        faltando: CAMPOS_EMITENTE.map(([c, r]) => ({ campo: `emitente.${c}`, rotulo: `Emitente: ${r}` })),
      })
    }

    // ⚠️ Aqui está o coração desta etapa. O esboço preenchia o prestador com
    // literais ('Rua Test', IM '123456', município 4106902) e o tomador com
    // defaults ('Não informado', CEP '00000000'), então a emissão SEMPRE
    // "funcionava" — produzindo um documento fiscal com endereço e inscrição
    // que não são de ninguém. Faltando dado, aqui não se inventa: recusa-se,
    // dizendo exatamente o que preencher.
    const pendencias = [
      ...faltantes(emit, CAMPOS_EMITENTE, 'emitente'),
      ...faltantes(inv, CAMPOS_TOMADOR, 'tomador'),
    ]
    if (!inv.client_razao && !inv.client_name) {
      pendencias.push({ campo: 'tomador.razao_social', rotulo: 'tomador: Razão social' })
    }
    if (pendencias.length) {
      return res.status(422).json({
        error: 'Dados fiscais incompletos — a nota não foi emitida',
        faltando: pendencias,
      })
    }

    // ⚠️ O valor é `invoice_value` (o valor da NF). O esboço lia
    // `inv.valor_total`, coluna que NÃO EXISTE: `parseFloat(undefined || 0)`
    // dá 0 e a nota seria transmitida com valor R$ 0,00 — sem erro de SQL,
    // sem aviso, com protocolo válido.
    const valorServico = Number(inv.invoice_value ?? inv.contract_value ?? 0)
    if (!(valorServico > 0)) {
      return res.status(422).json({
        error: `Fatura sem valor para emitir (invoice_value = ${inv.invoice_value})`,
      })
    }

    // Fallback como STRING de calendário, não como Date: `Date.UTC(...)` dá
    // meia-noite UTC, que `dataISO` empurraria para o dia (e o mês) anterior.
    const competencia =
      inv.competencia || `${inv.year}-${String(inv.month || 1).padStart(2, '0')}-01`
    const aliquota = aliquota_iss ?? inv.aliquota_iss ?? emit.aliquota_iss ?? 0

    const [{ proximo }] = await sql`
      SELECT COALESCE(MAX(dps_number), 0) + 1 AS proximo
      FROM nfse_emissions WHERE company_id = ${inv.company_id}`

    const dados = {
      ambiente: emit.ambiente ?? 2,
      serie: emit.serie || '00001',
      nDPS: proximo,
      dataEmissao: inv.emission_date || new Date(),
      emitente: {
        cnpj: emit.cnpj,
        inscricaoMunicipal: emit.inscricao_municipal,
        razaoSocial: emit.razao_social,
        municipioCodigo: emit.municipio_codigo,
        endereco: {
          logradouro: emit.endereco, numero: emit.numero, complemento: emit.complemento,
          bairro: emit.bairro, cep: emit.cep, uf: emit.uf,
        },
        telefone: emit.telefone, email: emit.email,
        optaSimples: emit.opta_simples, regimeEspecial: emit.regime_especial,
      },
      tomador: {
        documento: inv.cpf_cnpj,
        razaoSocial: inv.client_razao || inv.client_name,
        inscricaoMunicipal: inv.client_im,
        endereco: {
          logradouro: inv.endereco, numero: inv.numero, complemento: inv.complemento,
          bairro: inv.bairro, cep: inv.cep, municipioCodigo: inv.municipio_codigo, uf: inv.uf,
        },
        email: inv.email, telefone: inv.telefone,
      },
      servico: {
        descricao: descricao_servico || inv.descricao_nfse || `Serviços prestados — ${inv.month}/${inv.year}`,
        itemListaServico: emit.item_lista_servico,
        codigoTributacaoMunicipal: emit.codigo_tributacao_municipal,
        nbs: emit.nbs,
        municipioPrestacao: inv.invoice_municipio || emit.municipio_codigo,
        competencia,
      },
      valores: { servico: valorServico, aliquotaIss: aliquota },
    }

    let xml
    try {
      xml = montarDPS(dados)
    } catch (err) {
      if (err.code === 'DADOS_INCOMPLETOS') {
        return res.status(422).json({ error: err.message, faltando: err.faltando })
      }
      throw err
    }

    const cert = await nfseCertManager.getCertificateFromDB(sql, inv.company_id)
    const xmlAssinado = new NFSeSigner(cert.pfxBuffer, cert.password).assinarXML(xml)

    // ---- prévia: nada sai daqui -------------------------------------------
    if (transmitir !== true) {
      return res.status(200).json({
        success: true,
        preview: true,
        message: 'XML montado e assinado. Nada foi transmitido — envie transmitir: true para emitir.',
        ambiente: dados.ambiente === 1 ? 'producao' : 'homologacao',
        resumo: {
          invoice_id: inv.id, invoice_number: inv.invoice_number,
          cliente: inv.client_razao || inv.client_name,
          valor_servico: valorServico, aliquota_iss: Number(aliquota),
          competencia: String(competencia).slice(0, 10), dps_number: proximo,
        },
        xml_assinado: xmlAssinado,
      })
    }

    // ---- transmissão ------------------------------------------------------
    const ambienteNome = (emit.ambiente ?? 2) === 1 ? 'producao' : 'homologacao'
    const adn = new NFSeADNClient({
      ambiente: ambienteNome, pfxBuffer: cert.pfxBuffer, senhaPfx: cert.password,
    })
    const r = await adn.emitirNFSe(xmlAssinado)

    // A tentativa é gravada nos DOIS desfechos. Uma emissão que falhou sem
    // deixar registro é indistinguível de uma que nunca foi tentada — e é
    // exatamente ela que precisa ser investigada depois.
    const [linha] = await sql`
      INSERT INTO nfse_emissions
        (company_id, invoice_id, nsu, protocol, nfse_number, status, dps_number,
         xml_assinado, json_response, competencia, valor_servico,
         municipio_codigo, ambiente, error_message, submitted_at)
      VALUES
        (${inv.company_id}, ${invoice_id}, ${r.nsu ?? null}, ${r.protocolo ?? null},
         ${r.numeroNfse ?? null}, ${r.ok ? 'enviada' : 'erro'}, ${proximo},
         ${xmlAssinado}, ${JSON.stringify(r.resposta ?? {})},
         ${new Date(competencia)}, ${valorServico},
         ${dados.servico.municipioPrestacao}, ${emit.ambiente ?? 2},
         ${r.ok ? null : r.erro}, NOW())
      RETURNING id, status, nsu, protocol, nfse_number`

    if (!r.ok) {
      return res.status(502).json({
        success: false,
        error: `O ADN recusou a emissão: ${r.erro}`,
        emissao_id: linha.id,
        http_status: r.status,
        resposta: r.resposta,
      })
    }

    return res.status(200).json({
      success: true,
      preview: false,
      ambiente: ambienteNome,
      emissao: linha,
    })
  } catch (err) {
    if (err.code === 'CERT_NOT_FOUND') {
      return res.status(422).json({
        error: 'Certificado digital não configurado para esta empresa',
        detalhe: 'Envie o .pfx em /configuracao/nfse antes de emitir.',
      })
    }
    console.error('[nfse-emit] falha:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
