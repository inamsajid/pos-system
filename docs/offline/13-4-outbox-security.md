# Outbox Security & Local Storage Threat Model

## 1. Local Storage Security Realities

IndexedDB provides client-side database storage inside the browser. However:
1. **Unencrypted at Rest**: IndexedDB data is stored unencrypted in the user's browser profile directory on the local device filesystem.
2. **Same-Origin Access**: Any JavaScript executing under the same origin (including third-party scripts, browser extensions, or malicious XSS injections) can inspect, read, or tamper with IndexedDB tables.
3. **Multi-User Machine Exposure**: Shared POS terminals or shared Windows accounts may allow unauthorized users to inspect local storage via Developer Tools.

---

## 2. Prohibited Storage Policy

To prevent credential theft and financial compromise, the outbox strictly prohibits storing the following data:
- **Authentication Tokens & Credentials**: No JWT tokens, session cookies, passwords, API keys, or cashier PINs.
- **Payment Instrument Details**: No credit card numbers, CVVs, expiration dates, or bank account credentials.
- **Customer Confidential Information**: No National Identity Numbers, CNIC numbers, tax certificates, or personal credit notes.
- **Step 13.4 Scope Prohibition**: Offline sales, customer payments, supplier payments, purchases, goods receipts, and stock adjustments must **not** be queued in Step 13.4.

---

## 3. Strict Typed Command Registry (Zero Arbitrary Routing)

A major vulnerability in generic offline sync queues is allowing command payloads to specify arbitrary HTTP endpoints or request methods:
```json
// FORBIDDEN PATTERN: Arbitrary request queue
{
  "url": "/api/v1/admin/delete-all",
  "method": "DELETE",
  "data": {}
}
```

### Northstar POS Whitelist Architecture:
1. **Registered Handlers Only**: Every command type must correspond to a pre-compiled TypeScript handler function in `src/lib/offline/outbox/commandRegistry.ts`.
2. **Fixed Internal Routes**: The handler code determines the exact API endpoint. Payloads cannot override or alter the target URL.
3. **Payload Schema Validation**: Every command type has a strict schema validator. Unknown attributes or type mismatches are rejected before saving and before dispatch.
4. **Command Versioning**: Payload schemas are versioned (`commandVersion`). The dispatcher rejects any command with an unrecognized version.

---

## 4. Tenant & Session Isolation

1. **User Scoping**: Every command record is tagged with `userId` and `businessId`.
2. **Session Precedence**: Commands are dispatched using the authenticated user's active session. If the user logs out or switches accounts:
   - The outbox dispatcher detects context mismatch (`activeUserId !== command.userId`).
   - The command is moved to `blocked_auth` and paused.
   - It is **never** dispatched under the new user's session credentials.
3. **Manual Review Required for Sensitive Offline Transactions**:
   - Before full offline sales can be activated in future steps, an explicit business decision is required regarding local AES-GCM encryption of sensitive payloads using a session-derived key.

