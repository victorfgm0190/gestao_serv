// Roda com: node lib/nfse-cancel.test.js
//
// ⚠️ Fora de api/: tudo que a Vercel encontra ali vira função publicada.
// ⚠️ O teste do esboço só checava `xml.includes('<Evento')` e o NSU — ambos
// verdadeiros num XML do layout errado (era de NF-e, não de NFS-e).
import 'dotenv/config'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-16-chars'
process.env.NFSE_WEBHOOK_SECRET = 'segredo-de-teste-com-32-caracteres!!'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import forge from 'node-forge'
import { DOMParser } from '@xmldom/xmldom'
import { SignedXml } from 'xml-crypto'
import { neon } from '@neondatabase/serverless'
import { signToken } from './auth.js'
import { NFSeCancellationBuilder, MOTIVOS } from './nfse-xml-cancellation-builder.js'
import { NFSeSigner, extrairChaves } from './nfse-signer.js'
import cancelar from '../api/nfse-cancel.js'
import webhook from '../api/nfse-webhook.js'
import eventos from '../api/nfse-events.js'

let falhas = 0
const ok = (cond, msg) => {
  console.log(`  ${cond ? '✅' : '❌'} ${msg}`)
  if (!cond) falhas++
  return cond
}

const EMPRESA = 1
const INVOICE = 37
const CHAVE = '3'.repeat(50)
const SEGREDO = process.env.NFSE_WEBHOOK_SECRET

// ---------------------------------------------------------------------------
console.log('🧪 TESTE 1: XML de cancelamento no layout de NFS-e')
const builder = new NFSeCancellationBuilder({
  chaveAcesso: CHAVE, cnpjAutor: '12.345.678/0001-90', ambiente: 2, sequencia: 1,
  dataEvento: new Date('2026-08-18T13:00:00Z'),
})
const xmlCanc = builder.build('Erro na emissão <teste & cia>', '1')
const docC = new DOMParser().parseFromString(xmlCanc, 'text/xml')
const t = (tag) => docC.getElementsByTagName(tag)[0]?.textContent ?? null

ok(docC.documentElement.nodeName === 'pedRegEvento', 'raiz é <pedRegEvento> (NFS-e), não <Evento> (NF-e)')
ok(docC.documentElement.getAttribute('xmlns') === 'http://www.sped.fazenda.gov.br/nfse', 'namespace nacional')
ok(docC.getElementsByTagName('e101101').length === 1, 'evento e101101 (cancelamento de NFS-e)')
ok(docC.getElementsByTagName('chNFe').length === 0, 'não usa <chNFe> — essa tag é de NF-e de produto')
ok(t('chNFSe') === CHAVE, 'chave de acesso da NFS-e')
ok(t('cMotivo') === '1' && /Erro na emissão/.test(t('xMotivo')), 'motivo com CÓDIGO e texto')
ok(xmlCanc.includes('&lt;teste &amp; cia&gt;'), 'texto do motivo escapado')
ok(t('CNPJAutor') === '12345678000190', 'CNPJ só com dígitos')

const idC = docC.getElementsByTagName('infPedReg')[0].getAttribute('Id')
ok(idC === `PRE${CHAVE}101101001`, `Id derivado da chave: ${idC.slice(0, 20)}…`)
// ⚠️ o Id do esboço era um literal fixo — o MESMO em todo cancelamento
const outro = new NFSeCancellationBuilder({ chaveAcesso: '9'.repeat(50), cnpjAutor: '12345678000190' }).build('x')
ok(!outro.includes(idC), 'notas diferentes geram Ids diferentes')

