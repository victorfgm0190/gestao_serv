// Monta a DPS (Declaração de Prestação de Serviços) do padrão NACIONAL de
// NFS-e — namespace http://www.sped.fazenda.gov.br/nfse, que é o que a API do
// ADN (adn.nfse.gov.br) recebe.
//
// ⚠️ O esboço dizia "ABRASF 2.04" e montava um terceiro formato, que não é
// nenhum dos dois: tags `<Nota>`, `<InfNFSe>`, `<Ide>`, `<Emit>`, `<TomInfo>`,
// `<Trib>` não existem nem no ABRASF (que usa `<Rps>` /
// `<InfDeclaracaoPrestacaoServico>` e vai para o webservice da PREFEITURA) nem
// no padrão nacional (que usa `<DPS>`/`<infDPS>` e vai para o ADN). Como o
// cliente HTTP do próprio esboço aponta para o ADN, o formato correto é o
// nacional. Um XML com o outro conjunto de tags é rejeitado no schema antes de
// qualquer validação de conteúdo.
//
// ⚠️ O esboço também misturava jurisdições: `<cUF>35</cUF>` (São Paulo) ao lado
// de `municipio_codigo` 4106902 (Maringá/PR). Aqui a UF não é digitada em
// separado — ela é consequência do município de emissão.
//
// ⚠️ NÃO VALIDADO CONTRA O XSD OFICIAL. A estrutura segue a documentação do
// layout, mas o pacote de schemas do ADN não está neste repositório e nenhuma
// nota foi transmitida. Antes de ir para produção, validar contra o XSD e
// emitir em homologação (ambiente = 2).

const VERSAO_LAYOUT = '1.00'

// ---------------------------------------------------------------------------
// utilitários

export function escaparXML(texto) {
  if (texto === null || texto === undefined) return ''
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export const soDigitos = (v) => String(v ?? '').replace(/\D/g, '')

/** 1234.5 → "1234.50". Valor fiscal nunca vai em notação científica. */
export function decimal(v, casas = 2) {
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`Valor numérico inválido: ${v}`)
  return n.toFixed(casas)
}

/**
 * AAAA-MM-DD. O argumento é tratado como DATA DE CALENDÁRIO, não como instante.
 *
 * ⚠️ String no formato AAAA-MM-DD sai como entrou. `new Date('2026-08-01')` é
 * meia-noite **UTC**; deslocar para São Paulo joga para 2026-07-31 e a
 * competência da nota vai para o mês anterior — o tipo de erro que só aparece
 * na virada de mês, quando a apuração já fechou. Já um `Date` vindo de coluna
 * `date` do Postgres chega com o offset embutido (03:00Z), e aí o
 * deslocamento é justamente o que devolve o dia certo.
 */
export function dataISO(d) {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10)
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) throw new Error(`Data inválida: ${d}`)
  const sp = new Date(dt.getTime() - 3 * 3600 * 1000)
  return sp.toISOString().slice(0, 10)
}

/**
 * AAAA-MM-DDThh:mm:ss-03:00.
 *
 * ⚠️ Montado à mão, sem `toLocaleString('pt-BR')`: num runtime sem ICU completo
 * ele cai em silêncio para o formato inglês — a mesma armadilha já documentada
 * nas fórmulas da memória de cálculo.
 */
export function dataHoraISO(d) {
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) throw new Error(`Data inválida: ${d}`)
  const sp = new Date(dt.getTime() - 3 * 3600 * 1000)
  return `${sp.toISOString().slice(0, 19)}-03:00`
}

/**
 * Id da DPS: "DPS" + cLocEmi(7) + tpInsc(1) + inscrição federal(14) +
 * série(5) + nDPS(15) = 45 caracteres.
 *
 * ⚠️ O esboço usava `Date.now().toString(36)`. Além de não ter o formato, ele
 * muda a cada chamada: reenviar a MESMA nota geraria um Id novo, e o ADN não
 * teria como reconhecer a duplicata — a proteção contra emitir duas vezes
 * depende de o identificador ser derivado dos dados, não do relógio.
 */
