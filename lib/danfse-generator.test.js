// Roda com: node lib/danfse-generator.test.js
//
// ⚠️ O teste do esboço não podia falhar: o `try/catch` só pega erro síncrono,
// enquanto a escrita do PDF acontece no callback de 'end' — e ele não esperava
// nada antes de terminar. Também gravava em `/tmp`, que no Windows não existe.
import 'dotenv/config'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-16-chars'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import forge from 'node-forge'
import { neon } from '@neondatabase/serverless'
import { signToken } from './auth.js'
import { montarDPS } from './nfse-xml-builder.js'
import { NFSeSigner } from './nfse-signer.js'
import { lerDPS } from './nfse-xml-parser.js'
import {
  DANFSEGenerator, formatarDocumento, formatarCEP, formatarData, formatarCompetencia,
} from './danfse-generator.js'
import listar from '../api/nfse-list.js'
import baixarXml from '../api/nfse-download-xml.js'
import baixarPdf from '../api/nfse-download-danfse.js'

let falhas = 0
const ok = (cond, msg) => {
  console.log(`  ${cond ? '✅' : '❌'} ${msg}`)
  if (!cond) falhas++
  return cond
}

const EMPRESA = 1
const INVOICE = 37

// ---------------------------------------------------------------------------
console.log('🧪 TESTE 1: formatadores não quebram com entrada ruim')
ok(formatarDocumento('12345678000190') === '12.345.678/0001-90', 'CNPJ formatado')
ok(formatarDocumento('12345678909') === '123.456.789-09', 'CPF formatado')
// ⚠️ O esboço fazia `cnpj.replace(...)` direto: null derruba a geração inteira.
ok(formatarDocumento(null) === '—', 'documento nulo → "—" (não estoura)')
ok(formatarDocumento('123') === '123', 'documento de tamanho inesperado sai cru, sem máscara falsa')
ok(formatarCEP('01001000') === '01001-000', 'CEP formatado')
ok(formatarCEP(null) === '—' && formatarCEP('123') === '123', 'CEP inválido não vira "-" nem "123-"')
ok(formatarData(null) === '—' && formatarData('lixo') === '—', 'data inválida → "—" (não "Invalid Date")')
ok(formatarData('2026-08-10T03:00:00.000Z') === '10/08/2026', 'data de coluna date sai no dia certo')
ok(formatarCompetencia('2026-08-01') === '08/2026', 'competência MM/AAAA sem passar por Date')

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 2: parser lê de volta a DPS assinada')
const dados = {
  ambiente: 2, serie: '00001', nDPS: 3, dataEmissao: new Date('2026-08-18T13:00:00Z'),
  emitente: {
    cnpj: '12345678000190', inscricaoMunicipal: '987654', razaoSocial: 'LUMEN DEV LTDA',
    municipioCodigo: '3550308',
    endereco: { logradouro: 'Rua das Flores', numero: '100', bairro: 'Centro', cep: '01001000', uf: 'SP' },
    email: 'victor@lumendev.com.br', optaSimples: 3, regimeEspecial: 0,
  },
  tomador: {
    documento: '98765432000110', razaoSocial: 'BOKADA COMERCIO LTDA',
    endereco: { logradouro: 'Av. Brasil', numero: '456', bairro: 'Vila', cep: '87123456', municipioCodigo: '4106902', uf: 'PR' },
  },
  servico: {
    descricao: 'Consultoria em TI', itemListaServico: '01.06',
    municipioPrestacao: '3550308', competencia: '2026-08-01',
  },
  valores: { servico: 340, aliquotaIss: 2 },
}
const xml = montarDPS(dados)

const keys = forge.pki.rsa.generateKeyPair(1024)
const cert = forge.pki.createCertificate()
cert.publicKey = keys.publicKey
cert.serialNumber = '01'
cert.validity.notBefore = new Date(Date.now() - 86400000)
cert.validity.notAfter = new Date(Date.now() + 90 * 86400000)
const at = [{ name: 'commonName', value: 'LUMEN DEV LTDA' }]
cert.setSubject(at); cert.setIssuer(at); cert.sign(keys.privateKey)
const SENHA = 'p@ss'
const pfx = Buffer.from(
  forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, cert, SENHA, { algorithm: '3des' })).getBytes(),
  'binary'
)
const xmlAssinado = new NFSeSigner(pfx, SENHA).assinarXML(xml)

