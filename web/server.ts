import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { resolve, join, extname, sep } from 'node:path'
import { networkInterfaces } from 'node:os'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { DatabaseSync, backup } from 'node:sqlite'
import { StockDatabase } from '../src/main/database'
import { AlertScheduler } from '../src/main/scheduler'
import { runExpirationCheck, testExpirationWarning, testNotifications } from '../src/main/notifications'
import { importBuffer, exportBuffer } from './files'

process.env.TZ = 'Asia/Bangkok'
const dataDir = resolve(process.env.PB_DATA_DIR || 'web-data')
mkdirSync(dataDir, { recursive: true })
const configPath = join(dataDir, 'server.json')
interface Config { key: string; salt?: string; passwordHash?: string }
const config: Config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : { key: randomBytes(32).toString('hex') }
function saveConfig() { writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 }) }
if (!existsSync(configPath)) saveConfig()
process.env.PB_SECRET_KEY = config.key
const port = Number(process.env.PORT || 3080)
const publicDir = resolve('web-dist/public')
const sessions = new Map<string, number>()
const failures = new Map<string, { count: number; until: number }>()
const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', 'www.pbvalleystock.com', 'pbvalleystock.com', ...Object.values(networkInterfaces()).flat().filter(Boolean).map((entry) => entry!.address), ...(process.env.PB_ALLOWED_HOSTS || '').split(',').filter(Boolean)])
let db: StockDatabase
let scheduler: AlertScheduler
let alertBusy = false