export function montarIdDPS({ cLocEmi, cnpjEmitente, serie, nDPS }) {
  const mun = soDigitos(cLocEmi).padStart(7, '0')
  const insc = soDigitos(cnpjEmitente).padStart(14, '0')
  const tpInsc = soDigitos(cnpjEmitente).length > 11 ? '1' : '2'
  return `DPS${mun}${tpInsc}${insc}${String(serie).padStart(5, '0')}${String(nDPS).padStart(15, '0')}`
}

const tag = (nome, valor) => `<${nome}>${escaparXML(valor)}</${nome}>`
const tagOpcional = (nome, valor) =>
  valor === null || valor === undefined || valor === '' ? '' : tag(nome, valor)

// ---------------------------------------------------------------------------
// validação

// Campo → rótulo legível. A mensagem de erro é lida por quem cadastra o
// emitente, não por quem escreveu o código.
const OBRIGATORIOS = [
  ['emitente.cnpj', 'CNPJ do emitente'],
  ['emitente.inscricaoMunicipal', 'Inscrição municipal do emitente'],
  ['emitente.razaoSocial', 'Razão social do emitente'],
  ['emitente.municipioCodigo', 'Código IBGE do município do emitente'],
  ['emitente.endereco.logradouro', 'Logradouro do emitente'],
  ['emitente.endereco.numero', 'Número do endereço do emitente'],
  ['emitente.endereco.bairro', 'Bairro do emitente'],
  ['emitente.endereco.cep', 'CEP do emitente'],
  ['emitente.endereco.uf', 'UF do emitente'],
  ['tomador.documento', 'CNPJ/CPF do tomador'],
  ['tomador.razaoSocial', 'Razão social do tomador'],
  ['tomador.endereco.municipioCodigo', 'Código IBGE do município do tomador'],
  ['tomador.endereco.logradouro', 'Logradouro do tomador'],
  ['tomador.endereco.numero', 'Número do endereço do tomador'],
  ['tomador.endereco.bairro', 'Bairro do tomador'],
  ['tomador.endereco.cep', 'CEP do tomador'],
  ['servico.descricao', 'Descrição do serviço'],
  ['servico.itemListaServico', 'Item da lista de serviços (cTribNac)'],
  ['servico.municipioPrestacao', 'Município da prestação do serviço'],
  ['servico.competencia', 'Competência'],
  ['valores.servico', 'Valor do serviço'],
]

const buscar = (obj, caminho) =>
  caminho.split('.').reduce((acc, parte) => (acc == null ? undefined : acc[parte]), obj)

/**
 * Devolve TODOS os campos faltantes, não só o primeiro.
 *
 * ⚠️ O esboço lançava no primeiro ausente. Com 21 campos obrigatórios e nenhum
 * deles cadastrado hoje, seriam 21 viagens de tentativa e erro para descobrir
 * o que preencher.
 */
export function camposFaltantes(dados) {
  const faltando = []
  for (const [caminho, rotulo] of OBRIGATORIOS) {
    const v = buscar(dados, caminho)
    // 0 é ausente só para valor de serviço; para os demais, string vazia é.
    const vazio = v === null || v === undefined || String(v).trim() === ''
    if (vazio) faltando.push({ campo: caminho, rotulo })
  }
  const valor = Number(buscar(dados, 'valores.servico'))
  if (Number.isFinite(valor) && valor <= 0) {
    faltando.push({ campo: 'valores.servico', rotulo: 'Valor do serviço deve ser maior que zero' })
  }
  return faltando
}

// ---------------------------------------------------------------------------
// montagem

function blocoEndereco(end, municipioCodigo) {
  return [
    '<end>',
    '<endNac>',
    tag('cMun', soDigitos(municipioCodigo)),
    tag('CEP', soDigitos(end.cep)),
    '</endNac>',
    tag('xLgr', end.logradouro),
    tag('nro', end.numero),
    tagOpcional('xCpl', end.complemento),
    tag('xBairro', end.bairro),
    '</end>',
  ].join('')
}

function blocoDocumento(documento) {
  const d = soDigitos(documento)
  // 14 dígitos = CNPJ, 11 = CPF. O esboço decidia por um campo `tipo` que o
  // chamador precisava lembrar de mandar — e no teste dele esse campo não ia,
  // caindo no ramo do CPF com `cpf` undefined e estourando em `.replace`.
  if (d.length === 14) return tag('CNPJ', d)
  if (d.length === 11) return tag('CPF', d)
  throw new Error(`Documento do tomador deve ter 11 (CPF) ou 14 (CNPJ) dígitos; recebido ${d.length}`)
}

