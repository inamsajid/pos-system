# Step 12.2: Architecture Decisions & Implementation Log

## Document Overview
- **Step**: 12.2 — Authentication + Business/Branch Isolation
- **Date**: November 2026
- **Status**: Implemented & Verified

---

## 1. Architectural Decisions

### DEC-12.2-01: Native Edge Session Engine vs External Introspection Adapters
- **Context**: In Step 11.8 (DEC-15), Better-Auth on D1 was evaluated. However, Better-Auth's internal schema introspection requires specific table structures (`user`, `session`, `account`, `verification`) or custom dialect inspectors that conflict with our existing normalized schema (`users`, `business_members`, `member_branches`) established in migrations 0001–0009.
- **Decision**: Implemented an edge-native, zero-dependency session and auth engine directly utilizing the Web Crypto API (`crypto.subtle` PBKDF2 with HMAC-SHA-256 and constant-time comparisons) and direct D1 prepared statements.
- **Rationale**:
  1. Full compliance with the existing migrations 0001–0009 schema (`users`, `business_members`, `branches`).
  2. Zero external dependencies or network hops inside the Worker runtime.
  3. Strict adherence to `workers-api-contracts.md` and `authentication-and-rbac.md`.
  4. Precise, error-free transaction safety and cookie management.

### DEC-12.2-02: Cryptographic Password Hashing Standard
- **Context**: Cloudflare Workers runtime provides native Web Crypto API (`crypto.subtle`), but does not include Node's native C++ `bcrypt` or `argon2` bindings without WASM overhead.
- **Decision**: Adopted PBKDF2-HMAC-SHA256 with 100,000 iterations, 16-byte random salt, and 256-bit derived key length. Constant-time equality checks are enforced via `timingSafeEqual`.
- **Rationale**: Meets NIST SP 800-132 recommendations, executes natively in both edge V8 isolates and Node runtimes with sub-10ms latency, and requires zero native C++ binaries.

### DEC-12.2-03: Session Conveyance & CORS Hardening
- **Context**: Modern web browsers reject cookies (`credentials: 'include'`) if `Access-Control-Allow-Origin: *` is returned.
- **Decision**: The Worker router reflects the client's `Origin` header dynamically, appends `Access-Control-Allow-Credentials: true`, and marks the response with `Vary: Origin`.
- **Rationale**: Guarantees seamless cookie transmission during local development across `localhost:5173` (Vite) and `localhost:8787` (Worker) while strictly maintaining security boundaries.

### DEC-12.2-04: Multi-Tenant Context Resolution & Fallback
- **Context**: Users may belong to one or multiple businesses or branches.
- **Decision**:
  - Single-membership users: Auto-selects their single business and primary branch if `X-Business-Id` / `X-Branch-Id` are omitted.
  - Multi-membership users: Omitting the header returns `400 VALIDATION_ERROR` prompting the client to supply `X-Business-Id` and provides the list of accessible businesses.
- **Rationale**: Eliminates developer friction and repetitive header overhead for single-store retailers while strictly preventing ambiguous state mutations in multi-store franchises.

---

## 2. Verification Checklist

- [x] Migration `0010_sessions_and_auth.sql` applied to local D1.
- [x] Zero-trust multi-tenancy verification middleware implemented.
- [x] Crypto utilities and PBKDF2 password hashing implemented.
- [x] One-time bootstrap endpoint implemented with conflict protection.
- [x] Cookie issuance (`HttpOnly; SameSite=Lax; Path=/`) and revocation verified.
- [x] React `AuthProvider`, `useAuth`, `ProtectedRoute`, and dynamic `Header` user display updated.
- [x] No credentials or tokens stored in `localStorage` or `sessionStorage`.
- [x] 111/111 automated tests passing across 11 test suites.
- [x] `npm run build`, `npm run build:worker`, and `npm run lint` passing with 0 errors.

