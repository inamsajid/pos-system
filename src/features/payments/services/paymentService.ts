import { customerService } from '../../customers/services/customerService'
import { getSales } from '../../pos/services/checkoutService'
import { money } from '../../pos/utils/checkoutCalculations'
import type { CustomerPayment, OutstandingInvoice, PaymentDraft, PaymentMethod } from '../types/payment.types'

const STORAGE_KEY = 'northstar.customer-payments.v1'

function loadPayments(): CustomerPayment[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(value) ? value as CustomerPayment[] : []
  } catch { return [] }
}

let records = loadPayments()
const copy = (payment: CustomerPayment): CustomerPayment => ({ ...payment, customerSnapshot: { ...payment.customerSnapshot }, methodBreakdown: payment.methodBreakdown.map(x => ({ ...x })), allocations: payment.allocations.map(x => ({ ...x })) })
function persist() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)) } catch { /* Keep the in-memory demo repository available if storage is unavailable. */ } }
function normalizeMethod(method: string): PaymentMethod {
  if (method === 'bank-transfer') return 'bank_transfer'
  if (method === 'cash' || method === 'card') return method
  return 'other'
}

/** Imports each completed POS sale's original received amount exactly once. */
export function syncPosPayments() {
  const known = new Set(records.map(payment => payment.id))
  let changed = false
  for (const sale of getSales()) {
    const id = `pos-${sale.id}`
    if (known.has(id) || sale.amountPaid <= 0) continue
    const methods = sale.payments.filter(payment => payment.method !== 'credit').map((payment, index) => ({
      id: `${id}-m${index + 1}`, method: normalizeMethod(payment.method), amount: money(payment.amount), reference: payment.reference,
    }))
    const difference = money(methods.reduce((sum, method) => sum + method.amount, 0) - sale.amountPaid)
    if (difference > 0) {
      let excess = difference
      for (let index = methods.length - 1; index >= 0 && excess > 0; index--) {
        if (methods[index].method !== 'cash') continue
        const reduction = Math.min(excess, methods[index].amount)
        methods[index].amount = money(methods[index].amount - reduction)
        excess = money(excess - reduction)
      }
    }
    const sum = money(methods.reduce((total, method) => total + method.amount, 0))
    if (sum !== sale.amountPaid && methods.length) methods[methods.length - 1].amount = money(methods[methods.length - 1].amount + sale.amountPaid - sum)
    const breakdown = methods.filter(method => method.amount > 0)
    const received = money(breakdown.reduce((total, method) => total + method.amount, 0))
    if (received <= 0) continue
    records.push({
      id, receiptNumber: `PAY-${sale.receiptNumber}`, customerId: sale.customerId,
      customerSnapshot: { name: sale.customerName, customerCode: sale.customerCode, phone: sale.customerPhone, address: sale.customerAddress },
      amount: received, methodBreakdown: breakdown,
      allocations: [{ saleId: sale.id, invoiceNumber: sale.invoiceNumber, amount: received }],
      unallocatedAmount: 0, source: 'pos_checkout', receivedAt: sale.createdAt, receivedBy: sale.cashierName, createdAt: sale.createdAt,
    })
    known.add(id)
    changed = true
  }
  if (changed) persist()
  return records.map(copy)
}

export function getPayments() { return syncPosPayments() }
export function getPaymentById(id: string) { return getPayments().find(payment => payment.id === id) }
export function getCustomerPayments(customerId: string) { return getPayments().filter(payment => payment.customerId === customerId) }
export function getInvoicePayments(saleId: string) { return getPayments().filter(payment => payment.allocations.some(allocation => allocation.saleId === saleId)) }

export function getOutstandingInvoices(customerId?: string): OutstandingInvoice[] {
  const paidBySale = new Map<string, number>()
  for (const payment of getPayments()) for (const allocation of payment.allocations) {
    paidBySale.set(allocation.saleId, money((paidBySale.get(allocation.saleId) ?? 0) + allocation.amount))
  }
  return getSales().filter(sale => sale.status === 'completed' && sale.customerId !== 'walk-in' && (!customerId || sale.customerId === customerId)).map(sale => {
    const amountPaid = paidBySale.get(sale.id) ?? 0
    return { saleId: sale.id, invoiceNumber: sale.invoiceNumber, date: sale.createdAt, customerId: sale.customerId, customerName: sale.customerName, totalAmount: sale.totalAmount, amountPaid, outstanding: money(Math.max(0, sale.totalAmount - amountPaid)) }
  }).filter(invoice => invoice.outstanding > 0)
}

