# Server Change Feed & Cursor Pagination Guide

## 1. Schema & Physical Design

The central sequence feed is stored in Cloudflare D1 in the `sync_change_log` table:

```sql
CREATE TABLE IF NOT EXISTS sync_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('product', 'category', 'stock')),
  resource_id TEXT NOT NULL,
  resource_version INTEGER NOT NULL DEFAULT 1,
  operation TEXT NOT NULL CHECK(operation IN ('upsert', 'archive', 'delete')),
  payload TEXT NOT NULL DEFAULT '{}',
  event_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_change_log_cursor
  ON sync_change_log(business_id, id);

CREATE INDEX IF NOT EXISTS idx_sync_change_log_branch
  ON sync_change_log(business_id, branch_id, id);
```

### Monotonicity Guarantee
- The `id INTEGER PRIMARY KEY AUTOINCREMENT` column provides a strictly increasing, gapless sequence ID per database instance.
- Clients consume the stream by maintaining a cursor formatted as `seq_<id>` (e.g. `seq_104`).

---

## 2. Event Payload Allowlisting

To prevent sensitive operational margins and confidential purchase costs from leaking over public device sync channels, payloads are strictly allowlisted:

### Product Upsert Payload
```json
{
  "id": "prod_101",
  "businessId": "biz_01",
  "categoryId": "cat_01",
  "sku": "MLK-01",
  "barcode": "8901234567890",
  "name": "Whole Milk 1L",
  "description": "Fresh dairy whole milk",
  "imageUrl": null,
  "unit": "liter",
  "sellingPriceMinor": 25000,
  "lowStockThreshold": 10.0,
  "trackInventory": true,
  "status": "active",
  "version": 2,
  "updatedAt": "2026-11-09T18:30:00.000Z"
}
```
*Notice: `purchasePriceMinor` is explicitly stripped and never inserted into the change log.*

### Category Upsert Payload
```json
{
  "id": "cat_01",
  "businessId": "biz_01",
  "name": "Fresh Dairy",
  "slug": "fresh-dairy",
  "description": "Milk, butter and cheeses",
  "parentId": null,
  "displayOrder": 1,
  "status": "active",
  "version": 2,
  "updatedAt": "2026-11-09T18:30:00.000Z"
}
```

### Branch Stock Payload
```json
{
  "productId": "prod_101",
  "branchId": "branch_01",
  "quantityOnHand": 94.0,
  "unit": "liter",
  "updatedAt": "2026-11-09T18:30:00.000Z"
}
```

---

## 3. Pull API Contract

`GET /api/v1/sync/changes`

### Query Parameters
- `cursor` (optional): The last acknowledged cursor, e.g. `seq_42`. If omitted, stream starts from beginning (`id > 0`).
- `limit` (optional): Page size, defaults to 50, maximum 200.
- `branchId` (optional): Filter stock events for a specific branch.

### Headers Required
- `Authorization: Bearer <token>`
- `X-Business-Id: <businessId>`
- `X-Device-Id: <installationId>`

### Response Contract (200 OK)
```json
{
  "success": true,
  "data": {
    "changes": [
      {
        "seq": 43,
        "resourceType": "product",
        "resourceId": "prod_101",
        "resourceVersion": 2,
        "operation": "upsert",
        "branchId": null,
        "data": {
          "id": "prod_101",
          "name": "Whole Milk 1L",
          "sellingPriceMinor": 25000,
          "version": 2
        },
        "createdAt": "2026-11-09T18:30:00.000Z"
      }
    ],
    "nextCursor": "seq_43",
    "hasMore": false,
    "serverTime": "2026-11-09T18:30:05.000Z"
  },
  "requestId": "req_uuid"
}
```

---

## 4. Cursor Acknowledgement Contract

`POST /api/v1/sync/ack`

### Request Body
```json
{
  "installationId": "dev_inst_tablet_01",
  "cursor": "seq_43"
}
```

### Response Contract (200 OK)
```json
{
  "success": true,
  "data": {
    "success": true,
    "acknowledgedCursor": "seq_43"
  },
  "requestId": "req_uuid"
}
```