console.log('\n🧪 TESTE 1b: chave de acesso é obrigatória e não é o NSU')
for (const [valor, rotulo] of [
  [null, 'sem chave'],
  ['550e8400-e29b-41d4-a716-446655440000', 'NSU no lugar da chave'],
  ['123', 'chave curta'],
]) {
  try {
    new NFSeCancellationBuilder({ chaveAcesso: valor, cnpjAutor: '12345678000190' }).build('teste')
    ok(false, `${rotulo} deveria ser recusado`)
  } catch (err) {
    ok(err.code === 'DADOS_INCOMPLETOS', `${rotulo} → recusado (${err.faltando[0]})`)
  }
}
ok(MOTIVOS.length === 4 && MOTIVOS.every((m) => m.codigo && m.texto), 'motivos têm código e texto')

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 2: assinatura do cancelamento')
const keys = forge.pki.rsa.generateKeyPair(1024)
const cert = forge.pki.createCertificate()
cert.publicKey = keys.publicKey
cert.serialNumber = '01'
cert.validity.notBefore = new Date(Date.now() - 86400000)
cert.validity.notAfter = new Date(Date.now() + 90 * 86400000)
const at = [{ name: 'commonName', value: 'LUMEN DEV LTDA' }]
cert.setSubject(at); cert.setIssuer(at); cert.sign(keys.privateKey)
const SENHA = 'p@ss'
const pfx = Buffer.from(
  forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, cert, SENHA, { algorithm: '3des' })).getBytes(),
  'binary'
)
const signer = new NFSeSigner(pfx, SENHA)
const cancAssinado = signer.assinarXML(xmlCanc, { elemento: 'infPedReg', raiz: 'pedRegEvento' })
ok(cancAssinado.includes(`URI="#${idC}"`), 'referência aponta para o Id de infPedReg')
ok(cancAssinado.includes('rsa-sha256'), 'RSA-SHA256')

const { certificatePem } = extrairChaves(pfx, SENHA)
const v = new SignedXml({ publicCert: certificatePem })
v.loadSignature(new DOMParser().parseFromString(cancAssinado, 'text/xml')
  .getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0])
ok(v.checkSignature(cancAssinado), 'assinatura do cancelamento CONFERE')
// a DPS continua assinável pelo caminho padrão
ok(signer.assinarXML(
  '<?xml version="1.0"?><DPS xmlns="x"><infDPS Id="ABC"><a>1</a></infDPS></DPS>'
).includes('URI="#ABC"'), 'assinatura da DPS não regrediu')

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 3: webhook — a rota pública')
const sql = neon(process.env.DATABASE_URL)
const token = signToken({ sub: '1', username: 'teste', master: true })

const chamarWebhook = async (corpo, { assinar = true, segredo = SEGREDO, method = 'POST' } = {}) => {
  const cru = Buffer.from(JSON.stringify(corpo))
  const sig = crypto.createHmac('sha256', segredo).update(cru).digest('hex')
  const req = Object.assign(Readable.from([cru]), {
    method, headers: assinar ? { 'x-signature': sig } : {},
  })
  const res = {
    code: 0, body: null,
    status(c) { this.code = c; return this },
    json(b) { this.body = b; return this },
  }
  await webhook(req, res)
  return res
}

ok((await chamarWebhook({ nsu: 'x', status: 'approved' }, { method: 'GET' })).code === 405, 'GET → 405')

// ⚠️ O ponto central: o esboço logava "assinatura inválida (pode ser teste)" e
// SEGUIA. Qualquer um na internet mudava o estado fiscal de qualquer nota.
ok((await chamarWebhook({ nsu: 'x', status: 'approved' }, { assinar: false })).code === 401,
  'sem assinatura → 401 (não processa)')
ok((await chamarWebhook({ nsu: 'x', status: 'approved' }, { segredo: 'outro-segredo-qualquer!!' })).code === 401,
  'assinatura com segredo errado → 401')

const semSegredo = process.env.NFSE_WEBHOOK_SECRET
delete process.env.NFSE_WEBHOOK_SECRET
ok((await chamarWebhook({ nsu: 'x', status: 'approved' })).code === 503,
  'sem NFSE_WEBHOOK_SECRET → 503 (falha FECHADA, sem cair num "dev-secret")')
process.env.NFSE_WEBHOOK_SECRET = semSegredo

