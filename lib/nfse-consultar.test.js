// Roda com: node lib/nfse-consultar.test.js
//
// O TESTE 4 consulta o portal nacional de verdade (GET, somente leitura, com o
// certificado da empresa). Se o serviço estiver fora, o caso é PULADO.
import 'dotenv/config'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-16-chars'
import { neon } from '@neondatabase/serverless'
import { signToken } from './auth.js'
import consultar from '../api/nfse-consultar.js'
import baixarXml from '../api/nfse-download-xml.js'
import listar from '../api/nfse-list.js'

let falhas = 0
const ok = (cond, msg) => {
  console.log(`  ${cond ? '✅' : '❌'} ${msg}`)
  if (!cond) falhas++
  return cond
}

const sql = neon(process.env.DATABASE_URL)
const token = signToken({ sub: '1', username: 'teste', master: true })
const chamar = async (handler, query, { auth = true, method = 'GET' } = {}) => {
  const res = {
    code: 0, body: null, buffer: null, headers: {},
    status(c) { this.code = c; return this },
    json(b) { this.body = b; return this },
    send(b) { this.buffer = b; return this },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this },
  }
  await handler({ method, query, headers: auth ? { authorization: `Bearer ${token}` } : {} }, res)
  return res
}

// ---------------------------------------------------------------------------
console.log('🧪 TESTE 1: guardas dos endpoints')
ok((await chamar(consultar, { emission_id: 1 }, { auth: false })).code === 401, 'consultar sem token → 401')
ok((await chamar(consultar, {})).code === 400, 'consultar sem emission_id → 400')
ok((await chamar(consultar, { emission_id: 1 }, { method: 'POST' })).code === 405, 'POST → 405')
ok((await chamar(consultar, { emission_id: 999999 })).code === 404, 'emissão inexistente → 404')
ok((await chamar(baixarXml, { emission_id: 999999 })).code === 404, 'download de inexistente → 404')

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 2: download entrega a NOTA, não o pedido')
const [em] = await sql`
  SELECT id, nfse_number, chave_acesso, status,
         (xml_nfse IS NOT NULL) AS tem_oficial, (xml_assinado IS NOT NULL) AS tem_dps
  FROM nfse_emissions WHERE xml_nfse IS NOT NULL ORDER BY id DESC LIMIT 1`

