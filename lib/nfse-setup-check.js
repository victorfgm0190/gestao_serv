import nfseCertManager from './nfse-cert-manager.js'

// Dono único de "o que falta para conseguir emitir uma NFS-e".
//
// ⚠️ Esta lista tem de ser a MESMA que api/nfse-emit.js aplica antes de montar
// a DPS. Duas listas divergem, e a divergência é pior que não validar: o
// validador diz "tudo configurado" e a emissão devolve 422, ou o contrário —
// a tela trava num campo que a emissão nem usa. É a história do pró-labore com
// três donos, aplicada à validação.
//
// ⚠️ A lista do esboço divergia nos dois sentidos ao mesmo tempo:
//   · EXIGIA `nbs_codigo` e `codigo_tributacao` — que em lib/nfse-xml-builder.js
//     são `tagOpcional` (cNBS e cTribMun saem do XML se estiverem vazios);
//   · OMITIA `cnpj`, `razao_social`, `uf` e `item_lista_servico` — este último
//     é o `cTribNac`, campo OBRIGATÓRIO da DPS.
//   Ou seja: barrava quem podia emitir e liberava quem não podia.

// Campo no banco → rótulo para quem vai preencher.
// ⚠️ `inscricao_municipal` NÃO está aqui: é opcional no Emissor Nacional
// (decisão do Victor, 2026-08-19). O campo continua existindo na tela e no
// banco — várias prefeituras a exigem —, mas a falta dele não bloqueia mais a
// emissão. Ver o `tagOpcional('IM', …)` em lib/nfse-xml-builder.js: tirar a
// exigência sem tirar a tag geraria `<IM></IM>`, recusado no schema.
export const CAMPOS_EMITENTE = [
  ['cnpj', 'CNPJ'],
  ['razao_social', 'Razão social'],
  ['endereco', 'Logradouro'],
  ['numero', 'Número'],
  ['bairro', 'Bairro'],
  ['cep', 'CEP'],
  ['municipio_codigo', 'Código IBGE do município'],
  ['uf', 'UF'],
  ['item_lista_servico', 'Item da lista de serviços'],
]

export const CAMPOS_TOMADOR = [
  ['cpf_cnpj', 'CPF/CNPJ'],
  ['endereco', 'Logradouro'],
  ['numero', 'Número'],
  ['bairro', 'Bairro'],
  ['cep', 'CEP'],
  ['municipio_codigo', 'Código IBGE do município'],
]

const vazio = (v) => v === null || v === undefined || String(v).trim() === ''

/** Campos ausentes de uma linha, já rotulados. */
export function faltantes(linha, campos, prefixo) {
  return campos
    .filter(([col]) => vazio(linha?.[col]))
    .map(([col, rotulo]) => ({ campo: `${prefixo}.${col}`, rotulo: `${prefixo}: ${rotulo}` }))
}

/**
 * Diagnóstico completo do setup de uma empresa (e, opcionalmente, do tomador
 * de uma fatura).
 *
 * Nunca lança por falta de dado — falta de dado É o resultado.
 */
export async function verificarSetup(sql, companyId, invoiceId = null) {
  const resultado = {
    pronto: false,
    emitente: { configurado: false, completo: false, faltando: [] },
    certificado: { presente: false, valido: false, motivo: null, dias_restantes: null },
    tomador: null,
    faltando: [],
  }

  // ---- emitente ----
  const [emit] = await sql`
    SELECT * FROM nfse_emitter_settings WHERE company_id = ${companyId}`

  if (!emit) {
    resultado.emitente.faltando = CAMPOS_EMITENTE.map(([c, r]) => ({
      campo: `emitente.${c}`, rotulo: `Emitente: ${r}`,
    }))
  } else {
    resultado.emitente.configurado = true
    resultado.emitente.faltando = faltantes(emit, CAMPOS_EMITENTE, 'emitente')
    resultado.emitente.completo = resultado.emitente.faltando.length === 0
    resultado.emitente.ambiente = emit.ambiente ?? 2
  }
  resultado.faltando.push(...resultado.emitente.faltando)

  // ---- certificado ----
  // ⚠️ O certificado NÃO mora em nfse_emitter_settings. O esboço checava
  // `certificado_pfx_iv` ali; a coluna não existe (o cofre é nfse_certificates,
  // com `certificate_pfx_iv`) e a query inteira falharia com erro de coluna.
  try {
    const val = await nfseCertManager.validateCertificate(sql, companyId)
    resultado.certificado = {
      presente: true,
      // ⚠️ Presente não basta: certificado VENCIDO não assina. Verificar só a
      // existência deixaria a tela dizer "tudo pronto" para uma emissão que
      // falha na assinatura.
      valido: val.valid,
      motivo: val.reason,
      dias_restantes: val.daysRemaining,
      titular: val.subject,
    }
    if (!val.valid) {
      resultado.faltando.push({
        campo: 'certificado', rotulo: `Certificado digital: ${val.reason}`,
      })
    }
  } catch (err) {
    if (err.code === 'CERT_NOT_FOUND') {
      resultado.faltando.push({ campo: 'certificado', rotulo: 'Certificado digital (.pfx) não enviado' })
    } else {
      throw err
    }
  }

  // ---- tomador (opcional) ----
  if (invoiceId) {
    const [inv] = await sql`
      SELECT i.id, i.require_nf, cl.id AS client_id, cl.name, cl.razao_social,
             cl.cpf_cnpj, cl.endereco, cl.numero, cl.bairro, cl.cep, cl.municipio_codigo, cl.uf
      FROM invoices i JOIN clients cl ON cl.id = COALESCE(i.invoice_client_id, i.client_id)
      WHERE i.id = ${invoiceId}`

    if (!inv) {
      resultado.tomador = { encontrado: false }
      resultado.faltando.push({ campo: 'fatura', rotulo: 'Fatura não encontrada' })
    } else if (inv.require_nf === false) {
      // Não é pendência a resolver: é o contrato que não emite nota. Listar
      // campos faltantes aqui mandaria preencher cadastro para uma nota que
      // não deve existir.
      resultado.tomador = {
        encontrado: true, cliente: inv.razao_social || inv.name,
        sem_nf: true, faltando: [],
      }
    } else {
      const falta = faltantes(inv, CAMPOS_TOMADOR, 'tomador')
      if (!inv.razao_social && !inv.name) {
        falta.push({ campo: 'tomador.razao_social', rotulo: 'tomador: Razão social' })
      }
      resultado.tomador = {
        encontrado: true, cliente: inv.razao_social || inv.name,
        client_id: inv.client_id, sem_nf: false,
        completo: falta.length === 0, faltando: falta,
      }
      resultado.faltando.push(...falta)
    }
  }

  resultado.pronto = resultado.faltando.length === 0
  return resultado
}
