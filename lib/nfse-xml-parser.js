import { DOMParser } from '@xmldom/xmldom'

// Lê de volta a DPS que foi assinada e transmitida.
//
// ⚠️ O DANFSE é desenhado a partir DESTE xml, não do estado atual do banco. A
// nota é um documento congelado: se o endereço do emitente mudar, se a alíquota
// do município for revista ou se o cadastro do cliente for corrigido, o
// comprovante de uma nota de seis meses atrás tem de continuar mostrando o que
// foi efetivamente declarado. Reconsultar as tabelas — como fazia o esboço —
// produz um PDF que diverge da nota que ele diz representar.

const parser = new DOMParser({
  // xmldom grita em stderr por padrão; num endpoint isso vira ruído de log.
  onError: () => {},
})

const txt = (no, tag) => {
  const el = no?.getElementsByTagName(tag)?.[0]
  return el ? el.textContent : null
}

const num = (v) => {
  // ⚠️ Tag ausente tem de virar null, não 0. `Number(null)` é 0 e passa em
  // `isFinite` — uma alíquota que não existe no XML viraria "0,00%" no DANFSE,
  // afirmando isenção onde o dado apenas não foi declarado.
  if (v === null || v === undefined || String(v).trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * @param {string} xml  DPS assinada
 * @returns {object|null} dados normalizados, ou null se o XML não for uma DPS
 */
export function lerDPS(xml) {
  if (!xml || typeof xml !== 'string') return null

  let doc
  try {
    doc = parser.parseFromString(xml, 'text/xml')
  } catch {
    return null
  }

  const inf = doc?.getElementsByTagName('infDPS')?.[0]
  if (!inf) return null

  const prest = inf.getElementsByTagName('prest')[0]
  const toma = inf.getElementsByTagName('toma')[0]
  const serv = inf.getElementsByTagName('serv')[0]
  const valores = inf.getElementsByTagName('valores')[0]

  const endereco = (no) => {
    if (!no) return {}
    const end = no.getElementsByTagName('end')[0]
    if (!end) return {}
    return {
      logradouro: txt(end, 'xLgr'),
      numero: txt(end, 'nro'),
      complemento: txt(end, 'xCpl'),
      bairro: txt(end, 'xBairro'),
      municipioCodigo: txt(end, 'cMun'),
      cep: txt(end, 'CEP'),
    }
  }

  // CNPJ e CPF são mutuamente exclusivos no bloco; qual veio importa para o
  // rótulo impresso no PDF.
  const documento = (no) => {
    const cnpj = txt(no, 'CNPJ')
    if (cnpj) return { tipo: 'CNPJ', valor: cnpj }
    const cpf = txt(no, 'CPF')
    if (cpf) return { tipo: 'CPF', valor: cpf }
    return { tipo: null, valor: null }
  }

  const valorServico = num(txt(valores, 'vServ'))
  const aliquota = num(txt(valores, 'pAliq'))
  // ISS não vem na DPS — é o município que apura. Deriva-se quando há alíquota,
  // e fica nulo quando não há: imprimir "R$ 0,00" afirmaria isenção.
  const iss = valorServico != null && aliquota != null
    ? Math.round(valorServico * (aliquota / 100) * 100) / 100
    : null

  // ⚠️ Na NFS-e AUTORIZADA o bloco <emit> traz razão social e endereço do
  // prestador, preenchidos pelo cadastro nacional. A DPS não os tem — o SEFIN
  // proíbe enviá-los (E0121/E0128) —, então sem esta leitura o DANFSE de uma
  // nota autorizada mostraria o prestador só pelo CNPJ.
  const emitNode = doc.getElementsByTagName('emit')[0]
  const enderNac = emitNode?.getElementsByTagName('enderNac')[0]
  const prestadorAutorizado = emitNode ? {
    razaoSocial: txt(emitNode, 'xNome'),
    endereco: {
      logradouro: txt(emitNode, 'xLgr'),
      numero: txt(emitNode, 'nro'),
      complemento: txt(emitNode, 'xCpl'),
      bairro: txt(emitNode, 'xBairro'),
      municipioCodigo: enderNac ? txt(enderNac, 'cMun') : null,
      cep: enderNac ? txt(enderNac, 'CEP') : null,
      uf: enderNac ? txt(enderNac, 'UF') : null,
    },
  } : null

  return {
    id: inf.getAttribute('Id'),
    // Presente só quando o XML é a nota autorizada, não a DPS.
    numeroNfse: txt(doc, 'nNFSe'),
    autorizada: Boolean(emitNode),
    ambiente: num(txt(inf, 'tpAmb')),
    dataEmissao: txt(inf, 'dhEmi'),
    serie: txt(inf, 'serie'),
    numeroDps: txt(inf, 'nDPS'),
    competencia: txt(inf, 'dCompet'),
    municipioEmissao: txt(inf, 'cLocEmi'),
    assinado: doc.getElementsByTagName('Signature').length > 0,

    prestador: {
      documento: documento(prest),
      inscricaoMunicipal: txt(prest, 'IM'),
      // O <emit> da nota autorizada tem prioridade: é o dado oficial.
      razaoSocial: prestadorAutorizado?.razaoSocial ?? txt(prest, 'xNome'),
      endereco: prestadorAutorizado?.endereco ?? endereco(prest),
      telefone: txt(prest, 'fone'),
      email: txt(prest, 'email'),
    },
    tomador: {
      documento: documento(toma),
      inscricaoMunicipal: txt(toma, 'IM'),
      razaoSocial: txt(toma, 'xNome'),
      endereco: endereco(toma),
      telefone: txt(toma, 'fone'),
      email: txt(toma, 'email'),
    },
    servico: {
      descricao: txt(serv, 'xDescServ'),
      itemListaServico: txt(serv, 'cTribNac'),
      codigoTributacaoMunicipal: txt(serv, 'cTribMun'),
      nbs: txt(serv, 'cNBS'),
      municipioPrestacao: txt(serv, 'cLocPrestacao'),
    },
    valores: { servico: valorServico, aliquotaIss: aliquota, iss },
  }
}

export default lerDPS
