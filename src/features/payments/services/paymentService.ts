import { customerService } from '../../customers/services/customerService'
import { getSales } from '../../pos/services/checkoutService'
import { money } from '../../pos/utils/checkoutCalculations'
import { apiClient } from '../../../lib/api-client'
import type { CustomerPayment, OutstandingInvoice, PaymentDraft, PaymentMethod } from '../types/payment.types'

const STORAGE_KEY = 'northstar.customer-payments.v1'

function isExplicitDemo(): boolean {
  return import.meta.env?.VITE_DATA_SOURCE === 'mock'
}

function loadPayments(): CustomerPayment[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(value) ? (value as CustomerPayment[]) : []
  } catch {
    return []
  }
}

let records = loadPayments()
const copy = (payment: CustomerPayment): CustomerPayment => ({
  ...payment,
  customerSnapshot: { ...payment.customerSnapshot },
  methodBreakdown: payment.methodBreakdown.map((x) => ({ ...x })),
  allocations: payment.allocations.map((x) => ({ ...x })),
})

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  } catch {
    /* Keep the in-memory demo repository available if storage is unavailable. */
  }
}

function normalizeMethod(method: string): PaymentMethod {
  if (method === 'bank-transfer' || method === 'bank_transfer') return 'bank_transfer'
  if (method === 'cash' || method === 'card' || method === 'digital_wallet') return method
  return 'other'
}

interface WorkerCustomerPaymentDTO {
  id: string
  businessId: string
  branchId: string
  receiptNumber: string
  customerId: string
  customerName?: string
  customerSnapshot?: {
    name?: string
    customerCode?: string
    phone?: string | null
    address?: string | null
    city?: string | null
  }
  amountMinor: number
  unallocatedAmountMinor: number
  source: string
  notes: string | null
  receivedBy?: string
  receivedByName?: string
  receivedAt: string
  createdAt: string
  paymentMethods?: Array<{
    method: string
    amountMinor: number
    reference?: string | null
  }>
  allocations?: Array<{
    id: string
    paymentId: string
    saleId: string
    invoiceNumber: string
    amountMinor: number
    allocatedAt: string
  }>
}

function mapDtoToCustomerPayment(dto: WorkerCustomerPaymentDTO): CustomerPayment {
  return {
    id: dto.id,
    receiptNumber: dto.receiptNumber,
    customerId: dto.customerId,
    customerSnapshot: {
      name: dto.customerSnapshot?.name || dto.customerName || 'Customer',
      customerCode: dto.customerSnapshot?.customerCode,
      phone: dto.customerSnapshot?.phone ?? undefined,
      address: [dto.customerSnapshot?.address, dto.customerSnapshot?.city].filter(Boolean).join(', ') || undefined,
    },
    amount: dto.amountMinor / 100,
    methodBreakdown: (dto.paymentMethods || []).map((m, idx) => ({
      id: `${dto.id}-m${idx + 1}`,
      method: normalizeMethod(m.method),
      amount: m.amountMinor / 100,
      reference: m.reference ?? undefined,
    })),
    allocations: (dto.allocations || []).map((a) => ({
      saleId: a.saleId,
      invoiceNumber: a.invoiceNumber,
      amount: a.amountMinor / 100,
    })),
    unallocatedAmount: dto.unallocatedAmountMinor / 100,
    source: (dto.source as CustomerPayment['source']) || 'manual',
    receivedAt: dto.receivedAt,
    receivedBy: dto.receivedByName || dto.receivedBy || 'Staff',
    notes: dto.notes ?? undefined,
    createdAt: dto.createdAt,
  }
}

