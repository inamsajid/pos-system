import type {
  InventoryBalanceRow,
  InventoryBalanceDTO,
  StockMovementRow,
  StockMovementDTO,
  StockCountRow,
  StockCountItemRow,
  StockCountDTO,
  StockCountItemDTO,
  InventoryFilterParams,
  StockMovementFilterParams,
  StockCountFilterParams,
} from './inventory.types'

export function mapBalanceRowToDTO(row: InventoryBalanceRow): InventoryBalanceDTO {
  const minStock = row.min_stock_level ?? 0
  const qoh = row.quantity_on_hand ?? 0
  const alloc = row.allocated_quantity ?? 0
  const available = qoh - alloc
  const isLowStock = minStock > 0 && qoh <= minStock

  return {
    id: row.id,
    businessId: row.business_id,
    branchId: row.branch_id,
    productId: row.product_id,
    productName: row.product_name || 'Unknown Product',
    sku: row.sku || '',
    barcode: row.barcode || null,
    unit: row.unit || 'piece',
    categoryName: row.category_name || null,
    quantityOnHand: qoh,
    quarantineQuantity: row.quarantine_quantity ?? 0,
    allocatedQuantity: alloc,
    availableQuantity: available,
    unitCostMinor: row.purchase_price_minor ?? 0,
    isLowStock,
    lastCountedAt: row.last_counted_at,
    updatedAt: row.updated_at,
  }
}

export function mapMovementRowToDTO(row: StockMovementRow): StockMovementDTO {
  return {
    id: row.id,
    businessId: row.business_id,
    branchId: row.branch_id,
    movementNumber: row.movement_number,
    productId: row.product_id,
    productName: row.product_name,
    sku: row.sku,
    unit: row.unit,
    type: row.type,
    quantityChange: row.quantity_change,
    previousQuantity: row.previous_quantity,
    newQuantity: row.new_quantity,
    unitCostMinor: row.unit_cost_minor,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    referenceNumber: row.reference_number,
    reason: row.reason,
    notes: row.notes,
    businessDateKey: row.business_date_key,
    createdBy: row.created_by,
    creatorName: row.creator_name,
    createdAt: row.created_at,
  }
}

export function mapCountRowToDTO(row: StockCountRow, items?: StockCountItemDTO[]): StockCountDTO {
  return {
    id: row.id,
    businessId: row.business_id,
    branchId: row.branch_id,
    branchName: row.branch_name,
    countNumber: row.count_number,
    name: row.name,
    status: row.status,
    businessDateKey: row.business_date_key,
    confirmedAt: row.confirmed_at,
    confirmedBy: row.confirmer_name || row.confirmed_by,
    createdBy: row.creator_name || row.created_by,
    createdAt: row.created_at,
    items,
  }
}

export class InventoryRepository {
  private readonly db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  // --- BALANCES ---
  private buildBalanceWhere(
    businessId: string,
    filters: InventoryFilterParams,
    authorizedBranchIds: string[]
  ): { sql: string; bindings: (string | number)[] } {
    const conditions: string[] = ['ib.business_id = ?']
    const bindings: (string | number)[] = [businessId]

    if (filters.branchId) {
      if (authorizedBranchIds.length > 0 && !authorizedBranchIds.includes(filters.branchId)) {
        conditions.push('1 = 0')
      } else {
        conditions.push('ib.branch_id = ?')
        bindings.push(filters.branchId)
      }
    } else if (authorizedBranchIds.length > 0) {
      const placeholders = authorizedBranchIds.map(() => '?').join(', ')
      conditions.push(`ib.branch_id IN (${placeholders})`)
      bindings.push(...authorizedBranchIds)
    }

    if (filters.productId) {
      conditions.push('ib.product_id = ?')
      bindings.push(filters.productId)
    }

    if (filters.categoryId) {
      conditions.push('p.category_id = ?')
      bindings.push(filters.categoryId)
    }

    if (filters.search && filters.search.trim().length > 0) {
      const term = `%${filters.search.trim()}%`
      conditions.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)')
      bindings.push(term, term, term)
    }

    if (filters.lowStock) {
      conditions.push('p.low_stock_threshold > 0 AND ib.quantity_on_hand <= p.low_stock_threshold')
    }

