import { supplierService } from '../../suppliers/services/supplierService'
import { getPurchases } from '../../purchases/services/purchaseService'
import { money } from '../../pos/utils/checkoutCalculations'
import { apiClient } from '../../../lib/api-client'
import type { OutstandingPurchase, SupplierPayment, SupplierPaymentDraft } from '../types/supplierPayment.types'

const KEY = 'northstar.supplier-payments.v1'

function isExplicitDemo(): boolean {
  return import.meta.env?.VITE_DATA_SOURCE === 'mock'
}

function load(): SupplierPayment[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(value) ? (value as SupplierPayment[]) : []
  } catch {
    return []
  }
}

let payments = load()

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(payments))
  } catch {
    /* Keep the in-memory demo data available without browser storage. */
  }
}

function copy(payment: SupplierPayment): SupplierPayment {
  return {
    ...payment,
    supplierSnapshot: { ...payment.supplierSnapshot },
    methodBreakdown: payment.methodBreakdown.map((m) => ({ ...m })),
    allocations: payment.allocations.map((a) => ({ ...a })),
  }
}

interface WorkerSupplierPaymentDTO {
  id: string
  businessId: string
  branchId: string
  receiptNumber: string
  supplierId: string
  supplierName?: string
  supplierSnapshot?: {
    id: string
    supplierCode: string
    name: string
    companyName: string | null
    phone: string | null
    email: string | null
  }
  amountMinor: number
  unallocatedAmountMinor: number
  method: string
  reference: string | null
  paymentMethods?: Array<{
    id?: string
    paymentId?: string
    method: string
    amountMinor: number
    reference?: string | null
  }>
  notes: string | null
  paidBy: string
  paidByName?: string
  paidAt: string
  createdAt: string
  allocations?: Array<{
    id: string
    paymentId: string
    purchaseId: string
    purchaseNumber: string
    amountMinor: number
    allocatedAt: string
  }>
}

function mapWorkerPaymentToSupplierPayment(dto: WorkerSupplierPaymentDTO): SupplierPayment {
  return {
    id: dto.id,
    receiptNumber: dto.receiptNumber,
    supplierId: dto.supplierId,
    supplierSnapshot: {
      name: dto.supplierSnapshot?.name || dto.supplierName || 'Supplier',
      supplierCode: dto.supplierSnapshot?.supplierCode || 'SUP',
      companyName: dto.supplierSnapshot?.companyName ?? undefined,
    },
    amount: dto.amountMinor / 100,
    methodBreakdown: (dto.paymentMethods && dto.paymentMethods.length > 0)
      ? dto.paymentMethods.map((m, idx) => ({
          id: `${dto.id}-m${idx + 1}`,
          method: (m.method === 'bank_transfer' ? 'bank-transfer' : m.method) as any,
          amount: m.amountMinor / 100,
          reference: m.reference ?? undefined,
        }))
      : [
          {
            id: `${dto.id}-m1`,
            method: (dto.method === 'bank_transfer' ? 'bank-transfer' : dto.method) as any,
            amount: dto.amountMinor / 100,
            reference: dto.reference ?? undefined,
          },
        ],
    allocations: (dto.allocations || []).map((a) => ({
      purchaseId: a.purchaseId,
      purchaseNumber: a.purchaseNumber,
      amount: a.amountMinor / 100,
    })),
    unallocatedAmount: dto.unallocatedAmountMinor / 100,
    paidAt: dto.paidAt,
    paidBy: dto.paidByName || dto.paidBy || 'Staff',
    notes: dto.notes ?? undefined,
    createdAt: dto.createdAt,
  }
}

export async function fetchSupplierPayments(): Promise<SupplierPayment[]> {
  if (!isExplicitDemo()) {
    const res = await apiClient.get<{ items: WorkerSupplierPaymentDTO[] } | WorkerSupplierPaymentDTO[]>('/supplier-payments?limit=100')
    const list = Array.isArray(res) ? res : res.items || []
    const mapped = list.map(mapWorkerPaymentToSupplierPayment)
    payments = mapped
    return mapped.map(copy)
  }
  return getSupplierPayments()
}

