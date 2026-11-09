import { apiClient } from '../../../lib/api-client'
import type {
  Expense,
  ExpenseCategory,
  ExpenseDraft,
  ExpenseFilterParams,
  ExpenseSummary,
} from '../types/expense.types'

function isExplicitDemo(): boolean {
  return import.meta.env?.VITE_DATA_SOURCE === 'mock'
}

let mockCategories: ExpenseCategory[] = [
  { id: 'cat-utilities', name: 'Utilities & Bills', description: 'Electricity, water, gas, internet', status: 'active' },
  { id: 'cat-rent', name: 'Rent & Lease', description: 'Store branch and warehouse rent', status: 'active' },
  { id: 'cat-supplies', name: 'Store Supplies', description: 'Packaging, bags, cleaning, stationery', status: 'active' },
  { id: 'cat-maintenance', name: 'Repair & Maintenance', description: 'Equipment and facility repair', status: 'active' },
  { id: 'cat-transport', name: 'Logistics & Fuel', description: 'Delivery, freight, transportation', status: 'active' },
  { id: 'cat-misc', name: 'Miscellaneous', description: 'General sundry expenses', status: 'active' },
]

let mockExpenses: Expense[] = [
  {
    id: 'exp-101',
    businessId: 'biz-default',
    branchId: 'branch-main',
    branchName: 'Main Store',
    expenseNumber: 'EXP-20261109-0001',
    categoryId: 'cat-utilities',
    categoryName: 'Utilities & Bills',
    amountMinor: 1450000,
    amount: 14500,
    paymentMethod: 'bank_transfer',
    title: 'Monthly Electricity Bill - Oct',
    notes: 'Paid via corporate bank account',
    businessDateKey: '2026-11-09',
    createdBy: 'usr-1',
    createdByName: 'Store Manager',
    createdAt: new Date().toISOString(),
    status: 'posted',
  },
  {
    id: 'exp-102',
    businessId: 'biz-default',
    branchId: 'branch-main',
    branchName: 'Main Store',
    expenseNumber: 'EXP-20261108-0002',
    categoryId: 'cat-supplies',
    categoryName: 'Store Supplies',
    amountMinor: 320000,
    amount: 3200,
    paymentMethod: 'cash',
    title: 'Packaging Bags & Thermal Rolls',
    notes: 'Cash from register petty cash',
    businessDateKey: '2026-11-08',
    createdBy: 'usr-1',
    createdByName: 'Cashier 1',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    status: 'posted',
  },
]

