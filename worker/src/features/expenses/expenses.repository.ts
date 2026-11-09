import type {
  ExpenseRecord,
  ExpenseCategoryRecord,
  ExpenseDTO,
  ExpenseFilterParams,
  ExpenseCategoryDTO,
  ExpenseSummaryDTO,
} from './expenses.types'

export class ExpensesRepository {
  private readonly db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  async listExpenses(
    businessId: string,
    filters: ExpenseFilterParams,
    authorizedBranchIds?: string[]
  ): Promise<ExpenseDTO[]> {
    const conditions: string[] = ['e.business_id = ?']
    const params: unknown[] = [businessId]

    if (authorizedBranchIds && authorizedBranchIds.length > 0) {
      const placeholders = authorizedBranchIds.map(() => '?').join(', ')
      conditions.push(`e.branch_id IN (${placeholders})`)
      params.push(...authorizedBranchIds)
    }

    if (filters.branchId) {
      conditions.push('e.branch_id = ?')
      params.push(filters.branchId)
    }

    if (filters.categoryId) {
      conditions.push('e.category_id = ?')
      params.push(filters.categoryId)
    }

    if (filters.paymentMethod) {
      conditions.push('e.payment_method = ?')
      params.push(filters.paymentMethod)
    }

    if (filters.status) {
      conditions.push('e.status = ?')
      params.push(filters.status)
    }

    if (filters.startDate) {
      conditions.push('e.business_date_key >= ?')
      params.push(filters.startDate)
    }

    if (filters.endDate) {
      conditions.push('e.business_date_key <= ?')
      params.push(filters.endDate)
    }

    if (filters.search) {
      conditions.push('(e.title LIKE ? OR e.expense_number LIKE ? OR e.notes LIKE ?)')
      const pattern = `%${filters.search}%`
      params.push(pattern, pattern, pattern)
    }

    const offset = (filters.page - 1) * filters.limit
    const sql = `
      SELECT
        e.id,
        e.business_id,
        e.branch_id,
        b.name AS branch_name,
        e.expense_number,
        e.category_id,
        c.name AS category_name,
        e.amount_minor,
        e.payment_method,
        e.title,
        e.notes,
        e.receipt_attachment_url,
        e.business_date_key,
        e.created_by,
        u.name AS created_by_name,
        e.created_at,
        e.status,
        e.voided_at,
        e.voided_by,
        vu.name AS voided_by_name,
        e.void_reason
      FROM expenses e
      LEFT JOIN expense_categories c ON c.id = e.category_id
      LEFT JOIN branches b ON b.id = e.branch_id
      LEFT JOIN users u ON u.id = e.created_by
      LEFT JOIN users vu ON vu.id = e.voided_by
      WHERE ${conditions.join(' AND ')}
      ORDER BY e.created_at DESC, e.expense_number DESC
      LIMIT ? OFFSET ?
    `
    params.push(filters.limit, offset)

    const result = await this.db.prepare(sql).bind(...params).all<any>()
    return (result.results || []).map(r => this.mapRowToDTO(r))
  }

  async countExpenses(
    businessId: string,
    filters: ExpenseFilterParams,
    authorizedBranchIds?: string[]
  ): Promise<number> {
    const conditions: string[] = ['e.business_id = ?']
    const params: unknown[] = [businessId]

    if (authorizedBranchIds && authorizedBranchIds.length > 0) {
      const placeholders = authorizedBranchIds.map(() => '?').join(', ')
      conditions.push(`e.branch_id IN (${placeholders})`)
      params.push(...authorizedBranchIds)
    }

    if (filters.branchId) {
      conditions.push('e.branch_id = ?')
      params.push(filters.branchId)
    }

    if (filters.categoryId) {
      conditions.push('e.category_id = ?')
      params.push(filters.categoryId)
    }

    if (filters.paymentMethod) {
      conditions.push('e.payment_method = ?')
      params.push(filters.paymentMethod)
    }

    if (filters.status) {
      conditions.push('e.status = ?')
      params.push(filters.status)
    }

    if (filters.startDate) {
      conditions.push('e.business_date_key >= ?')
      params.push(filters.startDate)
    }

    if (filters.endDate) {
      conditions.push('e.business_date_key <= ?')
      params.push(filters.endDate)
    }

    if (filters.search) {
      conditions.push('(e.title LIKE ? OR e.expense_number LIKE ? OR e.notes LIKE ?)')
      const pattern = `%${filters.search}%`
      params.push(pattern, pattern, pattern)
    }

    const sql = `SELECT COUNT(*) AS total FROM expenses e WHERE ${conditions.join(' AND ')}`
    const row = await this.db.prepare(sql).bind(...params).first<{ total: number }>()
    return row?.total ?? 0
  }

