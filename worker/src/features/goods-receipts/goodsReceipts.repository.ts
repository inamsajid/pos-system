import type {
  GoodsReceiptRow,
  GoodsReceiptItemRow,
  GoodsReceiptDTO,
  GoodsReceiptItemDTO,
  GoodsReceiptFilterParams,
} from './goodsReceipts.types'

export function mapReceiptRowToDTO(
  row: GoodsReceiptRow,
  items?: GoodsReceiptItemDTO[]
): GoodsReceiptDTO {
  return {
    id: row.id,
    businessId: row.business_id,
    branchId: row.branch_id,
    branchName: row.branch_name,
    receiptNumber: row.receipt_number,
    purchaseId: row.purchase_id,
    purchaseNumber: row.purchase_number,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    notes: row.notes,
    businessDateKey: row.business_date_key,
    receivedBy: row.received_by,
    receivedByName: row.receiver_name,
    receivedAt: row.received_at,
    createdAt: row.created_at,
    items,
  }
}

export class GoodsReceiptsRepository {
  private readonly db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  private buildWhereClause(
    businessId: string,
    filters: GoodsReceiptFilterParams,
    authorizedBranchIds: string[]
  ): { sql: string; bindings: (string | number)[] } {
    const conditions: string[] = ['gr.business_id = ?']
    const bindings: (string | number)[] = [businessId]

    if (authorizedBranchIds.length === 0) {
      conditions.push('1 = 0')
    } else if (filters.branchId) {
      if (!authorizedBranchIds.includes(filters.branchId)) {
        conditions.push('1 = 0')
      } else {
        conditions.push('gr.branch_id = ?')
        bindings.push(filters.branchId)
      }
    } else {
      const placeholders = authorizedBranchIds.map(() => '?').join(', ')
      conditions.push(`gr.branch_id IN (${placeholders})`)
      bindings.push(...authorizedBranchIds)
    }

    if (filters.supplierId) {
      conditions.push('gr.supplier_id = ?')
      bindings.push(filters.supplierId)
    }

    if (filters.purchaseId) {
      conditions.push('gr.purchase_id = ?')
      bindings.push(filters.purchaseId)
    }

    if (filters.startDate) {
      conditions.push('gr.business_date_key >= ?')
      bindings.push(filters.startDate)
    }

    if (filters.endDate) {
      conditions.push('gr.business_date_key <= ?')
      bindings.push(filters.endDate)
    }

    return { sql: conditions.join(' AND '), bindings }
  }

  async countGoodsReceipts(
    businessId: string,
    filters: GoodsReceiptFilterParams,
    authorizedBranchIds: string[]
  ): Promise<number> {
    const { sql, bindings } = this.buildWhereClause(businessId, filters, authorizedBranchIds)
    const query = `
      SELECT COUNT(*) as cnt
      FROM goods_receipts gr
      WHERE ${sql}
    `
    const res = await this.db.prepare(query).bind(...bindings).first<{ cnt: number }>()
    return res?.cnt ?? 0
  }

  async listGoodsReceipts(
    businessId: string,
    filters: GoodsReceiptFilterParams,
    authorizedBranchIds: string[]
  ): Promise<GoodsReceiptDTO[]> {
    const { sql, bindings } = this.buildWhereClause(businessId, filters, authorizedBranchIds)
    const offset = (filters.page - 1) * filters.limit

    const query = `
      SELECT gr.*, s.name as supplier_name, b.name as branch_name, u.name as receiver_name,
             p.purchase_number
      FROM goods_receipts gr
      LEFT JOIN suppliers s ON gr.supplier_id = s.id
      LEFT JOIN branches b ON gr.branch_id = b.id
      LEFT JOIN users u ON gr.received_by = u.id
      LEFT JOIN purchases p ON gr.purchase_id = p.id
      WHERE ${sql}
      ORDER BY gr.created_at DESC
      LIMIT ? OFFSET ?
    `
    const rows = await this.db
      .prepare(query)
      .bind(...bindings, filters.limit, offset)
      .all<GoodsReceiptRow>()

    return (rows.results || []).map((r) => mapReceiptRowToDTO(r))
  }

  async getGoodsReceiptById(
    businessId: string,
    receiptId: string,
    authorizedBranchIds: string[]
  ): Promise<GoodsReceiptDTO | null> {
    if (authorizedBranchIds.length === 0) {
      return null
    }

    const branchFilter = `AND gr.branch_id IN (${authorizedBranchIds.map(() => '?').join(', ')})`

    const query = `
      SELECT gr.*, s.name as supplier_name, b.name as branch_name, u.name as receiver_name,
             p.purchase_number
      FROM goods_receipts gr
      LEFT JOIN suppliers s ON gr.supplier_id = s.id
      LEFT JOIN branches b ON gr.branch_id = b.id
      LEFT JOIN users u ON gr.received_by = u.id
      LEFT JOIN purchases p ON gr.purchase_id = p.id
      WHERE gr.business_id = ? AND gr.id = ? ${branchFilter}
      LIMIT 1
    `
    const bindings = [businessId, receiptId, ...authorizedBranchIds]
    const row = await this.db.prepare(query).bind(...bindings).first<GoodsReceiptRow>()

    if (!row) return null

    const itemsRes = await this.db
      .prepare(
        `SELECT gri.*, p.name as product_name, p.sku, p.unit
         FROM goods_receipt_items gri
         INNER JOIN products p ON gri.product_id = p.id
         WHERE gri.receipt_id = ?
         ORDER BY gri.id ASC`
      )
      .bind(row.id)
      .all<GoodsReceiptItemRow>()

    const items: GoodsReceiptItemDTO[] = (itemsRes.results || []).map((it) => ({
      id: it.id,
      receiptId: it.receipt_id,
      purchaseItemId: it.purchase_item_id,
      productId: it.product_id,
      productName: it.product_name || 'Unknown Product',
      sku: it.sku || '',
      unit: it.unit || 'piece',
      quantityReceived: it.quantity_received,
      unitCostMinor: it.unit_cost_minor,
      lineTotalMinor: Math.round(it.quantity_received * it.unit_cost_minor),
    }))

    return mapReceiptRowToDTO(row, items)
  }

  async executeAtomicBatch(statements: D1PreparedStatement[]): Promise<void> {
    await this.db.batch(statements)
  }
}

