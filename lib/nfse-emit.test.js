// Roda com: node lib/nfse-emit.test.js
//
// ⚠️ Fora de api/ pelo mesmo motivo da etapa 3: tudo que a Vercel encontra em
// /api vira função publicada.
//
// ⚠️ O teste do esboço montava um XML e imprimia `xml.length` e
// `xml.includes('<?xml')` — nenhuma asserção sobre o conteúdo. E ele não roda:
// o `tomador` do exemplo não tem o campo `tipo`, então `montarIDTomador` cai no
// ramo do CPF e faz `.replace` em `undefined`. Um teste que nunca foi executado.
//
// Aqui: estrutura do XML conferida tag a tag, assinatura VERIFICADA de volta e
// as travas do endpoint exercitadas contra o banco, com tudo restaurado.
import 'dotenv/config'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-16-chars'
import forge from 'node-forge'
import { DOMParser } from '@xmldom/xmldom'
import { SignedXml } from 'xml-crypto'
import { neon } from '@neondatabase/serverless'
import { signToken } from './auth.js'
import { montarDPS, camposFaltantes, montarIdDPS, decimal } from './nfse-xml-builder.js'
import { NFSeSigner, extrairChaves } from './nfse-signer.js'
import { NFSeADNClient } from './nfse-adn-client.js'
import handler from '../api/nfse-emit.js'

let falhas = 0
const ok = (cond, msg) => {
  console.log(`  ${cond ? '✅' : '❌'} ${msg}`)
  if (!cond) falhas++
  return cond
}

const EMPRESA = 1
const INV_COM_NF = 37      // Bokada, R$ 340,00
const INV_SEM_NF = 36      // Minas, require_nf = false

const dadosBase = () => ({
  ambiente: 2,
  serie: '00001',
  nDPS: 7,
  dataEmissao: new Date('2026-08-18T13:00:00Z'),
  emitente: {
    cnpj: '12.345.678/0001-90', inscricaoMunicipal: '987654',
    razaoSocial: 'LUMEN DEV LTDA', municipioCodigo: '3550308',
    endereco: { logradouro: 'Rua das Flores', numero: '100', bairro: 'Centro', cep: '01001-000', uf: 'SP' },
    telefone: '(11) 99999-0000', email: 'victor@lumendev.com.br',
    optaSimples: 3, regimeEspecial: 0,
  },
  tomador: {
    documento: '98.765.432/0001-10', razaoSocial: 'CLIENTE & CIA <LTDA>',
    endereco: { logradouro: 'Av. Brasil', numero: '456', bairro: 'Vila', cep: '87123-456', municipioCodigo: '4106902', uf: 'PR' },
  },
  servico: {
    descricao: 'Consultoria em TI', itemListaServico: '01.06',
    municipioPrestacao: '3550308', competencia: '2026-08-01',
  },
  valores: { servico: 1000, aliquotaIss: 2 },
})

// ---------------------------------------------------------------------------
console.log('🧪 TESTE 1: estrutura da DPS')
const xml = montarDPS(dadosBase())
const doc = new DOMParser().parseFromString(xml, 'text/xml')
const txt = (t) => doc.getElementsByTagName(t)[0]?.textContent ?? null

ok(doc.documentElement.nodeName === 'DPS', 'raiz é <DPS>')
ok(doc.documentElement.getAttribute('xmlns') === 'http://www.sped.fazenda.gov.br/nfse',
  'namespace do padrão nacional')
ok(txt('tpAmb') === '2', 'tpAmb = 2 (homologação)')
ok(txt('vServ') === '1000.00', `vServ = ${txt('vServ')} (2 casas, sem notação científica)`)
// ⚠️ A DPS não declara alíquota: o schema recusa `pAliq` dentro de tribMun
// e exige `tpRetISSQN`. Quem apura o ISS é o município.
ok(doc.getElementsByTagName('pAliq').length === 0, 'sem <pAliq> — recusado pelo schema do SEFIN')
ok(txt('tribISSQN') === '1' && txt('tpRetISSQN') === '1', 'tribISSQN + tpRetISSQN')
ok(txt('dCompet') === '2026-08-01', `dCompet = ${txt('dCompet')}`)
ok(/^2026-08-18T\d{2}:\d{2}:\d{2}-03:00$/.test(txt('dhEmi')), `dhEmi com fuso: ${txt('dhEmi')}`)
ok(txt('CNPJ') === '12345678000190', 'CNPJ do emitente só com dígitos')
// ⚠️ O bloco do prestador é mínimo (E0121/E0128): sem nome e sem endereço.
// O primeiro <CEP> do documento é, portanto, o do TOMADOR.
ok(doc.getElementsByTagName('xNome').length === 1, 'só o tomador informa xNome')
ok(txt('CEP') === '87123456', 'CEP do tomador, só com dígitos')

