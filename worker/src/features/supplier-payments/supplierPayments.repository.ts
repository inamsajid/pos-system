import type {
  SupplierPaymentRow,
  SupplierPaymentAllocationRow,
  SupplierPaymentDTO,
  SupplierPaymentAllocationDTO,
  SupplierPaymentMethodAllocationDTO,
  SupplierPaymentFilterParams,
} from './supplierPayments.types'
import type { SupplierSnapshot } from '../purchases/purchases.types'

export function mapSupplierPaymentRowToDTO(
  row: SupplierPaymentRow,
  allocations?: SupplierPaymentAllocationDTO[],
  paymentMethods?: SupplierPaymentMethodAllocationDTO[]
): SupplierPaymentDTO {
  let supplierSnapshot: SupplierSnapshot | undefined
  if (row.supplier_snapshot_json) {
    try {
      supplierSnapshot = JSON.parse(row.supplier_snapshot_json)
    } catch {
      // ignore JSON parse error
    }
  }

  const methods = paymentMethods && paymentMethods.length > 0
    ? paymentMethods
    : [{
        id: `spm_${row.id}`,
        paymentId: row.id,
        method: row.method,
        amountMinor: row.amount_minor,
        reference: row.reference,
      }]

  return {
    id: row.id,
    businessId: row.business_id,
    branchId: row.branch_id,
    branchName: row.branch_name,
    receiptNumber: row.receipt_number,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name ?? supplierSnapshot?.name,
    supplierSnapshot,
    amountMinor: row.amount_minor,
    unallocatedAmountMinor: row.unallocated_amount_minor,
    method: row.method,
    reference: row.reference,
    paymentMethods: methods,
    notes: row.notes,
    businessDateKey: row.business_date_key,
    paidBy: row.paid_by,
    paidByName: row.payer_name,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    allocations,
  }
}

export function mapSupplierPaymentAllocationRowToDTO(
  row: SupplierPaymentAllocationRow
): SupplierPaymentAllocationDTO {
  return {
    id: row.id,
    paymentId: row.payment_id,
    purchaseId: row.purchase_id,
    purchaseNumber: row.purchase_number,
    amountMinor: row.amount_minor,
    allocatedAt: row.allocated_at,
  }
}

export class SupplierPaymentsRepository {
  private readonly db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  private buildWhereClause(
    businessId: string,
    filters: SupplierPaymentFilterParams,
    authorizedBranchIds: string[]
  ): { sql: string; bindings: (string | number)[] } {
    const conditions: string[] = ['sp.business_id = ?']
    const bindings: (string | number)[] = [businessId]

    // Branch scoping (fail closed if empty)
    if (authorizedBranchIds.length === 0) {
      conditions.push('1 = 0')
    } else if (filters.branchId) {
      if (!authorizedBranchIds.includes(filters.branchId)) {
        conditions.push('1 = 0')
      } else {
        conditions.push('sp.branch_id = ?')
        bindings.push(filters.branchId)
      }
    } else {
      const placeholders = authorizedBranchIds.map(() => '?').join(', ')
      conditions.push(`sp.branch_id IN (${placeholders})`)
      bindings.push(...authorizedBranchIds)
    }

    if (filters.supplierId) {
      conditions.push('sp.supplier_id = ?')
      bindings.push(filters.supplierId)
    }

    if (filters.startDate) {
      conditions.push('sp.business_date_key >= ?')
      bindings.push(filters.startDate)
    }

    if (filters.endDate) {
      conditions.push('sp.business_date_key <= ?')
      bindings.push(filters.endDate)
    }

    return {
      sql: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
      bindings,
    }
  }

