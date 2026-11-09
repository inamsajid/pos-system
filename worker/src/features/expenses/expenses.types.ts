export type ExpensePaymentMethod = 'cash' | 'bank_transfer' | 'card' | 'other'
export type ExpenseStatus = 'posted' | 'voided'

export interface ExpenseRecord {
  id: string
  business_id: string
  branch_id: string
  expense_number: string
  category_id: string
  amount_minor: number
  payment_method: ExpensePaymentMethod
  title: string
  notes: string | null
  receipt_attachment_url: string | null
  business_date_key: string
  created_by: string
  created_at: string
  status: ExpenseStatus
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
}

export interface ExpenseCategoryRecord {
  id: string
  business_id: string
  name: string
  description: string | null
  status: 'active' | 'archived'
  created_at: string
}

export interface ExpenseDTO {
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

export interface ExpenseCategoryDTO {
  id: string
  businessId: string
  name: string
  description?: string
  status: 'active' | 'archived'
  createdAt: string
  expenseCount?: number
  totalAmountMinor?: number
}

export interface ExpenseFilterParams {
  branchId?: string
  categoryId?: string
  paymentMethod?: ExpensePaymentMethod
  status?: ExpenseStatus
  startDate?: string
  endDate?: string
  search?: string
  page: number
  limit: number
}

export interface CreateExpenseInput {
  branchId: string
  categoryId: string
  amountMinor: number
  paymentMethod: ExpensePaymentMethod
  title: string
  notes?: string
  receiptAttachmentUrl?: string
  businessDateKey?: string
}

export interface VoidExpenseInput {
  reason: string
}

export interface CreateCategoryInput {
  name: string
  description?: string
}

export interface UpdateExpenseInput {
  title?: string
  notes?: string | null
  receiptAttachmentUrl?: string | null
}

export interface UpdateCategoryInput {
  name?: string
  description?: string | null
  status?: 'active' | 'archived'
}

export interface ExpenseSummaryDTO {
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

