import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import nfseCertManager from '../lib/nfse-cert-manager.js'
import { montarDPS, MOTIVO_MIN, dataISO } from '../lib/nfse-xml-builder.js'
import { NFSeSigner } from '../lib/nfse-signer.js'
import { NFSeADNClient } from '../lib/nfse-adn-client.js'
import { registrarEvento, EVENTOS } from '../lib/nfse-events.js'
import { abrirOperacao, fecharOperacao, OPERACOES } from '../lib/nfse-operations.js'
import { CAMPOS_EMITENTE, CAMPOS_TOMADOR, faltantes } from '../lib/nfse-setup-check.js'

// Substituição de NFS-e.
//
// POST /api/nfse-substituir
//   { emission_id, motivo, codigo_motivo?, novo_valor?, descricao?, transmitir? }
//
// ⚠️⚠️ SUBSTITUIÇÃO NÃO É "CANCELAR E EMITIR OUTRA". No padrão nacional ela é
// uma DPS nova com o bloco `<subst>` apontando para a chave da nota anterior —
// é o FISCO que faz o vínculo e invalida a original. O esboço marcava
// `status='cancelled'` DIRETO NO NOSSO BANCO, sem falar com o SEFIN: a nota
// continuaria valendo na Receita enquanto o sistema a dava por cancelada. É a
// mesma divergência que api/nfse-cancel.js já evita, aqui como regra do fluxo.
//
// ⚠️⚠️ E NÃO DÁ PARA CORRIGIR VALOR POR SUBSTITUIÇÃO NO SIMPLES. Verificado
// contra o SEFIN em homologação, com o certificado da empresa — erro E0063:
//
//   "Os campos data de competência (dCompet), identificação do Tomador e valor
//    do serviço (vServ) NÃO PODEM SER ALTERADOS quando a opção do simples
//    nacional for ME/EPP (opSimpNac = 3) na nota original e continuar como
//    ME/EPP (3) ou mudar para MEI (2) na competência da nota substituta."
//
// Com o MESMO valor, a substituição é aceita (201). Ou seja: ela serve para
// corrigir descrição e demais campos — não o valor. Para corrigir valor no
// Simples o caminho é CANCELAR a nota e emitir outra, que são dois atos
// fiscais distintos, com prazo próprio de cancelamento.
//
// ⚠️ E `invoices` NÃO é reescrita. O esboço fazia
// `UPDATE invoices SET valor_total = ...` — coluna que nem existe (é
// `invoice_value`) e que, se existisse, dessincronizaria recebíveis, payables
// do Victor e do Fabrício, rateio fiscal e apuração, todos derivados dela.
// Fatura recebida não se edita: estorna-se e refatura-se.

