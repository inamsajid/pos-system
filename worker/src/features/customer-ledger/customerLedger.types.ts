export interface CustomerLedgerEntryDTO {
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
  businessDateKey: string
  createdAt: string
}

export interface CustomerLedgerFilterParams {
  branchId?: string
  startDate?: string
  endDate?: string
  type?: 'opening' | 'invoice' | 'payment' | 'credit_note' | 'void' | 'adjustment'
  page: number
  limit: number
}

export interface CustomerLedgerStatementDTO {
  customerId: string
  customerCode: string
  customerName: string
  openingBalanceMinor: number
  closingBalanceMinor: number
  totalDebitsMinor: number
  totalCreditsMinor: number
  netChangeMinor: number
  entries: CustomerLedgerEntryDTO[]
  meta: {
    page: number
    limit: number
    totalCount: number
    totalPages: number
    hasNextPage: boolean
  }
}

export interface CustomerFinancialSummaryDTO {
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

