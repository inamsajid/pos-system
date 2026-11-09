-- ============================================================================
-- Migration 0003: Customers, Suppliers & Supplier Products
-- Target: Cloudflare D1 (SQLite)
-- ============================================================================

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('individual', 'business')) DEFAULT 'individual',
  company_name TEXT,
  phone TEXT,
  email TEXT,
  tax_number TEXT,
  address TEXT,
  city TEXT,
  opening_balance_minor INTEGER NOT NULL DEFAULT 0,
  credit_limit_minor INTEGER NOT NULL DEFAULT 0 CHECK(credit_limit_minor >= 0),
  is_walk_in INTEGER NOT NULL DEFAULT 0 CHECK(is_walk_in IN (0, 1)),
  status TEXT NOT NULL CHECK(status IN ('active', 'inactive', 'archived')) DEFAULT 'active',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, customer_code)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  supplier_code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('individual', 'business')) DEFAULT 'business',
  company_name TEXT,
  contact_person TEXT,
  phone TEXT,
  alternate_phone TEXT,
  email TEXT,
  tax_number TEXT,
  address TEXT,
  city TEXT,
  country TEXT NOT NULL DEFAULT 'Pakistan',
  opening_payable_minor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('active', 'inactive', 'archived')) DEFAULT 'active',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, supplier_code)
);

CREATE TABLE IF NOT EXISTS supplier_products (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_sku TEXT,
  purchase_price_minor INTEGER NOT NULL DEFAULT 0 CHECK(purchase_price_minor >= 0),
  is_preferred INTEGER NOT NULL DEFAULT 0 CHECK(is_preferred IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(supplier_id, product_id)
);

