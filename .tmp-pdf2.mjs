import 'dotenv/config';
import https from 'node:https';
import { neon } from '@neondatabase/serverless';
import cm from './lib/nfse-cert-manager.js';
import { extrairChaves } from './lib/nfse-signer.js';
const sql = neon(process.env.DATABASE_URL);
const [e] = await sql`SELECT chave_acesso FROM nfse_emissions WHERE chave_acesso IS NOT NULL ORDER BY id DESC LIMIT 1`;
const cert = await cm.getCertificateFromDB(sql, 1);
const { privateKeyPem, certificatePem } = extrairChaves(cert.pfxBuffer, cert.password);
const K = e.chave_acesso;
const get = (path, accept='*/*') => new Promise((r) => {
  const q = https.request({ host:'sefin.nfse.gov.br', path, method:'GET', timeout:15000,
    agent: new https.Agent({ key:privateKeyPem, cert:certificatePem, keepAlive:false }),
    headers:{ Accept: accept, 'User-Agent':'gestao_serv/1.0' } },
    (s)=>{ const b=[]; s.on('data',c=>b.push(c)); s.on('end',()=>{ const buf=Buffer.concat(b);
      r({ s:s.statusCode, loc:s.headers.location, ct:s.headers['content-type'], len:buf.length,
          pdf: buf.slice(0,5).toString()==='%PDF-', txt: buf.slice(0,180).toString('latin1').replace(/\s+/g,' ') }); }); });
  q.on('timeout',()=>{q.destroy();r({s:'TIMEOUT'})}); q.on('error',x=>r({s:'ERRO',txt:x.message})); q.end();
});
console.log('=== /SefinNacional/nfse/{chave}/danfse — 4 tentativas ===');
for (let i=1;i<=4;i++) {
  const r = await get(`/SefinNacional/nfse/${K}/danfse`, i>2 ? 'application/pdf' : '*/*');
  console.log(` ${i}) ${String(r.s).padEnd(8)} ${r.pdf ? 'PDF ✅ '+r.len+' bytes' : (r.ct||'')+' | '+(r.txt||'').slice(0,90)}`);
  if (r.pdf) break;
}
console.log('\n=== /SefinNacional/danfse/{chave} (deu 501) ===');
for (let i=1;i<=2;i++) {
  const r = await get(`/SefinNacional/danfse/${K}`);
  console.log(` ${i}) ${String(r.s).padEnd(8)} ${r.pdf ? 'PDF ✅' : (r.ct||'(sem content-type)')+' | '+(r.txt||'(corpo vazio)').slice(0,80)}`);
}
