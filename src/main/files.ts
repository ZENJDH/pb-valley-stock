import { dialog, nativeImage } from 'electron'
import ExcelJS from 'exceljs'
import { parse as parseCsv } from 'csv-parse/sync'
import { readFile, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { ProductInput } from '../shared/types'
import type { StockDatabase } from './database'

const HEADERS = {
  name: ['name', 'productname', 'ชื่อสินค้า', 'สินค้า'],
  category: ['category', 'หมวดหมู่', 'ประเภท'],
  subcategory: ['subcategory', 'หมวดหมู่รอง', 'ประเภทย่อย'],
  totalQuantity: ['totalquantity', 'totalqty', 'จำนวนทั้งหมด', 'จำนวนรับเข้า'],
  quantity: ['quantity', 'qty', 'จำนวน', 'คงเหลือ', 'จำนวนคงเหลือ', 'remaining', 'remainingquantity'],
  manufactureDate: ['manufacturedate', 'manufacturingdate', 'mfgdate', 'วันที่ผลิต'],
  expirationDate: ['expirationdate', 'expirydate', 'expdate', 'วันหมดอายุ'],
  barcode: ['barcode', 'บาร์โค้ด', 'รหัสสินค้า', 'productcode', 'sku'],
  notes: ['notes', 'note', 'หมายเหตุ']
} as const

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[\s_\-().]/g, '')
}

function findValue(row: Record<string, unknown>, aliases: readonly string[]): unknown {
  const entry = Object.entries(row).find(([key]) => aliases.includes(normalizeHeader(key)))
  return entry?.[1]
}

function unwrapExcelValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && !(value instanceof Date)) {
    if ('result' in value) return value.result
    if ('text' in value) return value.text
    if ('richText' in value) return value.richText.map((part) => part.text).join('')
  }
  return value
}

function toIsoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  }
  if (typeof value === 'number') {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000)
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
  }
  const text = String(value).trim()
  const iso = text.match(/^(\d{4})[-/]([01]?\d)[-/]([0-3]?\d)$/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const local = text.match(/^([0-3]?\d)[-/]([01]?\d)[-/](\d{4})$/)
  if (local) return `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`
  return text
}

function rowToInput(row: Record<string, unknown>): ProductInput {
  const remainingValue = findValue(row, HEADERS.quantity)
  const totalValue = findValue(row, HEADERS.totalQuantity)
  const quantity = Number(remainingValue === undefined || remainingValue === '' ? totalValue ?? 0 : remainingValue)
  const totalQuantity = Number(totalValue === undefined || totalValue === '' ? quantity : totalValue)
  return {
    name: String(findValue(row, HEADERS.name) ?? '').trim(),
    category: String(findValue(row, HEADERS.category) ?? '').trim(),
    subcategory: String(findValue(row, HEADERS.subcategory) ?? '').trim(),
    totalQuantity,
    quantity,
    manufactureDate: toIsoDate(findValue(row, HEADERS.manufactureDate)),
    expirationDate: toIsoDate(findValue(row, HEADERS.expirationDate)) ?? '',
    barcode: String(findValue(row, HEADERS.barcode) ?? '').trim() || null,
    notes: String(findValue(row, HEADERS.notes) ?? '').trim() || null,
    imageData: null
  }
}

export async function pickImage(): Promise<{ dataUrl?: string; canceled?: boolean }> {
  const result = await dialog.showOpenDialog({
    title: 'เลือกรูปภาพ',
    properties: ['openFile'],
    filters: [{ name: 'รูปภาพ', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }]
  })
  if (result.canceled || !result.filePaths[0]) return { canceled: true }
  const source = nativeImage.createFromPath(result.filePaths[0])
  if (source.isEmpty()) throw new Error('ไม่สามารถอ่านไฟล์รูปภาพนี้ได้')
  const size = source.getSize()
  const scale = Math.min(1, 360 / Math.max(size.width, size.height))
  const resized = scale < 1
    ? source.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'good' })
    : source
  return { dataUrl: `data:image/jpeg;base64,${resized.toJPEG(84).toString('base64')}` }
}

