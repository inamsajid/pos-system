-- ============================================================================
-- Migration 0016: Pricing Override Audit Columns & Offline Pricing Snapshots
-- Target: Cloudflare D1 (SQLite)
-- ============================================================================

ALTER TABLE sale_items ADD COLUMN original_unit_price_minor INTEGER;
ALTER TABLE sale_items ADD COLUMN price_override_reason TEXT;
ALTER TABLE sale_items ADD COLUMN price_override_by TEXT;
ALTER TABLE sale_items ADD COLUMN price_override_at TEXT;

ALTER TABLE offline_authorizations ADD COLUMN pricing_snapshot_json TEXT;
ALTER TABLE offline_authorizations ADD COLUMN pricing_signature TEXT;
