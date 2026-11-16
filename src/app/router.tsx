import type { ComponentType } from 'react'
import { createBrowserRouter, Link, Navigate } from 'react-router-dom'
import { ProtectedRoute } from './ProtectedRoute'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { AuthLayout } from '../layouts/AuthLayout'
import { LoginPage, RegisterPage, ForgotPasswordPage } from '../features/auth/pages/AuthPages'
import { AcceptInvitationPage } from '../features/auth/pages/AcceptInvitationPage'
import { PermissionGuard } from './PermissionGuard'
import type { Permission } from '../lib/permissions'

function guardedLazy(
  permission: Permission,
  loader: () => Promise<ComponentType>
) {
  return async () => {
    const Component = await loader()
    return {
      Component: () => (
        <PermissionGuard permission={permission}>
          <Component />
        </PermissionGuard>
      ),
    }
  }
}

export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/dashboard" replace /> },
  {
    element: <AuthLayout />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/accept-invitation', element: <AcceptInvitationPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
    ],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <DashboardLayout />,
        children: [
          {
            path: '/dashboard',
            hydrateFallbackElement: (
              <div className="p-6 text-sm text-slate-500" role="status">
                Loading dashboard…
              </div>
            ),
            lazy: async () => ({
              Component: (await import('../features/dashboard/pages/DashboardPage')).DashboardPage,
            }),
          },
          {
            path: '/pos',
            hydrateFallbackElement: (
              <div className="p-6 text-sm text-slate-500" role="status">
                Loading POS…
              </div>
            ),
            lazy: guardedLazy(
              'pos_sale',
              async () => (await import('../features/pos/pages/PosPage')).PosPage
            ),
          },
          {
            path: '/products',
            hydrateFallbackElement: (
              <div className="p-6 text-sm text-slate-500" role="status">
                Loading products…
              </div>
            ),
            lazy: guardedLazy(
              'catalog_read',
              async () => (await import('../features/products/pages/ProductsPage')).ProductsPage
            ),
          },
          {
            path: '/products/new',
            hydrateFallbackElement: (
              <div className="p-6 text-sm text-slate-500" role="status">
                Loading product form…
              </div>
            ),
            lazy: guardedLazy(
              'catalog_write',
              async () => (await import('../features/products/pages/AddProductPage')).AddProductPage
            ),
          },
          {
            path: '/products/:productId/edit',
            hydrateFallbackElement: (
              <div className="p-6 text-sm text-slate-500" role="status">
                Loading product form…
              </div>
            ),
            lazy: guardedLazy(
              'catalog_write',
              async () => (await import('../features/products/pages/EditProductPage')).EditProductPage
            ),
          },
          {
            path: '/products/:productId',
            hydrateFallbackElement: (
              <div className="p-6 text-sm text-slate-500" role="status">
                Loading product details…
              </div>
            ),
            lazy: guardedLazy(
              'catalog_read',
              async () =>
                (await import('../features/products/pages/ProductDetailsPage')).ProductDetailsPage
            ),
          },
          {
            path: '/categories',
            hydrateFallbackElement: (
              <div className="p-6 text-sm text-slate-500" role="status">
                Loading categories…
              </div>
            ),
            lazy: guardedLazy(
              'catalog_read',
              async () =>
                (await import('../features/categories/pages/CategoriesPage')).CategoriesPage
            ),
          },
          {
            path: '/customers',
            lazy: guardedLazy(
              'customer_read',
              async () => (await import('../features/customers/pages/CustomersPage')).CustomersPage
            ),
          },
          {
            path: '/customers/new',
            lazy: guardedLazy(
              'customer_write',
              async () =>
                (await import('../features/customers/pages/AddCustomerPage')).AddCustomerPage
            ),
          },
          {
            path: '/customers/:id/edit',
            lazy: guardedLazy(
              'customer_write',
              async () =>
                (await import('../features/customers/pages/EditCustomerPage')).EditCustomerPage
            ),
          },
          {
            path: '/customers/:id/account',
            lazy: guardedLazy(
              'reports_view',
              async () =>
                (await import('../features/customers/pages/CustomerAccountPage'))
                  .CustomerAccountPage
            ),
          },
          {
            path: '/customers/:customerId/ledger',
            lazy: guardedLazy(
              'reports_view',
              async () =>
                (await import('../features/customers/pages/CustomerAccountPage'))
                  .CustomerAccountPage
            ),
          },
          {
            path: '/customers/:id',
            lazy: guardedLazy(
              'customer_read',
              async () =>
                (await import('../features/customers/pages/CustomerDetailsPage'))
                  .CustomerDetailsPage
            ),
          },
          {
            path: '/suppliers',
            lazy: guardedLazy(
              'supplier_read',
              async () => (await import('../features/suppliers/pages/SuppliersPage')).SuppliersPage
            ),
          },
          {
            path: '/suppliers/new',
            lazy: guardedLazy(
              'supplier_write',
              async () =>
                (await import('../features/suppliers/pages/AddSupplierPage')).AddSupplierPage
            ),
          },
          {
            path: '/suppliers/:supplierId/edit',
            lazy: guardedLazy(
              'supplier_write',
              async () =>
                (await import('../features/suppliers/pages/EditSupplierPage')).EditSupplierPage
            ),
          },
          {
            path: '/suppliers/:supplierId/account',
            lazy: guardedLazy(
              'reports_view',
              async () =>
                (await import('../features/suppliers/pages/SupplierAccountPage'))
                  .SupplierAccountPage
            ),
          },
          {
            path: '/suppliers/:supplierId/ledger',
            lazy: guardedLazy(
              'reports_view',
              async () =>
                (await import('../features/suppliers/pages/SupplierAccountPage'))
                  .SupplierAccountPage
            ),
          },
          {
            path: '/suppliers/:supplierId',
            lazy: guardedLazy(
              'supplier_read',
              async () =>
                (await import('../features/suppliers/pages/SupplierDetailsPage'))
                  .SupplierDetailsPage
            ),
          },
          {
            path: '/sales',
            hydrateFallbackElement: (
              <div role="status" className="p-6 text-sm text-slate-500">
                Loading sales…
              </div>
            ),
            lazy: guardedLazy(
              'sales_read',
              async () => (await import('../features/sales/pages/SalesPage')).SalesPage
            ),
          },
          {
            path: '/sales/:saleId',
            hydrateFallbackElement: (
              <div role="status" className="p-6 text-sm text-slate-500">
                Loading sale…
              </div>
            ),
            lazy: guardedLazy(
              'sales_read',
              async () => (await import('../features/sales/pages/SaleDetailsPage')).SaleDetailsPage
            ),
          },
          {
            path: '/invoices',
            hydrateFallbackElement: (
              <div role="status" className="p-6 text-sm text-slate-500">
                Loading invoices…
              </div>
            ),
            lazy: guardedLazy(
              'sales_read',
              async () => (await import('../features/invoices/pages/InvoicesPage')).InvoicesPage
            ),
          },
          {
            path: '/invoices/:invoiceId',
            hydrateFallbackElement: (
              <div role="status" className="p-6 text-sm text-slate-500">
                Loading invoice…
              </div>
            ),
            lazy: guardedLazy(
              'sales_read',
              async () =>
                (await import('../features/invoices/pages/InvoiceDetailsPage')).InvoiceDetailsPage
            ),
          },
          {
            path: '/inventory',
            lazy: guardedLazy(
              'inventory_read',
              async () => (await import('../features/inventory/pages/InventoryPage')).InventoryPage
            ),
          },
          {
            path: '/inventory/movements',
            lazy: guardedLazy(
              'inventory_read',
              async () => (await import('../features/inventory/pages/InventoryMovementsPage')).InventoryMovementsPage
            ),
          },
          {
            path: '/inventory/movements/:movementId',
            lazy: guardedLazy(
              'inventory_read',
              async () => (await import('../features/inventory/pages/InventoryMovementsPage')).InventoryMovementsPage
            ),
          },
          {
            path: '/inventory/count',
            lazy: guardedLazy(
              'stock_adjustment',
              async () => (await import('../features/inventory/pages/StockCountPage')).StockCountPage
            ),
          },
          {
            path: '/purchases',
            lazy: guardedLazy(
              'purchase_read',
              async () => (await import('../features/purchases/pages/PurchasesPage')).PurchasesPage
            ),
          },
          {
            path: '/purchases/new',
            lazy: guardedLazy(
              'purchase_order',
              async () => (await import('../features/purchases/pages/AddPurchasePage')).AddPurchasePage
            ),
          },
          {
            path: '/purchases/:purchaseId/edit',
            lazy: guardedLazy(
              'purchase_order',
              async () => (await import('../features/purchases/pages/AddPurchasePage')).AddPurchasePage
            ),
          },
          {
            path: '/purchases/:purchaseId/receive',
            lazy: guardedLazy(
              'receive_goods',
              async () => (await import('../features/purchases/pages/GoodsReceiptPage')).GoodsReceiptPage
            ),
          },
          {
            path: '/purchases/:purchaseId',
            lazy: guardedLazy(
              'purchase_read',
              async () => (await import('../features/purchases/pages/PurchaseDetailsPage')).PurchaseDetailsPage
            ),
          },
          {
            path: '/supplier-payments',
            lazy: guardedLazy(
              'disburse_payments',
              async () => (await import('../features/supplier-payments/pages/SupplierPaymentsPage')).SupplierPaymentsPage
            ),
          },
          {
            path: '/supplier-payments/new',
            lazy: guardedLazy(
              'disburse_payments',
              async () => (await import('../features/supplier-payments/pages/AddSupplierPaymentPage')).AddSupplierPaymentPage
            ),
          },
          {
            path: '/supplier-payments/:paymentId',
            lazy: guardedLazy(
              'disburse_payments',
              async () => (await import('../features/supplier-payments/pages/SupplierPaymentDetailsPage')).SupplierPaymentDetailsPage
            ),
          },
          {
            path: '/payments',
            lazy: guardedLazy(
              'collect_payments',
              async () => (await import('../features/payments/pages/PaymentsPage')).PaymentsPage
            ),
          },
          {
            path: '/payments/new',
            lazy: guardedLazy(
              'collect_payments',
              async () => (await import('../features/payments/pages/ReceivePaymentPage')).ReceivePaymentPage
            ),
          },
          {
            path: '/payments/:paymentId',
            lazy: guardedLazy(
              'collect_payments',
              async () => (await import('../features/payments/pages/PaymentDetailsPage')).PaymentDetailsPage
            ),
          },
          {
            path: '/ledger',
            lazy: guardedLazy(
              'reports_view',
              async () => (await import('../features/ledger/pages/LedgerPage')).LedgerPage
            ),
          },
          {
            path: '/expenses',
            lazy: guardedLazy(
              'expenses_read',
              async () => (await import('../features/expenses/pages/ExpensesPage')).ExpensesPage
            ),
          },
          {
            path: '/reports',
            hydrateFallbackElement: (
              <div className="p-6 text-sm text-slate-500" role="status">
                Loading reports...
              </div>
            ),
            lazy: guardedLazy(
              'reports_view',
              async () => (await import('../features/reports/pages/ReportsPage')).ReportsPage
            ),
          },
          {
            path: '/reports/:reportType',
            hydrateFallbackElement: (
              <div className="p-6 text-sm text-slate-500" role="status">
                Loading report...
              </div>
            ),
            lazy: guardedLazy(
              'reports_view',
              async () =>
                (await import('../features/reports/pages/ReportDetailPage')).ReportDetailPage
            ),
          },
          {
            path: '/staff',
            lazy: guardedLazy(
              'manage_staff',
              async () => (await import('../features/staff/pages/StaffPage')).StaffPage
            ),
          },
          {
            path: '/staff/:id',
            lazy: guardedLazy(
              'manage_staff',
              async () => (await import('../features/staff/pages/StaffDetailsPage')).StaffDetailsPage
            ),
          },
          {
            path: '/settings',
            lazy: guardedLazy(
              'manage_settings',
              async () => (await import('../features/settings/pages/SettingsPage')).SettingsPage
            ),
          },
        ],
      },
    ],
  },
  {
    path: '*',
    element: (
      <div className="grid min-h-screen place-items-center bg-slate-50 p-6">
        <div className="text-center">
          <p className="text-sm font-bold text-blue-600">404</p>
          <h1 className="mt-2 text-2xl font-bold">Page not found</h1>
          <p className="mt-2 text-sm text-slate-500">The page you are looking for does not exist.</p>
          <Link
            to="/dashboard"
            className="mt-5 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    ),
  },
])
