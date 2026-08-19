import https from 'node:https'
import { gzipSync, gunzipSync } from 'node:zlib'
import axios from 'axios'
import { extrairChaves } from './nfse-signer.js'

// Cliente do padrão NACIONAL de NFS-e.
//
// ⚠️ EMITIR NÃO É NO ADN. Esta era a causa do HTTP 404: o ADN (Ambiente de
// Dados Nacional) é o serviço de DISTRIBUIÇÃO — consulta de DFe por NSU. Quem
// RECEBE a DPS e devolve a nota é o **SEFIN Nacional**. Nenhum caminho no host
// do ADN responde a emissão, e por isso trocar `/dps` por `/rps` (ou por
// qualquer outro nome) continuaria dando 404: o problema era o HOST.
//
// Verificado contra o ambiente de produção restrita com o certificado da Lumen:
//
//   POST https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse
//   → 400 {"tipoAmbiente":2,"versaoAplicativo":"SefinNacional_1.6.0",
//          "erros":[{"Codigo":"E1235","Descricao":"Falha no esquema XML do DF-e.",
//                    "Complemento":"O elemento raiz do XML deve ser 'DPS'…"}]}
//
// ⚠️ O caminho diferencia MAIÚSCULAS: `/SefinNacional/nfse` responde;
// `/sefinnacional/nfse` devolve 307 para outro lugar.
//
// ⚠️ `dpsXmlGZipB64` é o nome certo do campo — confirmado pela mensagem
// "Estrutura descompactada mal formada" (E1226) ao mandar `dpsXml` com XML cru.

const URLS_SEFIN = {
  producao: process.env.NFSE_SEFIN_URL_PRODUCAO || 'https://sefin.nfse.gov.br',
  homologacao:
    process.env.NFSE_SEFIN_URL_HOMOLOGACAO || 'https://sefin.producaorestrita.nfse.gov.br',
}

// ADN: distribuição de DFe (consulta por NSU). Não emite.
const URLS_ADN = {
  producao: process.env.NFSE_ADN_URL_PRODUCAO || 'https://adn.nfse.gov.br',
  homologacao:
    process.env.NFSE_ADN_URL_HOMOLOGACAO || 'https://adn.producaorestrita.nfse.gov.br',
}

const ROTA_NFSE = process.env.NFSE_SEFIN_ROTA_NFSE || '/SefinNacional/nfse'