  async getExpenseById(businessId: string, id: string): Promise<ExpenseDTO | null> {
    const sql = `
      SELECT
        e.id,
        e.business_id,
        e.branch_id,
        b.name AS branch_name,
        e.expense_number,
        e.category_id,
        c.name AS category_name,
        e.amount_minor,
        e.payment_method,
        e.title,
        e.notes,
        e.receipt_attachment_url,
        e.business_date_key,
        e.created_by,
        u.name AS created_by_name,
        e.created_at,
        e.status,
        e.voided_at,
        e.voided_by,
        vu.name AS voided_by_name,
        e.void_reason
      FROM expenses e
      LEFT JOIN expense_categories c ON c.id = e.category_id
      LEFT JOIN branches b ON b.id = e.branch_id
      LEFT JOIN users u ON u.id = e.created_by
      LEFT JOIN users vu ON vu.id = e.voided_by
      WHERE e.business_id = ? AND (e.id = ? OR e.expense_number = ?)
      LIMIT 1
    `
    const row = await this.db.prepare(sql).bind(businessId, id, id).first<any>()
    return row ? this.mapRowToDTO(row) : null
  }

  async createExpense(record: ExpenseRecord): Promise<void> {
    const sql = `
      INSERT INTO expenses (
        id,
        business_id,
        branch_id,
        expense_number,
        category_id,
        amount_minor,
        payment_method,
        title,
        notes,
        receipt_attachment_url,
        business_date_key,
        created_by,
        created_at,
        status,
        voided_at,
        voided_by,
        void_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    await this.db
      .prepare(sql)
      .bind(
        record.id,
        record.business_id,
        record.branch_id,
        record.expense_number,
        record.category_id,
        record.amount_minor,
        record.payment_method,
        record.title,
        record.notes,
        record.receipt_attachment_url,
        record.business_date_key,
        record.created_by,
        record.created_at,
        record.status,
        record.voided_at,
        record.voided_by,
        record.void_reason
      )
      .run()
  }

  async voidExpense(
    businessId: string,
    id: string,
    voidedBy: string,
    voidReason: string,
    voidedAt: string
  ): Promise<void> {
    const sql = `
      UPDATE expenses
      SET status = 'voided',
          voided_at = ?,
          voided_by = ?,
          void_reason = ?
      WHERE business_id = ? AND id = ?
    `
    await this.db.prepare(sql).bind(voidedAt, voidedBy, voidReason, businessId, id).run()
  }

  async updateExpense(
    businessId: string,
    id: string,
    updates: {
      title?: string
      notes?: string | null
      receiptAttachmentUrl?: string | null
    }
  ): Promise<void> {
    const fields: string[] = []
    const values: unknown[] = []

    if (updates.title !== undefined) {
      fields.push('title = ?')
      values.push(updates.title)
    }
    if (updates.notes !== undefined) {
      fields.push('notes = ?')
      values.push(updates.notes)
    }
    if (updates.receiptAttachmentUrl !== undefined) {
      fields.push('receipt_attachment_url = ?')
      values.push(updates.receiptAttachmentUrl)
    }

    if (fields.length === 0) return

    const sql = `UPDATE expenses SET ${fields.join(', ')} WHERE business_id = ? AND id = ?`
    values.push(businessId, id)
    await this.db.prepare(sql).bind(...values).run()
  }

  async getNextExpenseSequence(businessId: string, dateKey: string): Promise<number> {
    const cleanDate = dateKey.replace(/-/g, '')
    const prefix = `EXP-${cleanDate}-`
    const sql = `
      SELECT expense_number
      FROM expenses
      WHERE business_id = ? AND expense_number LIKE ?
      ORDER BY expense_number DESC
      LIMIT 1
    `
    const row = await this.db.prepare(sql).bind(businessId, `${prefix}%`).first<{ expense_number: string }>()
    if (!row || !row.expense_number) {
      return 1
    }
    const parts = row.expense_number.split('-')
    const lastSeq = parseInt(parts[parts.length - 1], 10)
    return Number.isFinite(lastSeq) ? lastSeq + 1 : 1
  }

  async listCategories(businessId: string): Promise<ExpenseCategoryDTO[]> {
    const sql = `
      SELECT
        c.id,
        c.business_id,
        c.name,
        c.description,
        c.status,
        c.created_at,
        COUNT(e.id) AS expense_count,
        COALESCE(SUM(CASE WHEN e.status = 'posted' THEN e.amount_minor ELSE 0 END), 0) AS total_amount_minor
      FROM expense_categories c
      LEFT JOIN expenses e ON e.category_id = c.id AND e.business_id = c.business_id
      WHERE c.business_id = ? AND c.status = 'active'
      GROUP BY c.id
      ORDER BY c.name ASC
    `
    const result = await this.db.prepare(sql).bind(businessId).all<any>()
    return (result.results || []).map(r => ({
      id: r.id,
      businessId: r.business_id,
      name: r.name,
      description: r.description || undefined,
      status: r.status,
      createdAt: r.created_at,
      expenseCount: Number(r.expense_count) || 0,
      totalAmountMinor: Number(r.total_amount_minor) || 0,
    }))
  }

  async getCategoryById(businessId: string, id: string): Promise<ExpenseCategoryRecord | null> {
    const sql = `SELECT * FROM expense_categories WHERE business_id = ? AND id = ? LIMIT 1`
    return this.db.prepare(sql).bind(businessId, id).first<ExpenseCategoryRecord>()
  }

  async getCategoryByName(businessId: string, name: string): Promise<ExpenseCategoryRecord | null> {
    const sql = `SELECT * FROM expense_categories WHERE business_id = ? AND LOWER(name) = LOWER(?) LIMIT 1`
    return this.db.prepare(sql).bind(businessId, name.trim()).first<ExpenseCategoryRecord>()
  }

  async createCategory(record: ExpenseCategoryRecord): Promise<void> {
    const sql = `
      INSERT INTO expense_categories (id, business_id, name, description, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    await this.db
      .prepare(sql)
      .bind(record.id, record.business_id, record.name, record.description, record.status, record.created_at)
      .run()
  }

  async updateCategory(
    businessId: string,
    id: string,
    updates: {
      name?: string
      description?: string | null
      status?: 'active' | 'archived'
    }
  ): Promise<void> {
    const fields: string[] = []
    const values: unknown[] = []

    if (updates.name !== undefined) {
      fields.push('name = ?')
      values.push(updates.name)
    }
    if (updates.description !== undefined) {
      fields.push('description = ?')
      values.push(updates.description)
    }
    if (updates.status !== undefined) {
      fields.push('status = ?')
      values.push(updates.status)
    }

    if (fields.length === 0) return

    const sql = `UPDATE expense_categories SET ${fields.join(', ')} WHERE business_id = ? AND id = ?`
    values.push(businessId, id)
    await this.db.prepare(sql).bind(...values).run()
  }

  async countCategoryExpenses(businessId: string, categoryId: string): Promise<number> {
    const sql = `SELECT COUNT(*) as count FROM expenses WHERE business_id = ? AND category_id = ?`
    const row = await this.db.prepare(sql).bind(businessId, categoryId).first<{ count: number }>()
    return row?.count ?? 0
  }

  async deleteCategory(businessId: string, id: string): Promise<void> {
    const sql = `DELETE FROM expense_categories WHERE business_id = ? AND id = ?`
    await this.db.prepare(sql).bind(businessId, id).run()
  }

  async getSummary(
    businessId: string,
    todayKey: string,
    monthPrefix: string,
    authorizedBranchIds?: string[]
  ): Promise<ExpenseSummaryDTO> {
    const branchCondition =
      authorizedBranchIds && authorizedBranchIds.length > 0
        ? `AND branch_id IN (${authorizedBranchIds.map(() => '?').join(', ')})`
        : ''
    const branchParams = authorizedBranchIds && authorizedBranchIds.length > 0 ? authorizedBranchIds : []

    // Totals
    const totalsSql = `
      SELECT
        COUNT(*) AS total_count,
        COALESCE(SUM(amount_minor), 0) AS total_amount_minor,
        COALESCE(SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END), 0) AS posted_count,
        COALESCE(SUM(CASE WHEN status = 'posted' THEN amount_minor ELSE 0 END), 0) AS posted_amount_minor,
        COALESCE(SUM(CASE WHEN status = 'voided' THEN 1 ELSE 0 END), 0) AS voided_count,
        COALESCE(SUM(CASE WHEN status = 'voided' THEN amount_minor ELSE 0 END), 0) AS voided_amount_minor,
        COALESCE(SUM(CASE WHEN status = 'posted' AND business_date_key = ? THEN amount_minor ELSE 0 END), 0) AS today_amount_minor,
        COALESCE(SUM(CASE WHEN status = 'posted' AND business_date_key LIKE ? THEN amount_minor ELSE 0 END), 0) AS month_amount_minor
      FROM expenses
      WHERE business_id = ? ${branchCondition}
    `
    const totals = await this.db
      .prepare(totalsSql)
      .bind(todayKey, `${monthPrefix}%`, businessId, ...branchParams)
      .first<any>()

    // By Category (posted only)
    const catSql = `
      SELECT
        e.category_id,
        COALESCE(c.name, 'Uncategorized') AS category_name,
        SUM(e.amount_minor) AS amount_minor,
        COUNT(*) AS count
      FROM expenses e
      LEFT JOIN expense_categories c ON c.id = e.category_id
      WHERE e.business_id = ? AND e.status = 'posted' ${branchCondition}
      GROUP BY e.category_id
      ORDER BY amount_minor DESC
    `
    const catResult = await this.db.prepare(catSql).bind(businessId, ...branchParams).all<any>()

    // By Payment Method (posted only)
    const methodSql = `
      SELECT
        payment_method,
        SUM(amount_minor) AS amount_minor,
        COUNT(*) AS count
      FROM expenses
      WHERE business_id = ? AND status = 'posted' ${branchCondition}
      GROUP BY payment_method
      ORDER BY amount_minor DESC
    `
    const methodResult = await this.db.prepare(methodSql).bind(businessId, ...branchParams).all<any>()

    return {
      totalCount: Number(totals?.total_count) || 0,
      totalAmountMinor: Number(totals?.total_amount_minor) || 0,
      postedCount: Number(totals?.posted_count) || 0,
      postedAmountMinor: Number(totals?.posted_amount_minor) || 0,
      voidedCount: Number(totals?.voided_count) || 0,
      voidedAmountMinor: Number(totals?.voided_amount_minor) || 0,
      todayAmountMinor: Number(totals?.today_amount_minor) || 0,
      thisMonthAmountMinor: Number(totals?.month_amount_minor) || 0,
      byCategory: (catResult.results || []).map(r => ({
        categoryId: r.category_id,
        categoryName: r.category_name,
        amountMinor: Number(r.amount_minor) || 0,
        count: Number(r.count) || 0,
      })),
      byPaymentMethod: (methodResult.results || []).map(r => ({
        method: r.payment_method,
        amountMinor: Number(r.amount_minor) || 0,
        count: Number(r.count) || 0,
      })),
    }
  }

  async insertAuditLog(
    businessId: string,
    branchId: string | null,
    userId: string,
    action: string,
    entityType: string,
    entityId: string,
    diffJson?: string
  ): Promise<void> {
    const id = `aud-${crypto.randomUUID()}`
    const sql = `
      INSERT INTO audit_logs (id, business_id, branch_id, user_id, action, entity_type, entity_id, diff_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `
    await this.db
      .prepare(sql)
      .bind(id, businessId, branchId, userId, action, entityType, entityId, diffJson || null)
      .run()
  }

  private mapRowToDTO(r: any): ExpenseDTO {
    return {
      id: r.id,
      businessId: r.business_id,
      branchId: r.branch_id,
      branchName: r.branch_name || undefined,
      expenseNumber: r.expense_number,
      categoryId: r.category_id,
      categoryName: r.category_name || undefined,
      amountMinor: Number(r.amount_minor) || 0,
      amount: (Number(r.amount_minor) || 0) / 100,
      paymentMethod: r.payment_method,
      title: r.title,
      notes: r.notes || undefined,
      receiptAttachmentUrl: r.receipt_attachment_url || undefined,
      businessDateKey: r.business_date_key,
      createdBy: r.created_by,
      createdByName: r.created_by_name || undefined,
      createdAt: r.created_at,
      status: r.status,
      voidedAt: r.voided_at || undefined,
      voidedBy: r.voided_by || undefined,
      voidedByName: r.voided_by_name || undefined,
      voidReason: r.void_reason || undefined,
    }
  }
}
