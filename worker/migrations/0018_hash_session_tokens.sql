-- ============================================================================
-- Migration 0018: Hash Session Tokens in D1 (SEC-002 Security Cutover)
-- Target: Cloudflare D1 (SQLite)
-- ============================================================================
-- Replaces plaintext bearer token storage/lookup with SHA-256 hex digest
-- storage in `sessions.token_hash`.
-- Because SQLite lacks a native cryptographic SHA-256 function to re-encode
-- existing plaintext tokens in pure SQL, any pre-cutover rows with
-- `token_hash IS NULL` have their legacy plaintext `token` overwritten and are
-- deterministically expired without deleting rows, requiring active clients
-- to re-authenticate after cutover.
-- ============================================================================

ALTER TABLE sessions ADD COLUMN token_hash TEXT;

UPDATE sessions
SET token = 'LEGACY_INVALIDATED_' || id,
    expires_at = '1970-01-01T00:00:00.000Z'
WHERE token_hash IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_hash
  ON sessions(token_hash)
  WHERE token_hash IS NOT NULL;

