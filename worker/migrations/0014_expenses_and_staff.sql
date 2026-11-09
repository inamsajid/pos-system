-- ============================================================================
-- Migration 0014: Expenses Void/Reversal & Staff Invitations
-- Target: Cloudflare D1 (SQLite)
-- ============================================================================

-- Add void/reversal columns to expenses table
ALTER TABLE expenses ADD COLUMN status TEXT NOT NULL DEFAULT 'posted';
ALTER TABLE expenses ADD COLUMN voided_at TEXT;
ALTER TABLE expenses ADD COLUMN voided_by TEXT REFERENCES users(id);
ALTER TABLE expenses ADD COLUMN void_reason TEXT;

-- Create staff invitations table for secure team onboarding
CREATE TABLE IF NOT EXISTS staff_invitations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'manager', 'cashier', 'accountant', 'inventory_manager')),
  token_hash TEXT NOT NULL UNIQUE,
  branch_ids_json TEXT,
  invited_by TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_staff_inv_biz ON staff_invitations(business_id);
CREATE INDEX IF NOT EXISTS idx_staff_inv_token ON staff_invitations(token_hash);
CREATE INDEX IF NOT EXISTS idx_expenses_biz_status ON expenses(business_id, status);

