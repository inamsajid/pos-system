import type {
  ProductRow,
  ProductFilterParams,
  CreateProductInput,
  UpdateProductInput,
  ReplaceProductInput,
  ProductSortField,
} from './products.types'
import { ChangeLogRepository } from '../sync/changeLog.repository'

const SORT_COLUMN_MAP: Record<ProductSortField, string> = {
  name: 'p.name',
  sku: 'p.sku',
  selling_price: 'p.selling_price_minor',
  purchase_price: 'p.purchase_price_minor',
  stock: 'stock_quantity',
  created_at: 'p.created_at',
  updated_at: 'p.updated_at',
}

function buildProductStockSubquery(authorizedBranchIds: string[], params: unknown[]): string {
  if (authorizedBranchIds.length === 0) {
    return '0'
  }
  if (authorizedBranchIds.length === 1) {
    params.push(authorizedBranchIds[0])
    return `COALESCE((
      SELECT SUM(ib.quantity_on_hand)
      FROM inventory_balances ib
      WHERE ib.product_id = p.id AND ib.business_id = p.business_id AND ib.branch_id = ?
    ), 0)`
  }
  const placeholders = authorizedBranchIds.map(() => '?').join(', ')
  params.push(...authorizedBranchIds)
  return `COALESCE((
    SELECT SUM(ib.quantity_on_hand)
    FROM inventory_balances ib
    WHERE ib.product_id = p.id AND ib.business_id = p.business_id AND ib.branch_id IN (${placeholders})
  ), 0)`
}

export class ProductsRepository {
  private readonly db: D1Database
  private readonly changeLogRepo: ChangeLogRepository

  constructor(db: D1Database) {
    this.db = db
    this.changeLogRepo = new ChangeLogRepository(db)
  }

  private buildFilterClauses(
    businessId: string,
    filters: ProductFilterParams,
    authorizedBranchIds: string[]
  ): { whereSql: string; params: unknown[] } {
    const clauses: string[] = ['p.business_id = ?']
    const params: unknown[] = [businessId]

    if (filters.search) {
      const term = `%${filters.search.toLowerCase()}%`
      clauses.push("(LOWER(p.name) LIKE ? OR LOWER(p.sku) LIKE ? OR LOWER(COALESCE(p.barcode, '')) LIKE ?)")
      params.push(term, term, term)
    }

    if (filters.sku) {
      clauses.push('LOWER(p.sku) = LOWER(?)')
      params.push(filters.sku.trim())
    }

    if (filters.barcode) {
      clauses.push('LOWER(p.barcode) = LOWER(?)')
      params.push(filters.barcode.trim())
    }

    if (filters.categoryId) {
      clauses.push('p.category_id = ?')
      params.push(filters.categoryId)
    }

    if (filters.status && filters.status !== 'all') {
      clauses.push('p.status = ?')
      params.push(filters.status)
    }

    if (filters.lowStock) {
      if (authorizedBranchIds.length === 0) {
        clauses.push('p.track_inventory = 1 AND 0 <= p.low_stock_threshold')
      } else if (authorizedBranchIds.length === 1) {
        clauses.push(`
          p.track_inventory = 1 AND COALESCE((
            SELECT SUM(ib.quantity_on_hand)
            FROM inventory_balances ib
            WHERE ib.product_id = p.id AND ib.business_id = p.business_id AND ib.branch_id = ?
          ), 0) <= p.low_stock_threshold
        `)
        params.push(authorizedBranchIds[0])
      } else {
        const placeholders = authorizedBranchIds.map(() => '?').join(', ')
        clauses.push(`
          p.track_inventory = 1 AND COALESCE((
            SELECT SUM(ib.quantity_on_hand)
            FROM inventory_balances ib
            WHERE ib.product_id = p.id AND ib.business_id = p.business_id AND ib.branch_id IN (${placeholders})
          ), 0) <= p.low_stock_threshold
        `)
        params.push(...authorizedBranchIds)
      }
    }

    return {
      whereSql: clauses.join(' AND '),
      params,
    }
  }

