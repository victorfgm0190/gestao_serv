// Roda com: node lib/nf-override.test.js
//
// NF digitada da regra no modo líquido (financial_rules.nf_value_override).
// Contra a produção, em PRÉVIA — nenhuma fatura é gravada.
//
// ⚠️ Nada de dado real é apagado: as OS de teste são criadas numa competência vazia
// (01/2020) e removidas no finally; a regra da Romaneli volta ao estado original e as
// OS em aberto dela são recalculadas de volta.
//
// Para o teste 3 (regras sem override inalteradas) as versões ANTERIORES do cálculo são
// extraídas do git para arquivos temporários e comparadas com as atuais.
import 'dotenv/config'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-16-chars'
process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || 'segredo-admin-local-de-teste'
import { execSync } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { signToken } from './auth.js'
import adminHandler from '../api/admin.js'
import rulesHandler from '../api/financial-rules.js'
import entriesHandler from '../api/time-entries.js'
import invoicesHandler, { calcAgenda } from '../api/invoices.js'
import { calcular } from './time-entry-calc.js'
import { cotasDeDiaria } from './billing-type.js'

const sql = neon(process.env.DATABASE_URL)
let falhas = 0
const ok = (cond, msg) => { console.log(`  ${cond ? '✅' : '❌'} ${msg}`); if (!cond) falhas++; return cond }
const brl = (v) => `R$ ${Number(v).toFixed(2)}`

