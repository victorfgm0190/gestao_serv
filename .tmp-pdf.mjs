import 'dotenv/config';
import https from 'node:https';
import { neon } from '@neondatabase/serverless';
import cm from './lib/nfse-cert-manager.js';
import { extrairChaves } from './lib/nfse-signer.js';
const sql = neon(process.env.DATABASE_URL);
const [e] = await sql`SELECT chave_acesso FROM nfse_emissions WHERE chave_acesso IS NOT NULL ORDER BY id DESC LIMIT 1`;
const cert = await cm.getCertificateFromDB(sql, 1);
const { privateKeyPem, certificatePem } = extrairChaves(cert.pfxBuffer, cert.password);
const agent = new https.Agent({ key: privateKeyPem, cert: certificatePem, keepAlive: false });
const K = e.chave_acesso;

const get = (host, path, comCert = true) => new Promise((r) => {
  const opts = { host, path, method:'GET', timeout:12000, headers:{ Accept:'*/*', 'User-Agent':'gestao_serv/1.0' } };
  if (comCert) opts.agent = agent;
  const q = https.request(opts, (s) => {
    const bufs=[]; s.on('data',c=>bufs.push(c));
    s.on('end',()=>{ const b=Buffer.concat(bufs);
      r({ s:s.statusCode, ct:s.headers['content-type'], len:b.length,
          pdf: b.slice(0,5).toString()==='%PDF-', head: b.slice(0,70).toString('latin1').replace(/\s+/g,' ') }); });
  });
  q.on('timeout',()=>{q.destroy();r({s:'TIMEOUT'})}); q.on('error',x=>r({s:'ERRO',head:x.message})); q.end();
});

const alvos = [
  ['sefin.nfse.gov.br', `/SefinNacional/nfse/${K}/danfse`, true],
  ['sefin.nfse.gov.br', `/SefinNacional/danfse/${K}`, true],
  ['sefin.nfse.gov.br', `/SefinNacional/nfse/${K}/pdf`, true],
  ['adn.nfse.gov.br',   `/contribuinte/danfse/${K}`, true],
  ['www.nfse.gov.br',   `/api/v1/nfse/${K}/pdf`, false],
  ['www.nfse.gov.br',   `/DANFSE/${K}`, false],
  ['consulta.nfse.gov.br', `/danfse/${K}`, false],
  ['sefin.nfse.gov.br', `/danfse/${K}`, true],
];
for (const [h,p,c] of alvos) {
  const r = await get(h,p,c);
  console.log((h+p.slice(0,26)+'…').padEnd(52), String(r.s).padEnd(8), r.pdf ? 'PDF ✅ '+r.len+'b' : (r.ct||'') + ' ' + (r.head||'').slice(0,55));
}
