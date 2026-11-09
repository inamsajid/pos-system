-- ============================================================================
-- Migration 0006: Purchases, Goods Receipts, Supplier Payments & Supplier Ledger
-- Target: Cloudflare D1 (SQLite)
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  purchase_number TEXT NOT NULL,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  supplier_snapshot_json TEXT NOT NULL,
  supplier_invoice_number TEXT,
  subtotal_minor INTEGER NOT NULL CHECK(subtotal_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK(discount_minor >= 0),
  tax_minor INTEGER NOT NULL DEFAULT 0 CHECK(tax_minor >= 0),
  total_amount_minor INTEGER NOT NULL CHECK(total_amount_minor >= 0),
  paid_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK(paid_amount_minor >= 0),
  status TEXT NOT NULL CHECK(status IN ('draft', 'ordered', 'partially_received', 'received', 'cancelled')) DEFAULT 'draft',
  purchase_date_key TEXT NOT NULL,
  expected_delivery_date TEXT,
  notes TEXT,
  confirmed_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, purchase_number)
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  ordered_quantity REAL NOT NULL CHECK(ordered_quantity > 0),
  received_quantity REAL NOT NULL DEFAULT 0.0 CHECK(received_quantity >= 0),
  unit_cost_minor INTEGER NOT NULL CHECK(unit_cost_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK(discount_minor >= 0),
  line_total_minor INTEGER NOT NULL CHECK(line_total_minor >= 0)
);

CREATE TABLE IF NOT EXISTS goods_receipts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  receipt_number TEXT NOT NULL,
  purchase_id TEXT NOT NULL REFERENCES purchases(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  notes TEXT,
  business_date_key TEXT NOT NULL,
  received_by TEXT NOT NULL REFERENCES users(id),
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, receipt_number)
);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  purchase_item_id TEXT NOT NULL REFERENCES purchase_items(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity_received REAL NOT NULL CHECK(quantity_received > 0),
  unit_cost_minor INTEGER NOT NULL CHECK(unit_cost_minor >= 0)
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  receipt_number TEXT NOT NULL,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  supplier_snapshot_json TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  unallocated_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK(unallocated_amount_minor >= 0),
  method TEXT NOT NULL CHECK(method IN ('cash', 'bank_transfer', 'card', 'other')),
  reference TEXT,
  notes TEXT,
  business_date_key TEXT NOT NULL,
  paid_by TEXT NOT NULL REFERENCES users(id),
  paid_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, receipt_number)
);

CREATE TABLE IF NOT EXISTS supplier_payment_allocations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  payment_id TEXT NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
  purchase_id TEXT NOT NULL REFERENCES purchases(id),
  purchase_number TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  allocated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS supplier_ledger_transactions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('opening', 'bill', 'payment', 'debit_note', 'adjustment')),
  reference_id TEXT NOT NULL,
  reference_number TEXT NOT NULL,
  description TEXT NOT NULL,
  debit_minor INTEGER NOT NULL DEFAULT 0 CHECK(debit_minor >= 0),
  credit_minor INTEGER NOT NULL DEFAULT 0 CHECK(credit_minor >= 0),
  balance_minor INTEGER NOT NULL,
  business_date_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

