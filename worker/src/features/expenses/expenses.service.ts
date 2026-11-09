import { HttpError } from '../../lib/errors'
import {
  computeCanonicalRequestHash,
  checkIdempotency,
  buildIdempotencyInsertStatement,
} from '../../lib/idempotency'
import { ExpensesRepository } from './expenses.repository'
import type {
  ExpenseDTO,
  ExpenseFilterParams,
  ExpenseCategoryDTO,
  CreateExpenseInput,
  UpdateExpenseInput,
  VoidExpenseInput,
  CreateCategoryInput,
  UpdateCategoryInput,
  ExpenseSummaryDTO,
  ExpenseRecord,
  ExpenseCategoryRecord,
} from './expenses.types'

export class ExpensesService {
  private readonly db: D1Database
  private readonly repo: ExpensesRepository

  constructor(db: D1Database) {
    this.db = db
    this.repo = new ExpensesRepository(db)
  }

  async listExpenses(
    businessId: string,
    filters: ExpenseFilterParams,
    authorizedBranchIds?: string[]
  ): Promise<{ items: ExpenseDTO[]; total: number; page: number; limit: number; totalPages: number }> {
    const [items, total] = await Promise.all([
      this.repo.listExpenses(businessId, filters, authorizedBranchIds),
      this.repo.countExpenses(businessId, filters, authorizedBranchIds),
    ])

    const totalPages = Math.max(1, Math.ceil(total / filters.limit))
    return {
      items,
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages,
    }
  }

  async getExpenseById(businessId: string, id: string): Promise<ExpenseDTO> {
    const expense = await this.repo.getExpenseById(businessId, id)
    if (!expense) {
      throw HttpError.notFound('Expense not found.')
    }
    return expense
  }

  async createExpense(
    businessId: string,
    userId: string,
    input: CreateExpenseInput,
    authorizedBranchIds?: string[],
    idempotencyKey?: string | null
  ): Promise<ExpenseDTO> {
    let requestHash = ''
    if (idempotencyKey) {
      requestHash = await computeCanonicalRequestHash(input)
      const cached = await checkIdempotency(
        this.db,
        businessId,
        'create_expense',
        idempotencyKey,
        requestHash
      )
      if (cached) {
        return cached.body as ExpenseDTO
      }
    }

    if (authorizedBranchIds && authorizedBranchIds.length > 0 && !authorizedBranchIds.includes(input.branchId)) {
      throw HttpError.forbidden('You are not authorized to record expenses for this branch.')
    }

    const category = await this.repo.getCategoryById(businessId, input.categoryId)
    if (!category || category.status !== 'active') {
      throw HttpError.badRequest('Invalid or inactive expense category.')
    }

    const today = new Date().toISOString()
    const dateKey = input.businessDateKey || today.split('T')[0]
    const cleanDate = dateKey.replace(/-/g, '')

    // Sequential number generation with retry in case of collision
    let expenseNumber = ''
    let attempts = 0
    while (attempts < 5) {
      attempts++
      const seq = await this.repo.getNextExpenseSequence(businessId, dateKey)
      const candidate = `EXP-${cleanDate}-${String(seq + attempts - 1).padStart(4, '0')}`
      const existing = await this.repo.getExpenseById(businessId, candidate)
      if (!existing) {
        expenseNumber = candidate
        break
      }
    }
    if (!expenseNumber) {
      expenseNumber = `EXP-${cleanDate}-${Math.floor(1000 + Math.random() * 9000)}`
    }

    const id = `exp-${crypto.randomUUID()}`
    const record: ExpenseRecord = {
      id,
      business_id: businessId,
      branch_id: input.branchId,
      expense_number: expenseNumber,
      category_id: input.categoryId,
      amount_minor: input.amountMinor,
      payment_method: input.paymentMethod,
      title: input.title,
      notes: input.notes || null,
      receipt_attachment_url: input.receiptAttachmentUrl || null,
      business_date_key: dateKey,
      created_by: userId,
      created_at: today,
      status: 'posted',
      voided_at: null,
      voided_by: null,
      void_reason: null,
    }

    await this.repo.createExpense(record)

    await this.repo.insertAuditLog(
      businessId,
      input.branchId,
      userId,
      'create_expense',
      'expense',
      id,
      JSON.stringify({ expenseNumber, amountMinor: input.amountMinor, categoryId: input.categoryId, title: input.title })
    )

    const created = await this.repo.getExpenseById(businessId, id)
    if (!created) {
      throw HttpError.internal('Failed to retrieve created expense.')
    }

    if (idempotencyKey) {
      await buildIdempotencyInsertStatement(
        this.db,
        businessId,
        'create_expense',
        idempotencyKey,
        requestHash,
        201,
        created
      ).run()
    }

    return created
  }

