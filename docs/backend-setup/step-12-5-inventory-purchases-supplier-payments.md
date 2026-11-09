# Step 12.5: Inventory, Purchases, Goods Receipts, Supplier Payments & Supplier Ledger API Documentation

## Executive Overview
- **Step**: 12.5 (Inventory, Purchases, Goods Receipts, Supplier Payments & Supplier Ledger Backend APIs)
- **Status**: Complete & Verified
- **Runtime Target**: Cloudflare Workers + Cloudflare D1 (SQLite) + React/Vite PWA
- **Security Boundary**: Zero-Trust Multi-Tenancy with Server-Derived Business Context, RBAC Enforcement, and Branch Scoping
- **Inventory Valuation**: Perpetual Moving Weighted Average (MWA) Architecture (BDR-02 / DEC-02)
- **Financial Correctness**: Integer Minor Units (PKR Paise), Strict Double-Entry Ledger Principles, and Atomic Single-Batch Execution (`db.batch()`)
- **PO Cancellation Protocol**: Hard blocking if received quantity > 0 or payments have been allocated (BDR-10 / DEC-10)
- **Idempotency Guarantee**: Header `Idempotency-Key` + SHA-256 Canonical Request Hash

---

## 1. Implemented Endpoints & Permissions Matrix

All endpoints require active session authentication via cookie (`__session`) or Bearer token (`Authorization: Bearer <token>`), and resolve tenant context via `X-Business-Id` and `X-Branch-Id`.

| Module | Method | Endpoint | Permission / Role | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Suppliers** | `GET` | `/api/v1/suppliers` | Authenticated member | Read-only lookup of active suppliers with search and pagination |
| **Suppliers** | `GET` | `/api/v1/suppliers/:id` | Authenticated member | Fetch single supplier details within authorized business |
| **Inventory** | `GET` | `/api/v1/inventory/balances` | Authenticated member | List stock balances with branch scoping and low-stock filtering |
| **Inventory** | `GET` | `/api/v1/inventory` | Authenticated member | Alias route for listing stock balances |
| **Inventory** | `GET` | `/api/v1/inventory/balances/:productId` | Authenticated member | Fetch product stock levels broken down by authorized branch |
| **Inventory** | `GET` | `/api/v1/inventory/movements` | Authenticated member | Audit trail of all stock movements with type, product, and date filters |
| **Inventory** | `GET` | `/api/v1/stock-movements` | Authenticated member | Alias route for stock movements |
| **Inventory** | `POST` | `/api/v1/inventory/adjustments` | `stock_adjustment` | Record manual stock adjustment (positive/negative) with audit movement |
| **Inventory** | `POST` | `/api/v1/stock-adjustments` | `stock_adjustment` | Alias route for stock adjustments |
| **Inventory** | `GET` | `/api/v1/inventory/counts` | Authenticated member | List stocktake sheets with status and branch filtering |
| **Inventory** | `GET` | `/api/v1/stock-counts` | Authenticated member | Alias route for listing stock counts |
| **Inventory** | `POST` | `/api/v1/inventory/counts` | Authenticated member | Create draft count sheet (**zero stock change**, snapshots current QOH) |
| **Inventory** | `POST` | `/api/v1/stock-counts` | Authenticated member | Alias route for creating draft count sheet |
| **Inventory** | `GET` | `/api/v1/inventory/counts/:id` | Authenticated member | Fetch stock count sheet with items, expected vs counted, and variance |
| **Inventory** | `GET` | `/api/v1/stock-counts/:id` | Authenticated member | Alias route for fetching count sheet |
| **Inventory** | `POST` | `/api/v1/inventory/counts/:id/complete` | `stocktake_confirm` | Finalize stock count, reconcile balances, post variance movements |
| **Inventory** | `POST` | `/api/v1/stock-counts/:id/complete` | `stocktake_confirm` | Alias route for completing stock count |
| **Inventory** | `POST` | `/api/v1/inventory/counts/:id/confirm` | `stocktake_confirm` | Alias route for confirming stock count |
| **Inventory** | `POST` | `/api/v1/stock-counts/:id/confirm` | `stocktake_confirm` | Alias route for confirming stock count |
| **Purchases** | `GET` | `/api/v1/purchases` | Authenticated member | List purchase orders with status, supplier, branch, and date filters |
| **Purchases** | `GET` | `/api/v1/purchases/:id` | Authenticated member | Fetch purchase order details with line items and immutable supplier snapshot |
| **Purchases** | `POST` | `/api/v1/purchases` | `purchase_order` | Create draft purchase order (**zero stock change**, multi-item totals) |
| **Purchases** | `PATCH` | `/api/v1/purchases/:id` | `purchase_order` | Update draft purchase order (notes, delivery date, supplier invoice number) |
| **Purchases** | `POST` | `/api/v1/purchases/:id/confirm` | `purchase_order` | Confirm PO: transitions from `draft` to `ordered` (**zero stock change**) |
| **Purchases** | `POST` | `/api/v1/purchases/:id/cancel` | `purchase_order` | Cancel PO: hard blocked if items already received or payments allocated (BDR-10) |
| **Purchases** | `POST` | `/api/v1/purchases/:id/receipts` | `receive_goods` | Inward Goods Receipt: increments stock, updates MWA cost, posts bill to supplier ledger |
| **Goods Receipts** | `GET` | `/api/v1/goods-receipts` | Authenticated member | List goods receipts with branch, supplier, and purchase filters |
| **Goods Receipts** | `GET` | `/api/v1/goods-receipts/:id` | Authenticated member | Fetch goods receipt details and received line items |
| **Supplier Payments** | `GET` | `/api/v1/supplier-payments` | `disburse_payments` \| `purchases:read` | List supplier disbursements and unallocated advance balances |
| **Supplier Payments** | `GET` | `/api/v1/supplier-payments/:id` | `disburse_payments` \| `purchases:read` | Fetch supplier payment detail with invoice allocations |
| **Supplier Payments** | `POST` | `/api/v1/supplier-payments` | `disburse_payments` | Disburse payment, allocate against POs, post debit to supplier ledger |
| **Supplier Payments** | `GET` | `/api/v1/supplier-payments/:id/allocations` | `disburse_payments` \| `purchases:read` | List allocations made from a specific supplier payment |
| **Supplier Payments** | `POST` | `/api/v1/supplier-payments/:id/allocations` | `disburse_payments` | Allocate advance credit to subsequent PO bills without duplicate ledger debit |
| **Supplier Ledger** | `GET` | `/api/v1/suppliers/:supplierId/ledger` | Authenticated member | Chronological statement with running balance, opening balance, and date filters |
| **Supplier Ledger** | `GET` | `/api/v1/suppliers/:supplierId/ledger/summary` | Authenticated member | Supplier financial profile: current payable, total billed, total paid, open POs |

