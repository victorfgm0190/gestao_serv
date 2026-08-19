// Roda com: node lib/nfse-operations.test.js
//
// ⚠️ Fora de api/: tudo que a Vercel encontra ali vira função publicada.
//
// ⚠️ Bate no Neon de PRODUÇÃO, como os outros testes de NFS-e. As operações de
// teste são criadas aqui e apagadas no final — nenhuma linha preexistente é
// tocada (inclusive as 3 vindas do backfill).
import 'dotenv/config'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-16-chars'
import { neon } from '@neondatabase/serverless'
import { signToken } from './auth.js'
import {
  abrirOperacao, fecharOperacao, registrarOperacaoLocal,
  codigoDoErro, OPERACOES, STATUS_OPERACAO,
} from './nfse-operations.js'
import listar from '../api/nfse-operations.js'

let falhas = 0
const ok = (cond, msg) => {
  console.log(`  ${cond ? '✅' : '❌'} ${msg}`)
  if (!cond) falhas++
  return cond
}

const sql = neon(process.env.DATABASE_URL)
const TOKEN = signToken({ sub: 'teste', username: 'teste' })

const chamar = async (query) => {
  let status = 200
  let payload = null
  let corpo = null
  const cabecalhos = {}
  const res = {
    status(c) { status = c; return this },
    json(p) { payload = p; return this },
    send(b) { corpo = b; return this },
    setHeader(k, v) { cabecalhos[k] = v },
  }
  await listar({ method: 'GET', headers: { authorization: `Bearer ${TOKEN}` }, query }, res)
  return { status, payload, corpo, cabecalhos }
}

const [inv] = await sql`SELECT id, company_id FROM invoices ORDER BY id DESC LIMIT 1`
const XML_DPS = `<?xml version="1.0"?><DPS>${'x'.repeat(3000)}</DPS>`
const XML_NFSE = `<?xml version="1.0"?><NFSe><nNFSe>999</nNFSe></NFSe>`
const criados = []

