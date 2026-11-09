# Step 13.2 — Dexie Database Foundation Implementation Report

## Executive Summary

Step 13.2 establishes the client-side IndexedDB foundation using **Dexie.js (v4.4.7)** in the Northstar POS frontend application. The implementation adheres to the architectural design created in Step 13.1, enforcing multi-tenant isolation, branch-level stock scoping, stable synthetic device identity, atomic candidate snapshot activation, diagnostic health auditing, and browser storage quota management.

All 10 automated unit tests in `tests/offlineDatabase.test.ts` pass cleanly with 100% green status.

---

## 1. Database Schema & Stores

- **Database Name**: `northstar_pos_offline`
- **Schema Version**: `1`
- **Driver**: Dexie.js v4.4.7
- **Test In-Memory Driver**: `fake-indexeddb` v6.1.0

### Store Definitions

| Store Name | Primary Key | Indexes | Purpose & Invariants |
|---|---|---|---|
| `deviceMetadata` | `id` | `deviceId, schemaVersion` | Persists stable synthetic device installation ID (`dev_<UUID>`). Singleton record. |
| `cachedProducts` | `id` | `[userId+businessId+snapshotId], productId, name, sku, barcode, categoryId, status` | Scoped product catalog snapshot. Strictly excludes purchase cost. Selling price in integer paise. |
| `cachedCategories` | `id` | `[userId+businessId+snapshotId], categoryId, slug, status, displayOrder` | Scoped categories snapshot for catalog navigation and filtering. |
| `cachedBranchStock` | `id` | `[userId+businessId+branchId+snapshotId], [userId+businessId+branchId+snapshotId+productId], productId` | Scoped branch inventory balances. Strictly informational last-known-stock cache. |
| `cacheSyncState` | `id` | `[userId+businessId], [userId+businessId+branchId], resource` | Tracks snapshot IDs, last successful sync timestamps, sync status, and record counts. |

---

## 2. Key Modules & Implemented Contracts

### 2.1 Type Contracts (`src/lib/offline/database.types.ts`)
- Defined strict interfaces for `DeviceMetadataRecord`, `CachedProductRecord`, `CachedCategoryRecord`, `CachedBranchStockRecord`, `CacheSyncStateRecord`, `StorageEstimateResult`, and `DatabaseHealthResult`.
- Selling prices are constrained to `sellingPriceMinor: number` (integer paise). `purchasePriceMinor` is explicitly omitted from client cache storage to protect merchant wholesale margins from shop-floor browser DevTools inspection.

### 2.2 Composite Scoping Keys (`src/lib/offline/cacheScopes.ts`)
- `buildProductKey(userId, businessId, snapshotId, productId)` -> `${userId}:${businessId}:${snapshotId}:${productId}`
- `buildCategoryKey(userId, businessId, snapshotId, categoryId)` -> `${userId}:${businessId}:${snapshotId}:${categoryId}`
- `buildStockKey(userId, businessId, branchId, snapshotId, productId)` -> `${userId}:${businessId}:${branchId}:${snapshotId}:${productId}`
- `buildSyncStateKey(userId, businessId, branchId, resource)` -> `${userId}:${businessId}:${branchId}:${resource}`

### 2.3 Synthetic Device Identity (`src/lib/offline/deviceIdentity.ts`)
- `getOrCreateDeviceId(db)`: Generates a persistent random UUID (`dev_${crypto.randomUUID()}`) on first initialization and stores it in the `deviceMetadata` table under the `singleton` key.
- Avoids hardware fingerprinting; survives page reloads; can be reset on full application data reset.

### 2.4 Storage Management (`src/lib/offline/storageManager.ts`)
- `getStorageEstimate()`: Queries `navigator.storage.estimate()` and `navigator.storage.persisted()`. Computes percentage used and emits warnings at 75% and 90% capacity. Gracefully falls back in headless/test environments.
- `requestPersistentStorage()`: Calls `navigator.storage.persist()` to prevent aggressive browser storage eviction.
- `isStorageQuotaExceeded(err)`: Accurately checks for `QuotaExceededError` or `NS_ERROR_DOM_QUOTA_REACHED`.

### 2.5 Diagnostic Health Checks (`src/lib/offline/databaseHealth.ts`)
- `checkDatabaseHealth(db)`: Audits database connectivity, table count integrity across all 5 stores, schema version, storage utilization, and device identity.

### 2.6 Offline Database Singleton (`src/lib/offline/database.ts`)
- Subclasses `Dexie` to expose strongly typed tables and high-level transactional methods:
  - `activateSnapshot()`: Atomic transaction updating `cacheSyncState` and purging old snapshot records.
  - `rollbackCandidateSnapshot()`: Safely purges staged records if sync fails midway.
  - `queryProducts()`: Scoped query with multi-term search (name, SKU, barcode) and category filter.
  - `queryCategories()`: Scoped query sorted by `displayOrder` and `name`.
  - `queryStockMap()`: Returns a fast lookup `Map<productId, CachedBranchStockRecord>`.
  - `clearScopedCache()`: Purges cached tenant data on user logout or business switch.
  - `clearAllOfflineData()`: Emergency reset clearing all cache stores while preserving device ID.

---

## 3. Verification & Test Evidence

### Vitest Suite: `tests/offlineDatabase.test.ts`
```
 ✓ tests/offlineDatabase.test.ts (10 tests) 44ms
   ✓ Device Identity & Initialization > initializes schema version 1 and creates required stores
   ✓ Device Identity & Initialization > generates, persists, and returns a stable device ID
   ✓ Scoped Keys and Tenant/Branch Isolation > isolates cached products between different businesses and users
   ✓ Scoped Keys and Tenant/Branch Isolation > isolates branch stock across branches in the same business
   ✓ Atomic Snapshot Activation and Stale Snapshot Purging > activates candidate snapshot and deletes prior snapshot records atomically
   ✓ Atomic Snapshot Activation and Stale Snapshot Purging > rolls back candidate snapshot records when sync encounters an error
   ✓ Diagnostic Health & Storage Verification > reports accurate health metrics and store counts
   ✓ Diagnostic Health & Storage Verification > identifies storage quota exceeded errors accurately
   ✓ Scoped Queries with Filtering and Sorting > filters products by search term and category ID
   ✓ Scoped Queries with Filtering and Sorting > returns categories sorted by displayOrder
```

---

## 4. Next Step Transition

With Step 13.2 complete and fully verified, we proceed directly to **Step 13.3 — Products & Categories Offline Read-Only Caching**.

