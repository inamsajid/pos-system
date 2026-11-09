# Step 13.8 — Complete Offline POS, Synchronization & Multi-Device Acceptance Matrix

This acceptance matrix provides a comprehensive, evidence-based audit of all requirements across Steps 13.1–13.7, validated through automated test suites, typechecks, schema audits, and architectural boundaries.

---

## 1. Local Database (Dexie / IndexedDB)

| ID | Expected Behavior | Component / API | Test File & Case | Result | Evidence | Known Limitations |
|---|---|---|---|---|---|---|
| **DB-01** | Dexie initializes Schema Version 4 with 9 dedicated stores. | `NorthstarOfflineDatabase` (`src/lib/offline/database.ts`) | `tests/offlineDatabase.test.ts` > "initializes Dexie database schema version 4" | **PASS** | 10 stores verified with compound keys. | Browsers with private browsing may restrict IndexedDB persistence. |
| **DB-02** | Atomic transaction guarantees zero partial writes on abort. | `db.transaction('rw', ...)` | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 25" | **PASS** | Storage record count identical before and after aborted transaction. | Storage quota limits enforced by browser engine. |
| **DB-03** | IndexedDB stores survive simulated browser restart. | `NorthstarOfflineDatabase` | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 7" | **PASS** | Re-opened DB instance successfully retrieved uncommitted outbox command. | Operating system or user disk cleanup may purge IndexedDB. |

---

## 2. Catalog Caching & Offline Browsing

| ID | Expected Behavior | Component / API | Test File & Case | Result | Evidence | Known Limitations |
|---|---|---|---|---|---|---|
| **CAT-01** | Cached products searchable by name, SKU, and barcode when offline. | `src/lib/offline/catalogCache.ts` | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 3" | **PASS** | Exact and partial matches retrieved while `navigator.onLine = false`. | Case-insensitive search uses normalized lowercase tokens. |
| **CAT-02** | Multi-tenant and user isolation in catalog cache. | `CachedProductRecord` (`[userId+businessId+snapshotId]`) | `tests/offlineCatalog.test.ts` > "isolates catalog by user and tenant" | **PASS** | Records for User/Biz A unreachable by User/Biz B. | Requires explicit logout to purge local cache stores. |
| **CAT-03** | Interrupted snapshot stream preserves last-known good snapshot. | `syncCatalog` (`src/lib/offline/catalogSync.ts`) | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 27" | **PASS** | Partial transaction rolls back; existing products remain queryable. | Stale cache badge indicates elapsed time since last sync. |

---

## 3. Offline Application Shell & PWA

| ID | Expected Behavior | Component / API | Test File & Case | Result | Evidence | Known Limitations |
|---|---|---|---|---|---|---|
| **PWA-01** | Service Worker caches HTML/JS/CSS app shell for offline boot. | `public/sw.js` | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 26" | **PASS** | Pre-cache manifest contains app root, `/index.html`, and assets. | Initial boot requires at least one successful online load. |
| **PWA-02** | Service Worker strictly bypasses authenticated API endpoints (`/api/*`). | `public/sw.js` fetch listener | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 26" | **PASS** | Network-only guard on `/api/v1/*` prevents sensitive data caching. | API requests made offline fail immediately to trigger outbox. |

---

## 4. Authentication, Tenant & Branch Isolation

| ID | Expected Behavior | Component / API | Test File & Case | Result | Evidence | Known Limitations |
|---|---|---|---|---|---|---|
| **SEC-01** | Cross-tenant commit rejected when device belongs to another business. | `OfflineService.commitOfflineSale` | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 23" | **PASS** | Rejection: `Device is revoked or not found for business`. | Tenant ID header must match authenticated session. |
| **SEC-02** | Branch isolation: authorizations issued for Branch 1 cannot commit on Branch 2. | `OfflineService.commitOfflineSale` | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 24" | **PASS** | Rejection: `Offline authorization is bound to branch 'main', not 'alt'`. | Terminals must request separate authorizations per branch. |
| **SEC-03** | Expired session pauses outbox without dropping pending sales. | `OutboxDispatcher.dispatchBatch` | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 18" | **PASS** | Command status transitioned to `blocked_auth`. | Requires cashier re-login to resume dispatch queue. |

---

## 5. Device Identity & Registration

| ID | Expected Behavior | Component / API | Test File & Case | Result | Evidence | Known Limitations |
|---|---|---|---|---|---|---|
| **DEV-01** | Stable device ID generated and persisted across sessions. | `getOrCreateDeviceId` (`src/lib/offline/deviceIdentity.ts`) | `tests/syncDeviceRegistration.test.ts` > "maintains stable device ID" | **PASS** | Returned same `dev_uuid` on multiple consecutive invocations. | Clearing browser site data generates new installation ID. |
| **DEV-02** | Revoked device rejected from obtaining authorizations or committing sales. | `POST /api/v1/offline/sales/commit` | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 19" | **PASS** | Server throws `403 Forbidden` (`Device is revoked`). | Terminal must re-register if revocation was accidental. |

