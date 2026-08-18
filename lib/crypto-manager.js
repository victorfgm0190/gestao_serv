import crypto from 'crypto';

const TAG_BYTES = 16; // tamanho do auth tag do GCM

/**
 * Cifra/decifra o certificado A1 (.pfx) e a senha dele com AES-256-GCM.
 *
 * A chave mestra vem de NFSE_MASTER_KEY (hex de 64 chars = 32 bytes). Gere uma
 * com `CryptoManager.generateMasterKey()` e guarde-a fora do repositório
 * (`.env` local + variável de ambiente na Vercel). Perder a chave é perder o
 * certificado: não há como recuperar o .pfx sem ela.
 */
export class CryptoManager {
  constructor() {
    this.algorithm = process.env.NFSE_CIPHER_ALGO || 'aes-256-gcm';
    this._masterKey = null;
  }

  /**
   * A chave é resolvida no primeiro uso, não no construtor.
   *
   * ⚠️ Este módulo é um singleton exportado — validar no construtor faria o
   * simples `import` derrubar qualquer endpoint que o carregue, com um erro de
   * módulo em vez de uma resposta. Assim o import é sempre seguro e quem chama
   * encrypt/decrypt recebe a falha com a causa dita por extenso.
   */
  get masterKey() {
    if (this._masterKey) return this._masterKey;

    const hex = process.env.NFSE_MASTER_KEY;
    if (!hex) {
      throw new Error('NFSE_MASTER_KEY não definida em variáveis de ambiente');
    }
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      // Buffer.from(hex,'hex') trunca em silêncio no primeiro char inválido —
      // uma chave com typo viraria um buffer curto e o erro sairia como
      // "Invalid key length", apontando para o lugar errado.
      throw new Error(
        'NFSE_MASTER_KEY inválida: esperado 64 caracteres hexadecimais (32 bytes)'
      );
    }

    this._masterKey = Buffer.from(hex, 'hex');
    return this._masterKey;
  }

  encrypt(data) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.masterKey, iv);

    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return {
      encrypted: encrypted + ':' + authTag.toString('hex'),
      iv: iv.toString('hex'),
    };
  }

  decrypt(encrypted, iv) {
    try {
      const [data, authTagHex] = encrypted.split(':');
      if (!authTagHex) {
        throw new Error('Formato de criptografia inválido');
      }

      const authTag = Buffer.from(authTagHex, 'hex');
      const ivBuffer = Buffer.from(iv, 'hex');

      const decipher = crypto.createDecipheriv(this.algorithm, this.masterKey, ivBuffer);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (err) {
      throw new Error(`Erro ao descriptografar: ${err.message}`);
    }
  }

  /** O auth tag vai anexado ao fim do buffer — é o que decryptBinary espera. */
  encryptBinary(fileBuffer) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.masterKey, iv);

    let encrypted = cipher.update(fileBuffer);
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    const authTag = cipher.getAuthTag();

    return {
      encrypted: Buffer.concat([encrypted, authTag]),
      iv: iv.toString('hex'),
    };
  }

  decryptBinary(encryptedBuffer, iv) {
    try {
      const authTag = encryptedBuffer.slice(-TAG_BYTES);
      const encrypted = encryptedBuffer.slice(0, -TAG_BYTES);
      const ivBuffer = Buffer.from(iv, 'hex');

      const decipher = crypto.createDecipheriv(this.algorithm, this.masterKey, ivBuffer);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      return decrypted;
    } catch (err) {
      throw new Error(`Erro ao descriptografar arquivo: ${err.message}`);
    }
  }

  generateThumbprint(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  static generateMasterKey() {
    return crypto.randomBytes(32).toString('hex');
  }
}

export default new CryptoManager();