  async updateExpense(
    businessId: string,
    userId: string,
    expenseId: string,
    input: UpdateExpenseInput
  ): Promise<ExpenseDTO> {
    const existing = await this.repo.getExpenseById(businessId, expenseId)
    if (!existing) {
      throw HttpError.notFound('Expense not found.')
    }

    if (existing.status === 'voided') {
      throw HttpError.badRequest('Cannot update a voided expense.')
    }

    await this.repo.updateExpense(businessId, existing.id, input)

    await this.repo.insertAuditLog(
      businessId,
      existing.branchId,
      userId,
      'update_expense',
      'expense',
      existing.id,
      JSON.stringify(input)
    )

    const updated = await this.repo.getExpenseById(businessId, existing.id)
    if (!updated) {
      throw HttpError.internal('Failed to retrieve updated expense.')
    }
    return updated
  }

  async voidExpense(businessId: string, userId: string, expenseId: string, input: VoidExpenseInput): Promise<ExpenseDTO> {
    const existing = await this.repo.getExpenseById(businessId, expenseId)
    if (!existing) {
      throw HttpError.notFound('Expense not found.')
    }

    if (existing.status === 'voided') {
      throw HttpError.badRequest('Expense is already voided.')
    }

    const voidedAt = new Date().toISOString()
    await this.repo.voidExpense(businessId, existing.id, userId, input.reason, voidedAt)

    await this.repo.insertAuditLog(
      businessId,
      existing.branchId,
      userId,
      'void_expense',
      'expense',
      existing.id,
      JSON.stringify({
        expenseNumber: existing.expenseNumber,
        amountMinor: existing.amountMinor,
        reason: input.reason,
        voidedAt,
      })
    )

    const updated = await this.repo.getExpenseById(businessId, existing.id)
    if (!updated) {
      throw HttpError.internal('Failed to retrieve voided expense.')
    }
    return updated
  }

  async listCategories(businessId: string): Promise<ExpenseCategoryDTO[]> {
    return this.repo.listCategories(businessId)
  }

  async createCategory(businessId: string, input: CreateCategoryInput): Promise<ExpenseCategoryDTO> {
    const existing = await this.repo.getCategoryByName(businessId, input.name)
    if (existing) {
      if (existing.status === 'active') {
        throw HttpError.badRequest(`Category "${input.name}" already exists.`)
      }
    }

    const id = `expcat-${crypto.randomUUID()}`
    const record: ExpenseCategoryRecord = {
      id,
      business_id: businessId,
      name: input.name,
      description: input.description || null,
      status: 'active',
      created_at: new Date().toISOString(),
    }

    await this.repo.createCategory(record)

    return {
      id: record.id,
      businessId: record.business_id,
      name: record.name,
      description: record.description || undefined,
      status: 'active',
      createdAt: record.created_at,
      expenseCount: 0,
      totalAmountMinor: 0,
    }
  }

  async updateCategory(
    businessId: string,
    categoryId: string,
    input: UpdateCategoryInput
  ): Promise<ExpenseCategoryDTO> {
    const existing = await this.repo.getCategoryById(businessId, categoryId)
    if (!existing) {
      throw HttpError.notFound('Expense category not found.')
    }

    if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
      const conflict = await this.repo.getCategoryByName(businessId, input.name)
      if (conflict && conflict.id !== categoryId) {
        throw HttpError.badRequest(`Category "${input.name}" already exists.`)
      }
    }

    await this.repo.updateCategory(businessId, categoryId, input)
    const updated = await this.repo.getCategoryById(businessId, categoryId)
    if (!updated) {
      throw HttpError.internal('Failed to retrieve updated category.')
    }

    const count = await this.repo.countCategoryExpenses(businessId, categoryId)
    return {
      id: updated.id,
      businessId: updated.business_id,
      name: updated.name,
      description: updated.description || undefined,
      status: updated.status,
      createdAt: updated.created_at,
      expenseCount: count,
    }
  }

  async deleteCategory(
    businessId: string,
    categoryId: string
  ): Promise<{ deleted: boolean; archived: boolean }> {
    const existing = await this.repo.getCategoryById(businessId, categoryId)
    if (!existing) {
      throw HttpError.notFound('Expense category not found.')
    }

    const count = await this.repo.countCategoryExpenses(businessId, categoryId)
    if (count > 0) {
      await this.repo.updateCategory(businessId, categoryId, { status: 'archived' })
      return { deleted: false, archived: true }
    }

    await this.repo.deleteCategory(businessId, categoryId)
    return { deleted: true, archived: false }
  }

  async getSummary(businessId: string, authorizedBranchIds?: string[]): Promise<ExpenseSummaryDTO> {
    const now = new Date()
    const todayKey = now.toISOString().split('T')[0]
    const monthPrefix = todayKey.substring(0, 7) // YYYY-MM
    return this.repo.getSummary(businessId, todayKey, monthPrefix, authorizedBranchIds)
  }
}
