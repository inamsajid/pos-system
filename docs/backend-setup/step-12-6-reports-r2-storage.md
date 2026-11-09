# Step 12.6 Implementation & Setup Guide: Reports, Analytics & Cloudflare R2 Storage

## Overview
- **Step**: 12.6
- **Status**: Completed & Verified
- **Scope**: Accurate, Server-Aggregated Reports and Analytics + Private Multi-Tenant Cloudflare R2 Object Storage
- **Baseline Test Suite**: 38 test files, 284 automated tests passing (100% green)

---

## 1. Reports & Analytics Architecture

### 1.1 Core Principles
1. **Server-Side SQL Aggregation**: All reports are computed directly on Cloudflare D1 using indexed SQL aggregation rather than pulling unbounded raw transactional rows into Worker memory.
2. **Anti-Double-Counting Strictness**: In accordance with financial accounting policy, sales totals and payment allocations are never computed via Cartesian joins. Querying items, payments, and invoices uses isolated aggregate subqueries and CTEs.
3. **Financial Honesty**:
   - The Expenses module is an upcoming feature and currently not persisted.
   - Operating expenses and net profit are returned explicitly as `{ isAvailable: false, reason: "Expenses module is not yet implemented" }` rather than misleading the user with false zeros or fabricated figures.
   - COGS is reported as `{ isAvailable: true, method: "snapshot_unit_cost" }` based on historical `sale_items.unit_cost_minor` snapshots captured at the exact moment of checkout.
4. **Timezone & Business Date**:
   - Canonical business date calculations use the `Asia/Karachi` timezone (`UTC+05:00`).
   - Inclusive calendar date filters (`fromDate <= business_date_key <= toDate`) prevent timezone-shift leakage.

---

### 1.2 Reports Endpoints & Capabilities

| Endpoint | Method | Permission | Scope / Filters | Description |
|---|---|---|---|---|
| `/api/v1/reports/dashboard` | GET | `reports_view` | `fromDate`, `toDate`, `branchId` | Executive summary metrics for sales, collections, purchases, and inventory |
| `/api/v1/reports/sales/summary` | GET | `reports_view` | `fromDate`, `toDate`, `branchId` | Gross sales, discounts, net sales, taxes, paid vs unpaid amounts |
| `/api/v1/reports/sales/trends` | GET | `reports_view` | `fromDate`, `toDate`, `branchId`, `interval` (`daily`/`monthly`) | Time-series sales revenue and volume trends |
| `/api/v1/reports/sales/by-product` | GET | `reports_view` | `fromDate`, `toDate`, `branchId`, `categoryId`, `limit` | Ranked products by revenue, unit volume, and margins |
| `/api/v1/reports/sales/by-category` | GET | `reports_view` | `fromDate`, `toDate`, `branchId` | Category volume and revenue breakdown |
| `/api/v1/reports/payments/summary` | GET | `reports_view` | `fromDate`, `toDate`, `branchId` | Collections summary (cash, digital, allocated, unallocated advances) |
| `/api/v1/reports/payments/by-method` | GET | `reports_view` | `fromDate`, `toDate`, `branchId` | Payment method breakdown (volume, rupees, percentage share) |
| `/api/v1/reports/purchases/summary` | GET | `reports_view` | `fromDate`, `toDate`, `branchId` | Purchases volume, received vs pending status, paid vs unpaid |
| `/api/v1/reports/purchases/trends` | GET | `reports_view` | `fromDate`, `toDate`, `branchId`, `interval` | Procurement volume trends over time |
| `/api/v1/reports/suppliers/payables` | GET | `reports_view` | Business | Outstanding supplier liabilities and unallocated advances |
| `/api/v1/reports/inventory/summary` | GET | `reports_view` | `branchId` | In-stock, low-stock, out-of-stock counts, total quantity, and valuation |
| `/api/v1/reports/inventory/movements` | GET | `reports_view` | `fromDate`, `toDate`, `branchId`, `productId`, `type`, `limit`, `offset` | Stock movements audit trail |
| `/api/v1/reports/inventory/low-stock` | GET | `reports_view` | `branchId`, `limit`, `offset` | Products at or below reorder threshold |
| `/api/v1/reports/inventory/valuation` | GET | `reports_view` | `branchId` | Line-by-line stock valuation using perpetual cost baseline |
| `/api/v1/reports/customers/receivables` | GET | `reports_view` | Business | Customers with open receivable balances and unallocated advances |
| `/api/v1/reports/export` | GET | `reports_view` | `reportType`, `fromDate`, `toDate`, `branchId` | Downloadable CSV document with formula injection sanitization |

---

### 1.3 CSV Export & Formula Injection Defense (CWE-1236)
When exporting to CSV via `/api/v1/reports/export`:
- Any cell whose string value starts with `= `, `+`, `-`, `@`, `\t`, or `\r` has a single quote `'` prepended to prevent spreadsheet formula execution upon opening in Excel, LibreOffice, or Google Sheets.
- Values containing quotes, commas, or newlines are wrapped in double quotes and inner quotes escaped as `""`.
- Response headers set:
  - `Content-Type: text/csv; charset=utf-8`
  - `Content-Disposition: attachment; filename="<type>-report-<from>-to-<to>.csv"`
  - `X-Content-Type-Options: nosniff`
  - `Cache-Control: private, no-cache, no-store, must-revalidate`

