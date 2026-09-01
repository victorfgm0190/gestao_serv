// Roda com: node lib/nfse-download-oficial.test.js
//
// O TESTE 4 e o TESTE 5 falam com o portal nacional DE VERDADE (GET, somente
// leitura, com o certificado da empresa). Se o serviço estiver fora, o caso é
// PULADO em vez de reprovado.
//
// ⚠️ Roda contra o banco de PRODUÇÃO e só desfaz o que ele mesmo criou: a
// linha de `nfse_operations` da consulta e o `updated_at` que o backfill
// encosta. Nenhum dado real é apagado.
import 'dotenv/config'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-16-chars'
import { neon } from '@neondatabase/serverless'
import { signToken } from './auth.js'
import { resolverEmissao } from './nfse-resolve.js'
import baixarXmlOficial from '../api/nfse-download-xml-oficial.js'
import baixarPdfOficial from '../api/nfse-download-pdf-oficial.js'
import baixarOficial from '../api/nfse-download-oficial.js'

let falhas = 0
const ok = (cond, msg) => {
  console.log(`  ${cond ? '✅' : '❌'} ${msg}`)
  if (!cond) falhas++
  return cond
}

const sql = neon(process.env.DATABASE_URL)
const token = signToken({ sub: '1', username: 'teste', master: true })

const chamar = async (handler, entrada, { auth = true, method = 'GET' } = {}) => {
  const res = {
    code: 0, body: null, buffer: null, headers: {},
    status(c) { this.code = c; return this },
    json(b) { this.body = b; return this },
    send(b) { this.buffer = b; return this },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this },
  }
  const req = {
    method,
    query: method === 'GET' ? entrada : {},
    body: method === 'POST' ? entrada : undefined,
    headers: auth ? { authorization: `Bearer ${token}` } : {},
  }
  await handler(req, res)
  return res
}

// A nota vigente da fatura 38 (número 28, autorizada, produção). As outras
// duas emissões da mesma fatura (57 e 80) estão canceladas — é justamente o
// caso que o resolvedor por invoice_id precisa desempatar.
const ALVO = 100

// ---------------------------------------------------------------------------
console.log('🧪 TESTE 1: guardas dos endpoints')
for (const [nome, h] of [['xml-oficial', baixarXmlOficial], ['pdf-oficial', baixarPdfOficial]]) {
  ok((await chamar(h, { emission_id: ALVO }, { auth: false })).code === 401, `${nome} sem token → 401`)
  ok((await chamar(h, { emission_id: ALVO }, { method: 'DELETE' })).code === 405, `${nome} DELETE → 405`)
  ok((await chamar(h, {})).code === 400, `${nome} sem identificador → 400`)
  ok((await chamar(h, { emission_id: 999999 })).code === 404, `${nome} emissão inexistente → 404`)
  ok((await chamar(h, { nfse_number: 'abc' })).code === 400, `${nome} nfse_number inválido → 400`)
  ok((await chamar(h, { invoice_id: 999999 })).code === 404, `${nome} fatura sem NFS-e → 404`)
}

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 2: resolvedor — os quatro identificadores apontam a mesma nota')
const alvo = (await sql`SELECT id, invoice_id, nfse_number FROM nfse_emissions WHERE id = ${ALVO}`)[0]
if (!alvo) {
  console.log('  ⏭️  emissão de referência ausente — testes de resolução pulados')
} else {
  const porId = await resolverEmissao(sql, { emission_id: alvo.id })
  const porNfseId = await resolverEmissao(sql, { nfse_id: alvo.id })
  const porNumero = await resolverEmissao(sql, { nfse_number: alvo.nfse_number })
  const porFatura = await resolverEmissao(sql, { invoice_id: alvo.invoice_id })

  ok(porId.emissao?.id === alvo.id, `emission_id=${alvo.id} → #${porId.emissao?.id}`)
  ok(porNfseId.emissao?.id === alvo.id, `nfse_id é sinônimo de emission_id → #${porNfseId.emissao?.id}`)
  ok(porNumero.emissao?.id === alvo.id, `nfse_number=${alvo.nfse_number} → #${porNumero.emissao?.id}`)
  // A fatura 38 tem TRÊS emissões (26 e 27 canceladas, 28 vigente): resolver
  // pela fatura precisa escolher a vigente, não a mais recente por acaso.
  const irmas = await sql`SELECT id, cancelled_at FROM nfse_emissions WHERE invoice_id = ${alvo.invoice_id}`
  ok(porFatura.emissao?.id === alvo.id,
    `invoice_id=${alvo.invoice_id} (${irmas.length} emissões, ${irmas.filter((i) => i.cancelled_at).length} canceladas) → a vigente #${porFatura.emissao?.id}`)

  // Cancelada pedida pelo id: entrega, porque o cancelamento não apaga o
  // documento — mas a linha traz a marca.
  const cancelada = (await sql`SELECT id FROM nfse_emissions WHERE cancelled_at IS NOT NULL LIMIT 1`)[0]
  if (cancelada) {
    const r = await resolverEmissao(sql, { emission_id: cancelada.id })
    ok(Boolean(r.emissao?.cancelled_at), `emissão cancelada #${cancelada.id} resolve e vem marcada`)
  }
}

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 3: XML oficial guardado — entrega sem incomodar o portal')
const r3 = await chamar(baixarXmlOficial, { emission_id: ALVO })
ok(r3.code === 200, `GET emission_id=${ALVO} → 200`)
ok(r3.headers['x-nfse-origem'] === 'local', `origem = local (recebe ${r3.headers['x-nfse-origem']})`)
ok(r3.headers['x-nfse-tipo'] === 'oficial', 'tipo = oficial')
ok(String(r3.buffer || '').includes('<nNFSe>'), 'o corpo é a NFS-e (tem <nNFSe>), não a DPS')
ok(!String(r3.buffer || '').startsWith('<DPS'), 'o corpo NÃO é a DPS')
const cd3 = r3.headers['content-disposition'] || ''
ok(cd3.includes(`_${alvo?.nfse_number}_`), `o nome do arquivo leva o número da nota: ${cd3}`)
ok(cd3.includes('.xml"'), 'extensão .xml')

