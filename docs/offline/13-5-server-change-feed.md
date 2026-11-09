# Step 13.5 — Server Change Feed Specification

## 1. D1 Change Log Schema

Authoritative changes are appended into the `sync_change_log` table inside the exact same atomic `DB.batch()` transaction as the underlying mutation:

```sql
CREATE TABLE IF NOT EXISTS sync_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT REFERENCES branches(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('product', 'category', 'stock')),
  resource_id TEXT NOT NULL,
  resource_version INTEGER NOT NULL DEFAULT 1,
  operation TEXT NOT NULL CHECK(operation IN ('upsert', 'archive', 'delete')),
  payload TEXT NOT NULL,
  event_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, event_id)
);
```

### Table Properties:
- `id`: Monotonically increasing sequence ID.
- `business_id`: Multi-tenant boundary.
- `branch_id`: `NULL` for business-wide catalog changes (products, categories); populated with specific `branch_id` for stock balance updates.
- `event_id`: Unique deduplication key: `${business_id}:${resource_type}:${resource_id}:${resource_version}` or `${business_id}:stock:${branch_id}:${product_id}:${movement_number}`.
- `payload`: JSON string representing allowlisted DTO fields only.

---

## 2. Authoritative Mutation Sources

A change event is recorded ONLY at the authoritative write point:

1. **Products**:
   - `POST /api/v1/products`: Initial insert (`version: 1`, `operation: 'upsert'`).
   - `PUT /api/v1/products/:id` & `PATCH /api/v1/products/:id`: Optimistic concurrency check, increments version (`version: version + 1`, `operation: 'upsert'`).
   - `DELETE /api/v1/products/:id`: Soft archive, increments version (`operation: 'archive'`).
2. **Categories**:
   - `POST /api/v1/categories`: Initial insert (`version: 1`, `operation: 'upsert'`).
   - `PUT /api/v1/categories/:id` & `PATCH /api/v1/categories/:id`: Optimistic concurrency check, increments version (`operation: 'upsert'`).
   - `DELETE /api/v1/categories/:id`: Soft archive (`operation: 'archive'`).
3. **Branch Stock Snapshots**:
   - Sales (`POST /api/v1/sales`)
   - Goods Receipts (`POST /api/v1/purchases/:id/receipts`)
   - Stock Adjustments (`POST /api/v1/inventory/adjustments`)
   - Stock Counts (`POST /api/v1/inventory/counts/:id/complete`)
   Emits stock event for affected products with `quantityOnHand` and `unit`.

---

## 3. Atomic Batch Recording

In Cloudflare D1, `DB.batch([stmt1, stmt2, ...])` executes sequentially in a single SQLite transaction:
```ts
const batch = [
  db.prepare(`UPDATE products SET selling_price_minor = ?, version = version + 1, updated_at = datetime('now') WHERE id = ? AND version = ?`),
  db.prepare(`INSERT INTO sync_change_log (business_id, resource_type, resource_id, resource_version, operation, payload, event_id) VALUES (?, ?, ?, ?, ?, ?, ?)`),
]
await db.batch(batch)
```
If statement 1 fails or affects 0 rows (stale version), the batch aborts and the change event is never inserted.