if (!em) {
  console.log('  ⏭️  PULADO: nenhuma emissão com XML oficial guardado')
} else {
  const oficial = await chamar(baixarXml, { emission_id: em.id })
  ok(oficial.code === 200, 'download padrão → 200')
  ok(oficial.headers['x-nfse-tipo'] === 'oficial', 'entrega o XML OFICIAL por padrão')
  // ⚠️ A DPS não tem número de nota nem <emit>; entregá-la como "o XML da
  // nota" dá ao cliente um documento que não é a nota dele.
  ok(/<NFSe\b/.test(oficial.buffer) && /<nNFSe>/.test(oficial.buffer),
    'o conteúdo é a NFS-e autorizada (tem <NFSe> e <nNFSe>)')
  ok(oficial.headers['content-disposition'].includes(String(em.nfse_number)),
    `nome do arquivo traz o número da nota: ${oficial.headers['content-disposition']}`)
  // ⚠️ `chave.substring(0,8)` seria igual em TODAS as notas do mesmo emitente
  // (município + tipo de inscrição), então todos os downloads teriam o mesmo nome.
  ok(!/NFSe_\d{8}_oficial/.test(oficial.headers['content-disposition']),
    'não usa os 8 primeiros dígitos da chave, que são iguais em toda nota')

  const dps = await chamar(baixarXml, { emission_id: em.id, tipo: 'dps' })
  ok(dps.code === 200 && dps.headers['x-nfse-tipo'] === 'dps', 'tipo=dps entrega a DPS')
  ok(/<DPS\b/.test(dps.buffer) && !/<nNFSe>/.test(dps.buffer), 'a DPS não tem número de nota')
  ok(dps.buffer !== oficial.buffer, 'são documentos diferentes')

  // ---------------------------------------------------------------------------
  console.log('\n🧪 TESTE 3: disponibilidade é dado NOSSO, não do portal')
  const c = await chamar(consultar, { emission_id: em.id })
  ok(c.code === 200 && c.body.disponivel === true, 'disponível')
  // ⚠️ Com o XML já guardado, a rota NÃO vai ao governo. Uma tela que consulta
  // de 30 em 30 segundos, por linha, faria dezenas de chamadas por minuto — por
  // aba aberta — para responder o que já está no banco.
  ok(c.body.origem === 'local', 'responde do banco, sem consultar o portal')

  const lista = await chamar(listar, { company_id: 1 })
  const linha = lista.body.emissions.find((x) => x.id === em.id)
  ok(linha?.temOficial === true, 'a lista já informa que o oficial existe')
  ok(linha?.chaveAcesso === em.chave_acesso, 'e devolve a chave de acesso')
}

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 4: consulta real ao portal (leitura), com backfill')
if (!em?.chave_acesso) {
  console.log('  ⏭️  PULADO: nenhuma emissão com chave de acesso')
} else {
  const guardado = (await sql`SELECT xml_nfse FROM nfse_emissions WHERE id = ${em.id}`)[0].xml_nfse
  try {
    // Simula o cenário real: a emissão existe, mas o XML oficial não foi guardado.
    await sql`UPDATE nfse_emissions SET xml_nfse = NULL WHERE id = ${em.id}`

    const semOficial = await chamar(baixarXml, { emission_id: em.id })
    ok(semOficial.code === 404 && /oficial ainda não disponível/i.test(semOficial.body.error),
      'sem o oficial, o download explica em vez de entregar a DPS disfarçada')
    ok(semOficial.body.tem_dps === true, 'e avisa que a DPS existe')

    const r = await chamar(consultar, { emission_id: em.id })
    if (r.code !== 200) {
      console.log(`  ⏭️  PULADO: portal indisponível (${r.code} — ${r.body?.error})`)
    } else {
      ok(r.body.origem === 'portal', 'foi ao portal quando o XML faltava')
      ok(r.body.disponivel === true, `disponível — nota ${r.body.nfse_number}`)
      const dep = (await sql`SELECT xml_nfse FROM nfse_emissions WHERE id = ${em.id}`)[0]
      ok(dep.xml_nfse !== null, 'o XML oficial foi GUARDADO (backfill)')
      ok(dep.xml_nfse === guardado, 'e é byte a byte o mesmo que já tínhamos')

      const denovo = await chamar(consultar, { emission_id: em.id })
      ok(denovo.body.origem === 'local', 'a consulta seguinte já não sai daqui')
    }
  } finally {
    await sql`UPDATE nfse_emissions SET xml_nfse = ${guardado} WHERE id = ${em.id}`
    const fim = (await sql`SELECT xml_nfse FROM nfse_emissions WHERE id = ${em.id}`)[0]
    ok(fim.xml_nfse === guardado, 'banco restaurado ao estado original')
  }
}

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 5: emissão sem chave não vira consulta ao portal')
const [semChave] = await sql`
  SELECT id FROM nfse_emissions WHERE chave_acesso IS NULL ORDER BY id DESC LIMIT 1`
if (!semChave) {
  console.log('  ⏭️  PULADO: não há emissão sem chave')
} else {
  const r = await chamar(consultar, { emission_id: semChave.id })
  ok(r.code === 422 && r.body.disponivel === false,
    'sem chave → 422 dizendo o motivo, sem bater no governo')
}

if (falhas > 0) {
  console.error(`\n❌ ${falhas} VERIFICAÇÃO(ÕES) FALHARAM!`)
  process.exit(1)
}
console.log('\n✅ TODOS OS TESTES PASSARAM!')
