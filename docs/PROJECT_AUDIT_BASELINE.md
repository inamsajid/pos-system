# Northstar POS — Project Audit Baseline & True State Register

**Date of Audit:** 2026-11-16  
**Auditor:** Principal Software Architect & QA Lead  
**Repository:** `c:\projects\pos-system`  
**Current Git Branch:** `main`  

---

## 1. Actual Project Architecture

### 1.1 Frontend Client
- **Framework & Core**: React 19 (`19.3.1`) + TypeScript (`7.0.2`).
- **Bundler & Tooling**: Vite 8 (`8.3.6`) with `@tailwindcss/vite` and dynamic `guardedLazy` route-level code splitting. All page chunks compile to under 50kB minified/gzipped.
- **Styling**: Tailwind CSS v4 (`4.3.5`) utilizing CSS variables, responsive drawer overlays, and custom utility classes.
- **Icons**: Lucide React (`1.70.0`).
- **Routing**: React Router DOM v7 (`7.18.5`) configured with `PermissionGuard` route protection.
- **Client Cache & Async State**: TanStack Query v5 (`5.107.1`) with tenant-scoped query keys `[businessId, branchId, ...]`.
- **Client Offline Storage**: Dexie.js v4/v5 (IndexedDB wrapper) with schema version 5 managing:
  - `products`, `categories`, `customers`, `offlineAuthorizations`, `offlineAllocations`, `offlineSales`, `outboxCommands`, `syncChangeLog`, `metadata`.
- **PWA & Service Worker**: `public/sw.js` precaching app shell and dynamic production chunks loaded from `dist/asset-manifest.json` generated at build time via `pwaAssetManifestPlugin`.

### 1.2 Backend Edge Architecture
- **Runtime**: Cloudflare Workers (V8 serverless isolate) utilizing Web Standard Request/Response and Web Crypto APIs.
- **Database**: Cloudflare D1 (Serverless Distributed SQLite) with 21 forward-only migration scripts.
- **Object Storage**: Cloudflare R2 (`FILES` bucket binding) for category images, product photos, and expense receipt uploads.
- **Security & RBAC**: In-memory token SHA-256 hashing in D1 (`sessions.token_hash`), Web Crypto HMAC-SHA256 signatures for offline authorization grants, and granular least-privilege middleware (`requirePermission`, `requireAnyPermission`).

---

## 2. Actual Frontend Features

The frontend application in `src/features/` contains 19 active functional modules:

1. **`auth/`**: Login, multi-tenant registration, staff invitation acceptance (`AcceptInvitationPage.tsx`), and `AuthContext` with session persistence and shared-terminal cleanup.
2. **`categories/`**: Hierarchy-aware category listing, creation modal, editing, status toggling, and image uploads.
3. **`customers/`**: Customer directory, individual and corporate profiles, credit limits, account status, and transaction history.
4. **`dashboard/`**: Real-time sales analytics, Gross Sales, Net Sales, Gross Profit, Total Posted Expenses, Net Profit cards, and sales trend charts.
5. **`expenses/`**: Business expense records, category categorization, R2 receipt attachment viewing via authenticated blob URLs, and expense creation modal.
6. **`files/`**: Cloudflare R2 file service providing authenticated blob previews (`getAuthenticatedBlobUrl`) and streaming endpoints.
7. **`inventory/`**: Multi-branch stock visibility, real-time stock balance tables, stock movement journals, and physical stock count workflows (`StockCountPage.tsx`).
8. **`invoices/`**: Sales invoices listing, invoice detail view, print view, and payment statuses (`Paid`, `Partial`, `Unpaid`, `Voided`).
9. **`ledger/`**: Unified financial subledger hub with tabs for Customer Receivables and Supplier Payables.
10. **`payments/`**: Customer payments, payment details, and `ReceivePaymentPage.tsx` with canonical `inv_*` invoice-level allocations.
11. **`pos/`**: Real-time barcode scanning, item search, quantity toggling, line/cart discounts, tax settings, server-authoritative price overrides, cash/credit checkout, offline cash mode, and 6-state Outbox drawer.
12. **`products/`**: Catalog management, SKU barcode generation, unit pricing, purchase price, inventory tracking flags, and category assignment.
13. **`purchases/`**: Purchase Order (PO) creation, PO status tracking (`draft`, `ordered`, `partial`, `received`, `cancelled`), and Goods Receipt Notes (GRN) via `GoodsReceiptPage.tsx`.
14. **`reports/`**: Sales summary, sales by category, payment method breakdown, tax liabilities, inventory valuation, and CSV exports.
15. **`sales/`**: Sales order history, receipt viewer, customer snapshots, and manager-authorized sale voiding with reason capture.
16. **`settings/`**: Store configuration, business metadata, tax rate bps, receipt template, negative stock policy, and max void hours.
17. **`shared/`**: Common UI components (Buttons, Badges, Modals, Tables, Input fields, Toast alerts).
18. **`staff/`**: Staff directory, role assignments (Owner, Admin, Manager, Cashier, Inventory Clerk), branch multi-assignments, invitations, and suspension.
19. **`supplier-payments/`**: Supplier disbursements, multi-tender split disbursements (cash, bank transfer, cheque), and PO allocation.
20. **`suppliers/`**: Supplier directory, contact info, tax registration, and supplier ledger.