---

## 2. Inventory & Costing Architecture

### 2.1 Perpetual Moving Weighted Average (MWA) Valuation
Following approved architectural decision `BDR-02` / `DEC-02`:
- **Purchase Order Placement**: Creating or confirming a purchase order inserts records into `purchases` and `purchase_items` but touches **zero inventory balances** and creates **zero stock movements**.
- **Goods Receipt Trigger**: Inward stock movements and cost revaluations occur strictly when goods physically arrive at a branch via `POST /api/v1/purchases/:id/receipts`.
- **MWA Cost Formula**:
  $$\bar{C}_{\text{new}} = \frac{(Q_{\text{current}} \times \bar{C}_{\text{current}}) + (Q_{\text{received}} \times C_{\text{invoice}})}{Q_{\text{current}} + Q_{\text{received}}}$$
  If $Q_{\text{current}} \le 0$, $\bar{C}_{\text{new}} = C_{\text{invoice}}$.
- **Baseline Cost Update**: $\bar{C}_{\text{new}}$ is rounded to the nearest integer paise and updates `products.purchase_price_minor`.
- **Audit Locking**: The exact unit cost is recorded immutably on `goods_receipt_items.unit_cost_minor` and `stock_movements.unit_cost_minor`.

### 2.2 Stock Counts Separation
- **Draft Creation**: `POST /api/v1/inventory/counts` generates a draft stocktake sheet. It takes a system snapshot of `quantity_on_hand` for comparison against physical counted quantities. **No stock mutations or movements occur.**
- **Variance Reconciliation**: `POST /api/v1/inventory/counts/:id/complete` (and alias `/confirm`) finalizes the count:
  - Reconciles branch `inventory_balances.quantity_on_hand` to match counted physical stock.
  - Generates `stock_movements` with `type = 'stock_count_adjustment'` exclusively for products where $\text{variance} \neq 0$.
  - Products with 0 variance generate no spurious adjustment movements.
  - Marks count sheet as `confirmed`.

### 2.3 Negative Stock Prevention
- When `business_settings.allow_negative_stock = 0`, manual stock adjustments that would drive quantity below 0 are rejected with `422 Unprocessable Entity` (`INSUFFICIENT_STOCK`).

