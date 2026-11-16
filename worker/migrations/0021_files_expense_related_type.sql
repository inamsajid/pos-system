-- ============================================================================
-- Migration 0021: Files Table Rebuild for Expense Related Type & Receipts
-- Target: Cloudflare D1 (SQLite)
-- Forward-only data-preserving table migration
-- ============================================================================

CREATE TABLE IF NOT EXISTS files_new (
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
    'expense_receipt',
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
    'report',
    'expense'
  )),
  related_id TEXT,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'available', 'deleted', 'failed')) DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

INSERT INTO files_new (
  id, business_id, branch_id, object_key, original_filename,
  sanitized_filename, content_type, size_bytes, category,
  related_type, related_id, uploaded_by, status, created_at,
  updated_at, deleted_at
)
SELECT
  id, business_id, branch_id, object_key, original_filename,
  sanitized_filename, content_type, size_bytes, category,
  related_type, related_id, uploaded_by, status, created_at,
  updated_at, deleted_at
FROM files;

DROP TABLE files;

ALTER TABLE files_new RENAME TO files;

CREATE INDEX IF NOT EXISTS idx_files_business ON files(business_id, status);
CREATE INDEX IF NOT EXISTS idx_files_related ON files(business_id, related_type, related_id);
CREATE INDEX IF NOT EXISTS idx_files_branch ON files(business_id, branch_id);

