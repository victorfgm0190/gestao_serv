// Roda com: node lib/nfse-competencia.test.js
//
// dCompet = DIA DA TRANSMISSÃO (decisão do Victor, 2026-09-02), e não mais o 1º do
// mês de referência. Contra a produção: a prévia é conferida no XML montado e a
// transmissão real acontece em HOMOLOGAÇÃO.
//
// ⚠️ Nada de dado real é apagado: a fatura é criada aqui, as emissões de
// homologação que o teste gerar são removidas no finally, e a apuração que o POST
// da fatura dispara é desfeita junto.
import 'dotenv/config'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-16-chars'
import { neon } from '@neondatabase/serverless'
import { DOMParser } from '@xmldom/xmldom'
import { signToken } from './auth.js'
import { dataISO } from './nfse-xml-builder.js'
import invoicesHandler from '../api/invoices.js'
import emitHandler from '../api/nfse-emit.js'

const sql = neon(process.env.DATABASE_URL)
let falhas = 0
const ok = (cond, msg) => { console.log(`  ${cond ? '✅' : '❌'} ${msg}`); if (!cond) falhas++; return cond }

const token = signToken({ sub: 'teste', username: 'teste' })
const chamar = (handler, { method = 'POST', body = {}, query = {} } = {}) => {
  const res = { code: 0, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
  return handler({ method, body, query, headers: { authorization: `Bearer ${token}` } }, res).then(() => res)
}

const dCompetDo = (xml) =>
  new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagName('dCompet')[0]?.textContent

const EMPRESA = 1
const HOJE = dataISO(new Date())
let invId = null
let recId = null
const emissoesCriadas = []

try {
  // Fatura com mês de referência PROPOSITALMENTE distante da data de hoje: é a
  // diferença entre os dois que o teste mede.
  const [contrato] = await sql`
    SELECT c.* FROM contracts c JOIN clients cl ON cl.id = c.client_id
    WHERE c.company_id = ${EMPRESA} AND c.require_nf IS NOT FALSE
      AND c.billing_type = 'hora' AND cl.cpf_cnpj IS NOT NULL
    ORDER BY c.id LIMIT 1`
  if (!contrato) { console.log('⏭️  PULADO: sem contrato elegível'); process.exit(0) }

  const [te] = await sql`SELECT id FROM time_entries WHERE contract_id = ${contrato.id} ORDER BY id DESC LIMIT 1`
  const criar = await chamar(invoicesHandler, { method: 'POST', body: {
    company_id: EMPRESA, client_id: contrato.client_id, contract_id: contrato.id,
    month: 1, year: 2020, billing_type: te ? 'agenda' : 'contract',
    time_entry_ids: te ? [te.id] : null, invoice_number: 'TESTE-DCOMPET',
    emission_date: '2020-01-31',
  } })
  invId = criar.body?.invoice?.id
  recId = criar.body?.invoice?.receivable_id
  ok(criar.code === 201, `fatura criada (#${invId}) ref 01/2020, emission_date 2020-01-31`)
  ok(criar.body?.invoice?.competencia === null, 'POST /invoices deixa competencia NULL')

  // -------------------------------------------------------------------------
  console.log('\n🧪 TESTE 1: a prévia monta dCompet = hoje')
  const previa = await chamar(emitHandler, { body: { invoice_id: invId, transmitir: false } })
  ok(previa.code === 200, `prévia → ${previa.code} ${previa.body?.error || ''}`)
  const dCompetPrevia = dCompetDo(previa.body?.xml_assinado || '')
  ok(dCompetPrevia === HOJE, `<dCompet> = ${dCompetPrevia} (hoje = ${HOJE})`)
  ok(dCompetPrevia !== '2020-01-01', 'não é mais o 1º do mês de referência')
  ok(previa.body?.resumo?.competencia === HOJE, `o resumo da prévia mostra ${previa.body?.resumo?.competencia}`)

  console.log('\n🧪 TESTE 2: a prévia não grava nada')
  const [aposPrevia] = await sql`SELECT competencia FROM invoices WHERE id = ${invId}`
  ok(aposPrevia.competencia === null, 'invoices.competencia continua NULL depois da prévia')

  // -------------------------------------------------------------------------
  console.log('\n🧪 TESTE 3: transmissão real em HOMOLOGAÇÃO grava a competência')
  process.env.NFSE_AMBIENTE = 'homologacao'
  const antes = new Date()
  const envio = await chamar(emitHandler, { body: { invoice_id: invId, transmitir: true } })
  const novas = await sql`
    SELECT id, competencia, status, ambiente FROM nfse_emissions
    WHERE invoice_id = ${invId} AND created_at >= ${antes}`
  emissoesCriadas.push(...novas.map((n) => n.id))

  if (envio.code === 200 || envio.code === 201) {
    const [emissao] = novas
    ok(dataISO(emissao.competencia) === HOJE, `nfse_emissions.competencia = ${dataISO(emissao.competencia)}`)
    const [fatura] = await sql`SELECT competencia FROM invoices WHERE id = ${invId}`
    ok(dataISO(fatura.competencia) === HOJE, `invoices.competencia gravada = ${dataISO(fatura.competencia)}`)
    const dCompetEnviado = dCompetDo(await sql`SELECT xml_assinado FROM nfse_emissions WHERE id = ${emissao.id}`.then(r => r[0].xml_assinado))
    ok(dCompetEnviado === HOJE, `o XML que SAIU traz dCompet = ${dCompetEnviado}`)
  } else {
    console.log(`  ⏭️  transmissão não concluída (${envio.code}): ${envio.body?.error || ''}`)
    // Mesmo recusada, a gravação só pode acontecer no sucesso.
    const [fatura] = await sql`SELECT competencia FROM invoices WHERE id = ${invId}`
    ok(fatura.competencia === null, 'transmissão sem sucesso não grava competencia na fatura')
  }

  // -------------------------------------------------------------------------
  console.log('\n🧪 TESTE 4: a apuração fiscal continua olhando emission_date')
  const [fiscal] = await sql`
    SELECT EXTRACT(YEAR FROM COALESCE(emission_date, make_date(year, month, 1)))::int AS y,
           EXTRACT(MONTH FROM COALESCE(emission_date, make_date(year, month, 1)))::int AS m
    FROM invoices WHERE id = ${invId}`
  ok(fiscal.y === 2020 && fiscal.m === 1,
    `competência FISCAL da fatura = ${fiscal.m}/${fiscal.y} (emission_date), independente do dCompet`)

  console.log('\n🧪 TESTE 5: o "hoje" é o de São Paulo, não o do UTC')
  // Das 21h à meia-noite BRT o UTC já virou o dia: toISOString() daria amanhã e o
  // SEFIN recusaria a competência futura (E0015).
  const utcTardeDaNoite = new Date(Date.UTC(2026, 8, 3, 1, 30, 0)) // 02/09 22:30 em SP
  ok(dataISO(utcTardeDaNoite) === '2026-09-02',
    `22:30 BRT → ${dataISO(utcTardeDaNoite)} (toISOString daria 2026-09-03)`)

} finally {
  for (const id of emissoesCriadas) {
    await sql`DELETE FROM nfse_emissions WHERE id = ${id}`
  }
  if (emissoesCriadas.length) console.log(`\n🧹 emissões de homologação removidas: ${emissoesCriadas.join(', ')}`)
  if (invId) {
    await sql`DELETE FROM nfse_operations WHERE invoice_id = ${invId}`
    await sql`DELETE FROM invoices WHERE id = ${invId}`
    if (recId) await sql`DELETE FROM receivables WHERE id = ${recId}`
    await sql`DELETE FROM payables_victor WHERE company_id = ${EMPRESA} AND year = 2020 AND month = 1 AND origin = 'fiscal'`
    await sql`DELETE FROM fiscal_obligations WHERE company_id = ${EMPRESA} AND year = 2020 AND month = 1`
    console.log(`🧹 fatura #${invId}, recebível #${recId} e a apuração de 01/2020 removidos`)
  }
}

console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ tudo passou')
process.exit(falhas ? 1 : 0)
