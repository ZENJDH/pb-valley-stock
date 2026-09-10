import type { StockApi } from '../../src/shared/types'

export async function request(path: string, options?: RequestInit) {
  const response = await fetch(path, { credentials: 'same-origin', ...options })
  if (response.status === 401 && path !== '/api/login') window.dispatchEvent(new Event('pb-session-expired'))
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || 'เชื่อมต่อ Server ไม่สำเร็จ')
  }
  return response
}
async function rpc(method: string, args: unknown[]) {
  return (await request('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }) })).json()
}
function chooseFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = accept
    input.onchange = () => { resolve(input.files?.[0] || null); input.remove() }
    input.addEventListener('cancel', () => { resolve(null); input.remove() }, { once: true })
    input.hidden = true; document.body.appendChild(input); input.click()
  })
}
const api: Record<string, unknown> = {}
const methods = {
  products: ['list', 'create', 'update', 'adjustQuantity', 'remove', 'categories', 'categoryOptions'],
  dashboard: ['summary'], settings: ['get', 'save'], notifications: ['test', 'testExpiring', 'runNow'],
  categoryManager: ['list', 'createMain', 'setMainImage', 'renameMain', 'removeMain', 'createSubcategory', 'renameSubcategory', 'removeSubcategory']
}
for (const [group, names] of Object.entries(methods)) api[group] = Object.fromEntries(names.map((name) => [name, (...args: unknown[]) => rpc(`${group}.${name}`, args)]))
api.files = {
  async import() {
    const file = await chooseFile('.csv,.xlsx')
    if (!file) return { canceled: true, imported: 0, skipped: 0, errors: [] }
    if (file.size > 12_000_000) throw new Error('ไฟล์ต้องไม่เกิน 12 MB')
    return (await request('/api/import?name=' + encodeURIComponent(file.name), { method: 'POST', body: file })).json()
  },
  async export(format: 'csv' | 'xlsx') {
    const response = await request('/api/export?format=' + format)
    const url = URL.createObjectURL(await response.blob())
    const a = document.createElement('a'); a.href = url; a.download = `stock-export.${format}`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    return { path: a.download }
  },
  async pickImage() {
    const file = await chooseFile('image/png,image/jpeg,image/webp,image/bmp')
    if (!file) return { canceled: true }
    if (file.size > 12_000_000) throw new Error('รูปต้องไม่เกิน 12 MB')
    const url = URL.createObjectURL(file)
    try {
      const img = new Image(); img.src = url; await img.decode()
      const scale = Math.min(1, 360 / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale))
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      return { dataUrl: canvas.toDataURL('image/jpeg', .84) }
    } finally { URL.revokeObjectURL(url) }
  }
}
window.stockApi = api as unknown as StockApi
