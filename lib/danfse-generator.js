import PDFDocument from 'pdfkit'

// DANFSE — o comprovante visual da NFS-e.
//
// ⚠️ Nada aqui é inventado. Campo ausente vira "—", nunca um valor plausível.
// O esboço imprimia `inscricaoMunicipal: '123456'`, `logradouro: 'Rua Test'`,
// `uf: 'PR'` e `aliquota: 6.0` fixos: o PDF sairia bonito, consistente e
// mentindo — e é ele que vai anexado ao e-mail do cliente.
//
// ⚠️ O `const table = { rows: [ ... }` do esboço fecha o array com `}`. É erro
// de sintaxe: o módulo inteiro não carrega. O gerador nunca chegou a rodar.

const MARGEM = 36
const LARGURA = 595.28 - MARGEM * 2 // A4 retrato

const brl = (v) =>
  v === null || v === undefined || !Number.isFinite(Number(v))
    ? '—'
    : `R$ ${Number(v).toFixed(2).replace('.', ',')}`

const ou = (v, alt = '—') => (v === null || v === undefined || String(v).trim() === '' ? alt : String(v))

export function formatarDocumento(doc) {
  const d = String(doc ?? '').replace(/\D/g, '')
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  return d || '—'
}

export function formatarCEP(cep) {
  const d = String(cep ?? '').replace(/\D/g, '')
  // ⚠️ Sem checar o tamanho, `substring` devolve "-" para campo vazio e
  // "123-" para lixo. O esboço fazia isso direto, e chamava `.replace` num
  // valor que podia ser null — quebrando a geração inteira do PDF.
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : d || '—'
}

export function formatarData(data) {
  if (!data) return '—'
  const d = data instanceof Date ? data : new Date(data)
  if (Number.isNaN(d.getTime())) return '—'
  const sp = new Date(d.getTime() - 3 * 3600 * 1000)
  const [a, m, dia] = sp.toISOString().slice(0, 10).split('-')
  return `${dia}/${m}/${a}`
}

/** AAAA-MM-DD → MM/AAAA, sem passar por Date (evita o desvio de fuso). */
export function formatarCompetencia(comp) {
  const s = String(comp ?? '')
  const m = s.match(/^(\d{4})-(\d{2})/)
  return m ? `${m[2]}/${m[1]}` : ou(comp)
}

export class DANFSEGenerator {
  /**
   * @param {object} nfse dados normalizados (ver lib/nfse-xml-parser.js)
   */
  constructor(nfse) {
    this.nfse = nfse || {}
  }

  /**
   * Gera o PDF completo.
   *
   * ⚠️ Devolve uma Promise de Buffer, não um stream. Numa função serverless o
   * `pipe(res)` do esboço pode ser cortado quando o handler retorna antes de o
   * stream terminar — o cliente recebe um PDF truncado, que abre com erro. Com
   * o buffer pronto dá para mandar Content-Length e responder de uma vez.
   */
  gerarPDF({ compress = true } = {}) {
    return new Promise((resolve, reject) => {
      // `compress: false` existe para o teste conseguir LER o texto gerado.
      // Verificar só o cabeçalho %PDF aprovaria um documento inteiro escrito
      // com "undefined".
      const doc = new PDFDocument({
        size: 'A4', margin: MARGEM, compress, info: { Title: this.tituloArquivo() },
      })
      const partes = []
      doc.on('data', (p) => partes.push(p))
      doc.on('end', () => resolve(Buffer.concat(partes)))
      doc.on('error', reject)

      try {
        this.cabecalho(doc)
        this.secaoPessoa(doc, 'PRESTADOR DO SERVIÇO', this.nfse.prestador)
        this.secaoPessoa(doc, 'TOMADOR DO SERVIÇO', this.nfse.tomador)
        this.secaoServico(doc)
        this.secaoValores(doc)
        this.rodape(doc)
        doc.end()
      } catch (err) {
        reject(err)
      }
    })
  }

  tituloArquivo() {
    const n = this.nfse.numeroNfse || this.nfse.numeroDps || 's-n'
    return `DANFSE ${n}`
  }

  linha(doc) {
    doc.moveTo(MARGEM, doc.y).lineTo(MARGEM + LARGURA, doc.y).stroke('#999999')
    doc.moveDown(0.6)
  }

  titulo(doc, texto) {
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000').text(texto)
    doc.moveDown(0.2)
    doc.fontSize(8).font('Helvetica')
  }

  campo(doc, rotulo, valor) {
    doc.font('Helvetica-Bold').text(`${rotulo}: `, { continued: true })
    doc.font('Helvetica').text(ou(valor))
  }

  cabecalho(doc) {
    doc.fontSize(15).font('Helvetica-Bold').text('DANFSE', { align: 'center' })
    doc.fontSize(8).font('Helvetica')
      .text('Documento Auxiliar da Nota Fiscal de Serviço Eletrônica', { align: 'center' })
    doc.moveDown(0.4)

    const n = this.nfse.numeroNfse
    doc.fontSize(12).font('Helvetica-Bold')
      // Sem número da NFS-e ainda (nota enviada e não processada) o PDF diz
      // isso. "NFS-e nº undefined", do esboço, se lê como bug do sistema.
      .text(n ? `NFS-e nº ${n}` : 'NFS-e — número ainda não atribuído', { align: 'center' })

    doc.fontSize(8).font('Helvetica').text(
      `Série ${ou(this.nfse.serie, '—')}  ·  DPS nº ${ou(this.nfse.numeroDps)}  ·  ` +
      `Emissão ${formatarData(this.nfse.dataEmissao)}  ·  Competência ${formatarCompetencia(this.nfse.competencia)}`,
      { align: 'center' }
    )
    if (this.nfse.nsu || this.nfse.protocolo) {
      doc.fontSize(7).text(
        `NSU ${ou(this.nfse.nsu)}  ·  Protocolo ${ou(this.nfse.protocolo)}`, { align: 'center' }
      )
    }

    // Ambiente 2 = homologação: o documento NÃO tem valor fiscal. Sem esta
    // tarja, um PDF de teste é indistinguível de uma nota real.
    if (this.nfse.ambiente === 2) {
      doc.moveDown(0.4)
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#B45309')
        .text('AMBIENTE DE HOMOLOGAÇÃO — SEM VALOR FISCAL', { align: 'center' })
      doc.fillColor('#000000')
    }

    doc.moveDown(0.6)
    this.linha(doc)
  }