const token = signToken({ sub: 'teste', username: 'teste' })
const chamar = (handler, { method = 'POST', body = {}, query = {}, admin = false } = {}) => {
  const res = { code: 0, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
  const auth = admin ? process.env.ADMIN_SECRET : token
  return handler({ method, body, query, headers: { authorization: `Bearer ${auth}` } }, res).then(() => res)
}

const REGRA = 21      // Romaneli — diária R$ 1.500 líquida, 9,2% por fora, 100% Victor
const CONTRATO = 15
const EMPRESA = 1
let regraOriginal = null
const osTeste = []
const temporarios = []

try {
  console.log('\n🧪 MIGRATION: ?action=migrate-nf-override')
  const mig = await chamar(adminHandler, { query: { action: 'migrate-nf-override' }, admin: true })
  ok(mig.code === 200 && mig.body?.coluna?.column_name === 'nf_value_override', `coluna ${JSON.stringify(mig.body?.coluna)}`)

  ;[regraOriginal] = await sql`SELECT * FROM financial_rules WHERE id = ${REGRA}`
  const [contrato] = await sql`SELECT * FROM contracts WHERE id = ${CONTRATO}`
  const vazio = await sql`SELECT count(*)::int n FROM time_entries WHERE contract_id = ${CONTRATO} AND entry_date BETWEEN '2020-01-01' AND '2020-01-31'`
  if (!regraOriginal || !contrato || vazio[0].n) { console.log('⏭️  PULADO: regra/contrato ausente ou 01/2020 não está vazio'); process.exit(0) }

  const put = (override) => chamar(rulesHandler, { method: 'PUT', query: { id: REGRA }, body: { ...regraOriginal, nf_value_override: override } })
  const previa = () => chamar(invoicesHandler, {
    query: { action: 'preview' },
    body: { company_id: EMPRESA, contract_id: CONTRATO, month: 1, year: 2020, time_entry_ids: osTeste },
  })

  // ---------------------------------------------------------------------------
  console.log('\n🧪 TESTE 1: override R$ 1.652,00 → 3 OS em 2 datas')
  const r1 = await put(1652)
  ok(r1.code === 200 && Number(r1.body.rule.nf_value_override) === 1652, `PUT → ${r1.code} override=${r1.body?.rule?.nf_value_override}`)
  const recalc1 = r1.body.apontamentos_recalculados || []
  console.log(`     recalculados: ${recalc1.map(a => `#${a.id} ${brl(a.antes.gross_value)}→${brl(a.depois.gross_value)}`).join(', ') || 'nenhum'}`)

  for (const [data, ini, fim] of [['2020-01-06', '08:00', '12:00'], ['2020-01-06', '13:00', '17:00'], ['2020-01-07', '08:00', '17:00']]) {
    const r = await chamar(entriesHandler, { body: {
      company_id: EMPRESA, client_id: contrato.client_id, contract_id: CONTRATO, entry_date: data,
      description: 'TESTE nf_value_override — apagar', hora_inicial: ini, hora_final: fim,
    } })
    if (r.code !== 201) throw new Error(`POST time-entries → ${r.code} ${r.body?.error}`)
    osTeste.push(r.body.entry.id)
  }
  const os = await sql`SELECT id, entry_date, gross_value, net_value, victor_share FROM time_entries WHERE id = ANY(${osTeste}::int[]) ORDER BY id`
  const soma = (rows, k) => Math.round(rows.reduce((s, e) => s + Number(e[k]), 0) * 100) / 100
  const dia6 = os.filter(e => e.entry_date.getDate() === 6)
  console.log(`     OS: ${os.map(e => `#${e.id} NF ${brl(e.gross_value)}`).join(' · ')}`)
  ok(soma(dia6, 'gross_value') === 1652, `as 2 OS de 06/01 somam a NF da diária: ${brl(soma(dia6, 'gross_value'))}`)
  ok(soma(os, 'gross_value') === 3304, `NF das OS = ${brl(soma(os, 'gross_value'))}`)

  const p1 = await previa()
  const b1 = p1.body?.breakdown
  ok(p1.code === 200, `prévia → ${p1.code} ${p1.body?.error || ''}`)
  ok(b1?.cobranca?.unidades === 2, `diárias = ${b1?.cobranca?.unidades}`)
  ok(b1?.invoice_value === 3304, `NF ${brl(b1?.invoice_value)}`)
  ok(b1?.contract_value === 3000, `líquido ${brl(b1?.contract_value)}`)
  ok(b1?.victor_tax_diff === 304, `diferença Victor ${brl(b1?.victor_tax_diff)}`)
  ok(b1?.victor_total === 3304, `Pagar Victor ${brl(b1?.victor_total)}`)
  ok(b1?.fabricio_total === 0, `Fabrício ${brl(b1?.fabricio_total)}`)
  ok(b1?.cobranca?.nf_manual === true && b1?.cobranca?.nf_unitaria === 1652, `nf_unitaria ${brl(b1?.cobranca?.nf_unitaria)} (manual)`)

  console.log('\n🧪 VALIDAÇÃO: NF menor que o líquido é recusada')
  const rBaixo = await put(1400)
  ok(rBaixo.code === 422, `PUT 1.400 → ${rBaixo.code} ${rBaixo.body?.error || ''}`)

  // ---------------------------------------------------------------------------
  console.log('\n🧪 TESTE 2: Recalcular (override NULL) volta ao automático')
  const r2 = await put(null)
  ok(r2.code === 200 && r2.body.rule.nf_value_override === null, `PUT → ${r2.code} override=${r2.body?.rule?.nf_value_override}`)
  console.log(`     recalculados: ${(r2.body.apontamentos_recalculados || []).map(a => `#${a.id} ${brl(a.antes.gross_value)}→${brl(a.depois.gross_value)}`).join(', ')}`)
  const p2 = await previa()
  const b2 = p2.body?.breakdown
  ok(b2?.invoice_value === 3303.96, `NF ${brl(b2?.invoice_value)}`)
  ok(b2?.contract_value === 3000 && b2?.victor_tax_diff === 303.96 && b2?.victor_total === 3303.96 && b2?.fabricio_total === 0,
    `líquido ${brl(b2?.contract_value)} · dif ${brl(b2?.victor_tax_diff)} · Victor ${brl(b2?.victor_total)} · Fab ${brl(b2?.fabricio_total)}`)

  // ---------------------------------------------------------------------------
  console.log('\n🧪 TESTE 3: regras sem override — cálculo idêntico ao anterior')
  const old = (path, dest) => {
    writeFileSync(dest, execSync(`git show HEAD:${path}`, { encoding: 'utf8' }))
    temporarios.push(dest)
  }
  old('lib/time-entry-calc.js', 'lib/_old-time-entry-calc.js')
  old('api/invoices.js', 'api/_old-invoices.js')
  const { calcular: calcularAntigo } = await import('./_old-time-entry-calc.js')
  const { calcAgenda: calcAgendaAntigo } = await import('../api/_old-invoices.js')

  // Apontamentos: todos os do banco, com a regra e o contrato de cada um.
  const todos = await sql`
    SELECT te.*, row_to_json(fr) AS regra, row_to_json(ct) AS contrato
    FROM time_entries te
    JOIN contracts ct ON ct.id = te.contract_id
    JOIN financial_rules fr ON fr.id = ct.financial_rule_id
    WHERE NOT (te.id = ANY(${osTeste}::int[]))`
  let iguais = 0
  const diferentes = []
  const cotasPor = new Map()
  for (const e of todos) {
    let cota = null
    if (e.regra.billing_type === 'diaria') {
      if (!cotasPor.has(e.contract_id)) cotasPor.set(e.contract_id, cotasDeDiaria(todos.filter(x => x.contract_id === e.contract_id), e.regra))
      cota = cotasPor.get(e.contract_id).get(Number(e.id))
    }
    const a = calcularAntigo(e.hours, e.regra, e.horas_deslocamento, e.contrato, e.despesas_deslocamento, cota)
    const n = calcular(e.hours, e.regra, e.horas_deslocamento, e.contrato, e.despesas_deslocamento, cota)
    if (JSON.stringify(a) === JSON.stringify(n)) iguais++
    else diferentes.push(e.id)
  }
  ok(diferentes.length === 0, `apontamentos: ${iguais}/${todos.length} idênticos ${diferentes.length ? `(diferem: ${diferentes})` : ''}`)

  for (const [nome, contratoId] of [['Pharmalog por hora', 2], ['Bokada projeto', 10]]) {
    const [ct] = await sql`SELECT * FROM contracts WHERE id = ${contratoId}`
    const [regra] = await sql`SELECT * FROM financial_rules WHERE id = ${ct.financial_rule_id}`
    const ents = await sql`SELECT * FROM time_entries WHERE contract_id = ${contratoId} ORDER BY entry_date, id`
    const a = calcAgendaAntigo(ents, regra, { contrato: ct })
    const n = calcAgenda(ents, regra, { contrato: ct })
    const { nf_manual, nf_unitaria_automatica: _auto, ...nCobranca } = n.cobranca || {}
    const nComparavel = n.cobranca ? { ...n, cobranca: nCobranca } : n
    ok(JSON.stringify(a) === JSON.stringify(nComparavel),
      `${nome} (${ents.length} OS): NF ${brl(n.invoice_value)} · base ${brl(n.contract_value)} · Victor ${brl(n.victor_total)} · Fab ${brl(n.fabricio_total)}${n.cobranca ? ` · nf_manual=${nf_manual}` : ''}`)
  }
} catch (e) {
  console.error('💥', e)
  falhas++
} finally {
  if (osTeste.length) {
    await sql`DELETE FROM time_entries WHERE id = ANY(${osTeste}::int[])`
    console.log(`\n🧹 OS de teste removidas: ${osTeste.join(', ')}`)
  }
  if (regraOriginal) {
    const r = await chamar(rulesHandler, { method: 'PUT', query: { id: REGRA }, body: { ...regraOriginal } })
    const [os112] = await sql`SELECT gross_value FROM time_entries WHERE id = 112`
    console.log(`🧹 regra ${REGRA} restaurada (${r.code}, override=${r.body?.rule?.nf_value_override}); OS #112 NF ${os112 ? brl(os112.gross_value) : '—'}`)
  }
  for (const f of temporarios) { try { unlinkSync(f) } catch { /* já removido */ } }
}

console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ tudo certo')
process.exit(falhas ? 1 : 0)
