-- ============================================================================
-- Northstar POS — Cloudflare D1 Relational Schema Draft (Design Artifact)
-- Document ID: D1-DDL-11.8-03
-- Engine: SQLite 3 / Cloudflare D1
-- Monetary Precision: Signed INTEGER Minor Units (Paise, 1 PKR = 100 paise)
-- Timezone Standard: UTC ISO timestamps (created_at) + Asia/Karachi (business_date_key)
-- NOTE: This file is a reviewable design draft, not an active migration.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------------------------
-- 1. BUSINESSES & BRANCHES (Multi-Tenant Hierarchy)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  business_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  legal_name TEXT,
  tax_number TEXT,
  currency TEXT NOT NULL DEFAULT 'PKR',
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  country TEXT NOT NULL DEFAULT 'Pakistan',
  timezone TEXT NOT NULL DEFAULT 'Asia/Karachi',
  status TEXT NOT NULL CHECK(status IN ('active', 'suspended', 'archived')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_code TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  is_main_branch INTEGER NOT NULL DEFAULT 0 CHECK(is_main_branch IN (0, 1)),
  status TEXT NOT NULL CHECK(status IN ('active', 'inactive', 'archived')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, branch_code)
);

CREATE INDEX IF NOT EXISTS idx_branches_business ON branches(business_id);

-- ----------------------------------------------------------------------------
-- 2. USERS, MEMBERSHIPS & RBAC
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  phone TEXT UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK(email_verified IN (0, 1)),
  status TEXT NOT NULL CHECK(status IN ('active', 'inactive', 'banned')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS business_members (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'manager', 'cashier', 'accountant', 'inventory_manager')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_members_user ON business_members(user_id);
CREATE INDEX IF NOT EXISTS idx_members_business ON business_members(business_id);

CREATE TABLE IF NOT EXISTS member_branches (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES business_members(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(member_id, branch_id)
);

CREATE TABLE IF NOT EXISTS business_settings (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  receipt_header TEXT,
  receipt_footer TEXT,
  default_tax_rate REAL NOT NULL DEFAULT 0.0 CHECK(default_tax_rate >= 0),
  allow_negative_stock INTEGER NOT NULL DEFAULT 1 CHECK(allow_negative_stock IN (0, 1)),
  max_void_hours INTEGER NOT NULL DEFAULT 24 CHECK(max_void_hours >= 1),
  settings_json TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------------------
-- 3. PRODUCT CATALOG
-- ----------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_categories_business ON categories(business_id);

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

CREATE INDEX IF NOT EXISTS idx_products_business_category ON products(business_id, category_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(business_id, barcode) WHERE barcode IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4. CUSTOMERS & SUPPLIERS
-- ----------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_customers_business ON customers(business_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(business_id, phone) WHERE phone IS NOT NULL;

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

CREATE INDEX IF NOT EXISTS idx_suppliers_business ON suppliers(business_id);

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

-- ----------------------------------------------------------------------------
-- 5. INVENTORY & STOCK BALANCES
-- ----------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_inv_balances_lookup ON inventory_balances(business_id, branch_id, product_id);

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

CREATE INDEX IF NOT EXISTS idx_stock_mov_product_date ON stock_movements(business_id, product_id, business_date_key);
CREATE INDEX IF NOT EXISTS idx_stock_mov_ref ON stock_movements(business_id, reference_type, reference_id);

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

-- ----------------------------------------------------------------------------
-- 6. SALES, INVOICES & RETURNS
-- ----------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_sales_biz_branch_date ON sales(business_id, branch_id, business_date_key);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(business_id, customer_id, created_at);

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

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);

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

CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(business_id, customer_id, business_date_key);

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

-- ----------------------------------------------------------------------------
-- 7. CUSTOMER PAYMENTS & LEDGER
-- ----------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(business_id, customer_id, business_date_key);

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

CREATE INDEX IF NOT EXISTS idx_pay_alloc_payment ON payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_pay_alloc_sale ON payment_allocations(sale_id);

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

CREATE INDEX IF NOT EXISTS idx_cust_ledger_history ON customer_ledger_transactions(business_id, customer_id, business_date_key);

-- ----------------------------------------------------------------------------
-- 8. PURCHASES, GOODS RECEIPTS & SUPPLIER LEDGER
-- ----------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(business_id, supplier_id, purchase_date_key);

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

CREATE INDEX IF NOT EXISTS idx_supp_ledger_history ON supplier_ledger_transactions(business_id, supplier_id, business_date_key);

-- ----------------------------------------------------------------------------
-- 9. EXPENSES, AUDIT & SYSTEM CONTROLS
-- ----------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_audit_logs_biz_date ON audit_logs(business_id, created_at);

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

CREATE INDEX IF NOT EXISTS idx_idempotency_lookup ON idempotency_keys(business_id, operation, idempotency_key);

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

