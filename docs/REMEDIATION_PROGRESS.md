# Northstar POS — Remediation Progress & Execution Register

**Generated:** 2026-11-11  
**Workspace:** `c:\projects\pos-system`  
**Git Branch / Commit:** `main` (Remediation Complete)  
**Final Checkpoint:** All Phases 0–15 Completed & 100% Verified

---

## 1. Master Findings Resolution Matrix

| Finding ID | Severity | Implementation Files | Defect Description | Remediation Implemented | Automated Test Suite | Completion Status |
|---|---|---|---|---|---|---|
| **FE-001** | P0 | `src/lib/api-client.ts`, services | Base URL duplicated `/api/v1/api/v1/...` in client calls | Normalized path stripping redundant `/api/v1` prefixes | PASS (`tests/frontend/apiUrlNormalization.test.ts`, `tests/apiClient.test.ts`) | **FIXED AND VERIFIED** |
| **FE-010** | P2 | `src/features/reports/services/reportService.ts`, `worker/src/features/reports/` | Export called `/reports/export/csv` instead of `/reports/export?reportType=...` | Standardized query params; CSV formula sanitizer prepends `'` | PASS (`tests/reportsApi.test.ts`, `tests/reportExportCsv.test.ts`) | **FIXED AND VERIFIED** |
| **FIN-001** | P0 | `sales.service.ts`, `sales.validation.ts`, `0016_pricing_overrides_and_offline_snapshots.sql` | Client-trusted prices, tax & discount overrides without RBAC or audit | Server-authoritative catalog pricing, RBAC `price_override` check, audit logging | PASS (`tests/salesApi.test.ts`, `tests/salesPricingAndTaxIntegrity.test.ts`) | **FIXED AND VERIFIED** |
| **INV-001** | P0 | `sales.service.ts`, `offline.service.ts` | First sale on missing balance row created positive stock | `INSERT OR IGNORE` balance initialization with 0.0 before deduction | PASS (`tests/inventoryConcurrencyAndSyncIntegrity.test.ts`) | **FIXED AND VERIFIED** |
| **INV-003** | P0/P1 | `sales.service.ts`, `testD1Helper.ts` | Concurrent checkouts oversold stock due to unguarded UPDATE | Atomic SQL `quantity_on_hand >= ?` constraint check | PASS (`tests/inventoryConcurrencyAndSyncIntegrity.test.ts`) | **FIXED AND VERIFIED** |
| **INV-002** | P0 | `offline.service.ts`, `sync.client.ts` | Change log omitted `quantityOnHand`; peer sync zeroed stock | Emit authoritative `quantityOnHand`; client skips events lacking it | PASS (`tests/inventoryConcurrencyAndSyncIntegrity.test.ts`) | **FIXED AND VERIFIED** |
| **SEC-001** | P0 | `worker/src/index.ts`, `ROUTE_AUTH_MATRIX.md` | 60+ routes lacked `requirePermission(...)` | Audited and enforced explicit `requirePermission` on all 139 Worker routes | PASS (`tests/rbacAndTenantIsolationMatrix.test.ts`) | **FIXED AND VERIFIED** |
| **SEC-004** / **TEN-001/002** | P1 | `staff.service.ts`, `tenantContext.ts` | Cross-tenant branch assignment & empty member_branches leakage | Scoped branch validation to active business; fail-closed authorization | PASS (`tests/rbacAndTenantIsolationMatrix.test.ts`) | **FIXED AND VERIFIED** |
| **OFF-001** | P0 | `src/lib/offline/sessionCleanup.ts`, Dexie v5 | Shared terminal logout failed to clear cached private data | Scoped database purge, transient memory clearing, and pre-logout sync | PASS (`tests/offline/sharedTerminalSecurityAndCrypto.test.tsx`) | **FIXED AND VERIFIED** |
| **OFF-003** / **DEP-002** | P0/P1 | `offline.service.ts`, `offlineCrypto.ts`, `0017_offline_auth_usage_tracking.sql` | Hardcoded offline signing secret & broken subset HMAC | Dynamic HMAC verification with subset cart ordering & usage caps | PASS (`tests/offline/sharedTerminalSecurityAndCrypto.test.tsx`) | **FIXED AND VERIFIED** |
| **OFF-002** / **OFF-004/005** | P0/P1 | `PosPage.tsx`, `outbox.dispatcher.ts`, `outbox.registry.ts` | POS disconnected from offline engine; shallow outbox sort | Unified online/offline POS flow, deterministic dependency FIFO sorting | PASS (`tests/offline/sharedTerminalSecurityAndCrypto.test.tsx`) | **FIXED AND VERIFIED** |
| **FE-002** / **FE-003** / **FE-008** | P1 | `customerService.ts`, `supplierService.ts`, `expenseService.ts`, `staffService.ts` | Silent catch mock fallbacks, static headers, global query keys | Removed mock fallbacks outside explicit demo, scoped TanStack queryKeys | PASS (`tests/frontend/step14LedgerIntegration.test.tsx`, `tests/frontend/fallbackAndSecurityUi.test.tsx`) | **FIXED AND VERIFIED** |
| **SEC-002** | P1 | `worker/src/auth/sessionService.ts`, `0018_hash_session_tokens.sql` | Plaintext session tokens stored in D1 database | Web Crypto SHA-256 session token hashing in D1 with bearer token lookup | PASS (`tests/sessionSecurityAndAuth.test.tsx`) | **FIXED AND VERIFIED** |
| **SEC-003** | P1 | `staff.service.ts`, `sessionService.ts` | Staff suspension did not revoke active user sessions | Added `revokeAllUserSessions` on staff member deactivation and suspension | PASS (`tests/sessionSecurityAndAuth.test.tsx`) | **FIXED AND VERIFIED** |
| **SEC-005** | P2 | `worker/src/router.ts` | `X-Device-Id` omitted from CORS headers | Added `X-Device-Id` to `Access-Control-Allow-Headers` | PASS (`tests/sessionSecurityAndAuth.test.tsx`) | **FIXED AND VERIFIED** |
| **AUTH-001** | P1 | `src/features/auth/pages/AuthPages.tsx` | Fake forgot password success screen | Honest administrative recovery notice explaining self-service status | PASS (`tests/sessionSecurityAndAuth.test.tsx`) | **FIXED AND VERIFIED** |
| **FIN-002** | P1 | `paymentService.ts`, `ReceivePaymentPage.tsx`, `customerPayments.service.ts` | Customer payment sends `sale_*` instead of `inv_*`; duplicate invoice allocation | Keyed allocations by canonical `invoiceId`, rejected duplicate invoice IDs | PASS (`tests/financialWorkflowsAndCosting.test.ts`, `tests/customerPaymentsApi.test.ts`) | **FIXED AND VERIFIED** |
| **FIN-003** | P1 | `supplierPaymentService.ts`, `worker/src/features/supplier-payments/`, `0019_supplier_payment_methods.sql` | Multi-tender disbursements truncate tenders after index 0 | Created `supplier_payment_methods` table; multi-tender breakdown support | PASS (`tests/supplierPaymentsApi.test.ts`, `tests/financialWorkflowsAndCosting.test.ts`) | **FIXED AND VERIFIED** |
| **FIN-004** | P1 | `customerLedgerService.ts`, `supplierLedgerService.ts`, worker subledgers | Advance balances hardcoded to 0; transaction types collapsed | Calculate and return real `unallocatedAdvanceMinor` and preserve all types | PASS (`tests/financialReportsApi.test.ts`, `tests/customerLedgerApi.test.ts`, `tests/supplierLedgerApi.test.ts`) | **FIXED AND VERIFIED** |
| **FIN-005** | P1 | `reports.service.ts`, `reports.repository.ts`, `DashboardPage.tsx` | Hardcodes `expenses.isAvailable = false` & `netProfit` unavailable | Compute posted expenses & real net profit in reports; enable on dashboard | PASS (`tests/reportsApi.test.ts`, `tests/financialReportsApi.test.ts`) | **FIXED AND VERIFIED** |
| **FIN-006** | P1 | `reports.repository.ts`, `goodsReceipts.service.ts` | Unreceived POs counted in supplier payables; draft POs receivable | Recognize liability strictly on goods receipt; reject receipts on draft POs | PASS (`tests/financialReportsApi.test.ts`, `tests/goodsReceiptsApi.test.ts`) | **FIXED AND VERIFIED** |
| **FIN-007** / **FE-009** | P1 | `AddPurchasePage.tsx`, `GoodsReceiptPage.tsx`, `salesService.ts` | Missing `await`, empty receipt on reload, status string loss | Awaited PO confirmation, async GRN load, preserved real status strings | PASS (`tests/purchasesApi.test.ts`, `tests/financialWorkflowsAndCosting.test.ts`) | **FIXED AND VERIFIED** |
| **FIN-008** | P1 | `sales.service.ts`, `0020_payment_void_and_inventory_branch_cost.sql` | Voided sales overcount payments; ignores `max_void_hours` | Forward migration for `payments.status`, void payment reversal, void window | PASS (`tests/financialWorkflowsAndCosting.test.ts`, `tests/salesApi.test.ts`) | **FIXED AND VERIFIED** |
| **FIN-009** / **FE-005** | P1 | `DashboardPage.tsx`, `ReportsPage.tsx`, `AuthContext.tsx` | Mixed demo mock metrics; `AuthContext` dropped `userId` | Connected live Worker `/reports/*`; preserved `userId` atomically in ref | PASS (`tests/reportsApi.test.ts`, `tests/financialReportsApi.test.ts`) | **FIXED AND VERIFIED** |
| **INV-004** | P1 | `inventory_balances` table, `goodsReceipts.service.ts`, `0020_payment_void_and_inventory_branch_cost.sql` | Global purchase price overwritten on receipt; no branch cost | Branch-isolated moving weighted average cost in `ib.average_cost_minor` | PASS (`tests/financialWorkflowsAndCosting.test.ts`, `tests/goodsReceiptsApi.test.ts`) | **FIXED AND VERIFIED** |
| **INV-005** | P1 | `StockCountPage.tsx`, `inventoryService.ts`, `productService.ts` | Stock counts & adjustments localStorage-only | Connected StockCountPage and productService to Worker D1 endpoints | PASS (`tests/inventoryApi.test.ts`, `tests/inventoryService.test.ts`) | **FIXED AND VERIFIED** |
| **FE-007** | P1 | `fileService.ts`, `worker/src/features/files/`, `0021_files_expense_related_type.sql` | `entityType` vs `category`; `related_type` lacks `'expense'` | Migration rebuild of `files` table adding `'expense'`, dual-mapped fields | PASS (`tests/r2FileStorage.test.ts`) | **FIXED AND VERIFIED** |
| **FE-006** | P1 | `src/app/router.tsx`, `AcceptInvitationPage.tsx`, `Header.tsx`, `staff.service.ts` | Missing `/accept-invitation` UI route & branch switcher UI | Added `AcceptInvitationPage`, onboarded invite flow, and Header switcher | PASS (`tests/staffManagementApi.test.ts`) | **FIXED AND VERIFIED** |
| **FE-004** | P1 | `public/sw.js`, `vite.config.ts` | Service Worker omits Vite production bundle precaching | Build-time precache manifest plugin + guaranteed non-undefined SW fallback | PASS (`tests/offline/offlineAcceptance.e2e.test.ts`) | **FIXED AND VERIFIED** |
| **SEC-006..009** / **PERF** | P2 | `worker/src/router.ts`, `src/app/router.tsx` | Missing security headers; heavy monolithic bundles | Added CSP/nosniff/DENY headers; full route-level code splitting via `guardedLazy` | PASS (`npm run build`, `tests/corsAndCsrf.test.ts`) | **FIXED AND VERIFIED** |
| **DB-001..002** | P2 | `products.repository.ts`, reserved tables | Change log emitted before changes check; 4 dead tables | Fixed version conflict check; documented reserved tables safely | PASS (`tests/syncVersionConflict.test.ts`) | **FIXED AND VERIFIED** |
| **QA-001** | P1 | `tests/` | Mocking overreliance, SQLite shim overreliance | Added comprehensive unmocked request-to-D1 integration suites | PASS (`npx vitest run`: 83/83 files, 562/562 tests) | **FIXED AND VERIFIED** |

