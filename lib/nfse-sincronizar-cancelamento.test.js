// Roda com: node lib/nfse-sincronizar-cancelamento.test.js
//
// ⚠️ Fora de api/: tudo que a Vercel encontra ali vira função publicada.
//
// ⚠️ Bate no Neon de PRODUÇÃO, como os outros testes de NFS-e. A emissão de
// teste é criada aqui e apagada no final — nenhuma linha preexistente é tocada.
import 'dotenv/config'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-16-chars'
import { neon } from '@neondatabase/serverless'
import { signToken } from './auth.js'
import { EVENTOS } from './nfse-events.js'
import sincronizar from '../api/nfse-sincronizar-cancelamento.js'

let falhas = 0
const ok = (cond, msg) => {
  console.log(`  ${cond ? '✅' : '❌'} ${msg}`)
  if (!cond) falhas++
  return cond
}

const sql = neon(process.env.DATABASE_URL)
const TOKEN = signToken({ sub: 'teste', username: 'teste' })

// Resposta fake no formato que o handler usa (res.status().json()).
const chamar = async (body) => {
  let status = 200
  let payload = null
  const res = {
    status(c) { status = c; return this },
    json(p) { payload = p; return this },
  }
  await sincronizar(
    { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body, query: {} },
    res
  )
  return { status, payload }
}

// Uma fatura SEM emissão ativa para pendurar a de teste — a própria constraint
// que este endpoint destrava (idx_nfse_emissions_invoice_unica) recusaria o
// INSERT numa fatura que já tem nota válida. A fatura não é alterada.
const [inv] = await sql`
  SELECT i.id, i.company_id FROM invoices i
  WHERE NOT EXISTS (
    SELECT 1 FROM nfse_emissions ne
    WHERE ne.invoice_id = i.id AND ne.cancelled_at IS NULL
      AND ne.status NOT IN ('erro', 'substituida')
  )
  ORDER BY i.id DESC LIMIT 1`
if (!inv) {
  console.error('Sem fatura livre no banco — o teste não tem onde se apoiar.')
  process.exit(1)
}

const criados = []
const criarEmissao = async (status) => {
  const [linha] = await sql`
    INSERT INTO nfse_emissions
      (company_id, invoice_id, status, ambiente, nfse_number, chave_acesso,
       valor_servico, submitted_at)
    VALUES (${inv.company_id}, ${inv.id}, ${status}, 2, NULL,
            ${'9'.repeat(50)}, 1.00, NOW())
    RETURNING id`
  criados.push(linha.id)
  return linha.id
}

