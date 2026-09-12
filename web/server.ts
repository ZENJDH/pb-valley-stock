import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
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
import type { InventoryMode } from '../src/shared/types'

process.on('uncaughtException', (err) => { try { writeFileSync('web-logs/crash.log', `${new Date().toISOString()} ${err.stack || err}\n`, { flag: 'a' }) } catch {} })
process.stdout?.on('error', () => {})
process.stderr?.on('error', () => {})
process.env.TZ = 'Asia/Bangkok'
const dataDir = resolve(process.env.PB_DATA_DIR || 'web-data')
mkdirSync(dataDir, { recursive: true })
const configPath = join(dataDir, 'server.json')
type AccessRole = 'admin' | 'counter' | 'viewer'
const inventoryModes = ['products', 'agrochemicals'] as const satisfies readonly InventoryMode[]
interface AccessCredential { salt: string; passwordHash: string }
interface Config { key: string; salt?: string; passwordHash?: string; access?: Partial<Record<AccessRole, AccessCredential>> }
const config: Config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : { key: randomBytes(32).toString('hex') }
function saveConfig() { writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 }) }
if (!existsSync(configPath)) saveConfig()
process.env.PB_SECRET_KEY = config.key
const port = Number(process.env.PORT || 3080)
const publicDir = resolve('web-dist/public')
const sessions = new Map<string, { expiresAt: number; role: AccessRole; inventoryMode: InventoryMode }>()
const failures = new Map<string, { count: number; until: number }>()
const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', 'www.pbvalleystock.com', 'pbvalleystock.com', ...Object.values(networkInterfaces()).flat().filter(Boolean).map((entry) => entry!.address), ...(process.env.PB_ALLOWED_HOSTS || '').split(',').filter(Boolean)])
function isAllowedHost(hostname: string): boolean {
  if (allowedHosts.has(hostname)) return true
  if (hostname.endsWith('.trycloudflare.com') || hostname.endsWith('.ngrok-free.app') || hostname.endsWith('.ngrok.app') || hostname.endsWith('.ngrok.io') || hostname.endsWith('.loca.lt')) return true
  if (process.env.PB_ALLOW_ANY_HOST === '1') return true
  return false
}
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
const accessRoles = ['admin', 'counter', 'viewer'] as const
function isAccessRole(value: string): value is AccessRole { return (accessRoles as readonly string[]).includes(value) }
function isInventoryMode(value: string): value is InventoryMode { return (inventoryModes as readonly string[]).includes(value) }
function credentialFor(role: AccessRole): AccessCredential | null {
  const configured = config.access?.[role]
  if (configured?.salt && configured.passwordHash) return configured
  if (role === 'admin' && config.salt && config.passwordHash) return { salt: config.salt, passwordHash: config.passwordHash }
  return null
}
function availableRoles(): AccessRole[] { return accessRoles.filter((role) => Boolean(credentialFor(role))) }
function sessionFor(req: IncomingMessage) {
  const session = sessions.get(sessionId(req))
  return session && session.expiresAt > Date.now() ? session : null
}
function loggedIn(req: IncomingMessage) { return Boolean(sessionFor(req)) }
function roleOf(req: IncomingMessage): AccessRole | null { return sessionFor(req)?.role || null }
function inventoryModeOf(req: IncomingMessage): InventoryMode { return sessionFor(req)?.inventoryMode || 'products' }
function issueSession(res: ServerResponse, role: AccessRole, inventoryMode: InventoryMode, isHttps = false) {
  const id = randomBytes(32).toString('hex')
  sessions.set(id, { expiresAt: Date.now() + 12 * 3600_000, role, inventoryMode })
  res.setHeader('Set-Cookie', `pb_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${(isHttps || process.env.PB_HTTPS === '1') ? '; Secure' : ''}`)
}
function isLoopbackAddress(address: string): boolean { return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address) }
function isLocal(req: IncomingMessage) {
  if (!isLoopbackAddress(req.socket.remoteAddress || '')) return false
  return !req.headers['cf-connecting-ip'] && !req.headers['x-forwarded-for'] && !req.headers.forwarded
}
function clientIp(req: IncomingMessage): string {
  const direct = req.socket.remoteAddress || ''
  if (!isLoopbackAddress(direct)) return direct
  const cfIp = req.headers['cf-connecting-ip']
  if (typeof cfIp === 'string' && cfIp.trim()) return cfIp.trim()
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim()
  return direct
}
const routes: Record<string, (inventoryMode: InventoryMode, ...args: any[]) => unknown> = {
  'products.list': (inventoryMode, filters) => db.listProducts({ ...(filters || {}), inventoryMode }),
  'products.create': (inventoryMode, input) => db.createProduct(input, inventoryMode),
  'products.update': (inventoryMode, id, input, expected) => {
    const current = db.getProduct(id, inventoryMode)
    const keys = ['name', 'category', 'subcategory', 'quantity', 'totalQuantity', 'manufactureDate', 'expirationDate', 'barcode', 'notes', 'imageData'] as const
    if (!expected || keys.some((key) => current[key] !== expected[key])) throw new Error('สินค้าถูกแก้ไขจากอีกเครื่องแล้ว กรุณาปิดหน้าต่างแก้ไข รอข้อมูลอัปเดต แล้วเปิดใหม่')
    return db.updateProduct(id, input, inventoryMode)
  },
  'products.adjustQuantity': (inventoryMode, id, delta) => db.adjustQuantity(id, delta, inventoryMode),
  'products.remove': (inventoryMode, id) => db.removeProduct(id, inventoryMode),
  'products.categories': (inventoryMode) => db.categories(inventoryMode),
  'products.categoryOptions': (inventoryMode) => db.categoryOptions(inventoryMode),
  'dashboard.summary': (inventoryMode) => db.summary(inventoryMode),
  'settings.get': () => db.getSettings(),
  'settings.save': (_inventoryMode, input) => { const result = db.saveSettings(input); scheduler.restart(); return result },
  'categoryManager.list': (inventoryMode) => db.listCategoryTree(inventoryMode),
  'categoryManager.createMain': (inventoryMode, name, image) => db.createMainCategory(name, image, inventoryMode),
  'categoryManager.setMainImage': (inventoryMode, id, image) => db.setMainCategoryImage(id, image, inventoryMode),
  'categoryManager.renameMain': (inventoryMode, id, name) => db.renameMainCategory(id, name, inventoryMode),
  'categoryManager.removeMain': (inventoryMode, id) => db.removeMainCategory(id, inventoryMode),
  'categoryManager.createSubcategory': (inventoryMode, id, name, image) => db.createSubcategory(id, name, image, inventoryMode),
  'categoryManager.setSubcategoryImage': (inventoryMode, id, image) => db.setSubcategoryImage(id, image, inventoryMode),
  'categoryManager.renameSubcategory': (inventoryMode, id, name) => db.renameSubcategory(id, name, inventoryMode),
  'categoryManager.removeSubcategory': (inventoryMode, id) => db.removeSubcategory(id, inventoryMode),
  'activities.list': (inventoryMode, limit) => db.getActivities(limit, inventoryMode),
  'activities.markAsRead': (inventoryMode) => db.markActivitiesAsRead(inventoryMode),
  'activities.clear': (inventoryMode) => db.clearActivities(inventoryMode)
}
const alertActions: Record<string, () => Promise<unknown>> = {
  'notifications.test': () => testNotifications(db),
  'notifications.testExpiring': () => testExpirationWarning(db),
  'notifications.runNow': () => runExpirationCheck(db, false)
}
const readRpcMethods = new Set([
  'products.list', 'products.categories', 'products.categoryOptions',
  'dashboard.summary', 'categoryManager.list', 'activities.list', 'activities.markAsRead'
])
const counterWriteRpcMethods = new Set([
  'products.adjustQuantity',
  'products.create',
  'categoryManager.createMain',
  'categoryManager.setMainImage',
  'categoryManager.createSubcategory',
  'categoryManager.setSubcategoryImage',
  'activities.clear'
])
function canCall(role: AccessRole, method: string): boolean {
  if (role === 'admin') return true
  if (readRpcMethods.has(method)) return true
  return role === 'counter' && counterWriteRpcMethods.has(method)
}