  async countProducts(
    businessId: string,
    filters: ProductFilterParams,
    authorizedBranchIds: string[] = []
  ): Promise<number> {
    const { whereSql, params } = this.buildFilterClauses(businessId, filters, authorizedBranchIds)
    const sql = `
      SELECT COUNT(*) AS total
      FROM products p
      WHERE ${whereSql}
    `
    const res = await this.db.prepare(sql).bind(...params).first<{ total: number }>()
    return res?.total ?? 0
  }

  async listProducts(
    businessId: string,
    filters: ProductFilterParams,
    authorizedBranchIds: string[] = []
  ): Promise<ProductRow[]> {
    const stockParams: unknown[] = []
    const stockSubquery = buildProductStockSubquery(authorizedBranchIds, stockParams)
    const { whereSql, params: whereParams } = this.buildFilterClauses(businessId, filters, authorizedBranchIds)
    const sortCol = SORT_COLUMN_MAP[filters.sortBy] || 'p.name'
    const sortDir = filters.sortOrder === 'desc' ? 'DESC' : 'ASC'
    const offset = (filters.page - 1) * filters.limit

    const sql = `
      SELECT 
        p.id,
        p.business_id,
        p.category_id,
        c.name AS category_name,
        p.sku,
        p.barcode,
        p.name,
        p.description,
        p.image_url,
        p.unit,
        p.purchase_price_minor,
        p.selling_price_minor,
        p.low_stock_threshold,
        p.track_inventory,
        p.status,
        p.version,
        ${stockSubquery} AS stock_quantity,
        p.created_at,
        p.updated_at
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id AND c.business_id = p.business_id
      WHERE ${whereSql}
      ORDER BY ${sortCol} ${sortDir}
      LIMIT ? OFFSET ?
    `
    const allParams = [...stockParams, ...whereParams, filters.limit, offset]

    const result = await this.db.prepare(sql).bind(...allParams).all<ProductRow>()
    return result.results || []
  }

  async getProductById(
    businessId: string,
    productId: string,
    authorizedBranchIds: string[] = []
  ): Promise<ProductRow | null> {
    const stockParams: unknown[] = []
    const stockSubquery = buildProductStockSubquery(authorizedBranchIds, stockParams)

    const sql = `
      SELECT 
        p.id,
        p.business_id,
        p.category_id,
        c.name AS category_name,
        p.sku,
        p.barcode,
        p.name,
        p.description,
        p.image_url,
        p.unit,
        p.purchase_price_minor,
        p.selling_price_minor,
        p.low_stock_threshold,
        p.track_inventory,
        p.status,
        p.version,
        ${stockSubquery} AS stock_quantity,
        p.created_at,
        p.updated_at
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id AND c.business_id = p.business_id
      WHERE p.business_id = ? AND p.id = ?
      LIMIT 1
    `
    const params = [...stockParams, businessId, productId]
    return this.db.prepare(sql).bind(...params).first<ProductRow>()
  }

  async findProductBySku(businessId: string, sku: string): Promise<{ id: string; sku: string } | null> {
    const sql = `
      SELECT id, sku
      FROM products
      WHERE business_id = ? AND LOWER(sku) = LOWER(?)
      LIMIT 1
    `
    return this.db.prepare(sql).bind(businessId, sku.trim()).first()
  }

  async findProductByBarcode(businessId: string, barcode: string): Promise<{ id: string; barcode: string } | null> {
    const sql = `
      SELECT id, barcode
      FROM products
      WHERE business_id = ? AND LOWER(barcode) = LOWER(?)
      LIMIT 1
    `
    return this.db.prepare(sql).bind(businessId, barcode.trim()).first()
  }