---

## 3. Actual Backend Features

The Cloudflare Worker backend in `worker/src/features/` contains 20 modular services, repositories, and route handlers:

1. **`categories/`**: Category CRUD, hierarchical tree traversal, and branch-scoped catalog querying.
2. **`customer-ledger/`**: Customer running balance calculation, debit (invoice) and credit (payment) subledger transactions, and unallocated advance tracking.
3. **`customer-payments/`**: Customer payment recording, multi-method tenders, invoice allocation validation, and advance allocation.
4. **`customers/`**: Customer entity management, credit limits, and balance summaries.
5. **`expenses/`**: Business expense records, category CRUD, expense posting, and void reversals.
6. **`files/`**: Cloudflare R2 file storage, metadata persistence in D1, and authenticated content streaming.
7. **`goods-receipts/`**: Physical goods receipt processing, PO received quantity updates, and branch-isolated Moving Weighted Average (MWA) unit costing.
8. **`inventory/`**: Branch inventory balances, stock movements, adjustment logging, and physical stock count draft/confirmation workflows.
9. **`invoices/`**: Invoice retrieval, balance updates, and payment status synchronization.
10. **`offline/`**: Offline authorization grants, cryptographic HMAC generation/verification, subset cart validation, atomic usage tracking, and offline sale commit.
11. **`products/`**: Product catalog CRUD, barcode lookups, and optimistic concurrency version checking.
12. **`purchases/`**: Purchase Order lifecycle management, status enforcement, and cancellation rules.
13. **`reports/`**: Real-time sales, tax, payment method, inventory valuation, and posted expenses aggregations with formula-neutralized CSV exports.
14. **`sales/`**: Multi-item POS sales order processing, server-authoritative pricing/tax validation, price override RBAC audit logging, inventory decrementing, and sale void reversal.
15. **`settings/`**: Business-level settings (tax rates, receipt styling, void windows, negative stock rules).
16. **`staff/`**: Business membership, role updates, branch assignment validation, invitation issuance, and session revocation upon suspension.
17. **`supplier-ledger/`**: Supplier running balance calculation, bill debits/credits, and unallocated advance tracking.
18. **`supplier-payments/`**: Multi-tender disbursements (`supplier_payment_methods`), PO allocation, and advance creation.
19. **`suppliers/`**: Supplier directory, contact management, and product mappings.
20. **`sync/`**: Multi-device registration, heartbeat tracking, device revocation, and change-log synchronization.

---

## 4. Actual Database Tables & Migrations

### 4.1 Database Migrations
There are **21 forward-only migration scripts** in `worker/migrations/`:
- `0001_businesses_and_branches.sql`
- `0002_catalog.sql`
- `0003_customers_and_suppliers.sql`
- `0004_sales_and_invoices.sql`
- `0005_payments_and_ledgers.sql`
- `0006_purchases_and_goods_receipts.sql`
- `0007_inventory_and_costing.sql`
- `0008_expenses_and_audit_logs.sql`
- `0009_indexes_and_constraints.sql`
- `0010_sessions_and_auth.sql`
- `0011_file_storage.sql`
- `0012_sync_and_devices.sql`
- `0013_offline_pos_and_allocations.sql`
- `0014_expenses_and_staff.sql`
- `0015_rate_limiting.sql`
- `0016_pricing_overrides_and_offline_snapshots.sql`
- `0017_offline_auth_usage_tracking.sql`
- `0018_hash_session_tokens.sql`
- `0019_supplier_payment_methods.sql`
- `0020_payment_void_and_inventory_branch_cost.sql`
- `0021_files_expense_related_type.sql`

*Verification Note*: As of this audit, all 21 migrations have been applied locally to `pos-system-local` (`wrangler d1 migrations apply pos-system-local --local` succeeded with 0 pending migrations).

