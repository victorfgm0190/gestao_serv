// Trilha das operações de NFS-e: o que saiu daqui e o que o SEFIN devolveu.
//
// Um dono só para o vocabulário e para a gravação — o mesmo motivo de
// `lib/nfse-events.js` e de `CATS` ao lado de `montarNotes()`: tipo gravado com
// um nome e lido com outro some do filtro sem erro nenhum.
//
// ⚠️ NENHUMA função daqui lança. A trilha é registro auxiliar; deixar uma
// emissão fiscal falhar porque a linha de auditoria não entrou seria trocar o
// essencial pelo acessório. A falha vai para o log — como em `registrarEvento`.

export const OPERACOES = {
  EMISSAO: 'emit',
  SUBSTITUICAO: 'substitute',
  CANCELAMENTO: 'cancel',
  CONSULTA: 'consult',
  SINCRONIZACAO: 'sync',
}

export const ROTULOS_OPERACAO = {
  [OPERACOES.EMISSAO]: 'Emissão',
  [OPERACOES.SUBSTITUICAO]: 'Substituição',
  [OPERACOES.CANCELAMENTO]: 'Cancelamento',
  [OPERACOES.CONSULTA]: 'Consulta ao portal',
  [OPERACOES.SINCRONIZACAO]: 'Sincronização de cancelamento',
}

// enviado → o pedido saiu e ainda não sabemos o desfecho.
export const STATUS_OPERACAO = { ENVIADO: 'enviado', SUCESSO: 'sucesso', ERRO: 'erro' }

/**
 * Primeiro código de erro devolvido pelo SEFIN (E0063, E1235…).
 *
 * ⚠️ Os campos vêm com inicial MAIÚSCULA na resposta real — a mesma pegadinha
 * documentada em `NFSeADNClient.motivoDoErro`. Ler só `codigo` minúsculo
 * deixaria a coluna sempre nula.
 */
export function codigoDoErro(resposta) {
  const erros = resposta?.erros
  if (!Array.isArray(erros) || !erros.length) return null
  const c = erros[0]?.Codigo ?? erros[0]?.codigo ?? null
  return c ? String(c).slice(0, 50) : null
}

/**
 * Abre a operação ANTES de transmitir e devolve o id.
 *
 * ⚠️ O INSERT é anterior à chamada de propósito, e o custo (uma ida ao banco)
 * compra a única informação que não dá para reconstruir depois: quando a função
 * morre entre o envio e a resposta — timeout da Vercel, queda de rede — a
 * operação FICA em 'enviado', com o XML que saiu e o número da DPS já consumido
 * no fisco. Sem ela, uma nota autorizada no SEFIN sem registro aqui é
 * indistinguível de uma que nunca foi tentada.
 *
 * ⚠️ `nfse_emission_id` fica nulo aqui porque a linha de `nfse_emissions` ainda
 * não existe: em /api/nfse-emit e /api/nfse-substituir ela é criada DEPOIS da
 * resposta (é o desfecho que decide status e número). `fecharOperacao` costura.
 */
export async function abrirOperacao(sql, {
  company_id, invoice_id = null, nfse_emission_id = null,
  operation_type, xml_enviado = null, ambiente = null, dps_number = null,
}) {
  try {
    const [linha] = await sql`
      INSERT INTO nfse_operations
        (company_id, invoice_id, nfse_emission_id, operation_type,
         xml_enviado, status, ambiente, dps_number, enviado_em)
      VALUES
        (${company_id}, ${invoice_id}, ${nfse_emission_id}, ${operation_type},
         ${xml_enviado}, ${STATUS_OPERACAO.ENVIADO}, ${ambiente}, ${dps_number}, NOW())
      RETURNING id`
    return linha?.id ?? null
  } catch (err) {
    console.error(`[nfse-operations] falha ao abrir ${operation_type}:`, err.message)
    return null
  }
}

/**
 * Fecha a operação com o desfecho normalizado do NFSeADNClient
 * (`{ ok, status, erro, resposta, nfseXml }`).
 *
 * ⚠️ O UPDATE é por `id`, devolvido pelo `abrirOperacao`. O esboço fechava com
 * `UPDATE … WHERE nfse_emission_id = X ORDER BY enviado_em DESC LIMIT 1` — que
 * não é SQL válido no Postgres (UPDATE não aceita ORDER BY/LIMIT) e, além
 * disso, procurava por uma coluna que ainda estava nula.
 */
export async function fecharOperacao(sql, operationId, r, extras = {}) {
  if (!operationId) return
  const { nfse_emission_id = null, dps_number = null } = extras
  try {
    await sql`
      UPDATE nfse_operations SET
        status        = ${r?.ok ? STATUS_OPERACAO.SUCESSO : STATUS_OPERACAO.ERRO},
        -- ⚠️ O XML da resposta é o nfseXml (a NFS-e autorizada), não o JSON
        -- serializado: é ele o documento fiscal, e é o que se abre quando algo
        -- precisa ser conferido.
        xml_resposta  = ${r?.nfseXml ?? null},
        json_resposta = ${JSON.stringify(r?.resposta ?? {})}::jsonb,
        erro_mensagem = ${r?.ok ? null : (r?.erro ?? null)},
        erro_codigo   = ${r?.ok ? null : codigoDoErro(r?.resposta)},
        http_status   = ${r?.status ?? null},
        -- COALESCE nos dois: fechar a operação não pode APAGAR o vínculo nem o
        -- número que a abertura já conhecia.
        nfse_emission_id = COALESCE(${nfse_emission_id}::bigint, nfse_emission_id),
        dps_number       = COALESCE(${dps_number}::int, dps_number),
        respondido_em = NOW()
      WHERE id = ${operationId}`
  } catch (err) {
    console.error('[nfse-operations] falha ao fechar operação:', err.message)
  }
}

/**
 * Operação que não transmite nada — a sincronização de cancelamento. Entra
 * completa numa linha só: não há janela entre envio e resposta a registrar.
 */
export async function registrarOperacaoLocal(sql, {
  company_id, invoice_id = null, nfse_emission_id = null,
  operation_type, json_resposta = {}, ambiente = null,
}) {
  try {
    const [linha] = await sql`
      INSERT INTO nfse_operations
        (company_id, invoice_id, nfse_emission_id, operation_type,
         json_resposta, status, ambiente, enviado_em, respondido_em)
      VALUES
        (${company_id}, ${invoice_id}, ${nfse_emission_id}, ${operation_type},
         ${JSON.stringify(json_resposta ?? {})}::jsonb, ${STATUS_OPERACAO.SUCESSO},
         ${ambiente}, NOW(), NOW())
      RETURNING id`
    return linha?.id ?? null
  } catch (err) {
    console.error(`[nfse-operations] falha ao registrar ${operation_type}:`, err.message)
    return null
  }
}
