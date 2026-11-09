export type ExpensePaymentMethod = 'cash' | 'bank_transfer' | 'card' | 'other'
export type ExpenseStatus = 'posted' | 'voided'

export interface Expense {
  id: string
  businessId: string
  branchId: string
  branchName?: string
  expenseNumber: string
  categoryId: string
  categoryName?: string
  amountMinor: number
  amount: number
  paymentMethod: ExpensePaymentMethod
  title: string
  notes?: string
  receiptAttachmentUrl?: string
  businessDateKey: string
  createdBy: string
  createdByName?: string
  createdAt: string
  status: ExpenseStatus
  voidedAt?: string
  voidedBy?: string
  voidedByName?: string
  voidReason?: string
}

export interface ExpenseCategory {
  id: string
  businessId?: string
  name: string
  description?: string
  status: 'active' | 'archived'
  createdAt?: string
  expenseCount?: number
  totalAmountMinor?: number
}

export interface ExpenseDraft {
  branchId: string
  categoryId: string
  amount: number
  amountMinor?: number
  paymentMethod: ExpensePaymentMethod
  title: string
  notes?: string
  receiptAttachmentUrl?: string
  businessDateKey?: string
}

export interface ExpenseFilterParams {
  branchId?: string
  categoryId?: string
  paymentMethod?: ExpensePaymentMethod
  status?: ExpenseStatus
  startDate?: string
  endDate?: string
  search?: string
  page?: number
  limit?: number
}

export interface ExpenseSummary {
  totalCount: number
  totalAmountMinor: number
  postedCount: number
  postedAmountMinor: number
  voidedCount: number
  voidedAmountMinor: number
  todayAmountMinor: number
  thisMonthAmountMinor: number
  byCategory: Array<{
    categoryId: string
    categoryName: string
    amountMinor: number
    count: number
  }>
  byPaymentMethod: Array<{
    method: ExpensePaymentMethod
    amountMinor: number
    count: number
  }>
}

