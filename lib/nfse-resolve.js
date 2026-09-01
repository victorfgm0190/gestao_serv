// Resolve QUAL emissão um pedido de download se refere.
//
// Os downloads aceitam três identificadores porque três telas têm três coisas
// na mão: a lista de NFS-e tem o id da linha, o faturamento tem o id da fatura,
// e quem atende o cliente ao telefone tem o número da nota.
//
// ⚠️ Um dono só para essa tradução. Se cada endpoint resolvesse por conta
// própria, "baixar o PDF" e "baixar o XML" poderiam responder por emissões
// DIFERENTES para o mesmo pedido — e isso não é hipótese: a substituição e o
// cancelamento fazem uma fatura ter mais de uma emissão (a 38 tem três: as
// notas 26 e 27 canceladas e a 28 vigente).
//
// ⚠️ `nfse_number` é BIGINT no banco e o driver o devolve como STRING ('28').
// Comparar com o número cru do JSON dá falso — o cast é explícito.

const IDENT = `id, company_id, invoice_id, ambiente, chave_acesso, nfse_number,
               status, cancelled_at, substituida_por,
               (xml_nfse IS NOT NULL) AS tem_oficial`

/** Erro com status HTTP e corpo prontos — quem chama só repassa. */
function recusa(status, body) {
  return { erro: { status, body } }
}

/**
 * @param {*} sql
 * @param {object} entrada  { emission_id | nfse_id | invoice_id | nfse_number }
 * @returns {Promise<{ emissao?: object, aviso?: string, erro?: {status,body} }>}
 */
export async function resolverEmissao(sql, entrada = {}) {
  const num = (v) => {
    const n = parseInt(v, 10)
    return Number.isInteger(n) ? n : null
  }

  // `nfse_id` é sinônimo de `emission_id` (o id da LINHA), não do número da
  // nota: é assim que todos os outros endpoints de NFS-e nomeiam esse id, e
  // dar dois sentidos ao mesmo parâmetro seria pior que aceitar dois nomes.
  const emissionId = num(entrada.emission_id ?? entrada.nfse_id)
  const invoiceId = num(entrada.invoice_id)
  const nfseNumber = entrada.nfse_number != null ? String(entrada.nfse_number).trim() : null

  if (emissionId) {
    const [e] = await sql`SELECT ${sql.unsafe(IDENT)} FROM nfse_emissions WHERE id = ${emissionId}`
    if (!e) return recusa(404, { error: 'Emissão não encontrada' })
    return { emissao: e }
  }

  if (nfseNumber) {
    if (!/^\d+$/.test(nfseNumber)) {
      return recusa(400, { error: `nfse_number inválido: ${nfseNumber}` })
    }
    const linhas = await sql`
      SELECT ${sql.unsafe(IDENT)} FROM nfse_emissions
      WHERE nfse_number = ${nfseNumber}::bigint ORDER BY id DESC`
    if (!linhas.length) {
      return recusa(404, { error: `Nenhuma NFS-e com o número ${nfseNumber}` })
    }
    // O número é do fisco e é único por emitente — mas o banco guarda duas
    // empresas e dois ambientes. Havendo mais de uma, escolher seria sortear.
    if (linhas.length > 1) {
      return recusa(409, {
        error: `Mais de uma emissão com o número ${nfseNumber}`,
        detalhe: 'Peça por emission_id.',
        emissoes: linhas.map((l) => ({
          emission_id: l.id, company_id: l.company_id, ambiente: l.ambiente, status: l.status,
        })),
      })
    }
    return { emissao: linhas[0] }
  }

  if (invoiceId) {
    const linhas = await sql`
      SELECT ${sql.unsafe(IDENT)} FROM nfse_emissions
      WHERE invoice_id = ${invoiceId} ORDER BY id DESC`
    if (!linhas.length) {
      return recusa(404, { error: `A fatura ${invoiceId} não tem NFS-e emitida` })
    }

    // Uma só: é ela, mesmo cancelada — baixar o XML de uma nota cancelada é
    // pedido legítimo (o cancelamento não apaga o documento). O aviso vai
    // junto para a tela não apresentá-la como vigente.
    if (linhas.length === 1) {
      const e = linhas[0]
      return {
        emissao: e,
        aviso: e.cancelled_at ? `A NFS-e ${e.nfse_number ?? e.id} desta fatura está CANCELADA.` : undefined,
      }
    }

    const vigentes = linhas.filter((l) => !l.cancelled_at && l.status !== 'erro')
    if (vigentes.length === 1) return { emissao: vigentes[0] }

    // Nenhuma vigente (ou duas) — escolher entre iguais é sortear, e o
    // resultado seria um documento fiscal errado entregue ao cliente.
    return recusa(409, {
      error: vigentes.length
        ? `A fatura ${invoiceId} tem ${vigentes.length} NFS-e vigentes`
        : `A fatura ${invoiceId} tem ${linhas.length} NFS-e, nenhuma vigente`,
      detalhe: 'Peça por emission_id.',
      emissoes: linhas.map((l) => ({
        emission_id: l.id, nfse_number: l.nfse_number, status: l.status,
        cancelada: Boolean(l.cancelled_at),
      })),
    })
  }

  return recusa(400, {
    error: 'Informe emission_id (ou nfse_id), invoice_id ou nfse_number',
  })
}

/** Nome de arquivo higienizado — o mesmo formato dos demais downloads. */
export function nomeArquivo(partes) {
  const limpa = (v) => String(v ?? '').replace(/[^\w.-]/g, '')
  return partes.map(limpa).filter(Boolean).join('_')
}

export default resolverEmissao