export function getSupplierPayments() {
  return payments.map(copy).sort((a, b) => b.paidAt.localeCompare(a.paidAt))
}

export function getSupplierPaymentById(id: string) {
  const payment = payments.find((item) => item.id === id)
  return payment ? copy(payment) : undefined
}

export function getPaymentsForSupplier(supplierId: string) {
  return getSupplierPayments().filter((payment) => payment.supplierId === supplierId)
}

export function getPaymentsForPurchase(purchaseId: string) {
  return getSupplierPayments().filter((payment) =>
    payment.allocations.some((allocation) => allocation.purchaseId === purchaseId)
  )
}

export async function fetchSupplierOutstandingPurchases(supplierId?: string): Promise<OutstandingPurchase[]> {
  if (!isExplicitDemo()) {
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (supplierId) params.set('supplierId', supplierId)
      const res = await apiClient.get<{ items: any[] } | any[]>(`/purchases?${params.toString()}`)
      const list = Array.isArray(res) ? res : res.items || []
      return list
        .filter((p: any) => !['draft', 'cancelled'].includes(p.status) && (p.totalAmountMinor > (p.paidAmountMinor || 0)))
        .map((p: any) => ({
          purchaseId: p.id,
          purchaseNumber: p.purchaseNumber,
          supplierInvoiceNumber: p.supplierInvoiceNumber || undefined,
          date: p.purchaseDate || p.purchaseDateKey || p.createdAt,
          supplierId: p.supplierId,
          supplierName: p.supplierSnapshot?.name || p.supplierName || 'Supplier',
          totalAmount: p.totalAmountMinor / 100,
          amountPaid: (p.paidAmountMinor || 0) / 100,
          outstanding: (p.totalAmountMinor - (p.paidAmountMinor || 0)) / 100,
        }))
    } catch {
      return getSupplierOutstandingPurchases(supplierId)
    }
  }
  return getSupplierOutstandingPurchases(supplierId)
}

export function getSupplierOutstandingPurchases(supplierId?: string): OutstandingPurchase[] {
  const paid = new Map<string, number>()
  for (const payment of payments)
    for (const allocation of payment.allocations)
      paid.set(allocation.purchaseId, money((paid.get(allocation.purchaseId) ?? 0) + allocation.amount))
  return getPurchases()
    .filter((purchase) => !['draft', 'cancelled'].includes(purchase.status) && (!supplierId || purchase.supplierId === supplierId))
    .map((purchase) => {
      const amountPaid = paid.get(purchase.id) ?? 0
      return {
        purchaseId: purchase.id,
        purchaseNumber: purchase.purchaseNumber,
        supplierInvoiceNumber: purchase.supplierInvoiceNumber,
        date: purchase.purchaseDate,
        supplierId: purchase.supplierId,
        supplierName: purchase.supplierSnapshot.name,
        totalAmount: purchase.totalAmount,
        amountPaid,
        outstanding: money(Math.max(0, purchase.totalAmount - amountPaid)),
      }
    })
    .filter((purchase) => purchase.outstanding > 0)
}

export function getSupplierAdvanceBalance(supplierId: string) {
  return money(
    payments
      .filter((p) => p.supplierId === supplierId)
      .reduce((sum, payment) => sum + payment.unallocatedAmount, 0)
  )
}

