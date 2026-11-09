import { salesService } from '../../sales/services/salesService'
import type { CheckoutSale } from '../../pos/types/checkout.types'
import type { CustomerPayment } from '../../payments/types/payment.types'
import { getOutstandingInvoices, fetchCustomerPayments } from '../../payments/services/paymentService'
import { fetchPurchases } from '../../purchases/services/purchaseService'
import { fetchSupplierPayments } from '../../supplier-payments/services/supplierPaymentService'
import { getInventoryStatistics, getLowStockProducts, fetchInventoryMovements } from '../../inventory/services/inventoryService'
import { productService } from '../../products/services/productService'
import { customerService } from '../../customers/services/customerService'
import { supplierService } from '../../suppliers/services/supplierService'
import { categoryService } from '../../categories/services/categoryService'
import { getSupplierLedgerSummary } from '../../suppliers/services/supplierLedgerService'
import { money } from '../../pos/utils/checkoutCalculations'
import { businessDateKey, dateInRange, getComparisonRange } from '../utils/reportDateUtils'
import { apiClient } from '../../../lib/api-client'
import type { ComparisonMode, DateRange, ReportDataset, ReportFilters, ReportMetric, TrendPoint } from '../types/report.types'

function isExplicitDemo(): boolean {
  return import.meta.env?.VITE_DATA_SOURCE === 'mock'
}

export async function fetchDashboardReports() {
  if (!isExplicitDemo()) {
    return apiClient.get('/reports/dashboard')
  }
  return null
}

