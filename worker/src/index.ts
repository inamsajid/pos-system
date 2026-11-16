import type { Env } from './types/environment'
import { Router } from './router'
import { handleHealth, handleReadiness } from './routes/health.routes'
import {
  handleBootstrap,
  handleSignIn,
  handleSignOut,
  handleMe,
} from './routes/auth.routes'
import {
  handleListBusinesses,
  handleListBranches,
} from './routes/business.routes'
import {
  handleListCategories,
  handleGetCategory,
  handleCreateCategory,
  handleReplaceCategory,
  handleUpdateCategory,
  handleArchiveCategory,
} from './features/categories/categories.routes'
import {
  handleListProducts,
  handleGetProduct,
  handleCreateProduct,
  handleReplaceProduct,
  handleUpdateProduct,
  handleArchiveProduct,
} from './features/products/products.routes'
import {
  handleListSales,
  handleGetSale,
  handleCreateSale,
  handleVoidSale,
  handleGetSaleInvoice,
} from './features/sales/sales.routes'
import {
  handleListInvoices,
  handleGetInvoice,
  handleGetInvoiceSale,
} from './features/invoices/invoices.routes'
import {
  handleListPayments,
  handleGetPayment,
  handleCreatePayment,
  handleGetPaymentAllocations,
  handleAllocateAdvance,
} from './features/customer-payments/customerPayments.routes'
import {
  handleGetCustomerLedger,
  handleGetCustomerLedgerSummary,
} from './features/customer-ledger/customerLedger.routes'
import {
  handleListCustomers,
  handleGetCustomer,
  handleCreateCustomer,
  handleUpdateCustomer,
  handleUpdateCustomerStatus,
  handleArchiveCustomer,
} from './features/customers/customers.routes'
import {
  handleListSuppliers,
  handleGetSupplier,
  handleCreateSupplier,
  handleUpdateSupplier,
  handleUpdateSupplierStatus,
  handleArchiveSupplier,
  handleListSupplierProducts,
  handleAddSupplierProduct,
} from './features/suppliers/suppliers.routes'
import {
  handleGetSettings,
  handleUpdateSettings,
} from './features/settings/settings.routes'
import {
  handleListBalances,
  handleGetProductBalances,
  handleListMovements,
  handleRecordAdjustment,
  handleListCounts,
  handleCreateCount,
  handleGetCount,
  handleCompleteCount,
} from './features/inventory/inventory.routes'
import {
  handleListPurchases,
  handleGetPurchase,
  handleCreatePurchase,
  handleUpdatePurchase,
  handleConfirmPurchase,
  handleCancelPurchase,
} from './features/purchases/purchases.routes'
import {
  handleListGoodsReceipts,
  handleGetGoodsReceipt,
  handleReceiveGoods,
} from './features/goods-receipts/goodsReceipts.routes'
import {
  handleListSupplierPayments,
  handleGetSupplierPayment,
  handleCreateSupplierPayment,
  handleGetSupplierPaymentAllocations,
  handleAllocateSupplierAdvance,
} from './features/supplier-payments/supplierPayments.routes'
import {
  handleGetSupplierLedger,
  handleGetSupplierLedgerSummary,
} from './features/supplier-ledger/supplierLedger.routes'
import {
  handleListExpenses,
  handleGetExpenseSummary,
  handleGetExpense,
  handleCreateExpense,
  handleUpdateExpense,
  handleVoidExpense,
  handleListExpenseCategories,
  handleCreateExpenseCategory,
  handleUpdateExpenseCategory,
  handleDeleteExpenseCategory,
} from './features/expenses/expenses.routes'
import {
  handleListStaff,
  handleGetStaffMember,
  handleGetStaffPermissions,
  handleGetStaffBranches,
  handleInviteStaff,
  handleListInvitations,
  handleRevokeInvitation,
  handleAcceptInvitation,
  handleGetInvitationInfo,
  handleUpdateStaffRole,
  handleUpdateStaffBranches,
  handleSuspendStaff,
  handleReactivateStaff,
} from './features/staff/staff.routes'
import {
  handleUploadFile,
  handleGetFileMetadata,
  handleGetFileContent,
  handleDeleteFile,
  handleListFiles,
} from './features/files/files.routes'
import {
  handleGetDashboard,
  handleGetSalesSummary,
  handleGetSalesTrends,
  handleGetSalesByProduct,
  handleGetSalesByCategory,
  handleGetPaymentsSummary,
  handleGetPaymentsByMethod,
  handleGetPurchasesSummary,
  handleGetPurchasesTrends,
  handleGetSupplierPayables,
  handleGetInventorySummary,
  handleGetInventoryMovements,
  handleGetLowStock,
  handleGetInventoryValuation,
  handleGetCustomerReceivables,
  handleExportCsv,
} from './features/reports/reports.routes'
import {
  handleRegisterDevice,
  handleListDevices,
  handleDeviceHeartbeat,
  handleRevokeDevice,
  handleGetChanges,
  handleAckChanges,
} from './features/sync/sync.routes'
import {
  handleCreateOfflineAuthorization,
  handleCommitOfflineSale,
  handleReconcileAllocation,
  handleReconcileLostDevice,
} from './features/offline/offline.routes'
import { jsonResponse } from './lib/response'