// ⚠️ Tentativa de injeção pelo campo `status` — no esboço ele ia direto para
// `SET status = '${newStatus}'`.
const injecao = await chamarWebhook({ nsu: 'x', status: "erro', cancelled_at=NOW() --" })
ok(injecao.code === 400, `status fora da lista → 400 (injeção barrada): ${injecao.body?.error?.slice(0, 45)}`)
ok((await chamarWebhook({ status: 'approved' })).code === 400, 'sem nsu nem chave → 400')
ok((await chamarWebhook({ nsu: 'inexistente-xyz', status: 'approved' })).code === 200,
  'NSU desconhecido → 200 (não adianta reentregar)')

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 4: endpoints com uma emissão real')
const jaTem = await sql`SELECT id FROM nfse_emissions WHERE invoice_id = ${INVOICE}`
if (jaTem.length) {
  console.log(`  ⏭️  PULADO: já existe emissão para a fatura ${INVOICE}`)
} else {
  let em = null
  try {
    ;[em] = await sql`
      INSERT INTO nfse_emissions
        (company_id, invoice_id, nsu, protocol, nfse_number, status, dps_number,
         xml_assinado, json_response, competencia, valor_servico, municipio_codigo,
         ambiente, submitted_at)
      VALUES (${EMPRESA}, ${INVOICE}, 'nsu-cancel-teste', 'proto', 777, 'enviada', 9,
              '<x/>', ${JSON.stringify({ chaveAcesso: CHAVE })}, '2026-08-01', 340,
              '3550308', 2, NOW())
      RETURNING id`

    const chamar = async (handler, payload, auth = true, method = 'POST') => {
      const res = {
        code: 0, body: null,
        status(c) { this.code = c; return this },
        json(b) { this.body = b; return this },
      }
      await handler({
        method,
        body: method === 'POST' ? payload : undefined,
        query: method === 'GET' ? payload : {},
        headers: auth ? { authorization: `Bearer ${token}` } : {},
      }, res)
      return res
    }

    ok((await chamar(cancelar, { emission_id: em.id }, false)).code === 401, 'cancelar sem token → 401')
    ok((await chamar(cancelar, {}, true, 'GET')).code === 405, 'cancelar via GET → 405')
    ok((await chamar(cancelar, {})).code === 400, 'cancelar sem emission_id → 400')
    ok((await chamar(cancelar, { emission_id: 999999 })).code === 404, 'emissão inexistente → 404')

    // sem emitente cadastrado o CNPJ do autor falta → 422 listando
    let r = await chamar(cancelar, { emission_id: em.id })
    ok(r.code === 422 && /CNPJ do autor/.test(JSON.stringify(r.body.faltando)),
      'sem emitente → 422 dizendo que falta o CNPJ do autor')

    await sql`
      INSERT INTO nfse_emitter_settings (company_id, cnpj, ambiente)
      VALUES (${EMPRESA}, '12345678000190', 2)
      ON CONFLICT (company_id) DO UPDATE SET cnpj = EXCLUDED.cnpj`

    r = await chamar(cancelar, { emission_id: em.id })
    ok(r.code === 422 && /Certificado digital não configurado/.test(r.body.error),
      'sem certificado → 422')

    const cm = (await import('./crypto-manager.js')).default
    const encPfx = cm.encryptBinary(pfx)
    const encSenha = cm.encrypt(SENHA)
    await sql`
      INSERT INTO nfse_certificates
        (company_id, certificate_pfx_encrypted, certificate_pfx_iv,
         certificate_password_encrypted, certificate_password_iv,
         certificate_subject, certificate_valid_from, certificate_valid_until)
      VALUES (${EMPRESA}, ${encPfx.encrypted}, ${encPfx.iv}, ${encSenha.encrypted}, ${encSenha.iv},
              'FIXTURE', ${cert.validity.notBefore}, ${cert.validity.notAfter})`

    // ⚠️ prévia: nada é transmitido e o status NÃO muda
    r = await chamar(cancelar, { emission_id: em.id, codigo_motivo: '2' })
    ok(r.code === 200 && r.preview !== false && r.body.preview === true, 'prévia do cancelamento → 200')
    ok(r.body.xml_assinado?.includes('<e101101>'), 'prévia devolve o pedido assinado')
    ok(r.body.resumo?.codigo_motivo === '2', 'código do motivo preservado')
    const [aindaEnviada] = await sql`SELECT status, cancelled_at FROM nfse_emissions WHERE id = ${em.id}`
    ok(aindaEnviada.status === 'enviada' && aindaEnviada.cancelled_at === null,
      'prévia NÃO alterou o status nem gravou cancelled_at')

    // status que não permite cancelar
    await sql`UPDATE nfse_emissions SET status = 'erro' WHERE id = ${em.id}`
    r = await chamar(cancelar, { emission_id: em.id })
    ok(r.code === 409 && /não pode ser cancelada/.test(r.body.error),
      'status "erro" → 409 (o esboço exigia "approved", que nunca é gravado)')
    await sql`UPDATE nfse_emissions SET status = 'enviada' WHERE id = ${em.id}`

    // ---- webhook com assinatura válida sobre esta emissão -----------------
    const w = await chamarWebhook({ nsu: 'nsu-cancel-teste', status: 'approved', event: 'nfse.autorizada' })
    ok(w.code === 200 && w.body.statusNovo === 'autorizada', 'webhook válido → status vira autorizada')
    const [dep] = await sql`SELECT status, approved_at FROM nfse_emissions WHERE id = ${em.id}`
    ok(dep.status === 'autorizada' && dep.approved_at !== null, 'banco atualizado com approved_at')

    const ev1 = await sql`SELECT count(*)::int n FROM nfse_events WHERE nfse_emission_id = ${em.id}`
    ok(ev1[0].n === 1, 'evento registrado')

    // reentrega do MESMO aviso não duplica a timeline
    const ts = new Date().toISOString()
    await chamarWebhook({ nsu: 'nsu-cancel-teste', status: 'approved', timestamp: ts })
    await chamarWebhook({ nsu: 'nsu-cancel-teste', status: 'approved', timestamp: ts })
    const ev2 = await sql`SELECT count(*)::int n FROM nfse_events WHERE nfse_emission_id = ${em.id}`
    ok(ev2[0].n === 2, `reentrega não duplica evento (${ev2[0].n} eventos, não 3)`)

    // ---- histórico --------------------------------------------------------
    ok((await chamar(eventos, { emission_id: em.id }, false, 'GET')).code === 401, 'eventos sem token → 401')
    ok((await chamar(eventos, {}, true, 'GET')).code === 400, 'eventos sem emission_id → 400')
    const h = await chamar(eventos, { emission_id: em.id }, true, 'GET')
    ok(h.code === 200 && h.body.events.length === 2, 'histórico devolve os eventos')
    ok(h.body.events[0].label === 'Autorizada', `rótulo resolvido no servidor: ${h.body.events[0].label}`)
    ok(h.body.events[0].origem === 'webhook', 'origem marcada como webhook')
    // ⚠️ ordem CRESCENTE: o esboço ordenava DESC e a timeline saía invertida
    const ordenado = new Date(h.body.events[0].event_timestamp) <= new Date(h.body.events[1].event_timestamp)
    ok(ordenado, 'eventos em ordem cronológica crescente')
  } finally {
    if (em) await sql`DELETE FROM nfse_emissions WHERE id = ${em.id}`
    await sql`DELETE FROM nfse_certificates WHERE company_id = ${EMPRESA}`
    await sql`DELETE FROM nfse_emitter_settings WHERE company_id = ${EMPRESA}`
    const s1 = await sql`SELECT count(*)::int n FROM nfse_emissions WHERE invoice_id = ${INVOICE}`
    const s2 = await sql`SELECT count(*)::int n FROM nfse_events`
    ok(s1[0].n === 0 && s2[0].n === 0, 'banco restaurado (emissões e eventos limpos pelo CASCADE)')
  }
}

// ---------------------------------------------------------------------------
if (falhas > 0) {
  console.error(`\n❌ ${falhas} VERIFICAÇÃO(ÕES) FALHARAM!`)
  process.exit(1)
}
console.log('\n✅ TODOS OS TESTES PASSARAM!')