### 4.2 Actual D1 Database Tables (49 Tables)
1. `api_rate_limits`
2. `audit_logs`
3. `branches`
4. `business_members`
5. `business_settings`
6. `businesses`
7. `categories`
8. `customer_ledger_transactions`
9. `customers`
10. `d1_migrations`
11. `device_registrations` *(Reserved)*
12. `device_stock_allocations`
13. `devices`
14. `expense_categories`
15. `expenses`
16. `files`
17. `goods_receipt_items`
18. `goods_receipts`
19. `idempotency_keys`
20. `inventory_balances`
21. `invoices`
22. `member_branches`
23. `offline_authorizations`
24. `password_reset_tokens` *(Reserved)*
25. `payment_allocations`
26. `payment_methods`
27. `payments`
28. `products`
29. `purchase_items`
30. `purchases`
31. `sale_items`
32. `sale_return_items` *(Reserved)*
33. `sale_returns` *(Reserved)*
34. `sales`
35. `sessions`
36. `sqlite_sequence`
37. `staff_invitations`
38. `stock_adjustments`
39. `stock_count_items`
40. `stock_counts`
41. `stock_movements`
42. `supplier_ledger_transactions`
43. `supplier_payment_allocations`
44. `supplier_payment_methods`
45. `supplier_payments`
46. `supplier_products`
47. `suppliers`
48. `sync_change_log`
49. `users`

---

## 5. Existing Test Results & Verification Baselines

| Test Suite / Tool | Command | Result | Details |
|---|---|---|---|
| **Vitest** | `npx vitest run` | **PASS** | 83 test files, 562 tests, 0 failures, 13.39s execution duration |
| **Client Typecheck** | `npx tsc --noEmit` | **PASS** | 0 errors |
| **Worker Typecheck** | `npm run build:worker` | **PASS** | 0 errors (`tsc -p tsconfig.worker.json --noEmit`) |
| **Vite Production Build** | `npm run build` | **PASS** | 2,784 modules transformed, 0 bundle compilation errors |
| **Linter** | `npm run lint` (`oxlint`) | **PASS** | 0 errors, 39 React memoization/compiler warnings across 445 files |
| **Local D1 Status** | `npm run db:status:local` | **PASS** | Migrations 0001–0021 fully applied, 0 pending migrations |

---

## 6. Discrepancies Between Architecture Claims & Actual Repository State

1. **Route Registrations Count**:
   - *Claim*: "139 protected API routes".
   - *Actual State*: Exactly 141 routes are registered in `worker/src/index.ts`. 140 routes are under `/api/v1/`, and 1 is the root `/` health route. Of the 140 `/api/v1/` routes, 6 are public auth or readiness endpoints (`/health`, `/ready`, `/auth/bootstrap`, `/auth/sign-in`, `/staff/invitations/info`, `/staff/invitations/accept`), leaving 134 strictly authenticated endpoints.
2. **Missing Local Migrations Prior to Execution**:
   - *Claim*: All 21 migrations were applied.
   - *Actual State*: Migrations `0016` through `0021` existed as SQL files on disk but were not applied to the local miniflare SQLite database until `npm run db:migrate:local` was explicitly run during this audit.
3. **Database Tables vs Column Alters**:
   - *Claim*: Separate tables `pricing_overrides`, `offline_pricing_snapshots`, and `offline_auth_usage` were created.
   - *Actual State*: These features were implemented using forward-only `ALTER TABLE` columns on existing tables (`sale_items.original_unit_price_minor`, `offline_authorizations.pricing_snapshot_json`, `offline_authorizations.used_transactions`, `offline_authorizations.used_total_amount_minor`). No standalone tables by those names exist.
4. **General Ledger vs Subledgers**:
   - *Claim*: "Full double-entry accounting".
   - *Actual State*: There is no General Ledger journal or chart of accounts with debits and credits balancing across all financial transactions. Instead, Northstar POS implements **dedicated financial subledgers** for Accounts Receivable (`customer_ledger_transactions`) and Accounts Payable (`supplier_ledger_transactions`) with running debit/credit balances, supported by transaction records in `invoices`, `payments`, `payment_allocations`, `supplier_payments`, `supplier_payment_allocations`, `expenses`, and `audit_logs`.
5. **Documentation Reference**:
   - *Claim*: `docs/ROUTE_AUTH_MATRIX.md` exists.
   - *Actual State*: The file was referenced in historical reports but was never created or committed to disk.

---

## 7. Existing Uncommitted Git Changes

126 files are currently modified and 17 files are untracked in the working directory:
- **Modified files**: API client normalization, header branch switchers, service worker precaching, route authorization guards, financial subledger services, and inventory atomic deduction guards.
- **Untracked files**: Migrations `0016` through `0021`, new integration test files (`tests/financialWorkflowsAndCosting.test.ts`, `tests/rbacAndTenantIsolationMatrix.test.ts`, `tests/inventoryConcurrencyAndSyncIntegrity.test.ts`, etc.), and reports in `docs/`.
- **Integrity**: All working tree changes are intact and verified by the 562-test automated suite.

