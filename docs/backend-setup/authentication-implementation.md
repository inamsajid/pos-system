# Step 12.2: Authentication & Session Management Implementation

## 1. Architectural Overview

The authentication engine operates as an edge-native, zero-trust session management layer executing inside Cloudflare Workers and backed directly by Cloudflare D1 SQLite.

All authentication transactions—including password hashing, verification, session creation, session validation, cookie emission, and CORS/CSRF guards—execute locally within the edge Worker without external third-party authentication SaaS dependencies or network round-trips.

---

## 2. Cryptographic Security Standards

### 2.1 Password Hashing & Salt Generation
Password storage uses standard Web Crypto API primitives (`crypto.subtle`):
- **Algorithm**: PBKDF2 (Password-Based Key Derivation Function 2)
- **Hash Function**: HMAC-SHA-256
- **Iteration Count**: Default `100,000` iterations (configurable via `env.PBKDF2_ITERATIONS`).
- **Derived Key Length**: 256 bits (32 bytes)
- **Salt**: 16 cryptographically secure random bytes generated via `crypto.getRandomValues(new Uint8Array(16))`.
- **Storage Format**: `pbkdf2:<iterations>:<saltHex>:<hashHex>`.
- **Verification**: Timing-safe, constant-time byte comparison (`timingSafeEqual`) to prevent side-channel timing attacks.
- **Opportunistic Rehashing**: If a user logs in with a password matching an older, lower work-factor hash, the hash is automatically re-derived using the target work-factor and updated in D1 without interrupting user login.

### 2.2 Session Identifier Generation
- Session tokens are generated as 256-bit cryptographically secure pseudorandom byte arrays formatted as 64-character lowercase hex strings.
- Entity IDs (Users, Businesses, Branches, Sessions) are generated using RFC 4122 UUID v4 (`crypto.randomUUID()`).

---

## 3. Session Lifecycle & Storage

### 3.1 D1 Schema (`0010_sessions_and_auth.sql`)
Sessions are persisted in Cloudflare D1 with relational foreign-key integrity:

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
```

### 3.2 Transport & Cookie Hardening
Sessions are conveyed between browser clients and the Worker via HTTP cookies:
- **Cookie Name**: `__session`
- **HttpOnly**: `true` (Inaccessible to JavaScript, immunizing against XSS session exfiltration).
- **SameSite**: `Lax` (Defense in depth against cross-site request attacks).
- **Path**: `/` (Scoped across the entire application domain).
- **Max-Age**: `604,800` seconds (7 days rolling session).
- **Secure**: `true` when request protocol is `https:`; omitted on local `http:` for development compatibility.

### 3.3 Bearer Token Alternative
For headless devices, POS registers, and mobile apps where browser cookies are not available, the Worker also inspects the `Authorization` header:
```text
Authorization: Bearer <session_token>
```
The session extractor accepts either cookie or Bearer token without requiring distinct endpoints.

### 3.4 Invalidation & Expiry
1. **Explicit Sign-Out**: Deletes the session row from `sessions` table in D1 and emits a `Set-Cookie: __session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` clearing header.
2. **Cascading Invalidation**: Deleting or archiving a user cascades deletion across all active sessions (`ON DELETE CASCADE`).
3. **Automated Pruning**: During validation, if `expires_at` is older than current time, the expired session is deleted on-demand and rejected with `401 AUTHENTICATION_REQUIRED`.

---

## 4. Origin Allowlisting & CSRF Protection

### 4.1 Canonical Origin Allowlist
The Worker never dynamically reflects arbitrary incoming `Origin` headers. Origins must strictly match canonical approved origins:
- `http://localhost:5173` (Vite dev server)
- `http://localhost:4173` (Vite preview server)
- `http://127.0.0.1:5173` / `http://127.0.0.1:4173`
- Configurable production origins via `env.ALLOWED_ORIGINS` (comma-separated).

### 4.2 Preflight (OPTIONS)
- If the incoming `Origin` matches an approved canonical origin: returns 204 with `Access-Control-Allow-Origin: <origin>`, `Access-Control-Allow-Credentials: true`, and `Vary: Origin`.
- If the incoming `Origin` is unapproved (different port, protocol, deceptive subdomain, or foreign host): returns HTTP 403 Forbidden with zero CORS allow headers.

### 4.3 CSRF Mutation Guards
For all state-mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`):
1. **Origin Header Present**: Validated against canonical allowlist; unapproved origins are immediately blocked with HTTP 403.
2. **Origin Header Absent**: Evaluates `Referer` header against canonical allowlist.
3. **Both Absent with Session Cookie**: Requires custom header (`X-Request-Id`, `X-Business-Id`) or `Content-Type: application/json` to reject blind cross-origin HTML `<form>` submissions.
