import type { CheckoutSale } from '../../pos/types/checkout.types'
import { getInvoicePayments } from '../../payments/services/paymentService'
import { isWithinBusinessDateRange, getBusinessDatePreset } from '../../../lib/businessDate'

export type SalePaymentStatus = 'paid' | 'partial' | 'unpaid'

export function paidAmount(sale: CheckoutSale) {
  const localPaymentsPaid = Math.round((getInvoicePayments(sale.id).reduce((sum, p) => sum + p.allocations.filter(a => a.saleId === sale.id).reduce((n, a) => n + a.amount, 0), 0) + Number.EPSILON) * 100) / 100
  return Math.max(localPaymentsPaid, sale.amountPaid ?? 0)
}

export function getPaymentStatus(sale: CheckoutSale): SalePaymentStatus {
  const paid = paidAmount(sale)
  if (paid >= sale.totalAmount) return 'paid'
  if (paid > 0) return 'partial'
  return 'unpaid'
}

export function outstanding(sale: CheckoutSale) {
  return Math.max(0, Math.round((sale.totalAmount - paidAmount(sale) + Number.EPSILON) * 100) / 100)
}

export function getPaymentMethods(sale: CheckoutSale) {
  return [...new Set(getInvoicePayments(sale.id).flatMap(p => p.methodBreakdown.map(m => m.method)))]
}

export function saleMatchesDate(sale: CheckoutSale, range: string, from: string, to: string) {
  if (range === 'all') return true
  if (range === 'custom') {
    return isWithinBusinessDateRange(sale.createdAt, from, to)
  }
  const preset = getBusinessDatePreset(range)
  return isWithinBusinessDateRange(sale.createdAt, preset.from, preset.to)
}
