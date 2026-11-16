import type {
  PaymentRow,
  PaymentMethodRow,
  PaymentAllocationRow,
  CustomerPaymentDTO,
  PaymentMethodEntry,
  PaymentAllocationDTO,
  CustomerPaymentFilterParams,
} from './customerPayments.types'
import type { CustomerSnapshot } from '../sales/sales.types'

export function mapPaymentRowToDTO(
  row: PaymentRow,
  methods: PaymentMethodEntry[] = [],
  allocations?: PaymentAllocationDTO[]
): CustomerPaymentDTO {
  let customerSnapshot: CustomerSnapshot | undefined
  if (row.customer_snapshot_json) {
    try {
      customerSnapshot = JSON.parse(row.customer_snapshot_json)
    } catch {
      // ignore JSON parse error
    }
  }

  return {
    id: row.id,
    businessId: row.business_id,
    branchId: row.branch_id,
    receiptNumber: row.receipt_number,
    customerId: row.customer_id,
    customerName: row.customer_name ?? customerSnapshot?.name,
    customerSnapshot,
    amountMinor: row.amount_minor,
    unallocatedAmountMinor: row.unallocated_amount_minor,
    source: row.source,
    notes: row.notes,
    businessDateKey: row.business_date_key,
    receivedBy: row.received_by,
    receivedByName: row.receiver_name,
    receivedAt: row.received_at,
    status: row.status || 'posted',
    createdAt: row.created_at,
    paymentMethods: methods,
    allocations,
  }
}

export class CustomerPaymentsRepository {
  private readonly db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  private buildWhereClause(
    businessId: string,
    filters: CustomerPaymentFilterParams,
    authorizedBranchIds: string[]
  ): { sql: string; bindings: (string | number)[] } {
    const conditions: string[] = ['p.business_id = ?', "p.status = 'posted'"]
    const bindings: (string | number)[] = [businessId]

    // Branch scoping (fail closed if empty)
    if (authorizedBranchIds.length === 0) {
      conditions.push('1 = 0')
    } else if (filters.branchId) {
      if (!authorizedBranchIds.includes(filters.branchId)) {
        conditions.push('1 = 0')
      } else {
        conditions.push('p.branch_id = ?')
        bindings.push(filters.branchId)
      }
    } else {
      const placeholders = authorizedBranchIds.map(() => '?').join(', ')
      conditions.push(`p.branch_id IN (${placeholders})`)
      bindings.push(...authorizedBranchIds)
    }

    if (filters.customerId) {
      conditions.push('p.customer_id = ?')
      bindings.push(filters.customerId)
    }

    if (filters.startDate) {
      conditions.push('p.business_date_key >= ?')
      bindings.push(filters.startDate)
    }

    if (filters.endDate) {
      conditions.push('p.business_date_key <= ?')
      bindings.push(filters.endDate)
    }

    return { sql: conditions.join(' AND '), bindings }
  }

  async countPayments(
    businessId: string,
    filters: CustomerPaymentFilterParams,
    authorizedBranchIds: string[]
  ): Promise<number> {
    const { sql, bindings } = this.buildWhereClause(businessId, filters, authorizedBranchIds)
    const query = `
      SELECT COUNT(*) as cnt
      FROM payments p
      WHERE ${sql}
    `
    const result = await this.db.prepare(query).bind(...bindings).first<{ cnt: number }>()
    return result?.cnt ?? 0
  }

