-- ============================================================================
-- Migration 0013: Offline Authorizations & Device Stock Allocations
-- Target: Cloudflare D1 (SQLite)
-- Steps: 13.6 Offline POS & 13.7 Synchronization Recovery
-- ============================================================================

-- 1. Server-Issued Cryptographic Offline Authorizations
CREATE TABLE IF NOT EXISTS offline_authorizations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  catalog_version INTEGER NOT NULL DEFAULT 1,
  pricing_version INTEGER NOT NULL DEFAULT 1,
  max_transactions INTEGER NOT NULL DEFAULT 100,
  max_total_amount_minor INTEGER NOT NULL DEFAULT 5000000,
  allow_discounts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('active', 'revoked', 'expired', 'completed')) DEFAULT 'active',
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_offline_auth_biz_dev ON offline_authorizations(business_id, device_id, status);
CREATE INDEX IF NOT EXISTS idx_offline_auth_lookup ON offline_authorizations(business_id, branch_id, user_id, device_id);

-- 2. Device-Scoped Stock Allocations with Invariant Protection
CREATE TABLE IF NOT EXISTS device_stock_allocations (
  id TEXT PRIMARY KEY,
  authorization_id TEXT NOT NULL REFERENCES offline_authorizations(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  allocated_quantity REAL NOT NULL CHECK(allocated_quantity >= 0),
  consumed_quantity REAL NOT NULL CHECK(consumed_quantity >= 0) DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('active', 'reconciled', 'revoked')) DEFAULT 'active',
  allocated_at TEXT NOT NULL DEFAULT (datetime('now')),
  reconciled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(consumed_quantity <= allocated_quantity)
);

CREATE INDEX IF NOT EXISTS idx_device_alloc_prod_active ON device_stock_allocations(business_id, branch_id, product_id, status);
CREATE INDEX IF NOT EXISTS idx_device_alloc_auth ON device_stock_allocations(authorization_id);
CREATE INDEX IF NOT EXISTS idx_device_alloc_device ON device_stock_allocations(business_id, branch_id, device_id, status);

