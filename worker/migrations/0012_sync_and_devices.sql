-- ============================================================================
-- Migration 0012: Device Registration, Change Feed & Resource Versioning
-- Target: Cloudflare D1 (SQLite)
-- Step: 13.5 Multi-Device Synchronization & Conflict Handling
-- ============================================================================

-- 1. Product & Category Optimistic Concurrency Revision Fields
ALTER TABLE products ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE categories ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- 2. Registered Client Devices
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT,
  status TEXT NOT NULL CHECK(status IN ('active', 'revoked')) DEFAULT 'active',
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_sync_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, user_id, installation_id)
);

CREATE INDEX IF NOT EXISTS idx_devices_biz_user ON devices(business_id, user_id);
CREATE INDEX IF NOT EXISTS idx_devices_installation ON devices(business_id, installation_id);

-- 3. Authoritative Multi-Device Synchronization Change Log
CREATE TABLE IF NOT EXISTS sync_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT REFERENCES branches(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('product', 'category', 'stock')),
  resource_id TEXT NOT NULL,
  resource_version INTEGER NOT NULL DEFAULT 1,
  operation TEXT NOT NULL CHECK(operation IN ('upsert', 'archive', 'delete')),
  payload TEXT NOT NULL,
  event_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_change_log_biz_seq ON sync_change_log(business_id, id);
CREATE INDEX IF NOT EXISTS idx_sync_change_log_biz_branch_seq ON sync_change_log(business_id, branch_id, id);
CREATE INDEX IF NOT EXISTS idx_sync_change_log_resource ON sync_change_log(business_id, resource_type, resource_id);