/** Imports each completed POS sale's original received amount exactly once. */
export function syncPosPayments() {
  const known = new Set(records.map((payment) => payment.id))
  let changed = false
  for (const sale of getSales()) {
    const id = `pos-${sale.id}`
    if (known.has(id) || sale.amountPaid <= 0) continue
    const methods = sale.payments
      .filter((payment) => payment.method !== 'credit')
      .map((payment, index) => ({
        id: `${id}-m${index + 1}`,
        method: normalizeMethod(payment.method),
        amount: money(payment.amount),
        reference: payment.reference,
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
    if (sum !== sale.amountPaid && methods.length)
      methods[methods.length - 1].amount = money(methods[methods.length - 1].amount + sale.amountPaid - sum)
    const breakdown = methods.filter((method) => method.amount > 0)
    const received = money(breakdown.reduce((total, method) => total + method.amount, 0))
    if (received <= 0) continue
    records.push({
      id,
      receiptNumber: `PAY-${sale.receiptNumber}`,
      customerId: sale.customerId,
      customerSnapshot: {
        name: sale.customerName,
        customerCode: sale.customerCode,
        phone: sale.customerPhone,
        address: sale.customerAddress,
      },
      amount: received,
      methodBreakdown: breakdown,
      allocations: [{ saleId: sale.id, invoiceNumber: sale.invoiceNumber, amount: received }],
      unallocatedAmount: 0,
      source: 'pos_checkout',
      receivedAt: sale.createdAt,
      receivedBy: sale.cashierName,
      createdAt: sale.createdAt,
    })
    known.add(id)
    changed = true
  }
  if (changed) persist()
  return records.map(copy)
}

export async function fetchCustomerPayments(): Promise<CustomerPayment[]> {
  if (!isExplicitDemo()) {
    const res = await apiClient.get<{ items: WorkerCustomerPaymentDTO[] } | WorkerCustomerPaymentDTO[]>('/customer-payments?limit=100')
    const list = Array.isArray(res) ? res : res.items || []
    const mapped = list.map(mapDtoToCustomerPayment)
    records = mapped
    return mapped.map(copy)
  }
  return getPayments()
}

export async function fetchPaymentById(id: string): Promise<CustomerPayment | null> {
  if (!isExplicitDemo()) {
    try {
      const dto = await apiClient.get<WorkerCustomerPaymentDTO>(`/customer-payments/${id}`)
      const mapped = mapDtoToCustomerPayment(dto)
      records = [mapped, ...records.filter((r) => r.id !== mapped.id)]
      persist()
      return copy(mapped)
    } catch {
      return getPaymentById(id) ?? null
    }
  }
  return getPaymentById(id) ?? null
}

export function getPayments() {
  return syncPosPayments()
}
export function getPaymentById(id: string) {
  return getPayments().find((payment) => payment.id === id)
}
export function getCustomerPayments(customerId: string) {
  return getPayments().filter((payment) => payment.customerId === customerId)
}
export function getInvoicePayments(saleId: string) {
  return getPayments().filter((payment) => payment.allocations.some((allocation) => allocation.saleId === saleId))
}

export async function fetchOutstandingInvoices(customerId?: string): Promise<OutstandingInvoice[]> {
  if (!isExplicitDemo()) {
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (customerId) params.set('customerId', customerId)
      const res = await apiClient.get<{ items: Array<{ id: string; saleId: string; invoiceNumber: string; businessDateKey?: string; createdAt: string; customerId: string; customerName?: string; totalAmountMinor: number; paidAmountMinor: number; remainingAmountMinor: number; status: string }> } | any[]>(`/invoices?${params.toString()}`)
      const list = Array.isArray(res) ? res : res.items || []
      return list
        .filter((inv) => inv.status !== 'voided' && inv.remainingAmountMinor > 0)
        .map((inv) => ({
          invoiceId: inv.id,
          saleId: inv.saleId || inv.id,
          invoiceNumber: inv.invoiceNumber,
          date: inv.businessDateKey || inv.createdAt,
          customerId: inv.customerId,
          customerName: inv.customerName || 'Customer',
          totalAmount: inv.totalAmountMinor / 100,
          amountPaid: inv.paidAmountMinor / 100,
          outstanding: inv.remainingAmountMinor / 100,
        }))
    } catch {
      return getOutstandingInvoices(customerId)
    }
  }
  return getOutstandingInvoices(customerId)
}

export function getOutstandingInvoices(customerId?: string): OutstandingInvoice[] {
  const paidBySale = new Map<string, number>()
  for (const payment of getPayments())
    for (const allocation of payment.allocations) {
      paidBySale.set(allocation.saleId, money((paidBySale.get(allocation.saleId) ?? 0) + allocation.amount))
    }
  return getSales()
    .filter((sale) => sale.status === 'completed' && sale.customerId !== 'walk-in' && (!customerId || sale.customerId === customerId))
    .map((sale) => {
      const amountPaid = paidBySale.get(sale.id) ?? 0
      return {
        saleId: sale.id,
        invoiceNumber: sale.invoiceNumber,
        date: sale.createdAt,
        customerId: sale.customerId,
        customerName: sale.customerName,
        totalAmount: sale.totalAmount,
        amountPaid,
        outstanding: money(Math.max(0, sale.totalAmount - amountPaid)),
      }
    })
    .filter((invoice) => invoice.outstanding > 0)
}

export function getUnallocatedAdvance(customerId: string) {
  return money(getCustomerPayments(customerId).reduce((sum, payment) => sum + payment.unallocatedAmount, 0))
}

export async function createCustomerPayment(draft: PaymentDraft) {
  if (!isExplicitDemo()) {
    const payload = {
      customerId: draft.customerId,
      amountMinor: Math.round(draft.amount * 100),
      paymentMethods: draft.methodBreakdown.map((m) => ({
        method: normalizeMethod(m.method),
        amountMinor: Math.round(m.amount * 100),
        reference: m.reference || null,
      })),
      allocations: draft.allocations.map((a) => ({
        invoiceId: a.invoiceId || a.saleId,
        amountMinor: Math.round(a.amount * 100),
      })),
      notes: draft.notes?.trim() || null,
    }
    const dto = await apiClient.post<WorkerCustomerPaymentDTO>('/customer-payments', payload)
    const payment = mapDtoToCustomerPayment(dto)
    records = [payment, ...records.filter((r) => r.id !== payment.id)]
    persist()
    return copy(payment)
  }

  syncPosPayments()
  const customer = await customerService.getCustomerById(draft.customerId)
  if (!customer) throw new Error('Select a customer.')
  if (customer.isWalkIn) throw new Error('Walk-in Customer cannot receive account payments.')
  const amount = money(draft.amount)
  if (!Number.isFinite(draft.amount) || amount <= 0) throw new Error('Payment amount must be greater than zero.')
  if (!draft.methodBreakdown.length) throw new Error('Add at least one payment method.')
  const breakdownTotal = money(draft.methodBreakdown.reduce((sum, method) => sum + method.amount, 0))
  if (
    draft.methodBreakdown.some((method) => !Number.isFinite(method.amount) || money(method.amount) <= 0) ||
    breakdownTotal !== amount
  )
    throw new Error('Payment methods must add up to the total received.')
  const allocated = money(draft.allocations.reduce((sum, allocation) => sum + allocation.amount, 0))
  if (
    draft.allocations.some((allocation) => !Number.isFinite(allocation.amount) || money(allocation.amount) <= 0) ||
    allocated > amount
  )
    throw new Error('Invoice allocations must be positive and cannot exceed the payment amount.')
  const outstanding = getOutstandingInvoices(customer.id)
  const allocationsBySale = new Map<string, number>()
  for (const allocation of draft.allocations) {
    const invoice = outstanding.find(
      (item) => item.saleId === allocation.saleId && item.invoiceNumber === allocation.invoiceNumber && item.customerId === customer.id
    )
    if (!invoice) throw new Error('An allocation references an invoice that is not outstanding for this customer.')
    const totalAllocated = money((allocationsBySale.get(allocation.saleId) ?? 0) + allocation.amount)
    if (totalAllocated > invoice.outstanding)
      throw new Error(`${invoice.invoiceNumber} has only ${invoice.outstanding} remaining.`)
    allocationsBySale.set(allocation.saleId, totalAllocated)
  }
  const unallocated = money(amount - allocated)
  if (unallocated > 0 && !draft.keepAsAdvance)
    throw new Error('Confirm that the unallocated amount should remain as customer advance.')
  const now = new Date().toISOString()
  const id = globalThis.crypto?.randomUUID?.() ?? `pay-${Date.now()}`
  const payment: CustomerPayment = {
    id,
    receiptNumber: `CP-${Date.now().toString().slice(-8)}-${id.slice(-5).toUpperCase()}`,
    customerId: customer.id,
    customerSnapshot: {
      name: customer.name,
      customerCode: customer.customerCode,
      phone: customer.phone,
      address: [customer.address, customer.city].filter(Boolean).join(', ') || undefined,
    },
    amount,
    methodBreakdown: draft.methodBreakdown.map((method, index) => ({
      ...method,
      amount: money(method.amount),
      id: `${id}-m${index + 1}`,
    })),
    allocations: draft.allocations.map((allocation) => ({ ...allocation, amount: money(allocation.amount) })),
    unallocatedAmount: unallocated,
    source: 'manual',
    receivedAt: draft.receivedAt,
    receivedBy: 'Staff Member',
    notes: draft.notes?.trim() || undefined,
    createdAt: now,
  }
  records = [payment, ...records]
  persist()
  return copy(payment)
}

export function getPaymentStatistics() {
  const payments = getPayments()
  const invoices = getSales().filter((sale) => sale.status === 'completed' && sale.customerId !== 'walk-in')
  return {
    totalReceived: money(payments.reduce((sum, payment) => sum + payment.amount, 0)),
    transactions: payments.length,
    outstanding: money(getOutstandingInvoices().reduce((sum, invoice) => sum + invoice.outstanding, 0)),
    advances: money(payments.reduce((sum, payment) => sum + payment.unallocatedAmount, 0)),
    invoiceCount: invoices.length,
  }
}

export function paymentSourceLabel(source: CustomerPayment['source']) {
  return source === 'pos_checkout' ? 'POS Checkout' : 'Manual Customer Payment'
}
