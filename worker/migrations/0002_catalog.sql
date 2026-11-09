-- ============================================================================
-- Migration 0002: Product Catalog & Categories
-- Target: Cloudflare D1 (SQLite)
-- ============================================================================

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  parent_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('active', 'archived')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, slug)
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  sku TEXT NOT NULL,
  barcode TEXT,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  unit TEXT NOT NULL CHECK(unit IN ('piece', 'kg', 'gram', 'liter', 'meter', 'box', 'pack', 'dozen')),
  purchase_price_minor INTEGER NOT NULL DEFAULT 0 CHECK(purchase_price_minor >= 0),
  selling_price_minor INTEGER NOT NULL DEFAULT 0 CHECK(selling_price_minor >= 0),
  low_stock_threshold REAL NOT NULL DEFAULT 5.0 CHECK(low_stock_threshold >= 0),
  track_inventory INTEGER NOT NULL DEFAULT 1 CHECK(track_inventory IN (0, 1)),
  status TEXT NOT NULL CHECK(status IN ('active', 'archived')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, sku)
);

