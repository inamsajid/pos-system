-- ============================================================================
-- Migration 0007: Inventory Balances, Stock Movements, Adjustments & Counts
-- Target: Cloudflare D1 (SQLite)
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory_balances (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity_on_hand REAL NOT NULL DEFAULT 0.0,
  quarantine_quantity REAL NOT NULL DEFAULT 0.0 CHECK(quarantine_quantity >= 0),
  allocated_quantity REAL NOT NULL DEFAULT 0.0 CHECK(allocated_quantity >= 0),
  last_counted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(branch_id, product_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  movement_number TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN (
    'opening_stock', 'purchase_receipt', 'sale', 'adjustment_in', 'adjustment_out',
    'stock_count_adjustment', 'return_restock', 'return_damaged', 'return_discard'
  )),
  quantity_change REAL NOT NULL,
  previous_quantity REAL NOT NULL,
  new_quantity REAL NOT NULL,
  unit_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK(unit_cost_minor >= 0),
  reference_type TEXT CHECK(reference_type IN ('sale', 'purchase', 'adjustment', 'opening_stock', 'stock_count', 'return')),
  reference_id TEXT,
  reference_number TEXT,
  reason TEXT,
  notes TEXT,
  business_date_key TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, movement_number)
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  adjustment_number TEXT NOT NULL,
  reason TEXT NOT NULL,
  notes TEXT,
  business_date_key TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, adjustment_number)
);

CREATE TABLE IF NOT EXISTS stock_counts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  count_number TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft', 'confirmed', 'cancelled')) DEFAULT 'draft',
  business_date_key TEXT NOT NULL,
  confirmed_at TEXT,
  confirmed_by TEXT REFERENCES users(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, count_number)
);

CREATE TABLE IF NOT EXISTS stock_count_items (
  id TEXT PRIMARY KEY,
  count_id TEXT NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  system_quantity REAL NOT NULL,
  physical_quantity REAL,
  variance REAL,
  unit_cost_minor INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

