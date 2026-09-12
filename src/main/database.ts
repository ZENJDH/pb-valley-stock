import { DatabaseSync } from 'node:sqlite'
import type {
  DashboardSummary,
  CategorySummary,
  InventoryMode,
  NotificationSettingsPublic,
  NotificationSettingsUpdate,
  Product,
  ProductFilters,
  ProductInput,
  StockActivity,
  StockActivityType
} from '../shared/types'
import { daysUntil, expirationStatus, todayIso } from './expiration'
import { decryptSecret, encryptSecret } from './secrets'
import { validateProduct, validateSettings } from './validation'

interface ProductRow {
  id: number
  inventory_mode: InventoryMode
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

interface StockActivityRow {
  id: number
  inventory_mode: InventoryMode
  product_id: number | null
  product_name: string
  action_type: string
  delta: number
  previous_quantity: number
  new_quantity: number
  unit: string
  is_read: number
  created_at: string
}

function toStockActivity(row: StockActivityRow): StockActivity {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    actionType: row.action_type as StockActivityType,
    delta: row.delta,
    previousQuantity: row.previous_quantity,
    newQuantity: row.new_quantity,
    unit: row.unit,
    isRead: Boolean(row.is_read),
    createdAt: row.created_at
  }
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
        inventory_mode TEXT NOT NULL DEFAULT 'products' CHECK(inventory_mode IN ('products', 'agrochemicals')),
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