export async function downloadReportCsv(type: string, params: Record<string, string | number | undefined> = {}) {
  if (!isExplicitDemo()) {
    const blob = await apiClient.getBlob('/reports/export/csv', { params: { type, ...params } })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${type}-report.csv`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    return
  }
}

export async function loadReportDataset(): Promise<ReportDataset> {
  const [products, customers, suppliers, categories, sales, payments, supplierPayments, purchases, movements] = await Promise.all([
    productService.getProducts(),
    customerService.getCustomers(),
    supplierService.getSuppliers(),
    categoryService.getCategories(),
    salesService.getSales(),
    fetchCustomerPayments(),
    fetchSupplierPayments(),
    fetchPurchases(),
    fetchInventoryMovements(),
  ])
  return {
    sales,
    products,
    customers,
    suppliers,
    categories: categories.map(category => ({ id: category.id, name: category.name })),
    payments,
    supplierPayments,
    purchases,
    movements,
  }
}
export function completedSales(dataset: ReportDataset) { return dataset.sales.filter(sale => sale.status === 'completed') }
function salePaidById(dataset: ReportDataset) {
  const paid = new Map<string, number>()
  for (const payment of dataset.payments) for (const allocation of payment.allocations) paid.set(allocation.saleId, money((paid.get(allocation.saleId) ?? 0) + allocation.amount))
  return paid
}
function salePaymentStatus(sale: CheckoutSale, paid: number) { return paid >= sale.totalAmount - 0.005 ? 'paid' : paid > 0 ? 'partial' : 'unpaid' }
export function getReportRows(dataset: ReportDataset, filters: ReportFilters, range: DateRange) {
  const salePaid = salePaidById(dataset)
  const sales = completedSales(dataset).filter(sale => dateInRange(sale.createdAt, range) && (!filters.customerId || sale.customerId === filters.customerId) && (!filters.productId || sale.items.some(item => item.productId === filters.productId)) && (!filters.categoryId || sale.items.some(item => dataset.products.find(product=>product.id===item.productId)?.categoryId===filters.categoryId)) && (!filters.paymentStatus || salePaymentStatus(sale, salePaid.get(sale.id) ?? 0) === filters.paymentStatus) && (!filters.transactionStatus || sale.status === filters.transactionStatus))
  const saleById = new Map(dataset.sales.map(sale => [sale.id,sale]))
  const payments = dataset.payments.filter(payment => dateInRange(payment.receivedAt, range) && (!filters.customerId || payment.customerId === filters.customerId) && (!filters.paymentMethod || payment.methodBreakdown.some(method => method.method === filters.paymentMethod)) && (!filters.productId || payment.allocations.some(allocation=>saleById.get(allocation.saleId)?.items.some(item=>item.productId===filters.productId))) && (!filters.categoryId || payment.allocations.some(allocation=>saleById.get(allocation.saleId)?.items.some(item=>dataset.products.find(product=>product.id===item.productId)?.categoryId===filters.categoryId))))
  const purchases = dataset.purchases.filter(purchase => !['draft', 'cancelled'].includes(purchase.status) && dateInRange(purchase.purchaseDate, range) && (!filters.supplierId || purchase.supplierId === filters.supplierId) && (!filters.productId || purchase.items.some(item => item.productId === filters.productId)) && (!filters.categoryId || purchase.items.some(item => item.productSnapshot.categoryId === filters.categoryId)) && (!filters.transactionStatus || purchase.status === filters.transactionStatus))
  const supplierPayments = dataset.supplierPayments.filter(payment => dateInRange(payment.paidAt, range) && (!filters.supplierId || payment.supplierId === filters.supplierId) && (!filters.paymentMethod || payment.methodBreakdown.some(method => method.method === filters.paymentMethod)))
  const movements = dataset.movements.filter(movement => dateInRange(movement.createdAt, range) && (!filters.productId || movement.productId === filters.productId) && (!filters.transactionStatus || movement.type === filters.transactionStatus) && (!filters.categoryId || dataset.products.find(product => product.id === movement.productId)?.categoryId === filters.categoryId))
  const productSales = new Map<string, { quantity: number; gross: number; discount: number; net: number }>()
  for (const sale of sales) for (const item of sale.items) {
    const discount = sale.subtotal > 0 ? money(sale.discountAmount * item.lineTotal / sale.subtotal) : 0
    const row = productSales.get(item.productId) ?? { quantity: 0, gross: 0, discount: 0, net: 0 }
    row.quantity += item.quantity; row.gross = money(row.gross + item.lineTotal); row.discount = money(row.discount + discount); row.net = money(row.net + item.lineTotal - discount); productSales.set(item.productId, row)
  }
  const productRows = dataset.products.filter(product => (!filters.productId || product.id === filters.productId) && (!filters.categoryId || product.categoryId === filters.categoryId)).map(product => ({ product, ...(productSales.get(product.id) ?? { quantity: 0, gross: 0, discount: 0, net: 0 }) }))
  const customerRows = dataset.customers.filter(customer => !customer.isWalkIn && (!filters.customerId || customer.id === filters.customerId)).map(customer => {
    const customerSales = sales.filter(sale => sale.customerId === customer.id)
    const relatedSaleIds = new Set(customerSales.map(sale => sale.id))
    const paid = money(dataset.payments.reduce((sum, payment) => sum + payment.allocations.filter(allocation => relatedSaleIds.has(allocation.saleId)).reduce((subtotal, allocation) => subtotal + allocation.amount, 0), 0))
    return { customer, sales: customerSales, orderCount: customerSales.length, totalSales: money(customerSales.reduce((sum, sale) => sum + sale.totalAmount, 0)), paid, outstanding: money(customerSales.reduce((sum, sale) => sum + Math.max(0, sale.totalAmount - (salePaid.get(sale.id) ?? 0)), 0)), lastPurchase: customerSales.map(sale => sale.createdAt).sort().at(-1) }
  })
  const purchasePaid = new Map<string, number>()
  for (const payment of dataset.supplierPayments) for (const allocation of payment.allocations) purchasePaid.set(allocation.purchaseId, money((purchasePaid.get(allocation.purchaseId) ?? 0) + allocation.amount))
  const supplierRows = dataset.suppliers.map(supplier => {
    const supplierPurchases = purchases.filter(purchase => purchase.supplierId === supplier.id)
    const payable = getSupplierLedgerSummary(supplier.id)
    return { supplier, purchases: supplierPurchases, purchaseCount: supplierPurchases.length, totalPurchases: money(supplierPurchases.reduce((sum, purchase) => sum + purchase.totalAmount, 0)), totalPaid: money(supplierPurchases.reduce((sum, purchase) => sum + (purchasePaid.get(purchase.id) ?? 0), 0)), outstanding: money(supplierPurchases.reduce((sum, purchase) => sum + Math.max(0, purchase.totalAmount - (purchasePaid.get(purchase.id) ?? 0)), 0)), lastPurchase: supplierPurchases.map(purchase => purchase.purchaseDate).sort().at(-1), currentOutstanding: payable.outstandingPayable, advance: payable.advanceBalance }
  })
  const customerBalanceRows = dataset.customers.filter(customer => !customer.isWalkIn && (!filters.customerId || customer.id === filters.customerId)).map(customer => {
    const open = getOutstandingInvoices(customer.id).filter(invoice => dateInRange(invoice.date, range))
    const totalSales = money(completedSales(dataset).filter(sale => sale.customerId === customer.id && dateInRange(sale.createdAt, range)).reduce((sum, sale) => sum + sale.totalAmount, 0))
    const customerPayments = dataset.payments.filter(payment => payment.customerId === customer.id)
    const paidInPeriod = money(customerPayments.filter(payment => dateInRange(payment.receivedAt, range)).reduce((sum, payment) => sum + payment.amount, 0))
    const periodPayments = customerPayments.filter(payment => dateInRange(payment.receivedAt, range))
    return { customer, totalSales, totalPaid: paidInPeriod, outstanding: money(open.reduce((sum, invoice) => sum + invoice.outstanding, 0)), advance: money(periodPayments.reduce((sum, payment) => sum + payment.unallocatedAmount, 0)), invoices: open, lastPayment: periodPayments.map(payment => payment.receivedAt).sort().at(-1) }
  })
  return { sales, payments, purchases, supplierPayments, movements, productRows, customerRows, supplierRows, customerBalanceRows, salePaid }
}

export function getSalesSummary(sales: CheckoutSale[], paidBySale = new Map<string,number>()) {
  return { grossSales: money(sales.reduce((sum, sale) => sum + sale.subtotal, 0)), netSales: money(sales.reduce((sum, sale) => sum + sale.totalAmount, 0)), orders: sales.length, discounts: money(sales.reduce((sum, sale) => sum + sale.discountAmount, 0)), items: sales.reduce((sum, sale) => sum + sale.items.reduce((n, item) => n + item.quantity, 0), 0), averageOrder: sales.length ? money(sales.reduce((sum, sale) => sum + sale.totalAmount, 0) / sales.length) : 0, outstanding: money(sales.reduce((sum, sale) => sum + Math.max(0,sale.totalAmount-(paidBySale.get(sale.id)??sale.amountPaid)), 0)) }
}
export function makeMetric(label: string, current: number | null, previous: number | null, format: ReportMetric['format'] = 'currency', note?: string): ReportMetric { return { label, value: current, previous, format, note } }
export function compareValue(current: number, previous: number) { const difference = money(current - previous); return { difference, percent: previous === 0 ? (current === 0 ? 0 : null) : difference / Math.abs(previous) * 100 } }

function periodLabel(key: string, granularity: 'daily' | 'weekly' | 'monthly' | 'yearly') {
  if (granularity === 'yearly') return key.slice(0, 4)
  if (granularity === 'monthly') return key.slice(0, 7)
  const day = new Date(`${key}T12:00:00Z`)
  if (granularity === 'weekly') { const monday = new Date(day); monday.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7)); return `Week ${monday.toISOString().slice(0, 10)}` }
  return key
}
export function getTrend(sales: CheckoutSale[], payments: CustomerPayment[], range: DateRange, granularity: 'daily' | 'weekly' | 'monthly' | 'yearly' = 'daily'): TrendPoint[] {
  const grouped = new Map<string, TrendPoint>()
  const keyFor = (date: string) => periodLabel(businessDateKey(date), granularity)
  for (const sale of sales) { const key = keyFor(sale.createdAt); const row = grouped.get(key) ?? { label: key, sales: 0, collections: 0, orders: 0 }; row.sales = money(row.sales + sale.totalAmount); row.orders += 1; grouped.set(key, row) }
  for (const payment of payments) { const key = keyFor(payment.receivedAt); const row = grouped.get(key) ?? { label: key, sales: 0, collections: 0, orders: 0 }; row.collections = money(row.collections + payment.amount); grouped.set(key, row) }
  if (granularity === 'daily' && Math.round((Date.parse(`${range.to}T12:00:00Z`) - Date.parse(`${range.from}T12:00:00Z`)) / 86400000) < 60) {
    const count = Math.round((Date.parse(`${range.to}T12:00:00Z`) - Date.parse(`${range.from}T12:00:00Z`)) / 86400000) + 1
    for (let offset = 0; offset < count; offset++) { const key = periodLabel(new Date(Date.parse(`${range.from}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10), granularity); if (!grouped.has(key)) grouped.set(key, { label: key, sales: 0, collections: 0, orders: 0 }) }
  }
  return [...grouped.values()].sort((a, b) => a.label.localeCompare(b.label))
}