export function getUnallocatedAdvance(customerId: string) {
  return money(getCustomerPayments(customerId).reduce((sum, payment) => sum + payment.unallocatedAmount, 0))
}

export async function createCustomerPayment(draft: PaymentDraft) {
  syncPosPayments()
  const customer = await customerService.getCustomerById(draft.customerId)
  if (!customer) throw Error('Select a customer.')
  if (customer.isWalkIn) throw Error('Walk-in Customer cannot receive account payments.')
  const amount = money(draft.amount)
  if (!Number.isFinite(draft.amount) || amount <= 0) throw Error('Payment amount must be greater than zero.')
  if (!draft.methodBreakdown.length) throw Error('Add at least one payment method.')
  const breakdownTotal = money(draft.methodBreakdown.reduce((sum, method) => sum + method.amount, 0))
  if (draft.methodBreakdown.some(method => !Number.isFinite(method.amount) || money(method.amount) <= 0) || breakdownTotal !== amount) throw Error('Payment methods must add up to the total received.')
  const allocated = money(draft.allocations.reduce((sum, allocation) => sum + allocation.amount, 0))
  if (draft.allocations.some(allocation => !Number.isFinite(allocation.amount) || money(allocation.amount) <= 0) || allocated > amount) throw Error('Invoice allocations must be positive and cannot exceed the payment amount.')
  const outstanding = getOutstandingInvoices(customer.id)
  const allocationsBySale = new Map<string, number>()
  for (const allocation of draft.allocations) {
    const invoice = outstanding.find(item => item.saleId === allocation.saleId && item.invoiceNumber === allocation.invoiceNumber && item.customerId === customer.id)
    if (!invoice) throw Error('An allocation references an invoice that is not outstanding for this customer.')
    const totalAllocated = money((allocationsBySale.get(allocation.saleId) ?? 0) + allocation.amount)
    if (totalAllocated > invoice.outstanding) throw Error(`${invoice.invoiceNumber} has only ${invoice.outstanding} remaining.`)
    allocationsBySale.set(allocation.saleId, totalAllocated)
  }
  const unallocated = money(amount - allocated)
  if (unallocated > 0 && !draft.keepAsAdvance) throw Error('Confirm that the unallocated amount should remain as customer advance.')
  const now = new Date().toISOString()
  const id = globalThis.crypto?.randomUUID?.() ?? `pay-${Date.now()}`
  const payment: CustomerPayment = {
    id, receiptNumber: `CP-${Date.now().toString().slice(-8)}-${id.slice(-5).toUpperCase()}`, customerId: customer.id,
    customerSnapshot: { name: customer.name, customerCode: customer.customerCode, phone: customer.phone, address: [customer.address, customer.city].filter(Boolean).join(', ') || undefined },
    amount, methodBreakdown: draft.methodBreakdown.map((method, index) => ({ ...method, amount: money(method.amount), id: `${id}-m${index + 1}` })),
    allocations: draft.allocations.map(allocation => ({ ...allocation, amount: money(allocation.amount) })), unallocatedAmount: unallocated,
    source: 'manual', receivedAt: draft.receivedAt, receivedBy: 'Ayesha Khan', notes: draft.notes?.trim() || undefined, createdAt: now,
  }
  records = [payment, ...records]
  persist()
  return copy(payment)
}

export function getPaymentStatistics() {
  const payments = getPayments()
  const invoices = getSales().filter(sale => sale.status === 'completed' && sale.customerId !== 'walk-in')
  return {
    totalReceived: money(payments.reduce((sum, payment) => sum + payment.amount, 0)), transactions: payments.length,
    outstanding: money(getOutstandingInvoices().reduce((sum, invoice) => sum + invoice.outstanding, 0)),
    advances: money(payments.reduce((sum, payment) => sum + payment.unallocatedAmount, 0)), invoiceCount: invoices.length,
  }
}

export function paymentSourceLabel(source: CustomerPayment['source']) { return source === 'pos_checkout' ? 'POS Checkout' : 'Manual Customer Payment' }
