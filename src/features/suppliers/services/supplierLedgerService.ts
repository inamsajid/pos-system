import { supplierFinancialMockData } from '../data/supplierMockData'
import type { SupplierFinancialSummary, SupplierTransaction } from '../types/supplier.types'
import { getPurchases } from '../../purchases/services/purchaseService'
import { getPaymentsForSupplier, getSupplierOutstandingPurchases, getSupplierAdvanceBalance } from '../../supplier-payments/services/supplierPaymentService'
import { money } from '../../pos/utils/checkoutCalculations'
import { apiClient } from '../../../lib/api-client'

function isExplicitDemo(): boolean {
  return import.meta.env?.VITE_DATA_SOURCE === 'mock'
}

export type SupplierLedgerEntry = SupplierTransaction & {
  type: 'opening' | 'purchase' | 'bill' | 'payment' | 'debit_note' | 'adjustment'
  purchaseId?: string
  paymentId?: string
}

interface WorkerSupplierLedgerEntryDTO {
  id: string
  businessId: string
  branchId: string
  supplierId: string
  type: 'opening' | 'bill' | 'payment' | 'debit_note' | 'adjustment'
  referenceId: string
  referenceNumber: string
  description: string
  debitMinor: number
  creditMinor: number
  balanceMinor: number
  createdAt: string
}

interface WorkerSupplierLedgerStatementDTO {
  supplierId: string
  supplierName: string
  openingBalanceMinor: number
  closingBalanceMinor: number
  totalDebitsMinor: number
  totalCreditsMinor: number
  netChangeMinor: number
  entries: WorkerSupplierLedgerEntryDTO[]
}

interface WorkerSupplierFinancialSummaryDTO {
  supplierId: string
  supplierName: string
  openingPayableMinor: number
  currentPayableMinor: number
  totalBilledMinor: number
  totalPaidMinor: number
  openPurchasesCount: number
  earliestUnpaidPurchaseDate: string | null
}

function openingFor(supplierId: string) {
  return supplierFinancialMockData.find((summary) => summary.supplierId === supplierId)?.openingPayable ?? 0
}

export function getSupplierLedger(supplierId: string): SupplierLedgerEntry[] {
  const purchases = getPurchases().filter((purchase) => purchase.supplierId === supplierId && !['draft', 'cancelled'].includes(purchase.status))
  const payments = getPaymentsForSupplier(supplierId)
  const dates = [...purchases.map((purchase) => purchase.confirmedAt ?? purchase.purchaseDate), ...payments.map((payment) => payment.paidAt)].sort()
  const entries: SupplierLedgerEntry[] = []
  const opening = openingFor(supplierId)
  if (opening > 0)
    entries.push({
      id: `opening-${supplierId}`,
      supplierId,
      date: dates[0] ?? new Date(0).toISOString(),
      reference: 'OPENING',
      description: 'Opening payable',
      debit: 0,
      credit: opening,
      balance: 0,
      type: 'opening',
    })
  for (const purchase of purchases)
    entries.push({
      id: `purchase-${purchase.id}`,
      supplierId,
      date: purchase.confirmedAt ?? purchase.purchaseDate,
      reference: purchase.purchaseNumber,
      description: `Purchase bill${purchase.supplierInvoiceNumber ? ` · supplier invoice ${purchase.supplierInvoiceNumber}` : ''}`,
      debit: 0,
      credit: purchase.totalAmount,
      balance: 0,
      type: 'purchase',
      purchaseId: purchase.id,
    })
  for (const payment of payments)
    entries.push({
      id: `payment-${payment.id}`,
      supplierId,
      date: payment.paidAt,
      reference: payment.receiptNumber,
      description: `Supplier payment · ${payment.methodBreakdown.map((method) => method.method).join(', ')}`,
      debit: payment.amount,
      credit: 0,
      balance: 0,
      type: 'payment',
      paymentId: payment.id,
    })
  const typeOrder: Record<string, number> = { opening: 0, purchase: 1, payment: 2, bill: 3, debit_note: 4, adjustment: 5 }
  entries.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99) ||
      a.id.localeCompare(b.id)
  )
  let balance = 0
  return entries.map((entry) => {
    balance = money(balance + entry.credit - entry.debit)
    return { ...entry, balance }
  })
}

export function getSupplierLedgerSummary(
  supplierId: string
): SupplierFinancialSummary & { currentAccountBalance: number } {
  const purchases = getPurchases().filter((purchase) => purchase.supplierId === supplierId && !['draft', 'cancelled'].includes(purchase.status))
  const payments = getPaymentsForSupplier(supplierId)
  const ledger = getSupplierLedger(supplierId)
  return {
    supplierId,
    totalPurchases: money(purchases.reduce((sum, purchase) => sum + purchase.totalAmount, 0)),
    totalPaid: money(payments.reduce((sum, payment) => sum + payment.amount, 0)),
    outstandingPayable: money(
      openingFor(supplierId) + getSupplierOutstandingPurchases(supplierId).reduce((sum, purchase) => sum + purchase.outstanding, 0)
    ),
    advanceBalance: getSupplierAdvanceBalance(supplierId),
    openingPayable: openingFor(supplierId),
    lastPurchaseDate: purchases.map((purchase) => purchase.purchaseDate).sort().at(-1),
    currentAccountBalance: ledger.at(-1)?.balance ?? 0,
  }
}

export async function fetchSupplierLedger(supplierId: string): Promise<SupplierLedgerEntry[]> {
  if (!isExplicitDemo()) {
    const statement = await apiClient.get<WorkerSupplierLedgerStatementDTO>(`/suppliers/${supplierId}/ledger`)
    return (statement.entries || []).map((entry) => ({
      id: entry.id,
      supplierId: entry.supplierId,
      date: entry.createdAt,
      reference: entry.referenceNumber,
      description: entry.description,
      debit: entry.debitMinor / 100,
      credit: entry.creditMinor / 100,
      balance: entry.balanceMinor / 100,
      type: entry.type === 'bill' ? 'purchase' : (entry.type as any),
      purchaseId: entry.type === 'bill' ? entry.referenceId : undefined,
      paymentId: entry.type === 'payment' ? entry.referenceId : undefined,
    }))
  }
  return getSupplierLedger(supplierId)
}

export async function fetchSupplierLedgerSummary(
  supplierId: string
): Promise<SupplierFinancialSummary & { currentAccountBalance: number }> {
  if (!isExplicitDemo()) {
    const dto = await apiClient.get<WorkerSupplierFinancialSummaryDTO>(`/suppliers/${supplierId}/ledger/summary`)
    return {
      supplierId: dto.supplierId,
      totalPurchases: dto.totalBilledMinor / 100,
      totalPaid: dto.totalPaidMinor / 100,
      outstandingPayable: dto.currentPayableMinor / 100,
      advanceBalance: ((dto as any).unallocatedAdvanceMinor ?? 0) / 100,
      openingPayable: dto.openingPayableMinor / 100,
      lastPurchaseDate: dto.earliestUnpaidPurchaseDate || undefined,
      currentAccountBalance: dto.currentPayableMinor / 100,
    }
  }
  return getSupplierLedgerSummary(supplierId)
}

export function getSupplierOutstandingPayable(supplierId: string) {
  return getSupplierLedgerSummary(supplierId).outstandingPayable
}