---

## 2. Cloudflare R2 Object Storage Architecture

### 2.1 Storage Layout & Multi-Tenant Partitioning
All unstructured media and documents are partitioned by `business_id` and category inside the private Cloudflare R2 bucket (`FILES` binding):

```text
businesses/{businessId}/[branches/{branchId}/]{category}/{fileId}-{sanitizedFilename}
```

### 2.2 Allowed Categories & Limits

| Category | Allowed Formats / MIME Types | Max Size | Upload Permission | Read Permission |
|---|---|---|---|---|
| `product_image` | JPEG, PNG, WebP (`image/*`) | 5 MiB | `catalog_write` | Authenticated staff |
| `business_logo` | JPEG, PNG, WebP (`image/*`) | 5 MiB | `owner`, `admin` | Authenticated staff |
| `invoice_pdf` | PDF (`application/pdf`) | 10 MiB | `pos_sale`, `collect_payments` | Authenticated staff |
| `receipt_attachment` | JPEG, PNG, WebP, PDF | 10 MiB | `pos_sale`, `collect_payments` | Authenticated staff |
| `purchase_document` | PDF, JPEG, PNG | 10 MiB | `purchase_order`, `receive_goods` | Procurement / Accounting |
| `supplier_document` | PDF, JPEG, PNG | 10 MiB | `purchase_order`, `disburse_payments` | Procurement / Accounting |
| `report_export` | CSV, PDF | 10 MiB | `reports_view`, `export_backup` | `reports_view` |

### 2.3 File Upload Security Controls
- **Magic Bytes Verification**: Inspects file headers to verify genuine binary signatures (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF...WEBP`, PDF `%PDF`).
- **Forbidden Payloads**: Strictly rejects executable binaries (Windows PE `MZ`, ELF, Mach-O), HTML, SVGs, and script tags in CSVs.
- **Filename Sanitization**: Completely strips directory traversal (`../`, `\`), null bytes, non-ASCII control characters, and special characters; enforces safe alphanumeric naming up to 100 characters.
- **Related Entity Validation**: When `relatedType` and `relatedId` are supplied, D1 verifies the entity exists under the caller's `business_id`. Cross-tenant attachments are rejected.

### 2.4 Upload & Deletion Lifecycles
- **Upload Lifecycle**:
  1. Insert D1 record in `files` with status `'pending'`.
  2. Put binary stream into `env.FILES` R2 bucket with `httpMetadata` and `customMetadata`.
  3. Update D1 status to `'available'`.
  4. If R2 write fails, status is updated to `'failed'`.
- **Deletion Lifecycle (Idempotent)**:
  1. Verify caller has permission (Owner/Admin or original uploader).
  2. Call `env.FILES.delete(objectKey)`.
  3. Mark D1 record `status = 'deleted'` and `deleted_at = datetime('now')`.
  4. Repeated delete calls return HTTP 200 without throwing errors.

---

## 3. Database Schema (Migration `0011_file_storage.sql`)

```sql
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  sanitized_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
  category TEXT NOT NULL CHECK(category IN (
    'product_image', 'business_logo', 'invoice_pdf', 'receipt_attachment',
    'purchase_document', 'supplier_document', 'report_export'
  )),
  related_type TEXT CHECK(related_type IN (
    'product', 'business', 'branch', 'sale', 'invoice', 'purchase',
    'goods_receipt', 'supplier', 'customer', 'report'
  )),
  related_id TEXT,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'available', 'deleted', 'failed')) DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
```

### Composite Performance Indexes Added:
- `idx_files_business` on `files(business_id, status)`
- `idx_files_related` on `files(business_id, related_type, related_id)`
- `idx_files_branch` on `files(business_id, branch_id)`
- `idx_payments_biz_branch_date` on `payments(business_id, branch_id, business_date_key)`
- `idx_purchases_biz_branch_date` on `purchases(business_id, branch_id, purchase_date_key)`
- `idx_goods_receipts_biz_branch_date` on `goods_receipts(business_id, branch_id, business_date_key)`
- `idx_supplier_payments_biz_branch_date` on `supplier_payments(business_id, branch_id, business_date_key)`
- `idx_inventory_balances_branch_qty` on `inventory_balances(business_id, branch_id, quantity_on_hand)`

---

## 4. Verification & Testing Evidence

```text
Test Files  38 passed (38)
Tests       284 passed (284)
Worker TS   0 errors (tsc -p tsconfig.worker.json --noEmit)
Frontend    0 errors (tsc -b && vite build)
Lint        8 non-blocking warnings, 0 errors (oxlint)
D1 Local    11 migrations applied, 0 pending
```