export class NFSeADNClient {
  /**
   * @param {object} opts
   * @param {'producao'|'homologacao'} opts.ambiente
   * @param {Buffer} opts.pfxBuffer  certificado A1 (para o mTLS)
   * @param {string} opts.senhaPfx
   */
  constructor({ ambiente = 'homologacao', pfxBuffer, senhaPfx, timeout = 30000 } = {}) {
    this.ambiente = ambiente
    this.baseURL = URLS_SEFIN[ambiente] || URLS_SEFIN.homologacao
    this.urlADN = URLS_ADN[ambiente] || URLS_ADN.homologacao

    if (!pfxBuffer) {
      throw new Error('Certificado é obrigatório: o SEFIN autentica por mTLS')
    }

    // ⚠️ O certificado entra no TLS como PEM (chave + certificado), NÃO como
    // `pfx`. O OpenSSL 3 recusa o PKCS#12 dos A1 da ICP-Brasil, que usam
    // cifragem legada: na Vercel o erro é "Unsupported PKCS12 PFX data" e aqui
    // o handshake morre com ECONNRESET. Convertido pelo node-forge — que lê o
    // arquivo sem esse problema, e é o mesmo caminho já usado para assinar — a
    // conexão completa. Testado lado a lado contra o mesmo destino: `pfx` dá
    // ECONNRESET, `key`/`cert` dá resposta HTTP.
    const { privateKeyPem, certificatePem } = extrairChaves(pfxBuffer, senhaPfx)

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      httpsAgent: new https.Agent({
        key: privateKeyPem,
        cert: certificatePem,
        keepAlive: false,
      }),
      // Erro HTTP não vira exceção: a resposta de erro traz o motivo da
      // rejeição, e é justamente ela que precisa ser gravada e mostrada.
      validateStatus: () => true,
    })
  }

  static compactarDPS(xml) {
    return gzipSync(Buffer.from(xml, 'utf8')).toString('base64')
  }

  /**
   * Extrai a mensagem de erro da resposta do SEFIN.
   *
   * ⚠️ Os campos vêm com inicial MAIÚSCULA (`Codigo`, `Descricao`,
   * `Complemento`) — conferido na resposta real. Ler `descricao` minúsculo
   * devolveria "[object Object]" no lugar do motivo.
   */
  static motivoDoErro(d, status) {
    if (Array.isArray(d?.erros) && d.erros.length) {
      return d.erros
        .map((e) => {
          const cod = e.Codigo || e.codigo
          const desc = e.Descricao || e.descricao || e.mensagem || ''
          const compl = e.Complemento || e.complemento
          return [cod && `[${cod}]`, desc, compl && `— ${compl}`].filter(Boolean).join(' ')
        })
        .join(' | ')
    }
    return d?.mensagem || d?.message || `HTTP ${status}`
  }

  /** Envia a DPS assinada. Devolve o desfecho normalizado, sem lançar. */
  async emitirNFSe(dpsXmlAssinado) {
    const corpo = { dpsXmlGZipB64: NFSeADNClient.compactarDPS(dpsXmlAssinado) }

    let resp
    try {
      resp = await this.client.post(ROTA_NFSE, corpo)
    } catch (err) {
      return {
        ok: false, status: null, resposta: null,
        erro: `Falha de comunicação com o SEFIN: ${err.message}`,
      }
    }

    const d = resp.data || {}
    if (resp.status >= 200 && resp.status < 300) {
      // ⚠️ A resposta traz `nfseXmlGZipB64`: a NFS-e AUTORIZADA. É ela o
      // documento fiscal — a DPS é só o pedido —, e é a única fonte da razão
      // social e do endereço do prestador, que o SEFIN preenche do cadastro
      // nacional e proíbe de enviar na DPS (E0121/E0128).
      let nfseXml = null
      let numeroNfse = d.numeroNFSe ?? d.nNFSe ?? null
      if (d.nfseXmlGZipB64) {
        try {
          nfseXml = gunzipSync(Buffer.from(d.nfseXmlGZipB64, 'base64')).toString('utf8')
          numeroNfse = numeroNfse ?? (nfseXml.match(/<nNFSe>([^<]+)<\/nNFSe>/) || [])[1] ?? null
        } catch (e) {
          console.error('[adn] não foi possível descompactar a NFS-e:', e.message)
        }
      }
      return {
        ok: true,
        status: resp.status,
        nsu: d.nsu ?? null,
        protocolo: d.protocolo ?? d.protocol ?? null,
        // A chave de acesso identifica a nota; é ela que o cancelamento usa.
        chaveAcesso: d.chaveAcesso ?? d.chave ?? null,
        numeroNfse,
        nfseXml,
        // O blob compactado sai da resposta gravada: são ~7 KB de base64 que
        // duplicariam, em json_response, o XML que já vai na coluna própria.
        resposta: { ...d, nfseXmlGZipB64: undefined },
      }
    }

    return {
      ok: false,
      status: resp.status,
      erro: NFSeADNClient.motivoDoErro(d, resp.status),
      resposta: d,
    }
  }

  async consultarNFSe(chaveAcesso) {
    const resp = await this.client.get(`${ROTA_NFSE}/${encodeURIComponent(chaveAcesso)}`)
    return { ok: resp.status < 300, status: resp.status, resposta: resp.data }
  }

  async cancelarNFSe(chaveAcesso, eventoAssinado) {
    const resp = await this.client.post(
      `${ROTA_NFSE}/${encodeURIComponent(chaveAcesso)}/eventos`,
      { eventoXmlGZipB64: NFSeADNClient.compactarDPS(eventoAssinado) }
    )
    const d = resp.data || {}
    return {
      ok: resp.status < 300,
      status: resp.status,
      erro: resp.status < 300 ? null : NFSeADNClient.motivoDoErro(d, resp.status),
      resposta: d,
    }
  }
}

export default NFSeADNClient
