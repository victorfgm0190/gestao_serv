// Roda com: node lib/consultar-cnpj.test.js
//
// O teste 4 faz uma consulta REAL à BrasilAPI. Se ela recusar por limite de
// requisições (403/429 — acontece com IP de datacenter), o caso é PULADO em vez
// de falhar: instabilidade do provedor não é regressão do nosso código.
import 'dotenv/config'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-16-chars'
import { signToken } from './auth.js'
import consultar, { mapearCNPJ, cnpjValido } from '../api/consultar-cnpj.js'
import { aplicarDados } from '../src/lib/useCNPJConsulta.js'

let falhas = 0
const ok = (cond, msg) => {
  console.log(`  ${cond ? '✅' : '❌'} ${msg}`)
  if (!cond) falhas++
  return cond
}

const token = signToken({ sub: '1', username: 'teste', master: true })
const chamar = async (query, { auth = true, method = 'GET' } = {}) => {
  const res = {
    code: 0, body: null,
    status(c) { this.code = c; return this },
    json(b) { this.body = b; return this },
  }
  await consultar({ method, query, headers: auth ? { authorization: `Bearer ${token}` } : {} }, res)
  return res
}

// ---------------------------------------------------------------------------
console.log('🧪 TESTE 1: mapeamento — o esboço lia os campos da API errada')
// Resposta REAL da BrasilAPI para 64761267000184 (LUMEN LTDA), campos que importam.
const respostaReal = {
  cnpj: '64761267000184',
  razao_social: 'LUMEN LTDA',
  nome_fantasia: 'LUMEN TECH',
  logradouro: 'PROFESSOR JOÃO CÂNDIDO',
  numero: '324',
  complemento: 'LOJA 29',
  bairro: 'CENTRO',
  cep: '86010000',
  municipio: 'LONDRINA',
  codigo_municipio: 7667,          // código da RFB
  codigo_municipio_ibge: 4113700,  // código do IBGE — é este que a NFS-e usa
  uf: 'PR',
  email: null,
  ddd_telefone_1: '4399793267',
  descricao_situacao_cadastral: 'ATIVA',
}

const m = mapearCNPJ(respostaReal)
ok(m.razao_social === 'LUMEN LTDA', 'razão social')
ok(m.nome_fantasia === 'LUMEN TECH', 'nome fantasia (o esboço lia `fantasia`, que não existe → viria vazio)')
ok(m.endereco === 'PROFESSOR JOÃO CÂNDIDO', 'logradouro')
ok(m.telefone === '4399793267', 'telefone (o esboço lia `telefone`; o campo é `ddd_telefone_1`)')
ok(m.cep === '86010000', 'CEP só com dígitos')
ok(m.uf === 'PR', 'UF')
ok(m.ativa === true, 'situação ativa (o esboço lia `situacao`, ausente → ativo era sempre false)')

// ⚠️ O erro que mandaria a nota para a prefeitura errada.
ok(m.municipio_codigo === '4113700', `município = IBGE 4113700 (Londrina), não o 7667 da RFB`)
ok(m.municipio_codigo !== '7667', 'nunca usa codigo_municipio (RFB)')
ok(m.municipio === 'LONDRINA', 'nome do município preservado para exibição')

// `municipio` é STRING na BrasilAPI — o esboço fazia `municipio?.nome`
ok(respostaReal.municipio?.nome === undefined && typeof respostaReal.municipio === 'string',
  'municipio é string: `municipio?.nome` e `municipio?.codigo` dariam undefined')

