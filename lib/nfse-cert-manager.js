import forge from 'node-forge';
import cryptoManager from './crypto-manager.js';

/**
 * Cofre do certificado A1 (.pfx) usado para assinar a NFS-e.
 *
 * O .pfx e a senha são gravados cifrados (AES-256-GCM, lib/crypto-manager.js);
 * os metadados (titular, validade, thumbprint) ficam em claro, porque são o que
 * as telas precisam ler sem tocar na chave privada.
 *
 * ⚠️ Todos os métodos recebem `sql` — o cliente do `@neondatabase/serverless`,
 * o mesmo que os endpoints já instanciam. O esboço original usava
 * `@vercel/postgres` (`pool.query(...).rows`), que não é dependência deste
 * projeto: um segundo driver significaria duas configurações de conexão, dois
 * pools e dois jeitos de escrever a mesma query. O driver do Neon devolve as
 * linhas como array direto e trata `bytea` como Buffer nos dois sentidos
 * (verificado contra o banco), então o .pfx cifrado vai e volta sem conversão.
 */
class NFSeCertManager {
  /**
   * Grava (ou substitui) o certificado da empresa, cifrado.
   *
   * `certInfo` pode vir pronto de quem já chamou `extractCertInfo` — a leitura
   * do .pfx é a parte cara, e o endpoint valida o arquivo antes de salvar.
   */
  async saveCertificateToDB(sql, companyId, pfxBuffer, pfxPassword, certInfo = null) {
    try {
      const info = certInfo || this.extractCertInfo(pfxBuffer, pfxPassword);

      const { encrypted: encryptedPfx, iv: pfxIv } = cryptoManager.encryptBinary(pfxBuffer);
      const { encrypted: encryptedPassword, iv: passwordIv } = cryptoManager.encrypt(pfxPassword);

      // ⚠️ RETURNING sem as colunas cifradas. Devolver o .pfx e a senha aqui
      // faria a chave privada atravessar toda a pilha só para ser descartada —
      // e bastaria um log da resposta para vazá-la.
      const rows = await sql`
        INSERT INTO nfse_certificates
          (company_id, certificate_pfx_encrypted, certificate_pfx_iv,
           certificate_password_encrypted, certificate_password_iv,
           certificate_thumbprint, certificate_subject,
           certificate_valid_from, certificate_valid_until, uploaded_by)
        VALUES
          (${companyId}, ${encryptedPfx}, ${pfxIv},
           ${encryptedPassword}, ${passwordIv},
           ${info.thumbprint}, ${info.subject},
           ${info.validFrom}, ${info.validUntil}, ${info.uploadedBy ?? null})
        ON CONFLICT (company_id) DO UPDATE SET
          certificate_pfx_encrypted      = EXCLUDED.certificate_pfx_encrypted,
          certificate_pfx_iv             = EXCLUDED.certificate_pfx_iv,
          certificate_password_encrypted = EXCLUDED.certificate_password_encrypted,
          certificate_password_iv        = EXCLUDED.certificate_password_iv,
          certificate_thumbprint         = EXCLUDED.certificate_thumbprint,
          certificate_subject            = EXCLUDED.certificate_subject,
          certificate_valid_from         = EXCLUDED.certificate_valid_from,
          certificate_valid_until        = EXCLUDED.certificate_valid_until,
          uploaded_by                    = EXCLUDED.uploaded_by,
          uploaded_at                    = NOW(),
          updated_at                     = NOW()
        RETURNING id, company_id, certificate_thumbprint, certificate_subject,
                  certificate_valid_from, certificate_valid_until,
                  uploaded_by, uploaded_at, updated_at`;

      return rows[0];
    } catch (err) {
      // A mensagem do erro nunca carrega a senha — só o motivo.
      console.error('[nfse-cert] falha ao salvar certificado:', err.message);
      throw new Error(`Falha ao salvar certificado: ${err.message}`);
    }
  }

  /**
   * Recupera o certificado e o decifra. Só chamar na hora de ASSINAR — para
   * saber validade ou titular use `getCertificateStatus`, que não decifra nada.
   */
  async getCertificateFromDB(sql, companyId) {
    const rows = await sql`
      SELECT certificate_pfx_encrypted, certificate_pfx_iv,
             certificate_password_encrypted, certificate_password_iv,
             certificate_subject, certificate_valid_from, certificate_valid_until
      FROM nfse_certificates
      WHERE company_id = ${companyId}`;

    if (rows.length === 0) throw notFound(companyId);

    const row = rows[0];

    // O driver devolve bytea como Buffer. Se algum dia devolver string (hex
    // `\x...`), decryptBinary fatiaria caracteres achando que são bytes e o
    // auth tag do GCM recusaria a decifra — falha ruidosa, não silenciosa.
    const pfxBuffer = cryptoManager.decryptBinary(
      row.certificate_pfx_encrypted,
      row.certificate_pfx_iv
    );

    const password = cryptoManager.decrypt(
      row.certificate_password_encrypted,
      row.certificate_password_iv
    );

    return {
      pfxBuffer,
      password,
      subject: row.certificate_subject,
      validFrom: row.certificate_valid_from,
      validUntil: row.certificate_valid_until,
    };
  }