// O mesmo por POST, que é a forma da especificação.
const r3b = await chamar(baixarXmlOficial, { nfse_id: ALVO }, { method: 'POST' })
ok(r3b.code === 200 && String(r3b.buffer) === String(r3.buffer), 'POST { nfse_id } devolve o mesmo arquivo')

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 4: forcar_portal — busca no Portal Nacional')
const antes = (await sql`SELECT updated_at, xml_nfse FROM nfse_emissions WHERE id = ${ALVO}`)[0]
const opsAntes = (await sql`SELECT COALESCE(MAX(id), 0) AS m FROM nfse_operations`)[0].m

const r4 = await chamar(baixarXmlOficial, { emission_id: ALVO, forcar_portal: true }, { method: 'POST' })
if (r4.code === 502 || r4.code === 504) {
  console.log(`  ⏭️  portal indisponível (${r4.code}: ${r4.body?.error}) — caso pulado`)
} else {
  ok(r4.code === 200, `forcar_portal → 200 (recebe ${r4.code}: ${r4.body?.error ?? ''})`)
  ok(r4.headers['x-nfse-origem'] === 'portal', `origem = portal (recebe ${r4.headers['x-nfse-origem']})`)
  // A prova de que o guardado É o oficial: o portal devolve o mesmo arquivo.
  ok(String(r4.buffer) === String(antes.xml_nfse),
    `o XML do portal é idêntico ao guardado (${String(r4.buffer).length} caracteres)`)
  const op = (await sql`
    SELECT operation_type, status, http_status FROM nfse_operations
    WHERE id > ${opsAntes} AND nfse_emission_id = ${ALVO} ORDER BY id DESC LIMIT 1`)[0]
  ok(op?.operation_type === 'consult' && op?.status === 'sucesso',
    `a consulta ficou na trilha (${op?.operation_type}/${op?.status}/HTTP ${op?.http_status})`)
}

// Desfaz só o que este teste criou.
await sql`DELETE FROM nfse_operations WHERE id > ${opsAntes} AND nfse_emission_id = ${ALVO} AND operation_type = 'consult'`
await sql`UPDATE nfse_emissions SET updated_at = ${antes.updated_at} WHERE id = ${ALVO}`
const depois = (await sql`SELECT updated_at, xml_nfse FROM nfse_emissions WHERE id = ${ALVO}`)[0]
ok(depois.xml_nfse === antes.xml_nfse && String(depois.updated_at) === String(antes.updated_at),
  'a emissão voltou exatamente ao estado anterior')

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 5: PDF oficial — o portal ainda não implementa o DANFSE')
const r5 = await chamar(baixarPdfOficial, { emission_id: ALVO })
if (r5.code === 200) {
  ok(r5.buffer?.slice(0, 5).toString() === '%PDF-',
    '🎉 o portal PASSOU a servir o DANFSE — e o que veio é PDF de verdade')
} else {
  ok(r5.code === 503, `→ 503 (recebe ${r5.code})`)
  ok([501, 404].includes(r5.body?.http_status), `o portal respondeu ${r5.body?.http_status}`)
  ok(String(r5.body?.rota_alternativa || '').includes('nfse-download-danfse'),
    `a resposta aponta a alternativa: ${r5.body?.rota_alternativa}`)
}

// O alias tem de responder igual — é o mesmo handler.
const r5b = await chamar(baixarOficial, { nfse_id: ALVO }, { method: 'POST' })
ok(r5b.code === r5.code, `/api/nfse-download-oficial responde igual ao pdf-oficial (${r5b.code})`)

// ---------------------------------------------------------------------------
console.log(`\n${falhas === 0 ? '✅ tudo certo' : `❌ ${falhas} falha(s)`}`)
process.exit(falhas === 0 ? 0 : 1)