const dps = lerDPS(xmlAssinado)
ok(dps !== null, 'DPS assinada foi lida')
// ⚠️ A DPS NÃO carrega a razão social do prestador (E0121). Ela só aparece
// no <emit> da nota AUTORIZADA, preenchido pelo cadastro nacional.
ok(dps.prestador.razaoSocial === null, 'DPS não traz razão social do prestador')
ok(dps.autorizada === false, 'DPS pura não é nota autorizada')
ok(dps.prestador.documento.tipo === 'CNPJ', 'tipo de documento identificado')
ok(dps.tomador.endereco.municipioCodigo === '4106902', 'município do tomador')
ok(dps.valores.servico === 340, 'valor do serviço lido')
// Sem pAliq na DPS, não há ISS a derivar — e imprimir R$ 0,00 afirmaria isenção.
ok(dps.valores.aliquotaIss === null && dps.valores.iss === null,
  'sem alíquota na DPS, ISS fica nulo (não zero)')
ok(dps.competencia === '2026-08-01', 'competência preservada')
ok(dps.assinado === true, 'assinatura detectada')
ok(lerDPS('<html>não é dps</html>') === null, 'XML que não é DPS → null (não estoura)')
ok(lerDPS(null) === null, 'entrada nula → null')

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 3: PDF com o conteúdo certo')
const pdf = await new DANFSEGenerator({
  ...dps, numeroNfse: 12345, nsu: 'abc-123', protocolo: 'proto-9', chaveAcesso: null,
}).gerarPDF({ compress: false })

ok(pdf.slice(0, 5).toString() === '%PDF-', 'começa com %PDF-')
ok(pdf.slice(-6).toString().includes('%%EOF'), 'termina com %%EOF (PDF completo, não truncado)')
ok(pdf.length > 2000, `tamanho plausível: ${pdf.length} bytes`)

// Conteúdo: verificar só o cabeçalho aprovaria um PDF cheio de "undefined".
//
// ⚠️ O texto NÃO está legível no buffer. O pdfkit escreve cada trecho como
// string hexadecimal e ainda a quebra em pedaços para aplicar kerning —
// "DANFSE" sai como `[<44> 40 <414e465345>] TJ`. Procurar a palavra no buffer
// cru dá sempre falso, inclusive quando o PDF está perfeito. Aqui os grupos
// hex são decodificados e emendados, o que também remonta as palavras
// partidas pelo kerning.
function textoDoPdf(buffer) {
  return buffer
    .toString('latin1')
    .match(/<([0-9a-fA-F]+)>/g)
    ?.map((h) => Buffer.from(h.slice(1, -1), 'hex').toString('latin1'))
    .join('') ?? ''
}
const texto = textoDoPdf(pdf)
const contem = (s) => texto.includes(s)
// A nota autorizada traz <emit>; o parser o prefere e o PDF mostra o nome.
const xmlAutorizado = xmlAssinado.replace('<prest>',
  '<emit><CNPJ>12345678000190</CNPJ><xNome>LUMEN DEV LTDA</xNome>'
  + '<enderNac><xLgr>RUA X</xLgr><nro>1</nro><xBairro>CENTRO</xBairro>'
  + '<cMun>3550308</cMun><UF>SP</UF><CEP>01001000</CEP></enderNac></emit><prest>')
const dpsAut = lerDPS(xmlAutorizado)
ok(dpsAut.autorizada === true, 'nota com <emit> é reconhecida como autorizada')
ok(dpsAut.prestador.razaoSocial === 'LUMEN DEV LTDA',
  'prestador vem do <emit> da nota autorizada')
const textoAut = textoDoPdf(await new DANFSEGenerator({ ...dpsAut, numeroNfse: 7 })
  .gerarPDF({ compress: false }))
