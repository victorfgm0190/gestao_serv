import https from 'node:https'
import { gzipSync } from 'node:zlib'
import axios from 'axios'

// Cliente do ADN (Ambiente de Dados Nacional) da NFS-e.
//
// ⚠️⚠️ NÃO VERIFICADO CONTRA O SERVIÇO REAL. Não há credencial de homologação
// neste ambiente e nenhuma requisição foi feita. Os caminhos e o formato do
// corpo seguem a documentação do padrão nacional, mas trate-os como hipótese
// até a primeira emissão em homologação — por isso base URL e rotas são
// configuráveis por variável de ambiente, sem precisar mexer no código.
//
// ⚠️ mTLS é obrigatório. O ADN autentica o contribuinte pelo CERTIFICADO na
// própria conexão TLS — não há token nem usuário/senha. O esboço usava
// `axios.create({ baseURL, headers: {'Content-Type':'application/json'} })`
// sem agente TLS: a conexão é recusada no handshake, antes de qualquer rota
// existir ou não. É também por isso que o certificado precisa ser passado
// aqui, e não só usado para assinar o XML.
//
// ⚠️ A DPS vai comprimida e em base64 (`dpsXmlGZipB64`), não como string XML
// crua num campo `xml`.

const URLS = {
  producao: process.env.NFSE_ADN_URL_PRODUCAO || 'https://adn.nfse.gov.br/contribuinte',
  homologacao:
    process.env.NFSE_ADN_URL_HOMOLOGACAO ||
    'https://adn.producaorestrita.nfse.gov.br/contribuinte',
}

const ROTA_DPS = process.env.NFSE_ADN_ROTA_DPS || '/dps'
const ROTA_NFSE = process.env.NFSE_ADN_ROTA_NFSE || '/nfse'

export class NFSeADNClient {
  /**
   * @param {object} opts
   * @param {'producao'|'homologacao'} opts.ambiente
   * @param {Buffer} opts.pfxBuffer  certificado A1 (para o mTLS)
   * @param {string} opts.senhaPfx
   * @param {number} [opts.timeout]
   */
  constructor({ ambiente = 'homologacao', pfxBuffer, senhaPfx, timeout = 30000 } = {}) {
    this.ambiente = ambiente
    this.baseURL = URLS[ambiente] || URLS.homologacao

    if (!pfxBuffer) {
      throw new Error('Certificado é obrigatório: o ADN autentica por mTLS')
    }

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      httpsAgent: new https.Agent({ pfx: pfxBuffer, passphrase: senhaPfx, keepAlive: false }),
      // Erro HTTP não vira exceção: a resposta de erro do ADN traz o motivo da
      // rejeição, e é justamente ela que precisa ser gravada e mostrada.
      validateStatus: () => true,
    })
  }

  static compactarDPS(xml) {
    return gzipSync(Buffer.from(xml, 'utf8')).toString('base64')
  }

  /** Envia a DPS assinada. Devolve o desfecho normalizado, sem lançar. */
  async emitirNFSe(dpsXmlAssinado) {
    const corpo = { dpsXmlGZipB64: NFSeADNClient.compactarDPS(dpsXmlAssinado) }

    let resp
    try {
      resp = await this.client.post(ROTA_DPS, corpo)
    } catch (err) {
      // Falha de rede/TLS: não chegou a haver resposta.
      return {
        ok: false,
        status: null,
        erro: `Falha de comunicação com o ADN: ${err.message}`,
        resposta: null,
      }
    }

    const d = resp.data || {}
    if (resp.status >= 200 && resp.status < 300) {
      return {
        ok: true,
        status: resp.status,
        nsu: d.nsu ?? null,
        protocolo: d.protocolo ?? d.protocol ?? null,
        chaveAcesso: d.chaveAcesso ?? d.chave ?? null,
        numeroNfse: d.numeroNFSe ?? d.nNFSe ?? null,
        resposta: d,
      }
    }

    // Mensagem do ADN vem em formatos diferentes conforme o tipo de rejeição.
    const motivo =
      d.mensagem || d.message ||
      (Array.isArray(d.erros) ? d.erros.map((e) => e.descricao || e.mensagem || String(e)).join('; ') : null) ||
      `HTTP ${resp.status}`

    return { ok: false, status: resp.status, erro: motivo, resposta: d }
  }

  async consultarNFSe(chaveAcesso) {
    const resp = await this.client.get(`${ROTA_NFSE}/${encodeURIComponent(chaveAcesso)}`)
    return { ok: resp.status < 300, status: resp.status, resposta: resp.data }
  }

  async cancelarNFSe(chaveAcesso, dpsCancelamentoAssinado) {
    const resp = await this.client.post(
      `${ROTA_NFSE}/${encodeURIComponent(chaveAcesso)}/eventos`,
      { eventoXmlGZipB64: NFSeADNClient.compactarDPS(dpsCancelamentoAssinado) }
    )
    return { ok: resp.status < 300, status: resp.status, resposta: resp.data }
  }
}

export default NFSeADNClient