function json(res: ServerResponse, value: unknown, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value ?? null))
}
async function body(req: IncomingMessage, limit = 12_000_000): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('ไฟล์ใหญ่เกินกำหนด (สูงสุด 12 MB)')
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
function sessionId(req: IncomingMessage): string { return req.headers.cookie?.match(/(?:^|;\s*)pb_session=([a-f0-9]+)/)?.[1] || '' }
function loggedIn(req: IncomingMessage) { return (sessions.get(sessionId(req)) || 0) > Date.now() }
function issueSession(res: ServerResponse) {
  const id = randomBytes(32).toString('hex')
  sessions.set(id, Date.now() + 12 * 3600_000)
  res.setHeader('Set-Cookie', `pb_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.PB_HTTPS === '1' ? '; Secure' : ''}`)
}
function isLocal(req: IncomingMessage) { return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '') }
const routes: Record<string, (...args: any[]) => unknown> = {
  'products.list': (filters) => db.listProducts(filters),
  'products.create': (input) => db.createProduct(input),
  'products.update': (id, input, expected) => {
    const current = db.getProduct(id)
    const keys = ['name', 'category', 'subcategory', 'quantity', 'totalQuantity', 'manufactureDate', 'expirationDate', 'barcode', 'notes', 'imageData'] as const
    if (!expected || keys.some((key) => current[key] !== expected[key])) throw new Error('สินค้าถูกแก้ไขจากอีกเครื่องแล้ว กรุณาปิดหน้าต่างแก้ไข รอข้อมูลอัปเดต แล้วเปิดใหม่')
    return db.updateProduct(id, input)
  },
  'products.adjustQuantity': (id, delta) => db.adjustQuantity(id, delta),
  'products.remove': (id) => db.removeProduct(id),
  'products.categories': () => db.categories(),
  'products.categoryOptions': () => db.categoryOptions(),
  'dashboard.summary': () => db.summary(),
  'settings.get': () => db.getSettings(),
  'settings.save': (input) => { const result = db.saveSettings(input); scheduler.restart(); return result },
  'categoryManager.list': () => db.listCategoryTree(),
  'categoryManager.createMain': (name, image) => db.createMainCategory(name, image),
  'categoryManager.setMainImage': (id, image) => db.setMainCategoryImage(id, image),
  'categoryManager.renameMain': (id, name) => db.renameMainCategory(id, name),
  'categoryManager.removeMain': (id) => db.removeMainCategory(id),
  'categoryManager.createSubcategory': (id, name) => db.createSubcategory(id, name),
  'categoryManager.renameSubcategory': (id, name) => db.renameSubcategory(id, name),
  'categoryManager.removeSubcategory': (id) => db.removeSubcategory(id)
}
const alertActions: Record<string, () => Promise<unknown>> = {
  'notifications.test': () => testNotifications(db),
  'notifications.testExpiring': () => testExpirationWarning(db),
  'notifications.runNow': () => runExpirationCheck(db, false)
}

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'same-origin')
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'")
  try {
    const host = new URL(`http://${req.headers.host || ''}`)
    if (!allowedHosts.has(host.hostname)) return json(res, { error: 'ชื่อ Server ไม่ได้รับอนุญาต' }, 403)
    const url = new URL(req.url || '/', host)
    if (req.method === 'POST' && (!req.headers.origin || !['http:', 'https:'].some((scheme) => req.headers.origin === `${scheme}//${req.headers.host}`))) return json(res, { error: 'คำขอไม่ถูกต้อง' }, 403)
    if (url.pathname === '/api/health' && req.method === 'GET') return json(res, { app: 'pb-valley-stock', ok: true })
    if (url.pathname === '/api/session' && req.method === 'GET') return json(res, { authenticated: loggedIn(req), needsSetup: !config.passwordHash, canSetup: isLocal(req) })
    if (['/api/login', '/api/setup'].includes(url.pathname) && req.method === 'POST') {
      const ip = req.socket.remoteAddress || ''
      const rate = failures.get(ip)
      if (rate && rate.until > Date.now() && rate.count >= 8) return json(res, { error: 'ลองใหม่ในอีก 15 นาที' }, 429)
      const input = JSON.parse((await body(req, 4096)).toString())
      const password = String(input.password || '')
      if (url.pathname === '/api/setup') {
        if (config.passwordHash || !isLocal(req)) return json(res, { error: 'ตั้งค่าครั้งแรกจากเครื่อง Server เท่านั้น' }, 403)
        if (password.length < 12 || password.length > 128) throw new Error('ใช้รหัสผ่าน 12–128 ตัวอักษร')
        config.salt = randomBytes(16).toString('hex')
        config.passwordHash = scryptSync(password, config.salt, 64).toString('hex')
        saveConfig()
      } else {
        if (!config.passwordHash || !config.salt) throw new Error('กรุณาตั้งรหัสผ่านที่เครื่อง Server ก่อน')
        const candidate = scryptSync(password.slice(0, 128), config.salt, 64)
        if (password.length > 128 || !timingSafeEqual(candidate, Buffer.from(config.passwordHash, 'hex'))) {
          failures.set(ip, { count: rate && rate.until > Date.now() ? rate.count + 1 : 1, until: Date.now() + 900_000 })
          return json(res, { error: 'รหัสผ่านไม่ถูกต้อง' }, 401)
        }
      }
      failures.delete(ip); issueSession(res); return json(res, { ok: true })
    }
    if (url.pathname.startsWith('/api/')) {
      if (!loggedIn(req)) return json(res, { error: 'กรุณาเข้าสู่ระบบ' }, 401)
      if (url.pathname === '/api/logout' && req.method === 'POST') {
        sessions.delete(sessionId(req)); res.setHeader('Set-Cookie', 'pb_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json(res, { ok: true })
      }
      if (url.pathname === '/api/import' && req.method === 'POST') return json(res, await importBuffer(db, url.searchParams.get('name') || '', await body(req)))
      if (url.pathname === '/api/export' && req.method === 'GET') {
        const format = url.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv'
        const bytes = await exportBuffer(db, format)
        res.writeHead(200, { 'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="stock-export.${format}"`, 'Cache-Control': 'no-store' }); return res.end(bytes)
      }
      if (url.pathname === '/api/rpc' && req.method === 'POST') {
        const { method, args = [] } = JSON.parse((await body(req, 2_000_000)).toString())
        if (typeof method !== 'string' || !Array.isArray(args)) throw new Error('คำขอไม่ถูกต้อง')
        if (Object.hasOwn(alertActions, method)) {
          if (alertBusy) throw new Error('กำลังส่งแจ้งเตือน กรุณารอสักครู่')
          alertBusy = true
          try { return json(res, await alertActions[method]()) } finally { alertBusy = false }
        }
        if (!Object.hasOwn(routes, method)) return json(res, { error: 'ไม่พบคำสั่ง' }, 404)
        return json(res, await routes[method](...args))
      }
      return json(res, { error: 'ไม่พบคำสั่ง' }, 404)
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, { error: 'Method not allowed' }, 405)
    const file = resolve(publicDir, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname))
    if (!file.startsWith(publicDir + sep)) return json(res, { error: 'Not found' }, 404)
    try { if (!(await stat(file)).isFile()) throw new Error() } catch { return json(res, { error: 'Not found' }, 404) }
    const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
    res.end(req.method === 'HEAD' ? undefined : await readFile(file))
  } catch (error) {
    if (!res.headersSent) json(res, { error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาด' }, 400)
    else res.end()
  }
})
server.requestTimeout = 60_000
server.headersTimeout = 15_000
setInterval(() => {
  for (const [id, expiry] of sessions) if (expiry < Date.now()) sessions.delete(id)
  for (const [ip, rate] of failures) if (rate.until < Date.now()) failures.delete(ip)
}, 60_000).unref()

async function main() {
  const dbPath = join(dataDir, 'stock-tracker.sqlite')
  const importIndex = process.argv.indexOf('--import-db')
  if (importIndex >= 0) {
    if (existsSync(dbPath)) throw new Error('ฐานข้อมูลเว็บมีอยู่แล้ว ไม่เขียนทับ กรุณาใช้โฟลเดอร์ข้อมูลใหม่')
    const sourcePath = process.argv[importIndex + 1]
    if (!sourcePath || !existsSync(sourcePath)) throw new Error('ไม่พบฐานข้อมูลต้นฉบับ')
    const original = new DatabaseSync(resolve(sourcePath), { readOnly: true })
    try { await backup(original, dbPath) } finally { original.close() }
    const migrated = new DatabaseSync(dbPath)
    migrated.exec("UPDATE notification_settings SET telegram_enabled=0, line_enabled=0, telegram_bot_token='', line_channel_access_token=''")
    migrated.close()
    console.log('Copied stock data. Configure notification tokens in the web settings.')
  }
  db = new StockDatabase(dbPath)
  scheduler = new AlertScheduler(db)
  server.once('error', (error) => { console.error(error.message); db.close(); process.exitCode = 1 })
  server.listen(port, process.env.HOST || '0.0.0.0', () => {
    if (process.env.PB_DISABLE_SCHEDULER !== '1') scheduler.start()
    console.log(`PB Valley Web: http://localhost:${port}`)
    for (const entry of Object.values(networkInterfaces()).flat()) if (entry?.family === 'IPv4' && !entry.internal) console.log(`LAN: http://${entry.address}:${port}`)
    console.log(`Data: ${dataDir}\nKeep this window open while using the website.`)
  })
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { scheduler.stop(); server.close(() => { db.close(); process.exit(0) }) })
}
main().catch((error) => { console.error(error.message); process.exitCode = 1 })
