-- ============================================================================
-- Migration 0005: Payments, Payment Methods, Allocations & Customer Ledger
-- Target: Cloudflare D1 (SQLite)
-- ============================================================================

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  receipt_number TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  customer_snapshot_json TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  unallocated_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK(unallocated_amount_minor >= 0),
  source TEXT NOT NULL CHECK(source IN ('pos_checkout', 'manual', 'online')) DEFAULT 'manual',
  notes TEXT,
  business_date_key TEXT NOT NULL,
  received_by TEXT NOT NULL REFERENCES users(id),
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, receipt_number)
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK(method IN ('cash', 'card', 'bank_transfer', 'digital_wallet', 'other')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  reference TEXT
);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  invoice_number TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  allocated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customer_ledger_transactions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('opening', 'invoice', 'payment', 'credit_note', 'void', 'adjustment')),
  reference_id TEXT NOT NULL,
  reference_number TEXT NOT NULL,
  description TEXT NOT NULL,
  debit_minor INTEGER NOT NULL DEFAULT 0 CHECK(debit_minor >= 0),
  credit_minor INTEGER NOT NULL DEFAULT 0 CHECK(credit_minor >= 0),
  balance_minor INTEGER NOT NULL,
  business_date_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

