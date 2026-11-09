# Step 12.8 Performance and Capacity Checks

This document summarizes the performance evaluation, query plan inspection, bundle analysis, and capacity boundaries for the Northstar POS application.

> [!NOTE]
> All benchmarks and query plans in this audit were measured against synthetic local development data using the Node.js SQLite engine and Miniflare/workerd local emulation. Results represent local baseline characteristics; production performance will depend on Cloudflare edge routing and network latency.

---

## 1. D1 Query Execution Plans (EXPLAIN QUERY PLAN)

Crucial operational queries were evaluated to verify that index lookups are utilized rather than full table scans:

### 1.1 Inventory Balance Lookup
- **Query**:
  ```sql
  SELECT quantity_on_hand FROM inventory_balances 
  WHERE business_id = ? AND branch_id = ? AND product_id = ?;
  ```
- **Execution Plan**:
  ```text
  SEARCH inventory_balances USING INDEX sqlite_autoindex_inventory_balances_2 (branch_id=? AND product_id=?)
  ```
- **Analysis**: Direct $O(1)$ indexed lookup. Zero full table scanning.

### 1.2 Chronological Customer Ledger Query
- **Query**:
  ```sql
  SELECT * FROM customer_ledger_transactions 
  WHERE business_id = ? AND customer_id = ? 
  ORDER BY business_date_key ASC, rowid ASC 
  LIMIT 50 OFFSET 0;
  ```
- **Execution Plan**:
  ```text
  SEARCH customer_ledger_transactions USING INDEX idx_cust_ledger_history (business_id=? AND customer_id=?)
  ```
- **Analysis**: Uses the compound index `(business_id, customer_id, business_date_key)` to retrieve ledger transactions.

### 1.3 Sales Listing Scoped by Date Range & Branch
- **Query**:
  ```sql
  SELECT * FROM sales 
  WHERE business_id = ? AND branch_id = ? AND business_date_key >= ? AND business_date_key <= ? 
  ORDER BY business_date_key DESC 
  LIMIT 20;
  ```
- **Execution Plan**:
  ```text
  SEARCH sales USING INDEX idx_sales_biz_branch_date (business_id=? AND branch_id=? AND business_date_key>? AND business_date_key<?)
  ```
- **Analysis**: High-performance indexed range scan matching the trading day index.

### 1.4 Stock Movement History
- **Query**:
  ```sql
  SELECT * FROM stock_movements 
  WHERE business_id = ? AND branch_id = ? AND product_id = ? 
  ORDER BY created_at DESC 
  LIMIT 50;
  ```
- **Execution Plan**:
  ```text
  SEARCH stock_movements USING INDEX idx_stock_mov_product_date (business_id=? AND product_id=?)
  USE TEMP B-TREE FOR ORDER BY
  ```
- **Analysis**: Product-filtered index scan; sorts only the filtered movements for that specific product.

---

## 2. API Pagination and Unbounded Query Safeguards

All listing endpoints enforce hard pagination caps in their validation schemas to prevent memory exhaustion:

| API Endpoint | Default Limit | Maximum Permitted Limit | SQL Mechanism |
| :--- | :--- | :--- | :--- |
| `GET /api/v1/products` | 20 | 100 | `LIMIT ? OFFSET ?` |
| `GET /api/v1/sales` | 20 | 100 | `LIMIT ? OFFSET ?` |
| `GET /api/v1/invoices` | 20 | 100 | `LIMIT ? OFFSET ?` |
| `GET /api/v1/purchases` | 20 | 100 | `LIMIT ? OFFSET ?` |
| `GET /api/v1/goods-receipts` | 20 | 100 | `LIMIT ? OFFSET ?` |
| `GET /api/v1/customer-payments` | 20 | 100 | `LIMIT ? OFFSET ?` |
| `GET /api/v1/supplier-payments` | 20 | 100 | `LIMIT ? OFFSET ?` |
| `GET /api/v1/customers/:id/ledger` | 50 | 200 | `LIMIT ? OFFSET ?` |
| `GET /api/v1/suppliers/:id/ledger` | 50 | 200 | `LIMIT ? OFFSET ?` |
| `GET /api/v1/inventory/movements` | 50 | 200 | `LIMIT ? OFFSET ?` |

---

## 3. Bundle Size and Frontend Build Metrics

- **Vite Build Time**: **968 ms** (2,717 modules transformed).
- **Core Assets**:
  - `dist/index.html`: **1.07 kB** (gzip: 0.46 kB)
  - `dist/assets/index-*.css`: **42.82 kB** (gzip: 8.87 kB)
  - `dist/assets/index-*.js`: **450.04 kB** (gzip: 120.89 kB)
- **Code Splitting**: Feature pages and modals are split into granular chunks (`ProductsPage`, `SalesPage`, `InvoicesPage`, `ReportsPage`, `DashboardPage`), ensuring initial page loads do not download unused domain code.

---

## 4. Cloudflare R2 Memory & Streaming Considerations

- **Streaming Uploads**: Files are received via `multipart/form-data` and validated using first 512 bytes for magic signatures.
- **Maximum File Size Limit**: Enforced at **10 MB** in `file.service.ts` to prevent Worker memory overload.
- **Streaming Content Delivery**: Responses use `new Response(object.body)` with native ReadableStream piping, avoiding buffering entire file contents in Worker memory.

---

## 5. Capacity Boundaries & Operational Limits

1. **D1 Database Row Limits**: D1 database per-account size is currently 10 GB on Workers Paid. With indexed rows of ~200 bytes, Northstar can store > 5 million sales transactions before database tier partitioning is required.
2. **D1 Batch Operation Limit**: Cloudflare D1 supports batches of up to 100 statements. POS checkout executes ~6–8 statements per transaction (well within the 100-statement limit).
3. **Cache Invalidation**: TanStack Query relies on short stale times (`staleTime: 30_000ms`) and explicit cache clearing on tenant switch to prevent stale reads while avoiding unnecessary network polling.

