# Step 12.8 Financial and Inventory Data-Integrity Audit

This document records the empirical results of the data-integrity, invariant enforcement, and relational consistency audit performed on the Northstar POS database and business calculation engines.

---

## 1. Inventory Invariants Audit

| Invariant ID | Rule Specification | Verification Method & Test Reference | Result | Notes & Audit Evidence |
| :--- | :--- | :--- | :--- | :--- |
| **INV-INV-01** | Inventory balance strictly equals cumulative net stock movements from opening balance | Direct SQL reconciliation: `tests/crossModuleConsistency.test.ts` | **PASS** | $\text{balance} = \sum (\text{quantity\_change})$. Zero discrepancy across all test branches. |
| **INV-INV-02** | Purchase orders (Draft & Confirmed) have ZERO effect on physical stock | `tests/step12_8_systemAcceptance.test.ts: 3.3 Purchase PO Confirmation` | **PASS** | `quantity_on_hand` remains 0 upon PO creation and PO confirmation. Stock mutations occur strictly upon Goods Receipt. |
| **INV-INV-03** | Goods receipt increases inventory strictly by verified received quantities | `tests/step12_8_systemAcceptance.test.ts: 3.3 Partial Receipts` | **PASS** | Partial receipt of 4 units on a 10-unit PO increases stock by exactly 4.0. Over-receiving is rejected with HTTP 400. |
| **INV-INV-04** | Completed POS sale deducts inventory exactly once | `tests/step12_8_systemAcceptance.test.ts: 3.5 POS Sale` | **PASS** | 2 units sold deducts balance from 20 to 18. Duplicate submission with identical idempotency key returns identical sale with ZERO additional stock deduction. |
| **INV-INV-05** | Manual stock adjustments create immutable audit movements | `tests/step12_8_systemAcceptance.test.ts: 3.7 Adjustment` | **PASS** | Adjustment of +5.0 found units increments balance from 30 to 35 and writes `type: 'adjustment_in'` movement. |
| **INV-INV-06** | Finalized stock count posts variance delta exactly once | `tests/step12_8_systemAcceptance.test.ts: 3.7 Stock Count` | **PASS** | Physical count of 32 reconciled from 35 posts variance of -3.0. Re-running finalization is rejected with HTTP 400 (`Count already finalized`). |
| **INV-INV-07** | Transaction rollback atomicity | `tests/salesAtomicity.test.ts: guarantees complete zero partial state rollback` | **PASS** | If any statement in `d1.batch()` encounters an error, the entire transaction is rolled back (`ROLLBACK;`). Zero partial balance or movement writes occur. |

---

## 2. Financial Invariants Audit

| Invariant ID | Rule Specification | Verification Method & Test Reference | Result | Notes & Audit Evidence |
| :--- | :--- | :--- | :--- | :--- |
| **FIN-INV-01** | Integer paise representation (Zero floating point currency) | Schema analysis across migrations 0001–0011 & `tests/d1Database.test.ts` | **PASS** | All monetary columns (`subtotal_minor`, `total_amount_minor`, `amount_paid_minor`, `balance_minor`, `unit_cost_minor`) are declared `INTEGER NOT NULL`. |
| **FIN-INV-02** | Sale header total strictly equals sum of sale line-item snapshots | `tests/salesApi.test.ts` & `tests/domainCalculations.test.ts` | **PASS** | Sale line snapshot preserves historical purchase cost and selling price. |
| **FIN-INV-03** | Invoices and payments do not inflate sales revenue | `tests/step12_8_systemAcceptance.test.ts: 3.8 Reports Financial Invariants` | **PASS** | Revenue queries aggregate exclusively from completed `sales.total_amount_minor`. Payments and invoices do not participate in revenue summation. |
| **FIN-INV-04** | Payment allocations never exceed payment amount or invoice balance | `tests/customerPaymentsApi.test.ts` & `tests/supplierPaymentsApi.test.ts` | **PASS** | Over-allocation requests are rejected with HTTP 400. Unallocated portions are preserved as customer or supplier advance. |
| **FIN-INV-05** | Advance allocation creates zero secondary payments | `tests/customerPaymentsApi.test.ts: advance allocations` | **PASS** | Allocating an existing advance payment updates `payment_allocations` and reduces `unallocated_amount_minor` without generating new cash receipts. |
| **FIN-INV-06** | Customer subledger running balance agrees with source transactions | `tests/customerLedgerApi.test.ts` & `tests/step12_8_systemAcceptance.test.ts: 3.6 Customer Ledger` | **PASS** | Chronological ordering by `rowid ASC` ensures double-entry parity: $\text{Current Balance} = \text{Opening} + \sum \text{Debits} - \sum \text{Credits}$. |
| **FIN-INV-07** | Supplier subledger running balance agrees with goods receipts and payments | `tests/step12_8_systemAcceptance.test.ts: 3.4 Supplier Ledger` | **PASS** | Invariant holds: $\text{Current Payable} = \text{Opening Payable} + \text{Total Billed} - \text{Total Paid}$. |

---

## 3. Multi-Tenant and Branch Isolation Audit

| Invariant ID | Rule Specification | Verification Method & Test Reference | Result | Notes & Audit Evidence |
| :--- | :--- | :--- | :--- | :--- |
| **TEN-INV-01** | Cross-business data segregation | `tests/tenantIsolation.test.ts` & `tests/catalogTenantIsolation.test.ts` | **PASS** | Every query scopes by `business_id = ctx.tenant.business.id`. Injections of foreign `business_id` in headers or routes return HTTP 403 or 404. |
| **TEN-INV-02** | Branch authorization boundaries | `tests/branchStockVisibility.test.ts` | **PASS** | Cashier assigned to Branch A cannot access Branch B sales, stock, or cash receipts. Manager / Owner can access all authorized branches within their business. |
| **TEN-INV-03** | R2 Private Storage multi-tenant scoping | `tests/step12_8_systemAcceptance.test.ts: 3.9 R2 Cross-Tenant Isolation` | **PASS** | R2 object keys are prefixed by `businesses/${businessId}/...`. Foreign business session attempting file download receives HTTP 404. |
| **TEN-INV-04** | Client cache tenant safety | `tests/frontendIntegration12_7.test.tsx: cache clearing` | **PASS** | TanStack Query cache is purged immediately on `switchBusiness`, `switchBranch`, and `signOut` in `AuthContext.tsx`. |

---

## 4. SQLite Engine Structural Integrity Checks

The local database engine was audited using standard SQLite pragma inspection and relational constraint checks:

```sql
PRAGMA foreign_key_check;
-- Result: 0 violations across all 40 tables

PRAGMA integrity_check;
-- Result: ok
```

### Table Column Constraints & Nullability
- **Primary Keys**: Every table defines a `TEXT PRIMARY KEY` (UUID/nanoid string).
- **Foreign Keys**: All business-scoped tables reference `businesses(id) ON DELETE CASCADE`.
- **Status Enumerations**: Enforced via `CHECK(status IN (...))` constraints on `businesses`, `branches`, `users`, `products`, `categories`, `customers`, `suppliers`, `sales`, `invoices`, `purchases`, `stock_counts`, and `files`.
- **Monetary Non-Negativity**: Enforced via `CHECK(amount_minor >= 0)` or `CHECK(amount_minor > 0)` on payment and line-item tables.

---

## 5. Audit Conclusion
All inventory, financial, and multi-tenant invariants passed automated and structural inspection. No IEEE 754 floating-point monetary drift or orphaned foreign keys exist in the schema.

