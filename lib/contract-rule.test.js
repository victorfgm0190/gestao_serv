// Roda com: node lib/contract-rule.test.js
//
// Contrato × regra financeira (lib/contract-rule.js) e a trava "hora/diária só pela
// Agenda" em api/invoices.js. Contra a produção, SÓ LEITURA: as faturas são em prévia
// ou recusadas antes de gravar — nenhum INSERT/UPDATE acontece.
import 'dotenv/config'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-16-chars'
import { execSync } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { signToken } from './auth.js'
import invoicesHandler, { calcContrato } from '../api/invoices.js'
import { rotuloDaRegra, camposDaRegra, divergenciasDaRegra, faturaPelaAgenda } from './contract-rule.js'
import { nfOverride } from './billing-type.js'

const sql = neon(process.env.DATABASE_URL)
let falhas = 0
const ok = (cond, msg) => { console.log(`  ${cond ? '✅' : '❌'} ${msg}`); if (!cond) falhas++; return cond }

const token = signToken({ sub: 'teste', username: 'teste' })
const chamar = (handler, { method = 'POST', body = {}, query = {} } = {}) => {
  const res = { code: 0, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
  return handler({ method, body, query, headers: { authorization: `Bearer ${token}` } }, res).then(() => res)
}
const regraPorId = async (id) => (await sql`SELECT fr.*, c.name AS client_name FROM financial_rules fr JOIN clients c ON c.id = fr.client_id WHERE fr.id = ${id}`)[0]
const contrato = async (id) => (await sql`SELECT * FROM contracts WHERE id = ${id}`)[0]
const novoContrato = { billing_type: 'mensal', remainder_victor_pct: '50', remainder_fabricio_pct: '50', has_tax: false }

try {
  console.log('\n🧪 a) Novo contrato → ROMANELI → regra #21')
  const romaneli = await regraPorId(21)
  const fa = { ...novoContrato, ...camposDaRegra(romaneli, novoContrato) }
  ok(rotuloDaRegra(romaneli) === 'ROMANELI — Diária R$ 1.500,00 (líquido)', `label "${rotuloDaRegra(romaneli)}"`)
  ok(fa.billing_type === 'dia', `tipo ${fa.billing_type}`)
  ok(fa.contract_value === '1500' && fa.victor_fixed === '1500', `diária ${fa.contract_value} · Victor fixo ${fa.victor_fixed}`)
  ok(fa.has_tax && fa.tax_percentage === '9.2' && romaneli.is_net_value, `imposto ${fa.tax_percentage}% por fora`)
  ok(fa.remainder_victor_pct === '100' && fa.remainder_fabricio_pct === '0', `split ${fa.remainder_victor_pct}/${fa.remainder_fabricio_pct}`)
  ok(faturaPelaAgenda(fa), 'somente leitura (faturado pela Agenda)')
  console.log(`     NF override na regra: ${nfOverride(romaneli) ?? 'nenhum (automático R$ 1.651,98)'}`)

  console.log('\n🧪 b) Novo contrato → Pharmalog → regra #5')
  const pharma = await regraPorId(5)
  const fb = { ...novoContrato, ...camposDaRegra(pharma, novoContrato) }
  ok(rotuloDaRegra(pharma) === 'Pharmalog/ANB — R$ 115,00/h', `label "${rotuloDaRegra(pharma)}"`)
  ok(fb.billing_type === 'hora' && fb.contract_value === '115' && fb.victor_fixed === '100', `tipo ${fb.billing_type} · hora ${fb.contract_value} · Victor/h ${fb.victor_fixed}`)
  ok(fb.has_tax && fb.tax_percentage === '7' && fb.remainder_victor_pct === '50' && fb.remainder_fabricio_pct === '50', `imposto ${fb.tax_percentage}% · split ${fb.remainder_victor_pct}/${fb.remainder_fabricio_pct}`)
  ok(faturaPelaAgenda(fb), 'somente leitura')

  console.log('\n🧪 c) Novo contrato → Bokada → regra #12 (projeto)')
  const bokada = await regraPorId(12)
  const fc = { ...novoContrato, ...camposDaRegra(bokada, novoContrato) }
  ok(rotuloDaRegra(bokada) === 'Bokada — Fixo mensal R$ 1.500,00', `label "${rotuloDaRegra(bokada)}"`)
  ok(fc.billing_type === 'mensal' && fc.contract_value === '1500' && fc.victor_fixed === '800', `tipo ${fc.billing_type} · ${fc.contract_value} / ${fc.victor_fixed}`)
  ok(!faturaPelaAgenda(fc), 'editável')
  ok(Object.keys(divergenciasDaRegra(fc, bokada)).length === 0, `sem aviso de divergência ${JSON.stringify(divergenciasDaRegra(fc, bokada))}`)

  console.log('\n🧪 d) Editar SteelDek #1')
  const steel = await contrato(1)
  const steelRegra = await regraPorId(steel.financial_rule_id)
  ok(!faturaPelaAgenda(steel), `editável (tipo ${steel.billing_type})`)
  const dd = divergenciasDaRegra(steel, steelRegra)
  ok(dd.imposto === 'sem imposto' && dd.billing_type === 'por hora', `avisos: ${JSON.stringify(dd)}`)
  // Comparado com o calcContrato ANTERIOR a esta mudança (extraído do git), não com uma
  // fatura gravada: as faturas do SteelDek foram geradas com a NF digitada na tela
  // (1.762,12), e o % derivado dela muda o centavo.
  writeFileSync('api/_old-invoices.js', execSync('git show b012e50:api/invoices.js', { encoding: 'utf8' }))
  try {
    const { calcContrato: calcContratoAntigo } = await import('../api/_old-invoices.js')
    for (const opts of [{}, { tax_client_percent_used: '9.2', tax_percentage_used: '7' }, { tax_client_percent_used: String((1762.12 - 1600) / 1762.12 * 100) }]) {
      const n = calcContrato(steel, opts)
      ok(JSON.stringify(n) === JSON.stringify(calcContratoAntigo(steel, opts)),
        `prévia idêntica à anterior ${JSON.stringify(opts)}: NF ${n.invoice_value} · imposto ${n.tax_amount} · Victor ${n.victor_total} · Fab ${n.fabricio_total}`)
    }
  } finally { unlinkSync('api/_old-invoices.js') }

  console.log('\n🧪 e) Prévia Romaneli (agenda, OS #112)')
  const pr = await chamar(invoicesHandler, { query: { action: 'preview' }, body: { company_id: 1, contract_id: 15, month: 10, year: 2026, time_entry_ids: [112] } })
  const b = pr.body?.breakdown
  ok(pr.code === 200 && b.invoice_value === 1651.98 && b.contract_value === 1500 && b.victor_tax_diff === 151.98 && b.victor_total === 1651.98 && b.fabricio_total === 0,
    `${pr.code}: NF ${b?.invoice_value} · líquido ${b?.contract_value} · dif ${b?.victor_tax_diff} · Victor ${b?.victor_total} · Fab ${b?.fabricio_total}`)

  console.log('\n🧪 f) Fatura modo Contrato para Pharmalog #2 (hora)')
  const antes = (await sql`SELECT count(*)::int n FROM invoices`)[0].n
  const post = await chamar(invoicesHandler, { body: { company_id: 1, client_id: 7, contract_id: 2, month: 1, year: 2020, billing_type: 'contract' } })
  ok(post.code === 400 && post.body?.error === 'Contrato por hora/diária deve ser faturado pela Agenda', `POST → ${post.code} "${post.body?.error}"`)
  const [pend] = await sql`SELECT id FROM invoices WHERE status = 'pendente' AND billing_type = 'contract' ORDER BY id LIMIT 1`
  const put = await chamar(invoicesHandler, { method: 'PUT', body: { id: pend.id, contract_id: 2, billing_type: 'contract' } })
  ok(put.code === 400, `PUT (fatura #${pend.id} → contrato #2) → ${put.code} "${put.body?.error}"`)
  ok((await sql`SELECT count(*)::int n FROM invoices`)[0].n === antes, 'nenhuma fatura gravada')

  console.log('\n🧪 g) Modo Contrato do /billing (mesmo filtro da tela)')
  const ativos = await sql`SELECT c.id, c.name, c.billing_type, cl.name AS cliente FROM contracts c JOIN clients cl ON cl.id = c.client_id WHERE c.is_active`
  const listados = ativos.filter(c => !faturaPelaAgenda(c))
  console.log(`     listados: ${listados.map(c => `#${c.id} ${c.name}`).join(', ')}`)
  ok(!listados.some(c => c.id === 2 || c.id === 15), 'Pharmalog #2 e Romaneli #15 fora da lista')
} catch (e) {
  console.error('💥', e)
  falhas++
}

console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ tudo certo')
process.exit(falhas ? 1 : 0)
