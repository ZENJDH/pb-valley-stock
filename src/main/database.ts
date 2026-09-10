import { DatabaseSync } from 'node:sqlite'
import type {
  DashboardSummary,
  CategorySummary,
  NotificationSettingsPublic,
  NotificationSettingsUpdate,
  Product,
  ProductFilters,
  ProductInput
} from '../shared/types'
import { daysUntil, expirationStatus, todayIso } from './expiration'
import { decryptSecret, encryptSecret } from './secrets'
import { validateProduct, validateSettings } from './validation'

interface ProductRow {
  id: number
  name: string
  category: string
  subcategory: string
  total_quantity: number
  quantity: number
  manufacture_date: string | null
  expiration_date: string
  barcode: string | null
  notes: string | null
  image_data: string | null
  created_at: string
  updated_at: string
}

interface SettingsRow {
  id: number
  warning_days: number
  alert_time: string
  timezone: string
  telegram_enabled: number
  telegram_chat_id: string
  telegram_bot_token: string
  line_enabled: number
  line_target_id: string
  line_channel_access_token: string
}

export interface NotificationSettingsInternal extends NotificationSettingsPublic {
  telegramBotToken: string
  lineChannelAccessToken: string
}

export class StockDatabase {
  private readonly db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL CHECK(length(trim(name)) > 0),
        category TEXT NOT NULL CHECK(length(trim(category)) > 0),
        subcategory TEXT NOT NULL DEFAULT '',
        total_quantity INTEGER NOT NULL DEFAULT 0 CHECK(total_quantity >= 0),
        quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
        manufacture_date TEXT NULL,
        expiration_date TEXT NOT NULL,
        barcode TEXT NULL,
        notes TEXT NULL,
        image_data TEXT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_products_expiration ON products(expiration_date);
      CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
      CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);

      CREATE TABLE IF NOT EXISTS notification_settings (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        warning_days INTEGER NOT NULL DEFAULT 30,
        alert_time TEXT NOT NULL DEFAULT '08:00',
        timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok',
        telegram_enabled INTEGER NOT NULL DEFAULT 0,
        telegram_chat_id TEXT NOT NULL DEFAULT '',
        telegram_bot_token TEXT NOT NULL DEFAULT '',
        line_enabled INTEGER NOT NULL DEFAULT 0,
        line_target_id TEXT NOT NULL DEFAULT '',
        line_channel_access_token TEXT NOT NULL DEFAULT ''
      );

      INSERT OR IGNORE INTO notification_settings(id) VALUES (1);

      CREATE TABLE IF NOT EXISTS alert_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_date TEXT NOT NULL,
        channel TEXT NOT NULL CHECK(channel IN ('telegram', 'line')),
        sent_at TEXT NOT NULL DEFAULT (datetime('now')),
        item_count INTEGER NOT NULL,
        UNIQUE(run_date, channel)
      );

      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name)) > 0),
        image_data TEXT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS subcategories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        name TEXT NOT NULL COLLATE NOCASE CHECK(length(trim(name)) > 0),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(category_id, name)
      );
    `)

    const productColumns = this.db.prepare('PRAGMA table_info(products)').all() as Array<Record<string, unknown>>
    if (!productColumns.some((column) => column.name === 'total_quantity')) {
      this.db.exec(`
        ALTER TABLE products ADD COLUMN total_quantity INTEGER NOT NULL DEFAULT 0 CHECK(total_quantity >= 0);
        UPDATE products SET total_quantity = quantity;
      `)
    }
    if (!productColumns.some((column) => column.name === 'subcategory')) {
      this.db.exec(`ALTER TABLE products ADD COLUMN subcategory TEXT NOT NULL DEFAULT '';`)
    }
    if (!productColumns.some((column) => column.name === 'image_data')) {
      this.db.exec(`ALTER TABLE products ADD COLUMN image_data TEXT NULL;`)
    }
    const categoryColumns = this.db.prepare('PRAGMA table_info(categories)').all() as Array<Record<string, unknown>>
    if (!categoryColumns.some((column) => column.name === 'image_data')) {
      this.db.exec(`ALTER TABLE categories ADD COLUMN image_data TEXT NULL;`)
    }
    this.db.exec(`
      INSERT OR IGNORE INTO categories(name)
      SELECT DISTINCT trim(category) FROM products WHERE length(trim(category)) > 0;

      INSERT OR IGNORE INTO subcategories(category_id, name)
      SELECT c.id, trim(p.subcategory)
      FROM products p
      JOIN categories c ON c.name = p.category COLLATE NOCASE
      WHERE length(trim(p.subcategory)) > 0
      GROUP BY c.id, trim(p.subcategory);
    `)
  }

  private rowToProduct(row: ProductRow, warningDays: number): Product {
    const remaining = daysUntil(row.expiration_date)
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      subcategory: row.subcategory,
      totalQuantity: row.total_quantity,
      quantity: row.quantity,
      manufactureDate: row.manufacture_date,
      expirationDate: row.expiration_date,
      barcode: row.barcode,
      notes: row.notes,
      imageData: row.image_data,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      daysRemaining: remaining,
      status: expirationStatus(remaining, warningDays)
    }
  }

  listProducts(filters: ProductFilters = {}): Product[] {
    const search = (filters.search ?? '').trim().toLowerCase()
    const category = (filters.category ?? '').trim()
    const subcategory = (filters.subcategory ?? '').trim()
    const warningDays = this.getSettings().warningDays
    const rows = this.db.prepare('SELECT * FROM products ORDER BY expiration_date ASC, name COLLATE NOCASE ASC').all() as unknown as ProductRow[]

    return rows
      .map((row) => this.rowToProduct(row, warningDays))
      .filter((product) => {
        const matchesSearch = !search || [product.name, product.category, product.subcategory, product.barcode ?? '']
          .some((value) => value.toLowerCase().includes(search))
        const matchesCategory = !category || product.category === category
        const matchesSubcategory = !subcategory || product.subcategory === subcategory
        const matchesStatus = !filters.status || filters.status === 'all' || product.status === filters.status
        return matchesSearch && matchesCategory && matchesSubcategory && matchesStatus
      })
  }

  getProduct(id: number): Product {
    const row = this.db.prepare('SELECT * FROM products WHERE id = ?').get(id) as unknown as ProductRow | undefined
    if (!row) throw new Error('ไม่พบสินค้าที่เลือก')
    return this.rowToProduct(row, this.getSettings().warningDays)
  }

  createProduct(raw: ProductInput): Product {
    const input = validateProduct(raw)
    const result = this.db.prepare(`
      INSERT INTO products(name, category, subcategory, total_quantity, quantity, manufacture_date, expiration_date, barcode, notes, image_data)
      VALUES (@name, @category, @subcategory, @totalQuantity, @quantity, @manufactureDate, @expirationDate, @barcode, @notes, @imageData)
    `).run({
      name: input.name,
      category: input.category,
      subcategory: input.subcategory,
      totalQuantity: input.totalQuantity,
      quantity: input.quantity,
      manufactureDate: input.manufactureDate,
      expirationDate: input.expirationDate,
      barcode: input.barcode,
      notes: input.notes,
      imageData: input.imageData
    })
    this.ensureCategoryDefinitions(input.category, input.subcategory)
    return this.getProduct(Number(result.lastInsertRowid))
  }

  updateProduct(id: number, raw: ProductInput): Product {
    if (!Number.isInteger(id) || id < 1) throw new Error('รหัสสินค้าไม่ถูกต้อง')
    const input = validateProduct(raw)
    const result = this.db.prepare(`
      UPDATE products SET
        name = @name,
        category = @category,
        subcategory = @subcategory,
        total_quantity = @totalQuantity,
        quantity = @quantity,
        manufacture_date = @manufactureDate,
        expiration_date = @expirationDate,
        barcode = @barcode,
        notes = @notes,
        image_data = @imageData,
        updated_at = datetime('now')
      WHERE id = @id
    `).run({ id, ...input })
    if (result.changes === 0) throw new Error('ไม่พบสินค้าที่ต้องการแก้ไข')
    this.ensureCategoryDefinitions(input.category, input.subcategory)
    return this.getProduct(id)
  }

  adjustQuantity(id: number, delta: number): Product {
    if (!Number.isInteger(id) || id < 1) throw new Error('รหัสสินค้าไม่ถูกต้อง')
    if (!Number.isInteger(delta) || ![-1, 1].includes(delta)) throw new Error('ปรับจำนวนได้ครั้งละ 1 หน่วย')
    const product = this.getProduct(id)
    const nextQuantity = product.quantity + delta
    if (nextQuantity < 0) throw new Error('จำนวนคงเหลือไม่สามารถต่ำกว่า 0')
    if (nextQuantity > product.totalQuantity) throw new Error('จำนวนคงเหลือไม่สามารถมากกว่าจำนวนทั้งหมด')
    this.db.prepare(`UPDATE products SET quantity = ?, updated_at = datetime('now') WHERE id = ?`).run(nextQuantity, id)
    return this.getProduct(id)
  }

  removeProduct(id: number): void {
    if (!Number.isInteger(id) || id < 1) throw new Error('รหัสสินค้าไม่ถูกต้อง')
    const result = this.db.prepare('DELETE FROM products WHERE id = ?').run(id)
    if (result.changes === 0) throw new Error('ไม่พบสินค้าที่ต้องการลบ')
  }

  categories(): string[] {
    return (this.db.prepare(`SELECT name FROM categories ORDER BY name COLLATE NOCASE`).all() as unknown as Array<{ name: string }>)
      .map((row) => row.name)
  }

  categoryOptions(): Array<{ mainCategory: string; subcategory: string }> {
    return (this.db.prepare(`
      SELECT c.name AS mainCategory, COALESCE(s.name, '') AS subcategory
      FROM categories c
      LEFT JOIN subcategories s ON s.category_id = c.id
      ORDER BY c.name COLLATE NOCASE, s.name COLLATE NOCASE
    `).all() as unknown as Array<{ mainCategory: string; subcategory: string }>)
  }

  private cleanCategoryName(name: string, label: string): string {
    const cleaned = String(name ?? '').trim()
    if (!cleaned) throw new Error(`กรุณาระบุ${label}`)
    if (cleaned.length > 100) throw new Error(`${label}ยาวเกิน 100 ตัวอักษร`)
    return cleaned
  }

  private ensureCategoryDefinitions(category: string, subcategory: string): void {
    this.db.prepare('INSERT OR IGNORE INTO categories(name) VALUES (?)').run(category)
    if (!subcategory) return
    const main = this.db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE').get(category) as { id: number } | undefined
    if (main) this.db.prepare('INSERT OR IGNORE INTO subcategories(category_id, name) VALUES (?, ?)').run(main.id, subcategory)
  }

  listCategoryTree(): CategorySummary[] {
    const categories = this.db.prepare(`
      SELECT c.id, c.name, c.image_data AS imageData,
        COUNT(p.id) AS productCount,
        COALESCE(SUM(p.quantity), 0) AS remainingUnits
      FROM categories c
      LEFT JOIN products p ON p.category = c.name COLLATE NOCASE
      GROUP BY c.id, c.name, c.image_data
      ORDER BY c.name COLLATE NOCASE
    `).all() as unknown as Array<{ id: number; name: string; imageData: string | null; productCount: number; remainingUnits: number }>
    const subcategories = this.db.prepare(`
      SELECT s.id, s.category_id AS categoryId, s.name,
        COUNT(p.id) AS productCount,
        COALESCE(SUM(p.quantity), 0) AS remainingUnits
      FROM subcategories s
      JOIN categories c ON c.id = s.category_id
      LEFT JOIN products p ON p.category = c.name COLLATE NOCASE AND p.subcategory = s.name COLLATE NOCASE
      GROUP BY s.id, s.category_id, s.name
      ORDER BY s.name COLLATE NOCASE
    `).all() as unknown as Array<{ id: number; categoryId: number; name: string; productCount: number; remainingUnits: number }>
    return categories.map((category) => ({
      ...category,
      productCount: Number(category.productCount),
      remainingUnits: Number(category.remainingUnits),
      subcategories: subcategories
        .filter((subcategory) => subcategory.categoryId === category.id)
        .map((subcategory) => ({ ...subcategory, productCount: Number(subcategory.productCount), remainingUnits: Number(subcategory.remainingUnits) }))
    }))
  }

  createMainCategory(name: string, imageData: string | null = null): void {
    const cleaned = this.cleanCategoryName(name, 'ชื่อหมวดหมู่หลัก')
    try {
      this.db.prepare('INSERT INTO categories(name, image_data) VALUES (?, ?)').run(cleaned, imageData)
    } catch {
      throw new Error('มีหมวดหมู่หลักชื่อนี้แล้ว')
    }
  }

  setMainCategoryImage(id: number, imageData: string | null): void {
    if (!Number.isInteger(id) || id < 1) throw new Error('รหัสหมวดหมู่ไม่ถูกต้อง')
    if (imageData && (!imageData.startsWith('data:image/') || imageData.length > 1_500_000)) throw new Error('รูปภาพไม่ถูกต้องหรือมีขนาดใหญ่เกินไป')
    const result = this.db.prepare(`UPDATE categories SET image_data = ?, updated_at = datetime('now') WHERE id = ?`).run(imageData, id)
    if (result.changes === 0) throw new Error('ไม่พบหมวดหมู่หลัก')
  }

  renameMainCategory(id: number, name: string): void {
    const cleaned = this.cleanCategoryName(name, 'ชื่อหมวดหมู่หลัก')
    const current = this.db.prepare('SELECT name FROM categories WHERE id = ?').get(id) as { name: string } | undefined
    if (!current) throw new Error('ไม่พบหมวดหมู่หลัก')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`UPDATE products SET category = ?, updated_at = datetime('now') WHERE category = ? COLLATE NOCASE`).run(cleaned, current.name)
      this.db.prepare(`UPDATE categories SET name = ?, updated_at = datetime('now') WHERE id = ?`).run(cleaned, id)
      this.db.exec('COMMIT')
    } catch {
      this.db.exec('ROLLBACK')
      throw new Error('ไม่สามารถเปลี่ยนชื่อได้ อาจมีหมวดหมู่นี้อยู่แล้ว')
    }
  }

  removeMainCategory(id: number): void {
    const current = this.db.prepare('SELECT name FROM categories WHERE id = ?').get(id) as { name: string } | undefined
    if (!current) throw new Error('ไม่พบหมวดหมู่หลัก')
    const usage = this.db.prepare('SELECT COUNT(*) AS count FROM products WHERE category = ? COLLATE NOCASE').get(current.name) as { count: number }
    if (Number(usage.count) > 0) throw new Error('ลบไม่ได้ เพราะยังมีสินค้าอยู่ในหมวดหมู่นี้')
    this.db.prepare('DELETE FROM categories WHERE id = ?').run(id)
  }

  createSubcategory(categoryId: number, name: string): void {
    const cleaned = this.cleanCategoryName(name, 'ชื่อหมวดหมู่รอง')
    if (!this.db.prepare('SELECT 1 FROM categories WHERE id = ?').get(categoryId)) throw new Error('ไม่พบหมวดหมู่หลัก')
    try {
      this.db.prepare('INSERT INTO subcategories(category_id, name) VALUES (?, ?)').run(categoryId, cleaned)
    } catch {
      throw new Error('มีหมวดหมู่รองชื่อนี้แล้ว')
    }
  }

  renameSubcategory(id: number, name: string): void {
    const cleaned = this.cleanCategoryName(name, 'ชื่อหมวดหมู่รอง')
    const current = this.db.prepare(`
      SELECT s.name, c.name AS categoryName FROM subcategories s
      JOIN categories c ON c.id = s.category_id WHERE s.id = ?
    `).get(id) as { name: string; categoryName: string } | undefined
    if (!current) throw new Error('ไม่พบหมวดหมู่รอง')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`UPDATE products SET subcategory = ?, updated_at = datetime('now') WHERE category = ? COLLATE NOCASE AND subcategory = ? COLLATE NOCASE`).run(cleaned, current.categoryName, current.name)
      this.db.prepare(`UPDATE subcategories SET name = ?, updated_at = datetime('now') WHERE id = ?`).run(cleaned, id)
      this.db.exec('COMMIT')
    } catch {
      this.db.exec('ROLLBACK')
      throw new Error('ไม่สามารถเปลี่ยนชื่อได้ อาจมีหมวดหมู่รองนี้อยู่แล้ว')
    }
  }

  removeSubcategory(id: number): void {
    const current = this.db.prepare(`
      SELECT s.name, c.name AS categoryName FROM subcategories s
      JOIN categories c ON c.id = s.category_id WHERE s.id = ?
    `).get(id) as { name: string; categoryName: string } | undefined
    if (!current) throw new Error('ไม่พบหมวดหมู่รอง')
    const usage = this.db.prepare(`SELECT COUNT(*) AS count FROM products WHERE category = ? COLLATE NOCASE AND subcategory = ? COLLATE NOCASE`).get(current.categoryName, current.name) as { count: number }
    if (Number(usage.count) > 0) throw new Error('ลบไม่ได้ เพราะยังมีสินค้าอยู่ในหมวดหมู่รองนี้')
    this.db.prepare('DELETE FROM subcategories WHERE id = ?').run(id)
  }

  summary(): DashboardSummary {
    const products = this.listProducts()
    return {
      totalProducts: products.length,
      totalUnits: products.reduce((sum, product) => sum + product.quantity, 0),
      totalCapacity: products.reduce((sum, product) => sum + product.totalQuantity, 0),
      expired: products.filter((product) => product.status === 'expired').length,
      expiring: products.filter((product) => product.status === 'expiring').length,
      safe: products.filter((product) => product.status === 'safe').length
    }
  }

  private settingsRow(): SettingsRow {
    return this.db.prepare('SELECT * FROM notification_settings WHERE id = 1').get() as unknown as SettingsRow
  }

  getSettings(): NotificationSettingsPublic {
    const row = this.settingsRow()
    return {
      warningDays: row.warning_days,
      alertTime: row.alert_time,
      timezone: row.timezone,
      telegramEnabled: Boolean(row.telegram_enabled),
      telegramChatId: row.telegram_chat_id,
      telegramTokenConfigured: Boolean(row.telegram_bot_token),
      lineEnabled: Boolean(row.line_enabled),
      lineTargetId: row.line_target_id,
      lineTokenConfigured: Boolean(row.line_channel_access_token)
    }
  }

  getNotificationSettings(): NotificationSettingsInternal {
    const row = this.settingsRow()
    return {
      ...this.getSettings(),
      telegramBotToken: decryptSecret(row.telegram_bot_token),
      lineChannelAccessToken: decryptSecret(row.line_channel_access_token)
    }
  }

  saveSettings(raw: NotificationSettingsUpdate): NotificationSettingsPublic {
    const input = validateSettings(raw)
    const current = this.settingsRow()
    const telegramToken = input.clearTelegramToken
      ? ''
      : input.telegramBotToken?.trim()
        ? encryptSecret(input.telegramBotToken.trim())
        : current.telegram_bot_token
    const lineToken = input.clearLineToken
      ? ''
      : input.lineChannelAccessToken?.trim()
        ? encryptSecret(input.lineChannelAccessToken.trim())
        : current.line_channel_access_token

    if (input.telegramEnabled && !telegramToken) throw new Error('กรุณาระบุ Telegram Bot Token')
    if (input.lineEnabled && !lineToken) throw new Error('กรุณาระบุ LINE Channel Access Token')

    this.db.prepare(`
      UPDATE notification_settings SET
        warning_days = @warningDays,
        alert_time = @alertTime,
        timezone = @timezone,
        telegram_enabled = @telegramEnabled,
        telegram_chat_id = @telegramChatId,
        telegram_bot_token = @telegramToken,
        line_enabled = @lineEnabled,
        line_target_id = @lineTargetId,
        line_channel_access_token = @lineToken
      WHERE id = 1
    `).run({
      warningDays: input.warningDays,
      alertTime: input.alertTime,
      timezone: input.timezone,
      telegramEnabled: Number(input.telegramEnabled),
      telegramChatId: input.telegramChatId,
      lineEnabled: Number(input.lineEnabled),
      lineTargetId: input.lineTargetId,
      telegramToken,
      lineToken
    })
    return this.getSettings()
  }

  productsNeedingAlert(): Product[] {
    return this.listProducts().filter((product) => product.status !== 'safe')
  }

  wasAlertSentToday(channel: 'telegram' | 'line'): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM alert_runs WHERE run_date = ? AND channel = ?').get(todayIso(), channel))
  }

  recordAlertRun(channel: 'telegram' | 'line', itemCount: number): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO alert_runs(run_date, channel, item_count) VALUES (?, ?, ?)
    `).run(todayIso(), channel, itemCount)
  }

  importProducts(inputs: ProductInput[]): { imported: number; skipped: number; errors: string[] } {
    const errors: string[] = []
    let imported = 0
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const items = inputs
      items.forEach((item, index) => {
        try {
          this.createProduct(item)
          imported += 1
        } catch (error) {
          errors.push(`แถว ${index + 2}: ${error instanceof Error ? error.message : String(error)}`)
        }
      })
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return { imported, skipped: inputs.length - imported, errors }
  }

  close(): void {
    this.db.close()
  }
}
