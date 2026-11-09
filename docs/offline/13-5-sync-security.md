# Step 13.5 — Synchronization Security Model

## 1. Zero Trust Principles

1. **Session Precedence**: Every synchronization request (`/sync/devices/*`, `/sync/changes`, `/sync/ack`) strictly authenticates the caller via session cookie and validates active membership in `X-Business-Id`.
2. **Device State Verification**: The device `installationId` must be registered and active (`status = 'active'`). A revoked device is immediately rejected with `403 Forbidden`.
3. **Branch-Level Access Enforcement**:
   - Stock change logs include `branch_id`.
   - The Worker validates that the authenticated user is authorized for the requested branch using `resolveAuthorizedBranchIds()`.
   - Branch-restricted cashiers can NEVER receive stock movements or balances from unauthorized branches.
4. **Data Masking & Wholesale Protection**:
   - Change feed payloads for products use an allowlisted DTO.
   - `purchasePriceMinor` is explicitly stripped on the server before serializing to `payload`.
   - Local Dexie storage contains only `sellingPriceMinor`.
5. **Cursor Validation**:
   - Cursors are validated to belong to the caller's active business and authorized branch.
   - Malformed, future, or cross-tenant cursors are rejected with `400 Bad Request`.
   - Stale cursors exceeding server retention return `SYNC_RESET_REQUIRED` prompting a safe full catalog snapshot sync.

