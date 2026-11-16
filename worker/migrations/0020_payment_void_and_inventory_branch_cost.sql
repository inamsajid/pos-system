-- ============================================================================
-- Migration 0020: Payment Void/Reversal Tracking & Branch Inventory Average Cost
-- Target: Cloudflare D1 (SQLite)
-- ============================================================================

-- 1. Void / Reversal tracking columns for payments
ALTER TABLE payments ADD COLUMN status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('posted', 'reversed', 'voided'));
ALTER TABLE payments ADD COLUMN reversed_at TEXT;
ALTER TABLE payments ADD COLUMN reversal_reason TEXT;
ALTER TABLE payments ADD COLUMN voided_by_sale_id TEXT REFERENCES sales(id);

CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(business_id, status);

-- 2. Branch-specific moving weighted average cost on inventory balances
ALTER TABLE inventory_balances ADD COLUMN average_cost_minor INTEGER DEFAULT 0 CHECK(average_cost_minor >= 0);

-- Backfill existing balances with current product purchase price
UPDATE inventory_balances
SET average_cost_minor = COALESCE(
  (SELECT purchase_price_minor FROM products WHERE products.id = inventory_balances.product_id),
  0
)
WHERE average_cost_minor = 0 OR average_cost_minor IS NULL;

