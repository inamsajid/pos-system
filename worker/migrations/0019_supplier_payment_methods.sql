-- ============================================================================
-- Migration 0019: Supplier Payment Methods (Split Tenders Support)
-- Target: Cloudflare D1 (SQLite)
-- ============================================================================

CREATE TABLE IF NOT EXISTS supplier_payment_methods (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK(method IN ('cash', 'bank_transfer', 'card', 'other')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  reference TEXT
);

CREATE INDEX IF NOT EXISTS idx_supplier_payment_methods_payment ON supplier_payment_methods(payment_id);

-- Idempotent backfill from existing supplier_payments rows
INSERT INTO supplier_payment_methods (id, payment_id, method, amount_minor, reference)
SELECT 'spm_' || id, id, method, amount_minor, reference
FROM supplier_payments
WHERE NOT EXISTS (
  SELECT 1 FROM supplier_payment_methods WHERE supplier_payment_methods.payment_id = supplier_payments.id
);

