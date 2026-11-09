-- ============================================================================
-- Migration 0011: Private File Storage Metadata & Performance Composite Indexes
-- Target: Cloudflare D1 (SQLite)
-- ============================================================================

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  sanitized_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
  category TEXT NOT NULL CHECK(category IN (
    'product_image',
    'business_logo',
    'invoice_pdf',
    'receipt_attachment',
    'purchase_document',
    'supplier_document',
    'report_export'
  )),
  related_type TEXT CHECK(related_type IN (
    'product',
    'business',
    'branch',
    'sale',
    'invoice',
    'purchase',
    'goods_receipt',
    'supplier',
    'customer',
    'report'
  )),
  related_id TEXT,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'available', 'deleted', 'failed')) DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

-- File lookups and tenant isolation indexes
CREATE INDEX IF NOT EXISTS idx_files_business ON files(business_id, status);
CREATE INDEX IF NOT EXISTS idx_files_related ON files(business_id, related_type, related_id);
CREATE INDEX IF NOT EXISTS idx_files_branch ON files(business_id, branch_id);

-- Additional composite performance indexes for Reports and Analytics queries
CREATE INDEX IF NOT EXISTS idx_payments_biz_branch_date ON payments(business_id, branch_id, business_date_key);
CREATE INDEX IF NOT EXISTS idx_purchases_biz_branch_date ON purchases(business_id, branch_id, purchase_date_key);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_biz_branch_date ON goods_receipts(business_id, branch_id, business_date_key);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_biz_branch_date ON supplier_payments(business_id, branch_id, business_date_key);
CREATE INDEX IF NOT EXISTS idx_inventory_balances_branch_qty ON inventory_balances(business_id, branch_id, quantity_on_hand);