export function getComparisonMetrics(dataset: ReportDataset, filters: ReportFilters, range: DateRange, mode: ComparisonMode) {
  const previousRange = getComparisonRange(range, mode)
  if (!previousRange) return undefined
  const current = getReportRows(dataset, filters, range)
  const previous = getReportRows(dataset, filters, previousRange)
  const currentSales = getSalesSummary(current.sales,current.salePaid); const previousSales = getSalesSummary(previous.sales,previous.salePaid)
  return { range: previousRange, sales: currentSales, previousSales, collections: money(current.payments.reduce((sum, payment) => sum + payment.amount, 0)), previousCollections: money(previous.payments.reduce((sum, payment) => sum + payment.amount, 0)) }
}

export function productSalesByCategory(dataset: ReportDataset, rows: ReturnType<typeof getReportRows>['productRows']) {
  const categorySales = new Map<string, number>()
  for (const row of rows) categorySales.set(row.product.categoryId, money((categorySales.get(row.product.categoryId) ?? 0) + row.net))
  return [...categorySales].map(([id, value]) => ({ name: dataset.categories.find(category => category.id === id)?.name ?? 'Uncategorized', value })).sort((a, b) => b.value - a.value)
}

export function paymentMethodTotals(payments: CustomerPayment[]) {
  const totals = new Map<string, number>()
  for (const payment of payments) for (const method of payment.methodBreakdown) totals.set(method.method, money((totals.get(method.method) ?? 0) + method.amount))
  return [...totals].map(([method, value]) => ({ method, value })).sort((a, b) => b.value - a.value)
}

export function inventorySummary(dataset: ReportDataset) { return getInventoryStatistics(dataset.products) }
export function lowStockCount(dataset: ReportDataset) { return getLowStockProducts(dataset.products).length }