ok(textoAut.includes('LUMEN DEV LTDA'), 'PDF da nota autorizada imprime o prestador')
ok(contem('BOKADA COMERCIO LTDA'), 'imprime o tomador')
ok(contem('12.345.678/0001-90'), 'CNPJ com máscara')
ok(contem('340,00'), 'valor do serviço em reais')
ok(contem('08/2026'), 'competência')
ok(contem('HOMOLOGA'), 'tarja de homologação presente (ambiente 2)')
ok(!/undefined|NaN|\[object Object\]/.test(texto), 'nenhum "undefined"/"NaN" impresso')
// Só 'Rua Test': o texto extraído vem sem separador entre os trechos, então
// procurar por '123456' casaria por acidente na emenda de dois números.
ok(!contem('Rua Test'), 'nenhum endereço inventado do esboço')

const comChave = textoDoPdf(
  await new DANFSEGenerator({ ...dps, numeroNfse: 1, chaveAcesso: 'CHAVE-TESTE' })
    .gerarPDF({ compress: false })
)
ok(comChave.includes('CHAVE-TESTE'), 'chave de acesso impressa quando existe')
ok(contem('não disponível'), 'sem chave, o rodapé diz isso (não imprime NSU como se fosse a chave)')

// produção não leva tarja
const pdfProd = await new DANFSEGenerator({ ...dps, ambiente: 1, numeroNfse: 1 }).gerarPDF({ compress: false })
ok(!textoDoPdf(pdfProd).includes('HOMOLOGA'), 'ambiente 1 não leva tarja de homologação')

// ⚠️ o caso que mais importa: dados faltando não podem derrubar a geração
const pdfVazio = await new DANFSEGenerator({}).gerarPDF({ compress: false })
ok(pdfVazio.slice(0, 5).toString() === '%PDF-', 'gera PDF mesmo sem dado nenhum')
ok(textoDoPdf(pdfVazio).includes('número ainda não atribuído'),
  'sem número da nota, o PDF diz isso em vez de "NFS-e nº undefined"')

const destino = path.join(os.tmpdir(), 'danfse-teste.pdf')
fs.writeFileSync(destino, pdf)
console.log(`     PDF de amostra: ${destino}`)

// ---------------------------------------------------------------------------
console.log('\n🧪 TESTE 4: endpoints')
const sql = neon(process.env.DATABASE_URL)
const token = signToken({ sub: '1', username: 'teste', master: true })
const chamar = async (handler, query, auth = true, method = 'GET') => {
  const res = {
    code: 0, body: null, headers: {}, buffer: null,
    status(c) { this.code = c; return this },
    json(b) { this.body = b; return this },
    send(b) { this.buffer = b; return this },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this },
  }
  await handler({ method, query, headers: auth ? { authorization: `Bearer ${token}` } : {} }, res)
  return res
}

ok((await chamar(listar, { company_id: 1 }, false)).code === 401, 'nfse-list sem token → 401')
ok((await chamar(listar, {})).code === 400, 'nfse-list sem company_id → 400')
// ⚠️ o esboço faria `WHERE company_id = NaN`, que é erro de SQL, não lista vazia
ok((await chamar(listar, { company_id: 'abc' })).code === 400, 'company_id não numérico → 400')
ok((await chamar(listar, { company_id: 1 }, true, 'POST')).code === 405, 'POST → 405')
ok((await chamar(baixarXml, { emission_id: 'x' })).code === 400, 'download sem id válido → 400')
ok((await chamar(baixarXml, { emission_id: 999999 })).code === 404, 'emissão inexistente → 404')
ok((await chamar(baixarPdf, { emission_id: 999999 })).code === 404, 'DANFSE de emissão inexistente → 404')

