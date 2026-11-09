export type SupplierLedgerType = 'opening' | 'bill' | 'payment' | 'debit_note' | 'adjustment'

export interface SupplierLedgerEntryDTO {
  id: string
  businessId: string
  branchId: string
  supplierId: string
  type: SupplierLedgerType
  referenceId: string
  referenceNumber: string
  description: string
  debitMinor: number
  creditMinor: number
  balanceMinor: number
  businessDateKey: string
  createdAt: string
}

export interface SupplierLedgerFilterParams {
  branchId?: string
  startDate?: string
  endDate?: string
  type?: SupplierLedgerType
  page: number
  limit: number
}

export interface SupplierLedgerStatementDTO {
  supplierId: string
  supplierName: string
  contactPerson: string | null
  phone: string | null
  openingBalanceMinor: number
  closingBalanceMinor: number
  totalDebitsMinor: number
  totalCreditsMinor: number
  netChangeMinor: number
  entries: SupplierLedgerEntryDTO[]
  meta: {
    page: number
    limit: number
    totalCount: number
    totalPages: number
    hasNextPage: boolean
  }
}

export interface SupplierFinancialSummaryDTO {
  supplierId: string
  supplierName: string
  contactPerson: string | null
  phone: string | null
  openingPayableMinor: number
  currentPayableMinor: number
  totalBilledMinor: number
  totalPaidMinor: number
  openPurchasesCount: number
  earliestUnpaidPurchaseDate: string | null
}

