-- ============================================================================
-- Migration 0004: Sales, Sale Items, Invoices, Sale Returns & Return Items
-- Target: Cloudflare D1 (SQLite)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  sale_number TEXT NOT NULL,
  receipt_number TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  customer_snapshot_json TEXT NOT NULL,
  terminal_id TEXT NOT NULL DEFAULT 'POS01',
  cashier_id TEXT NOT NULL REFERENCES users(id),
  cashier_name TEXT NOT NULL,
  subtotal_minor INTEGER NOT NULL CHECK(subtotal_minor >= 0),
  discount_type TEXT NOT NULL CHECK(discount_type IN ('fixed', 'percent')) DEFAULT 'fixed',
  discount_value REAL NOT NULL DEFAULT 0.0 CHECK(discount_value >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK(discount_minor >= 0),
  tax_minor INTEGER NOT NULL DEFAULT 0 CHECK(tax_minor >= 0),
  total_amount_minor INTEGER NOT NULL CHECK(total_amount_minor >= 0),
  amount_paid_minor INTEGER NOT NULL DEFAULT 0 CHECK(amount_paid_minor >= 0),
  remaining_balance_minor INTEGER NOT NULL DEFAULT 0 CHECK(remaining_balance_minor >= 0),
  change_returned_minor INTEGER NOT NULL DEFAULT 0 CHECK(change_returned_minor >= 0),
  status TEXT NOT NULL CHECK(status IN ('draft', 'completed', 'voided', 'partially_returned', 'returned')) DEFAULT 'completed',
  business_date_key TEXT NOT NULL,
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, receipt_number),
  UNIQUE(business_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  unit_price_minor INTEGER NOT NULL CHECK(unit_price_minor >= 0),
  unit_cost_minor INTEGER NOT NULL CHECK(unit_cost_minor >= 0),
  cogs_estimated INTEGER NOT NULL DEFAULT 0 CHECK(cogs_estimated IN (0, 1)),
  quantity REAL NOT NULL CHECK(quantity > 0),
  subtotal_minor INTEGER NOT NULL CHECK(subtotal_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK(discount_minor >= 0),
  tax_minor INTEGER NOT NULL DEFAULT 0 CHECK(tax_minor >= 0),
  line_total_minor INTEGER NOT NULL CHECK(line_total_minor >= 0),
  returned_quantity REAL NOT NULL DEFAULT 0.0 CHECK(returned_quantity >= 0)
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  sale_id TEXT NOT NULL UNIQUE REFERENCES sales(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  business_date_key TEXT NOT NULL,
  total_amount_minor INTEGER NOT NULL CHECK(total_amount_minor >= 0),
  paid_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK(paid_amount_minor >= 0),
  remaining_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK(remaining_amount_minor >= 0),
  payment_status TEXT NOT NULL CHECK(payment_status IN ('paid', 'partial', 'unpaid')) DEFAULT 'unpaid',
  status TEXT NOT NULL CHECK(status IN ('active', 'voided')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS sale_returns (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  return_number TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  invoice_number TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  total_refund_minor INTEGER NOT NULL CHECK(total_refund_minor >= 0),
  refund_method TEXT NOT NULL CHECK(refund_method IN ('cash', 'credit_note', 'card_reversal', 'store_credit')),
  reason TEXT NOT NULL,
  authorized_by TEXT NOT NULL REFERENCES users(id),
  business_date_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, return_number)
);

CREATE TABLE IF NOT EXISTS sale_return_items (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  sale_item_id TEXT NOT NULL REFERENCES sale_items(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL CHECK(quantity > 0),
  unit_refund_price_minor INTEGER NOT NULL CHECK(unit_refund_price_minor >= 0),
  line_refund_minor INTEGER NOT NULL CHECK(line_refund_minor >= 0),
  stock_disposition TEXT NOT NULL CHECK(stock_disposition IN ('restock', 'damaged', 'discard'))
);