const jaTem = await sql`SELECT id FROM nfse_emissions WHERE invoice_id = ${INVOICE}`
if (jaTem.length) {
  console.log(`  ⏭️  PULADO: já existe emissão para a fatura ${INVOICE} — não será tocada`)
} else {
  let criada = null
  try {
    ;[criada] = await sql`
      INSERT INTO nfse_emissions
        (company_id, invoice_id, nsu, protocol, nfse_number, status, dps_number,
         xml_assinado, json_response, competencia, valor_servico, municipio_codigo,
         ambiente, submitted_at)
      VALUES (${EMPRESA}, ${INVOICE}, 'nsu-teste', 'proto-teste', 4242, 'enviada', 3,
              ${xmlAssinado}, ${JSON.stringify({ chaveAcesso: 'CHAVE-TESTE' })},
              '2026-08-01', 340, '3550308', 2, NOW())
      RETURNING id`

    const lista = await chamar(listar, { company_id: EMPRESA })
    ok(lista.code === 200 && lista.body.emissions.length >= 1, 'nfse-list devolve a emissão')
    const item = lista.body.emissions.find((e) => e.id === criada.id)
    ok(item?.valor === 340, `valor numérico (não string): ${JSON.stringify(item?.valor)}`)
    ok(item?.temXml === true, 'sinaliza que há XML para baixar')
    ok(item?.status === 'enviada', 'status é o vocabulário real gravado pela emissão')
    ok(typeof lista.body.pagination.total === 'number', 'total é número, não string do COUNT')

    const semNada = await chamar(listar, { company_id: EMPRESA, invoice_id: 999999 })
    ok(semNada.code === 200 && semNada.body.emissions.length === 0, 'filtro por invoice_id funciona')

    // ⚠️ Esta emissão de teste tem só a DPS (xml_assinado), sem o XML oficial.
    // O download padrão entrega a NOTA — e, não a tendo, RECUSA em vez de
    // devolver a DPS disfarçada de nota.
    const semOficial = await chamar(baixarXml, { emission_id: criada.id })
    ok(semOficial.code === 404, 'sem XML oficial, o download padrão recusa')
    ok(semOficial.body?.tem_dps === true, 'e informa que a DPS existe')

    const rx = await chamar(baixarXml, { emission_id: criada.id, tipo: 'dps' })
    ok(rx.code === 200, 'download da DPS → 200')
    ok(rx.headers['content-type']?.includes('application/xml'), 'Content-Type de XML')
    ok(rx.headers['x-nfse-tipo'] === 'dps', 'cabeçalho diz que é a DPS, não a nota')
    ok(/attachment; filename="DPS_4242\.xml"/.test(rx.headers['content-disposition']),
      `nome do arquivo: ${rx.headers['content-disposition']}`)
    ok(rx.buffer === xmlAssinado, 'devolve exatamente o XML gravado')

    const rp = await chamar(baixarPdf, { emission_id: criada.id })
    ok(rp.code === 200, 'download DANFSE → 200')
    ok(rp.headers['content-type'] === 'application/pdf', 'Content-Type de PDF')
    ok(Buffer.isBuffer(rp.buffer) && rp.buffer.slice(0, 5).toString() === '%PDF-', 'corpo é um PDF')
    ok(rp.headers['content-length'] === rp.buffer.length, 'Content-Length bate com o corpo')
    // json_response é JSONB: o driver devolve objeto. O JSON.parse do esboço
    // estouraria com SyntaxError exatamente aqui.
    // ⚠️ O PDF do endpoint sai COMPRIMIDO, então textoDoPdf não o lê — a
    // conferência de conteúdo é a do teste 3, sem compressão. Aqui o que
    // importa é que o handler atravessou `json_response` (JSONB → objeto) sem
    // estourar: o `JSON.parse(objeto)` do esboço daria SyntaxError e 500.
    ok(rp.buffer.slice(-6).toString().includes('%%EOF'), 'PDF do endpoint está completo')

    await sql`UPDATE nfse_emissions SET xml_assinado = NULL WHERE id = ${criada.id}`
    const semXml = await chamar(baixarPdf, { emission_id: criada.id })
    ok(semXml.code === 404 && /não tem XML/.test(semXml.body.error),
      'emissão sem XML → 404 explicando, não 500')
  } finally {
    if (criada) await sql`DELETE FROM nfse_emissions WHERE id = ${criada.id}`
    const sobrou = await sql`SELECT count(*)::int n FROM nfse_emissions WHERE invoice_id = ${INVOICE}`
    ok(sobrou[0].n === 0, 'banco restaurado ao estado original')
  }
}

// ---------------------------------------------------------------------------
if (falhas > 0) {
  console.error(`\n❌ ${falhas} VERIFICAÇÃO(ÕES) FALHARAM!`)
  process.exit(1)
}
console.log('\n✅ TODOS OS TESTES PASSARAM!')