// null/vazio não vira string "null"
const vazio = mapearCNPJ({ cnpj: '64761267000184', email: null, complemento: '', uf: null })
ok(vazio.email === null && vazio.complemento === null && vazio.uf === null,
  'campos nulos/vazios continuam nulos')

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 2: validação de CNPJ')
ok(cnpjValido('64761267000184'), 'CNPJ real é válido')
ok(cnpjValido('64.761.267/0001-84'), 'aceita com máscara')
ok(!cnpjValido('64761267000185'), 'dígito verificador errado é recusado')
ok(!cnpjValido('11111111111111'), 'sequência repetida é recusada')
ok(!cnpjValido('123'), 'curto demais')

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 3: endpoint')
// 🔒 O esboço não tinha requireAuth — a rota nascia pública.
ok((await chamar({ cnpj: '64761267000184' }, { auth: false })).code === 401, 'sem token → 401')
ok((await chamar({}, { method: 'POST' })).code === 405, 'POST → 405')
ok((await chamar({})).code === 400, 'sem cnpj → 400')
ok((await chamar({ cnpj: '123' })).code === 400, 'CNPJ curto → 400')
const dv = await chamar({ cnpj: '64761267000185' })
ok(dv.code === 400 && dv.body.tipo === 'invalido',
  'dígito verificador errado → 400 sem gastar a cota da API')

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 4: consulta real')
const real = await chamar({ cnpj: '64761267000184' })
if (real.code === 429) {
  console.log(`  ⏭️  PULADO: provedor recusou por limite (${real.body.error.slice(0, 50)}…)`)
  ok(real.body.tipo === 'limite', 'o 403/429 do provedor vira 429 com motivo legível, não 500 opaco')
} else if (real.code >= 500) {
  console.log(`  ⏭️  PULADO: provedor indisponível (${real.code})`)
} else {
  ok(real.code === 200, 'consulta → 200')
  ok(real.body.dados.razao_social === 'LUMEN LTDA', `razão social: ${real.body.dados.razao_social}`)
  ok(real.body.dados.municipio_codigo === '4113700',
    `município IBGE: ${real.body.dados.municipio_codigo} (${real.body.dados.municipio})`)
  ok(real.body.dados.cep?.length === 8, `CEP: ${real.body.dados.cep}`)
}
const inexistente = await chamar({ cnpj: '00000000000191' }) // Banco do Brasil? não: CNPJ válido de teste
ok([200, 404, 429, 502, 504].includes(inexistente.code),
  `CNPJ válido mas improvável → resposta tratada (${inexistente.code})`)

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 5: aplicarDados não sobrescreve o que já foi digitado')
const formulario = {
  razao_social: '', endereco: 'Rua corrigida à mão', numero: '', cep: '', uf: '',
}
const mapa = { razao_social: 'razao_social', endereco: 'endereco', numero: 'numero', cep: 'cep', uf: 'uf' }

const r1 = aplicarDados(formulario, m, mapa)
ok(r1.form.razao_social === 'LUMEN LTDA', 'campo vazio é preenchido')
// ⚠️ O ponto: o debounce do esboço fazia `dados.x || prev.x` e apagava a
// correção manual do endereço.
ok(r1.form.endereco === 'Rua corrigida à mão', 'campo preenchido NÃO é sobrescrito')
ok(r1.mantidos.includes('endereco'), 'e o que foi mantido é reportado')
ok(r1.preenchidos.includes('razao_social') && r1.preenchidos.includes('cep'),
  `preenchidos: ${r1.preenchidos.join(', ')}`)

const r2 = aplicarDados(formulario, m, mapa, { sobrescrever: true })
ok(r2.form.endereco === 'PROFESSOR JOÃO CÂNDIDO', 'com sobrescrever: true, substitui')
ok(r2.mantidos.length === 0, 'nada fica pendente quando se substitui')

const r3 = aplicarDados({ ...formulario, endereco: 'PROFESSOR JOÃO CÂNDIDO' }, m, mapa)
ok(!r3.mantidos.includes('endereco') && !r3.preenchidos.includes('endereco'),
  'valor já igual ao da Receita não conta como preenchido nem como mantido')

// ---------------------------------------------------------------------------
console.log('\n\ud83e\uddea TESTE 6: os campos fiscais do cliente t\u00eam onde ser gravados')
// ⚠️ Antes desta etapa o PUT de /api/clients só aceitava `name` e
// `email_domain`: a tela podia coletar CNPJ e endereço, e nada disso chegaria
// ao banco. O GET também não os devolvia, então reabrir o cliente mostraria
// campos vazios.
const { neon } = await import('@neondatabase/serverless')
const clientsApi = (await import('../api/clients.js')).default
const sql = neon(process.env.DATABASE_URL)
const CLIENTE = 13

