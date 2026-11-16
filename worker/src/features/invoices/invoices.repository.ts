import type {
  InvoiceRow,
  InvoiceDTO,
  InvoiceFilterParams,
} from './invoices.types'
import type { CustomerSnapshot } from '../sales/sales.types'

export function mapInvoiceRowToDTO(row: InvoiceRow): InvoiceDTO {
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
    invoiceNumber: row.invoice_number,
    saleId: row.sale_id,
    customerId: row.customer_id,
    customerName: row.customer_name ?? customerSnapshot?.name,
    customerSnapshot,
    businessDateKey: row.business_date_key,
    totalAmountMinor: row.total_amount_minor,
    paidAmountMinor: row.paid_amount_minor,
    remainingAmountMinor: row.remaining_amount_minor,
    paymentStatus: row.payment_status,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class InvoicesRepository {
  private readonly db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  private buildWhereClause(
    businessId: string,
    filters: InvoiceFilterParams,
    authorizedBranchIds: string[]
  ): { sql: string; bindings: (string | number)[] } {
    const conditions: string[] = ['i.business_id = ?']
    const bindings: (string | number)[] = [businessId]

    // Branch scoping (fail closed if empty)
    if (authorizedBranchIds.length === 0) {
      conditions.push('1 = 0')
    } else if (filters.branchId) {
      if (!authorizedBranchIds.includes(filters.branchId)) {
        conditions.push('1 = 0')
      } else {
        conditions.push('i.branch_id = ?')
        bindings.push(filters.branchId)
      }
    } else {
      const placeholders = authorizedBranchIds.map(() => '?').join(', ')
      conditions.push(`i.branch_id IN (${placeholders})`)
      bindings.push(...authorizedBranchIds)
    }

    if (filters.customerId) {
      conditions.push('i.customer_id = ?')
      bindings.push(filters.customerId)
    }

    if (filters.paymentStatus) {
      conditions.push('i.payment_status = ?')
      bindings.push(filters.paymentStatus)
    }

    if (filters.status) {
      conditions.push('i.status = ?')
      bindings.push(filters.status)
    }

    if (filters.startDate) {
      conditions.push('i.business_date_key >= ?')
      bindings.push(filters.startDate)
    }

    if (filters.endDate) {
      conditions.push('i.business_date_key <= ?')
      bindings.push(filters.endDate)
    }

    if (filters.search && filters.search.trim().length > 0) {
      const term = `%${filters.search.trim()}%`
      conditions.push('(i.invoice_number LIKE ? OR c.name LIKE ?)')
      bindings.push(term, term)
    }

    return { sql: conditions.join(' AND '), bindings }
  }

  async countInvoices(
    businessId: string,
    filters: InvoiceFilterParams,
    authorizedBranchIds: string[]
  ): Promise<number> {
    const { sql, bindings } = this.buildWhereClause(businessId, filters, authorizedBranchIds)
    const query = `
      SELECT COUNT(*) as cnt
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id
      WHERE ${sql}
    `
    const result = await this.db.prepare(query).bind(...bindings).first<{ cnt: number }>()
    return result?.cnt ?? 0
  }

  async listInvoices(
    businessId: string,
    filters: InvoiceFilterParams,
    authorizedBranchIds: string[]
  ): Promise<InvoiceDTO[]> {
    const { sql, bindings } = this.buildWhereClause(businessId, filters, authorizedBranchIds)
    const offset = (filters.page - 1) * filters.limit

    const query = `
      SELECT i.*, c.name as customer_name, s.customer_snapshot_json
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id
      LEFT JOIN sales s ON i.sale_id = s.id
      WHERE ${sql}
      ORDER BY i.created_at DESC
      LIMIT ? OFFSET ?
    `
    const rows = await this.db
      .prepare(query)
      .bind(...bindings, filters.limit, offset)
      .all<InvoiceRow>()

    return (rows.results || []).map(mapInvoiceRowToDTO)
  }

  async getInvoiceById(
    businessId: string,
    invoiceId: string,
    authorizedBranchIds: string[]
  ): Promise<InvoiceDTO | null> {
    if (authorizedBranchIds.length === 0) {
      return null
    }

    const branchFilter = `AND i.branch_id IN (${authorizedBranchIds.map(() => '?').join(', ')})`

    const query = `
      SELECT i.*, c.name as customer_name, s.customer_snapshot_json
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id
      LEFT JOIN sales s ON i.sale_id = s.id
      WHERE i.business_id = ? AND i.id = ? ${branchFilter}
      LIMIT 1
    `
    const bindings = [businessId, invoiceId, ...authorizedBranchIds]
    const row = await this.db.prepare(query).bind(...bindings).first<InvoiceRow>()

    if (!row) {
      return null
    }

    const dto = mapInvoiceRowToDTO(row)

    // Load items from sale_items
    const itemsRes = await this.db
      .prepare(
        `SELECT id, sale_id, product_id, product_name, sku, unit, quantity,
                unit_price_minor, unit_cost_minor, cogs_estimated, subtotal_minor, discount_minor, tax_minor, line_total_minor, returned_quantity
         FROM sale_items
         WHERE sale_id = ?
         ORDER BY id ASC`
      )
      .bind(row.sale_id)
      .all<{
        id: string
        sale_id: string
        product_id: string
        product_name: string
        sku: string
        unit: string
        quantity: number
        unit_price_minor: number
        unit_cost_minor: number
        cogs_estimated: number
        subtotal_minor: number
        discount_minor: number
        tax_minor: number
        line_total_minor: number
        returned_quantity: number
      }>()

    dto.items = (itemsRes.results || []).map((it) => ({
      id: it.id,
      productId: it.product_id,
      productName: it.product_name,
      sku: it.sku,
      unit: it.unit,
      quantity: it.quantity,
      unitPriceMinor: it.unit_price_minor,
      unitCostMinor: it.unit_cost_minor,
      cogsEstimated: Boolean(it.cogs_estimated),
      subtotalMinor: it.subtotal_minor,
      discountMinor: it.discount_minor,
      taxMinor: it.tax_minor,
      lineTotalMinor: it.line_total_minor,
      returnedQuantity: it.returned_quantity,
    }))

    // Load payment allocations for this sale / invoice
    const allocRes = await this.db
      .prepare(
        `SELECT pa.id, pa.payment_id, pa.amount_minor, pa.allocated_at,
                p.receipt_number,
                (SELECT pm.method FROM payment_methods pm WHERE pm.payment_id = pa.payment_id LIMIT 1) as method
         FROM payment_allocations pa
         INNER JOIN payments p ON pa.payment_id = p.id
         WHERE pa.business_id = ? AND pa.sale_id = ?
         ORDER BY pa.allocated_at ASC`
      )
      .bind(businessId, row.sale_id)
      .all<{
        id: string
        payment_id: string
        amount_minor: number
        allocated_at: string
        receipt_number: string
        method: string | null
      }>()

    dto.allocations = (allocRes.results || []).map((a) => ({
      id: a.id,
      paymentId: a.payment_id,
      receiptNumber: a.receipt_number,
      amountMinor: a.amount_minor,
      method: a.method || 'cash',
      allocatedAt: a.allocated_at,
    }))

    return dto
  }

  async getInvoiceBySaleId(
    businessId: string,
    saleId: string,
    authorizedBranchIds: string[]
  ): Promise<InvoiceDTO | null> {
    if (authorizedBranchIds.length === 0) {
      return null
    }

    const branchFilter = `AND i.branch_id IN (${authorizedBranchIds.map(() => '?').join(', ')})`

    const query = `
      SELECT i.*, c.name as customer_name, s.customer_snapshot_json
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id
      LEFT JOIN sales s ON i.sale_id = s.id
      WHERE i.business_id = ? AND i.sale_id = ? ${branchFilter}
      LIMIT 1
    `
    const bindings = [businessId, saleId, ...authorizedBranchIds]
    const row = await this.db.prepare(query).bind(...bindings).first<InvoiceRow>()

    if (!row) {
      return null
    }

    return this.getInvoiceById(businessId, row.id, authorizedBranchIds)
  }
}
