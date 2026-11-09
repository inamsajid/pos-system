# Step 13.8 — Offline Security Acceptance Report

## 1. Threat Model & Security Boundaries

Offline operation requires client devices to make local decisions without real-time server supervision. This introduces security threats including terminal tampering, DevTools payload modification, credential leakage from browser storage, and physical device theft.

---

## 2. Security Verification & Audit Findings

### 2.1 Device Identity vs. Authentication
- **Finding**: Device IDs (`dev_uuid`) are identifiers for hardware terminals, **not** authentication credentials.
- **Enforcement**: Possessing a valid `deviceId` does not grant access to tenant data. The server requires a valid session token and verified business membership before issuing authorizations or processing synchronization feeds.

### 2.2 Cryptographic Authorization Tamper Protection
- **Finding**: Offline authorizations are signed on the Cloudflare Worker using HMAC-SHA256 (`AUTH_SECRET`).
- **DevTools Modification Test**: If an attacker edits local IndexedDB (`offlineAuthorizations`) to alter `maxTotalAmountMinor`, extend `expiresAt`, or inject unauthorized product IDs, the server recalculates the canonical signature upon commit:
  $$\text{HMAC}(\text{secret}, \text{canonicalPayload}) \neq \text{tamperedSignature}$$
- **Verification Evidence**: Tampered packages are rejected with `403 FORBIDDEN` (`tests/offline/offlineSaleServerCommit.test.ts` > "Test 4.5").
- **Zero Frontend Leakage**: The HMAC signing secret is stored exclusively in Cloudflare Worker environment variables (`AUTH_SECRET` / `.dev.vars`) and is never included in frontend bundles.

### 2.3 Cross-Tenant & Branch Boundaries
- **Cross-Tenant Attack**: Attempting to commit an offline sale using a device ID or authorization from Business A under Business B is blocked immediately with `403 FORBIDDEN` (`Scenario 23`).
- **Branch Boundary**: Authorizations are cryptographically tied to a specific `branch_id`. Using a Main Branch authorization on an Alt Branch register is rejected with `403 FORBIDDEN` (`Scenario 24`).

### 2.4 Revoked Device Lockdown
- If an admin revokes a stolen or compromised tablet in the Cloudflare D1 `devices` table:
  1. The tablet cannot obtain new offline authorizations.
  2. Any pending offline sales dispatched from that device are rejected with `403 FORBIDDEN` (`Scenario 19`).
  3. The manager can execute `POST /api/v1/offline/devices/reconcile-lost` to immediately reclaim all unconsumed quotas held by that device.

### 2.5 Local Storage Data Classification (Dexie / IndexedDB)
In accordance with Step 13.1 Local Data Classification rules:
- **Zero Credentials**: Passwords, password hashes, and session authentication tokens are **STRICTLY PROHIBITED** from IndexedDB.
- **Zero Cost Margins**: Purchase costs and supplier margin data are omitted from cached product records.
- **Zero Customer Debt**: Full customer credit ledger histories are omitted from local offline storage.

> [!WARNING]
> **IndexedDB Encryption Boundary**:
> Browser IndexedDB is not encrypted at rest by default. Physical access to an unlocked device allows inspection of cached catalog items and provisional offline receipts via browser DevTools. Production POS hardware must enforce operating-system level disk encryption (e.g., BitLocker on Windows, FileVault on macOS, or Android hardware keystore encryption) with auto-lock pin protection.

### 2.6 Service Worker Caching Boundary
- As verified in `public/sw.js` (`Scenario 26`):
  - Service Worker strictly intercepts GET requests for static app shell files (`/`, `/index.html`, `/manifest.json`, bundled assets).
  - All `/api/*` and `/api/v1/*` requests explicitly bypass Service Worker caching (`STRICTLY NETWORK-ONLY`).
  - Private R2 document storage links and financial transactions are never stored in the browser's CacheStorage API.

