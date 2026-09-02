import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import nfseCertManager from '../lib/nfse-cert-manager.js'
import { montarDPS, dataISO } from '../lib/nfse-xml-builder.js'
import { NFSeSigner } from '../lib/nfse-signer.js'
import { NFSeADNClient } from '../lib/nfse-adn-client.js'
import { registrarEvento, EVENTOS } from '../lib/nfse-events.js'
import { abrirOperacao, fecharOperacao, OPERACOES } from '../lib/nfse-operations.js'
import { CAMPOS_EMITENTE, CAMPOS_TOMADOR, faltantes } from '../lib/nfse-setup-check.js'

// Emissão de NFS-e a partir de uma fatura.
//
// POST /api/nfse-emit  { invoice_id, transmitir?, descricao_servico?, aliquota_iss? }
//
// ⚠️ PRÉVIA POR PADRÃO. Sem `transmitir: true` o endpoint monta e assina o XML,
// devolve tudo para conferência e NÃO envia nada — o mesmo desenho de
// `?action=recalcular` ("nada financeiro é gravado sem aplicar: true"). Aqui a
// razão é mais forte: transmitir cria um documento fiscal na Receita, e o
// cliente do ADN ainda não foi verificado contra o serviço real.

// ⚠️ As listas moram em lib/nfse-setup-check.js e são compartilhadas com
// /api/nfse-validate-setup. Duplicá-las aqui faria a tela de configuração e a
// emissão discordarem sobre o que é obrigatório — o validador liberando o que a
// emissão recusa, e vice-versa.

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
    // ⚠️ O tomador pode não ser o cliente do serviço: `invoice_client_id` é
    // herdado do contrato e congelado na fatura, e quando preenchido é ELE quem
    // recebe a nota. O COALESCE é a regra inteira, e está escrito igual em
    // api/nfse-emit.js, api/nfse-substituir.js e lib/nfse-setup-check.js — o
    // driver do Neon não compõe fragmentos, então o JOIN é repetido por extenso.
    // Divergir num deles faria a validação aprovar o cadastro de um cliente e a
    // emissão usar o de outro.
    const [inv] = await sql`
      SELECT i.id, i.company_id, i.client_id, i.invoice_client_id, i.invoice_value, i.contract_value,
             i.month, i.year, i.emission_date, i.require_nf, i.competencia,
             i.descricao_nfse, i.aliquota_iss, i.municipio_codigo AS invoice_municipio,
             i.invoice_number,
             cl.name AS client_name, cl.razao_social AS client_razao, cl.cpf_cnpj,
             cl.endereco, cl.numero, cl.complemento, cl.bairro, cl.cep,
             cl.municipio_codigo, cl.uf, cl.email, cl.telefone,
             cl.inscricao_municipal AS client_im
      FROM invoices i
      JOIN clients cl ON cl.id = COALESCE(i.invoice_client_id, i.client_id)
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
    //
    // 🐞 E a competência é GRAVADA como string, via dataISO. Passar
    // `${new Date('2026-06-01')}` ao driver grava **2026-05-31**: o valor é
    // meia-noite UTC e o cast para `date` acontece no fuso local (UTC-3).
    // Medido contra o banco: string → 2026-06-01, Date → 2026-05-31. O erro
    // não afetava a nota transmitida (o XML usa dataISO), só a coluna — e a
    // substituição, que lê a competência de volta e era recusada com E0063
    // por "alterar" um campo que ela não alterou.
    const competencia =
      inv.competencia || `${inv.year}-${String(inv.month || 1).padStart(2, '0')}-01`
    const aliquota = aliquota_iss ?? inv.aliquota_iss ?? emit.aliquota_iss ?? 0

    // ⚠️ O ambiente precisa ser resolvido ANTES de numerar: o contador é por
    // ambiente, e pegar o número do lado errado empurra a numeração fiscal de
    // produção a cada teste em homologação.
    // NFSE_AMBIENTE força o destino sem mexer no cadastro; só 'producao'
    // explícito manda para valer.
    const ambienteNome = process.env.NFSE_AMBIENTE
      ? (process.env.NFSE_AMBIENTE === 'producao' ? 'producao' : 'homologacao')
      : ((emit.ambiente ?? 2) === 1 ? 'producao' : 'homologacao')
    const ehProducao = ambienteNome === 'producao'

    // Contador MONOTÔNICO e POR AMBIENTE. O número da DPS é consumido no
    // fisco: apagar a linha aqui não o devolve, e recontar do zero bate em
    // E0014 ("série + número + município + CNPJ já existe"). O
    // UPDATE ... RETURNING é atômico, então duas emissões simultâneas nunca
    // recebem o mesmo número.
    const [{ proximo }] = ehProducao
      ? await sql`
          UPDATE nfse_emitter_settings SET ultimo_dps = ultimo_dps + 1
          WHERE company_id = ${inv.company_id}
          RETURNING ultimo_dps AS proximo`
      : await sql`
          UPDATE nfse_emitter_settings SET ultimo_dps_homolog = ultimo_dps_homolog + 1
          WHERE company_id = ${inv.company_id}
          RETURNING ultimo_dps_homolog AS proximo`

    const dados = {
      ambiente: ehProducao ? 1 : 2,
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
    // NFSE_AMBIENTE força o destino sem mexer no cadastro — válvula para testar
    // em homologação mesmo com o emitente já marcado como produção. Só
    // 'producao' explícito manda para valer; qualquer outro valor é homologação.
    const adn = new NFSeADNClient({
      ambiente: ambienteNome, pfxBuffer: cert.pfxBuffer, senhaPfx: cert.password,
    })

    // ⚠️ A operação é aberta ANTES de transmitir, e o `nfse_emission_id` fica
    // nulo por ora: a linha de `nfse_emissions` só nasce depois da resposta (é
    // o desfecho que decide status e número). Se a função morrer no meio da
    // chamada, sobra a linha em 'enviado' com a DPS que saiu e o número já
    // consumido no fisco — a única pista de que uma nota pode existir lá sem
    // existir aqui.
    const opId = await abrirOperacao(sql, {
      company_id: inv.company_id, invoice_id: inv.id,
      operation_type: OPERACOES.EMISSAO, xml_enviado: xmlAssinado,
      ambiente: ehProducao ? 1 : 2, dps_number: proximo,
    })

    const r = await adn.emitirNFSe(xmlAssinado)

    // A tentativa é gravada nos DOIS desfechos. Uma emissão que falhou sem
    // deixar registro é indistinguível de uma que nunca foi tentada — e é
    // exatamente ela que precisa ser investigada depois.
    const [linha] = await sql`
      INSERT INTO nfse_emissions
        (company_id, invoice_id, nsu, protocol, nfse_number, status, dps_number,
         xml_assinado, xml_nfse, chave_acesso, json_response, competencia,
         valor_servico, municipio_codigo, ambiente, error_message,
         submitted_at, approved_at)
      VALUES
        (${inv.company_id}, ${invoice_id}, ${r.nsu ?? null}, ${r.protocolo ?? null},
         ${r.numeroNfse ?? null},
         -- Chave de acesso devolvida = nota AUTORIZADA, não apenas enviada.
         ${r.ok ? (r.chaveAcesso ? 'autorizada' : 'enviada') : 'erro'}, ${proximo},
         ${xmlAssinado}, ${r.nfseXml ?? null}, ${r.chaveAcesso ?? null},
         ${JSON.stringify(r.resposta ?? {})},
         ${dataISO(competencia)}, ${valorServico},
         ${dados.servico.municipioPrestacao}, ${ehProducao ? 1 : 2},
         ${r.ok ? null : r.erro}, NOW(), ${r.chaveAcesso ? new Date() : null})
      RETURNING id, status, nsu, protocol, nfse_number, chave_acesso`

    // Costura o vínculo agora que a emissão existe.
    await fecharOperacao(sql, opId, r, { nfse_emission_id: linha.id })

    // A timeline começa aqui. Sem estes registros ela nasceria vazia e a tela
    // mostraria "Nenhum evento" para uma nota que acabou de ser transmitida.
    // O instante é distinto em cada um: o índice único é
    // (emissão, tipo, instante), e três eventos no mesmo milissegundo fariam
    // dois deles serem descartados pelo ON CONFLICT.
    const t0 = Date.now()
    await registrarEvento(sql, linha.id, EVENTOS.CRIADA,
      { invoice_id: invoice_id, valor: valorServico }, { quando: new Date(t0) })
    await registrarEvento(sql, linha.id, EVENTOS.ASSINADA,
      { dps: proximo }, { quando: new Date(t0 + 1) })
    await registrarEvento(sql, linha.id,
      r.ok ? (r.chaveAcesso ? EVENTOS.AUTORIZADA : EVENTOS.ENVIADA) : EVENTOS.ERRO,
      r.ok ? { chave: r.chaveAcesso, numero: r.numeroNfse } : { erro: r.erro, http: r.status },
      { quando: new Date(t0 + 2) })

    if (!r.ok) {
      return res.status(502).json({
        success: false,
        error: `O SEFIN recusou a emissão: ${r.erro}`,
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
