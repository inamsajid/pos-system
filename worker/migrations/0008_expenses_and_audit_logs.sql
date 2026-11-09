-- ============================================================================
-- Migration 0008: Expenses, Audit Logs, Idempotency Keys & Device Registrations
-- Target: Cloudflare D1 (SQLite)
-- ============================================================================

CREATE TABLE IF NOT EXISTS expense_categories (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK(status IN ('active', 'archived')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, name)
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  expense_number TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES expense_categories(id),
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  payment_method TEXT NOT NULL CHECK(payment_method IN ('cash', 'bank_transfer', 'card', 'other')),
  title TEXT NOT NULL,
  notes TEXT,
  receipt_attachment_url TEXT,
  business_date_key TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, expense_number)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  diff_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, operation, idempotency_key)
);

CREATE TABLE IF NOT EXISTS device_registrations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  device_code TEXT NOT NULL,
  name TEXT NOT NULL,
  device_type TEXT NOT NULL CHECK(device_type IN ('pos_terminal', 'tablet', 'mobile_scanner', 'kiosk')),
  public_key TEXT,
  status TEXT NOT NULL CHECK(status IN ('active', 'revoked')) DEFAULT 'active',
  last_seen_at TEXT,
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, device_code)
);

