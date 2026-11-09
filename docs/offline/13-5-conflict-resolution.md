# Step 13.5 — Conflict Resolution Specification

## 1. Conflict Classification & Resolution Rules

| Data Domain | Synchronization Model | Concurrency Mechanism | Conflict Behavior |
|---|---|---|---|
| **Product Master** | Optimistic Concurrency | `version: number` | Rejects stale version with `409 Conflict`. Preserves local draft for review. |
| **Category Master** | Optimistic Concurrency | `version: number` | Rejects stale version with `409 Conflict`. Preserves local draft for review. |
| **Inventory / Stock** | Server Authoritative | Movement ledger sequence | Stale stock cannot authorize transactions. Server validates on live write. |
| **Sales & Financials** | Idempotent Command | `idempotencyKey` | Replays return original receipt. Modified payloads return `409 Conflict`. |

---

## 2. Product & Category Optimistic Concurrency Protocol

1. Client loads a product at server version `v4`.
2. Client submits update:
   ```json
   {
     "name": "Updated Espresso",
     "sellingPriceMinor": 35000,
     "expectedVersion": 4
   }
   ```
3. Server executes atomic conditional update:
   ```sql
   UPDATE products
   SET name = ?, selling_price_minor = ?, version = version + 1, updated_at = datetime('now')
   WHERE id = ? AND business_id = ? AND version = ?
   ```
4. If row count === 1:
   - Server responds `200 OK` with `version: 5`.
   - Append event to `sync_change_log` with `resource_version: 5`.
5. If row count === 0:
   - The product was concurrently modified by another terminal (e.g. now at `v5`).
   - Server responds `409 Conflict`:
     ```json
     {
       "success": false,
       "error": {
         "code": "VERSION_CONFLICT",
         "message": "Product was modified by another device. Expected version 4, current server version is 5.",
         "details": {
           "resourceId": "prod_123",
           "expectedVersion": 4,
           "serverVersion": 5
         }
       }
     }
     ```
6. Client handling:
   - Preserves user's attempted draft.
   - Refreshes latest server copy.
   - Displays a conflict review modal showing differences.
   - Allows user to overwrite intentionally (by adopting new version) or discard changes.

---

## 3. Stock Invariants

- Stock balances are NEVER merged using Last-Write-Wins.
- Stock movements are append-only and immutable.
- Offline stock displayed in the UI is strictly informational last-known snapshot data.