try {
  // -------------------------------------------------------------------------
  console.log('🧪 TESTE 1: sem confirmar: true não muda nada')
  const id1 = await criarEmissao('autorizada')
  const r1 = await chamar({ emission_id: id1 })
  ok(r1.status === 400, `400 sem confirmação (veio ${r1.status})`)
  const [dep1] = await sql`SELECT status, cancelled_at FROM nfse_emissions WHERE id = ${id1}`
  ok(dep1.status === 'autorizada' && dep1.cancelled_at === null,
    'a emissão continua autorizada e sem cancelled_at')

  // -------------------------------------------------------------------------
  console.log('\n🧪 TESTE 2: com confirmação, grava o vocabulário REAL')
  const r2 = await chamar({ emission_id: id1, confirmar: true, motivo: 'teste automatizado' })
  ok(r2.status === 200 && r2.payload?.success === true, '200 com success')
  const [dep2] = await sql`
    SELECT status, cancelled_at, json_response FROM nfse_emissions WHERE id = ${id1}`
  // ⚠️ 'cancelada', não 'cancelled': status fora do vocabulário some dos
  // badges da tela e do CANCELAVEIS/ACIONAVEIS, sem erro nenhum.
  ok(dep2.status === 'cancelada', `status = 'cancelada' (veio '${dep2.status}')`)
  ok(dep2.cancelled_at !== null, 'cancelled_at preenchido — é ele que libera a fatura')
  ok(dep2.json_response?.sincronizacao_cancelamento?.status_anterior === 'autorizada',
    'json_response guarda o status anterior')

  const eventos = await sql`
    SELECT event_type, origem, event_data FROM nfse_events WHERE nfse_emission_id = ${id1}`
  const ev = eventos.find((e) => e.event_type === EVENTOS.CANCELAMENTO_SINCRONIZADO)
  ok(Boolean(ev), 'evento nfse.cancelamento_sincronizado registrado')
  ok(ev?.origem === 'manual', "origem = 'manual' (não foi o fisco que nos contou)")
  ok(eventos.every((e) => e.event_type !== EVENTOS.CANCELADA),
    'NÃO grava nfse.cancelada — nós não cancelamos a nota')

  // -------------------------------------------------------------------------
  console.log('\n🧪 TESTE 3: a fatura fica livre para a nova emissão')
  // O índice parcial idx_nfse_emissions_invoice_unica é o que trava a
  // re-emissão; se ele ainda vir esta linha como ativa, o INSERT abaixo falha.
  const [livre] = await sql`
    SELECT COUNT(*)::int AS ativas FROM nfse_emissions
    WHERE invoice_id = ${inv.id} AND cancelled_at IS NULL
      AND status NOT IN ('erro', 'substituida')`
  ok(livre.ativas === 0, `nenhuma emissão ativa sobrou na fatura (veio ${livre.ativas})`)

  // -------------------------------------------------------------------------
  console.log('\n🧪 TESTE 4: repetir é inofensivo (a re-emissão pode ser retentada)')
  const r4 = await chamar({ emission_id: id1, confirmar: true })
  ok(r4.status === 200 && r4.payload?.ja_cancelada === true,
    `200 com ja_cancelada (veio ${r4.status})`)
  const depois = await sql`
    SELECT COUNT(*)::int AS n FROM nfse_events
    WHERE nfse_emission_id = ${id1} AND event_type = ${EVENTOS.CANCELAMENTO_SINCRONIZADO}`
  ok(depois[0].n === 1, `um único evento, não dois (veio ${depois[0].n})`)

  // -------------------------------------------------------------------------
  console.log("\n🧪 TESTE 5: 'erro' e 'substituida' não têm cancelamento a sincronizar")
  const id5 = await criarEmissao('erro')
  const r5 = await chamar({ emission_id: id5, confirmar: true })
  ok(r5.status === 422, `422 para status 'erro' (veio ${r5.status})`)
  const [dep5] = await sql`SELECT cancelled_at FROM nfse_emissions WHERE id = ${id5}`
  ok(dep5.cancelled_at === null, 'não inventa um cancelamento que não houve')

  // -------------------------------------------------------------------------
  console.log('\n🧪 TESTE 6: emissão inexistente')
  const r6 = await chamar({ emission_id: 999999999, confirmar: true })
  ok(r6.status === 404, `404 (veio ${r6.status})`)
  const r7 = await chamar({ confirmar: true })
  ok(r7.status === 400, `400 sem emission_id (veio ${r7.status})`)
} finally {
  // ⚠️ Só o que ESTE teste criou. Os eventos vão junto pelo ON DELETE CASCADE.
  //
  // ⚠️ As operações vão ANTES, e à mão: `nfse_operations.nfse_emission_id` é
  // ON DELETE SET NULL — apagar a emissão primeiro deixaria a linha da trilha
  // viva, sem vínculo e indistinguível de dado real. O SET NULL está certo em
  // produção (a trilha do que foi transmitido ao fisco não pode sumir junto
  // com a emissão), mas obriga o teste a limpar na ordem inversa.
  if (criados.length) {
    await sql`DELETE FROM nfse_operations WHERE nfse_emission_id = ANY(${criados}::bigint[])`
    await sql`DELETE FROM nfse_emissions WHERE id = ANY(${criados}::int[])`
    console.log(`\n🧹 removidas as emissões de teste: ${criados.join(', ')}`)
  }
}

console.log(falhas === 0 ? '\n✅ Tudo passou' : `\n❌ ${falhas} falha(s)`)
process.exit(falhas === 0 ? 0 : 1)