  secaoPessoa(doc, rotulo, p) {
    const pes = p || {}
    const end = pes.endereco || {}
    const tipoDoc = pes.documento?.tipo || 'CNPJ/CPF'

    this.titulo(doc, rotulo)
    this.campo(doc, 'Razão social', pes.razaoSocial)
    this.campo(doc, tipoDoc, formatarDocumento(pes.documento?.valor))
    if (pes.inscricaoMunicipal) this.campo(doc, 'Inscrição municipal', pes.inscricaoMunicipal)

    const rua = [ou(end.logradouro), end.numero ? `nº ${end.numero}` : null, end.complemento]
      .filter(Boolean).join(', ')
    this.campo(doc, 'Endereço', rua)
    this.campo(doc, 'Bairro', end.bairro)
    this.campo(doc, 'Município (IBGE)', end.municipioCodigo)
    this.campo(doc, 'CEP', formatarCEP(end.cep))
    if (pes.email) this.campo(doc, 'E-mail', pes.email)
    if (pes.telefone) this.campo(doc, 'Telefone', pes.telefone)

    doc.moveDown(0.5)
    this.linha(doc)
  }

  secaoServico(doc) {
    const s = this.nfse.servico || {}
    this.titulo(doc, 'SERVIÇO PRESTADO')
    this.campo(doc, 'Descrição', s.descricao)
    this.campo(doc, 'Item da lista de serviços', s.itemListaServico)
    if (s.codigoTributacaoMunicipal) this.campo(doc, 'Código de tributação municipal', s.codigoTributacaoMunicipal)
    if (s.nbs) this.campo(doc, 'NBS', s.nbs)
    this.campo(doc, 'Município da prestação (IBGE)', s.municipioPrestacao)
    doc.moveDown(0.5)
    this.linha(doc)
  }

  secaoValores(doc) {
    const v = this.nfse.valores || {}
    this.titulo(doc, 'VALORES')

    const colRotulo = MARGEM
    const colValor = MARGEM + LARGURA - 140
    const linhas = [
      ['Valor do serviço', brl(v.servico)],
      // Vírgula decimal, como nos valores em reais logo ao lado — "2.00%" ao
      // lado de "R$ 340,00" se lê como dois documentos diferentes.
      ['Alíquota do ISS', v.aliquotaIss == null ? '—' : `${Number(v.aliquotaIss).toFixed(2).replace('.', ',')}%`],
      // ⚠️ Não há "deduções" nem "valor líquido" na DPS emitida. O esboço
      // imprimia ambos — deduções sempre R$ 0,00 e líquido = bruto − ISS — como
      // se fossem declarados. O ISS aqui é DERIVADO da alíquota e vai rotulado
      // como tal: quem apura o imposto é o município.
      ['ISS (calculado sobre a alíquota)', brl(v.iss)],
    ]

    let y = doc.y
    doc.fontSize(8)
    for (const [rot, val] of linhas) {
      doc.font('Helvetica').text(rot, colRotulo, y, { width: LARGURA - 150 })
      doc.font('Helvetica-Bold').text(val, colValor, y, { width: 140, align: 'right' })
      y += 14
    }
    doc.y = y
    doc.moveDown(0.4)

    doc.font('Helvetica-Bold').fontSize(11).text('TOTAL DO SERVIÇO', colRotulo, doc.y, { width: LARGURA - 150, continued: false })
    doc.font('Helvetica-Bold').fontSize(11).text(brl(v.servico), colValor, doc.y - 13, { width: 140, align: 'right' })
    doc.fontSize(8).font('Helvetica')
    doc.moveDown(1)
    this.linha(doc)
  }

  rodape(doc) {
    doc.fontSize(7).font('Helvetica').fillColor('#444444').text(
      'Este documento é auxiliar do documento fiscal eletrônico. A autenticidade, a chave de acesso e ' +
      'as demais informações da NFS-e podem ser consultadas no Portal Nacional da NFS-e: www.nfse.gov.br',
      { align: 'center', width: LARGURA }
    )
    doc.moveDown(0.5)

    // ⚠️ Não há QR Code. O esboço escrevia "QR Code Chave de Acesso: <nsu>" em
    // TEXTO — não é QR code, e NSU não é chave de acesso. O QR do padrão
    // nacional é gerado sobre a chave de 50 dígitos que o ADN devolve na
    // autorização; enquanto ela não existir no banco, o campo diz o que tem.
    doc.fillColor('#000000').fontSize(8).font('Helvetica-Bold')
      .text(`Chave de acesso: ${ou(this.nfse.chaveAcesso, 'não disponível')}`, { align: 'center' })
    doc.fontSize(7).font('Helvetica').fillColor('#666666')
      .text(`Identificador da DPS: ${ou(this.nfse.id)}`, { align: 'center' })
      .text(this.nfse.assinado ? 'XML assinado digitalmente' : 'XML sem assinatura', { align: 'center' })
    doc.fillColor('#000000')
  }
}

export default DANFSEGenerator