export const router = new Router()

// Register baseline endpoints
router.get('/api/v1/health', handleHealth)
router.get('/api/v1/ready', handleReadiness)

// Authentication endpoints
router.post('/api/v1/auth/bootstrap', handleBootstrap)
router.post('/api/v1/auth/sign-in', handleSignIn)
router.post('/api/v1/auth/sign-out', handleSignOut)
router.get('/api/v1/auth/me', handleMe)

// Multi-tenant business & branch context endpoints
router.get('/api/v1/businesses', handleListBusinesses)
router.get('/api/v1/branches', handleListBranches)

// Categories endpoints
router.get('/api/v1/categories', handleListCategories)
router.get('/api/v1/categories/:id', handleGetCategory)
router.post('/api/v1/categories', handleCreateCategory)
router.put('/api/v1/categories/:id', handleReplaceCategory)
router.patch('/api/v1/categories/:id', handleUpdateCategory)
router.delete('/api/v1/categories/:id', handleArchiveCategory)

// Products endpoints
router.get('/api/v1/products', handleListProducts)
router.get('/api/v1/products/:id', handleGetProduct)
router.post('/api/v1/products', handleCreateProduct)
router.put('/api/v1/products/:id', handleReplaceProduct)
router.patch('/api/v1/products/:id', handleUpdateProduct)
router.delete('/api/v1/products/:id', handleArchiveProduct)

// Sales endpoints
router.get('/api/v1/sales', handleListSales)
router.get('/api/v1/sales/:id', handleGetSale)
router.post('/api/v1/sales', handleCreateSale)
router.post('/api/v1/sales/:id/void', handleVoidSale)
router.get('/api/v1/sales/:id/invoice', handleGetSaleInvoice)

// Invoices endpoints
router.get('/api/v1/invoices', handleListInvoices)
router.get('/api/v1/invoices/:id', handleGetInvoice)
router.get('/api/v1/invoices/:id/sale', handleGetInvoiceSale)

// Customer Payments endpoints
router.get('/api/v1/customer-payments', handleListPayments)
router.get('/api/v1/payments', handleListPayments)
router.get('/api/v1/customer-payments/:id', handleGetPayment)
router.post('/api/v1/customer-payments', handleCreatePayment)
router.get('/api/v1/customer-payments/:id/allocations', handleGetPaymentAllocations)
router.post('/api/v1/customer-payments/:id/allocations', handleAllocateAdvance)

// Customer Master Data endpoints
router.get('/api/v1/customers', handleListCustomers)
router.get('/api/v1/customers/:id', handleGetCustomer)
router.post('/api/v1/customers', handleCreateCustomer)
router.patch('/api/v1/customers/:id', handleUpdateCustomer)
router.patch('/api/v1/customers/:id/status', handleUpdateCustomerStatus)
router.delete('/api/v1/customers/:id', handleArchiveCustomer)

// Customer Ledger endpoints
router.get('/api/v1/customers/:customerId/ledger', handleGetCustomerLedger)
router.get('/api/v1/customers/:customerId/ledger/summary', handleGetCustomerLedgerSummary)

