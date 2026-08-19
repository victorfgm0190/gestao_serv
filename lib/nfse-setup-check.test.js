// Roda com: node lib/nfse-setup-check.test.js
import 'dotenv/config'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-16-chars'
import forge from 'node-forge'
import { neon } from '@neondatabase/serverless'
import { signToken } from './auth.js'
import { CAMPOS_EMITENTE, CAMPOS_TOMADOR, verificarSetup } from './nfse-setup-check.js'
import validar from '../api/nfse-validate-setup.js'
import settings from '../api/nfse-emitter-settings.js'
import emitir from '../api/nfse-emit.js'

let falhas = 0
const ok = (cond, msg) => {
  console.log(`  ${cond ? '✅' : '❌'} ${msg}`)
  if (!cond) falhas++
  return cond
}

const EMPRESA = 1
const INV_COM_NF = 37   // Bokada
const INV_SEM_NF = 36   // Minas (require_nf = false)
const CLIENTE = 13

const sql = neon(process.env.DATABASE_URL)
const token = signToken({ sub: '1', username: 'teste', master: true })
const chamar = async (handler, dados, { auth = true, method = 'GET' } = {}) => {
  const res = {
    code: 0, body: null,
    status(c) { this.code = c; return this },
    json(b) { this.body = b; return this },
  }
  await handler({
    method,
    query: method === 'GET' ? dados : {},
    body: method !== 'GET' ? dados : undefined,
    headers: auth ? { authorization: `Bearer ${token}` } : {},
  }, res)
  return res
}

// ---------------------------------------------------------------------------
console.log('🧪 TESTE 1: a lista de obrigatórios bate com a que a emissão aplica')
// ⚠️ O ponto desta etapa. A lista do esboço divergia nos DOIS sentidos:
// exigia nbs_codigo/codigo_tributacao (opcionais na DPS) e não exigia
// cnpj, razao_social, uf nem item_lista_servico (este é o cTribNac, obrigatório).
const nomes = CAMPOS_EMITENTE.map(([c]) => c)
ok(nomes.includes('item_lista_servico'), 'exige item_lista_servico (cTribNac — obrigatório na DPS)')
ok(nomes.includes('cnpj') && nomes.includes('razao_social') && nomes.includes('uf'),
  'exige CNPJ, razão social e UF')
ok(!nomes.includes('nbs') && !nomes.includes('codigo_tributacao_municipal'),
  'NÃO exige NBS nem código de tributação municipal — são tagOpcional no XML')
ok(!nomes.includes('nbs_codigo') && !nomes.includes('codigo_tributacao'),
  'não usa os nomes de coluna do esboço, que não existem no banco')
ok(CAMPOS_TOMADOR.map(([c]) => c).includes('municipio_codigo'), 'tomador exige município')
// ⚠️ Inscrição municipal é OPCIONAL no Emissor Nacional (decisão de 2026-08-19).
ok(!nomes.includes('inscricao_municipal'), 'NÃO exige inscrição municipal')

// A prova real: a emissão importa ESTA lista. Se divergirem, o teste de
// emissão da etapa 4 quebraria — aqui basta confirmar que é a mesma origem.
const src = (await import('node:fs')).readFileSync('api/nfse-emit.js', 'utf8')
ok(/from '\.\.\/lib\/nfse-setup-check\.js'/.test(src),
  'api/nfse-emit.js importa a lista compartilhada em vez de manter cópia')

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 2: endpoint de validação')
ok((await chamar(validar, { company_id: 1 }, { auth: false })).code === 401, 'sem token → 401')
ok((await chamar(validar, {})).code === 400, 'sem company_id → 400')
ok((await chamar(validar, { company_id: 'x' })).code === 400, 'company_id inválido → 400')
ok((await chamar(validar, { company_id: 1 }, { method: 'POST' })).code === 405, 'POST → 405')

