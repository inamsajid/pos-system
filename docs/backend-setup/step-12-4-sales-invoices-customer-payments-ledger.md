# Step 12.4: Sales, Invoices, Customer Payments & Customer Ledger API Documentation

## Executive Overview
- **Step**: 12.4 (Sales, Invoices, Customer Payments & Customer Ledger Backend APIs)
- **Status**: Complete & Verified
- **Runtime Target**: Cloudflare Workers + Cloudflare D1 (SQLite) + React/Vite PWA
- **Security Boundary**: Zero-Trust Multi-Tenancy with Server-Derived Business Context and Branch Scoping
- **Financial Correctness**: Integer Minor Currency Units (PKR Paise), Strict Double-Entry Ledger Principles, and Atomic Single-Batch Execution (`db.batch()`)
- **Idempotency Guarantee**: Header `Idempotency-Key` + SHA-256 Canonical Request Hash

---

## 1. Implemented Endpoints & Permissions Matrix

All endpoints require active session authentication via cookie (`__session`) or Bearer token (`Authorization: Bearer <token>`), and resolve tenant context via `X-Business-Id` and `X-Branch-Id`.

| Module | Method | Endpoint | Permission / Role | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Sales** | `GET` | `/api/v1/sales` | `pos_sale` \| `catalog_read` | List sales with branch filtering and pagination |
| **Sales** | `GET` | `/api/v1/sales/:id` | `pos_sale` \| `catalog_read` | Fetch single sale detail with items, customer snapshot, and payments |
| **Sales** | `POST` | `/api/v1/sales` | `pos_sale` | Atomic checkout: creates sale, items, invoice, payments, deductions, ledger |
| **Sales** | `POST` | `/api/v1/sales/:id/void` | `owner`, `admin`, `manager` | Void sale on same business day (BDR-08): reverses stock and ledger |
| **Sales** | `GET` | `/api/v1/sales/:id/invoice` | `pos_sale` \| `catalog_read` | Fetch associated invoice for a sale |
| **Invoices** | `GET` | `/api/v1/invoices` | Authenticated member | List issued invoices with status, branch, customer, and date filters |
| **Invoices** | `GET` | `/api/v1/invoices/:id` | Authenticated member | Fetch invoice details with sale items and payment allocations |
| **Invoices** | `GET` | `/api/v1/invoices/:id/sale` | Authenticated member | Fetch underlying sale record for an invoice |
| **Payments** | `GET` | `/api/v1/customer-payments` | `collect_payments` | List customer payments with method details and unallocated balances |
| **Payments** | `GET` | `/api/v1/payments` | `collect_payments` | Alias route for listing payments |
| **Payments** | `GET` | `/api/v1/customer-payments/:id` | `collect_payments` | Fetch payment detail with method breakdown and invoice allocations |
| **Payments** | `POST` | `/api/v1/customer-payments` | `collect_payments` | Record customer payment, allocate to invoices, credit customer ledger |
| **Payments** | `GET` | `/api/v1/customer-payments/:id/allocations` | `collect_payments` | List allocations made from a specific payment |
| **Payments** | `POST` | `/api/v1/customer-payments/:id/allocations` | `collect_payments` | Allocate advance credit to subsequent open invoice(s) |
| **Ledger** | `GET` | `/api/v1/customers/:customerId/ledger` | Authenticated member | Chronological statement with running balance, opening balance, and filters |
| **Ledger** | `GET` | `/api/v1/customers/:customerId/ledger/summary` | Authenticated member | Overall customer financial profile, credit limit, and aging metrics |

---

## 2. Financial Architecture & Precision

### 2.1 Integer Minor Units (PKR Paise)
All monetary balances, prices, discounts, taxes, and payments are stored and calculated strictly as non-negative integers in minor currency units (paise: 1 PKR = 100 paise):
- `unit_price_minor`
- `unit_cost_minor`
- `line_subtotal_minor`
- `discount_minor`
- `tax_minor`
- `line_total_minor`
- `total_amount_minor`
- `amount_paid_minor`
- `remaining_balance_minor` / `remaining_amount_minor`
- `unallocated_amount_minor`
- `debit_minor` / `credit_minor` / `balance_minor`

Floating-point storage of monetary amounts is strictly prohibited in Cloudflare D1.

### 2.2 UoM Quantity Validation
Quantities are validated according to the product's Unit of Measure (`unit`):
- **Discrete units** (`piece`, `box`, `pack`, `dozen`): strictly positive integers (`Number.isInteger(qty) && qty > 0`). Fractional quantities are rejected with `400 Bad Request`.
- **Continuous units** (`kg`, `liter`, `meter`, `gram`): up to 3 decimal places precision (`Math.round(qty * 1000) === qty * 1000 && qty > 0`).

---

## 3. Transaction Boundaries & Atomic Commit Guarantees

All mutation workflows execute in a single Cloudflare D1 `db.batch(statements)` transaction call.

### 3.1 POS Checkout Transaction (`POST /api/v1/sales`)
When a sale is completed, the following operations are batched and committed atomically:
1. `sales` record insertion with server-computed subtotal, discount, total, paid, and remaining balance.
2. `sale_items` insertion with historical product snapshots (`product_name`, `sku`, `unit_price_minor`, `unit_cost_minor`, `cogs_estimated`).
3. `invoices` record insertion matching the sale 1-to-1 (`paid_amount_minor`, `remaining_amount_minor`, `payment_status`).
4. If payment is made at checkout (`amount_paid_minor > 0`):
   - `payments` record insertion (`source = 'pos_checkout'`).
   - `payment_methods` records for each payment method tendered.
   - `payment_allocations` linking payment to the sale invoice.