      CREATE TABLE IF NOT EXISTS stock_activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        inventory_mode TEXT NOT NULL DEFAULT 'products' CHECK(inventory_mode IN ('products', 'agrochemicals')),
        product_id INTEGER,
        product_name TEXT NOT NULL,
        action_type TEXT NOT NULL,
        delta INTEGER NOT NULL,
        previous_quantity INTEGER NOT NULL,
        new_quantity INTEGER NOT NULL,
        unit TEXT NOT NULL DEFAULT 'ชิ้น',
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );

      CREATE INDEX IF NOT EXISTS idx_stock_activities_id ON stock_activities(id DESC);

      CREATE TABLE IF NOT EXISTS inventory_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        inventory_mode TEXT NOT NULL CHECK(inventory_mode IN ('products', 'agrochemicals')),
        name TEXT NOT NULL COLLATE NOCASE CHECK(length(trim(name)) > 0),
        image_data TEXT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(inventory_mode, name)
      );

      CREATE TABLE IF NOT EXISTS inventory_subcategories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL REFERENCES inventory_categories(id) ON DELETE CASCADE,
        name TEXT NOT NULL COLLATE NOCASE CHECK(length(trim(name)) > 0),
        image_data TEXT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(category_id, name)
      );

      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
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
    if (!productColumns.some((column) => column.name === 'inventory_mode')) {
      this.db.exec(`ALTER TABLE products ADD COLUMN inventory_mode TEXT NOT NULL DEFAULT 'products' CHECK(inventory_mode IN ('products', 'agrochemicals'));`)
    }
    const categoryColumns = this.db.prepare('PRAGMA table_info(categories)').all() as Array<Record<string, unknown>>
    if (!categoryColumns.some((column) => column.name === 'image_data')) {
      this.db.exec(`ALTER TABLE categories ADD COLUMN image_data TEXT NULL;`)
    }
    const subcategoryColumns = this.db.prepare('PRAGMA table_info(subcategories)').all() as Array<Record<string, unknown>>
    if (!subcategoryColumns.some((column) => column.name === 'image_data')) {
      this.db.exec(`ALTER TABLE subcategories ADD COLUMN image_data TEXT NULL;`)
    }
    const activityColumns = this.db.prepare('PRAGMA table_info(stock_activities)').all() as Array<Record<string, unknown>>
    if (!activityColumns.some((column) => column.name === 'inventory_mode')) {
      this.db.exec(`ALTER TABLE stock_activities ADD COLUMN inventory_mode TEXT NOT NULL DEFAULT 'products' CHECK(inventory_mode IN ('products', 'agrochemicals'));`)
    }
    const inventoryCatalogSeeded = this.db.prepare(`SELECT value FROM app_meta WHERE key = 'inventory_catalog_seeded'`).get()
    if (!inventoryCatalogSeeded) {
      this.db.exec(`
        BEGIN IMMEDIATE;
        INSERT OR IGNORE INTO inventory_categories(id, inventory_mode, name, image_data, created_at, updated_at)
        SELECT id, 'products', name, image_data, created_at, updated_at FROM categories;
        INSERT OR IGNORE INTO inventory_subcategories(id, category_id, name, image_data, created_at, updated_at)
        SELECT id, category_id, name, image_data, created_at, updated_at FROM subcategories;
        INSERT INTO app_meta(key, value) VALUES ('inventory_catalog_seeded', '1');
        COMMIT;
      `)
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_products_inventory_mode ON products(inventory_mode);
      CREATE INDEX IF NOT EXISTS idx_stock_activities_inventory_mode ON stock_activities(inventory_mode, id DESC);
      CREATE INDEX IF NOT EXISTS idx_inventory_categories_mode ON inventory_categories(inventory_mode, name);

      INSERT OR IGNORE INTO inventory_categories(inventory_mode, name) VALUES
        ('agrochemicals', 'OP'),
        ('agrochemicals', 'โกโก้'),
        ('agrochemicals', 'ส่งเสริม');

      INSERT OR IGNORE INTO inventory_subcategories(category_id, name)
      SELECT id, 'ปุ๋ย' FROM inventory_categories WHERE inventory_mode = 'agrochemicals';
      INSERT OR IGNORE INTO inventory_subcategories(category_id, name)
      SELECT id, 'สารเคมี' FROM inventory_categories WHERE inventory_mode = 'agrochemicals';
      INSERT OR IGNORE INTO inventory_subcategories(category_id, name)
      SELECT id, 'วัสดุการเกษตร' FROM inventory_categories WHERE inventory_mode = 'agrochemicals';

      INSERT OR IGNORE INTO inventory_categories(inventory_mode, name)
      SELECT inventory_mode, trim(category) FROM products WHERE length(trim(category)) > 0
      GROUP BY inventory_mode, trim(category);

      INSERT OR IGNORE INTO inventory_subcategories(category_id, name)
      SELECT c.id, trim(p.subcategory)
      FROM products p
      JOIN inventory_categories c ON c.inventory_mode = p.inventory_mode AND c.name = p.category COLLATE NOCASE
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
    const inventoryMode = filters.inventoryMode ?? 'products'
    const warningDays = this.getSettings().warningDays
    const orderDirection = inventoryMode === 'agrochemicals' ? 'DESC' : 'ASC'
    const rows = this.db.prepare(`SELECT * FROM products WHERE inventory_mode = ? ORDER BY expiration_date ${orderDirection}, name COLLATE NOCASE ASC`).all(inventoryMode) as unknown as ProductRow[]

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

  getProduct(id: number, inventoryMode: InventoryMode = 'products'): Product {
    const row = this.db.prepare('SELECT * FROM products WHERE id = ? AND inventory_mode = ?').get(id, inventoryMode) as unknown as ProductRow | undefined
    if (!row) throw new Error('ไม่พบสินค้าที่เลือก')
    return this.rowToProduct(row, this.getSettings().warningDays)
  }

  createProduct(raw: ProductInput, inventoryMode: InventoryMode = 'products'): Product {
    const input = validateProduct(raw)
    const result = this.db.prepare(`
      INSERT INTO products(inventory_mode, name, category, subcategory, total_quantity, quantity, manufacture_date, expiration_date, barcode, notes, image_data)
      VALUES (@inventoryMode, @name, @category, @subcategory, @totalQuantity, @quantity, @manufactureDate, @expirationDate, @barcode, @notes, @imageData)
    `).run({
      inventoryMode,
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
    this.ensureCategoryDefinitions(input.category, input.subcategory, inventoryMode)
    const newProduct = this.getProduct(Number(result.lastInsertRowid), inventoryMode)
    try {
      this.logActivity({
        productId: newProduct.id,
        productName: newProduct.name,
        actionType: 'create',
        delta: newProduct.quantity,
        previousQuantity: 0,
        newQuantity: newProduct.quantity,
        unit: 'ชิ้น'
      }, inventoryMode)
    } catch {
      // ignore logging errors
    }
    return newProduct
  }

  updateProduct(id: number, raw: ProductInput, inventoryMode: InventoryMode = 'products'): Product {
    if (!Number.isInteger(id) || id < 1) throw new Error('รหัสสินค้าไม่ถูกต้อง')
    const oldProduct = this.getProduct(id, inventoryMode)
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
      WHERE id = @id AND inventory_mode = @inventoryMode
    `).run({ id, inventoryMode, ...input })
    if (result.changes === 0) throw new Error('ไม่พบสินค้าที่ต้องการแก้ไข')
    this.ensureCategoryDefinitions(input.category, input.subcategory, inventoryMode)
    if (input.quantity !== oldProduct.quantity) {
      try {
        const delta = input.quantity - oldProduct.quantity
        this.logActivity({
          productId: id,
          productName: input.name,
          actionType: delta > 0 ? 'increase' : 'decrease',
          delta,
          previousQuantity: oldProduct.quantity,
          newQuantity: input.quantity,
          unit: 'ชิ้น'
        }, inventoryMode)
      } catch {
        // ignore logging errors
      }
    }
    return this.getProduct(id, inventoryMode)
  }

  adjustQuantity(id: number, delta: number, inventoryMode: InventoryMode = 'products'): Product {
    if (!Number.isInteger(id) || id < 1) throw new Error('รหัสสินค้าไม่ถูกต้อง')
    if (!Number.isInteger(delta) || delta === 0) throw new Error('จำนวนที่ปรับต้องไม่เป็นศูนย์')
    const product = this.getProduct(id, inventoryMode)
    const nextQuantity = product.quantity + delta
    if (nextQuantity < 0) throw new Error('จำนวนคงเหลือไม่สามารถต่ำกว่า 0')
    if (nextQuantity > product.totalQuantity) throw new Error('จำนวนคงเหลือไม่สามารถมากกว่าจำนวนทั้งหมด')
    this.db.prepare(`UPDATE products SET quantity = ?, updated_at = datetime('now') WHERE id = ? AND inventory_mode = ?`).run(nextQuantity, id, inventoryMode)
    try {
      this.logActivity({
        productId: product.id,
        productName: product.name,
        actionType: delta > 0 ? 'increase' : 'decrease',
        delta,
        previousQuantity: product.quantity,
        newQuantity: nextQuantity,
        unit: 'ชิ้น'
      }, inventoryMode)
    } catch {
      // ignore logging errors
    }
    return this.getProduct(id, inventoryMode)
  }

  removeProduct(id: number, inventoryMode: InventoryMode = 'products'): void {
    if (!Number.isInteger(id) || id < 1) throw new Error('รหัสสินค้าไม่ถูกต้อง')
    let product: Product | null = null
    try {
      product = this.getProduct(id, inventoryMode)
    } catch {
      // not found
    }
    const result = this.db.prepare('DELETE FROM products WHERE id = ? AND inventory_mode = ?').run(id, inventoryMode)
    if (result.changes === 0) throw new Error('ไม่พบสินค้าที่ต้องการลบ')
    if (product) {
      try {
        this.logActivity({
          productId: id,
          productName: product.name,
          actionType: 'delete',
          delta: -product.quantity,
          previousQuantity: product.quantity,
          newQuantity: 0,
          unit: 'ชิ้น'
        }, inventoryMode)
      } catch {
        // ignore logging errors
      }
    }
  }

  getActivities(limit = 50, inventoryMode: InventoryMode = 'products'): StockActivity[] {
    const rows = this.db.prepare(`
      SELECT id, inventory_mode, product_id, product_name, action_type, delta, previous_quantity, new_quantity, unit, is_read, created_at
      FROM stock_activities
      WHERE inventory_mode = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(inventoryMode, limit) as unknown as StockActivityRow[]
    return rows.map(toStockActivity)
  }

  logActivity(activity: {
    productId?: number | null
    productName: string
    actionType: StockActivityType
    delta: number
    previousQuantity: number
    newQuantity: number
    unit?: string
  }, inventoryMode: InventoryMode = 'products'): StockActivity {
    const result = this.db.prepare(`
      INSERT INTO stock_activities (inventory_mode, product_id, product_name, action_type, delta, previous_quantity, new_quantity, unit, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now', 'localtime'))
    `).run(
      inventoryMode,
      activity.productId ?? null,
      activity.productName,
      activity.actionType,
      activity.delta,
      activity.previousQuantity,
      activity.newQuantity,
      activity.unit ?? 'ชิ้น'
    )
    const row = this.db.prepare(`SELECT * FROM stock_activities WHERE id = ?`).get(Number(result.lastInsertRowid)) as unknown as StockActivityRow
    return toStockActivity(row)
  }

  markActivitiesAsRead(inventoryMode: InventoryMode = 'products'): void {
    this.db.prepare(`UPDATE stock_activities SET is_read = 1 WHERE is_read = 0 AND inventory_mode = ?`).run(inventoryMode)
  }

  clearActivities(inventoryMode: InventoryMode = 'products'): void {
    this.db.prepare(`DELETE FROM stock_activities WHERE inventory_mode = ?`).run(inventoryMode)
  }

  categories(inventoryMode: InventoryMode = 'products'): string[] {
    return (this.db.prepare(`SELECT name FROM inventory_categories WHERE inventory_mode = ? ORDER BY name COLLATE NOCASE`).all(inventoryMode) as unknown as Array<{ name: string }>)
      .map((row) => row.name)
  }

  categoryOptions(inventoryMode: InventoryMode = 'products'): Array<{ mainCategory: string; subcategory: string }> {
    return (this.db.prepare(`
      SELECT c.name AS mainCategory, COALESCE(s.name, '') AS subcategory
      FROM inventory_categories c
      LEFT JOIN inventory_subcategories s ON s.category_id = c.id
      WHERE c.inventory_mode = ?
      ORDER BY c.name COLLATE NOCASE, s.name COLLATE NOCASE
    `).all(inventoryMode) as unknown as Array<{ mainCategory: string; subcategory: string }>)
  }

  private cleanCategoryName(name: string, label: string): string {
    const cleaned = String(name ?? '').trim()
    if (!cleaned) throw new Error(`กรุณาระบุ${label}`)
    if (cleaned.length > 100) throw new Error(`${label}ยาวเกิน 100 ตัวอักษร`)
    return cleaned
  }

  private ensureCategoryDefinitions(category: string, subcategory: string, inventoryMode: InventoryMode): void {
    this.db.prepare('INSERT OR IGNORE INTO inventory_categories(inventory_mode, name) VALUES (?, ?)').run(inventoryMode, category)
    if (!subcategory) return
    const main = this.db.prepare('SELECT id FROM inventory_categories WHERE inventory_mode = ? AND name = ? COLLATE NOCASE').get(inventoryMode, category) as { id: number } | undefined
    if (main) this.db.prepare('INSERT OR IGNORE INTO inventory_subcategories(category_id, name) VALUES (?, ?)').run(main.id, subcategory)
  }

  listCategoryTree(inventoryMode: InventoryMode = 'products'): CategorySummary[] {
    const categories = this.db.prepare(`
      SELECT c.id, c.name, c.image_data AS imageData,
        COUNT(p.id) AS productCount,
        COALESCE(SUM(p.quantity), 0) AS remainingUnits
      FROM inventory_categories c
      LEFT JOIN products p ON p.inventory_mode = c.inventory_mode AND p.category = c.name COLLATE NOCASE
      WHERE c.inventory_mode = ?
      GROUP BY c.id, c.name, c.image_data
      ORDER BY c.name COLLATE NOCASE
    `).all(inventoryMode) as unknown as Array<{ id: number; name: string; imageData: string | null; productCount: number; remainingUnits: number }>
    const subcategories = this.db.prepare(`
      SELECT s.id, s.category_id AS categoryId, s.name, s.image_data AS imageData,
        COUNT(p.id) AS productCount,
        COALESCE(SUM(p.quantity), 0) AS remainingUnits
      FROM inventory_subcategories s
      JOIN inventory_categories c ON c.id = s.category_id
      LEFT JOIN products p ON p.inventory_mode = c.inventory_mode AND p.category = c.name COLLATE NOCASE AND p.subcategory = s.name COLLATE NOCASE
      WHERE c.inventory_mode = ?
      GROUP BY s.id, s.category_id, s.name, s.image_data
      ORDER BY s.name COLLATE NOCASE
    `).all(inventoryMode) as unknown as Array<{ id: number; categoryId: number; name: string; imageData: string | null; productCount: number; remainingUnits: number }>
    return categories.map((category) => ({
      ...category,
      productCount: Number(category.productCount),
      remainingUnits: Number(category.remainingUnits),
      subcategories: subcategories
        .filter((subcategory) => subcategory.categoryId === category.id)
        .map((subcategory) => ({
          ...subcategory,
          imageData: subcategory.imageData ?? null,
          productCount: Number(subcategory.productCount),
          remainingUnits: Number(subcategory.remainingUnits)
        }))
    }))
  }

  createMainCategory(name: string, imageData: string | null = null, inventoryMode: InventoryMode = 'products'): void {
    const cleaned = this.cleanCategoryName(name, 'ชื่อหมวดหมู่หลัก')
    try {
      this.db.prepare('INSERT INTO inventory_categories(inventory_mode, name, image_data) VALUES (?, ?, ?)').run(inventoryMode, cleaned, imageData)
    } catch {
      throw new Error('มีหมวดหมู่หลักชื่อนี้แล้ว')
    }
  }

  setMainCategoryImage(id: number, imageData: string | null, inventoryMode: InventoryMode = 'products'): void {
    if (!Number.isInteger(id) || id < 1) throw new Error('รหัสหมวดหมู่ไม่ถูกต้อง')
    if (imageData && (!imageData.startsWith('data:image/') || imageData.length > 1_500_000)) throw new Error('รูปภาพไม่ถูกต้องหรือมีขนาดใหญ่เกินไป')
    const result = this.db.prepare(`UPDATE inventory_categories SET image_data = ?, updated_at = datetime('now') WHERE id = ? AND inventory_mode = ?`).run(imageData, id, inventoryMode)
    if (result.changes === 0) throw new Error('ไม่พบหมวดหมู่หลัก')
  }

  renameMainCategory(id: number, name: string, inventoryMode: InventoryMode = 'products'): void {
    const cleaned = this.cleanCategoryName(name, 'ชื่อหมวดหมู่หลัก')
    const current = this.db.prepare('SELECT name FROM inventory_categories WHERE id = ? AND inventory_mode = ?').get(id, inventoryMode) as { name: string } | undefined
    if (!current) throw new Error('ไม่พบหมวดหมู่หลัก')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`UPDATE products SET category = ?, updated_at = datetime('now') WHERE inventory_mode = ? AND category = ? COLLATE NOCASE`).run(cleaned, inventoryMode, current.name)
      this.db.prepare(`UPDATE inventory_categories SET name = ?, updated_at = datetime('now') WHERE id = ? AND inventory_mode = ?`).run(cleaned, id, inventoryMode)
      this.db.exec('COMMIT')
    } catch {
      this.db.exec('ROLLBACK')
      throw new Error('ไม่สามารถเปลี่ยนชื่อได้ อาจมีหมวดหมู่นี้อยู่แล้ว')
    }
  }

  removeMainCategory(id: number, inventoryMode: InventoryMode = 'products'): void {
    const current = this.db.prepare('SELECT name FROM inventory_categories WHERE id = ? AND inventory_mode = ?').get(id, inventoryMode) as { name: string } | undefined
    if (!current) throw new Error('ไม่พบหมวดหมู่หลัก')
    const usage = this.db.prepare('SELECT COUNT(*) AS count FROM products WHERE inventory_mode = ? AND category = ? COLLATE NOCASE').get(inventoryMode, current.name) as { count: number }
    if (Number(usage.count) > 0) throw new Error('ลบไม่ได้ เพราะยังมีสินค้าอยู่ในหมวดหมู่นี้')
    this.db.prepare('DELETE FROM inventory_categories WHERE id = ? AND inventory_mode = ?').run(id, inventoryMode)
  }

  createSubcategory(categoryId: number, name: string, imageData: string | null = null, inventoryMode: InventoryMode = 'products'): void {
    const cleaned = this.cleanCategoryName(name, 'ชื่อหมวดหมู่รอง')
    if (!this.db.prepare('SELECT 1 FROM inventory_categories WHERE id = ? AND inventory_mode = ?').get(categoryId, inventoryMode)) throw new Error('ไม่พบหมวดหมู่หลัก')
    try {
      this.db.prepare('INSERT INTO inventory_subcategories(category_id, name, image_data) VALUES (?, ?, ?)').run(categoryId, cleaned, imageData)
    } catch {
      throw new Error('มีหมวดหมู่รองชื่อนี้แล้ว')
    }
  }

  setSubcategoryImage(id: number, imageData: string | null, inventoryMode: InventoryMode = 'products'): void {
    if (!Number.isInteger(id) || id < 1) throw new Error('รหัสหมวดหมู่รองไม่ถูกต้อง')
    if (imageData && (!imageData.startsWith('data:image/') || imageData.length > 1_500_000)) throw new Error('รูปภาพไม่ถูกต้องหรือมีขนาดใหญ่เกินไป')
    const result = this.db.prepare(`
      UPDATE inventory_subcategories SET image_data = ?, updated_at = datetime('now')
      WHERE id = ? AND category_id IN (SELECT id FROM inventory_categories WHERE inventory_mode = ?)
    `).run(imageData, id, inventoryMode)
    if (result.changes === 0) throw new Error('ไม่พบหมวดหมู่รอง')
  }

  renameSubcategory(id: number, name: string, inventoryMode: InventoryMode = 'products'): void {
    const cleaned = this.cleanCategoryName(name, 'ชื่อหมวดหมู่รอง')
    const current = this.db.prepare(`
      SELECT s.name, c.name AS categoryName FROM inventory_subcategories s
      JOIN inventory_categories c ON c.id = s.category_id WHERE s.id = ? AND c.inventory_mode = ?
    `).get(id, inventoryMode) as { name: string; categoryName: string } | undefined
    if (!current) throw new Error('ไม่พบหมวดหมู่รอง')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`UPDATE products SET subcategory = ?, updated_at = datetime('now') WHERE inventory_mode = ? AND category = ? COLLATE NOCASE AND subcategory = ? COLLATE NOCASE`).run(cleaned, inventoryMode, current.categoryName, current.name)
      this.db.prepare(`UPDATE inventory_subcategories SET name = ?, updated_at = datetime('now') WHERE id = ?`).run(cleaned, id)
      this.db.exec('COMMIT')
    } catch {
      this.db.exec('ROLLBACK')
      throw new Error('ไม่สามารถเปลี่ยนชื่อได้ อาจมีหมวดหมู่รองนี้อยู่แล้ว')
    }
  }

  removeSubcategory(id: number, inventoryMode: InventoryMode = 'products'): void {
    const current = this.db.prepare(`
      SELECT s.name, c.name AS categoryName FROM inventory_subcategories s
      JOIN inventory_categories c ON c.id = s.category_id WHERE s.id = ? AND c.inventory_mode = ?
    `).get(id, inventoryMode) as { name: string; categoryName: string } | undefined
    if (!current) throw new Error('ไม่พบหมวดหมู่รอง')
    const usage = this.db.prepare(`SELECT COUNT(*) AS count FROM products WHERE inventory_mode = ? AND category = ? COLLATE NOCASE AND subcategory = ? COLLATE NOCASE`).get(inventoryMode, current.categoryName, current.name) as { count: number }
    if (Number(usage.count) > 0) throw new Error('ลบไม่ได้ เพราะยังมีสินค้าอยู่ในหมวดหมู่รองนี้')
    this.db.prepare('DELETE FROM inventory_subcategories WHERE id = ?').run(id)
  }

  summary(inventoryMode: InventoryMode = 'products'): DashboardSummary {
    const products = this.listProducts({ inventoryMode })
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
    return this.listProducts({ inventoryMode: 'products' })
      .filter((product) => product.status !== 'safe')
  }

  wasAlertSentToday(channel: 'telegram' | 'line'): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM alert_runs WHERE run_date = ? AND channel = ?').get(todayIso(), channel))
  }

  recordAlertRun(channel: 'telegram' | 'line', itemCount: number): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO alert_runs(run_date, channel, item_count) VALUES (?, ?, ?)
    `).run(todayIso(), channel, itemCount)
  }

  importProducts(inputs: ProductInput[], inventoryMode: InventoryMode = 'products'): { imported: number; skipped: number; errors: string[] } {
    const errors: string[] = []
    let imported = 0
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const items = inputs
      items.forEach((item, index) => {
        try {
          this.createProduct(item, inventoryMode)
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
