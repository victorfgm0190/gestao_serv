import { escaparXML, soDigitos, dataHoraISO } from './nfse-xml-builder.js'

// Pedido de registro de evento de CANCELAMENTO (e101101) do padrão nacional
// de NFS-e.
//
// ⚠️ O XML do esboço era de NF-e, não de NFS-e. `cOrgao`, `cStat`, `chNFe`,
// `AssinME` e o evento `110111` pertencem ao layout da nota fiscal de PRODUTO
// (SEFAZ). O cancelamento de NFS-e no padrão nacional é `<pedRegEvento>` com
// `<e101101>`, e vai para o ADN — que é para onde o cliente HTTP aponta.
//
// ⚠️ NÃO VALIDADO CONTRA O XSD OFICIAL, pelo mesmo motivo da etapa 4: não há
// credencial de homologação neste ambiente e nenhum cancelamento foi enviado.

const VERSAO_LAYOUT = '1.00'
const TIPO_EVENTO = '101101' // cancelamento

// Códigos de motivo do e101101. O texto livre acompanha, mas quem decide o
// tratamento do outro lado é o código — mandar só a frase deixaria o ADN sem
// como classificar o cancelamento.
export const MOTIVOS = [
  { codigo: '1', texto: 'Erro na emissão' },
  { codigo: '2', texto: 'Serviço não prestado' },
  { codigo: '3', texto: 'Duplicidade da nota' },
  { codigo: '9', texto: 'Outro' },
]

export const motivoPorCodigo = (c) => MOTIVOS.find((m) => m.codigo === String(c)) || null

export class NFSeCancellationBuilder {
  /**
   * @param {object} dados
   * @param {string} dados.chaveAcesso  chave da NFS-e (50 dígitos)
   * @param {string} dados.cnpjAutor    CNPJ de quem pede o cancelamento
   * @param {number} [dados.ambiente]   1=produção, 2=homologação
   * @param {number} [dados.sequencia]  nº do pedido de evento
   */
  constructor(dados) {
    this.dados = dados || {}
  }

  /**
   * ⚠️ A chave de acesso é obrigatória e NÃO é o NSU. O esboço mandava
   * `<chNFe>${this.nfse.nsu}</chNFe>`: NSU é o número sequencial do documento
   * no ADN, não o identificador da nota. Cancelar pelo NSU aponta para outro
   * documento — ou para nenhum.
   */
  validar(motivoTexto) {
    const faltando = []
    const chave = soDigitos(this.dados.chaveAcesso)
    if (!chave) faltando.push('Chave de acesso da NFS-e')
    else if (chave.length !== 50) faltando.push(`Chave de acesso deve ter 50 dígitos (tem ${chave.length})`)
    if (!soDigitos(this.dados.cnpjAutor)) faltando.push('CNPJ do autor do cancelamento')
    if (!motivoTexto || !String(motivoTexto).trim()) faltando.push('Motivo do cancelamento')
    return faltando
  }

  build(motivoTexto = 'Erro na emissão', codigoMotivo = '1') {
    const faltando = this.validar(motivoTexto)
    if (faltando.length) {
      const err = new Error(`Não é possível montar o cancelamento: ${faltando.join(', ')}`)
      err.code = 'DADOS_INCOMPLETOS'
      err.faltando = faltando
      throw err
    }

    const chave = soDigitos(this.dados.chaveAcesso)
    const cnpj = soDigitos(this.dados.cnpjAutor)
    const ambiente = this.dados.ambiente ?? 2
    const seq = Number(this.dados.sequencia ?? 1)

    // ⚠️ Id derivado da chave e da sequência. O esboço usava o literal
    // `Id="ID1234567890...3456"` — o MESMO identificador em todo cancelamento
    // de todas as notas, o que impede o ADN de distinguir um pedido do outro.
    const id = `PRE${chave}${TIPO_EVENTO}${String(seq).padStart(3, '0')}`

    const t = (nome, valor) => `<${nome}>${escaparXML(valor)}</${nome}>`

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<pedRegEvento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="${VERSAO_LAYOUT}">`,
      `<infPedReg Id="${id}">`,
      t('tpAmb', ambiente),
      t('verAplic', 'gestao_serv-1.0'),
      t('dhEvento', dataHoraISO(this.dados.dataEvento || new Date())),
      t('CNPJAutor', cnpj),
      t('chNFSe', chave),
      t('nPedRegEvento', seq),
      '<e101101>',
      t('xDesc', 'Cancelamento de NFS-e'),
      t('cMotivo', String(codigoMotivo)),
      t('xMotivo', String(motivoTexto).slice(0, 255)),
      '</e101101>',
      '</infPedReg>',
      '</pedRegEvento>',
    ].join('')
  }
}

export default NFSeCancellationBuilder