async function readRows(filePath: string): Promise<Record<string, unknown>[]> {
  if (extname(filePath).toLowerCase() === '.csv') {
    const content = await readFile(filePath, 'utf8')
    return parseCsv(content, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true }) as Record<string, unknown>[]
  }

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('ไม่พบ worksheet ในไฟล์')
  const headers: string[] = []
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => {
    headers[column] = String(unwrapExcelValue(cell.value)).trim()
  })
  const rows: Record<string, unknown>[] = []
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const record: Record<string, unknown> = {}
    let hasValue = false
    headers.forEach((header, column) => {
      if (!header) return
      const value = unwrapExcelValue(row.getCell(column).value)
      record[header] = value
      if (value !== '') hasValue = true
    })
    if (hasValue) rows.push(record)
  })
  return rows
}

export async function importProducts(db: StockDatabase) {
  const selection = await dialog.showOpenDialog({
    title: 'นำเข้ารายการสินค้า',
    properties: ['openFile'],
    filters: [{ name: 'Excel หรือ CSV', extensions: ['xlsx', 'csv'] }]
  })
  if (selection.canceled || !selection.filePaths[0]) return { imported: 0, skipped: 0, errors: [], canceled: true }
  const rows = await readRows(selection.filePaths[0])
  return db.importProducts(rows.map(rowToInput))
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export async function exportProducts(db: StockDatabase, format: 'xlsx' | 'csv') {
  const extension = format === 'xlsx' ? 'xlsx' : 'csv'
  const selection = await dialog.showSaveDialog({
    title: 'ส่งออกรายการสินค้า',
    defaultPath: `stock-export-${new Date().toISOString().slice(0, 10)}.${extension}`,
    filters: [{ name: format === 'xlsx' ? 'Excel Workbook' : 'CSV UTF-8', extensions: [extension] }]
  })
  if (selection.canceled || !selection.filePath) return { canceled: true }

  const columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'ชื่อสินค้า', key: 'name', width: 28 },
    { header: 'หมวดหมู่', key: 'category', width: 18 },
    { header: 'หมวดหมู่รอง', key: 'subcategory', width: 18 },
    { header: 'จำนวนทั้งหมด', key: 'totalQuantity', width: 15 },
    { header: 'จำนวนคงเหลือ', key: 'quantity', width: 15 },
    { header: 'วันที่ผลิต', key: 'manufactureDate', width: 15 },
    { header: 'วันหมดอายุ', key: 'expirationDate', width: 15 },
    { header: 'รหัสสินค้า / บาร์โค้ด', key: 'barcode', width: 22 },
    { header: 'หมายเหตุ', key: 'notes', width: 28 },
    { header: 'สถานะ', key: 'status', width: 16 },
    { header: 'จำนวนวันที่เหลือ', key: 'daysRemaining', width: 18 }
  ]
  const rows = db.listProducts().map((product) => ({
    ...product,
    manufactureDate: product.manufactureDate ?? '',
    barcode: product.barcode ?? '',
    notes: product.notes ?? '',
    status: product.status === 'expired' ? 'หมดอายุแล้ว' : product.status === 'expiring' ? 'ใกล้หมดอายุ' : 'ปกติ'
  }))

  if (format === 'csv') {
    const headers = columns.map((column) => column.header)
    const keys = columns.map((column) => column.key)
    const csvRows = [headers, ...rows.map((row) => keys.map((key) => row[key as keyof typeof row]))]
    await writeFile(selection.filePath, `\uFEFF${csvRows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`, 'utf8')
  } else {
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Stock Expiration Tracker'
    const sheet = workbook.addWorksheet('Inventory', { views: [{ state: 'frozen', ySplit: 1 }] })
    sheet.columns = columns
    sheet.addRows(rows)
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF275D45' } }
    sheet.autoFilter = { from: 'A1', to: `L${Math.max(1, rows.length + 1)}` }
    await workbook.xlsx.writeFile(selection.filePath)
  }
  return { path: selection.filePath }
}