---

## 6. Stock Allocations & Concurrency Control

| ID | Expected Behavior | Component / API | Test File & Case | Result | Evidence | Known Limitations |
|---|---|---|---|---|---|---|
| **STK-01** | Online sales deduct active unconsumed device allocations from available stock. | `SalesService.completeSale` | `tests/offline/offlineStockAllocation.test.ts` > "online sale stock deduction" | **PASS** | Available to sell = physical balance minus active reservations. | Central DB must be reached to update balance. |
| **STK-02** | SQLite check constraint blocks overconsumption of device stock quota. | `device_stock_allocations` (`0013_offline_pos_and_allocations.sql`) | `tests/offline/offlineSaleServerCommit.test.ts` > "Test 4.4" | **PASS** | Atomic batch rolled back with `ERR_SQLITE_ERROR` constraint violation. | Device must be online to request quota increase. |
| **STK-03** | Device A allocation is isolated from Device B quota. | `OfflineService.createAuthorization` | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 17" | **PASS** | Device A consumption of 4 units leaves Device B with 5 units remaining. | Quotas cannot be transferred directly peer-to-peer. |

---

## 7. Offline Checkout & Provisional Sales

| ID | Expected Behavior | Component / API | Test File & Case | Result | Evidence | Known Limitations |
|---|---|---|---|---|---|---|
| **POS-01** | Eligible cash sale creates provisional sale and enqueues outbox command. | `OfflineSalesService.recordOfflineSale` | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 4" | **PASS** | Provisional sale stored in Dexie; allocation decremented locally. | Cash tender only; digital payments blocked. |
| **POS-02** | Provisional receipt displays deterministic OFF reference & tax disclaimer. | `OfflineSalesService` | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 5" | **PASS** | Receipt: `"PENDING SYNCHRONIZATION — NOT AN OFFICIAL TAX INVOICE"`. | Reference format: `OFF-{deviceShortId}-{localSeq}`. |
| **POS-03** | Prohibited offline mutations (credit sales, adjustments) strictly rejected. | `CommandRegistry.isAuthorized` | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 28" | **PASS** | 10 financial and inventory commands blocked from offline execution. | Requires central online connection to perform. |

---

## 8. Durable Outbox & Command Dispatcher

| ID | Expected Behavior | Component / API | Test File & Case | Result | Evidence | Known Limitations |
|---|---|---|---|---|---|---|
| **OUT-01** | Outbox commands persisted with SHA-256 payload hash and idempotency key. | `OutboxService.enqueue` | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 6" | **PASS** | 64-character hash computed and verified on dispatch. | Modifying payload invalidates hash (tamper detection). |
| **OUT-02** | 30-second lease fencing prevents dual-processing during network latency. | `OutboxDispatcher.dispatchBatch` | `tests/offline/outboxConcurrency.test.ts` > "lease fencing" | **PASS** | Competing dispatcher thread respects active lease token. | Expired leases re-claimed after 30 seconds. |
| **OUT-03** | Dispatcher transitions command to `reconciliation_required` on business failure. | `OutboxDispatcher.dispatchSingle` | `tests/offline/offlineReconnectionAndRecovery.test.ts` > "Test 5.4" | **PASS** | Outbox event `COMMAND_RECONCILIATION_REQUIRED` emitted. | Operator must review and retry via console. |

---

## 9. Server Synchronization & Idempotency

| ID | Expected Behavior | Component / API | Test File & Case | Result | Evidence | Known Limitations |
|---|---|---|---|---|---|---|
| **SRV-01** | Atomic 11-statement D1 commit creates sale, invoice, payment & movements. | `OfflineService.commitOfflineSale` | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 9" | **PASS** | Official sale and invoice numbers generated in single transaction. | Requires central D1 database availability. |
| **SRV-02** | Exact idempotent retry returns cached response without duplicate records. | `OfflineService.commitOfflineSale` | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 20" | **PASS** | Response returned with `isCached: true`; zero duplicate sale rows. | Idempotency records stored in central D1. |
| **SRV-03** | Idempotency key reused with mismatched payload rejected with 409 Conflict. | `checkIdempotency` (`worker/src/lib/idempotency.ts`) | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 21" | **PASS** | Throws: `This idempotency key has already been used with a different request payload`. | Different sale payloads must use unique keys. |

---

## 10. Multi-Device Behavior & Convergence

| ID | Expected Behavior | Component / API | Test File & Case | Result | Evidence | Known Limitations |
|---|---|---|---|---|---|---|
| **MUL-01** | Independent devices commit sales concurrently without deadlocks. | Cloudflare D1 + Worker | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 14" | **PASS** | Device A and Device B commits succeed simultaneously; stock decremented. | Subject to D1 transaction throughput capacity. |
| **MUL-02** | Server commits emit stock delta events to `sync_change_log`. | `sync_change_log` table (`0012_sync_and_devices.sql`) | `tests/offline/offlineReconnectionAndRecovery.test.ts` > "Test 5.6" | **PASS** | Event with `resource_type = 'stock'` and quantity deducted emitted. | Other devices receive change on next sync pull. |

