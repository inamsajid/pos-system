import type {
  PurchaseRow,
  PurchaseItemRow,
  PurchaseDTO,
  PurchaseItemDTO,
  SupplierSnapshot,
  PurchaseFilterParams,
} from './purchases.types'

export function mapPurchaseRowToDTO(row: PurchaseRow, items?: PurchaseItemDTO[]): PurchaseDTO {
  let supplierSnapshot: SupplierSnapshot | undefined
  if (row.supplier_snapshot_json) {
    try {
      supplierSnapshot = JSON.parse(row.supplier_snapshot_json)
    } catch {
      // ignore JSON parse error
    }
  }

  const remaining = Math.max(0, row.total_amount_minor - (row.paid_amount_minor ?? 0))

  return {
    id: row.id,
    businessId: row.business_id,
    branchId: row.branch_id,
    branchName: row.branch_name,
    purchaseNumber: row.purchase_number,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name ?? supplierSnapshot?.name,
    supplierSnapshot,
    supplierInvoiceNumber: row.supplier_invoice_number,
    subtotalMinor: row.subtotal_minor,
    discountMinor: row.discount_minor,
    taxMinor: row.tax_minor,
    totalAmountMinor: row.total_amount_minor,
    paidAmountMinor: row.paid_amount_minor,
    remainingAmountMinor: remaining,
    status: row.status,
    purchaseDateKey: row.purchase_date_key,
    expectedDeliveryDate: row.expected_delivery_date,
    notes: row.notes,
    confirmedAt: row.confirmed_at,
    createdBy: row.created_by,
    creatorName: row.creator_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items,
  }
}

export class PurchasesRepository {
  private readonly db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  private buildWhereClause(
    businessId: string,
    filters: PurchaseFilterParams,
    authorizedBranchIds: string[]
  ): { sql: string; bindings: (string | number)[] } {
    const conditions: string[] = ['p.business_id = ?']
    const bindings: (string | number)[] = [businessId]

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

    if (filters.supplierId) {
      conditions.push('p.supplier_id = ?')
      bindings.push(filters.supplierId)
    }

    if (filters.status && filters.status !== 'all') {
      conditions.push('p.status = ?')
      bindings.push(filters.status)
    }

    if (filters.startDate) {
      conditions.push('p.purchase_date_key >= ?')
      bindings.push(filters.startDate)
    }

    if (filters.endDate) {
      conditions.push('p.purchase_date_key <= ?')
      bindings.push(filters.endDate)
    }

    if (filters.search && filters.search.trim().length > 0) {
      const term = `%${filters.search.trim()}%`
      conditions.push('(p.purchase_number LIKE ? OR s.name LIKE ? OR p.supplier_invoice_number LIKE ?)')
      bindings.push(term, term, term)
    }

    return { sql: conditions.join(' AND '), bindings }
  }

  async countPurchases(
    businessId: string,
    filters: PurchaseFilterParams,
    authorizedBranchIds: string[]
  ): Promise<number> {
    const { sql, bindings } = this.buildWhereClause(businessId, filters, authorizedBranchIds)
    const query = `
      SELECT COUNT(*) as cnt
      FROM purchases p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE ${sql}
    `
    const res = await this.db.prepare(query).bind(...bindings).first<{ cnt: number }>()
    return res?.cnt ?? 0
  }

  async listPurchases(
    businessId: string,
    filters: PurchaseFilterParams,
    authorizedBranchIds: string[]
  ): Promise<PurchaseDTO[]> {
    const { sql, bindings } = this.buildWhereClause(businessId, filters, authorizedBranchIds)
    const offset = (filters.page - 1) * filters.limit

    const query = `
      SELECT p.*, s.name as supplier_name, b.name as branch_name, u.name as creator_name
      FROM purchases p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN branches b ON p.branch_id = b.id
      LEFT JOIN users u ON p.created_by = u.id
      WHERE ${sql}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `
    const rows = await this.db
      .prepare(query)
      .bind(...bindings, filters.limit, offset)
      .all<PurchaseRow>()

    return (rows.results || []).map((r) => mapPurchaseRowToDTO(r))
  }

  async getPurchaseById(
    businessId: string,
    purchaseId: string,
    authorizedBranchIds: string[]
  ): Promise<PurchaseDTO | null> {
    if (authorizedBranchIds.length === 0) {
      return null
    }

    const branchFilter = `AND p.branch_id IN (${authorizedBranchIds.map(() => '?').join(', ')})`

    const query = `
      SELECT p.*, s.name as supplier_name, b.name as branch_name, u.name as creator_name
      FROM purchases p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN branches b ON p.branch_id = b.id
      LEFT JOIN users u ON p.created_by = u.id
      WHERE p.business_id = ? AND p.id = ? ${branchFilter}
      LIMIT 1
    `
    const bindings = [businessId, purchaseId, ...authorizedBranchIds]
    const row = await this.db.prepare(query).bind(...bindings).first<PurchaseRow>()

    if (!row) return null

    // Load items
    const itemsRes = await this.db
      .prepare(
        `SELECT id, purchase_id, product_id, sku, product_name, unit, ordered_quantity,
                received_quantity, unit_cost_minor, discount_minor, line_total_minor
         FROM purchase_items
         WHERE purchase_id = ?
         ORDER BY id ASC`
      )
      .bind(row.id)
      .all<PurchaseItemRow>()

    const items: PurchaseItemDTO[] = (itemsRes.results || []).map((it) => ({
      id: it.id,
      purchaseId: it.purchase_id,
      productId: it.product_id,
      productName: it.product_name,
      sku: it.sku,
      unit: it.unit,
      orderedQuantity: it.ordered_quantity,
      receivedQuantity: it.received_quantity,
      remainingQuantity: Math.max(0, it.ordered_quantity - it.received_quantity),
      unitCostMinor: it.unit_cost_minor,
      discountMinor: it.discount_minor,
      lineTotalMinor: it.line_total_minor,
    }))

    const dto = mapPurchaseRowToDTO(row, items)

    // Load receipts summary
    const receiptsRes = await this.db
      .prepare(
        `SELECT gr.id, gr.receipt_number, gr.received_at,
                (SELECT COUNT(*) FROM goods_receipt_items gri WHERE gri.receipt_id = gr.id) as items_count
         FROM goods_receipts gr
         WHERE gr.purchase_id = ?
         ORDER BY gr.received_at ASC`
      )
      .bind(row.id)
      .all<{ id: string; receipt_number: string; received_at: string; items_count: number }>()

    dto.receipts = (receiptsRes.results || []).map((r) => ({
      id: r.id,
      receiptNumber: r.receipt_number,
      receivedAt: r.received_at,
      itemsCount: r.items_count,
    }))

    // Load payment allocations summary
    const allocRes = await this.db
      .prepare(
        `SELECT id, payment_id, amount_minor, allocated_at
         FROM supplier_payment_allocations
         WHERE purchase_id = ?
         ORDER BY allocated_at ASC`
      )
      .bind(row.id)
      .all<{ id: string; payment_id: string; amount_minor: number; allocated_at: string }>()

    dto.allocations = (allocRes.results || []).map((a) => ({
      id: a.id,
      paymentId: a.payment_id,
      amountMinor: a.amount_minor,
      allocatedAt: a.allocated_at,
    }))

    return dto
  }

  async executeAtomicBatch(statements: D1PreparedStatement[]): Promise<void> {
    await this.db.batch(statements)
  }
}