  /** Metadados sem decifrar nada — é o que as telas leem. */
  async getCertificateStatus(sql, companyId) {
    const rows = await sql`
      SELECT id, company_id, certificate_thumbprint, certificate_subject,
             certificate_valid_from, certificate_valid_until,
             uploaded_by, uploaded_at, updated_at
      FROM nfse_certificates
      WHERE company_id = ${companyId}`;
    return rows[0] || null;
  }

  /**
   * Lê os metadados de dentro do .pfx.
   *
   * Senha errada e arquivo corrompido dão erros diferentes no forge, e a
   * distinção importa: uma é o usuário digitando errado, a outra é o arquivo.
   */
  extractCertInfo(pfxBuffer, password) {
    let pkcs12;
    try {
      // forge trabalha com string binária (latin1), não com Buffer.
      const p12Der = pfxBuffer.toString('binary');
      const p12Asn1 = forge.asn1.fromDer(p12Der);
      pkcs12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
    } catch (err) {
      const msg = String(err?.message || err);
      if (/MAC|password/i.test(msg)) {
        throw new Error('Senha do certificado incorreta');
      }
      throw new Error(`Arquivo .pfx inválido ou corrompido (${msg})`);
    }

    const certBags = pkcs12.getBags({ bagType: forge.pki.oids.certBag });
    const bags = certBags[forge.pki.oids.certBag];
    if (!bags || bags.length === 0) {
      throw new Error('Nenhum certificado encontrado no arquivo .pfx');
    }

    const cert = bags[0].cert;
    const subject = cert.subject.getField('CN')?.value || 'Desconhecido';

    return {
      // Thumbprint do ARQUIVO, não do certificado X.509: serve para reconhecer
      // que o mesmo .pfx foi reenviado, que é o uso que a tela faz dele.
      thumbprint: cryptoManager.generateThumbprint(pfxBuffer),
      subject,
      validFrom: cert.validity.notBefore,
      validUntil: cert.validity.notAfter,
    };
  }

  /**
   * Estado de validade do certificado da empresa.
   *
   * ⚠️ Não decifra o .pfx — as datas estão em claro no banco, e abrir a chave
   * privada para comparar dois timestamps a exporia à toa (o esboço original
   * chamava getCertificateFromDB aqui).
   *
   * ⚠️ Devolve `{ valid: false, reason }` em vez de lançar quando o certificado
   * está expirado ou ainda não vale. Lançar obrigaria quem chama a distinguir
   * "expirado" de "banco fora do ar" por texto de mensagem — e `days_remaining`
   * é justamente o que a tabela nfse_certificate_alerts precisa gravar.
   * Só a AUSÊNCIA de certificado continua sendo erro.
   */
  async validateCertificate(sql, companyId, now = new Date()) {
    const cert = await this.getCertificateStatus(sql, companyId);
    if (!cert) throw notFound(companyId);

    const validFrom = new Date(cert.certificate_valid_from);
    const validUntil = new Date(cert.certificate_valid_until);
    const daysRemaining = Math.floor((validUntil - now) / 86400000);

    const base = {
      subject: cert.certificate_subject,
      thumbprint: cert.certificate_thumbprint,
      validFrom,
      validUntil,
      daysRemaining,
    };

    if (now < validFrom) return { ...base, valid: false, reason: 'Certificado ainda não é válido' };
    if (now > validUntil) return { ...base, valid: false, reason: 'Certificado expirado' };
    return { ...base, valid: true, reason: null };
  }

  /** Remove o certificado da empresa. `false` = não havia nada para remover. */
  async deleteCertificate(sql, companyId) {
    const rows = await sql`
      DELETE FROM nfse_certificates WHERE company_id = ${companyId} RETURNING id`;
    return rows.length > 0;
  }
}

function notFound(companyId) {
  const err = new Error(`Certificado não encontrado para a empresa ${companyId}`);
  err.code = 'CERT_NOT_FOUND'; // quem chama responde 404 sem casar string
  return err;
}

export default new NFSeCertManager();
