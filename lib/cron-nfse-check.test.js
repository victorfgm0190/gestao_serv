// Roda com: node lib/cron-nfse-check.test.js
//
// ⚠️ Este teste NÃO fica em api/. Tudo que a Vercel encontra em /api vira
// função publicada — um `api/cron-nfse-check.test.js` seria uma rota no ar.
//
// ⚠️ E ele chama o handler direto, sem HTTP. A versão por `fetch` contra
// localhost:3000 exige `vercel dev` rodando e, sem ele, imprime "⚠️ ERRO
// (esperado se servidor não está rodando)" e termina como sucesso — um teste
// que passa sem ter testado nada.
import 'dotenv/config'
import { neon } from '@neondatabase/serverless'
import handler from '../api/cron-nfse-check.js'
import { statusDoCertificado } from './nfse-cert-status.js'

const EMPRESA = 1
const CRON_SECRET = process.env.CRON_SECRET
let falhas = 0
const ok = (cond, msg) => {
  console.log(`  ${cond ? '✅' : '❌'} ${msg}`)
  if (!cond) falhas++
  return cond
}

function chamar(headers) {
  const res = {
    code: 0, body: null,
    status(c) { this.code = c; return this },
    json(b) { this.body = b; return this },
  }
  return handler({ method: 'GET', headers }, res).then(() => res)
}

// ---------------------------------------------------------------------------
console.log('🧪 TESTE 1: faixas de validade (sem banco)')
const hoje = new Date('2026-08-18T12:00:00Z')
const emDias = (d) => new Date(hoje.getTime() + d * 86400000)

ok(statusDoCertificado(emDias(200), hoje).status === 'ok', '200 dias → ok')
ok(statusDoCertificado(emDias(25), hoje).status === 'warning', '25 dias → warning')
ok(statusDoCertificado(emDias(5), hoje).status === 'critical', '5 dias → critical')
ok(statusDoCertificado(emDias(-10), hoje).status === 'expired', 'vencido há 10 dias → expired')
ok(statusDoCertificado(emDias(30), hoje).alertType === 'expiring_30d', 'limiar 30 inclusivo')
ok(statusDoCertificado(emDias(7), hoje).alertType === 'expiring_7d', 'limiar 7 inclusivo')
ok(statusDoCertificado(emDias(31), hoje).precisaAlerta === false, '31 dias não alerta')

// ⚠️ O caso que a conta arredondada erra: vencido há 2 HORAS.
// Math.ceil(-0.083) é -0, que não é `< 0` — pela regra do esboço o
// certificado sairia como "critical, vence em 0 dias", oferecendo renovar algo
// que já não assina mais nada.
const recemVencido = statusDoCertificado(new Date(hoje.getTime() - 2 * 3600 * 1000), hoje)
ok(recemVencido.status === 'expired', `vencido há 2h → expired (dias=${recemVencido.diasRestantes})`)

const naoVigente = statusDoCertificado(emDias(300), hoje, emDias(10))
ok(naoVigente.status === 'not_yet_valid', 'início no futuro → not_yet_valid')

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 2: autenticação do cron')
if (!CRON_SECRET) {
  console.log('  ⏭️  PULADO: CRON_SECRET não definida')
} else {
  ok((await chamar({ 'x-vercel-cron': CRON_SECRET })).code === 401,
    'header x-vercel-cron com o SEGREDO é recusado (não é assim que a Vercel chama)')
  ok((await chamar({})).code === 401, 'sem credencial → 401')
  ok((await chamar({ authorization: 'Bearer errado' })).code === 401, 'Bearer errado → 401')
  ok((await chamar({ authorization: `Bearer ${CRON_SECRET}` })).code === 200, 'Bearer correto → 200')

  // É ASSIM que a Vercel chama o cron: header literal `1`.
  ok((await chamar({ 'x-vercel-cron': '1' })).code === 200, 'x-vercel-cron: "1" → 200 (chamada real da Vercel)')
}

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 3: alerta é gravado e não duplica')
if (!process.env.DATABASE_URL || !CRON_SECRET) {
  console.log('  ⏭️  PULADO: DATABASE_URL/CRON_SECRET ausente')
} else {
  const sql = neon(process.env.DATABASE_URL)
  const jaTem = await sql`SELECT id FROM nfse_certificates WHERE company_id = ${EMPRESA}`

  if (jaTem.length) {
    console.log(`  ⏭️  PULADO: empresa ${EMPRESA} já tem certificado — não será tocado`)
  } else {
    const venceEm5 = new Date(Date.now() + 5 * 86400000)
    try {
      // Só os metadados importam para o cron; o blob cifrado é irrelevante aqui.
      await sql`
        INSERT INTO nfse_certificates
          (company_id, certificate_pfx_encrypted, certificate_pfx_iv,
           certificate_password_encrypted, certificate_password_iv,
           certificate_subject, certificate_valid_from, certificate_valid_until)
        VALUES (${EMPRESA}, ${Buffer.from('x')}, 'aa', 'bb', 'cc',
                'FIXTURE DE TESTE', ${new Date(Date.now() - 86400000)}, ${venceEm5})`

      const r1 = await chamar({ authorization: `Bearer ${CRON_SECRET}` })
      ok(r1.code === 200, `execução 1 → 200 (${r1.body?.alertasCriados} alerta(s))`)
      ok(r1.body?.alertasCriados === 1, 'um alerta criado')

      const linhas = await sql`
        SELECT alert_type, severity, days_remaining, notified_at
        FROM nfse_certificate_alerts WHERE company_id = ${EMPRESA}`
      ok(linhas.length === 1, 'uma linha em nfse_certificate_alerts')
      ok(linhas[0].alert_type === 'expiring_7d', `alert_type = ${linhas[0].alert_type}`)
      ok(linhas[0].severity === 'critical', `severity = ${linhas[0].severity}`)

      // ⚠️ O ponto central: sem SMTP o alerta fica PENDENTE, e por isso pode
      // ser retentado. Gravado como notificado, o aviso morria ali.
      ok(linhas[0].notified_at === null,
        'notified_at NULL — e-mail não saiu, alerta segue pendente para retentar')
      ok(r1.body?.naoNotificados?.length === 1,
        `motivo reportado: ${r1.body?.naoNotificados?.[0]?.motivo}`)

      const r2 = await chamar({ authorization: `Bearer ${CRON_SECRET}` })
      const depois = await sql`
        SELECT count(*)::int n FROM nfse_certificate_alerts WHERE company_id = ${EMPRESA}`
      ok(r2.code === 200 && depois[0].n === 1,
        'execução 2 reaproveita o pendente — continua 1 linha, não 2')
    } finally {
      await sql`DELETE FROM nfse_certificate_alerts WHERE company_id = ${EMPRESA}`
      await sql`DELETE FROM nfse_certificates WHERE company_id = ${EMPRESA}`
      const sobrouC = await sql`SELECT count(*)::int n FROM nfse_certificates WHERE company_id = ${EMPRESA}`
      const sobrouA = await sql`SELECT count(*)::int n FROM nfse_certificate_alerts WHERE company_id = ${EMPRESA}`
      ok(sobrouC[0].n === 0 && sobrouA[0].n === 0, 'banco restaurado ao estado original')
    }
  }
}

// ---------------------------------------------------------------------------
if (falhas > 0) {
  console.error(`\n❌ ${falhas} VERIFICAÇÃO(ÕES) FALHARAM!`)
  process.exit(1)
}
console.log('\n✅ TODOS OS TESTES PASSARAM!')
