PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE products (
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

CREATE INDEX idx_products_expiration ON products(expiration_date);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_barcode ON products(barcode);

CREATE TABLE notification_settings (
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

CREATE TABLE alert_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_date TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('telegram', 'line')),
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  item_count INTEGER NOT NULL,
  UNIQUE(run_date, channel)
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name)) > 0),
  image_data TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE subcategories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE CHECK(length(trim(name)) > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(category_id, name)
);