// Supplier Master Data endpoints
router.get('/api/v1/suppliers', handleListSuppliers)
router.get('/api/v1/suppliers/:id', handleGetSupplier)
router.post('/api/v1/suppliers', handleCreateSupplier)
router.patch('/api/v1/suppliers/:id', handleUpdateSupplier)
router.patch('/api/v1/suppliers/:id/status', handleUpdateSupplierStatus)
router.delete('/api/v1/suppliers/:id', handleArchiveSupplier)
router.get('/api/v1/suppliers/:id/products', handleListSupplierProducts)
router.post('/api/v1/suppliers/:id/products', handleAddSupplierProduct)

// Business Settings endpoints
router.get('/api/v1/settings', handleGetSettings)
router.patch('/api/v1/settings', handleUpdateSettings)
router.put('/api/v1/settings', handleUpdateSettings)

// Inventory & Stock endpoints
router.get('/api/v1/inventory/balances', handleListBalances)
router.get('/api/v1/inventory', handleListBalances)
router.get('/api/v1/inventory/balances/:productId', handleGetProductBalances)
router.get('/api/v1/inventory/movements', handleListMovements)
router.get('/api/v1/stock-movements', handleListMovements)
router.post('/api/v1/inventory/adjustments', handleRecordAdjustment)
router.post('/api/v1/stock-adjustments', handleRecordAdjustment)
router.get('/api/v1/inventory/counts', handleListCounts)
router.get('/api/v1/stock-counts', handleListCounts)
router.post('/api/v1/inventory/counts', handleCreateCount)
router.post('/api/v1/stock-counts', handleCreateCount)
router.get('/api/v1/inventory/counts/:id', handleGetCount)
router.get('/api/v1/stock-counts/:id', handleGetCount)
router.post('/api/v1/inventory/counts/:id/complete', handleCompleteCount)
router.post('/api/v1/stock-counts/:id/complete', handleCompleteCount)
router.post('/api/v1/inventory/counts/:id/confirm', handleCompleteCount)
router.post('/api/v1/stock-counts/:id/confirm', handleCompleteCount)

// Purchases & Purchase Orders endpoints
router.get('/api/v1/purchases', handleListPurchases)
router.get('/api/v1/purchases/:id', handleGetPurchase)
router.post('/api/v1/purchases', handleCreatePurchase)
router.patch('/api/v1/purchases/:id', handleUpdatePurchase)
router.post('/api/v1/purchases/:id/confirm', handleConfirmPurchase)
router.post('/api/v1/purchases/:id/cancel', handleCancelPurchase)
router.post('/api/v1/purchases/:id/receipts', handleReceiveGoods)

// Goods Receipts endpoints
router.get('/api/v1/goods-receipts', handleListGoodsReceipts)
router.get('/api/v1/goods-receipts/:id', handleGetGoodsReceipt)

// Supplier Payments endpoints
router.get('/api/v1/supplier-payments', handleListSupplierPayments)
router.get('/api/v1/supplier-payments/:id', handleGetSupplierPayment)
router.post('/api/v1/supplier-payments', handleCreateSupplierPayment)
router.get('/api/v1/supplier-payments/:id/allocations', handleGetSupplierPaymentAllocations)
router.post('/api/v1/supplier-payments/:id/allocations', handleAllocateSupplierAdvance)

// Supplier Ledger endpoints
router.get('/api/v1/suppliers/:supplierId/ledger', handleGetSupplierLedger)
router.get('/api/v1/suppliers/:supplierId/ledger/summary', handleGetSupplierLedgerSummary)

// Expenses endpoints (Step 14.2)
router.get('/api/v1/expenses', handleListExpenses)
router.get('/api/v1/expenses/summary', handleGetExpenseSummary)
router.get('/api/v1/expenses/:id', handleGetExpense)
router.post('/api/v1/expenses', handleCreateExpense)
router.patch('/api/v1/expenses/:id', handleUpdateExpense)
router.post('/api/v1/expenses/:id/void', handleVoidExpense)
router.get('/api/v1/expense-categories', handleListExpenseCategories)
router.post('/api/v1/expense-categories', handleCreateExpenseCategory)
router.patch('/api/v1/expense-categories/:id', handleUpdateExpenseCategory)
router.delete('/api/v1/expense-categories/:id', handleDeleteExpenseCategory)

