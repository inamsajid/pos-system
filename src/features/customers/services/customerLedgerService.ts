import { financialMockData } from '../data/customerMockData'
import type { CustomerFinancialSummary, AccountTransaction } from '../types/customer.types'
import { getSales } from '../../pos/services/checkoutService'
import { getCustomerPayments, getOutstandingInvoices, getUnallocatedAdvance } from '../../payments/services/paymentService'
import { money } from '../../pos/utils/checkoutCalculations'
import { apiClient } from '../../../lib/api-client'

function isExplicitDemo(): boolean {
  return import.meta.env?.VITE_DATA_SOURCE === 'mock'
}

export type LedgerEntry = AccountTransaction & {
  type: 'opening' | 'invoice' | 'payment' | 'credit_note' | 'void' | 'adjustment'
  invoiceNumber?: string
  paymentId?: string
}

interface WorkerLedgerEntryDTO {
  id: string
  businessId: string
  branchId: string
  customerId: string
  type: 'opening' | 'invoice' | 'payment' | 'credit_note' | 'void' | 'adjustment'
  referenceId: string
  referenceNumber: string
  description: string
  debitMinor: number
  creditMinor: number
  balanceMinor: number
  createdAt: string
}

interface WorkerLedgerStatementDTO {
  customerId: string
  customerCode: string
  customerName: string
  openingBalanceMinor: number
  closingBalanceMinor: number
  totalDebitsMinor: number
  totalCreditsMinor: number
  netChangeMinor: number
  entries: WorkerLedgerEntryDTO[]
}

interface WorkerCustomerFinancialSummaryDTO {
  customerId: string
  customerCode: string
  customerName: string
  openingBalanceMinor: number
  currentBalanceMinor: number
  creditLimitMinor: number
  availableCreditMinor: number
  totalInvoicedMinor: number
  totalPaidMinor: number
  openInvoicesCount: number
  earliestUnpaidInvoiceDate: string | null
}

export function getCustomerLedger(customerId: string): LedgerEntry[] {
  if (customerId === 'walk-in') return []
  const opening = financialMockData.find((x) => x.customerId === customerId)?.openingBalance ?? 0
  const entries: LedgerEntry[] = []
  const customerSale = getSales().filter((s) => s.customerId === customerId && s.status === 'completed')
  const customerPayments = getCustomerPayments(customerId)
  const transactionDates = [...customerSale.map((s) => s.createdAt), ...customerPayments.map((p) => p.receivedAt)]
  const initialDate = transactionDates.sort()[0] ?? new Date(0).toISOString()
  if (opening > 0)
    entries.push({
      id: `opening-${customerId}`,
      customerId,
      date: initialDate,
      reference: 'OPENING',
      description: 'Opening balance',
      debit: opening,
      credit: 0,
      balance: 0,
      type: 'opening',
    })
  for (const sale of customerSale)
    entries.push({
      id: `invoice-${sale.id}`,
      customerId,
      date: sale.createdAt,
      reference: sale.invoiceNumber,
      description: `Sales invoice ${sale.invoiceNumber}`,
      debit: sale.totalAmount,
      credit: 0,
      balance: 0,
      type: 'invoice',
      invoiceNumber: sale.invoiceNumber,
    })
  for (const payment of customerPayments)
    entries.push({
      id: `payment-${payment.id}`,
      customerId,
      date: payment.receivedAt,
      reference: payment.receiptNumber,
      description: `Customer payment · ${payment.methodBreakdown.map((m) => m.method).join(', ')}`,
      debit: 0,
      credit: payment.amount,
      balance: 0,
      type: 'payment',
      paymentId: payment.id,
    })
  const typeOrder: Record<string, number> = { opening: 0, invoice: 1, payment: 2, credit_note: 3, adjustment: 4, void: 5 }
  entries.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99) ||
      a.id.localeCompare(b.id)
  )
  let balance = 0
  return entries.map((e) => {
    balance = money(balance + e.debit - e.credit)
    return { ...e, balance }
  })
}

export function getCustomerLedgerSummary(customerId: string): CustomerFinancialSummary {
  if (customerId === 'walk-in')
    return {
      customerId,
      totalPurchases: 0,
      totalPaid: 0,
      outstandingBalance: 0,
      advanceBalance: 0,
      openingBalance: 0,
      currentAccountBalance: 0,
    }
  const sales = getSales().filter((s) => s.customerId === customerId && s.status === 'completed')
  const ledger = getCustomerLedger(customerId)
  const outstanding = money(getOutstandingInvoices(customerId).reduce((n, i) => n + i.outstanding, 0))
  const totalPurchases = money(sales.reduce((n, s) => n + s.totalAmount, 0))
  const payments = getCustomerPayments(customerId)
  const lastPurchaseDate = sales.map((s) => s.createdAt).sort().at(-1)
  return {
    customerId,
    totalPurchases,
    totalPaid: money(payments.reduce((n, p) => n + p.amount, 0)),
    outstandingBalance: outstanding,
    advanceBalance: getUnallocatedAdvance(customerId),
    openingBalance: ledger.find((e) => e.type === 'opening')?.debit ?? 0,
    currentAccountBalance: ledger.at(-1)?.balance ?? 0,
    lastPurchaseDate,
  }
}

export async function fetchCustomerLedger(customerId: string): Promise<LedgerEntry[]> {
  if (!isExplicitDemo()) {
    if (customerId === 'walk-in') return []
    const statement = await apiClient.get<WorkerLedgerStatementDTO>(`/customers/${customerId}/ledger`)
    return (statement.entries || []).map((entry) => ({
      id: entry.id,
      customerId: entry.customerId,
      date: entry.createdAt,
      reference: entry.referenceNumber,
      description: entry.description,
      debit: entry.debitMinor / 100,
      credit: entry.creditMinor / 100,
      balance: entry.balanceMinor / 100,
      type: entry.type as any,
      invoiceNumber: entry.type === 'invoice' ? entry.referenceNumber : undefined,
      paymentId: entry.type === 'payment' ? entry.referenceId : undefined,
    }))
  }
  return getCustomerLedger(customerId)
}

export async function fetchCustomerLedgerSummary(customerId: string): Promise<CustomerFinancialSummary> {
  if (!isExplicitDemo()) {
    if (customerId === 'walk-in') {
      return {
        customerId,
        totalPurchases: 0,
        totalPaid: 0,
        outstandingBalance: 0,
        advanceBalance: 0,
        openingBalance: 0,
        currentAccountBalance: 0,
      }
    }
    const dto = await apiClient.get<WorkerCustomerFinancialSummaryDTO>(`/customers/${customerId}/ledger/summary`)
    return {
      customerId: dto.customerId,
      totalPurchases: dto.totalInvoicedMinor / 100,
      totalPaid: dto.totalPaidMinor / 100,
      outstandingBalance: dto.currentBalanceMinor / 100,
      advanceBalance: ((dto as any).unallocatedAdvanceMinor ?? 0) / 100,
      openingBalance: dto.openingBalanceMinor / 100,
      currentAccountBalance: dto.currentBalanceMinor / 100,
      lastPurchaseDate: undefined,
    }
  }
  return getCustomerLedgerSummary(customerId)
}

export function getCustomerOutstandingBalance(customerId: string) {
  return getCustomerLedgerSummary(customerId).outstandingBalance
}

export function getCustomerAdvanceBalance(customerId: string) {
  return getUnallocatedAdvance(customerId)
}
