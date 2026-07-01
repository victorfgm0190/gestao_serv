import { neon } from '@neondatabase/serverless'
import ExcelJS from 'exceljs'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { company_id, month, year, client_id } = req.query
  if (!company_id || !month || !year) return res.status(400).json({ error: 'company_id, month e year são obrigatórios' })

  const sql = neon(process.env.DATABASE_URL)

  const entries = client_id
    ? await sql`
        SELECT te.*, c.name as client_name
        FROM time_entries te
        LEFT JOIN clients c ON c.id = te.client_id
        WHERE te.company_id = ${company_id}
          AND EXTRACT(MONTH FROM te.entry_date) = ${month}
          AND EXTRACT(YEAR FROM te.entry_date) = ${year}
          AND te.client_id = ${client_id}
        ORDER BY te.entry_date ASC
      `
    : await sql`
        SELECT te.*, c.name as client_name
        FROM time_entries te
        LEFT JOIN clients c ON c.id = te.client_id
        WHERE te.company_id = ${company_id}
          AND EXTRACT(MONTH FROM te.entry_date) = ${month}
          AND EXTRACT(YEAR FROM te.entry_date) = ${year}
        ORDER BY te.entry_date ASC
      `

  const monthNames = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO']
  const monthName = monthNames[parseInt(month) - 1]

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Gestão Serv'
  const ws = wb.addWorksheet('Planilha1')

  // Larguras das colunas
  ws.columns = [
    { key: 'A', width: 8.5 },
    { key: 'B', width: 10.5 },
    { key: 'C', width: 12 },
    { key: 'D', width: 52 },
    { key: 'E', width: 12 },
    { key: 'F', width: 8 },
    { key: 'G', width: 8 },
    { key: 'H', width: 11 },
    { key: 'I', width: 14 },
  ]

  // Merge título A1:H3
  ws.mergeCells('A1:H3')
  ws.mergeCells('I1:I3')

  // Título
  const titleCell = ws.getCell('A1')
  titleCell.value = `Ordens de Serviço - ${monthName} ${year}`
  titleCell.font = { name: 'Aptos Narrow', bold: true, size: 26 }
  titleCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: false }

  // Total acumulado no I1
  const totalCell = ws.getCell('I1')
  totalCell.value = { formula: 'SUBTOTAL(9,I5:I1048576)' }
  totalCell.numFmt = '[h]:mm:ss'
  totalCell.font = { name: 'Aptos Narrow', bold: true, size: 11 }
  totalCell.alignment = { horizontal: 'center', vertical: 'middle' }

  // Altura das linhas 1-3
  ws.getRow(1).height = 28.8
  ws.getRow(2).height = 28.8
  ws.getRow(3).height = 28.8

  // Merge F4:G4 (INTERVALO)
  ws.mergeCells('F4:G4')

  // Cabeçalho linha 4
  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } }
  const headerFont = { name: 'Aptos Narrow', bold: true, size: 11 }
  const headerAlign = { horizontal: 'center', vertical: 'middle', wrapText: false }
  const headers = [
    { col: 'A', label: 'TECNICO' },
    { col: 'B', label: 'DATA' },
    { col: 'C', label: 'CLIENTE' },
    { col: 'D', label: 'ATIVIDADES' },
    { col: 'E', label: 'HORAINICIAL' },
    { col: 'F', label: 'INTERVALO' },
    { col: 'H', label: 'HORAFINAL' },
    { col: 'I', label: 'TOTAL' },
  ]
  // Preenche fill em todas as células do cabeçalho (A-I)
  for (let c = 1; c <= 9; c++) {
    const cell = ws.getCell(4, c)
    cell.fill = headerFill
    cell.font = headerFont
    cell.alignment = headerAlign
  }
  headers.forEach(({ col, label }) => {
    ws.getCell(`${col}4`).value = label
  })
  ws.getRow(4).height = 28.8

  // Dados a partir da linha 5
  const dataFont = { name: 'Aptos Narrow', size: 11 }
  const centerAlign = { horizontal: 'center', vertical: 'middle', wrapText: true }
  const leftAlign = { horizontal: 'left', vertical: 'middle', wrapText: true }

  function timeStrToExcel(timeStr) {
    if (!timeStr) return null
    const [h, m] = timeStr.split(':').map(Number)
    return (h * 3600 + m * 60) / 86400
  }

  // Minutos desde 00:00 (aceita HH:MM ou HH:MM:SS)
  function timeToMinutes(t) {
    if (!t) return 0
    const [h, m, s] = t.split(':').map(Number)
    return h * 60 + m + (s || 0) / 60
  }

  entries.forEach((entry, idx) => {
    const rowNum = 5 + idx
    const row = ws.getRow(rowNum)
    row.height = 40

    // TECNICO
    const aCell = ws.getCell(rowNum, 1)
    aCell.value = 'VICTOR'
    aCell.font = dataFont
    aCell.alignment = centerAlign

    // DATA
    const bCell = ws.getCell(rowNum, 2)
    const entryDate = entry.entry_date ? new Date(entry.entry_date) : null
    if (entryDate) {
      bCell.value = new Date(entryDate.getTime() + entryDate.getTimezoneOffset() * 60000)
      bCell.numFmt = 'DD/MM/YYYY'
    }
    bCell.font = dataFont
    bCell.alignment = centerAlign

    // CLIENTE
    const cCell = ws.getCell(rowNum, 3)
    cCell.value = entry.client_name || ''
    cCell.font = dataFont
    cCell.alignment = centerAlign

    // ATIVIDADES
    const dCell = ws.getCell(rowNum, 4)
    dCell.value = entry.description || ''
    dCell.font = dataFont
    dCell.alignment = leftAlign

    // HORAINICIAL
    const eCell = ws.getCell(rowNum, 5)
    eCell.value = timeStrToExcel(entry.hora_inicial)
    eCell.numFmt = 'HH:MM:SS'
    eCell.font = dataFont
    eCell.alignment = centerAlign

    // INTERVALO início
    const fCell = ws.getCell(rowNum, 6)
    fCell.value = timeStrToExcel(entry.intervalo_inicio)
    fCell.numFmt = 'HH:MM:SS'
    fCell.font = dataFont
    fCell.alignment = centerAlign

    // INTERVALO fim
    const gCell = ws.getCell(rowNum, 7)
    gCell.value = timeStrToExcel(entry.intervalo_fim)
    gCell.numFmt = 'HH:MM:SS'
    gCell.font = dataFont
    gCell.alignment = centerAlign

    // HORAFINAL
    const hCell = ws.getCell(rowNum, 8)
    hCell.value = timeStrToExcel(entry.hora_final)
    hCell.numFmt = 'HH:MM:SS'
    hCell.font = dataFont
    hCell.alignment = centerAlign

    // TOTAL = HORAFINAL - HORAINICIAL - INTERVALO (fim - início)
    // Calculado em JS (fórmula do Excel saía vazia sem resultado em cache).
    // Guardado como valor de tempo numérico (fração do dia) para exibir via
    // numFmt e continuar somando no SUBTOTAL do topo (I1).
    const totalMin = Math.max(
      timeToMinutes(entry.hora_final) - timeToMinutes(entry.hora_inicial)
        - (timeToMinutes(entry.intervalo_fim) - timeToMinutes(entry.intervalo_inicio)),
      0
    )
    const iCell = ws.getCell(rowNum, 9)
    iCell.value = totalMin / 1440
    iCell.numFmt = '[h]:mm:ss'
    iCell.font = dataFont
    iCell.alignment = centerAlign
  })

  // Nome do arquivo reflete o filtro de cliente
  const slugify = (str) => String(str || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const monthsShort = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']
  const clientSlug = client_id
    ? slugify(entries[0]?.client_name || 'cliente')
    : 'todos'
  const fileName = `horas_${clientSlug}_${monthsShort[parseInt(month) - 1]}_${year}.xlsx`

  // Gerar buffer e enviar
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)

  const buffer = await wb.xlsx.writeBuffer()
  res.status(200).send(Buffer.from(buffer))
}