  async listPayments(
    businessId: string,
    filters: CustomerPaymentFilterParams,
    authorizedBranchIds: string[]
  ): Promise<CustomerPaymentDTO[]> {
    const { sql, bindings } = this.buildWhereClause(businessId, filters, authorizedBranchIds)
    const offset = (filters.page - 1) * filters.limit

    const query = `
      SELECT p.*, c.name as customer_name, u.name as receiver_name
      FROM payments p
      LEFT JOIN customers c ON p.customer_id = c.id
      LEFT JOIN users u ON p.received_by = u.id
      WHERE ${sql}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `
    const rows = await this.db
      .prepare(query)
      .bind(...bindings, filters.limit, offset)
      .all<PaymentRow>()

    const payments = rows.results || []
    if (payments.length === 0) {
      return []
    }

    const paymentIds = payments.map((p) => p.id)
    const placeholders = paymentIds.map(() => '?').join(', ')

    // Fetch methods for these payments
    const methodsRes = await this.db
      .prepare(
        `SELECT id, payment_id, method, amount_minor, reference
         FROM payment_methods
         WHERE payment_id IN (${placeholders})`
      )
      .bind(...paymentIds)
      .all<PaymentMethodRow>()

    const methodsMap = new Map<string, PaymentMethodEntry[]>()
    for (const m of methodsRes.results || []) {
      const arr = methodsMap.get(m.payment_id) || []
      arr.push({
        method: m.method,
        amountMinor: m.amount_minor,
        reference: m.reference,
      })
      methodsMap.set(m.payment_id, arr)
    }

    return payments.map((row) => mapPaymentRowToDTO(row, methodsMap.get(row.id) || []))
  }

  async getPaymentById(
    businessId: string,
    paymentId: string,
    authorizedBranchIds: string[]
  ): Promise<CustomerPaymentDTO | null> {
    if (authorizedBranchIds.length === 0) {
      return null
    }

    const branchFilter = `AND p.branch_id IN (${authorizedBranchIds.map(() => '?').join(', ')})`

    const query = `
      SELECT p.*, c.name as customer_name, u.name as receiver_name
      FROM payments p
      LEFT JOIN customers c ON p.customer_id = c.id
      LEFT JOIN users u ON p.received_by = u.id
      WHERE p.business_id = ? AND p.id = ? ${branchFilter}
      LIMIT 1
    `
    const bindings = [businessId, paymentId, ...authorizedBranchIds]
    const row = await this.db.prepare(query).bind(...bindings).first<PaymentRow>()

    if (!row) {
      return null
    }

    // Fetch methods
    const methodsRes = await this.db
      .prepare(
        `SELECT id, payment_id, method, amount_minor, reference
         FROM payment_methods
         WHERE payment_id = ?`
      )
      .bind(paymentId)
      .all<PaymentMethodRow>()

    const methods: PaymentMethodEntry[] = (methodsRes.results || []).map((m) => ({
      method: m.method,
      amountMinor: m.amount_minor,
      reference: m.reference,
    }))

    // Fetch allocations
    const allocRes = await this.db
      .prepare(
        `SELECT id, payment_id, sale_id, invoice_number, amount_minor, allocated_at
         FROM payment_allocations
         WHERE business_id = ? AND payment_id = ?
         ORDER BY allocated_at ASC`
      )
      .bind(businessId, paymentId)
      .all<PaymentAllocationRow>()

    const allocations: PaymentAllocationDTO[] = (allocRes.results || []).map((a) => ({
      id: a.id,
      paymentId: a.payment_id,
      saleId: a.sale_id,
      invoiceNumber: a.invoice_number,
      amountMinor: a.amount_minor,
      allocatedAt: a.allocated_at,
    }))

    return mapPaymentRowToDTO(row, methods, allocations)
  }

  async getAllocationsByPaymentId(
    businessId: string,
    paymentId: string
  ): Promise<PaymentAllocationDTO[]> {
    const allocRes = await this.db
      .prepare(
        `SELECT id, payment_id, sale_id, invoice_number, amount_minor, allocated_at
         FROM payment_allocations
         WHERE business_id = ? AND payment_id = ?
         ORDER BY allocated_at ASC`
      )
      .bind(businessId, paymentId)
      .all<PaymentAllocationRow>()

    return (allocRes.results || []).map((a) => ({
      id: a.id,
      paymentId: a.payment_id,
      saleId: a.sale_id,
      invoiceNumber: a.invoice_number,
      amountMinor: a.amount_minor,
      allocatedAt: a.allocated_at,
    }))
  }

  async executeAtomicBatch(statements: D1PreparedStatement[]): Promise<void> {
    await this.db.batch(statements)
  }
}
