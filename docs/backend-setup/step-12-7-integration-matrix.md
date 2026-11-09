# Step 12.7 Frontend Integration Matrix

This document provides the exhaustive audit and integration status between the React frontend modules and the Cloudflare Worker API endpoints (backed by D1 and R2), establishing the single source of truth for business data across the POS application.

---

## 1. Executive Summary & Integration Strategy

### Single Source of Truth
All transactional, catalog, financial, and inventory data originate from and persist to the Cloudflare Worker API (`/api/v1/*`). The browser's memory and storage are treated purely as cache/view layers.

### Gated Demo Fallback Policy
- Demo / mock fallback is strictly gated by `VITE_DATA_SOURCE=mock`.
- In live mode (default), all API calls require authenticated session cookies (`credentials: "include"`) and header context (`X-Business-Id`, `X-Branch-Id`).
- Network or server errors in live mode **must never silently degrade** into local fake storage or mock state. Errors must bubble directly to the user interface with actionable feedback.

### Monetary & Unit Precision Boundary
- **Backend / Database**: All currency values are stored as 64-bit integer minor units (paise, 1 PKR = 100 paise).
- **Frontend Layer**: Displayed and input as decimal PKR.
- **Conversion Contract**:
  - Request serialization: `Math.round(amountPkr * 100)`
  - Response deserialization: `amountMinor / 100`

---

## 2. Comprehensive Endpoint & Feature Integration Matrix

