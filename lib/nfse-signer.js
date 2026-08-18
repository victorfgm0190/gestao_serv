import forge from 'node-forge'
import { SignedXml } from 'xml-crypto'

// Assinatura XMLDSig enveloped da DPS, com o certificado A1 da empresa.
//
// ⚠️ SHA-256, não SHA-1. O esboço pedia
// `http://www.w3.org/2000/09/xmldsig#sha1` para o digest e deixava o algoritmo
// de assinatura no default (rsa-sha1). SHA-1 está fora do padrão nacional de
// NFS-e há anos e a nota é recusada na validação da assinatura — erro que só
// aparece do outro lado, depois de transmitir.
//
// ⚠️ A API do xml-crypto mudou. O esboço usa a da v2 (`sig.signingKey = pem`,
// `sig.addReference(xpath, transforms, digest)` posicional, `sig.sign(xml)`).
// Na v6, instalada aqui, a propriedade é `privateKey`, `addReference` recebe UM
// objeto e o método é `computeSignature` — `sign` nem existe. O código do
// esboço lançaria TypeError na primeira assinatura.

const ALGO_ASSINATURA = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'
const ALGO_DIGEST = 'http://www.w3.org/2001/04/xmlenc#sha256'
const C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#'
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature'

/**
 * Extrai chave privada e certificado do .pfx, em PEM.
 * Lança com mensagem legível quando a senha não confere.
 */
export function extrairChaves(pfxBuffer, senha) {
  let pkcs12
  try {
    const asn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'))
    pkcs12 = forge.pkcs12.pkcs12FromAsn1(asn1, senha)
  } catch (err) {
    const msg = String(err?.message || err)
    if (/MAC|password/i.test(msg)) throw new Error('Senha do certificado incorreta')
    throw new Error(`Arquivo .pfx inválido ou corrompido (${msg})`)
  }

  // A chave pode estar em bag cifrada (o caso normal do A1) ou em bag simples.
  // O esboço só olhava a cifrada e devolvia "Chave privada não encontrada" para
  // um certificado perfeitamente válido gerado do outro jeito.
  const bags = pkcs12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })
  const simples = pkcs12.getBags({ bagType: forge.pki.oids.keyBag })
  const keyBag =
    bags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0] || simples[forge.pki.oids.keyBag]?.[0]
  if (!keyBag?.key) throw new Error('Chave privada não encontrada no certificado')

  const certBags = pkcs12.getBags({ bagType: forge.pki.oids.certBag })
  const cert = certBags[forge.pki.oids.certBag]?.[0]?.cert
  if (!cert) throw new Error('Certificado não encontrado no arquivo .pfx')

  return {
    privateKeyPem: forge.pki.privateKeyToPem(keyBag.key),
    certificatePem: forge.pki.certificateToPem(cert),
    subject: cert.subject.getField('CN')?.value || null,
    validUntil: cert.validity.notAfter,
  }
}

export class NFSeSigner {
  constructor(certificadoPFX, senha) {
    this.pfxBuffer = Buffer.isBuffer(certificadoPFX)
      ? certificadoPFX
      : Buffer.from(certificadoPFX, 'base64')
    this.senha = senha
  }

  /**
   * Assina a DPS. A `<Signature>` entra como filha de `<DPS>`, irmã de
   * `<infDPS>`, referenciando o Id de `infDPS`.
   *
   * ⚠️ A referência é pelo `Id` (`uri: '#DPS...'`), não por um XPath solto. Com
   * XPath e URI vazia a assinatura cobre o documento todo e o validador do ADN
   * não casa com o elemento que ele espera ver assinado.
   */
  assinarXML(xml) {
    const { privateKeyPem, certificatePem } = extrairChaves(this.pfxBuffer, this.senha)

    const id = xml.match(/<infDPS\s+Id="([^"]+)"/)?.[1]
    if (!id) throw new Error('XML sem <infDPS Id="...">: nada a referenciar na assinatura')

    const sig = new SignedXml({
      privateKey: privateKeyPem,
      // publicCert põe o <X509Certificate> no KeyInfo. Sem ele, quem recebe não
      // tem a chave pública para conferir a assinatura que acabou de chegar.
      publicCert: certificatePem,
      signatureAlgorithm: ALGO_ASSINATURA,
      canonicalizationAlgorithm: C14N,
    })

    sig.addReference({
      xpath: "//*[local-name(.)='infDPS']",
      transforms: [ENVELOPED, C14N],
      digestAlgorithm: ALGO_DIGEST,
      uri: `#${id}`,
    })

    sig.computeSignature(xml, {
      location: { reference: "//*[local-name(.)='DPS']", action: 'append' },
    })

    return sig.getSignedXml()
  }
}

export default NFSeSigner