// Escapamento: o nome do cliente tem & e < >
ok(xml.includes('CLIENTE &amp; CIA &lt;LTDA&gt;'), 'caracteres especiais escapados')
ok(!/[^&]&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml), 'nenhum & solto no XML')

const id = doc.getElementsByTagName('infDPS')[0].getAttribute('Id')
ok(id.length === 45, `Id com 45 caracteres: ${id}`)
// tpInsc 2 = CNPJ (1 = CPF). Com 1 o SEFIN recusa: E0004.
ok(id === 'DPS3550308212345678000190' + '00001' + '000000000000007',
  'Id = DPS + município + tpInsc(2=CNPJ) + CNPJ + série + nDPS')
ok(montarIdDPS({ cLocEmi: '3550308', cnpjEmitente: '12345678000190', serie: '00001', nDPS: 7 }) === id,
  'Id é derivado dos dados — mesma entrada, mesmo Id (não usa relógio)')

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 2: validação recusa em vez de inventar')
const vazio = camposFaltantes({})
ok(vazio.length >= 20, `${vazio.length} campos obrigatórios reportados DE UMA VEZ (não um por vez)`)

const semTomador = dadosBase()
delete semTomador.tomador.documento
delete semTomador.servico.itemListaServico
try {
  montarDPS(semTomador)
  ok(false, 'deveria ter recusado')
} catch (err) {
  ok(err.code === 'DADOS_INCOMPLETOS', 'erro identificável por código')
  ok(err.faltando.length === 2, `2 pendências listadas: ${err.faltando.map(f => f.rotulo).join(' | ')}`)
}

const valorZero = dadosBase()
valorZero.valores.servico = 0
ok(camposFaltantes(valorZero).some(f => /maior que zero/.test(f.rotulo)),
  'valor zero é recusado — nota de R$ 0,00 não é emitida em silêncio')

// CPF x CNPJ pelo tamanho, sem depender de um campo `tipo`
const comCpf = dadosBase()
comCpf.tomador.documento = '123.456.789-09'
ok(montarDPS(comCpf).includes('<CPF>12345678909</CPF>'), '11 dígitos → <CPF>')
const docRuim = dadosBase()
docRuim.tomador.documento = '123'
try { montarDPS(docRuim); ok(false, 'documento inválido deveria falhar') }
catch (err) { ok(/11 \(CPF\) ou 14 \(CNPJ\)/.test(err.message), 'documento de tamanho inválido é recusado') }

ok(decimal(1466.25) === '1466.25' && decimal(0.1 + 0.2) === '0.30', 'decimal estável')

// ⚠️ Inscrição municipal opcional (2026-08-19): sem ela a DPS sai, e a tag
// <IM> NÃO pode sair vazia — <IM></IM> não casa com o tipo do schema.
const semIM = dadosBase()
delete semIM.emitente.inscricaoMunicipal
ok(!camposFaltantes(semIM).some((f) => /nscricao municipal|nscrição municipal/i.test(f.rotulo)),
  'sem inscricao municipal nao e pendencia')
const xmlSemIM = montarDPS(semIM)
ok(xmlSemIM.indexOf('<IM>') === -1, 'sem IM a tag some do XML (nao vira <IM></IM>)')
ok(xmlSemIM.indexOf('<CNPJ>12345678000190</CNPJ>') !== -1, 'o resto do prestador continua la')
ok(montarDPS(dadosBase()).indexOf('<IM>987654</IM>') !== -1, 'com IM preenchida a tag sai normalmente')

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 3: assinatura SHA-256 verificada de volta')
const keys = forge.pki.rsa.generateKeyPair(1024)
const cert = forge.pki.createCertificate()
cert.publicKey = keys.publicKey
cert.serialNumber = '01'
cert.validity.notBefore = new Date(Date.now() - 86400000)
cert.validity.notAfter = new Date(Date.now() + 90 * 86400000)
const attrs = [{ name: 'commonName', value: 'LUMEN DEV LTDA:12345678000190' }]
cert.setSubject(attrs); cert.setIssuer(attrs); cert.sign(keys.privateKey)
const SENHA = 'p@ss-teste'
const pfx = Buffer.from(
  forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, cert, SENHA, { algorithm: '3des' })).getBytes(),
  'binary'
)