  async createProduct(id: string, businessId: string, input: CreateProductInput): Promise<void> {
    const sql = `
      INSERT INTO products (
        id,
        business_id,
        category_id,
        sku,
        barcode,
        name,
        description,
        image_url,
        unit,
        purchase_price_minor,
        selling_price_minor,
        low_stock_threshold,
        track_inventory,
        status,
        version,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, datetime('now'), datetime('now'))
    `
    const insertStmt = this.db
      .prepare(sql)
      .bind(
        id,
        businessId,
        input.categoryId ?? null,
        input.sku,
        input.barcode ?? null,
        input.name,
        input.description ?? null,
        input.imageUrl ?? null,
        input.unit,
        input.purchasePriceMinor,
        input.sellingPriceMinor,
        input.lowStockThreshold ?? 5.0,
        input.trackInventory ? 1 : 0
      )

    const changeStmt = this.changeLogRepo.createChangeEventStatement({
      businessId,
      resourceType: 'product',
      resourceId: id,
      resourceVersion: 1,
      operation: 'upsert',
      payload: {
        id,
        businessId,
        categoryId: input.categoryId ?? null,
        sku: input.sku,
        barcode: input.barcode ?? null,
        name: input.name,
        description: input.description ?? null,
        imageUrl: input.imageUrl ?? null,
        unit: input.unit,
        sellingPriceMinor: input.sellingPriceMinor,
        lowStockThreshold: input.lowStockThreshold ?? 5.0,
        trackInventory: input.trackInventory !== false,
        status: 'active',
        version: 1,
        updatedAt: new Date().toISOString(),
      },
      eventId: `${businessId}:product:${id}:1`,
    })

    await this.db.batch([insertStmt, changeStmt])
  }

  async updateProduct(
    businessId: string,
    productId: string,
    input: UpdateProductInput,
    currentProduct: ProductRow
  ): Promise<void> {
    const newVersion = (currentProduct.version || 1) + 1
    const setClauses: string[] = ["updated_at = datetime('now')", "version = version + 1"]
    const params: unknown[] = []

    if (input.name !== undefined) {
      setClauses.push('name = ?')
      params.push(input.name)
    }

    if (input.sku !== undefined) {
      setClauses.push('sku = ?')
      params.push(input.sku)
    }

    if (input.barcode !== undefined) {
      setClauses.push('barcode = ?')
      params.push(input.barcode)
    }

    if (input.categoryId !== undefined) {
      setClauses.push('category_id = ?')
      params.push(input.categoryId)
    }

    if (input.description !== undefined) {
      setClauses.push('description = ?')
      params.push(input.description)
    }

    if (input.imageUrl !== undefined) {
      setClauses.push('image_url = ?')
      params.push(input.imageUrl)
    }

    if (input.unit !== undefined) {
      setClauses.push('unit = ?')
      params.push(input.unit)
    }

    if (input.purchasePriceMinor !== undefined) {
      setClauses.push('purchase_price_minor = ?')
      params.push(input.purchasePriceMinor)
    }

    if (input.sellingPriceMinor !== undefined) {
      setClauses.push('selling_price_minor = ?')
      params.push(input.sellingPriceMinor)
    }

    if (input.lowStockThreshold !== undefined) {
      setClauses.push('low_stock_threshold = ?')
      params.push(input.lowStockThreshold)
    }

    if (input.trackInventory !== undefined) {
      setClauses.push('track_inventory = ?')
      params.push(input.trackInventory ? 1 : 0)
    }

    if (input.status !== undefined) {
      setClauses.push('status = ?')
      params.push(input.status)
    }

    let sql = `
      UPDATE products
      SET ${setClauses.join(', ')}
      WHERE business_id = ? AND id = ?
    `
    params.push(businessId, productId)

    if (input.expectedVersion !== undefined) {
      sql += ' AND version = ?'
      params.push(input.expectedVersion)
    }

    const updateStmt = this.db.prepare(sql).bind(...params)

    const finalStatus = input.status !== undefined ? input.status : currentProduct.status
    const changeStmt = this.changeLogRepo.createChangeEventStatement({
      businessId,
      resourceType: 'product',
      resourceId: productId,
      resourceVersion: newVersion,
      operation: finalStatus === 'archived' ? 'archive' : 'upsert',
      payload: {
        id: productId,
        businessId,
        categoryId: input.categoryId !== undefined ? input.categoryId : currentProduct.category_id,
        sku: input.sku !== undefined ? input.sku : currentProduct.sku,
        barcode: input.barcode !== undefined ? input.barcode : currentProduct.barcode,
        name: input.name !== undefined ? input.name : currentProduct.name,
        description: input.description !== undefined ? input.description : currentProduct.description,
        imageUrl: input.imageUrl !== undefined ? input.imageUrl : currentProduct.image_url,
        unit: input.unit !== undefined ? input.unit : currentProduct.unit,
        sellingPriceMinor: input.sellingPriceMinor !== undefined ? input.sellingPriceMinor : currentProduct.selling_price_minor,
        lowStockThreshold: input.lowStockThreshold !== undefined ? input.lowStockThreshold : currentProduct.low_stock_threshold,
        trackInventory: input.trackInventory !== undefined ? input.trackInventory : Boolean(currentProduct.track_inventory),
        status: finalStatus,
        version: newVersion,
        updatedAt: new Date().toISOString(),
      },
      eventId: `${businessId}:product:${productId}:${newVersion}`,
    })

    const results = await this.db.batch([updateStmt, changeStmt])
    const updateRes = results[0] as { meta?: { changes?: number } }
    if (input.expectedVersion !== undefined && updateRes.meta?.changes === 0) {
      throw new Error(`VERSION_CONFLICT: Product was modified by another device.`)
    }
  }

