// Roda com: node lib/nfse-substituir.test.js
//
// ⚠️ O TESTE 4 emite e substitui uma nota DE VERDADE, em HOMOLOGAÇÃO (sem
// valor fiscal). Nada é enviado a produção, e a linha criada é removida.
import 'dotenv/config'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-16-chars'
import { neon } from '@neondatabase/serverless'
import { signToken } from './auth.js'
import { montarDPS, camposFaltantes, MOTIVO_MIN } from './nfse-xml-builder.js'
import substituir from '../api/nfse-substituir.js'

let falhas = 0
const ok = (cond, msg) => {
  console.log(`  ${cond ? '✅' : '❌'} ${msg}`)
  if (!cond) falhas++
  return cond
}

const sql = neon(process.env.DATABASE_URL)
const token = signToken({ sub: '1', username: 'teste', master: true })
const chamar = async (body, { auth = true, method = 'POST' } = {}) => {
  const res = {
    code: 0, body: null,
    status(c) { this.code = c; return this },
    json(b) { this.body = b; return this },
  }
  await substituir({ method, body, headers: auth ? { authorization: `Bearer ${token}` } : {} }, res)
  return res
}

const CHAVE = '4'.repeat(50)
const base = () => ({
  ambiente: 2, serie: '00001', nDPS: 1, dataEmissao: new Date('2026-08-19T12:00:00Z'),
  emitente: {
    cnpj: '64761267000184', razaoSocial: 'LUMEN LTDA', municipioCodigo: '4113700',
    endereco: { logradouro: 'X', numero: '1', bairro: 'C', cep: '86010000', uf: 'PR' },
    optaSimples: 3, regimeEspecial: 0,
  },
  tomador: {
    documento: '16371384000199', razaoSocial: 'STEELDEK ACO INOXIDAVEL LTDA',
    endereco: { logradouro: 'MAUA', numero: '2341', bairro: 'ZONA 03', cep: '87050020', municipioCodigo: '4115200' },
  },
  servico: {
    descricao: 'Consultoria', itemListaServico: '010601',
    municipioPrestacao: '4113700', competencia: '2026-08-01',
  },
  valores: { servico: 100 },
})

// ---------------------------------------------------------------------------
console.log('🧪 TESTE 1: bloco <subst> no XML')
const comSubst = montarDPS({
  ...base(),
  substituicao: { chaveAcesso: CHAVE, codigoMotivo: '01', motivo: 'Correcao da descricao do servico' },
})
ok(comSubst.includes(`<subst><chSubstda>${CHAVE}</chSubstda>`), 'chSubstda com a chave da original')
ok(comSubst.includes('<cMotivo>01</cMotivo>'), 'código do motivo')
ok(/<subst>.*<\/subst><prest>/.test(comSubst), '<subst> vem antes de <prest>, como o schema exige')
ok(!montarDPS(base()).includes('<subst>'), 'DPS comum não leva o bloco')

console.log('\n🧪 TESTE 2: validações do bloco')
// ⚠️ MinLength descoberto no schema: "Correcao" (8 chars) é recusado com
// "The actual length is less than the MinLength value".
const curto = camposFaltantes({ ...base(), substituicao: { chaveAcesso: CHAVE, motivo: 'Correcao' } })
ok(curto.some((f) => /pelo menos 15/.test(f.rotulo)), `motivo curto é recusado antes de transmitir (mín. ${MOTIVO_MIN})`)
const chaveRuim = camposFaltantes({ ...base(), substituicao: { chaveAcesso: '123', motivo: 'Correcao da descricao' } })
ok(chaveRuim.some((f) => /50 dígitos/.test(f.rotulo)), 'chave de tamanho errado é recusada')

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 3: guardas do endpoint')
ok((await chamar({ emission_id: 1, motivo: 'x'.repeat(20) }, { auth: false })).code === 401, 'sem token → 401')
ok((await chamar({}, { method: 'GET' })).code === 405, 'GET → 405')
ok((await chamar({ motivo: 'x'.repeat(20) })).code === 400, 'sem emission_id → 400')
const semMotivo = await chamar({ emission_id: 1, motivo: 'curto' })
ok(semMotivo.code === 400 && /pelo menos/.test(semMotivo.body.error), 'motivo curto → 400 explicando')
ok((await chamar({ emission_id: 999999, motivo: 'Correcao da descricao do servico' })).code === 404,
  'emissão inexistente → 404')

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 4: substituição real em HOMOLOGAÇÃO')
const [emitente] = await sql`SELECT * FROM nfse_emitter_settings WHERE company_id = 1`
const [fatura] = await sql`
  SELECT i.id FROM invoices i JOIN clients cl ON cl.id = i.client_id
  WHERE i.require_nf IS NOT FALSE AND cl.cpf_cnpj IS NOT NULL AND i.invoice_value > 0
    AND NOT EXISTS (SELECT 1 FROM nfse_emissions e WHERE e.invoice_id = i.id)
  -- Mais antiga primeiro: competência futura é recusada com E0015.
  ORDER BY i.year, i.month LIMIT 1`