// Staff Management endpoints (Step 14.3)
router.get('/api/v1/staff', handleListStaff)
router.get('/api/v1/staff/invitations', handleListInvitations)
router.get('/api/v1/staff/invitations/info', handleGetInvitationInfo)
router.post('/api/v1/staff/invitations', handleInviteStaff)
router.post('/api/v1/staff/invitations/accept', handleAcceptInvitation)
router.post('/api/v1/staff/invitations/:id/revoke', handleRevokeInvitation)
router.get('/api/v1/staff/:id', handleGetStaffMember)
router.get('/api/v1/staff/:id/permissions', handleGetStaffPermissions)
router.get('/api/v1/staff/:id/branches', handleGetStaffBranches)
router.patch('/api/v1/staff/:id/role', handleUpdateStaffRole)
router.put('/api/v1/staff/:id/branches', handleUpdateStaffBranches)
router.post('/api/v1/staff/:id/suspend', handleSuspendStaff)
router.post('/api/v1/staff/:id/reactivate', handleReactivateStaff)

// Files & Cloudflare R2 Storage endpoints
router.post('/api/v1/files', handleUploadFile)
router.get('/api/v1/files', handleListFiles)
router.get('/api/v1/files/:id', handleGetFileMetadata)
router.get('/api/v1/files/:id/content', handleGetFileContent)
router.delete('/api/v1/files/:id', handleDeleteFile)

// Reports & Analytics endpoints
router.get('/api/v1/reports/dashboard', handleGetDashboard)
router.get('/api/v1/reports/sales/summary', handleGetSalesSummary)
router.get('/api/v1/reports/sales/trends', handleGetSalesTrends)
router.get('/api/v1/reports/sales/by-product', handleGetSalesByProduct)
router.get('/api/v1/reports/sales/by-category', handleGetSalesByCategory)
router.get('/api/v1/reports/payments/summary', handleGetPaymentsSummary)
router.get('/api/v1/reports/payments/by-method', handleGetPaymentsByMethod)
router.get('/api/v1/reports/purchases/summary', handleGetPurchasesSummary)
router.get('/api/v1/reports/purchases/trends', handleGetPurchasesTrends)
router.get('/api/v1/reports/suppliers/payables', handleGetSupplierPayables)
router.get('/api/v1/reports/inventory/summary', handleGetInventorySummary)
router.get('/api/v1/reports/inventory/movements', handleGetInventoryMovements)
router.get('/api/v1/reports/inventory/low-stock', handleGetLowStock)
router.get('/api/v1/reports/inventory/valuation', handleGetInventoryValuation)
router.get('/api/v1/reports/customers/receivables', handleGetCustomerReceivables)
router.get('/api/v1/reports/export', handleExportCsv)

// Multi-Device Synchronization & Device Management endpoints (Step 13.5)
router.post('/api/v1/sync/devices/register', handleRegisterDevice)
router.get('/api/v1/sync/devices', handleListDevices)
router.post('/api/v1/sync/devices/heartbeat', handleDeviceHeartbeat)
router.post('/api/v1/sync/devices/:id/revoke', handleRevokeDevice)
router.get('/api/v1/sync/changes', handleGetChanges)
router.post('/api/v1/sync/ack', handleAckChanges)

// Offline POS Authorizations & Commit Endpoints (Step 13.6 & 13.7)
router.post('/api/v1/offline/authorizations', handleCreateOfflineAuthorization)
router.post('/api/v1/offline/sales/commit', handleCommitOfflineSale)
router.post('/api/v1/offline/allocations/:id/reconcile', handleReconcileAllocation)
router.post('/api/v1/offline/devices/:id/reconcile-lost', handleReconcileLostDevice)

// Root fallback informational route
router.get('/', (ctx) => {
  return jsonResponse(
    {
      service: 'pos-system-api',
      documentation: '/api/v1/health',
      environment: ctx.env.ENVIRONMENT || 'local',
    },
    200,
    ctx.requestId
  )
})

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return router.handle(request, env, ctx)
  },
}
