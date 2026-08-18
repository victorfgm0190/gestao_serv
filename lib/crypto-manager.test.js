// Roda com: node lib/crypto-manager.test.js
// Exige NFSE_MASTER_KEY no .env (dotenv é carregado abaixo — sem isso o script
// não enxerga o .env e falha com "NFSE_MASTER_KEY não definida").
import 'dotenv/config';
import cryptoManager from './crypto-manager.js';

let falhas = 0;
const check = (ok) => {
  if (!ok) falhas++;
  return ok ? 'SIM' : 'NÃO';
};

console.log('🧪 TESTE 1: Criptografia de texto (senha)');
const senhaOriginal = 'minha-senha-super-secreta-123';
const { encrypted: encSenha, iv: ivSenha } = cryptoManager.encrypt(senhaOriginal);
const senhaDecrypt = cryptoManager.decrypt(encSenha, ivSenha);

console.log(`  Original:      ${senhaOriginal}`);
console.log(`  Criptografada: ${encSenha.substring(0, 50)}...`);
console.log(`  Descriptografada: ${senhaDecrypt}`);
console.log(`  ✅ PASSOU: ${check(senhaOriginal === senhaDecrypt)}\n`);

console.log('🧪 TESTE 2: Criptografia binária (arquivo)');
const bufferOriginal = Buffer.from('arquivo-pfx-conteudo-12345');
const { encrypted: encBin, iv: ivBin } = cryptoManager.encryptBinary(bufferOriginal);
const bufferDecrypt = cryptoManager.decryptBinary(encBin, ivBin);

console.log(`  Original:      ${bufferOriginal.toString()}`);
console.log(`  Criptografada: ${encBin.length} bytes`);
console.log(`  Descriptografada: ${bufferDecrypt.toString()}`);
console.log(`  ✅ PASSOU: ${check(bufferOriginal.equals(bufferDecrypt))}\n`);

console.log('🧪 TESTE 3: Geração de Thumbprint');
const thumbprint = cryptoManager.generateThumbprint(bufferOriginal);
console.log(`  Thumbprint SHA256: ${thumbprint}`);
console.log(`  Tamanho: ${thumbprint.length} caracteres`);
console.log(`  ✅ PASSOU: ${check(thumbprint.length === 64)}\n`);

// O GCM não é só sigilo: ele autentica. Se um byte do .pfx guardado no banco
// for adulterado, decryptBinary tem de RECUSAR — devolver lixo silenciosamente
// seria pior do que falhar, porque o certificado corrompido só apareceria na
// hora de assinar a nota.
console.log('🧪 TESTE 4: Adulteração é detectada (auth tag do GCM)');
const adulterado = Buffer.from(encBin);
adulterado[0] ^= 0xff;
let recusou = false;
try {
  cryptoManager.decryptBinary(adulterado, ivBin);
} catch {
  recusou = true;
}
console.log(`  Byte alterado no ciphertext → decifra recusada: ${recusou}`);
console.log(`  ✅ PASSOU: ${check(recusou)}\n`);

if (falhas > 0) {
  console.error(`❌ ${falhas} TESTE(S) FALHARAM!`);
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM!');