// ⚠️ O certificado da empresa pode ser REAL (enviado pela tela). O teste nunca
// o insere nem o apaga: se já existir, é usado só para leitura e o cenário do
// certificado vencido é pulado. Apagar um A1 de verdade é irreversível — o
// .pfx não fica guardado em outro lugar.
const certProprio = (await sql`SELECT id, certificate_subject FROM nfse_certificates WHERE company_id = ${EMPRESA}`)[0] || null
const tinha = await sql`SELECT id FROM nfse_emitter_settings WHERE company_id = ${EMPRESA}`
if (tinha.length) {
  console.log('  ⏭️  PULADO: empresa 1 já tem emitente configurado — não será sobrescrito')
} else {
  if (certProprio) console.log(`     (usando o certificado já cadastrado, sem alterá-lo: ${certProprio.certificate_subject})`)
  const clienteAntes = (await sql`SELECT * FROM clients WHERE id = ${CLIENTE}`)[0]
  try {
    // ⚠️ Nada configurado: responde 200 com pronto:false, não 422. O esboço
    // devolvia 422 — e a pergunta feita aqui é justamente "falta algo?".
    let r = await chamar(validar, { company_id: EMPRESA })
    ok(r.code === 200 && r.body.pronto === false,
      `nada configurado → 200 com pronto:false (${r.body.campos_faltantes.length} pendências)`)
    ok(certProprio
      ? r.body.certificado.presente === true
      : r.body.campos_faltantes.some((c) => /Certificado digital/.test(c)),
      certProprio ? 'certificado já cadastrado é reconhecido' : 'certificado ausente entra na lista')
    ok(/Configuração → Emitente/.test(r.body.acao), 'ação aponta para a tela certa')

    // ---- salvar parcial ---------------------------------------------------
    console.log('\n🧪 TESTE 3: gravação do emitente')
    ok((await chamar(settings, { company_id: EMPRESA, cnpj: '123' }, { method: 'POST' })).code === 400,
      'CNPJ com tamanho errado → 400')
    ok((await chamar(settings, { company_id: EMPRESA, cep: '123' }, { method: 'POST' })).code === 400,
      'CEP com tamanho errado → 400')
    ok((await chamar(settings, { company_id: EMPRESA, ambiente: 7 }, { method: 'POST' })).code === 400,
      'ambiente fora de 1/2 → 400')

    // ⚠️ Salvar incompleto é PERMITIDO. O esboço recusava com 400 no primeiro
    // campo vazio, e a configuração fiscal é preenchida em várias sessões.
    let s = await chamar(settings,
      { company_id: EMPRESA, razao_social: 'LUMEN DEV LTDA', cnpj: '12.345.678/0001-90' },
      { method: 'POST' })
    ok(s.code === 200, 'salvar parcial → 200')
    ok(s.body.settings.cnpj === '12345678000190', 'CNPJ normalizado para só dígitos')

    r = await chamar(validar, { company_id: EMPRESA })
    ok(r.body.pronto === false && r.body.emitente.configurado === true,
      'emitente existe mas incompleto — a validação distingue os dois casos')

    s = await chamar(settings, {
      company_id: EMPRESA, razao_social: 'LUMEN DEV LTDA', cnpj: '12345678000190',
      inscricao_municipal: '987654', endereco: 'Rua das Flores', numero: '100',
      bairro: 'Centro', cep: '01001-000', municipio_codigo: '3550308', uf: 'sp',
      item_lista_servico: '01.06', aliquota_iss: '2.00', ambiente: '2',
    }, { method: 'POST' })
    ok(s.code === 200 && s.body.settings.uf === 'SP', 'UF normalizada para maiúsculas')
    ok(s.body.settings.cep === '01001000', 'CEP normalizado')

    const g = await chamar(settings, { company_id: EMPRESA })
    ok(g.code === 200 && g.body.settings.inscricao_municipal === '987654', 'GET devolve o gravado')

    // ---- ainda falta o certificado ---------------------------------------
    r = await chamar(validar, { company_id: EMPRESA })
    ok(r.body.emitente.completo === true, 'emitente completo')
    if (!certProprio) {
      ok(r.body.pronto === false && r.body.campos_faltantes.length === 1
         && /Certificado/.test(r.body.campos_faltantes[0]),
        'sem certificado, a única pendência é ele')
    }

    // certificado VENCIDO — presente não basta
    if (!certProprio) {
    const keys = forge.pki.rsa.generateKeyPair(1024)
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = '01'
    cert.validity.notBefore = new Date(Date.now() - 400 * 86400000)
    cert.validity.notAfter = new Date(Date.now() - 10 * 86400000) // venceu
    const at = [{ name: 'commonName', value: 'FIXTURE VENCIDO' }]
    cert.setSubject(at); cert.setIssuer(at); cert.sign(keys.privateKey)
    const cm = (await import('./crypto-manager.js')).default
    const pfx = Buffer.from(forge.asn1.toDer(
      forge.pkcs12.toPkcs12Asn1(keys.privateKey, cert, 'p', { algorithm: '3des' })).getBytes(), 'binary')
    const e1 = cm.encryptBinary(pfx); const e2 = cm.encrypt('p')
    await sql`
      INSERT INTO nfse_certificates
        (company_id, certificate_pfx_encrypted, certificate_pfx_iv,
         certificate_password_encrypted, certificate_password_iv,
         certificate_subject, certificate_valid_from, certificate_valid_until)
      VALUES (${EMPRESA}, ${e1.encrypted}, ${e1.iv}, ${e2.encrypted}, ${e2.iv},
              'FIXTURE VENCIDO', ${cert.validity.notBefore}, ${cert.validity.notAfter})`

    r = await chamar(validar, { company_id: EMPRESA })
    ok(r.body.pronto === false && r.body.certificado.presente === true && r.body.certificado.valido === false,
      `certificado VENCIDO é presente mas inválido — "${r.body.certificado.motivo}"`)

    await sql`UPDATE nfse_certificates SET certificate_valid_until = ${new Date(Date.now() + 60 * 86400000)}
              WHERE company_id = ${EMPRESA}`
    } else {
      console.log('     (cenário de certificado vencido pulado: há um certificado real cadastrado)')
    }
    r = await chamar(validar, { company_id: EMPRESA })
    ok(r.body.pronto === true, 'com certificado válido → pronto:true')

    // ---- tomador ----------------------------------------------------------
    console.log('\n🧪 TESTE 4: tomador')
    r = await chamar(validar, { company_id: EMPRESA, invoice_id: INV_COM_NF })
    ok(r.body.pronto === false && r.body.tomador.faltando.length > 0,
      `cliente sem cadastro fiscal → ${r.body.tomador.faltando.length} pendências`)
    ok(/Complete o cadastro/.test(r.body.acao), 'ação manda para Clientes, não para Configurações')

    // ⚠️ Cliente sem NF não é pendência: é contrato que não emite nota.
    r = await chamar(validar, { company_id: EMPRESA, invoice_id: INV_SEM_NF })
    ok(r.body.tomador.sem_nf === true && r.body.tomador.faltando.length === 0,
      'contrato sem NF (Minas) não vira lista de campos a preencher')
    ok(r.body.pronto === true, 'e não impede o "pronto" do emitente')

    await sql`
      UPDATE clients SET cpf_cnpj = '98765432000110', razao_social = 'BOKADA COMERCIO LTDA',
        endereco = 'Av. Brasil', numero = '456', bairro = 'Vila', cep = '87123456',
        municipio_codigo = '4106902', uf = 'PR' WHERE id = ${CLIENTE}`
    r = await chamar(validar, { company_id: EMPRESA, invoice_id: INV_COM_NF })
    ok(r.body.pronto === true, 'com tomador completo → pronto:true')

    // ---- a prova de que validador e emissão concordam ---------------------
    console.log('\n🧪 TESTE 5: validador e emissão dão a mesma resposta')
    const em = await chamar(emitir, { invoice_id: INV_COM_NF }, { method: 'POST' })
    ok(em.code === 200 && em.body.preview === true,
      'validação diz pronto e a emissão gera a prévia (não devolve 422)')

    // e o inverso: tirar um campo derruba os dois juntos
    await sql`UPDATE nfse_emitter_settings SET item_lista_servico = NULL WHERE company_id = ${EMPRESA}`
    const v2 = await chamar(validar, { company_id: EMPRESA, invoice_id: INV_COM_NF })
    const e3 = await chamar(emitir, { invoice_id: INV_COM_NF }, { method: 'POST' })
    ok(v2.body.pronto === false, 'sem item da lista: validador acusa')
    ok(e3.code === 422, 'sem item da lista: emissão recusa')
    const rotuloV = v2.body.faltando.find((f) => f.campo === 'emitente.item_lista_servico')
    const rotuloE = (e3.body.faltando || []).find((f) => f.campo === 'emitente.item_lista_servico')
    ok(Boolean(rotuloV) && Boolean(rotuloE) && rotuloV.rotulo === rotuloE.rotulo,
      `os dois apontam o MESMO campo, com o mesmo rótulo: "${rotuloV?.rotulo}"`)
  } finally {
    await sql`DELETE FROM nfse_emissions WHERE company_id = ${EMPRESA}`
    if (!certProprio) await sql`DELETE FROM nfse_certificates WHERE company_id = ${EMPRESA}`
    await sql`DELETE FROM nfse_emitter_settings WHERE company_id = ${EMPRESA}`
    const c = clienteAntes
    await sql`
      UPDATE clients SET cpf_cnpj = ${c.cpf_cnpj}, razao_social = ${c.razao_social},
        endereco = ${c.endereco}, numero = ${c.numero}, bairro = ${c.bairro},
        cep = ${c.cep}, municipio_codigo = ${c.municipio_codigo}, uf = ${c.uf}
      WHERE id = ${CLIENTE}`
    const [dep] = await sql`SELECT cpf_cnpj, endereco FROM clients WHERE id = ${CLIENTE}`
    const [n] = await sql`SELECT count(*)::int n FROM nfse_emitter_settings`
    const certDepois = (await sql`SELECT id FROM nfse_certificates WHERE company_id = ${EMPRESA}`).length
    ok(dep.cpf_cnpj === c.cpf_cnpj && dep.endereco === c.endereco && n.n === 0
       && certDepois === (certProprio ? 1 : 0),
      'banco restaurado — inclusive o certificado real, que segue no lugar')
  }
}

// verificarSetup é usável direto, sem HTTP
const direto = await verificarSetup(sql, 999999)
ok(direto.pronto === false && direto.emitente.configurado === false,
  'verificarSetup em empresa sem nada não estoura')

if (falhas > 0) {
  console.error(`\n❌ ${falhas} VERIFICAÇÃO(ÕES) FALHARAM!`)
  process.exit(1)
}
console.log('\n✅ TODOS OS TESTES PASSARAM!')