/**
 * @param {object} dados { emitente, tomador, servico, valores, ambiente, serie, nDPS, dataEmissao }
 * @returns {string} XML da DPS, sem assinatura
 */
export function montarDPS(dados) {
  const faltando = camposFaltantes(dados)
  if (faltando.length) {
    const err = new Error(
      `Dados obrigatórios ausentes para emitir a NFS-e: ${faltando.map((f) => f.rotulo).join(', ')}`
    )
    err.code = 'DADOS_INCOMPLETOS'
    err.faltando = faltando
    throw err
  }

  const { emitente, tomador, servico, valores } = dados
  const ambiente = dados.ambiente ?? 2
  const serie = dados.serie || '00001'
  const nDPS = dados.nDPS ?? 1
  const dataEmissao = dados.dataEmissao || new Date()
  const cLocEmi = soDigitos(emitente.municipioCodigo)

  const id = montarIdDPS({ cLocEmi, cnpjEmitente: emitente.cnpj, serie, nDPS })

  const aliquota = Number(valores.aliquotaIss ?? 0)
  // tribISSQN: 1 = operação tributável. Quando não há alíquota configurada o
  // valor não é inventado — a nota sai sem pAliq e o município aplica a dele.
  const blocoIss = aliquota > 0
    ? `<tribMun>${tag('tribISSQN', 1)}${tag('pAliq', decimal(aliquota))}</tribMun>`
    : `<tribMun>${tag('tribISSQN', 1)}</tribMun>`

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="${VERSAO_LAYOUT}">`,
    `<infDPS Id="${id}">`,
    tag('tpAmb', ambiente),
    tag('dhEmi', dataHoraISO(dataEmissao)),
    tag('verAplic', 'gestao_serv-1.0'),
    tag('serie', String(serie).padStart(5, '0')),
    tag('nDPS', nDPS),
    tag('dCompet', dataISO(servico.competencia)),
    tag('tpEmit', 1),
    tag('cLocEmi', cLocEmi),

    '<prest>',
    tag('CNPJ', soDigitos(emitente.cnpj)),
    tag('IM', emitente.inscricaoMunicipal),
    tag('xNome', emitente.razaoSocial),
    blocoEndereco(emitente.endereco, emitente.municipioCodigo),
    tagOpcional('fone', soDigitos(emitente.telefone)),
    tagOpcional('email', emitente.email),
    '<regTrib>',
    tag('opSimpNac', emitente.optaSimples ?? 3),
    tag('regEspTrib', emitente.regimeEspecial ?? 0),
    '</regTrib>',
    '</prest>',

    '<toma>',
    blocoDocumento(tomador.documento),
    tagOpcional('IM', tomador.inscricaoMunicipal),
    tag('xNome', tomador.razaoSocial),
    blocoEndereco(tomador.endereco, tomador.endereco.municipioCodigo),
    tagOpcional('fone', soDigitos(tomador.telefone)),
    tagOpcional('email', tomador.email),
    '</toma>',

    '<serv>',
    `<locPrest>${tag('cLocPrestacao', soDigitos(servico.municipioPrestacao))}</locPrest>`,
    '<cServ>',
    tag('cTribNac', servico.itemListaServico),
    tagOpcional('cTribMun', servico.codigoTributacaoMunicipal),
    tag('xDescServ', servico.descricao),
    tagOpcional('cNBS', servico.nbs),
    '</cServ>',
    '</serv>',

    '<valores>',
    `<vServPrest>${tag('vServ', decimal(valores.servico))}</vServPrest>`,
    '<trib>',
    blocoIss,
    `<totTrib>${tag('indTotTrib', 0)}</totTrib>`,
    '</trib>',
    '</valores>',

    '</infDPS>',
    '</DPS>',
  ].join('')
}

/** Fachada de classe, mantida por compatibilidade com o formato do esboço. */
export class NFSeXMLBuilder {
  constructor(dados) {
    this.dados = dados
  }
  build() {
    return montarDPS(this.dados)
  }
  validar() {
    return camposFaltantes(this.dados)
  }
}