const chamarClients = async (method, { query = {}, body } = {}) => {
  const res = {
    code: 0, body: null,
    status(c) { this.code = c; return this },
    json(b) { this.body = b; return this },
  }
  await clientsApi({ method, query, body, headers: { authorization: `Bearer ${token}` } }, res)
  return res
}

const antes = (await sql`SELECT * FROM clients WHERE id = ${CLIENTE}`)[0]
try {
  const g = await chamarClients('GET')
  const alvo = g.body.clients.find((c) => c.id === CLIENTE)
  ok('cpf_cnpj' in alvo && 'municipio_codigo' in alvo && 'razao_social' in alvo,
    'GET devolve os campos fiscais')

  const p1 = await chamarClients('PUT', {
    query: { id: CLIENTE },
    body: {
      name: antes.name, company_ids: alvo.company_ids,
      cpf_cnpj: '64.761.267/0001-84', razao_social: 'LUMEN LTDA',
      endereco: 'Professor Jo\u00e3o C\u00e2ndido', numero: '324', bairro: 'Centro',
      cep: '86010-000', municipio_codigo: '4113700', uf: 'pr', telefone: '(43) 9979-3267',
    },
  })
  ok(p1.code === 200, 'PUT com campos fiscais \u2192 200')

  const dep = (await sql`SELECT * FROM clients WHERE id = ${CLIENTE}`)[0]
  ok(dep.cpf_cnpj === '64761267000184', `CNPJ normalizado: ${dep.cpf_cnpj}`)
  ok(dep.cep === '86010000', `CEP normalizado: ${dep.cep}`)
  ok(dep.uf === 'PR', 'UF em mai\u00fasculas')
  ok(dep.municipio_codigo === '4113700', 'c\u00f3digo IBGE gravado')

  // ⚠️ O caso que o COALESCE protege: salvar só o nome não pode apagar o
  // cadastro fiscal. A tela de Clientes mandava exatamente esse corpo antes
  // desta etapa, e outras telas ainda podem mandar.
  await chamarClients('PUT', {
    query: { id: CLIENTE },
    body: { name: antes.name, company_ids: alvo.company_ids },
  })
  const dep2 = (await sql`SELECT * FROM clients WHERE id = ${CLIENTE}`)[0]
  ok(dep2.cpf_cnpj === '64761267000184' && dep2.municipio_codigo === '4113700',
    'PUT s\u00f3 com o nome N\u00c3O apaga CNPJ nem munic\u00edpio')
} finally {
  await sql`
    UPDATE clients SET cpf_cnpj = ${antes.cpf_cnpj}, razao_social = ${antes.razao_social},
      endereco = ${antes.endereco}, numero = ${antes.numero}, complemento = ${antes.complemento},
      bairro = ${antes.bairro}, cep = ${antes.cep}, municipio_codigo = ${antes.municipio_codigo},
      uf = ${antes.uf}, telefone = ${antes.telefone}, email = ${antes.email},
      inscricao_municipal = ${antes.inscricao_municipal}
    WHERE id = ${CLIENTE}`
  const fim = (await sql`SELECT cpf_cnpj, endereco, municipio_codigo FROM clients WHERE id = ${CLIENTE}`)[0]
  ok(fim.cpf_cnpj === antes.cpf_cnpj && fim.endereco === antes.endereco
     && fim.municipio_codigo === antes.municipio_codigo,
    'cliente restaurado ao estado original')
}

// ---------------------------------------------------------------------------
if (falhas > 0) {
  console.error(`\n❌ ${falhas} VERIFICAÇÃO(ÕES) FALHARAM!`)
  process.exit(1)
}
console.log('\n✅ TODOS OS TESTES PASSARAM!')