export async function createSupplierPayment(draft: SupplierPaymentDraft) {
  const previous = draft.requestId ? payments.find((payment) => payment.requestId === draft.requestId) : undefined
  if (previous) return copy(previous)

  if (!isExplicitDemo()) {
    const rawMethod = (draft.methodBreakdown[0]?.method as string) || 'cash'
    const method = rawMethod === 'bank-transfer' || rawMethod === 'bank_transfer' ? 'bank_transfer' : rawMethod
    const payload = {
      supplierId: draft.supplierId,
      amountMinor: Math.round(draft.amount * 100),
      method: method as any,
      reference: draft.methodBreakdown[0]?.reference || null,
      paymentMethods: draft.methodBreakdown.map((m) => {
        const raw = m.method as string
        const norm = raw === 'bank-transfer' || raw === 'bank_transfer' ? 'bank_transfer' : raw
        return {
          method: norm as any,
          amountMinor: Math.round(m.amount * 100),
          reference: m.reference?.trim() || null,
        }
      }),
      notes: draft.notes?.trim() || null,
      allocations: draft.allocations.map((a) => ({
        purchaseId: a.purchaseId,
        amountMinor: Math.round(a.amount * 100),
      })),
    }

    const dto = await apiClient.post<WorkerSupplierPaymentDTO>('/supplier-payments', payload)
    const payment = mapWorkerPaymentToSupplierPayment(dto)
    payments = [payment, ...payments.filter((p) => p.id !== payment.id)]
    persist()
    return copy(payment)
  }

  const supplier = await supplierService.getSupplierById(draft.supplierId)
  if (!supplier || supplier.status !== 'active') throw new Error('Select an active supplier.')
  const amount = money(draft.amount)
  if (!Number.isFinite(draft.amount) || amount <= 0) throw new Error('Payment amount must be greater than zero.')
  if (
    !draft.methodBreakdown.length ||
    draft.methodBreakdown.some((method) => !Number.isFinite(method.amount) || money(method.amount) <= 0) ||
    money(draft.methodBreakdown.reduce((sum, method) => sum + method.amount, 0)) !== amount
  )
    throw new Error('Payment methods must add up to the total payment.')
  const allocated = money(draft.allocations.reduce((sum, allocation) => sum + allocation.amount, 0))
  if (
    draft.allocations.some((allocation) => !Number.isFinite(allocation.amount) || money(allocation.amount) <= 0) ||
    allocated > amount
  )
    throw new Error('Purchase allocations must be positive and cannot exceed the payment.')
  const outstanding = getSupplierOutstandingPurchases(supplier.id)
  const allocatedByPurchase = new Map<string, number>()
  for (const allocation of draft.allocations) {
    const purchase = outstanding.find(
      (item) => item.purchaseId === allocation.purchaseId && item.purchaseNumber === allocation.purchaseNumber && item.supplierId === supplier.id
    )
    if (!purchase) throw new Error('An allocation must reference a confirmed outstanding purchase for this supplier.')
    const total = money((allocatedByPurchase.get(allocation.purchaseId) ?? 0) + allocation.amount)
    if (total > purchase.outstanding)
      throw new Error(`${purchase.purchaseNumber} has only ${formatAmount(purchase.outstanding)} remaining.`)
    allocatedByPurchase.set(allocation.purchaseId, total)
  }
  const unallocatedAmount = money(amount - allocated)
  if (unallocatedAmount > 0 && !draft.keepAsAdvance)
    throw new Error('Confirm that the unallocated amount should remain as supplier advance.')
  const now = new Date().toISOString()
  const id = globalThis.crypto?.randomUUID?.() ?? `sp-${Date.now()}`
  const payment: SupplierPayment = {
    id,
    requestId: draft.requestId,
    receiptNumber: `SP-${Date.now().toString().slice(-8)}-${id.slice(-5).toUpperCase()}`,
    supplierId: supplier.id,
    supplierSnapshot: {
      name: supplier.name,
      supplierCode: supplier.supplierCode,
      companyName: supplier.companyName,
    },
    amount,
    methodBreakdown: draft.methodBreakdown.map((method, index) => ({
      ...method,
      amount: money(method.amount),
      id: `${id}-m${index + 1}`,
    })),
    allocations: draft.allocations.map((allocation) => ({ ...allocation, amount: money(allocation.amount) })),
    unallocatedAmount,
    paidAt: draft.paidAt,
    paidBy: 'Staff Member',
    notes: draft.notes?.trim() || undefined,
    createdAt: now,
  }
  payments = [payment, ...payments]
  persist()
  return copy(payment)
}

function formatAmount(value: number) {
  return value.toLocaleString('en-PK', { maximumFractionDigits: 2 })
}

export function getSupplierPaymentStatistics() {
  return {
    totalPaid: money(payments.reduce((sum, payment) => sum + payment.amount, 0)),
    transactions: payments.length,
    outstanding: money(getSupplierOutstandingPurchases().reduce((sum, purchase) => sum + purchase.outstanding, 0)),
    advances: money(payments.reduce((sum, payment) => sum + payment.unallocatedAmount, 0)),
  }
}
