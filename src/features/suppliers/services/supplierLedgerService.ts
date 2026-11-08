import { supplierFinancialMockData } from '../data/supplierMockData'
import type { SupplierFinancialSummary, SupplierTransaction } from '../types/supplier.types'
import { getPurchases } from '../../purchases/services/purchaseService'
import { getPaymentsForSupplier, getSupplierOutstandingPurchases, getSupplierAdvanceBalance } from '../../supplier-payments/services/supplierPaymentService'
import { money } from '../../pos/utils/checkoutCalculations'

export type SupplierLedgerEntry = SupplierTransaction & { type: 'opening' | 'purchase' | 'payment'; purchaseId?: string; paymentId?: string }
function openingFor(supplierId: string) { return supplierFinancialMockData.find(summary => summary.supplierId === supplierId)?.openingPayable ?? 0 }
export function getSupplierLedger(supplierId: string): SupplierLedgerEntry[] {
  const purchases = getPurchases().filter(purchase => purchase.supplierId === supplierId && !['draft', 'cancelled'].includes(purchase.status))
  const payments = getPaymentsForSupplier(supplierId)
  const dates = [...purchases.map(purchase => purchase.confirmedAt ?? purchase.purchaseDate), ...payments.map(payment => payment.paidAt)].sort()
  const entries: SupplierLedgerEntry[] = []
  const opening = openingFor(supplierId)
  if (opening > 0) entries.push({ id: `opening-${supplierId}`, supplierId, date: dates[0] ?? new Date(0).toISOString(), reference: 'OPENING', description: 'Opening payable', debit: 0, credit: opening, balance: 0, type: 'opening' })
  for (const purchase of purchases) entries.push({ id: `purchase-${purchase.id}`, supplierId, date: purchase.confirmedAt ?? purchase.purchaseDate, reference: purchase.purchaseNumber, description: `Purchase bill${purchase.supplierInvoiceNumber ? ` · supplier invoice ${purchase.supplierInvoiceNumber}` : ''}`, debit: 0, credit: purchase.totalAmount, balance: 0, type: 'purchase', purchaseId: purchase.id })
  for (const payment of payments) entries.push({ id: `payment-${payment.id}`, supplierId, date: payment.paidAt, reference: payment.receiptNumber, description: `Supplier payment · ${payment.methodBreakdown.map(method => method.method).join(', ')}`, debit: payment.amount, credit: 0, balance: 0, type: 'payment', paymentId: payment.id })
  entries.sort((a, b) => a.date.localeCompare(b.date) || ({ opening: 0, purchase: 1, payment: 2 }[a.type] - { opening: 0, purchase: 1, payment: 2 }[b.type]) || a.id.localeCompare(b.id))
  let balance = 0
  return entries.map(entry => { balance = money(balance + entry.credit - entry.debit); return { ...entry, balance } })
}
export function getSupplierLedgerSummary(supplierId: string): SupplierFinancialSummary & { currentAccountBalance: number } {
  const purchases = getPurchases().filter(purchase => purchase.supplierId === supplierId && !['draft', 'cancelled'].includes(purchase.status))
  const payments = getPaymentsForSupplier(supplierId)
  const ledger = getSupplierLedger(supplierId)
  return {
    supplierId, totalPurchases: money(purchases.reduce((sum, purchase) => sum + purchase.totalAmount, 0)),
    totalPaid: money(payments.reduce((sum, payment) => sum + payment.amount, 0)),
    outstandingPayable: money(openingFor(supplierId) + getSupplierOutstandingPurchases(supplierId).reduce((sum, purchase) => sum + purchase.outstanding, 0)),
    advanceBalance: getSupplierAdvanceBalance(supplierId), openingPayable: openingFor(supplierId),
    lastPurchaseDate: purchases.map(purchase => purchase.purchaseDate).sort().at(-1), currentAccountBalance: ledger.at(-1)?.balance ?? 0,
  }
}
export function getSupplierOutstandingPayable(supplierId: string) { return getSupplierLedgerSummary(supplierId).outstandingPayable }