  async listPayments(
    businessId: string,
    filters: SupplierPaymentFilterParams,
    authorizedBranchIds: string[]
  ): Promise<{ payments: SupplierPaymentDTO[]; total: number }> {
    const { sql: whereClause, bindings } = this.buildWhereClause(
      businessId,
      filters,
      authorizedBranchIds
    )

    // Count
    const countSql = `
      SELECT COUNT(*) as total
      FROM supplier_payments sp
      ${whereClause}
    `
    const countStmt = this.db.prepare(countSql)
    const countResult = await countStmt.bind(...bindings).first<{ total: number }>()
    const total = countResult?.total ?? 0

    if (total === 0) {
      return { payments: [], total: 0 }
    }

    // Paged Query
    const offset = (filters.page - 1) * filters.limit
    const listSql = `
      SELECT 
        sp.*,
        s.name as supplier_name,
        b.name as branch_name,
        u.name as payer_name
      FROM supplier_payments sp
      LEFT JOIN suppliers s ON sp.supplier_id = s.id
      LEFT JOIN branches b ON sp.branch_id = b.id
      LEFT JOIN users u ON sp.paid_by = u.id
      ${whereClause}
      ORDER BY sp.business_date_key DESC, sp.created_at DESC, sp.id DESC
      LIMIT ? OFFSET ?
    `

    const listBindings = [...bindings, filters.limit, offset]
    const listStmt = this.db.prepare(listSql)
    const { results } = await listStmt.bind(...listBindings).all<SupplierPaymentRow>()

    const paymentIds = (results || []).map((r) => r.id)
    const methodsByPayment = new Map<string, SupplierPaymentMethodAllocationDTO[]>()
    if (paymentIds.length > 0) {
      const placeholders = paymentIds.map(() => '?').join(', ')
      const methodsRes = await this.db
        .prepare(
          `SELECT id, payment_id, method, amount_minor, reference
           FROM supplier_payment_methods
           WHERE payment_id IN (${placeholders})`
        )
        .bind(...paymentIds)
        .all<{
          id: string
          payment_id: string
          method: SupplierPaymentRow['method']
          amount_minor: number
          reference: string | null
        }>()

      for (const m of methodsRes.results || []) {
        const arr = methodsByPayment.get(m.payment_id) || []
        arr.push({
          id: m.id,
          paymentId: m.payment_id,
          method: m.method,
          amountMinor: m.amount_minor,
          reference: m.reference,
        })
        methodsByPayment.set(m.payment_id, arr)
      }
    }

    const payments = (results || []).map((row) =>
      mapSupplierPaymentRowToDTO(row, undefined, methodsByPayment.get(row.id))
    )
    return { payments, total }
  }

  async getPaymentById(
    businessId: string,
    paymentId: string,
    authorizedBranchIds: string[]
  ): Promise<SupplierPaymentDTO | null> {
    if (authorizedBranchIds.length === 0) {
      return null
    }

    const conditions: string[] = ['sp.business_id = ?', 'sp.id = ?']
    const bindings: string[] = [businessId, paymentId]

    const placeholders = authorizedBranchIds.map(() => '?').join(', ')
    conditions.push(`sp.branch_id IN (${placeholders})`)
    bindings.push(...authorizedBranchIds)

    const sql = `
      SELECT 
        sp.*,
        s.name as supplier_name,
        b.name as branch_name,
        u.name as payer_name
      FROM supplier_payments sp
      LEFT JOIN suppliers s ON sp.supplier_id = s.id
      LEFT JOIN branches b ON sp.branch_id = b.id
      LEFT JOIN users u ON sp.paid_by = u.id
      WHERE ${conditions.join(' AND ')}
      LIMIT 1
    `

    const row = await this.db.prepare(sql).bind(...bindings).first<SupplierPaymentRow>()
    if (!row) {
      return null
    }

    const [allocations, methods] = await Promise.all([
      this.getAllocationsByPaymentId(businessId, paymentId),
      this.getMethodsByPaymentId(paymentId),
    ])
    return mapSupplierPaymentRowToDTO(row, allocations, methods)
  }

  async getMethodsByPaymentId(
    paymentId: string
  ): Promise<SupplierPaymentMethodAllocationDTO[]> {
    const sql = `
      SELECT id, payment_id, method, amount_minor, reference
      FROM supplier_payment_methods
      WHERE payment_id = ?
      ORDER BY rowid ASC
    `
    const { results } = await this.db
      .prepare(sql)
      .bind(paymentId)
      .all<{
        id: string
        payment_id: string
        method: SupplierPaymentRow['method']
        amount_minor: number
        reference: string | null
      }>()

    return (results || []).map((r) => ({
      id: r.id,
      paymentId: r.payment_id,
      method: r.method,
      amountMinor: r.amount_minor,
      reference: r.reference,
    }))
  }

  async getAllocationsByPaymentId(
    businessId: string,
    paymentId: string
  ): Promise<SupplierPaymentAllocationDTO[]> {
    const sql = `
      SELECT *
      FROM supplier_payment_allocations
      WHERE business_id = ? AND payment_id = ?
      ORDER BY allocated_at ASC, id ASC
    `
    const { results } = await this.db.prepare(sql).bind(businessId, paymentId).all<SupplierPaymentAllocationRow>()
    return (results || []).map(mapSupplierPaymentAllocationRowToDTO)
  }

  async executeAtomicBatch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    return this.db.batch(statements)
  }
}