    return { sql: conditions.join(' AND '), bindings }
  }

  async countBalances(
    businessId: string,
    filters: InventoryFilterParams,
    authorizedBranchIds: string[]
  ): Promise<number> {
    const { sql, bindings } = this.buildBalanceWhere(businessId, filters, authorizedBranchIds)
    const query = `
      SELECT COUNT(*) as cnt
      FROM inventory_balances ib
      INNER JOIN products p ON ib.product_id = p.id
      WHERE ${sql}
    `
    const res = await this.db.prepare(query).bind(...bindings).first<{ cnt: number }>()
    return res?.cnt ?? 0
  }

  async listBalances(
    businessId: string,
    filters: InventoryFilterParams,
    authorizedBranchIds: string[]
  ): Promise<InventoryBalanceDTO[]> {
    const { sql, bindings } = this.buildBalanceWhere(businessId, filters, authorizedBranchIds)
    const offset = (filters.page - 1) * filters.limit

    const query = `
      SELECT ib.*, p.name as product_name, p.sku, p.barcode, p.unit, p.purchase_price_minor, p.low_stock_threshold as min_stock_level,
             c.name as category_name
      FROM inventory_balances ib
      INNER JOIN products p ON ib.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE ${sql}
      ORDER BY p.name ASC, ib.branch_id ASC
      LIMIT ? OFFSET ?
    `
    const rows = await this.db
      .prepare(query)
      .bind(...bindings, filters.limit, offset)
      .all<InventoryBalanceRow>()

    return (rows.results || []).map(mapBalanceRowToDTO)
  }

  async getProductBalancesByBranch(
    businessId: string,
    productId: string,
    authorizedBranchIds: string[]
  ): Promise<InventoryBalanceDTO[]> {
    const branchFilter =
      authorizedBranchIds.length > 0
        ? `AND ib.branch_id IN (${authorizedBranchIds.map(() => '?').join(', ')})`
        : ''

    const query = `
      SELECT ib.*, p.name as product_name, p.sku, p.barcode, p.unit, p.purchase_price_minor, p.low_stock_threshold as min_stock_level,
             c.name as category_name
      FROM inventory_balances ib
      INNER JOIN products p ON ib.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE ib.business_id = ? AND ib.product_id = ? ${branchFilter}
      ORDER BY ib.branch_id ASC
    `
    const bindings = [businessId, productId, ...authorizedBranchIds]
    const rows = await this.db.prepare(query).bind(...bindings).all<InventoryBalanceRow>()

    return (rows.results || []).map(mapBalanceRowToDTO)
  }

  // --- MOVEMENTS ---
  private buildMovementWhere(
    businessId: string,
    filters: StockMovementFilterParams,
    authorizedBranchIds: string[]
  ): { sql: string; bindings: (string | number)[] } {
    const conditions: string[] = ['sm.business_id = ?']
    const bindings: (string | number)[] = [businessId]

    if (filters.branchId) {
      if (authorizedBranchIds.length > 0 && !authorizedBranchIds.includes(filters.branchId)) {
        conditions.push('1 = 0')
      } else {
        conditions.push('sm.branch_id = ?')
        bindings.push(filters.branchId)
      }
    } else if (authorizedBranchIds.length > 0) {
      const placeholders = authorizedBranchIds.map(() => '?').join(', ')
      conditions.push(`sm.branch_id IN (${placeholders})`)
      bindings.push(...authorizedBranchIds)
    }

    if (filters.productId) {
      conditions.push('sm.product_id = ?')
      bindings.push(filters.productId)
    }

    if (filters.type) {
      conditions.push('sm.type = ?')
      bindings.push(filters.type)
    }

    if (filters.referenceType) {
      conditions.push('sm.reference_type = ?')
      bindings.push(filters.referenceType)
    }

    if (filters.startDate) {
      conditions.push('sm.business_date_key >= ?')
      bindings.push(filters.startDate)
    }

    if (filters.endDate) {
      conditions.push('sm.business_date_key <= ?')
      bindings.push(filters.endDate)
    }

    return { sql: conditions.join(' AND '), bindings }
  }

  async countMovements(
    businessId: string,
    filters: StockMovementFilterParams,
    authorizedBranchIds: string[]
  ): Promise<number> {
    const { sql, bindings } = this.buildMovementWhere(businessId, filters, authorizedBranchIds)
    const query = `SELECT COUNT(*) as cnt FROM stock_movements sm WHERE ${sql}`
    const res = await this.db.prepare(query).bind(...bindings).first<{ cnt: number }>()
    return res?.cnt ?? 0
  }

  async listMovements(
    businessId: string,
    filters: StockMovementFilterParams,
    authorizedBranchIds: string[]
  ): Promise<StockMovementDTO[]> {
    const { sql, bindings } = this.buildMovementWhere(businessId, filters, authorizedBranchIds)
    const offset = (filters.page - 1) * filters.limit

    const query = `
      SELECT sm.*, p.name as product_name, p.sku, p.unit, u.name as creator_name
      FROM stock_movements sm
      INNER JOIN products p ON sm.product_id = p.id
      LEFT JOIN users u ON sm.created_by = u.id
      WHERE ${sql}
      ORDER BY sm.created_at DESC, sm.id DESC
      LIMIT ? OFFSET ?
    `
    const rows = await this.db
      .prepare(query)
      .bind(...bindings, filters.limit, offset)
      .all<StockMovementRow>()

    return (rows.results || []).map(mapMovementRowToDTO)
  }

  // --- COUNTS ---
  private buildCountWhere(
    businessId: string,
    filters: StockCountFilterParams,
    authorizedBranchIds: string[]
  ): { sql: string; bindings: (string | number)[] } {
    const conditions: string[] = ['sc.business_id = ?']
    const bindings: (string | number)[] = [businessId]

    if (filters.branchId) {
      if (authorizedBranchIds.length > 0 && !authorizedBranchIds.includes(filters.branchId)) {
        conditions.push('1 = 0')
      } else {
        conditions.push('sc.branch_id = ?')
        bindings.push(filters.branchId)
      }
    } else if (authorizedBranchIds.length > 0) {
      const placeholders = authorizedBranchIds.map(() => '?').join(', ')
      conditions.push(`sc.branch_id IN (${placeholders})`)
      bindings.push(...authorizedBranchIds)
    }

    if (filters.status && filters.status !== 'all') {
      conditions.push('sc.status = ?')
      bindings.push(filters.status)
    }

    return { sql: conditions.join(' AND '), bindings }
  }

  async countCounts(
    businessId: string,
    filters: StockCountFilterParams,
    authorizedBranchIds: string[]
  ): Promise<number> {
    const { sql, bindings } = this.buildCountWhere(businessId, filters, authorizedBranchIds)
    const query = `SELECT COUNT(*) as cnt FROM stock_counts sc WHERE ${sql}`
    const res = await this.db.prepare(query).bind(...bindings).first<{ cnt: number }>()
    return res?.cnt ?? 0
  }

  async listCounts(
    businessId: string,
    filters: StockCountFilterParams,
    authorizedBranchIds: string[]
  ): Promise<StockCountDTO[]> {
    const { sql, bindings } = this.buildCountWhere(businessId, filters, authorizedBranchIds)
    const offset = (filters.page - 1) * filters.limit

    const query = `
      SELECT sc.*, b.name as branch_name, u1.name as creator_name, u2.name as confirmer_name
      FROM stock_counts sc
      INNER JOIN branches b ON sc.branch_id = b.id
      LEFT JOIN users u1 ON sc.created_by = u1.id
      LEFT JOIN users u2 ON sc.confirmed_by = u2.id
      WHERE ${sql}
      ORDER BY sc.created_at DESC
      LIMIT ? OFFSET ?
    `
    const rows = await this.db
      .prepare(query)
      .bind(...bindings, filters.limit, offset)
      .all<StockCountRow>()

    return (rows.results || []).map((r) => mapCountRowToDTO(r))
  }

  async getCountById(
    businessId: string,
    countId: string,
    authorizedBranchIds: string[]
  ): Promise<StockCountDTO | null> {
    const branchFilter =
      authorizedBranchIds.length > 0
        ? `AND sc.branch_id IN (${authorizedBranchIds.map(() => '?').join(', ')})`
        : ''

    const query = `
      SELECT sc.*, b.name as branch_name, u1.name as creator_name, u2.name as confirmer_name
      FROM stock_counts sc
      INNER JOIN branches b ON sc.branch_id = b.id
      LEFT JOIN users u1 ON sc.created_by = u1.id
      LEFT JOIN users u2 ON sc.confirmed_by = u2.id
      WHERE sc.business_id = ? AND sc.id = ? ${branchFilter}
      LIMIT 1
    `
    const bindings = [businessId, countId, ...authorizedBranchIds]
    const row = await this.db.prepare(query).bind(...bindings).first<StockCountRow>()

    if (!row) return null

    const itemsRes = await this.db
      .prepare(
        `SELECT sci.*, p.name as product_name, p.sku, p.unit
         FROM stock_count_items sci
         INNER JOIN products p ON sci.product_id = p.id
         WHERE sci.count_id = ?
         ORDER BY p.name ASC`
      )
      .bind(countId)
      .all<StockCountItemRow>()

    const items: StockCountItemDTO[] = (itemsRes.results || []).map((it) => ({
      id: it.id,
      countId: it.count_id,
      productId: it.product_id,
      productName: it.product_name || 'Unknown Product',
      sku: it.sku || '',
      unit: it.unit || 'piece',
      systemQuantity: it.system_quantity,
      physicalQuantity: it.physical_quantity,
      variance: it.variance,
      unitCostMinor: it.unit_cost_minor,
      notes: it.notes,
    }))

    return mapCountRowToDTO(row, items)
  }

  async executeAtomicBatch(statements: D1PreparedStatement[]): Promise<void> {
    await this.db.batch(statements)
  }
}