const assinado = new NFSeSigner(pfx, SENHA).assinarXML(xml)
ok(assinado.includes('<Signature'), 'assinatura presente')
ok(assinado.includes('rsa-sha256'), 'algoritmo de assinatura é RSA-SHA256 (não SHA-1)')
ok(assinado.includes('xmlenc#sha256'), 'digest é SHA-256')
ok(assinado.includes('<X509Certificate>'), 'KeyInfo traz o certificado (sem ele não há como validar)')
ok(assinado.includes(`URI="#${id}"`), 'referência aponta para o Id de infDPS')

// A verificação de verdade: conferir a assinatura com a chave pública.
const { certificatePem } = extrairChaves(pfx, SENHA)
const docAss = new DOMParser().parseFromString(assinado, 'text/xml')
const nodeSig = docAss.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0]
const verif = new SignedXml({ publicCert: certificatePem })
verif.loadSignature(nodeSig)
ok(verif.checkSignature(assinado), 'assinatura CONFERE contra o certificado')

// E precisa reprovar se o conteúdo mudar.
const adulterado = assinado.replace('<vServ>1000.00</vServ>', '<vServ>10.00</vServ>')
const verif2 = new SignedXml({ publicCert: certificatePem })
verif2.loadSignature(new DOMParser().parseFromString(adulterado, 'text/xml')
  .getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0])
let recusou = false
try { recusou = !verif2.checkSignature(adulterado) } catch { recusou = true }
ok(recusou, 'valor alterado depois de assinar invalida a assinatura')

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 4: cliente do ADN')
ok(Buffer.from(NFSeADNClient.compactarDPS(xml), 'base64').slice(0, 2).toString('hex') === '1f8b',
  'DPS vai gzipada e em base64 (cabeçalho 1f8b)')