---

## 11. Conflict Handling & Optimistic Concurrency

| ID | Expected Behavior | Component / API | Test File & Case | Result | Evidence | Known Limitations |
|---|---|---|---|---|---|---|
| **CNF-01** | Stale product update rejected via revision version check. | Product version column | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 15" | **PASS** | Server version > client version blocks overwrite. | Client must pull latest revision before editing. |
| **CNF-02** | Category version mismatch triggers conflict state. | Category version column | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 16" | **PASS** | Optimistic concurrency prevents silent data overwrites. | Manual merge required for conflicting edits. |

---

## 12. Retry, Recovery & Reconnection

| ID | Expected Behavior | Component / API | Test File & Case | Result | Evidence | Known Limitations |
|---|---|---|---|---|---|---|
| **REC-01** | Network probe detects genuine server reachability via `/api/v1/health`. | `ReconnectionService.probeConnectivity` | `tests/offline/offlineReconnectionAndRecovery.test.ts` > "Test 5.1" | **PASS** | Returns `true` on 200 OK, `false` on network timeout or disconnect. | 4-second timeout aborts hung connections. |
| **REC-02** | Online event notification triggers automatic catalog & outbox sync. | `ReconnectionService.handleReconnectionTrigger` | `tests/offline/offlineReconnectionAndRecovery.test.ts` > "Test 5.2" | **PASS** | Single sync cycle executed; concurrent triggers locked out safely. | Disconnects during sync schedule retry. |
| **REC-03** | Operator manually reconciles and retries flagged commands. | `OutboxService.retryReconciliation` | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 22" | **PASS** | Command returned to `pending` with cleared leases and updated payload. | Requires manager role permission. |

---

## 13. Financial Reconciliation

| ID | Expected Behavior | Component / API | Test File & Case | Result | Evidence | Known Limitations |
|---|---|---|---|---|---|---|
| **FIN-01** | Total cash tendered matches or exceeds line subtotal; change computed. | `OfflineSalesService` | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 4" | **PASS** | Line total: 480000, tendered: 500000, change: 20000 verified. | Cash tender only. |
| **FIN-02** | Server invoice generated with payment status paid and remaining balance 0. | `invoices` table (`0004_sales_and_invoices.sql`) | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 11" | **PASS** | Official invoice matches sale total; `payment_status = 'paid'`. | Invoices are official tax records once committed. |

---

## 14. Inventory Reconciliation

| ID | Expected Behavior | Component / API | Test File & Case | Result | Evidence | Known Limitations |
|---|---|---|---|---|---|---|
| **INV-01** | Authoritative stock movements recorded for every committed offline sale. | `stock_movements` table (`0007_inventory_and_costing.sql`) | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 12" | **PASS** | Movement links to sale ID; previous and new quantities match balance. | Historical movements are append-only. |
| **INV-02** | Released allocations return unconsumed quota to general sellable pool. | `POST /api/v1/offline/allocations/reconcile` | `tests/offline/offlineStockAllocation.test.ts` > "reconcile allocation" | **PASS** | Allocation status changed to `reconciled`; available stock increases. | Consumed portions remain committed to sales. |

---

## 15. Browser Compatibility

| ID | Expected Behavior | Browser / Viewport | Execution Method | Result | Evidence | Known Limitations |
|---|---|---|---|---|---|---|
| **BRW-01** | IndexedDB & Dexie v4 support | Chrome / Edge (Chromium) | Automated test harness + engine audit | **PASS** | Full transaction, compound key, and cursor support. | Private browsing may limit persistence. |
| **BRW-02** | IndexedDB & Dexie v4 support | Firefox | Automated test harness + engine audit | **PASS** | IndexedDB standard compliant. | Quota prompt may appear on heavy cache. |
| **BRW-03** | Service Worker App Shell | Chrome / Edge (Desktop/Android) | `public/sw.js` inspection & build | **PASS** | CacheStorage v1 API supported across modern evergreen browsers. | iOS Safari requires HTTPS and home-screen install. |

---

## 16. Data Retention & Storage Recovery

| ID | Expected Behavior | Component / API | Test File & Case | Result | Evidence | Known Limitations |
|---|---|---|---|---|---|---|
| **RET-01** | Acknowledged offline sales preserved in local Dexie for shift review. | `offlineSales` store | `tests/offline/offlineAcceptance.e2e.test.ts` > "Scenario 10" | **PASS** | Status updated to `synchronized`; record retained locally. | Local records can be archived after 30 days. |
| **RET-02** | Physical device destruction handling. | `POST /api/v1/offline/devices/reconcile-lost` | `tests/offline/offlineStockAllocation.test.ts` > "reconcile lost device" | **PASS** | Device revoked; unconsumed stock quota safely reclaimed centrally. | Unsynchronized local sales on lost device cannot be recovered. |