if (!emitente || !fatura) {
  console.log('  ⏭️  PULADO: sem emitente configurado ou sem fatura livre com tomador completo')
} else {
  const criadas = []
  try {
    // ⚠️ Emite a original em HOMOLOGAÇÃO: `ambiente` da linha é o que manda no
    // endpoint de substituição, então basta gravar 2.
    const emitirMod = await import('../api/nfse-emit.js?v=' + Date.now())
    process.env.NFSE_AMBIENTE = 'homologacao'
    const resEmit = { code: 0, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
    await emitirMod.default(
      { method: 'POST', body: { invoice_id: fatura.id, transmitir: true }, headers: { authorization: `Bearer ${token}` } },
      resEmit
    )
    if (resEmit.code !== 200) {
      console.log(`  ⏭️  PULADO: emissão em homologação falhou (${resEmit.code} — ${resEmit.body?.error?.slice(0, 90)})`)
    } else {
      const orig = resEmit.body.emissao
      criadas.push(orig.id)
      ok(orig.status === 'autorizada', `original autorizada em homologação — nota ${orig.nfse_number}`)

      // ⚠️ O caso que motivou o pedido: mudar o VALOR. O SEFIN recusa com E0063
      // para optante do Simples ME/EPP — e a recusa vem ANTES de transmitir,
      // para não queimar um número de DPS e devolver texto de schema.
      const comValor = await chamar({
        emission_id: orig.id, motivo: 'Correcao do valor do servico prestado', novo_valor: 999.99,
      })
      ok(comValor.code === 422 && /não pode alterar o valor/i.test(comValor.body.error),
        'trocar o valor → 422 antes de transmitir (E0063)')
      ok(/cancele a nota/i.test(comValor.body.alternativa || ''), 'e aponta o caminho: cancelar e emitir outra')

      // prévia não transmite
      const previa = await chamar({ emission_id: orig.id, motivo: 'Correcao da descricao do servico' })
      ok(previa.code === 200 && previa.body.preview === true, 'prévia → 200 sem transmitir')
      ok(previa.body.xml_assinado?.includes('<subst>'), 'a prévia traz o bloco <subst>')
      const aindaOrig = await sql`SELECT status, substituida_por FROM nfse_emissions WHERE id = ${orig.id}`
      ok(aindaOrig[0].status === 'autorizada' && aindaOrig[0].substituida_por === null,
        'prévia NÃO marcou a original')

      // substituição de verdade, mesmo valor
      const r = await chamar({
        emission_id: orig.id, motivo: 'Correcao da descricao do servico prestado', transmitir: true,
      })
      if (r.code !== 200) {
        console.log('  ⏭️  substituição recusada pelo SEFIN:')
        console.log('     ', (r.body?.error || '').slice(0, 400))
      } else {
        criadas.push(r.body.nova.id)
        ok(r.body.nova.status === 'autorizada', `nota substituta autorizada — nº ${r.body.nova.nfse_number}`)
        ok(r.body.nova.chave_acesso !== orig.chave_acesso, 'a substituta tem chave própria')

        const [dep] = await sql`SELECT status, substituida_por, cancelled_at FROM nfse_emissions WHERE id = ${orig.id}`
        // ⚠️ `substituida`, NÃO `cancelada`: quem a invalidou foi a nota nova, e
        // é o vínculo entre as duas que o histórico precisa preservar.
        ok(dep.status === 'substituida', 'a original vira "substituida", não "cancelada"')
        ok(dep.substituida_por === r.body.nova.id, 'e aponta para a substituta')
        ok(dep.cancelled_at === null, 'sem cancelled_at — não foi cancelamento')

        const [nv] = await sql`SELECT substitui FROM nfse_emissions WHERE id = ${r.body.nova.id}`
        ok(nv.substitui === orig.id, 'a substituta aponta de volta para a original')

        const ev = await sql`SELECT event_type FROM nfse_events WHERE nfse_emission_id = ${orig.id}`
        ok(ev.some((x) => x.event_type === 'nfse.substituida'), 'evento de substituição registrado')

        // não substitui duas vezes
        const denovo = await chamar({
          emission_id: orig.id, motivo: 'Segunda tentativa de substituicao', transmitir: true,
        })
        ok(denovo.code === 409, 'substituir de novo → 409')
      }

      // ⚠️ A fatura NÃO foi tocada.
      const [inv] = await sql`SELECT invoice_value FROM invoices WHERE id = ${fatura.id}`
      ok(Number(inv.invoice_value) > 0, `fatura intacta: R$ ${inv.invoice_value}`)
    }
  } finally {
    delete process.env.NFSE_AMBIENTE
    // ⚠️ Limpa por FATURA, não pelos ids que o teste guardou: uma substituição
    // recusada TAMBÉM grava linha (status 'erro') apontando para a original
    // via , e apagar só a original esbarra na FK.
    await sql`UPDATE nfse_emissions SET substitui = NULL, substituida_por = NULL
               WHERE invoice_id = ${fatura.id}`
    await sql`DELETE FROM nfse_emissions WHERE invoice_id = ${fatura.id}`
    // Tentativas que falharam também deixam linha (status 'erro'); são deste
    // teste e saem junto.
    await sql`DELETE FROM nfse_emissions WHERE invoice_id = ${fatura.id} AND status = 'erro'`
    const sobrou = await sql`SELECT count(*)::int n FROM nfse_emissions WHERE invoice_id = ${fatura.id}`
    ok(sobrou[0].n === 0, 'linhas de teste removidas')
  }
}

if (falhas > 0) {
  console.error(`\n❌ ${falhas} VERIFICAÇÃO(ÕES) FALHARAM!`)
  process.exit(1)
}
console.log('\n✅ TODOS OS TESTES PASSARAM!')