// opSimpNac que travam valor/competência/tomador na substituição (E0063).
const SIMPLES_TRAVADO = new Set([2, 3])
const SUBSTITUIVEIS = new Set(['enviada', 'autorizada'])

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const {
    emission_id, motivo, codigo_motivo = '01',
    novo_valor, descricao, transmitir = false,
  } = req.body || {}

  if (!emission_id) return res.status(400).json({ error: 'emission_id é obrigatório' })
  if (String(motivo ?? '').trim().length < MOTIVO_MIN) {
    return res.status(400).json({
      error: `O motivo da substituição precisa de pelo menos ${MOTIVO_MIN} caracteres`,
      detalhe: 'É exigência do schema nacional (TSMotivo), não uma regra nossa.',
    })
  }

  try {
    const sql = neon(process.env.DATABASE_URL)

    // ⚠️ Mesmo COALESCE de api/nfse-emit.js: a substituta vai para o mesmo tomador
    // que a fatura congelou. Ler o cliente do serviço aqui trocaria o destinatário
    // no meio da substituição, e o ADN recusa (ou pior, autoriza) uma nota para
    // outra pessoa.
    const [orig] = await sql`
      SELECT ne.id, ne.company_id, ne.invoice_id, ne.chave_acesso, ne.status,
             ne.ambiente, ne.nfse_number, ne.valor_servico, ne.competencia,
             ne.cancelled_at, ne.substituida_por,
             i.invoice_value, i.contract_value, i.month, i.year, i.require_nf,
             i.descricao_nfse, i.municipio_codigo AS invoice_municipio, i.emission_date,
             cl.name AS client_name, cl.razao_social AS client_razao, cl.cpf_cnpj,
             cl.endereco, cl.numero, cl.complemento, cl.bairro, cl.cep,
             cl.municipio_codigo, cl.uf, cl.email, cl.telefone,
             cl.inscricao_municipal AS client_im
      FROM nfse_emissions ne
      JOIN invoices i ON i.id = ne.invoice_id
      JOIN clients cl ON cl.id = COALESCE(i.invoice_client_id, i.client_id)
      WHERE ne.id = ${parseInt(emission_id, 10)}`

    if (!orig) return res.status(404).json({ error: 'Emissão não encontrada' })
    if (!orig.chave_acesso) {
      return res.status(422).json({
        error: 'Esta emissão não tem chave de acesso',
        detalhe: 'Só uma nota autorizada pode ser substituída.',
      })
    }
    if (orig.cancelled_at) {
      return res.status(409).json({ error: 'Nota cancelada não pode ser substituída' })
    }
    if (orig.substituida_por) {
      return res.status(409).json({
        error: 'Esta nota já foi substituída',
        substituida_por: orig.substituida_por,
      })
    }
    if (!SUBSTITUIVEIS.has(orig.status)) {
      return res.status(409).json({ error: `Nota com status "${orig.status}" não pode ser substituída` })
    }

    const [emit] = await sql`
      SELECT * FROM nfse_emitter_settings WHERE company_id = ${orig.company_id}`
    if (!emit) return res.status(422).json({ error: 'Emitente não configurado para esta empresa' })

    const pendencias = [
      ...faltantes(emit, CAMPOS_EMITENTE, 'emitente'),
      ...faltantes(orig, CAMPOS_TOMADOR, 'tomador'),
    ]
    if (pendencias.length) {
      return res.status(422).json({ error: 'Dados fiscais incompletos', faltando: pendencias })
    }

    const valorOriginal = Number(orig.valor_servico ?? orig.invoice_value ?? 0)
    const valor = novo_valor === undefined || novo_valor === null || novo_valor === ''
      ? valorOriginal
      : Number(novo_valor)

    if (!(valor > 0)) {
      return res.status(422).json({ error: `Valor inválido para a nota substituta (${novo_valor})` })
    }

    // ⚠️ A recusa vem ANTES de transmitir. Deixar o SEFIN devolver o E0063
    // gastaria um número de DPS e devolveria ao usuário um texto de schema no
    // lugar da explicação — e do caminho que resolve.
    const mudaValor = Math.abs(valor - valorOriginal) > 0.004
    if (mudaValor && SIMPLES_TRAVADO.has(Number(emit.opta_simples ?? 3))) {
      return res.status(422).json({
        error: 'Substituição não pode alterar o valor do serviço neste regime',
        detalhe:
          'O SEFIN recusa com E0063: para optante do Simples Nacional ME/EPP, a nota substituta tem de manter competência, tomador e valor da original.',
        valor_original: valorOriginal,
        valor_pedido: valor,
        alternativa:
          'Para corrigir o valor: cancele a nota (⚠️ há prazo) e emita uma nova. São dois atos fiscais distintos.',
      })
    }

    const [{ proximo }] = await sql`
      UPDATE nfse_emitter_settings
      SET ultimo_dps = CASE WHEN ${orig.ambiente === 1} THEN ultimo_dps + 1 ELSE ultimo_dps END,
          ultimo_dps_homolog = CASE WHEN ${orig.ambiente === 1} THEN ultimo_dps_homolog ELSE ultimo_dps_homolog + 1 END
      WHERE company_id = ${orig.company_id}
      RETURNING CASE WHEN ${orig.ambiente === 1} THEN ultimo_dps ELSE ultimo_dps_homolog END AS proximo`

    // A competência é a da nota ORIGINAL: alterá-la é o mesmo E0063.
    //
    // ⚠️ Foi pedido (2026-09-02) que a substituta usasse o dia da transmissão, como
    // a emissão passou a fazer. NÃO foi aplicado, e a razão está no cabeçalho deste
    // arquivo: o SEFIN recusa com E0063 — verificado em homologação com o
    // certificado da empresa — quando o emitente é Simples ME/EPP (opSimpNac 2 ou 3,
    // que é o caso da Lumen) e a substituta altera dCompet, tomador ou valor. Como a
    // substituição acontece em outro dia por definição, mudar aqui faria TODA
    // substituição ser recusada, e o erro só apareceria depois de a DPS já ter
    // consumido um número no fisco.
    //
    // dataISO trata o Date que vem de coluna `date` (chega com o offset
    // embutido) sem deslocar o dia — `toISOString()` cru devolveria a véspera.
    const competencia = orig.competencia
      ? dataISO(orig.competencia)
      : `${orig.year}-${String(orig.month || 1).padStart(2, '0')}-01`

    const dados = {
      ambiente: orig.ambiente ?? 2,
      serie: emit.serie || '00001',
      nDPS: proximo,
      dataEmissao: new Date(),
      substituicao: {
        chaveAcesso: orig.chave_acesso,
        codigoMotivo: String(codigo_motivo),
        motivo: String(motivo).trim(),
      },
      emitente: {
        cnpj: emit.cnpj, inscricaoMunicipal: emit.inscricao_municipal,
        razaoSocial: emit.razao_social, municipioCodigo: emit.municipio_codigo,
        endereco: {
          logradouro: emit.endereco, numero: emit.numero, complemento: emit.complemento,
          bairro: emit.bairro, cep: emit.cep, uf: emit.uf,
        },
        telefone: emit.telefone, email: emit.email,
        optaSimples: emit.opta_simples, regimeEspecial: emit.regime_especial,
      },
      tomador: {
        documento: orig.cpf_cnpj,
        razaoSocial: orig.client_razao || orig.client_name,
        inscricaoMunicipal: orig.client_im,
        endereco: {
          logradouro: orig.endereco, numero: orig.numero, complemento: orig.complemento,
          bairro: orig.bairro, cep: orig.cep, municipioCodigo: orig.municipio_codigo, uf: orig.uf,
        },
        email: orig.email, telefone: orig.telefone,
      },
      servico: {
        descricao: descricao || orig.descricao_nfse || `Serviços prestados — ${orig.month}/${orig.year}`,
        itemListaServico: emit.item_lista_servico,
        codigoTributacaoMunicipal: emit.codigo_tributacao_municipal,
        nbs: emit.nbs,
        municipioPrestacao: orig.invoice_municipio || emit.municipio_codigo,
        competencia,
      },
      valores: { servico: valor, aliquotaIss: emit.aliquota_iss ?? 0 },
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

    const cert = await nfseCertManager.getCertificateFromDB(sql, orig.company_id)
    const xmlAssinado = new NFSeSigner(cert.pfxBuffer, cert.password).assinarXML(xml)
    const ambienteNome = (orig.ambiente ?? 2) === 1 ? 'producao' : 'homologacao'

    if (transmitir !== true) {
      return res.status(200).json({
        success: true,
        preview: true,
        message: 'DPS substituta montada e assinada. Nada foi transmitido — envie transmitir: true.',
        ambiente: ambienteNome,
        resumo: {
          substitui: { emission_id: orig.id, nfse_number: orig.nfse_number, chave: orig.chave_acesso },
          valor: valor, valor_original: valorOriginal,
          competencia, motivo: String(motivo).trim(), codigo_motivo: String(codigo_motivo),
          dps_number: proximo,
        },
        xml_assinado: xmlAssinado,
      })
    }

    const adn = new NFSeADNClient({
      ambiente: ambienteNome, pfxBuffer: cert.pfxBuffer, senhaPfx: cert.password,
    })
    // Aberta antes de transmitir; o vínculo com a emissão nova (ou com a linha
    // de 'erro') é costurado nos dois desfechos abaixo.
    const opId = await abrirOperacao(sql, {
      company_id: orig.company_id, invoice_id: orig.invoice_id,
      operation_type: OPERACOES.SUBSTITUICAO, xml_enviado: xmlAssinado,
      ambiente: orig.ambiente ?? 2, dps_number: proximo,
    })

    const r = await adn.emitirNFSe(xmlAssinado)

    // ⚠️ Quando o fisco ACEITA, a original é marcada ANTES de a nova entrar —
    // na mesma transação. O índice `idx_nfse_emissions_invoice_unica` exclui
    // `substituida` e `erro`, mas a original ainda está `autorizada` no
    // instante do INSERT: inserir primeiro estoura a constraint e a nota que o
    // SEFIN já autorizou não seria gravada.
    if (!r.ok) {
      // Tentativa recusada: entra como 'erro', que o índice ignora.
      const [falha] = await sql`
        INSERT INTO nfse_emissions
          (company_id, invoice_id, status, dps_number, xml_assinado, json_response,
           competencia, valor_servico, municipio_codigo, ambiente, error_message,
           substitui, submitted_at)
        VALUES
          (${orig.company_id}, ${orig.invoice_id}, 'erro', ${proximo}, ${xmlAssinado},
           ${JSON.stringify(r.resposta ?? {})}, ${competencia}, ${valor},
           ${dados.servico.municipioPrestacao}, ${orig.ambiente ?? 2}, ${r.erro},
           ${orig.id}, NOW())
        RETURNING id`
      await fecharOperacao(sql, opId, r, { nfse_emission_id: falha.id })
      await registrarEvento(sql, falha.id, EVENTOS.ERRO, { acao: 'substituicao', erro: r.erro })
      return res.status(502).json({
        success: false,
        error: `O SEFIN recusou a substituição: ${r.erro}`,
        emissao_id: falha.id,
        http_status: r.status,
      })
    }

    const [, nova] = await sql.transaction([
      sql`
        UPDATE nfse_emissions
        SET status = 'substituida', updated_at = NOW()
        WHERE id = ${orig.id}`,
      sql`
        INSERT INTO nfse_emissions
          (company_id, invoice_id, nsu, protocol, nfse_number, status, dps_number,
           xml_assinado, xml_nfse, chave_acesso, json_response, competencia,
           valor_servico, municipio_codigo, ambiente, substitui,
           submitted_at, approved_at)
        VALUES
          (${orig.company_id}, ${orig.invoice_id}, ${r.nsu ?? null}, ${r.protocolo ?? null},
           ${r.numeroNfse ?? null}, ${r.chaveAcesso ? 'autorizada' : 'enviada'}, ${proximo},
           ${xmlAssinado}, ${r.nfseXml ?? null}, ${r.chaveAcesso ?? null},
           ${JSON.stringify(r.resposta ?? {})}, ${competencia}, ${valor},
           ${dados.servico.municipioPrestacao}, ${orig.ambiente ?? 2}, ${orig.id},
           NOW(), ${r.chaveAcesso ? new Date() : null})
        RETURNING id, status, nfse_number, chave_acesso`,
    ])

    const linhaNova = Array.isArray(nova) ? nova[0] : nova

    await fecharOperacao(sql, opId, r, { nfse_emission_id: linhaNova.id })

    // O vínculo de volta só pode ser gravado depois de a nova ter id.
    await sql`
      UPDATE nfse_emissions SET substituida_por = ${linhaNova.id} WHERE id = ${orig.id}`

    await registrarEvento(sql, orig.id, EVENTOS.SUBSTITUIDA, {
      motivo: String(motivo).trim(), por_emissao: linhaNova.id, nova_chave: linhaNova.chave_acesso,
    })
    await registrarEvento(sql, linhaNova.id, EVENTOS.AUTORIZADA, {
      substitui: orig.id, chave_substituida: orig.chave_acesso, numero: linhaNova.nfse_number,
    })

    return res.status(200).json({
      success: true,
      preview: false,
      ambiente: ambienteNome,
      substituida: { id: orig.id, nfse_number: orig.nfse_number },
      nova: linhaNova,
      // O financeiro NÃO foi tocado — dizer isso evita a leitura de que a
      // fatura acompanhou a nota.
      aviso: mudaValor
        ? 'A fatura não foi alterada. Para acertar o financeiro, estorne e refature em /billing.'
        : null,
    })
  } catch (err) {
    if (err.code === 'CERT_NOT_FOUND') {
      return res.status(422).json({ error: 'Certificado digital não configurado para esta empresa' })
    }
    console.error('[nfse-substituir] falha:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
