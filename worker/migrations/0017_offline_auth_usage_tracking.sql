-- ============================================================================
-- Migration 0017: Offline Authorization Usage Tracking Columns
-- Target: Cloudflare D1 (SQLite)
-- Tracks cumulative transactions and monetary value committed under each offline auth
-- ============================================================================

ALTER TABLE offline_authorizations
  ADD COLUMN used_transactions INTEGER NOT NULL DEFAULT 0 CHECK(used_transactions >= 0);

ALTER TABLE offline_authorizations
  ADD COLUMN used_total_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK(used_total_amount_minor >= 0);