---

## 3. Financial & Accounting Conventions

### 3.1 Integer Minor Units (PKR Paise)
All prices, discounts, line totals, and payments are stored and calculated strictly as integers in minor currency units (paise: 1 PKR = 100 paise):
- `purchase_price_minor`
- `unit_cost_minor`
- `line_total_minor`
- `subtotal_minor`
- `total_amount_minor`
- `paid_amount_minor`
- `unallocated_amount_minor`
- `debit_minor` / `credit_minor`
- `balance_minor`

### 3.2 Supplier Ledger Accounting
A supplier is a liability account (Accounts Payable):
- **Goods Receipt (Bill)**: Increases payable owed to the supplier $\implies$ **CREDIT** (`credit_minor = totalReceivedValueMinor`, `debit_minor = 0`).
- **Supplier Payment**: Decreases payable owed to the supplier $\implies$ **DEBIT** (`debit_minor = amountMinor`, `credit_minor = 0`).
- **Running Balance**:
  $$\text{Balance} = \sum \text{Credits} - \sum \text{Debits}$$
  A positive balance indicates money owed to the supplier. A negative balance indicates a supplier advance (deposit in supplier's favor).
- **Advance Payment Protocol**:
  - When payment amount exceeds allocated purchase bills, the remaining excess is saved as `unallocated_amount_minor` on `supplier_payments`.
  - When advance is subsequently allocated via `POST /api/v1/supplier-payments/:id/allocations`, it settles subsequent purchase bills without creating a duplicate debit on the supplier ledger.

### 3.3 Purchase Order Cancellation Protocol (BDR-10)
- Cancelling a PO via `POST /api/v1/purchases/:id/cancel` is permitted only if:
  1. `received_quantity == 0` across all line items.
  2. `paid_amount_minor == 0`.
- If any items have already been received or payments allocated, cancellation is strictly blocked with `400 Bad Request`.

---

## 4. Verification Suite Results

Complete verification was executed across all new modules and historical regressions:

```powershell
npm test
```
**Results:**
- **33 test files passing (100%)**
- **259 automated tests passing (100%)**

### New Test Suites Implemented in Step 12.5:
1. `tests/inventoryApi.test.ts`: Balance queries, positive/negative manual adjustments, insufficient stock blocking, draft stock count creation (zero balance change), stock count completion and variance reconciliation.
2. `tests/purchasesApi.test.ts`: Multi-item draft PO creation, draft patching, order confirmation (zero stock change), cancellation protocol (BDR-10 blocking), archived supplier rejection, and RBAC enforcement.
3. `tests/goodsReceiptsApi.test.ts`: Full/partial goods receipt, stock increment, MWA unit cost valuation formula, over-receiving rejection, supplier ledger bill credit, and idempotency replay/conflict handling.
4. `tests/supplierPaymentsApi.test.ts`: Supplier disbursement, PO bill allocations, advance tracking (`unallocated_amount_minor`), advance allocation without duplicate ledger debits, over-allocation rejection, cross-supplier isolation, and idempotency.
5. `tests/supplierLedgerApi.test.ts`: Chronological running balance accuracy, date-filtered statement with prior opening balance calculation, transaction type filtering, and supplier financial summary metrics.
6. `tests/suppliersLookupApi.test.ts`: Read-only supplier listing with search and cross-tenant isolation.
7. `tests/crossModuleConsistency.test.ts`: Full end-to-end integration across Steps 12.3, 12.4, and 12.5 (Product Creation -> PO Order -> Partial Goods Receipt -> POS Sale -> Remaining Goods Receipt -> Supplier Payment & Advance -> Second PO -> Advance Allocation -> Ledger Reconciliation).
8. `tests/inventoryPurchasesIsolation.test.ts`: Multi-tenant business boundary enforcement and branch-restricted user scoping.

---

## 5. Build, Lint & Migration Health

- **Worker TypeScript Build**:
  ```powershell
  npm run build:worker
  # Exit code 0, 0 errors
  ```
- **Frontend Production Build**:
  ```powershell
  npm run build
  # Built in 1.02s, 0 errors
  ```
- **Linter**:
  ```powershell
  npm run lint
  # 0 errors, 8 non-blocking warnings in preexisting UI components
  ```
- **Local D1 Database**:
  ```powershell
  npm run db:status:local
  # No migrations to apply! (All 10 applied, 0 pending)
  ```