5. `stock_movements` insertion (`type = 'sale'`) for each inventory-tracked product.
6. `inventory_balances` decrement (`quantity_on_hand = quantity_on_hand - ?`).
7. `customer_ledger_transactions`:
   - Debit entry for invoice (`debit_minor = totalAmountMinor`, `credit_minor = 0`).
   - If payment tendered, credit entry for payment (`debit_minor = 0`, `credit_minor = amountPaidMinor`).
   - Running `balance_minor` updated.
8. `audit_logs` record created.
9. `idempotency_keys` record inserted.

**Rollback Guarantee**: If any constraint fails (e.g. check constraint, insufficient stock, foreign key failure, or network failure), D1 rolls back the entire batch. No partial sale, orphaned invoice, unlinked payment, or unsynchronized inventory deduction can ever persist.

---

## 4. Idempotency Protection

Mutation operations (`POST /api/v1/sales`, `POST /api/v1/customer-payments`) support distributed idempotency via the `Idempotency-Key` HTTP header.

1. **Request Canonicalization**: Request body keys are sorted deterministically, numbers and strings normalized, and hashed using SHA-256 via Web Crypto (`crypto.subtle.digest('SHA-256', ...)`).
2. **Replay Detection**:
   - If `Idempotency-Key` exists and the request hash matches, the previously committed response is returned directly without re-executing inventory deductions or ledger commits.
   - If `Idempotency-Key` exists but the request hash differs, the server rejects the call with `409 Conflict`.
3. **Rollback Resilience**: The `idempotency_keys` record is inserted inside the same atomic `db.batch()` as the business entities. If the transaction rolls back, the key is not stored, allowing immediate client retry.

---

## 5. Business Rules & Domain Validation

### 5.1 Walk-In Customers
- Walk-in customers (`is_walk_in = 1`) cannot purchase on credit (`remainingBalanceMinor === 0`).
- Walk-in customers cannot carry unallocated advance credit balances (`unallocatedAmountMinor === 0`).
- Any sale with a walk-in customer must be paid in full at the counter.

### 5.2 Customer Credit Limit Check
- For registered account customers, credit purchases are permitted up to the customer's `credit_limit_minor`.
- If `currentDebt + remainingBalance > credit_limit_minor`, the request is rejected with `400 Bad Request` (`VALIDATION_ERROR`).

### 5.3 Negative Stock Rule
- Evaluated against `business_settings.allow_negative_stock`.
- When set to `0`, checkouts that would cause `quantity_on_hand < 0` are rejected with `422 Unprocessable Entity` (`INSUFFICIENT_STOCK`).
- When set to `1`, sales proceed with inventory allowed into negative territory for backorder environments.

### 5.4 Void Policy (BDR-08)
- Completed sales can only be voided on the **same business date** (`sale.business_date_key === currentBusinessDateKey`).
- Voiding requires elevated supervisor roles (`owner`, `admin`, or `manager`). Cashiers alone receive `403 Forbidden`.
- Voiding atomically:
  1. Sets `sales.status = 'voided'`.
  2. Sets `invoices.status = 'voided'`.
  3. Restores stock balances via `adjustment_in` stock movements and balance increments.
  4. Appends contra ledger transactions reversing the invoice debit and payment credit.
  5. Records an audit log entry with the void reason.

---

## 6. Verification and Regression Testing

All 25 test suites across the application pass cleanly:

```bash
Test Files  25 passed (25)
Tests       227 passed (227)
```

### Dedicated Step 12.4 Test Suites
1. [`tests/salesApi.test.ts`](file:///c:/projects/pos-system/tests/salesApi.test.ts): 10 tests verifying cash sales, credit sales, partial payments, walk-in credit rejection, credit limit enforcement, negative stock guard, idempotency replay, idempotency 409 conflict, supervisor voiding, cashier void prohibition, and invoice lookup.
2. [`tests/salesAtomicity.test.ts`](file:///c:/projects/pos-system/tests/salesAtomicity.test.ts): 2 tests verifying full transactional rollback across all 8 entity tables on injected batch failure and safe idempotency retry recovery.
3. [`tests/invoicesApi.test.ts`](file:///c:/projects/pos-system/tests/invoicesApi.test.ts): 6 tests verifying invoice listing, payment status filtering (`paid`, `unpaid`, `partial`), customer filtering, line item and payment allocation expansion, associated sale retrieval, and 404 handling.
4. [`tests/customerPaymentsApi.test.ts`](file:///c:/projects/pos-system/tests/customerPaymentsApi.test.ts): 5 tests verifying manual payment recording with multi-method tenders, invoice allocation, payment methods sum validation, allocation balance cap, advance unallocated deposit, advance allocation to subsequent invoices without duplicate ledger entries, and idempotency protection.
5. [`tests/customerLedgerApi.test.ts`](file:///c:/projects/pos-system/tests/customerLedgerApi.test.ts): 5 tests verifying chronological statement generation, running balance accuracy, date-bounded opening balance calculation, transaction type filtering, customer financial summary metrics (`currentBalanceMinor`, `creditLimitMinor`, `availableCreditMinor`, `openInvoicesCount`), and 404 handling.
6. [`tests/salesTenantIsolation.test.ts`](file:///c:/projects/pos-system/tests/salesTenantIsolation.test.ts): 6 tests verifying strict multi-tenant boundaries between Business 1 and Business 2, and branch-level isolation restricting branch cashiers from seeing sales belonging to other branches.

