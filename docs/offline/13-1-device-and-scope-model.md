# Step 13.1 Device Identity and Multi-Tenant Scope Model

## 1. Device Installation Identity

To support future multi-device synchronization (Step 13.4+) without tracking invasive hardware identifiers, Northstar POS defines a **Synthetic Device Installation Identity**.

### 1.1 Specification & Invariants
- **Generation**: Generated once on first local database initialization using the Web Crypto API:
  ```ts
  const deviceId = `dev_${crypto.randomUUID()}`
  ```
- **Storage**: Stored in Dexie table `deviceMetadata` alongside the initial setup timestamp and schema version.
- **Stability**: Remains constant for the lifetime of the browser profile. Resetting or clearing the browser's IndexedDB generates a new installation identity upon subsequent launch.
- **Privacy & Security Constraints**:
  - The `deviceId` is **NEVER used as a secret, authentication token, or password**.
  - It is **NEVER derived from hardware fingerprints** (MAC addresses, CPU serials, screen resolution, or canvas fingerprints).
  - In future synchronization phases, it will be transmitted as an HTTP metadata header (`X-Device-Id`) solely to assist D1 in tracking device sync cursors and outbox batch origins.

---

## 2. Multi-Tenant and Multi-Branch Scoping Model

A single POS device (desktop PC or cashier tablet) may be shared by multiple store employees across multiple shifts, or used to manage multiple retail businesses owned by the same proprietor.

### 2.1 Partitioning Hierarchy

```text
[User Context: userId]
  └── [Business Scope: businessId]
        ├── Catalog Snapshots (Products & Categories)
        └── [Branch Scope: branchId]
              └── Informational Stock Snapshots
```

Every cached record in Dexie embeds a strict scoping compound key:

| Dexie Store | Compound Index / Scope Key | Purpose |
| :--- | :--- | :--- |
| `cachedProducts` | `[userId+businessId+snapshotId+productId]` | Completely isolates product catalog per user and business. |
| `cachedCategories` | `[userId+businessId+snapshotId+categoryId]` | Completely isolates category hierarchy per user and business. |
| `cachedBranchStock` | `[userId+businessId+branchId+snapshotId+productId]` | Isolates stock counts to the authorized branch context. |
| `cacheSyncState` | `[userId+businessId+branchId+resource]` | Tracks sync status per distinct operational scope. |

### 2.2 Scope Isolation Invariants
1. **No Shared Catalog Across Businesses**: When User A switches from "Northstar Supermarket" (`biz_01`) to "Northstar Pharmacy" (`biz_02`), local queries immediately re-scope to `biz_02`. Zero records from `biz_01` are returned.
2. **Branch Stock Segregation**: Cashiers assigned strictly to "Branch Alpha" (`branch_a`) cannot access stock counts cached for "Branch Beta" (`branch_b`), preventing cross-branch stock leakage on shared manager terminals.
3. **Session Switching Safety**: On sign-out or account switch, in-memory TanStack Query caches are cleared via `queryClient.clear()`. Dexie partitions remain separated by `userId`.

