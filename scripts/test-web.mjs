import { spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
const data = await mkdtemp(join(tmpdir(), 'pb-web-test-'))
const origin = 'http://127.0.0.1:3091'
let child, cookie = '', log = ''
async function start() {
  child = spawn(process.execPath, ['web-dist/server.cjs'], { env: { ...process.env, PORT: '3091', HOST: '127.0.0.1', PB_DATA_DIR: data, PB_DISABLE_SCHEDULER: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (d) => { log += d }); child.stderr.on('data', (d) => { log += d })
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error(log)
    try { const r = await fetch(origin + '/api/session'); if (r.ok) return } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('Server did not start: ' + log)
}
async function stop() { if (child && child.exitCode === null) { const done = new Promise((r) => child.once('exit', r)); child.kill(); await done } }
async function post(path, value, headers = {}) {
  const r = await fetch(origin + path, { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) })
  const token = r.headers.get('set-cookie'); if (token) cookie = token.split(';')[0]
  return { status: r.status, data: await r.json() }
}
async function rpc(method, ...args) { const r = await post('/api/rpc', { method, args }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data }
try {
  await start()
  assert.equal((await fetch(origin)).status, 200)
  assert.equal((await post('/api/rpc', { method: 'products.list' })).status, 401)
  assert.equal((await post('/api/setup', { password: 'tiny' })).status, 400)
  assert.equal((await post('/api/setup', { password: 'test-only-password-123' })).status, 200)
  assert.equal((await post('/api/setup', { password: 'another-password' })).status, 403)
  assert.equal((await post('/api/rpc', { method: 'products.list' }, { Origin: 'http://evil.invalid' })).status, 403)
  await rpc('categoryManager.createMain', 'โกโก้')
  let tree = await rpc('categoryManager.list')
  await rpc('categoryManager.createSubcategory', tree[0].id, 'เมล็ดแห้ง')
  const input = { name: 'สินค้าทดสอบ', category: 'โกโก้', subcategory: 'เมล็ดแห้ง', totalQuantity: 100, quantity: 50, manufactureDate: null, expirationDate: '2020-01-01', barcode: '00001234', notes: '=1+1', imageData: null }
  const created = await rpc('products.create', input)
  assert.equal(created.status, 'expired')
  await Promise.all(Array.from({ length: 10 }, () => rpc('products.adjustQuantity', created.id, -1)))
  let products = await rpc('products.list')
  assert.equal(products[0].quantity, 40)
  assert.equal((await post('/api/rpc', { method: 'products.update', args: [created.id, { ...input, name: 'stale' }, created] })).status, 400)
  await rpc('products.update', created.id, { ...input, name: 'แก้ไขแล้ว', quantity: 40 }, products[0])
  const invalid = await post('/api/rpc', { method: 'products.create', args: [{ ...input, quantity: -1 }] }); assert.equal(invalid.status, 400)
  const settings = await rpc('settings.get')
  await rpc('settings.save', { ...settings, telegramEnabled: false, telegramBotToken: 'fake-test-token', lineEnabled: false })
  assert.equal('telegramBotToken' in await rpc('settings.get'), false)
  const disk = await readFile(join(data, 'stock-tracker.sqlite-wal'))
  assert.equal(disk.includes(Buffer.from('fake-test-token')), false)
  for (const format of ['csv', 'xlsx']) {
    const exported = await fetch(origin + '/api/export?format=' + format, { headers: { Cookie: cookie } }); assert.equal(exported.status, 200)
    const bytes = await exported.arrayBuffer()
    const imported = await fetch(origin + '/api/import?name=test.' + format, { method: 'POST', headers: { Cookie: cookie, Origin: origin }, body: bytes })
    assert.equal(imported.status, 200); assert.equal((await imported.json()).imported, format === 'csv' ? 1 : 2)
  }
  products = await rpc('products.list'); assert.equal(products.length, 4); assert.ok(products.every((p) => p.barcode === '00001234'))
  assert.equal((await rpc('dashboard.summary')).totalProducts, 4)
  await rpc('products.remove', products[3].id)
  await stop(); cookie = ''; await start()
  assert.equal((await post('/api/login', { password: 'wrong' })).status, 401)
  assert.equal((await post('/api/login', { password: 'test-only-password-123' })).status, 200)
  assert.equal((await rpc('products.list')).length, 3)
  await post('/api/logout', {})
  assert.equal((await post('/api/rpc', { method: 'products.list' })).status, 401)
  console.log('PASS: authentication, CSRF, CRUD, concurrent stock, stale edits, encrypted tokens, CSV/XLSX, persistence and logout')
} finally { await stop() }
