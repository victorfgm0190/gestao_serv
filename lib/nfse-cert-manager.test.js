// Roda com: node lib/nfse-cert-manager.test.js
//
// Precisa de NFSE_MASTER_KEY (cifra) e, para o teste 4, de DATABASE_URL.
// O teste 4 grava e apaga uma linha real em nfse_certificates — ele PULA
// sozinho se a empresa alvo já tiver certificado, para nunca sobrescrever
// um certificado de verdade.
import 'dotenv/config';
import forge from 'node-forge';
import { neon } from '@neondatabase/serverless';
import nfseCertManager from './nfse-cert-manager.js';

const EMPRESA_TESTE = 1; // Lumen
let falhas = 0;
const ok = (cond, msg) => {
  if (cond) {
    console.log(`  ✅ ${msg}`);
  } else {
    console.log(`  ❌ ${msg}`);
    falhas++;
  }
  return cond;
};

// ---------------------------------------------------------------------------
console.log('🧪 TESTE 1: arquivo que não é um .pfx é recusado');
try {
  nfseCertManager.extractCertInfo(Buffer.from('fake-pfx-data'), 'senha123');
  ok(false, 'deveria ter lançado erro');
} catch (err) {
  ok(/inválido ou corrompido/.test(err.message), `erro capturado: ${err.message.slice(0, 60)}`);
}

// ---------------------------------------------------------------------------
// ⚠️ Este teste substitui o "validação de parâmetros" do esboço, que montava um
// objeto e imprimia PASSOU sem chamar nada — não tinha como falhar. Aqui um
// .pfx REAL é gerado na hora e lido de volta: é o caminho que o upload percorre.
console.log('\n🧪 TESTE 2: .pfx real gerado na hora → extractCertInfo');
const SENHA = 'senha-do-pfx-123';
const CN = 'LUMEN DEV TESTE:12345678000199';

const keys = forge.pki.rsa.generateKeyPair(1024); // chave curta: é fixture de teste
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = '01';
cert.validity.notBefore = new Date(Date.now() - 86400000);      // ontem
cert.validity.notAfter = new Date(Date.now() + 90 * 86400000);  // +90 dias
const attrs = [{ name: 'commonName', value: CN }];
cert.setSubject(attrs);
cert.setIssuer(attrs);
cert.sign(keys.privateKey);

const p12Der = forge.asn1
  .toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, cert, SENHA, { algorithm: '3des' }))
  .getBytes();
const pfxBuffer = Buffer.from(p12Der, 'binary');

const info = nfseCertManager.extractCertInfo(pfxBuffer, SENHA);
console.log(`     titular: ${info.subject}`);
console.log(`     validade: ${info.validFrom.toISOString().slice(0, 10)} → ${info.validUntil.toISOString().slice(0, 10)}`);
ok(info.subject === CN, 'CN do titular lido corretamente');
ok(info.thumbprint.length === 64, 'thumbprint SHA256 gerado');
ok(Math.abs(info.validUntil - cert.validity.notAfter) < 1000, 'validade bate com o certificado');

console.log('\n🧪 TESTE 2b: senha errada é distinguida de arquivo corrompido');
try {
  nfseCertManager.extractCertInfo(pfxBuffer, 'senha-errada');
  ok(false, 'deveria ter recusado a senha');
} catch (err) {
  ok(err.message === 'Senha do certificado incorreta', `mensagem específica: "${err.message}"`);
}

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 3: métodos existem');
for (const m of [
  'saveCertificateToDB', 'getCertificateFromDB', 'extractCertInfo',
  'validateCertificate', 'deleteCertificate', 'getCertificateStatus',
]) {
  ok(typeof nfseCertManager[m] === 'function', m);
}

// ---------------------------------------------------------------------------
// O que este teste pega e nenhum outro pegaria: o .pfx trafega como `bytea`.
// Se o driver devolvesse string em vez de Buffer, decryptBinary fatiaria
// caracteres achando que são bytes e o certificado voltaria corrompido.
console.log('\n🧪 TESTE 4: ida e volta pelo banco (grava, lê, valida, apaga)');
if (!process.env.DATABASE_URL) {
  console.log('  ⏭️  PULADO: DATABASE_URL não definida');
} else {
  const sql = neon(process.env.DATABASE_URL);
  const existente = await nfseCertManager.getCertificateStatus(sql, EMPRESA_TESTE);

  if (existente) {
    console.log(`  ⏭️  PULADO: empresa ${EMPRESA_TESTE} já tem certificado (${existente.certificate_subject}) — não será sobrescrito`);
  } else {
    let gravou = false;
    try {
      const saved = await nfseCertManager.saveCertificateToDB(
        sql, EMPRESA_TESTE, pfxBuffer, SENHA, info
      );
      gravou = true;
      ok(saved?.id > 0, `gravado (id=${saved.id})`);
      ok(saved.certificate_pfx_encrypted === undefined, 'RETURNING não devolve o .pfx cifrado');

      const lido = await nfseCertManager.getCertificateFromDB(sql, EMPRESA_TESTE);
      ok(Buffer.isBuffer(lido.pfxBuffer), 'pfx volta como Buffer');
      ok(lido.pfxBuffer.equals(pfxBuffer), 'pfx idêntico byte a byte após ida e volta');
      ok(lido.password === SENHA, 'senha decifrada corretamente');

      // o .pfx que voltou do banco ainda abre?
      const infoLido = nfseCertManager.extractCertInfo(lido.pfxBuffer, lido.password);
      ok(infoLido.subject === CN, 'certificado recuperado ainda é legível');

      const val = await nfseCertManager.validateCertificate(sql, EMPRESA_TESTE);
      ok(val.valid === true, `validade OK (${val.daysRemaining} dias restantes)`);

      // upsert: segundo envio não duplica linha
      const again = await nfseCertManager.saveCertificateToDB(
        sql, EMPRESA_TESTE, pfxBuffer, SENHA, info
      );
      ok(again.id === saved.id, 'reenvio atualiza a mesma linha (ON CONFLICT)');
    } finally {
      if (gravou) {
        const apagou = await nfseCertManager.deleteCertificate(sql, EMPRESA_TESTE);
        ok(apagou, 'linha de teste removida');
        const sobrou = await nfseCertManager.getCertificateStatus(sql, EMPRESA_TESTE);
        ok(sobrou === null, 'banco restaurado ao estado original');
      }
    }

    // certificado inexistente é erro identificável, não string a casar
    try {
      await nfseCertManager.validateCertificate(sql, EMPRESA_TESTE);
      ok(false, 'deveria ter lançado CERT_NOT_FOUND');
    } catch (err) {
      ok(err.code === 'CERT_NOT_FOUND', 'ausência de certificado sinalizada por err.code');
    }
  }
}

// ---------------------------------------------------------------------------
if (falhas > 0) {
  console.error(`\n❌ ${falhas} VERIFICAÇÃO(ÕES) FALHARAM!`);
  process.exit(1);
}
console.log('\n✅ TODOS OS TESTES PASSARAM!');