try {
  new NFSeADNClient({ ambiente: 'homologacao' })
  ok(false, 'deveria exigir certificado')
} catch (err) {
  ok(/mTLS/.test(err.message), 'cliente sem certificado é recusado — o ADN autentica por mTLS')
}

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 5: travas do endpoint (banco real, restaurado ao final)')
const sql = neon(process.env.DATABASE_URL)
const token = signToken({ sub: '1', username: 'teste', master: true })
const chamar = async (body, auth = true, method = 'POST') => {
  const res = { code: 0, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
  await handler({ method, body, headers: auth ? { authorization: `Bearer ${token}` } : {} }, res)
  return res
}

const tinhaCert = await sql`SELECT id FROM nfse_certificates WHERE company_id = ${EMPRESA}`
const tinhaEmit = await sql`SELECT id FROM nfse_emitter_settings WHERE company_id = ${EMPRESA}`
if (tinhaCert.length || tinhaEmit.length) {
  console.log('  ⏭️  PULADO: empresa 1 já tem certificado/emitente — não serão tocados')
} else {
  const clienteAntes = await sql`SELECT * FROM clients WHERE id = 13`
  try {
    ok((await chamar({ invoice_id: INV_COM_NF }, false)).code === 401, 'sem token → 401')
    ok((await chamar({}, true, 'GET')).code === 405, 'GET → 405')
    ok((await chamar({})).code === 400, 'sem invoice_id → 400')
    ok((await chamar({ invoice_id: 999999 })).code === 404, 'fatura inexistente → 404')

    let r = await chamar({ invoice_id: INV_SEM_NF })
    ok(r.code === 422 && /require_nf/.test(r.body.error),
      'cliente sem NF (Minas) → 422, não emite')

    r = await chamar({ invoice_id: INV_COM_NF })
    ok(r.code === 422 && /Emitente não configurado/.test(r.body.error),
      'sem emitente cadastrado → 422 (o esboço emitiria com "Rua Test")')

    // emitente incompleto de propósito: falta item da lista de serviços
    await sql`
      INSERT INTO nfse_emitter_settings
        (company_id, cnpj, inscricao_municipal, razao_social, endereco, numero,
         bairro, cep, municipio_codigo, uf, ambiente, aliquota_iss)
      VALUES (${EMPRESA}, '12345678000190', '987654', 'LUMEN DEV LTDA', 'Rua das Flores',
              '100', 'Centro', '01001000', '3550308', 'SP', 2, 2.00)`
    r = await chamar({ invoice_id: INV_COM_NF })
    ok(r.code === 422 && r.body.faltando?.length > 0,
      `dados incompletos → 422 listando ${r.body.faltando?.length} pendência(s): ` +
      r.body.faltando.map(f => f.rotulo).join(' | '))

    // completa emitente e tomador
    await sql`UPDATE nfse_emitter_settings SET item_lista_servico = '01.06' WHERE company_id = ${EMPRESA}`
    await sql`
      UPDATE clients SET cpf_cnpj = '98765432000110', razao_social = 'BOKADA COMERCIO LTDA',
             endereco = 'Av. Brasil', numero = '456', bairro = 'Vila', cep = '87123456',
             municipio_codigo = '4106902', uf = 'PR'
      WHERE id = 13`

    r = await chamar({ invoice_id: INV_COM_NF })
    ok(r.code === 422 && /Certificado digital não configurado/.test(r.body.error),
      'sem certificado → 422 com o caminho para resolver')

    // certificado de teste
    const { encrypted, iv } = (await import('./crypto-manager.js')).default.encryptBinary(pfx)
    const senhaCif = (await import('./crypto-manager.js')).default.encrypt(SENHA)
    await sql`
      INSERT INTO nfse_certificates
        (company_id, certificate_pfx_encrypted, certificate_pfx_iv,
         certificate_password_encrypted, certificate_password_iv,
         certificate_subject, certificate_valid_from, certificate_valid_until)
      VALUES (${EMPRESA}, ${encrypted}, ${iv}, ${senhaCif.encrypted}, ${senhaCif.iv},
              'FIXTURE', ${cert.validity.notBefore}, ${cert.validity.notAfter})`

    // ⚠️ o caminho feliz: PRÉVIA. Nada é transmitido sem transmitir: true.
    r = await chamar({ invoice_id: INV_COM_NF })
    ok(r.code === 200 && r.body.preview === true, 'prévia → 200 sem transmitir nada')
    ok(r.body.resumo?.valor_servico === 340, `valor vem de invoice_value: R$ ${r.body.resumo?.valor_servico}`)
    ok(r.body.xml_assinado?.includes('<Signature'), 'prévia devolve o XML já assinado')
    ok(r.body.xml_assinado?.includes('<vServ>340.00</vServ>'), 'valor correto no XML (não R$ 0,00)')
    ok((await sql`SELECT count(*)::int n FROM nfse_emissions`)[0].n === 0,
      'prévia não gravou emissão nenhuma')

    // idempotência
    await sql`
      INSERT INTO nfse_emissions (company_id, invoice_id, status, nfse_number)
      VALUES (${EMPRESA}, ${INV_COM_NF}, 'enviada', 123)`
    r = await chamar({ invoice_id: INV_COM_NF })
    ok(r.code === 409, 'fatura já emitida → 409 (o esboço emitiria a segunda nota)')

    let erro = null
    try {
      await sql`INSERT INTO nfse_emissions (company_id, invoice_id, status) VALUES (${EMPRESA}, ${INV_COM_NF}, 'enviada')`
    } catch (e) { erro = e.message }
    ok(erro !== null, 'índice único no banco barra a duplicata mesmo em corrida')
  } finally {
    await sql`DELETE FROM nfse_emissions WHERE company_id = ${EMPRESA}`
    await sql`DELETE FROM nfse_certificates WHERE company_id = ${EMPRESA}`
    await sql`DELETE FROM nfse_emitter_settings WHERE company_id = ${EMPRESA}`
    const c = clienteAntes[0]
    await sql`
      UPDATE clients SET cpf_cnpj = ${c.cpf_cnpj}, razao_social = ${c.razao_social},
             endereco = ${c.endereco}, numero = ${c.numero}, bairro = ${c.bairro},
             cep = ${c.cep}, municipio_codigo = ${c.municipio_codigo}, uf = ${c.uf}
      WHERE id = 13`
    const [depois] = await sql`SELECT cpf_cnpj, endereco FROM clients WHERE id = 13`
    ok(depois.cpf_cnpj === c.cpf_cnpj && depois.endereco === c.endereco, 'banco restaurado ao estado original')
  }
}

// ---------------------------------------------------------------------------
if (falhas > 0) {
  console.error(`\n❌ ${falhas} VERIFICAÇÃO(ÕES) FALHARAM!`)
  process.exit(1)
}
console.log('\n✅ TODOS OS TESTES PASSARAM!')
