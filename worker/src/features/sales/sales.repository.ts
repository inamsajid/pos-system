import type {
  SaleRow,
  SaleItemRow,
  SaleFilterParams,
  SaleDTO,
  SaleItemDTO,
  SalePaymentDTO,
} from './sales.types'

export function mapSaleRowToDTO(
  row: SaleRow,
  items: SaleItemRow[] = [],
  payments: SalePaymentDTO[] = []
): SaleDTO {
  let customerSnapshot = {
    id: row.customer_id,
    name: 'Walk-in Customer',
    isWalkIn: true,
  }
  try {
    customerSnapshot = JSON.parse(row.customer_snapshot_json)
  } catch {
    // fallback
  }

  const mappedItems: SaleItemDTO[] = items.map((i) => ({
    id: i.id,
    productId: i.product_id,
    sku: i.sku,
    productName: i.product_name,
    unit: i.unit,
    unitPriceMinor: i.unit_price_minor,
    originalUnitPriceMinor: i.original_unit_price_minor ?? null,
    priceOverrideReason: i.price_override_reason ?? null,
    priceOverrideBy: i.price_override_by ?? null,
    priceOverrideAt: i.price_override_at ?? null,
    unitCostMinor: i.unit_cost_minor,
    cogsEstimated: Boolean(i.cogs_estimated),
    quantity: i.quantity,
    subtotalMinor: i.subtotal_minor,
    discountMinor: i.discount_minor,
    taxMinor: i.tax_minor,
    lineTotalMinor: i.line_total_minor,
    returnedQuantity: i.returned_quantity,
  }))

  return {
    id: row.id,
    businessId: row.business_id,
    branchId: row.branch_id,
    saleNumber: row.sale_number,
    receiptNumber: row.receipt_number,
    invoiceNumber: row.invoice_number,
    customerId: row.customer_id,
    customerSnapshot,
    terminalId: row.terminal_id,
    cashierId: row.cashier_id,
    cashierName: row.cashier_name,
    subtotalMinor: row.subtotal_minor,
    discountType: row.discount_type,
    discountValue: row.discount_value,
    discountMinor: row.discount_minor,
    taxMinor: row.tax_minor,
    totalAmountMinor: row.total_amount_minor,
    amountPaidMinor: row.amount_paid_minor,
    remainingBalanceMinor: row.remaining_balance_minor,
    changeReturnedMinor: row.change_returned_minor,
    status: row.status,
    businessDateKey: row.business_date_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: mappedItems,
    payments,
  }
}

export class SalesRepository {
  private readonly db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  private buildFilterClauses(
    businessId: string,
    filters: SaleFilterParams,
    authorizedBranchIds: string[]
  ): { whereSql: string; params: unknown[] } {
    const clauses: string[] = ['s.business_id = ?']
    const params: unknown[] = [businessId]

    // Branch scoping: user must have access to branch
    if (authorizedBranchIds.length === 0) {
      clauses.push('1 = 0') // No accessible branches
    } else if (filters.branchId) {
      if (authorizedBranchIds.includes(filters.branchId)) {
        clauses.push('s.branch_id = ?')
        params.push(filters.branchId)
      } else {
        clauses.push('1 = 0') // Requested unauthorized branch
      }
    } else if (authorizedBranchIds.length === 1) {
      clauses.push('s.branch_id = ?')
      params.push(authorizedBranchIds[0])
    } else {
      const placeholders = authorizedBranchIds.map(() => '?').join(', ')
      clauses.push(`s.branch_id IN (${placeholders})`)
      params.push(...authorizedBranchIds)
    }

    if (filters.customerId) {
      clauses.push('s.customer_id = ?')
      params.push(filters.customerId)
    }

    if (filters.status && filters.status !== 'all') {
      clauses.push('s.status = ?')
      params.push(filters.status)
    }

    if (filters.startDate && filters.endDate) {
      clauses.push('s.business_date_key BETWEEN ? AND ?')
      params.push(filters.startDate, filters.endDate)
    } else if (filters.startDate) {
      clauses.push('s.business_date_key >= ?')
      params.push(filters.startDate)
    } else if (filters.endDate) {
      clauses.push('s.business_date_key <= ?')
      params.push(filters.endDate)
    }

    return {
      whereSql: clauses.join(' AND '),
      params,
    }
  }

  async countSales(
    businessId: string,
    filters: SaleFilterParams,
    authorizedBranchIds: string[]
  ): Promise<number> {
    const { whereSql, params } = this.buildFilterClauses(businessId, filters, authorizedBranchIds)
    const sql = `
      SELECT COUNT(*) AS total
      FROM sales s
      WHERE ${whereSql}
    `
    const res = await this.db.prepare(sql).bind(...params).first<{ total: number }>()
    return res?.total ?? 0
  }