const handleRequest = async (req: IncomingMessage, res: ServerResponse) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'same-origin')
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'")
  try {
    const isEncrypted = Boolean((req.socket as { encrypted?: boolean }).encrypted)
    const host = new URL(`http://${req.headers.host || ''}`)
    if (!isAllowedHost(host.hostname)) return json(res, { error: 'ชื่อ Server ไม่ได้รับอนุญาต' }, 403)
    const forwardedProto = isLoopbackAddress(req.socket.remoteAddress || '') && typeof req.headers['x-forwarded-proto'] === 'string'
      ? req.headers['x-forwarded-proto'].split(',')[0].trim().toLowerCase()
      : ''
    const isHttps = isEncrypted || forwardedProto === 'https' || process.env.PB_HTTPS === '1'
    const url = new URL(req.url || '/', `${isHttps ? 'https' : 'http'}://${host.host}`)
    if (req.method === 'POST' && (!req.headers.origin || !['http:', 'https:'].some((scheme) => req.headers.origin === `${scheme}//${req.headers.host}`))) return json(res, { error: 'คำขอไม่ถูกต้อง' }, 403)
    if (url.pathname === '/api/health' && req.method === 'GET') return json(res, { app: 'pb-valley-stock', ok: true })
    if (url.pathname === '/api/session' && req.method === 'GET') return json(res, { authenticated: loggedIn(req), role: roleOf(req), inventoryMode: inventoryModeOf(req), needsSetup: !credentialFor('admin'), canSetup: isLocal(req), availableRoles: availableRoles() })
    if (['/api/login', '/api/setup'].includes(url.pathname) && req.method === 'POST') {
      const ip = clientIp(req)
      const rate = failures.get(ip)
      if (rate && rate.until > Date.now() && rate.count >= 8) return json(res, { error: 'ลองใหม่ในอีก 15 นาที' }, 429)
      const input = JSON.parse((await body(req, 4096)).toString())
      const password = String(input.password || '')
      const requestedRole = String(input.role || 'admin')
      const requestedInventoryMode = String(input.inventoryMode || 'products')
      if (!isAccessRole(requestedRole)) return json(res, { error: 'ประเภทผู้ใช้ไม่ถูกต้อง' }, 400)
      if (!isInventoryMode(requestedInventoryMode)) return json(res, { error: 'ประเภทคลังไม่ถูกต้อง' }, 400)
      const role = requestedRole as AccessRole
      const inventoryMode = requestedInventoryMode as InventoryMode
      if (url.pathname === '/api/setup') {
        if (credentialFor('admin') || !isLocal(req)) return json(res, { error: 'ตั้งค่าครั้งแรกจากเครื่อง Server เท่านั้น' }, 403)
        if (role !== 'admin') return json(res, { error: 'การตั้งค่าครั้งแรกต้องเป็นผู้ดูแลระบบ' }, 400)
        if (password.length < 12 || password.length > 128) throw new Error('ใช้รหัสผ่าน 12–128 ตัวอักษร')
        const salt = randomBytes(16).toString('hex')
        config.access ||= {}
        config.access.admin = { salt, passwordHash: scryptSync(password, salt, 64).toString('hex') }
        delete config.salt
        delete config.passwordHash
        saveConfig()
      } else {
        const credential = credentialFor(role)
        if (!credential) return json(res, { error: 'ยังไม่ได้เปิดใช้งานสิทธิ์ประเภทนี้' }, 401)
        const candidate = scryptSync(password.slice(0, 128), credential.salt, 64)
        if (password.length > 128 || !timingSafeEqual(candidate, Buffer.from(credential.passwordHash, 'hex'))) {
          failures.set(ip, { count: rate && rate.until > Date.now() ? rate.count + 1 : 1, until: Date.now() + 900_000 })
          return json(res, { error: 'รหัสผ่านไม่ถูกต้อง' }, 401)
        }
      }
      failures.delete(ip); issueSession(res, role, inventoryMode, isHttps); return json(res, { ok: true, role, inventoryMode })
    }
    if (url.pathname.startsWith('/api/')) {
      if (!loggedIn(req)) return json(res, { error: 'กรุณาเข้าสู่ระบบ' }, 401)
      const role = roleOf(req)!
      if (url.pathname === '/api/logout' && req.method === 'POST') {
        sessions.delete(sessionId(req)); res.setHeader('Set-Cookie', 'pb_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json(res, { ok: true })
      }
      if (url.pathname === '/api/access' && req.method === 'GET') {
        if (role !== 'admin') return json(res, { error: 'เฉพาะผู้ดูแลระบบเท่านั้น' }, 403)
        return json(res, { roles: availableRoles() })
      }
      if (url.pathname === '/api/access' && req.method === 'POST') {
        if (role !== 'admin') return json(res, { error: 'เฉพาะผู้ดูแลระบบเท่านั้น' }, 403)
        const input = JSON.parse((await body(req, 4096)).toString())
        const target = String(input.role || '')
        const password = String(input.password || '')
        if (!isAccessRole(target)) return json(res, { error: 'ประเภทผู้ใช้ไม่ถูกต้อง' }, 400)
        if (!password) {
          if (target === 'admin') throw new Error('ไม่สามารถปิดสิทธิ์ผู้ดูแลระบบได้')
          if (config.access) delete config.access[target]
        } else {
          const minimum = target === 'admin' ? 12 : 8
          if (password.length < minimum || password.length > 128) throw new Error(`รหัสผ่านต้องมี ${minimum}–128 ตัวอักษร`)
          const salt = randomBytes(16).toString('hex')
          config.access ||= {}
          config.access[target] = { salt, passwordHash: scryptSync(password, salt, 64).toString('hex') }
          if (target === 'admin') { delete config.salt; delete config.passwordHash }
        }
        saveConfig()
        const currentId = sessionId(req)
        for (const [id, session] of sessions) if (session.role === target && id !== currentId) sessions.delete(id)
        return json(res, { roles: availableRoles() })
      }
      if (url.pathname === '/api/import' && req.method === 'POST') {
        if (role !== 'admin') return json(res, { error: 'ไม่มีสิทธิ์นำเข้าข้อมูล' }, 403)
        return json(res, await importBuffer(db, url.searchParams.get('name') || '', await body(req), inventoryModeOf(req)))
      }
      if (url.pathname === '/api/export' && req.method === 'GET') {
        if (role !== 'admin') return json(res, { error: 'ไม่มีสิทธิ์ส่งออกข้อมูล' }, 403)
        const format = url.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv'
        const bytes = await exportBuffer(db, format, inventoryModeOf(req))
        res.writeHead(200, { 'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="stock-export.${format}"`, 'Cache-Control': 'no-store' }); return res.end(bytes)
      }
      if (url.pathname === '/api/rpc' && req.method === 'POST') {
        const { method, args = [] } = JSON.parse((await body(req, 2_000_000)).toString())
        if (typeof method !== 'string' || !Array.isArray(args)) throw new Error('คำขอไม่ถูกต้อง')
        if (!canCall(role, method)) return json(res, { error: 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้' }, 403)
        if (Object.hasOwn(alertActions, method)) {
          if (alertBusy) throw new Error('กำลังส่งแจ้งเตือน กรุณารอสักครู่')
          alertBusy = true
          try { return json(res, await alertActions[method]()) } finally { alertBusy = false }
        }
        if (!Object.hasOwn(routes, method)) return json(res, { error: 'ไม่พบคำสั่ง' }, 404)
        return json(res, await routes[method](inventoryModeOf(req), ...args))
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
}

const server = createHttpServer(handleRequest)
server.requestTimeout = 60_000
server.headersTimeout = 15_000

let httpsServer: HttpsServer | null = null
const certPath = join(dataDir, 'cert.pem')
const keyPath = join(dataDir, 'key.pem')
if (existsSync(certPath) && existsSync(keyPath)) {
  try {
    httpsServer = createHttpsServer({
      cert: readFileSync(certPath),
      key: readFileSync(keyPath)
    }, handleRequest)
    httpsServer.requestTimeout = 60_000
    httpsServer.headersTimeout = 15_000
  } catch (err) {
    console.warn('Could not initialize HTTPS server:', err)
  }
}
setInterval(() => {
  for (const [id, session] of sessions) if (session.expiresAt < Date.now()) sessions.delete(id)
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
    console.log(`PB Valley Web (HTTP): http://localhost:${port}`)
    for (const entry of Object.values(networkInterfaces()).flat()) if (entry?.family === 'IPv4' && !entry.internal) console.log(`LAN (HTTP): http://${entry.address}:${port}`)
    console.log(`Data: ${dataDir}\nKeep this window open while using the website.`)
  })
  if (httpsServer) {
    const httpsPort = Number(process.env.HTTPS_PORT || 443)
    httpsServer.once('error', (err) => console.warn(`HTTPS port ${httpsPort} not available:`, err.message))
    httpsServer.listen(httpsPort, process.env.HOST || '0.0.0.0', () => {
      console.log(`PB Valley Web (HTTPS): https://localhost:${httpsPort}`)
      for (const entry of Object.values(networkInterfaces()).flat()) if (entry?.family === 'IPv4' && !entry.internal) console.log(`LAN (HTTPS): https://${entry.address}:${httpsPort}`)
    })
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      scheduler.stop()
      if (httpsServer) httpsServer.close()
      server.close(() => { db.close(); process.exit(0) })
    })
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1 })