try {
  // -------------------------------------------------------------------------
  console.log('🧪 TESTE 1: codigoDoErro lê os campos com inicial MAIÚSCULA')
  ok(codigoDoErro({ erros: [{ Codigo: 'E0063', Descricao: 'x' }] }) === 'E0063',
    'lê Codigo (maiúsculo), como vem do SEFIN')
  ok(codigoDoErro({ erros: [{ codigo: 'E1235' }] }) === 'E1235', 'aceita codigo minúsculo')
  ok(codigoDoErro({ mensagem: 'x' }) === null, 'sem erros[] devolve null, não undefined')

  // -------------------------------------------------------------------------
  console.log('\n🧪 TESTE 2: abrir deixa a operação em "enviado" — sem emissão ainda')
  const opId = await abrirOperacao(sql, {
    company_id: inv.company_id, invoice_id: inv.id,
    operation_type: OPERACOES.EMISSAO, xml_enviado: XML_DPS,
    ambiente: 2, dps_number: 4242,
  })
  criados.push(opId)
  ok(Number.isInteger(Number(opId)), `abrirOperacao devolveu id (${opId})`)
  const [a1] = await sql`SELECT * FROM nfse_operations WHERE id = ${opId}`
  ok(a1.status === STATUS_OPERACAO.ENVIADO, "status = 'enviado'")
  // ⚠️ É este NULO que o esboço não previa: o UPDATE dele buscava por
  // nfse_emission_id, coluna que ainda não tem valor nenhum.
  ok(a1.nfse_emission_id === null, 'nfse_emission_id ainda NULO — a emissão não existe')
  ok(a1.enviado_em !== null && a1.respondido_em === null, 'enviado_em gravado, respondido_em vazio')
  ok(a1.xml_enviado === XML_DPS, 'XML enviado guardado inteiro')

  // -------------------------------------------------------------------------
  console.log('\n🧪 TESTE 3: fechar com sucesso separa XML de JSON')
  await fecharOperacao(sql, opId,
    { ok: true, status: 200, nfseXml: XML_NFSE, resposta: { nsu: '7', chaveAcesso: 'abc' } },
    { nfse_emission_id: null })
  const [a2] = await sql`SELECT * FROM nfse_operations WHERE id = ${opId}`
  ok(a2.status === STATUS_OPERACAO.SUCESSO, "status = 'sucesso'")
  // ⚠️ O esboço gravava JSON.stringify(resposta) na coluna de XML — e a tela
  // então fazia JSON.parse num XML, que lança.
  ok(a2.xml_resposta === XML_NFSE, 'xml_resposta é o XML da nota, não o JSON')
  ok(a2.json_resposta?.nsu === '7', 'json_resposta guarda o corpo da resposta')
  ok(a2.respondido_em !== null, 'respondido_em preenchido')
  ok(a2.dps_number === 4242, 'dps_number da abertura preservado (COALESCE)')

  // -------------------------------------------------------------------------
  console.log('\n🧪 TESTE 4: fechar com erro guarda mensagem e código')
  const opErro = await abrirOperacao(sql, {
    company_id: inv.company_id, invoice_id: inv.id,
    operation_type: OPERACOES.SUBSTITUICAO, xml_enviado: XML_DPS, ambiente: 2,
  })
  criados.push(opErro)
  await fecharOperacao(sql, opErro, {
    ok: false, status: 400, erro: '[E0063] Valor não pode ser alterado',
    resposta: { erros: [{ Codigo: 'E0063', Descricao: 'Valor não pode ser alterado' }] },
  })
  const [a3] = await sql`SELECT * FROM nfse_operations WHERE id = ${opErro}`
  ok(a3.status === STATUS_OPERACAO.ERRO, "status = 'erro'")
  ok(a3.erro_codigo === 'E0063', `erro_codigo extraído (${a3.erro_codigo})`)
  ok(a3.http_status === 400, 'http_status guardado')
  ok(a3.xml_resposta === null, 'recusa não tem XML de resposta — e não inventa um')

  // -------------------------------------------------------------------------
  console.log('\n🧪 TESTE 5: operação local (sync) entra completa numa linha')
  const opSync = await registrarOperacaoLocal(sql, {
    company_id: inv.company_id, invoice_id: inv.id,
    operation_type: OPERACOES.SINCRONIZACAO, ambiente: 2,
    json_resposta: { motivo: 'teste' },
  })
  criados.push(opSync)
  const [a4] = await sql`SELECT * FROM nfse_operations WHERE id = ${opSync}`
  ok(a4.status === STATUS_OPERACAO.SUCESSO && a4.enviado_em && a4.respondido_em,
    'sucesso com os dois instantes')
  ok(a4.xml_enviado === null, 'sem XML — nada foi transmitido')

  // -------------------------------------------------------------------------
  console.log('\n🧪 TESTE 6: a lista devolve PRÉVIA, não o XML inteiro')
  const r6 = await chamar({ company_id: String(inv.company_id), limit: '100' })
  ok(r6.status === 200, `200 (veio ${r6.status})`)
  const minha = r6.payload.operations.find((o) => o.id === Number(opId))
  ok(Boolean(minha), 'a operação de teste está na lista')
  ok(minha.xmlEnviado.previa.length < XML_DPS.length,
    `prévia recortada (${minha.xmlEnviado.previa.length} de ${XML_DPS.length})`)
  ok(minha.xmlEnviado.tamanho === XML_DPS.length, 'tamanho real informado')
  ok(minha.xmlEnviado.truncado === true, 'marcado como truncado')
  ok(minha.xmlResposta.truncado === false, 'resposta curta NÃO é marcada como truncada')
  ok(minha.rotulo === 'Emissão', `rótulo resolvido no servidor (${minha.rotulo})`)
  ok(typeof minha.id === 'number', 'id vem como número, não string de bigint')

  // -------------------------------------------------------------------------
  console.log('\n🧪 TESTE 7: filtros e recorte por empresa')
  const r7 = await chamar({ company_id: String(inv.company_id), tipo: 'substitute', limit: '100' })
  ok(r7.payload.operations.every((o) => o.tipo === 'substitute'), 'filtro por tipo')
  const r7b = await chamar({ company_id: String(inv.company_id), status: 'erro', limit: '100' })
  ok(r7b.payload.operations.every((o) => o.status === 'erro'), 'filtro por status')
  const r7c = await chamar({ company_id: String(inv.company_id), invoice_id: '-1' })
  ok(r7c.payload.operations.length === 0, 'filtro por fatura inexistente devolve vazio')
  const outra = inv.company_id === 1 ? 2 : 1
  const r7d = await chamar({ company_id: String(outra), limit: '100' })
  ok(r7d.payload.operations.every((o) => o.id !== Number(opId)),
    'a operação não vaza para a outra empresa')
  const r7e = await chamar({})
  ok(r7e.status === 400, `400 sem company_id — sem WHERE 1=1 (veio ${r7e.status})`)

  // -------------------------------------------------------------------------
  console.log('\n🧪 TESTE 8: download devolve o XML INTEIRO como arquivo')
  const r8 = await chamar({ id: String(opId), parte: 'enviado' })
  ok(r8.status === 200 && r8.corpo === XML_DPS, 'XML enviado completo, byte a byte')
  ok(/application\/xml/.test(r8.cabecalhos['Content-Type'] || ''), 'Content-Type de XML')
  ok(/attachment; filename=/.test(r8.cabecalhos['Content-Disposition'] || ''), 'baixa como arquivo')
  const r8b = await chamar({ id: String(opSync), parte: 'enviado' })
  ok(r8b.status === 404 && Boolean(r8b.payload?.detalhe),
    '404 COM motivo quando a operação não transmite documento')
  const r8c = await chamar({ id: String(opId), parte: 'outra' })
  ok(r8c.status === 400, `400 para parte inválida (veio ${r8c.status})`)
} finally {
  const ids = criados.filter(Boolean)
  if (ids.length) {
    await sql`DELETE FROM nfse_operations WHERE id = ANY(${ids}::bigint[])`
    console.log(`\n🧹 removidas as operações de teste: ${ids.join(', ')}`)
  }
}

console.log(falhas === 0 ? '\n✅ Tudo passou' : `\n❌ ${falhas} falha(s)`)
process.exit(falhas === 0 ? 0 : 1)
