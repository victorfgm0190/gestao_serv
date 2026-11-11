// Lote de agendas (POST /api/time-entries?action=batch) contra a produção, pelo handler real.
// Rodar: node lib/lote-agendas.test.js — limpa SÓ os ids que ele mesmo criou.
import 'dotenv/config'
import { neon } from '@neondatabase/serverless'
import { signToken } from './auth.js'
import handler from '../api/time-entries.js'

const sql = neon(process.env.DATABASE_URL)
const token = signToken({ username: 'teste-lote' })
const criados = []

async function chamar(method, body, query = {}) {
  let status = 0, json = null
  const res = { status(s) { status = s; return this }, json(j) { json = j; return this } }
  await handler({ method, body, query, headers: { authorization: `Bearer ${token}` } }, res)
  return { status, json }
}
const contar = async () => Number((await sql`SELECT count(*) n FROM time_entries`)[0].n)
const ok = (c, msg) => { console.log(c ? '  ✓' : '  ✗ FALHOU', msg); if (!c) process.exitCode = 1 }
const item = (d, extra = {}) => ({ client_id: 7, contract_id: 2, entry_date: d, hora_inicial: '09:00', intervalo_inicio: '12:00', intervalo_fim: '13:00', hora_final: '18:00', hours_fuel: '0', despesas_deslocamento: '0', description: '', ...extra })

try {
  console.log('1. lote Pharmalog 16, 17, 18/11')
  const r = await chamar('POST', { company_id: 1, batch: ['2026-11-16', '2026-11-17', '2026-11-18'].map(d => item(d)) }, { action: 'batch' })
  ok(r.status === 201 && r.json.ids?.length === 3, `201 com 3 ids (${r.status} ${JSON.stringify(r.json)})`)
  criados.push(...(r.json.ids || []))
  const rows = await sql`SELECT id, to_char(entry_date,'YYYY-MM-DD') d, hours, description, gross_value, victor_share, fabricio_share, company_id FROM time_entries WHERE id = ANY(${criados}) ORDER BY entry_date`
  console.table(rows)
  ok(rows.every(x => Number(x.hours) === 8 && x.description === null && Number(x.company_id) === 1), 'todas com 8h, sem descrição, Lumen')
  // Mesmo cálculo do individual: cria uma OS individual igual e compara.
  const ind = await chamar('POST', { company_id: 1, ...item('2026-11-17') })
  criados.push(ind.json.entry.id)
  ok(ind.status === 201 && Number(ind.json.entry.gross_value) === Number(rows[1].gross_value) && Number(ind.json.entry.victor_share) === Number(rows[1].victor_share), `individual = lote (bruto ${ind.json.entry.gross_value})`)

  console.log('2. tudo ou nada')
  const antes = await contar()
  const r2 = await chamar('POST', { company_id: 1, batch: [item('2026-11-19'), item('2026-11-20', { contract_id: 18 })] })
  ok(r2.status === 422 && r2.json.errors?.length === 1 && r2.json.errors[0].entry_date === '2026-11-20', `422 com erro na data 20 (${JSON.stringify(r2.json.errors)})`)
  ok(await contar() === antes, 'nada gravado')
  const r3 = await chamar('POST', { company_id: 1, batch: [item('2026-11-19', { contract_id: 16 })] })
  ok(r3.status === 422, `contrato de outro cliente recusado: ${r3.json.errors?.[0]?.error}`)
  const r4 = await chamar('POST', { company_id: 1, batch: Array.from({ length: 32 }, () => item('2026-11-19')) })
  ok(r4.status === 400, `32 itens → 400 (${r4.json.error})`)
  const r5 = await chamar('POST', { company_id: 3, batch: [item('2026-11-19')] })
  ok(r5.status === 400, 'company_id 3 → 400')
  ok(await contar() === antes, 'ainda nada gravado')

  console.log('3. excluir uma OS do lote individualmente')
  const alvo = criados[1]
  const d = await chamar('DELETE', { id: alvo })
  ok(d.status === 200 && (await sql`SELECT 1 FROM time_entries WHERE id = ${alvo}`).length === 0, `OS ${alvo} excluída`)
  ok((await sql`SELECT 1 FROM time_entries WHERE id = ANY(${criados.filter(x => x !== alvo)})`).length === criados.length - 1, 'as outras continuam')
} finally {
  if (criados.length) {
    const apagados = await sql`DELETE FROM time_entries WHERE id = ANY(${criados}) RETURNING id`
    console.log('limpeza: removidos', apagados.map(x => x.id).join(', ') || '(nenhum)')
  }
}