export const expenseService = {
  async getExpenses(filters: ExpenseFilterParams = {}): Promise<{
    items: Expense[]
    total: number
    page: number
    limit: number
    totalPages: number
  }> {
    if (!isExplicitDemo()) {
      try {
        const query = new URLSearchParams()
        if (filters.branchId) query.set('branchId', filters.branchId)
        if (filters.categoryId) query.set('categoryId', filters.categoryId)
        if (filters.paymentMethod) query.set('paymentMethod', filters.paymentMethod)
        if (filters.status) query.set('status', filters.status)
        if (filters.startDate) query.set('startDate', filters.startDate)
        if (filters.endDate) query.set('endDate', filters.endDate)
        if (filters.search) query.set('search', filters.search)
        if (filters.page) query.set('page', String(filters.page))
        if (filters.limit) query.set('limit', String(filters.limit))

        const qs = query.toString()
        return await apiClient.get(`/expenses${qs ? `?${qs}` : ''}`)
      } catch (err) {
        console.warn('Backend expenses API failed, falling back to mock data:', err)
      }
    }

    let filtered = [...mockExpenses]
    if (filters.branchId) filtered = filtered.filter(e => e.branchId === filters.branchId)
    if (filters.categoryId) filtered = filtered.filter(e => e.categoryId === filters.categoryId)
    if (filters.paymentMethod) filtered = filtered.filter(e => e.paymentMethod === filters.paymentMethod)
    if (filters.status) filtered = filtered.filter(e => e.status === filters.status)
    if (filters.search) {
      const q = filters.search.toLowerCase()
      filtered = filtered.filter(e =>
        `${e.expenseNumber} ${e.title} ${e.notes || ''} ${e.categoryName || ''}`.toLowerCase().includes(q)
      )
    }

    const page = filters.page || 1
    const limit = filters.limit || 50
    const total = filtered.length
    const items = filtered.slice((page - 1) * limit, page * limit)

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    }
  },

  async getExpenseSummary(): Promise<ExpenseSummary> {
    if (!isExplicitDemo()) {
      try {
        return await apiClient.get<ExpenseSummary>('/expenses/summary')
      } catch (err) {
        console.warn('Backend expenses summary API failed, using mock:', err)
      }
    }

    const posted = mockExpenses.filter(e => e.status === 'posted')
    const voided = mockExpenses.filter(e => e.status === 'voided')
    const postedAmount = posted.reduce((s, e) => s + e.amountMinor, 0)
    const voidedAmount = voided.reduce((s, e) => s + e.amountMinor, 0)

    return {
      totalCount: mockExpenses.length,
      totalAmountMinor: postedAmount + voidedAmount,
      postedCount: posted.length,
      postedAmountMinor: postedAmount,
      voidedCount: voided.length,
      voidedAmountMinor: voidedAmount,
      todayAmountMinor: postedAmount,
      thisMonthAmountMinor: postedAmount,
      byCategory: mockCategories.map(c => ({
        categoryId: c.id,
        categoryName: c.name,
        amountMinor: posted.filter(e => e.categoryId === c.id).reduce((s, e) => s + e.amountMinor, 0),
        count: posted.filter(e => e.categoryId === c.id).length,
      })),
      byPaymentMethod: [
        {
          method: 'cash',
          amountMinor: posted.filter(e => e.paymentMethod === 'cash').reduce((s, e) => s + e.amountMinor, 0),
          count: posted.filter(e => e.paymentMethod === 'cash').length,
        },
        {
          method: 'bank_transfer',
          amountMinor: posted.filter(e => e.paymentMethod === 'bank_transfer').reduce((s, e) => s + e.amountMinor, 0),
          count: posted.filter(e => e.paymentMethod === 'bank_transfer').length,
        },
      ],
    }
  },

  async getExpenseById(id: string): Promise<Expense> {
    if (!isExplicitDemo()) {
      try {
        return await apiClient.get<Expense>(`/expenses/${id}`)
      } catch (err) {
        console.warn('Backend expenses get API failed, checking mock:', err)
      }
    }
    const item = mockExpenses.find(e => e.id === id || e.expenseNumber === id)
    if (!item) throw new Error('Expense not found.')
    return item
  },

  async createExpense(draft: ExpenseDraft): Promise<Expense> {
    const payload = {
      branchId: draft.branchId,
      categoryId: draft.categoryId,
      amountMinor: draft.amountMinor ?? Math.round(draft.amount * 100),
      paymentMethod: draft.paymentMethod,
      title: draft.title,
      notes: draft.notes,
      receiptAttachmentUrl: draft.receiptAttachmentUrl,
      businessDateKey: draft.businessDateKey,
    }

    if (!isExplicitDemo()) {
      try {
        return await apiClient.post<Expense>('/expenses', payload)
      } catch (err) {
        console.warn('Backend expenses create failed, using mock:', err)
      }
    }

    const cat = mockCategories.find(c => c.id === draft.categoryId)
    const newExpense: Expense = {
      id: `exp-${Date.now()}`,
      businessId: 'biz-default',
      branchId: draft.branchId,
      branchName: 'Main Store',
      expenseNumber: `EXP-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`,
      categoryId: draft.categoryId,
      categoryName: cat?.name || 'Uncategorized',
      amountMinor: payload.amountMinor,
      amount: payload.amountMinor / 100,
      paymentMethod: draft.paymentMethod,
      title: draft.title,
      notes: draft.notes,
      receiptAttachmentUrl: draft.receiptAttachmentUrl,
      businessDateKey: draft.businessDateKey || new Date().toISOString().split('T')[0],
      createdBy: 'usr-current',
      createdByName: 'Admin',
      createdAt: new Date().toISOString(),
      status: 'posted',
    }

    mockExpenses = [newExpense, ...mockExpenses]
    return newExpense
  },

  async voidExpense(id: string, reason: string): Promise<Expense> {
    if (!isExplicitDemo()) {
      try {
        return await apiClient.post<Expense>(`/expenses/${id}/void`, { reason })
      } catch (err) {
        console.warn('Backend expenses void failed, using mock:', err)
      }
    }

    const index = mockExpenses.findIndex(e => e.id === id || e.expenseNumber === id)
    if (index === -1) throw new Error('Expense not found.')

    const updated: Expense = {
      ...mockExpenses[index],
      status: 'voided',
      voidedAt: new Date().toISOString(),
      voidedBy: 'usr-current',
      voidedByName: 'Admin',
      voidReason: reason,
    }
    mockExpenses[index] = updated
    return updated
  },

  async getCategories(): Promise<ExpenseCategory[]> {
    if (!isExplicitDemo()) {
      try {
        return await apiClient.get<ExpenseCategory[]>('/expense-categories')
      } catch (err) {
        console.warn('Backend expense categories get failed, using mock:', err)
      }
    }
    return [...mockCategories]
  },

  async createCategory(name: string, description?: string): Promise<ExpenseCategory> {
    if (!isExplicitDemo()) {
      try {
        return await apiClient.post<ExpenseCategory>('/expense-categories', { name, description })
      } catch (err) {
        console.warn('Backend expense categories create failed, using mock:', err)
      }
    }

    const newCategory: ExpenseCategory = {
      id: `cat-${Date.now()}`,
      name: name.trim(),
      description: description?.trim(),
      status: 'active',
      expenseCount: 0,
      totalAmountMinor: 0,
    }
    mockCategories.push(newCategory)
    return newCategory
  },

  async updateExpense(
    id: string,
    updates: { title?: string; notes?: string; receiptAttachmentUrl?: string }
  ): Promise<Expense> {
    if (!isExplicitDemo()) {
      try {
        return await apiClient.patch<Expense>(`/expenses/${id}`, updates)
      } catch (err) {
        console.warn('Backend expenses update failed, using mock:', err)
      }
    }

    const index = mockExpenses.findIndex((e) => e.id === id || e.expenseNumber === id)
    if (index === -1) throw new Error('Expense not found.')

    const updated: Expense = {
      ...mockExpenses[index],
      ...updates,
    }
    mockExpenses[index] = updated
    return updated
  },

  async updateCategory(
    id: string,
    updates: { name?: string; description?: string; status?: 'active' | 'archived' }
  ): Promise<ExpenseCategory> {
    if (!isExplicitDemo()) {
      try {
        return await apiClient.patch<ExpenseCategory>(`/expense-categories/${id}`, updates)
      } catch (err) {
        console.warn('Backend expense categories update failed, using mock:', err)
      }
    }

    const index = mockCategories.findIndex((c) => c.id === id)
    if (index === -1) throw new Error('Category not found.')

    const updated: ExpenseCategory = {
      ...mockCategories[index],
      ...updates,
    }
    mockCategories[index] = updated
    return updated
  },

  async deleteCategory(id: string): Promise<{ deleted: boolean; archived: boolean }> {
    if (!isExplicitDemo()) {
      try {
        return await apiClient.delete<{ deleted: boolean; archived: boolean }>(`/expense-categories/${id}`)
      } catch (err) {
        console.warn('Backend expense categories delete failed, using mock:', err)
      }
    }

    const index = mockCategories.findIndex((c) => c.id === id)
    if (index === -1) throw new Error('Category not found.')

    const hasExpenses = mockExpenses.some((e) => e.categoryId === id)
    if (hasExpenses) {
      mockCategories[index] = { ...mockCategories[index], status: 'archived' }
      return { deleted: false, archived: true }
    }

    mockCategories.splice(index, 1)
    return { deleted: true, archived: false }
  },
}

