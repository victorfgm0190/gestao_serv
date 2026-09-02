// Roda com: node lib/tomador-nfse.test.js
//
// Tomador condicional (contracts.invoice_client_id → invoices.invoice_client_id →
// tomador da NFS-e). Contra a produção, em PRÉVIA — nenhuma nota é transmitida.
//
// ⚠️ Nada de dado real é apagado: o teste cria a própria fatura, restaura o
// contrato que alterou e desfaz tudo no finally.
import 'dotenv/config'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-16-chars'
import { neon } from '@neondatabase/serverless'
import { DOMParser } from '@xmldom/xmldom'
import { signToken } from './auth.js'
import contratosHandler from '../api/contracts.js'
import invoicesHandler from '../api/invoices.js'
import emitHandler from '../api/nfse-emit.js'
import validarHandler from '../api/nfse-validate-setup.js'
import { verificarSetup } from './nfse-setup-check.js'

const sql = neon(process.env.DATABASE_URL)
let falhas = 0
const ok = (cond, msg) => { console.log(`  ${cond ? '✅' : '❌'} ${msg}`); if (!cond) falhas++; return cond }

const token = signToken({ sub: 'teste', username: 'teste' })
const chamar = (handler, { method = 'POST', body = {}, query = {} } = {}) => {
  const res = { code: 0, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
  return handler({ method, body, query, headers: { authorization: `Bearer ${token}` } }, res).then(() => res)
}

const EMPRESA = 1
let contratoOriginal = null
let invId = null
let recId = null

try {
  const [contrato] = await sql`
    SELECT c.* FROM contracts c
    JOIN clients cl ON cl.id = c.client_id
    WHERE c.company_id = ${EMPRESA} AND c.require_nf IS NOT FALSE
      AND c.billing_type = 'hora' AND cl.cpf_cnpj IS NOT NULL
    ORDER BY c.id LIMIT 1`
  const [outro] = contrato ? await sql`
    SELECT c.id, c.name, c.cpf_cnpj FROM clients c
    JOIN client_companies cc ON cc.client_id = c.id AND cc.company_id = ${EMPRESA}
    WHERE c.id <> ${contrato.client_id} AND c.cpf_cnpj IS NOT NULL
    ORDER BY c.id LIMIT 1` : []
  if (!contrato || !outro) { console.log('⏭️  PULADO: sem contrato/cliente elegível'); process.exit(0) }
  contratoOriginal = contrato
  console.log(`\nContrato #${contrato.id} (cliente ${contrato.client_id}) → tomador ${outro.id} "${outro.name}"`)

  // -------------------------------------------------------------------------
  console.log('\n🧪 TESTE 1: PATCH grava o tomador e o GET o devolve')
  const patch = await chamar(contratosHandler, { method: 'PATCH', body: { ...contrato, invoice_client_id: outro.id } })
  ok(patch.code === 200, `PATCH → ${patch.code} ${patch.body?.error || ''}`)
  ok(Number(patch.body?.contract?.invoice_client_id) === outro.id, 'invoice_client_id gravado')

  const get = await chamar(contratosHandler, { method: 'GET', query: { company_id: EMPRESA } })
  const naLista = get.body.contracts.find(c => c.id === contrato.id)
  ok(naLista?.invoice_client_name === outro.name, `GET devolve invoice_client_name = ${naLista?.invoice_client_name}`)

  console.log('\n🧪 TESTE 2: tomador igual ao cliente base normaliza para NULL')
  const mesmo = await chamar(contratosHandler, { method: 'PATCH', body: { ...contrato, invoice_client_id: contrato.client_id } })
  ok(mesmo.body?.contract?.invoice_client_id === null, 'invoice_client_id = cliente do contrato → NULL')
  await chamar(contratosHandler, { method: 'PATCH', body: { ...contrato, invoice_client_id: outro.id } })

  // -------------------------------------------------------------------------
  console.log('\n🧪 TESTE 3: a fatura congela o tomador do contrato')
  const [te] = await sql`
    SELECT id FROM time_entries WHERE contract_id = ${contrato.id} ORDER BY id DESC LIMIT 1`
  const criar = await chamar(invoicesHandler, { method: 'POST', body: {
    company_id: EMPRESA, client_id: contrato.client_id, contract_id: contrato.id,
    month: 1, year: 2020, billing_type: te ? 'agenda' : 'contract',
    time_entry_ids: te ? [te.id] : null, invoice_number: 'TESTE-TOMADOR',
    emission_date: '2020-01-31',
  } })
  ok(criar.code === 201 || criar.code === 200, `POST /invoices → ${criar.code} ${criar.body?.error || ''}`)
  invId = criar.body?.invoice?.id
  recId = criar.body?.invoice?.receivable_id
  ok(Number(criar.body?.invoice?.invoice_client_id) === outro.id,
    `invoices.invoice_client_id = ${criar.body?.invoice?.invoice_client_id}`)
  ok(Number(criar.body?.invoice?.client_id) === contrato.client_id,
    'client_id da fatura continua sendo o do serviço (rateio intacto)')

  const [comTomador] = await sql`SELECT victor_total, fabricio_total FROM invoices WHERE id = ${invId}`
  await sql`UPDATE invoices SET invoice_client_id = NULL WHERE id = ${invId}`
  const [semTomador] = await sql`SELECT victor_total, fabricio_total FROM invoices WHERE id = ${invId}`
  ok(Number(comTomador.victor_total) === Number(semTomador.victor_total)
    && Number(comTomador.fabricio_total) === Number(semTomador.fabricio_total),
    'split Victor/Fabrício independe do tomador')
  await sql`UPDATE invoices SET invoice_client_id = ${outro.id} WHERE id = ${invId}`

  // -------------------------------------------------------------------------
  console.log('\n🧪 TESTE 4: a emissão (prévia) sai no CNPJ do tomador')
  const previa = await chamar(emitHandler, { body: { invoice_id: invId, transmitir: false } })
  if (previa.code === 200 && (previa.body?.xml || previa.body?.xml_assinado)) {
    const doc = new DOMParser().parseFromString(previa.body.xml_assinado || previa.body.xml, 'text/xml')
    const toma = doc.getElementsByTagName('toma')[0]
    const cnpjNota = toma?.getElementsByTagName('CNPJ')[0]?.textContent
      || toma?.getElementsByTagName('CPF')[0]?.textContent
    ok(cnpjNota === String(outro.cpf_cnpj).replace(/\D/g, ''),
      `<toma> traz o CNPJ do tomador (${cnpjNota} vs ${String(outro.cpf_cnpj).replace(/\D/g, '')})`)
  } else {
    console.log(`  ⏭️  prévia não montou o XML (${previa.code}): ${previa.body?.error || ''}`)
    if (previa.body?.faltando) console.log(`     faltando: ${previa.body.faltando.map(f => f.rotulo).join(', ')}`)
  }

  // A validação e a emissão precisam olhar o MESMO cliente — é o ponto do COALESCE.
  const r = await verificarSetup(sql, EMPRESA, invId)
  ok(r.tomador?.client_id === outro.id, `verificarSetup aponta o tomador "${r.tomador?.cliente}"`)

  const val = await chamar(validarHandler, { method: 'GET', query: { company_id: EMPRESA, invoice_id: invId } })
  ok(val.body?.tomador?.client_id === outro.id,
    `nfse-validate-setup valida o tomador "${val.body?.tomador?.cliente}"`)

  console.log('\n🧪 TESTE 5: sem tomador definido, a nota volta ao cliente base')
  await sql`UPDATE invoices SET invoice_client_id = NULL WHERE id = ${invId}`
  const rBase = await verificarSetup(sql, EMPRESA, invId)
  ok(rBase.tomador?.client_id === contrato.client_id,
    `NULL → tomador é o cliente do contrato (${rBase.tomador?.cliente})`)

} finally {
  // Limpeza: só o que ESTE teste criou.
  //
  // ⚠️ A competência 01/2020 é escolhida por ser vazia: emitir a fatura dispara
  // `apurarCompetencia`, que grava fiscal_obligations e as linhas `origin='fiscal'`
  // de payables_victor. Apagar só a fatura deixaria um DAS de um mês que não existe.
  if (invId) {
    await sql`DELETE FROM invoices WHERE id = ${invId}`
    if (recId) await sql`DELETE FROM receivables WHERE id = ${recId}`
    await sql`DELETE FROM payables_victor WHERE company_id = ${EMPRESA} AND year = 2020 AND month = 1 AND origin = 'fiscal'`
    await sql`DELETE FROM fiscal_obligations WHERE company_id = ${EMPRESA} AND year = 2020 AND month = 1`
    console.log(`\n🧹 fatura #${invId}, recebível #${recId} e a apuração de 01/2020 removidos`)
  }
  if (contratoOriginal) {
    await sql`UPDATE contracts SET invoice_client_id = ${contratoOriginal.invoice_client_id ?? null} WHERE id = ${contratoOriginal.id}`
    console.log(`🧹 contrato #${contratoOriginal.id} restaurado (invoice_client_id = ${contratoOriginal.invoice_client_id ?? 'NULL'})`)
  }
}

console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ tudo passou')
process.exit(falhas ? 1 : 0)
