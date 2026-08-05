import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'
import ExcelJS from 'exceljs'
import { breakdownFabricio } from '../lib/fabricio-breakdown.js'

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
const num = (v) => parseFloat(v) || 0

// emission_date chega como Date pelo driver e como string ISO pelo JSON. String(date)
// dá "Mon Feb 02 2026", cujo slice/split sai sem hífen e cai no fallback SEM ERRO —
// a visão fiscal ficaria idêntica à de competência. Mesmo tratamento de fiscalParts()
// em Financial.jsx.
function fiscalParts(d) {
  if (!d) return null
  if (d instanceof Date) return { m: d.getUTCMonth() + 1, y: d.getUTCFullYear() }
  const [y, m] = String(d).slice(0, 10).split('-').map(Number)
  return (y && m) ? { m, y } : null
}

// Mês/ano efetivos por visão — espelha effMonth/effYear de Financial.jsx, para que o
// Excel traga exatamente as linhas que estavam na tela.
function periodo(r, mode) {
  if (mode === 'caixa') return { m: r.payment_month ?? r.month, y: r.payment_year ?? r.year }
  if (mode === 'fiscal') {
    const f = fiscalParts(r.emission_date)
    return { m: f?.m ?? r.month, y: f?.y ?? r.year }
  }
  return { m: r.month, y: r.year }
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const src = req.method === 'POST' ? { ...req.query, ...(req.body || {}) } : req.query
  const { company_id, month, year, client_id } = src
  const mode = src.mode || 'competencia'
  const status = src.status || 'todos'
  if (!company_id || !year) return res.status(400).json({ error: 'company_id e year são obrigatórios' })

  const sql = neon(process.env.DATABASE_URL)

  // Na visão fiscal, a NF de dezembro é emitida em janeiro: a competência fica no ano
  // anterior e a linha sumiria se a janela fosse só `year`. Mesmo alargamento do GET.
  const anos = mode === 'fiscal' ? [Number(year) - 1, Number(year)] : [Number(year)]

  // Os filtros de mês/status/cliente/visão são aplicados em JS com a MESMA lógica da
  // tela (o agrupamento fiscal já é client-side lá), para o Excel trazer exatamente as
  // linhas que estavam à vista. Aqui só se recorta a janela de anos.
  const rows = mode === 'caixa'
    ? await sql`
        SELECT p.id, p.client_id, p.month, p.year, p.payment_month, p.payment_year,
               p.description, p.amount, p.paid_amount, p.paid_at, p.status, p.origin, p.invoice_id,
               cl.name AS client_name,
               i.billing_type, i.contract_value, i.invoice_value, i.tax_amount,
               i.victor_service, i.victor_profit, i.victor_tax_diff, i.fabricio_total,
               i.emission_date, i.invoice_number,
               COALESCE(c.remainder_fabricio_pct, fr.remainder_fabricio_pct) AS fab_pct,
               COALESCE(c.remainder_victor_pct,   fr.remainder_victor_pct)   AS victor_pct
        FROM payables_fabricio p
        LEFT JOIN clients  cl ON cl.id = p.client_id
        LEFT JOIN invoices i  ON i.id  = p.invoice_id
        LEFT JOIN contracts c ON c.id  = i.contract_id
        LEFT JOIN LATERAL (
          SELECT remainder_fabricio_pct, remainder_victor_pct
          FROM financial_rules WHERE client_id = p.client_id ORDER BY id LIMIT 1
        ) fr ON true
        WHERE p.company_id = ${company_id} AND p.payment_year = ${Number(year)}
        ORDER BY cl.name, p.year, p.month`
    : await sql`
        SELECT p.id, p.client_id, p.month, p.year, p.payment_month, p.payment_year,
               p.description, p.amount, p.paid_amount, p.paid_at, p.status, p.origin, p.invoice_id,
               cl.name AS client_name,
               i.billing_type, i.contract_value, i.invoice_value, i.tax_amount,
               i.victor_service, i.victor_profit, i.victor_tax_diff, i.fabricio_total,
               i.emission_date, i.invoice_number,
               COALESCE(c.remainder_fabricio_pct, fr.remainder_fabricio_pct) AS fab_pct,
               COALESCE(c.remainder_victor_pct,   fr.remainder_victor_pct)   AS victor_pct
        FROM payables_fabricio p
        LEFT JOIN clients  cl ON cl.id = p.client_id
        LEFT JOIN invoices i  ON i.id  = p.invoice_id
        LEFT JOIN contracts c ON c.id  = i.contract_id
        LEFT JOIN LATERAL (
          SELECT remainder_fabricio_pct, remainder_victor_pct
          FROM financial_rules WHERE client_id = p.client_id ORDER BY id LIMIT 1
        ) fr ON true
        WHERE p.company_id = ${company_id} AND p.year = ANY(${anos})
        ORDER BY cl.name, p.year, p.month`

  const filtradas = rows.filter(r => {
    const { m, y } = periodo(r, mode)
    if (Number(y) !== Number(year)) return false
    if (month !== undefined && month !== '' && month !== null && Number(m) !== Number(month)) return false
    if (client_id && String(r.client_id) !== String(client_id)) return false

    // Lançamentos zerados são ocultados nas abas de Pagar (Financial.jsx: nonZeroFiltered)
    // e ficam fora dos totais. São os clientes com split 100/0 — Bokada, Enpla, Minas,
    // ALEX —, cuja fatura não gera nada para o Fabrício. Sem este recorte o Excel trazia
    // 22 linhas onde a tela mostrava 8, e as 14 de R$ 0,00 faziam parecer que nenhum
    // filtro havia sido aplicado.
    if (!num(r.amount)) return false

    // Vocabulário da tela ('all'/'pendente_parcial') e o dos status reais, para o Excel
    // poder ser pedido com o filtro que estava selecionado.
    if (status === 'todos' || status === 'all') return true
    if (status === 'pendente_parcial') return r.status === 'pendente' || r.status === 'parcial'
    return r.status === status
  })

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Gestão Serv'
  const ws = wb.addWorksheet('Pagar Fabrício')

  const COLS = [
    { header: 'Cliente',            width: 22, key: 'cliente' },
    { header: 'Mês',                width: 10, key: 'mes' },
    { header: 'Tipo',               width: 18, key: 'tipo' },
    { header: 'NF',                 width: 12, key: 'nf' },
    { header: 'Faturamento Bruto',  width: 18, key: 'bruto',      money: true, total: true },
    { header: 'Imposto',            width: 13, key: 'imposto',    money: true, total: true },
    { header: 'Serviço Victor',     width: 16, key: 'servico',    money: true, total: true },
    { header: 'Deslocamento',       width: 15, key: 'desloc',     money: true, total: true },
    { header: 'Lucro a Dividir',    width: 16, key: 'lucro',      money: true, total: true },
    { header: 'Victor',             width: 13, key: 'victor',     money: true, total: true },
    { header: 'Fabrício',           width: 13, key: 'fabricio',   money: true, total: true },
    { header: '% Fab',              width: 8,  key: 'fabpct' },
    { header: 'Status',             width: 11, key: 'status' },
    { header: 'Pago',               width: 13, key: 'pago',       money: true, total: true },
    { header: 'Em aberto',          width: 13, key: 'aberto',     money: true, total: true },
  ]
  ws.columns = COLS.map(c => ({ width: c.width }))

  const MONEY = 'R$ #,##0.00'
  const BORDER = {
    top:    { style: 'thin', color: { argb: 'FFD9D9D9' } },
    left:   { style: 'thin', color: { argb: 'FFD9D9D9' } },
    bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
    right:  { style: 'thin', color: { argb: 'FFD9D9D9' } },
  }

  // Título + contexto da geração
  const VISAO = { competencia: 'competência', fiscal: 'data fiscal', caixa: 'caixa' }
  const STATUS_LABEL = { all: 'todos', todos: 'todos', pendente_parcial: 'pendente / parcial' }
  ws.mergeCells(1, 1, 1, COLS.length)
  const t = ws.getCell('A1')
  t.value = `Pagar Fabrício — ${month ? MESES[Number(month) - 1] + '/' : ''}${year}`
  t.font = { bold: true, size: 16 }
  t.alignment = { vertical: 'middle' }
  ws.getRow(1).height = 24

  ws.mergeCells(2, 1, 2, COLS.length)
  const sub = ws.getCell('A2')
  const geradoEm = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  sub.value = `Visão: ${VISAO[mode] || mode} · Status: ${STATUS_LABEL[status] || status} · Gerado em ${geradoEm}`
  sub.font = { size: 9, color: { argb: 'FF808080' } }

  // Cabeçalho
  const HEAD_ROW = 4
  const head = ws.getRow(HEAD_ROW)
  COLS.forEach((c, i) => {
    const cell = head.getCell(i + 1)
    cell.value = c.header
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }
    cell.alignment = { horizontal: c.money ? 'right' : 'center', vertical: 'middle', wrapText: true }
    cell.border = BORDER
  })
  head.height = 30

  let naoConferem = 0
  filtradas.forEach((r, idx) => {
    const b = breakdownFabricio(r)
    if (b && !b.confere) naoConferem++
    const { m, y } = periodo(r, mode)
    const total = num(r.amount)
    const pago = num(r.paid_amount)

    const values = [
      r.client_name || '—',
      `${MESES[Number(m) - 1]}/${y}`,
      b ? b.tipo_label : 'Lançamento manual',
      r.invoice_number || (r.invoice_id ? `#${r.invoice_id}` : '—'),
      b ? b.bruto : null,
      b ? b.imposto : null,
      b ? b.victor_servico : null,
      b ? b.deslocamento : null,
      b ? b.lucro_a_dividir : null,
      b ? b.victor_lucro : null,
      total,
      b ? `${b.fabricio_pct}%` : '—',
      r.status,
      pago,
      Math.max(total - pago, 0),
    ]

    const row = ws.getRow(HEAD_ROW + 1 + idx)
    values.forEach((v, i) => {
      const cell = row.getCell(i + 1)
      cell.value = v
      cell.font = { size: 10 }
      cell.border = BORDER
      if (COLS[i].money) {
        cell.numFmt = MONEY
        cell.alignment = { horizontal: 'right' }
      } else {
        cell.alignment = { horizontal: i === 0 ? 'left' : 'center' }
      }
    })
    // Linha cuja decomposição não fecha: marcada em vez de silenciada.
    if (b && !b.confere) {
      row.getCell(11).font = { size: 10, bold: true, color: { argb: 'FFC00000' } }
    }
  })

  // Totais
  const TOT_ROW = HEAD_ROW + 1 + filtradas.length
  const tot = ws.getRow(TOT_ROW)
  COLS.forEach((c, i) => {
    const cell = tot.getCell(i + 1)
    if (i === 0) cell.value = `TOTAL (${filtradas.length} lançamento${filtradas.length === 1 ? '' : 's'})`
    else if (c.total && filtradas.length) {
      const col = String.fromCharCode(65 + i)
      cell.value = { formula: `SUM(${col}${HEAD_ROW + 1}:${col}${TOT_ROW - 1})` }
      cell.numFmt = MONEY
    }
    cell.font = { bold: true, size: 10 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEDED' } }
    cell.alignment = { horizontal: c.money ? 'right' : i === 0 ? 'left' : 'center' }
    cell.border = { ...BORDER, top: { style: 'medium', color: { argb: 'FF4472C4' } } }
  })

  // Nota de rodapé: o que a cascata significa, para a planilha se explicar fora da tela.
  const notaRow = TOT_ROW + 2
  ws.mergeCells(notaRow, 1, notaRow, COLS.length)
  const nota = ws.getCell(notaRow, 1)
  nota.value = 'Por hora (agenda): Bruto − Imposto − Serviço Victor − Deslocamento = Lucro a Dividir. '
    + 'Contrato fixo: Bruto − Serviço Victor = Lucro a Dividir (o imposto sai da parte do Victor, não do split). '
    + 'Deslocamento é 100% Victor e fica fora da divisão.'
  nota.font = { size: 9, italic: true, color: { argb: 'FF808080' } }
  nota.alignment = { wrapText: true, vertical: 'top' }
  ws.getRow(notaRow).height = 28

  if (naoConferem > 0) {
    const alertaRow = notaRow + 1
    ws.mergeCells(alertaRow, 1, alertaRow, COLS.length)
    const al = ws.getCell(alertaRow, 1)
    al.value = `⚠️ ${naoConferem} lançamento(s) com decomposição fora da tolerância de R$ 0,05 — destacados em vermelho.`
    al.font = { size: 9, bold: true, color: { argb: 'FFC00000' } }
  }

  ws.views = [{ state: 'frozen', ySplit: HEAD_ROW }]
  ws.autoFilter = { from: { row: HEAD_ROW, column: 1 }, to: { row: TOT_ROW - 1, column: COLS.length } }

  const monthsShort = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']
  const fileName = `pagar_fabricio_${month ? monthsShort[Number(month) - 1] + '_' : ''}${year}.xlsx`

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
  const buffer = await wb.xlsx.writeBuffer()
  return res.status(200).send(Buffer.from(buffer))
}