  async listSales(
    businessId: string,
    filters: SaleFilterParams,
    authorizedBranchIds: string[]
  ): Promise<SaleDTO[]> {
    const { whereSql, params } = this.buildFilterClauses(businessId, filters, authorizedBranchIds)

    let sortCol = 's.created_at'
    if (filters.sortBy === 'total_amount') sortCol = 's.total_amount_minor'
    if (filters.sortBy === 'sale_number') sortCol = 's.sale_number'
    const sortDir = filters.sortOrder === 'asc' ? 'ASC' : 'DESC'
    const offset = (filters.page - 1) * filters.limit

    const sql = `
      SELECT 
        s.id,
        s.business_id,
        s.branch_id,
        s.sale_number,
        s.receipt_number,
        s.invoice_number,
        s.customer_id,
        s.customer_snapshot_json,
        s.terminal_id,
        s.cashier_id,
        s.cashier_name,
        s.subtotal_minor,
        s.discount_type,
        s.discount_value,
        s.discount_minor,
        s.tax_minor,
        s.total_amount_minor,
        s.amount_paid_minor,
        s.remaining_balance_minor,
        s.change_returned_minor,
        s.status,
        s.business_date_key,
        s.idempotency_key,
        s.created_at,
        s.updated_at
      FROM sales s
      WHERE ${whereSql}
      ORDER BY ${sortCol} ${sortDir}
      LIMIT ? OFFSET ?
    `
    const saleParams = [...params, filters.limit, offset]
    const saleRows = await this.db.prepare(sql).bind(...saleParams).all<SaleRow>()
    const sales = saleRows.results || []

    if (sales.length === 0) {
      return []
    }

    // Fetch line items for these sales
    const saleIds = sales.map((s) => s.id)
    const placeholders = saleIds.map(() => '?').join(', ')
    const itemsSql = `
      SELECT 
        id,
        sale_id,
        product_id,
        sku,
        product_name,
        unit,
        unit_price_minor,
        original_unit_price_minor,
        price_override_reason,
        price_override_by,
        price_override_at,
        unit_cost_minor,
        cogs_estimated,
        quantity,
        subtotal_minor,
        discount_minor,
        tax_minor,
        line_total_minor,
        returned_quantity
      FROM sale_items
      WHERE sale_id IN (${placeholders})
    `
    const itemsResult = await this.db.prepare(itemsSql).bind(...saleIds).all<SaleItemRow>()
    const allItems = itemsResult.results || []

    const itemsBySale = new Map<string, SaleItemRow[]>()
    for (const item of allItems) {
      const list = itemsBySale.get(item.sale_id) || []
      list.push(item)
      itemsBySale.set(item.sale_id, list)
    }

    return sales.map((sale) => mapSaleRowToDTO(sale, itemsBySale.get(sale.id) || []))
  }

  async getSaleById(
    businessId: string,
    saleId: string,
    authorizedBranchIds: string[]
  ): Promise<SaleDTO | null> {
    let branchClause = ''
    const params: unknown[] = [businessId, saleId]

    if (authorizedBranchIds.length === 0) {
      return null
    } else if (authorizedBranchIds.length === 1) {
      branchClause = 'AND s.branch_id = ?'
      params.push(authorizedBranchIds[0])
    } else {
      const placeholders = authorizedBranchIds.map(() => '?').join(', ')
      branchClause = `AND s.branch_id IN (${placeholders})`
      params.push(...authorizedBranchIds)
    }

    const sql = `
      SELECT 
        s.id,
        s.business_id,
        s.branch_id,
        s.sale_number,
        s.receipt_number,
        s.invoice_number,
        s.customer_id,
        s.customer_snapshot_json,
        s.terminal_id,
        s.cashier_id,
        s.cashier_name,
        s.subtotal_minor,
        s.discount_type,
        s.discount_value,
        s.discount_minor,
        s.tax_minor,
        s.total_amount_minor,
        s.amount_paid_minor,
        s.remaining_balance_minor,
        s.change_returned_minor,
        s.status,
        s.business_date_key,
        s.idempotency_key,
        s.created_at,
        s.updated_at
      FROM sales s
      WHERE s.business_id = ? AND s.id = ? ${branchClause}
      LIMIT 1
    `
    const saleRow = await this.db.prepare(sql).bind(...params).first<SaleRow>()
    if (!saleRow) return null

    // Fetch line items
    const itemsSql = `
      SELECT 
        id,
        sale_id,
        product_id,
        sku,
        product_name,
        unit,
        unit_price_minor,
        original_unit_price_minor,
        price_override_reason,
        price_override_by,
        price_override_at,
        unit_cost_minor,
        cogs_estimated,
        quantity,
        subtotal_minor,
        discount_minor,
        tax_minor,
        line_total_minor,
        returned_quantity
      FROM sale_items
      WHERE sale_id = ?
    `
    const itemsResult = await this.db.prepare(itemsSql).bind(saleId).all<SaleItemRow>()

    // Fetch payment methods linked via payment_allocations -> payments -> payment_methods
    const paymentsSql = `
      SELECT pm.method, pm.amount_minor, pm.reference
      FROM payment_allocations pa
      JOIN payment_methods pm ON pm.payment_id = pa.payment_id
      WHERE pa.sale_id = ? AND pa.business_id = ?
    `
    const paymentsResult = await this.db
      .prepare(paymentsSql)
      .bind(saleId, businessId)
      .all<{ method: string; amount_minor: number; reference: string | null }>()

    const payments: SalePaymentDTO[] = (paymentsResult.results || []).map((p) => ({
      method: p.method as SalePaymentDTO['method'],
      amountMinor: p.amount_minor,
      reference: p.reference,
    }))

    return mapSaleRowToDTO(saleRow, itemsResult.results || [], payments)
  }

  async executeAtomicBatch(statements: D1PreparedStatement[]): Promise<unknown[]> {
    return this.db.batch(statements)
  }
}