---

## 2. Test Execution Verification Summary

```text
✓ tests/categoriesApi.test.ts (11 tests)
✓ tests/productsApi.test.ts (12 tests)
✓ tests/salesApi.test.ts (11 tests)
✓ tests/expensesApi.test.ts (10 tests)
✓ tests/step12_8_systemAcceptance.test.ts (10 tests)
✓ tests/staffManagementApi.test.ts (12 tests)
✓ tests/rbacAndTenantIsolationMatrix.test.ts (7 tests)
✓ tests/inventoryConcurrencyAndSyncIntegrity.test.ts (10 tests)
✓ tests/auth.test.ts (16 tests)
✓ tests/catalogPutAndFallbackSafety.test.ts (11 tests)
✓ tests/catalogTenantIsolation.test.ts (8 tests)
✓ tests/r2FileStorage.test.ts (8 tests)
✓ tests/branchStockVisibility.test.ts (8 tests)
✓ tests/customersApi.test.ts (7 tests)
✓ tests/tenantIsolation.test.ts (8 tests)
✓ tests/salesTenantIsolation.test.ts (6 tests)
✓ tests/reportsApi.test.ts (7 tests)
✓ tests/offline/offlineReconnectionAndRecovery.test.ts (6 tests)
✓ tests/salesPricingAndTaxIntegrity.test.ts (6 tests)
✓ tests/invoicesApi.test.ts (6 tests)
✓ tests/inventoryApi.test.ts (6 tests)
✓ tests/offline/offlineAcceptance.e2e.test.ts (28 tests)
✓ tests/goodsReceiptsApi.test.ts (5 tests)
✓ tests/d1Database.test.ts (7 tests)
✓ tests/offline/offlineStockAllocation.test.ts (6 tests)
✓ tests/syncDeviceRegistration.test.ts (5 tests)
✓ tests/suppliersApi.test.ts (5 tests)
✓ tests/supplierPaymentsApi.test.ts (5 tests)
✓ tests/offline/offlineSaleServerCommit.test.ts (5 tests)
✓ tests/purchasesApi.test.ts (5 tests)
✓ tests/customerPaymentsApi.test.ts (5 tests)
✓ tests/customerLedgerApi.test.ts (5 tests)
✓ tests/supplierLedgerApi.test.ts (5 tests)
✓ tests/sessionSecurityAndAuth.test.tsx (6 tests)
✓ tests/offline/offlinePosAuthorization.test.ts (4 tests)
✓ tests/syncPullApi.test.ts (4 tests)
✓ tests/reportExportCsv.test.ts (4 tests)
✓ tests/offline/sharedTerminalSecurityAndCrypto.test.tsx (5 tests)
✓ tests/inventoryReportsApi.test.ts (4 tests)
✓ tests/customerAndSupplierLedgerUi.test.ts (3 tests)
✓ tests/frontend/fallbackAndSecurityUi.test.tsx (7 tests)
✓ tests/financialReportsApi.test.ts (3 tests)
✓ tests/frontend/step14StaffIntegration.test.tsx (3 tests)
✓ tests/syncChangeLog.test.ts (3 tests)
✓ tests/frontend/step14ExpenseIntegration.test.tsx (2 tests)
✓ tests/settingsApi.test.ts (3 tests)
✓ tests/rateLimiter.test.ts (3 tests)
✓ tests/inventoryPurchasesIsolation.test.ts (3 tests)
✓ tests/offline/outboxConcurrency.test.ts (6 tests)
✓ tests/step14_integration.test.ts (2 tests)
✓ tests/syncVersionConflict.test.ts (2 tests)
✓ tests/salesAtomicity.test.ts (2 tests)
✓ tests/syncMultiDevice.test.ts (1 test)
✓ tests/suppliersLookupApi.test.ts (2 tests)
✓ tests/offlineCatalog.test.ts (11 tests)
✓ tests/crossModuleConsistency.test.ts (1 test)
✓ tests/offlineDatabase.test.ts (10 tests)
✓ tests/offline/outboxRetry.test.ts (8 tests)
✓ tests/offline/outboxLifecycle.test.ts (5 tests)
✓ tests/corsAndCsrf.test.ts (10 tests)
✓ tests/offline/outboxSecurity.test.ts (6 tests)
✓ tests/offline/offlineCheckoutFlow.test.ts (5 tests)
✓ tests/offline/outboxDatabase.test.ts (7 tests)
✓ tests/frontendExpenses.test.tsx (6 tests)
✓ tests/frontendLedgers.test.tsx (9 tests)
✓ tests/offlineOutbox.test.ts (3 tests)
✓ tests/financialWorkflowsAndCosting.test.ts (4 tests)
✓ tests/frontend/step14LedgerIntegration.test.tsx (2 tests)
✓ tests/apiClient.test.ts (4 tests)
✓ tests/domainCalculations.test.ts (22 tests)
✓ tests/frontendAuth.test.tsx (6 tests)
✓ tests/worker.test.ts (7 tests)
✓ tests/businessDate.test.ts (22 tests)
✓ tests/inventoryService.test.ts (15 tests)
✓ tests/apiContracts.test.ts (9 tests)
✓ tests/r2Storage.test.ts (2 tests)
✓ tests/dateFiltersIntegration.test.ts (9 tests)
✓ tests/frontend/step14PermissionNavigation.test.tsx (5 tests)
✓ tests/frontend/settingsIntegration.test.tsx (2 tests)
✓ tests/frontendCatalogIntegration.test.tsx (6 tests)
✓ tests/frontend/step14Navigation.test.tsx (2 tests)
✓ tests/frontend/apiUrlNormalization.test.ts (6 tests)
✓ tests/frontendIntegration12_7.test.tsx (14 tests)

Test Files  83 passed (83)
     Tests  562 passed (562)
```