  async replaceProduct(
    businessId: string,
    productId: string,
    input: ReplaceProductInput,
    currentProduct: ProductRow
  ): Promise<void> {
    const newVersion = (currentProduct.version || 1) + 1
    let sql = `
      UPDATE products
      SET 
        name = ?,
        sku = ?,
        barcode = ?,
        category_id = ?,
        description = ?,
        image_url = ?,
        unit = ?,
        purchase_price_minor = ?,
        selling_price_minor = ?,
        low_stock_threshold = ?,
        track_inventory = ?,
        status = ?,
        version = version + 1,
        updated_at = datetime('now')
      WHERE business_id = ? AND id = ?
    `
    const params: unknown[] = [
      input.name,
      input.sku,
      input.barcode ?? null,
      input.categoryId ?? null,
      input.description ?? null,
      input.imageUrl ?? null,
      input.unit,
      input.purchasePriceMinor,
      input.sellingPriceMinor,
      input.lowStockThreshold ?? 5.0,
      input.trackInventory !== false ? 1 : 0,
      input.status ?? 'active',
      businessId,
      productId,
    ]

    if (input.expectedVersion !== undefined) {
      sql += ' AND version = ?'
      params.push(input.expectedVersion)
    }

    const replaceStmt = this.db.prepare(sql).bind(...params)

    const finalStatus = input.status ?? 'active'
    const changeStmt = this.changeLogRepo.createChangeEventStatement({
      businessId,
      resourceType: 'product',
      resourceId: productId,
      resourceVersion: newVersion,
      operation: finalStatus === 'archived' ? 'archive' : 'upsert',
      payload: {
        id: productId,
        businessId,
        categoryId: input.categoryId ?? null,
        sku: input.sku,
        barcode: input.barcode ?? null,
        name: input.name,
        description: input.description ?? null,
        imageUrl: input.imageUrl ?? null,
        unit: input.unit,
        sellingPriceMinor: input.sellingPriceMinor,
        lowStockThreshold: input.lowStockThreshold ?? 5.0,
        trackInventory: input.trackInventory !== false,
        status: finalStatus,
        version: newVersion,
        updatedAt: new Date().toISOString(),
      },
      eventId: `${businessId}:product:${productId}:${newVersion}`,
    })

    const results = await this.db.batch([replaceStmt, changeStmt])
    const replaceRes = results[0] as { meta?: { changes?: number } }
    if (input.expectedVersion !== undefined && replaceRes.meta?.changes === 0) {
      throw new Error(`VERSION_CONFLICT: Product was modified by another device.`)
    }
  }

  async archiveProduct(businessId: string, productId: string, currentProduct: ProductRow): Promise<void> {
    const newVersion = (currentProduct.version || 1) + 1
    const sql = `
      UPDATE products
      SET status = 'archived', version = version + 1, updated_at = datetime('now')
      WHERE business_id = ? AND id = ?
    `
    const archiveStmt = this.db.prepare(sql).bind(businessId, productId)

    const changeStmt = this.changeLogRepo.createChangeEventStatement({
      businessId,
      resourceType: 'product',
      resourceId: productId,
      resourceVersion: newVersion,
      operation: 'archive',
      payload: {
        id: productId,
        businessId,
        name: currentProduct.name,
        sku: currentProduct.sku,
        status: 'archived',
        version: newVersion,
        updatedAt: new Date().toISOString(),
      },
      eventId: `${businessId}:product:${productId}:${newVersion}`,
    })

    await this.db.batch([archiveStmt, changeStmt])
  }
}
