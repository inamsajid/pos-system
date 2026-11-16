# Northstar POS — Complete API Route Authorization Matrix

**Generated On:** 2026-11-16  
**Total Route Registrations:** 141 (1 root health check + 140 API routes)  
- **Public / Unauthenticated / Onboarding Routes:** 8  
- **Authenticated Endpoints (`requireAuth`):** 133  
- **Enforcing Tenant Business Context (`requireBusinessContext`):** 131  
- **Enforcing Branch Scoping (`resolveBranchContext` / `resolveAuthorizedBranchIds`):** 87  
- **Enforcing Granular RBAC Permissions (`requirePermission`):** 130  

| # | Method | Path | Handler | Auth Required | Permission Required | Tenant Scoped | Branch Scoped | Module Source File |
|---|---|---|---|---|---|---|---|---|
| 0 | `GET` | `/` | `inline` | Public | Public / Unauthenticated | None / Public | No | `worker/src/index.ts` |
| 1 | `GET` | `/api/v1/health` | `handleHealth` | Public | Public / Unauthenticated | None / Public | No | `./routes/health.routes` |
| 2 | `GET` | `/api/v1/ready` | `handleReadiness` | Public | Public / Unauthenticated | None / Public | No | `./routes/health.routes` |
| 3 | `POST` | `/api/v1/auth/bootstrap` | `handleBootstrap` | Public | Public / Unauthenticated | None / Public | No | `./routes/auth.routes` |
| 4 | `POST` | `/api/v1/auth/sign-in` | `handleSignIn` | Public | Public / Unauthenticated | None / Public | No | `./routes/auth.routes` |
| 5 | `POST` | `/api/v1/auth/sign-out` | `handleSignOut` | Optional / Clear | Public / Unauthenticated | None / Public | No | `./routes/auth.routes` |
| 6 | `GET` | `/api/v1/auth/me` | `handleMe` | Bearer / Cookie | Public / Unauthenticated | None / Public | No | `./routes/auth.routes` |
| 7 | `GET` | `/api/v1/businesses` | `handleListBusinesses` | Bearer / Cookie | Public / Unauthenticated | User-Scoped | No | `./routes/business.routes` |
| 8 | `GET` | `/api/v1/branches` | `handleListBranches` | Implicit (via Biz Context) | Any Active Member | Yes (`X-Business-Id`) | No | `./routes/business.routes` |
| 9 | `GET` | `/api/v1/categories` | `handleListCategories` | Bearer / Cookie | `catalog_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/categories/categories.routes` |
| 10 | `GET` | `/api/v1/categories/:id` | `handleGetCategory` | Bearer / Cookie | `catalog_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/categories/categories.routes` |
| 11 | `POST` | `/api/v1/categories` | `handleCreateCategory` | Bearer / Cookie | `catalog_write` | Yes (`X-Business-Id`) | No | `./features/categories/categories.routes` |
| 12 | `PUT` | `/api/v1/categories/:id` | `handleReplaceCategory` | Bearer / Cookie | `catalog_write` | Yes (`X-Business-Id`) | No | `./features/categories/categories.routes` |
| 13 | `PATCH` | `/api/v1/categories/:id` | `handleUpdateCategory` | Bearer / Cookie | `catalog_write` | Yes (`X-Business-Id`) | No | `./features/categories/categories.routes` |
| 14 | `DELETE` | `/api/v1/categories/:id` | `handleArchiveCategory` | Bearer / Cookie | `catalog_write` | Yes (`X-Business-Id`) | No | `./features/categories/categories.routes` |
| 15 | `GET` | `/api/v1/products` | `handleListProducts` | Bearer / Cookie | `catalog_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/products/products.routes` |
| 16 | `GET` | `/api/v1/products/:id` | `handleGetProduct` | Bearer / Cookie | `catalog_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/products/products.routes` |
| 17 | `POST` | `/api/v1/products` | `handleCreateProduct` | Bearer / Cookie | `catalog_write` | Yes (`X-Business-Id`) | No | `./features/products/products.routes` |
| 18 | `PUT` | `/api/v1/products/:id` | `handleReplaceProduct` | Bearer / Cookie | `catalog_write` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/products/products.routes` |
| 19 | `PATCH` | `/api/v1/products/:id` | `handleUpdateProduct` | Bearer / Cookie | `catalog_write` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/products/products.routes` |
| 20 | `DELETE` | `/api/v1/products/:id` | `handleArchiveProduct` | Bearer / Cookie | `catalog_write` | Yes (`X-Business-Id`) | No | `./features/products/products.routes` |
| 21 | `GET` | `/api/v1/sales` | `handleListSales` | Bearer / Cookie | `sales_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/sales/sales.routes` |
| 22 | `GET` | `/api/v1/sales/:id` | `handleGetSale` | Bearer / Cookie | `sales_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/sales/sales.routes` |
| 23 | `POST` | `/api/v1/sales` | `handleCreateSale` | Bearer / Cookie | `pos_sale` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/sales/sales.routes` |
| 24 | `POST` | `/api/v1/sales/:id/void` | `handleVoidSale` | Bearer / Cookie | `void_sale` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/sales/sales.routes` |
| 25 | `GET` | `/api/v1/sales/:id/invoice` | `handleGetSaleInvoice` | Bearer / Cookie | `sales_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/sales/sales.routes` |
| 26 | `GET` | `/api/v1/invoices` | `handleListInvoices` | Bearer / Cookie | `sales_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/invoices/invoices.routes` |
| 27 | `GET` | `/api/v1/invoices/:id` | `handleGetInvoice` | Bearer / Cookie | `sales_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/invoices/invoices.routes` |
| 28 | `GET` | `/api/v1/invoices/:id/sale` | `handleGetInvoiceSale` | Bearer / Cookie | `sales_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/invoices/invoices.routes` |
| 29 | `GET` | `/api/v1/customer-payments` | `handleListPayments` | Bearer / Cookie | `any(collect_payments,reports_view)` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/customer-payments/customerPayments.routes` |
| 30 | `GET` | `/api/v1/payments` | `handleListPayments` | Bearer / Cookie | `any(collect_payments,reports_view)` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/customer-payments/customerPayments.routes` |
| 31 | `GET` | `/api/v1/customer-payments/:id` | `handleGetPayment` | Bearer / Cookie | `any(collect_payments,reports_view)` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/customer-payments/customerPayments.routes` |
| 32 | `POST` | `/api/v1/customer-payments` | `handleCreatePayment` | Bearer / Cookie | `collect_payments` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/customer-payments/customerPayments.routes` |
| 33 | `GET` | `/api/v1/customer-payments/:id/allocations` | `handleGetPaymentAllocations` | Bearer / Cookie | `any(collect_payments,reports_view)` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/customer-payments/customerPayments.routes` |
| 34 | `POST` | `/api/v1/customer-payments/:id/allocations` | `handleAllocateAdvance` | Bearer / Cookie | `collect_payments` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/customer-payments/customerPayments.routes` |
| 35 | `GET` | `/api/v1/customers` | `handleListCustomers` | Bearer / Cookie | `customer_read` | Yes (`X-Business-Id`) | No | `./features/customers/customers.routes` |
| 36 | `GET` | `/api/v1/customers/:id` | `handleGetCustomer` | Bearer / Cookie | `customer_read` | Yes (`X-Business-Id`) | No | `./features/customers/customers.routes` |
| 37 | `POST` | `/api/v1/customers` | `handleCreateCustomer` | Bearer / Cookie | `customer_write` | Yes (`X-Business-Id`) | No | `./features/customers/customers.routes` |
| 38 | `PATCH` | `/api/v1/customers/:id` | `handleUpdateCustomer` | Bearer / Cookie | `customer_write` | Yes (`X-Business-Id`) | No | `./features/customers/customers.routes` |
| 39 | `PATCH` | `/api/v1/customers/:id/status` | `handleUpdateCustomerStatus` | Bearer / Cookie | `customer_write` | Yes (`X-Business-Id`) | No | `./features/customers/customers.routes` |
| 40 | `DELETE` | `/api/v1/customers/:id` | `handleArchiveCustomer` | Bearer / Cookie | `customer_write` | Yes (`X-Business-Id`) | No | `./features/customers/customers.routes` |
| 41 | `GET` | `/api/v1/customers/:customerId/ledger` | `handleGetCustomerLedger` | Bearer / Cookie | `reports_view` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/customer-ledger/customerLedger.routes` |
| 42 | `GET` | `/api/v1/customers/:customerId/ledger/summary` | `handleGetCustomerLedgerSummary` | Bearer / Cookie | `any(reports_view,collect_payments)` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/customer-ledger/customerLedger.routes` |
| 43 | `GET` | `/api/v1/suppliers` | `handleListSuppliers` | Bearer / Cookie | `supplier_read` | Yes (`X-Business-Id`) | No | `./features/suppliers/suppliers.routes` |
| 44 | `GET` | `/api/v1/suppliers/:id` | `handleGetSupplier` | Bearer / Cookie | `supplier_read` | Yes (`X-Business-Id`) | No | `./features/suppliers/suppliers.routes` |
| 45 | `POST` | `/api/v1/suppliers` | `handleCreateSupplier` | Bearer / Cookie | `supplier_write` | Yes (`X-Business-Id`) | No | `./features/suppliers/suppliers.routes` |
| 46 | `PATCH` | `/api/v1/suppliers/:id` | `handleUpdateSupplier` | Bearer / Cookie | `supplier_write` | Yes (`X-Business-Id`) | No | `./features/suppliers/suppliers.routes` |
| 47 | `PATCH` | `/api/v1/suppliers/:id/status` | `handleUpdateSupplierStatus` | Bearer / Cookie | `supplier_write` | Yes (`X-Business-Id`) | No | `./features/suppliers/suppliers.routes` |
| 48 | `DELETE` | `/api/v1/suppliers/:id` | `handleArchiveSupplier` | Bearer / Cookie | `supplier_write` | Yes (`X-Business-Id`) | No | `./features/suppliers/suppliers.routes` |
| 49 | `GET` | `/api/v1/suppliers/:id/products` | `handleListSupplierProducts` | Bearer / Cookie | `supplier_read` | Yes (`X-Business-Id`) | No | `./features/suppliers/suppliers.routes` |
| 50 | `POST` | `/api/v1/suppliers/:id/products` | `handleAddSupplierProduct` | Bearer / Cookie | `supplier_write` | Yes (`X-Business-Id`) | No | `./features/suppliers/suppliers.routes` |
| 51 | `GET` | `/api/v1/settings` | `handleGetSettings` | Bearer / Cookie | `settings_read` | Yes (`X-Business-Id`) | No | `./features/settings/settings.routes` |
| 52 | `PATCH` | `/api/v1/settings` | `handleUpdateSettings` | Bearer / Cookie | `manage_settings` | Yes (`X-Business-Id`) | No | `./features/settings/settings.routes` |
| 53 | `PUT` | `/api/v1/settings` | `handleUpdateSettings` | Bearer / Cookie | `manage_settings` | Yes (`X-Business-Id`) | No | `./features/settings/settings.routes` |
| 54 | `GET` | `/api/v1/inventory/balances` | `handleListBalances` | Bearer / Cookie | `inventory_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/inventory/inventory.routes` |
| 55 | `GET` | `/api/v1/inventory` | `handleListBalances` | Bearer / Cookie | `inventory_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/inventory/inventory.routes` |
| 56 | `GET` | `/api/v1/inventory/balances/:productId` | `handleGetProductBalances` | Bearer / Cookie | `inventory_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/inventory/inventory.routes` |
| 57 | `GET` | `/api/v1/inventory/movements` | `handleListMovements` | Bearer / Cookie | `inventory_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/inventory/inventory.routes` |
| 58 | `GET` | `/api/v1/stock-movements` | `handleListMovements` | Bearer / Cookie | `inventory_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/inventory/inventory.routes` |
| 59 | `POST` | `/api/v1/inventory/adjustments` | `handleRecordAdjustment` | Bearer / Cookie | `stock_adjustment` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/inventory/inventory.routes` |
| 60 | `POST` | `/api/v1/stock-adjustments` | `handleRecordAdjustment` | Bearer / Cookie | `stock_adjustment` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/inventory/inventory.routes` |
| 61 | `GET` | `/api/v1/inventory/counts` | `handleListCounts` | Bearer / Cookie | `inventory_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/inventory/inventory.routes` |
| 62 | `GET` | `/api/v1/stock-counts` | `handleListCounts` | Bearer / Cookie | `inventory_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/inventory/inventory.routes` |
| 63 | `POST` | `/api/v1/inventory/counts` | `handleCreateCount` | Bearer / Cookie | `stock_adjustment` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/inventory/inventory.routes` |
| 64 | `POST` | `/api/v1/stock-counts` | `handleCreateCount` | Bearer / Cookie | `stock_adjustment` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/inventory/inventory.routes` |
| 65 | `GET` | `/api/v1/inventory/counts/:id` | `handleGetCount` | Bearer / Cookie | `inventory_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/inventory/inventory.routes` |
| 66 | `GET` | `/api/v1/stock-counts/:id` | `handleGetCount` | Bearer / Cookie | `inventory_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/inventory/inventory.routes` |
| 67 | `POST` | `/api/v1/inventory/counts/:id/complete` | `handleCompleteCount` | Bearer / Cookie | `stocktake_confirm` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/inventory/inventory.routes` |
| 68 | `POST` | `/api/v1/stock-counts/:id/complete` | `handleCompleteCount` | Bearer / Cookie | `stocktake_confirm` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/inventory/inventory.routes` |
| 69 | `POST` | `/api/v1/inventory/counts/:id/confirm` | `handleCompleteCount` | Bearer / Cookie | `stocktake_confirm` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/inventory/inventory.routes` |
| 70 | `POST` | `/api/v1/stock-counts/:id/confirm` | `handleCompleteCount` | Bearer / Cookie | `stocktake_confirm` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/inventory/inventory.routes` |
| 71 | `GET` | `/api/v1/purchases` | `handleListPurchases` | Bearer / Cookie | `purchase_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/purchases/purchases.routes` |
| 72 | `GET` | `/api/v1/purchases/:id` | `handleGetPurchase` | Bearer / Cookie | `purchase_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/purchases/purchases.routes` |
| 73 | `POST` | `/api/v1/purchases` | `handleCreatePurchase` | Bearer / Cookie | `purchase_order` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/purchases/purchases.routes` |
| 74 | `PATCH` | `/api/v1/purchases/:id` | `handleUpdatePurchase` | Bearer / Cookie | `purchase_order` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/purchases/purchases.routes` |
| 75 | `POST` | `/api/v1/purchases/:id/confirm` | `handleConfirmPurchase` | Bearer / Cookie | `purchase_order` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/purchases/purchases.routes` |
| 76 | `POST` | `/api/v1/purchases/:id/cancel` | `handleCancelPurchase` | Bearer / Cookie | `purchase_order` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/purchases/purchases.routes` |
| 77 | `POST` | `/api/v1/purchases/:id/receipts` | `handleReceiveGoods` | Bearer / Cookie | `receive_goods` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/goods-receipts/goodsReceipts.routes` |
| 78 | `GET` | `/api/v1/goods-receipts` | `handleListGoodsReceipts` | Bearer / Cookie | `purchase_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/goods-receipts/goodsReceipts.routes` |
| 79 | `GET` | `/api/v1/goods-receipts/:id` | `handleGetGoodsReceipt` | Bearer / Cookie | `purchase_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/goods-receipts/goodsReceipts.routes` |
| 80 | `GET` | `/api/v1/supplier-payments` | `handleListSupplierPayments` | Bearer / Cookie | `any(disburse_payments,reports_view)` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/supplier-payments/supplierPayments.routes` |
| 81 | `GET` | `/api/v1/supplier-payments/:id` | `handleGetSupplierPayment` | Bearer / Cookie | `any(disburse_payments,reports_view)` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/supplier-payments/supplierPayments.routes` |
| 82 | `POST` | `/api/v1/supplier-payments` | `handleCreateSupplierPayment` | Bearer / Cookie | `disburse_payments` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/supplier-payments/supplierPayments.routes` |
| 83 | `GET` | `/api/v1/supplier-payments/:id/allocations` | `handleGetSupplierPaymentAllocations` | Bearer / Cookie | `any(disburse_payments,reports_view)` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/supplier-payments/supplierPayments.routes` |
| 84 | `POST` | `/api/v1/supplier-payments/:id/allocations` | `handleAllocateSupplierAdvance` | Bearer / Cookie | `disburse_payments` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/supplier-payments/supplierPayments.routes` |
| 85 | `GET` | `/api/v1/suppliers/:supplierId/ledger` | `handleGetSupplierLedger` | Bearer / Cookie | `reports_view` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/supplier-ledger/supplierLedger.routes` |
| 86 | `GET` | `/api/v1/suppliers/:supplierId/ledger/summary` | `handleGetSupplierLedgerSummary` | Bearer / Cookie | `reports_view` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/supplier-ledger/supplierLedger.routes` |
| 87 | `GET` | `/api/v1/expenses` | `handleListExpenses` | Bearer / Cookie | `expenses_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/expenses/expenses.routes` |
| 88 | `GET` | `/api/v1/expenses/summary` | `handleGetExpenseSummary` | Bearer / Cookie | `expenses_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/expenses/expenses.routes` |
| 89 | `GET` | `/api/v1/expenses/:id` | `handleGetExpense` | Bearer / Cookie | `expenses_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/expenses/expenses.routes` |
| 90 | `POST` | `/api/v1/expenses` | `handleCreateExpense` | Bearer / Cookie | `expenses_write` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/expenses/expenses.routes` |
| 91 | `PATCH` | `/api/v1/expenses/:id` | `handleUpdateExpense` | Bearer / Cookie | `expenses_write` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/expenses/expenses.routes` |
| 92 | `POST` | `/api/v1/expenses/:id/void` | `handleVoidExpense` | Bearer / Cookie | `expenses_write` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/expenses/expenses.routes` |
| 93 | `GET` | `/api/v1/expense-categories` | `handleListExpenseCategories` | Bearer / Cookie | `expenses_read` | Yes (`X-Business-Id`) | No | `./features/expenses/expenses.routes` |
| 94 | `POST` | `/api/v1/expense-categories` | `handleCreateExpenseCategory` | Bearer / Cookie | `expenses_write` | Yes (`X-Business-Id`) | No | `./features/expenses/expenses.routes` |
| 95 | `PATCH` | `/api/v1/expense-categories/:id` | `handleUpdateExpenseCategory` | Bearer / Cookie | `expenses_write` | Yes (`X-Business-Id`) | No | `./features/expenses/expenses.routes` |
| 96 | `DELETE` | `/api/v1/expense-categories/:id` | `handleDeleteExpenseCategory` | Bearer / Cookie | `expenses_write` | Yes (`X-Business-Id`) | No | `./features/expenses/expenses.routes` |
| 97 | `GET` | `/api/v1/staff` | `handleListStaff` | Bearer / Cookie | `staff_read` | Yes (`X-Business-Id`) | No | `./features/staff/staff.routes` |
| 98 | `GET` | `/api/v1/staff/invitations` | `handleListInvitations` | Bearer / Cookie | `manage_staff` | Yes (`X-Business-Id`) | No | `./features/staff/staff.routes` |
| 99 | `GET` | `/api/v1/staff/invitations/info` | `handleGetInvitationInfo` | Public | Public / Unauthenticated | None / Public | No | `./features/staff/staff.routes` |
| 100 | `POST` | `/api/v1/staff/invitations` | `handleInviteStaff` | Bearer / Cookie | `manage_staff` | Yes (`X-Business-Id`) | No | `./features/staff/staff.routes` |
| 101 | `POST` | `/api/v1/staff/invitations/accept` | `handleAcceptInvitation` | Token / Session | Public / Token-gated | None / Token | No | `./features/staff/staff.routes` |
| 102 | `POST` | `/api/v1/staff/invitations/:id/revoke` | `handleRevokeInvitation` | Bearer / Cookie | `manage_staff` | Yes (`X-Business-Id`) | No | `./features/staff/staff.routes` |
| 103 | `GET` | `/api/v1/staff/:id` | `handleGetStaffMember` | Bearer / Cookie | `staff_read` | Yes (`X-Business-Id`) | No | `./features/staff/staff.routes` |
| 104 | `GET` | `/api/v1/staff/:id/permissions` | `handleGetStaffPermissions` | Bearer / Cookie | `staff_read` | Yes (`X-Business-Id`) | No | `./features/staff/staff.routes` |
| 105 | `GET` | `/api/v1/staff/:id/branches` | `handleGetStaffBranches` | Bearer / Cookie | `staff_read` | Yes (`X-Business-Id`) | No | `./features/staff/staff.routes` |
| 106 | `PATCH` | `/api/v1/staff/:id/role` | `handleUpdateStaffRole` | Bearer / Cookie | `manage_staff` | Yes (`X-Business-Id`) | No | `./features/staff/staff.routes` |
| 107 | `PUT` | `/api/v1/staff/:id/branches` | `handleUpdateStaffBranches` | Bearer / Cookie | `manage_staff` | Yes (`X-Business-Id`) | No | `./features/staff/staff.routes` |
| 108 | `POST` | `/api/v1/staff/:id/suspend` | `handleSuspendStaff` | Bearer / Cookie | `manage_staff` | Yes (`X-Business-Id`) | No | `./features/staff/staff.routes` |
| 109 | `POST` | `/api/v1/staff/:id/reactivate` | `handleReactivateStaff` | Bearer / Cookie | `manage_staff` | Yes (`X-Business-Id`) | No | `./features/staff/staff.routes` |
| 110 | `POST` | `/api/v1/files` | `handleUploadFile` | Bearer / Cookie | `files_upload` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/files/files.routes` |
| 111 | `GET` | `/api/v1/files` | `handleListFiles` | Bearer / Cookie | `files_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/files/files.routes` |
| 112 | `GET` | `/api/v1/files/:id` | `handleGetFileMetadata` | Bearer / Cookie | `files_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/files/files.routes` |
| 113 | `GET` | `/api/v1/files/:id/content` | `handleGetFileContent` | Bearer / Cookie | `files_read` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/files/files.routes` |
| 114 | `DELETE` | `/api/v1/files/:id` | `handleDeleteFile` | Bearer / Cookie | `files_delete` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/files/files.routes` |
| 115 | `GET` | `/api/v1/reports/dashboard` | `handleGetDashboard` | Bearer / Cookie | `reports_view` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/reports/reports.routes` |
| 116 | `GET` | `/api/v1/reports/sales/summary` | `handleGetSalesSummary` | Bearer / Cookie | `reports_view` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/reports/reports.routes` |
| 117 | `GET` | `/api/v1/reports/sales/trends` | `handleGetSalesTrends` | Bearer / Cookie | `reports_view` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/reports/reports.routes` |
| 118 | `GET` | `/api/v1/reports/sales/by-product` | `handleGetSalesByProduct` | Bearer / Cookie | `reports_view` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/reports/reports.routes` |
| 119 | `GET` | `/api/v1/reports/sales/by-category` | `handleGetSalesByCategory` | Bearer / Cookie | `reports_view` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/reports/reports.routes` |
| 120 | `GET` | `/api/v1/reports/payments/summary` | `handleGetPaymentsSummary` | Bearer / Cookie | `reports_view` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/reports/reports.routes` |
| 121 | `GET` | `/api/v1/reports/payments/by-method` | `handleGetPaymentsByMethod` | Bearer / Cookie | `reports_view` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/reports/reports.routes` |
| 122 | `GET` | `/api/v1/reports/purchases/summary` | `handleGetPurchasesSummary` | Bearer / Cookie | `reports_view` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/reports/reports.routes` |
| 123 | `GET` | `/api/v1/reports/purchases/trends` | `handleGetPurchasesTrends` | Bearer / Cookie | `reports_view` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/reports/reports.routes` |
| 124 | `GET` | `/api/v1/reports/suppliers/payables` | `handleGetSupplierPayables` | Bearer / Cookie | `reports_view` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/reports/reports.routes` |
| 125 | `GET` | `/api/v1/reports/inventory/summary` | `handleGetInventorySummary` | Bearer / Cookie | `reports_view` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/reports/reports.routes` |
| 126 | `GET` | `/api/v1/reports/inventory/movements` | `handleGetInventoryMovements` | Bearer / Cookie | `reports_view` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/reports/reports.routes` |
| 127 | `GET` | `/api/v1/reports/inventory/low-stock` | `handleGetLowStock` | Bearer / Cookie | `reports_view` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/reports/reports.routes` |
| 128 | `GET` | `/api/v1/reports/inventory/valuation` | `handleGetInventoryValuation` | Bearer / Cookie | `reports_view` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/reports/reports.routes` |
| 129 | `GET` | `/api/v1/reports/customers/receivables` | `handleGetCustomerReceivables` | Bearer / Cookie | `reports_view` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/reports/reports.routes` |
| 130 | `GET` | `/api/v1/reports/export` | `handleExportCsv` | Bearer / Cookie | `reports_view` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/reports/reports.routes` |
| 131 | `POST` | `/api/v1/sync/devices/register` | `handleRegisterDevice` | Bearer / Cookie | `sync_use` | Yes (`X-Business-Id`) | No | `./features/sync/sync.routes` |
| 132 | `GET` | `/api/v1/sync/devices` | `handleListDevices` | Bearer / Cookie | `sync_use` | Yes (`X-Business-Id`) | No | `./features/sync/sync.routes` |
| 133 | `POST` | `/api/v1/sync/devices/heartbeat` | `handleDeviceHeartbeat` | Bearer / Cookie | `sync_use` | Yes (`X-Business-Id`) | No | `./features/sync/sync.routes` |
| 134 | `POST` | `/api/v1/sync/devices/:id/revoke` | `handleRevokeDevice` | Bearer / Cookie | `sync_use` | Yes (`X-Business-Id`) | No | `./features/sync/sync.routes` |
| 135 | `GET` | `/api/v1/sync/changes` | `handleGetChanges` | Bearer / Cookie | `sync_use` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/sync/sync.routes` |
| 136 | `POST` | `/api/v1/sync/ack` | `handleAckChanges` | Bearer / Cookie | `sync_use` | Yes (`X-Business-Id`) | No | `./features/sync/sync.routes` |
| 137 | `POST` | `/api/v1/offline/authorizations` | `handleCreateOfflineAuthorization` | Bearer / Cookie | `pos_sale` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/offline/offline.routes` |
| 138 | `POST` | `/api/v1/offline/sales/commit` | `handleCommitOfflineSale` | Bearer / Cookie | `pos_sale` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/offline/offline.routes` |
| 139 | `POST` | `/api/v1/offline/allocations/:id/reconcile` | `handleReconcileAllocation` | Bearer / Cookie | `stock_adjustment` | Yes (`X-Business-Id`) | Yes (`X-Branch-Id`) | `./features/offline/offline.routes` |
| 140 | `POST` | `/api/v1/offline/devices/:id/reconcile-lost` | `handleReconcileLostDevice` | Bearer / Cookie | `manage_settings` | Yes (`X-Business-Id`) | No | `./features/offline/offline.routes` |