| Frontend Module / Feature | Component / Service | Required Backend Endpoint | Method | Request DTO / Precision | Response DTO | Required Permission | Integration Status | Notes / Edge Cases |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Authentication** | `AuthContext.tsx`, `LoginPage.tsx` | `/api/v1/auth/sign-in` | `POST` | `{ email, password }` | `{ user, businesses }` | Public | **COMPLETE** | Sets HTTP-only session cookie |
| **Authentication** | `AuthContext.tsx` | `/api/v1/auth/me` | `GET` | None | `{ user, businesses, activeBusiness, activeBranch }` | Authenticated | **COMPLETE** | Hydrates session & memberships |
| **Authentication** | `AuthContext.tsx` | `/api/v1/auth/sign-out` | `POST` | None | `{ success: true }` | Authenticated | **COMPLETE** | Clears session cookie & Query cache |
| **Branch Context** | `Header.tsx`, `AuthContext.tsx` | `/api/v1/branches` | `GET` | None | `BranchInfo[]` | Authenticated | **COMPLETE** | Active branch selection |
| **Products Catalog** | `productService.ts`, `ProductsPage.tsx` | `/api/v1/products` | `GET` | Query params: `search`, `categoryId`, `status`, `page`, `limit` | `ProductDTO[]` | `inventory_view` | **COMPLETE** | Branch stock quantity attached |
| **Products Catalog** | `productService.ts`, `ProductFormModal.tsx` | `/api/v1/products` | `POST` | `CreateProductInput` (minor units) | `ProductDTO` | `inventory_manage` | **COMPLETE** | Validates unique SKU/barcode |
| **Products Catalog** | `productService.ts`, `ProductFormModal.tsx` | `/api/v1/products/:id` | `PUT` | `UpdateProductInput` (minor units) | `ProductDTO` | `inventory_manage` | **COMPLETE** | Atomically updates catalog metadata |
| **Products Catalog** | `productService.ts` | `/api/v1/products/:id/archive` | `PATCH` | None | `ProductDTO` | `inventory_manage` | **COMPLETE** | Preserves historical ledger references |
| **Products Catalog** | `productService.ts` | `/api/v1/products/:id/restore` | `PATCH` | None | `ProductDTO` | `inventory_manage` | **COMPLETE** | Restores product status to active |
| **Categories** | `categoryService.ts`, `CategoriesPage.tsx` | `/api/v1/categories` | `GET` | None | `CategoryWithStatsDTO[]` | `inventory_view` | **COMPLETE** | Real-time product counts & branch stock |
| **Categories** | `categoryService.ts`, `CategoryFormModal.tsx` | `/api/v1/categories` | `POST` | `CreateCategoryInput` | `CategoryWithStatsDTO` | `inventory_manage` | **COMPLETE** | Validates unique name/slug |
| **Categories** | `categoryService.ts`, `CategoryFormModal.tsx` | `/api/v1/categories/:id` | `PUT` | `UpdateCategoryInput` | `CategoryWithStatsDTO` | `inventory_manage` | **COMPLETE** | Updates category attributes |
| **Categories** | `categoryService.ts` | `/api/v1/categories/:id/archive` | `PATCH` | None | `CategoryWithStatsDTO` | `inventory_manage` | **COMPLETE** | Soft archives category |
| **Categories** | `categoryService.ts` | `/api/v1/categories/:id/restore` | `PATCH` | None | `CategoryWithStatsDTO` | `inventory_manage` | **COMPLETE** | Restores category to active |
| **POS Checkout** | `checkoutService.ts`, `PosPage.tsx` | `/api/v1/sales` | `POST` | `CreateSaleInput` with header `Idempotency-Key` (UUID) | `SaleDTO` (minor units) | `pos_sale` | **READY** | Prevents double clicks; preserves cart on failure; clears cart only on 201 |
| **Sales Listing** | `salesService.ts`, `SalesPage.tsx` | `/api/v1/sales` | `GET` | Query params: `page`, `limit`, `status`, `startDate`, `endDate`, `customerId` | `SaleListResult` | `sales_view` | **READY** | Scoped to authorized branches |
| **Sale Details** | `salesService.ts`, `SaleDetailsPage.tsx` | `/api/v1/sales/:id` | `GET` | Route param `:id` | `SaleDTO` | `sales_view` | **READY** | Immutable snapshot of completed sale |
| **Sale Void** | `salesService.ts`, `SaleDetailsPage.tsx` | `/api/v1/sales/:id/void` | `POST` | None | `SaleDTO` | `sales_void` | **READY** | Reverses inventory & customer balance |
| **Invoices Listing** | `invoiceService.ts`, `InvoicesPage.tsx` | `/api/v1/invoices` | `GET` | Query params: `page`, `limit`, `paymentStatus`, `startDate`, `endDate` | `InvoiceListResult` | `sales_view` | **READY** | Projection of completed sales |
| **Invoice Details** | `invoiceService.ts`, `InvoiceDetailsPage.tsx` | `/api/v1/invoices/:id` | `GET` | Route param `:id` | `InvoiceDTO` | `sales_view` | **READY** | Formatted invoice document |
| **Customer Payments** | `customerPaymentService.ts`, `PaymentsPage.tsx` | `/api/v1/customer-payments` | `GET` | Query params: `page`, `limit`, `customerId` | `CustomerPaymentListResult` | `payments_view` | **READY** | Includes unallocated and allocated amounts |
| **Receive Payment** | `customerPaymentService.ts`, `ReceivePaymentPage.tsx` | `/api/v1/customer-payments` | `POST` | `CreateCustomerPaymentInput` (minor units) | `CustomerPaymentDTO` | `payments_record` | **READY** | Supports partial/full invoice allocations |
| **Customer Ledger** | `CustomerAccountPage.tsx`, `customerLedgerService.ts` | `/api/v1/customers/:id/ledger` | `GET` | Query params: `startDate`, `endDate`, `limit`, `offset` | `CustomerLedgerResult` | `customers_view` | **READY** | Running balance & transaction history |
| **Customer Ledger Summary** | `CustomerAccountPage.tsx` | `/api/v1/customers/:id/ledger/summary` | `GET` | Route param `:id` | `CustomerLedgerSummaryDTO` | `customers_view` | **READY** | Total invoiced, paid, outstanding balance |
| **Customer CRUD** | `customerService.ts`, `CustomersPage.tsx`, `AddCustomerPage.tsx` | `/api/v1/customers` | `GET`, `POST`, `PUT` | N/A | N/A | `customers_manage` | **PARTIAL / BLOCKED** | Worker currently implements Customer Ledger, but general Customer CRUD endpoints do not exist in D1 yet. Preserves UI using mock customer directory while wiring Ledger to live backend. |
| **Inventory Balances** | `inventoryService.ts`, `InventoryPage.tsx` | `/api/v1/inventory/balances` | `GET` | Query params: `branchId`, `productId` | `InventoryBalanceDTO[]` | `inventory_view` | **READY** | Real-time stock levels per branch |
| **Inventory Movements** | `inventoryService.ts`, `InventoryMovementsPage.tsx` | `/api/v1/inventory/movements` | `GET` | Query params: `branchId`, `productId`, `type`, `limit`, `offset` | `InventoryMovementResult` | `inventory_view` | **READY** | Complete audit trail of stock adjustments |
| **Stock Adjustments** | `inventoryService.ts`, `AdjustStockModal.tsx` | `/api/v1/inventory/adjustments` | `POST` | `StockAdjustmentInput` | `StockAdjustmentDTO` | `inventory_manage` | **READY** | Atomic stock increment/decrement |
| **Stock Counts** | `inventoryService.ts`, `StockCountPage.tsx` | `/api/v1/inventory/counts` | `GET`, `POST` | `StockCountInput` | `StockCountDTO` | `inventory_manage` | **READY** | Stocktaking and variance reconciliation |
| **Stock Count Complete** | `inventoryService.ts`, `StockCountPage.tsx` | `/api/v1/inventory/counts/:id/complete` | `POST` | None | `StockCountDTO` | `inventory_manage` | **READY** | Posts adjustments for discrepancies |
| **Purchases Listing** | `purchaseService.ts`, `PurchasesPage.tsx` | `/api/v1/purchases` | `GET` | Query params: `page`, `limit`, `status`, `supplierId` | `PurchaseListResult` | `purchases_view` | **READY** | Purchase orders and statuses |
| **Create Purchase** | `purchaseService.ts`, `AddPurchasePage.tsx` | `/api/v1/purchases` | `POST` | `CreatePurchaseInput` (minor units) | `PurchaseDTO` | `purchases_create` | **READY** | Creates PO draft |
| **Confirm Purchase** | `purchaseService.ts`, `PurchaseDetailsPage.tsx` | `/api/v1/purchases/:id/confirm` | `POST` | None | `PurchaseDTO` | `purchases_confirm` | **READY** | Locks PO terms |
| **Cancel Purchase** | `purchaseService.ts`, `PurchaseDetailsPage.tsx` | `/api/v1/purchases/:id/cancel` | `POST` | None | `PurchaseDTO` | `purchases_cancel` | **READY** | Cancels unreceived PO |
| **Goods Receipts** | `purchaseService.ts`, `GoodsReceiptsPage.tsx` | `/api/v1/goods-receipts` | `GET` | Query params: `page`, `limit`, `purchaseId` | `GoodsReceiptListResult` | `purchases_view` | **READY** | Shows received inventory items |
| **Receive Goods** | `purchaseService.ts`, `ReceiveGoodsModal.tsx` | `/api/v1/purchases/:id/receipts` | `POST` | `CreateGoodsReceiptInput` | `GoodsReceiptDTO` | `inventory_receive` | **READY** | Updates inventory balance & supplier liability |
| **Suppliers Lookup** | `supplierService.ts`, `SuppliersPage.tsx` | `/api/v1/suppliers` | `GET` | Query params: `search`, `status` | `SupplierDTO[]` | `suppliers_view` | **READY** | Read-only supplier list from D1 |
| **Supplier Payments** | `supplierPaymentService.ts`, `SupplierPaymentsPage.tsx` | `/api/v1/supplier-payments` | `GET` | Query params: `page`, `limit`, `supplierId` | `SupplierPaymentListResult` | `payments_view` | **READY** | Records payments to suppliers |
| **Record Supplier Payment** | `supplierPaymentService.ts`, `AddSupplierPaymentPage.tsx` | `/api/v1/supplier-payments` | `POST` | `CreateSupplierPaymentInput` (minor units) | `SupplierPaymentDTO` | `payments_record` | **READY** | Decreases supplier liability |
| **Supplier Ledger** | `SupplierAccountPage.tsx`, `supplierLedgerService.ts` | `/api/v1/suppliers/:id/ledger` | `GET` | Query params: `startDate`, `endDate`, `limit`, `offset` | `SupplierLedgerResult` | `suppliers_view` | **READY** | Running supplier balance & transactions |
| **Supplier Ledger Summary** | `SupplierAccountPage.tsx` | `/api/v1/suppliers/:id/ledger/summary` | `GET` | Route param `:id` | `SupplierLedgerSummaryDTO` | `suppliers_view` | **READY** | Total billed, total paid, net balance |
| **Dashboard Reports** | `DashboardPage.tsx`, `reportsService.ts` | `/api/v1/reports/dashboard` | `GET` | None | `DashboardReportDTO` | `reports_view` | **READY** | High-level KPI metrics & trends |
| **Sales Reports** | `ReportsPage.tsx`, `reportsService.ts` | `/api/v1/reports/sales/summary` | `GET` | Query params: `startDate`, `endDate`, `branchId` | `SalesSummaryReportDTO` | `reports_view` | **READY** | Aggregated sales metrics |
| **Sales Trends** | `ReportsPage.tsx`, `reportsService.ts` | `/api/v1/reports/sales/trends` | `GET` | Query params: `interval`, `startDate`, `endDate` | `SalesTrendsReportDTO` | `reports_view` | **READY** | Periodic trend charts |
| **Inventory Valuation** | `ReportsPage.tsx`, `reportsService.ts` | `/api/v1/reports/inventory/valuation` | `GET` | Query params: `branchId` | `InventoryValuationDTO` | `reports_view` | **READY** | Total retail and cost valuation |
| **Customer Balances Report** | `ReportsPage.tsx`, `reportsService.ts` | `/api/v1/reports/customers/balances` | `GET` | None | `CustomerBalancesReportDTO` | `reports_view` | **READY** | Outstanding customer receivables |
| **Supplier Balances Report** | `ReportsPage.tsx`, `reportsService.ts` | `/api/v1/reports/suppliers/balances` | `GET` | None | `SupplierBalancesReportDTO` | `reports_view` | **READY** | Outstanding supplier payables |
| **Report CSV Export** | `ReportsPage.tsx`, `reportsService.ts` | `/api/v1/reports/export/csv` | `GET` | Query params: `type`, `startDate`, `endDate`, `branchId` | CSV File stream (`text/csv`) | `reports_view` | **READY** | Sanitized CSV export with formula escaping |
| **Expenses & Net Profit** | `ExpensesPage.tsx`, `DashboardPage.tsx` | N/A | N/A | N/A | N/A | `reports_view` | **BLOCKED** | Worker/D1 has no expenses schema yet. UI shows explicit "Unavailable" / placeholder notice. |
| **File Storage (Upload)** | `fileService.ts`, `ProductFormModal.tsx` | `/api/v1/files` | `POST` | `multipart/form-data` | `FileMetadataDTO` | `inventory_manage` | **READY** | Validates magic bytes, size limits (R2) |
| **File Storage (Content)** | `fileService.ts`, Product cards | `/api/v1/files/:id/content` | `GET` | Route param `:id` | Binary image stream | Authenticated | **READY** | Secure private R2 file retrieval |
| **File Storage (Delete)** | `fileService.ts` | `/api/v1/files/:id` | `DELETE` | Route param `:id` | `{ success: true }` | `inventory_manage` | **READY** | Deletes from R2 and removes D1 record |

---

## 3. Explicit Gap Analysis & Architectural Decisions

1. **Customer CRUD Gap**:
   - Backend currently has `/api/v1/customers/:id/ledger` and `/api/v1/customers/:id/ledger/summary`.
   - General customer CRUD (`GET /api/v1/customers`, `POST /api/v1/customers`) is not in the D1 API routes yet.
   - **Resolution**: Marked as `PARTIAL / BLOCKED`. The frontend will continue to use the customer directory for POS checkout selection, while customer ledger and account summary are directly wired to the live Worker API.
2. **Expenses & Net Profit Gap**:
   - No expense ledger or recording tables exist in D1 migrations 0001–0011.
   - **Resolution**: Marked as `BLOCKED`. Dashboard and Reports UI display clear, explicit badges ("Expenses module unavailable in current API version") instead of fabricated numbers.
3. **TanStack Query Tenant Cache Safety**:
   - Query keys are scoped by `[entity, businessId, branchId, filters]`.
   - On business switch, branch switch, or logout in `AuthContext`, the TanStack Query cache is purged/invalidated immediately to prevent any cross-tenant data leakage.

