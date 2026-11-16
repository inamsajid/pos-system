import { HttpError } from '../../lib/errors'
import { getCurrentBusinessDateKey } from '../../lib/businessDate'
import {
  computeCanonicalRequestHash,
  checkIdempotency,
  buildIdempotencyInsertStatement,
} from '../../lib/idempotency'
import { validateQuantityByUnit } from '../../lib/money'
import { InventoryRepository } from './inventory.repository'
import { ChangeLogRepository } from '../sync/changeLog.repository'
import type {
  InventoryBalanceDTO,
  InventoryFilterParams,
  StockMovementDTO,
  StockMovementFilterParams,
  StockCountDTO,
  StockCountFilterParams,
  CreateStockAdjustmentInput,
  CreateStockCountInput,
} from './inventory.types'

interface ProductRecord {
  id: string
  name: string
  sku: string
  unit: string
  purchase_price_minor: number
  track_inventory: number
  status: string
}

export class InventoryService {
  private readonly repo: InventoryRepository
  private readonly db: D1Database
  private readonly changeLogRepo: ChangeLogRepository

  constructor(db: D1Database) {
    this.repo = new InventoryRepository(db)
    this.db = db
    this.changeLogRepo = new ChangeLogRepository(db)
  }

  async listBalances(
    businessId: string,
    filters: InventoryFilterParams,
    authorizedBranchIds: string[]
  ) {
    const totalCount = await this.repo.countBalances(businessId, filters, authorizedBranchIds)
    const items = await this.repo.listBalances(businessId, filters, authorizedBranchIds)
    const totalPages = Math.max(1, Math.ceil(totalCount / filters.limit))
    const hasNextPage = filters.page < totalPages

    return {
      items,
      meta: {
        page: filters.page,
        limit: filters.limit,
        totalCount,
        totalPages,
        hasNextPage,
      },
    }
  }

  async getProductBalances(
    businessId: string,
    productId: string,
    authorizedBranchIds: string[]
  ): Promise<InventoryBalanceDTO[]> {
    return this.repo.getProductBalancesByBranch(businessId, productId, authorizedBranchIds)
  }

  async listMovements(
    businessId: string,
    filters: StockMovementFilterParams,
    authorizedBranchIds: string[]
  ) {
    const totalCount = await this.repo.countMovements(businessId, filters, authorizedBranchIds)
    const items = await this.repo.listMovements(businessId, filters, authorizedBranchIds)
    const totalPages = Math.max(1, Math.ceil(totalCount / filters.limit))
    const hasNextPage = filters.page < totalPages

    return {
      items,
      meta: {
        page: filters.page,
        limit: filters.limit,
        totalCount,
        totalPages,
        hasNextPage,
      },
    }
  }

  async recordAdjustment(
    businessId: string,
    branchId: string,
    userId: string,
    input: CreateStockAdjustmentInput,
    idempotencyKey?: string | null
  ): Promise<StockMovementDTO> {
    // 1. Idempotency Check
    let requestHash = ''
    if (idempotencyKey) {
      requestHash = await computeCanonicalRequestHash(input)
      const cached = await checkIdempotency(
        this.db,
        businessId,
        'stock_adjustment',
        idempotencyKey,
        requestHash
      )
      if (cached) {
        return cached.body as StockMovementDTO
      }
    }

    // 2. Validate Branch
    const branch = await this.db
      .prepare('SELECT id, status FROM branches WHERE business_id = ? AND id = ? LIMIT 1')
      .bind(businessId, branchId)
      .first<{ id: string; status: string }>()
    if (!branch || branch.status !== 'active') {
      throw HttpError.badRequest('Target branch does not exist or is inactive.')
    }

    // 3. Validate Product
    const product = await this.db
      .prepare(
        'SELECT id, name, sku, unit, purchase_price_minor, track_inventory, status FROM products WHERE business_id = ? AND id = ? LIMIT 1'
      )
      .bind(businessId, input.productId)
      .first<ProductRecord>()

    if (!product || product.status === 'archived') {
      throw HttpError.badRequest('Product not found or archived.', { field: 'productId' })
    }

    // 4. Validate Quantity by UoM
    validateQuantityByUnit(input.quantityChange, product.unit)

    // 5. Current stock and negative stock check
    const currentBal = await this.db
      .prepare(
        'SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ? LIMIT 1'
      )
      .bind(businessId, branchId, product.id)
      .first<{ quantity_on_hand: number }>()

    const currentQty = currentBal?.quantity_on_hand ?? 0.0

    if (input.type === 'adjustment_out') {
      const resultingQty = currentQty - input.quantityChange
      if (resultingQty < 0) {
        const settings = await this.db
          .prepare('SELECT allow_negative_stock FROM business_settings WHERE business_id = ? LIMIT 1')
          .bind(businessId)
          .first<{ allow_negative_stock: number }>()
        if (settings && settings.allow_negative_stock === 0) {
          throw new HttpError(
            422,
            'INSUFFICIENT_STOCK',
            `Insufficient stock for '${product.name}'. Available: ${currentQty} ${product.unit}, reduction requested: ${input.quantityChange} ${product.unit}.`
          )
        }
      }
    }

    const signedQty = input.type === 'adjustment_in' ? input.quantityChange : -input.quantityChange
    const newQty = currentQty + signedQty
    const businessDateKey = getCurrentBusinessDateKey()
    const nowIso = new Date().toISOString()

    const adjId = `adj_${crypto.randomUUID()}`
    const adjustmentNumber = `ADJ-${businessDateKey.replace(/-/g, '')}-${crypto.randomUUID().substring(0, 6).toUpperCase()}`

    const movId = `mov_${crypto.randomUUID()}`
    const movementNumber = `MOV-${businessDateKey.replace(/-/g, '')}-${crypto.randomUUID().substring(0, 6).toUpperCase()}`

    const statements: D1PreparedStatement[] = []

    // Insert stock_adjustments header
    statements.push(
      this.db
        .prepare(
          `INSERT INTO stock_adjustments (
            id, business_id, branch_id, adjustment_number, reason, notes,
            business_date_key, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        )
        .bind(
          adjId,
          businessId,
          branchId,
          adjustmentNumber,
          input.reason,
          input.notes || null,
          businessDateKey,
          userId
        )
    )

    // Ensure inventory_balances row exists initialized to 0.0
    statements.push(
      this.db
        .prepare(
          `INSERT OR IGNORE INTO inventory_balances (
            id, business_id, branch_id, product_id, quantity_on_hand, updated_at
          ) VALUES (?, ?, ?, ?, 0.0, datetime('now'))`
        )
        .bind(`inv_${crypto.randomUUID()}`, businessId, branchId, product.id)
    )

    // Insert stock_movements reading live balance and guarding concurrent adjustment_out underflow
    if (input.type === 'adjustment_out') {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO stock_movements (
              id, business_id, branch_id, movement_number, product_id, type,
              quantity_change, previous_quantity, new_quantity, unit_cost_minor,
              reference_type, reference_id, reference_number, reason, notes,
              business_date_key, created_by, created_at
            ) VALUES (
              ?, ?, ?, ?, ?, ?,
              ?,
              COALESCE((SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?), 0.0),
              CASE
                WHEN COALESCE((SELECT allow_negative_stock FROM business_settings WHERE business_id = ? LIMIT 1), 1) = 0
                  AND (
                    COALESCE((SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?), 0.0)
                    - COALESCE((SELECT SUM(allocated_quantity - consumed_quantity) FROM device_stock_allocations WHERE business_id = ? AND branch_id = ? AND product_id = ? AND status = 'active'), 0.0)
                  ) < ?
                THEN NULL
                ELSE COALESCE((SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?), 0.0) + ?
              END,
              ?, 'adjustment', ?, ?, ?, ?, ?, ?, datetime('now')
            )`
          )
          .bind(
            movId,
            businessId,
            branchId,
            movementNumber,
            product.id,
            input.type,
            signedQty,
            businessId,
            branchId,
            product.id,
            businessId,
            businessId,
            branchId,
            product.id,
            businessId,
            branchId,
            product.id,
            input.quantityChange,
            businessId,
            branchId,
            product.id,
            signedQty,
            product.purchase_price_minor,
            adjId,
            adjustmentNumber,
            input.reason,
            input.notes || null,
            businessDateKey,
            userId
          )
      )
    } else {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO stock_movements (
              id, business_id, branch_id, movement_number, product_id, type,
              quantity_change, previous_quantity, new_quantity, unit_cost_minor,
              reference_type, reference_id, reference_number, reason, notes,
              business_date_key, created_by, created_at
            ) VALUES (
              ?, ?, ?, ?, ?, ?,
              ?,
              COALESCE((SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?), 0.0),
              COALESCE((SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?), 0.0) + ?,
              ?, 'adjustment', ?, ?, ?, ?, ?, ?, datetime('now')
            )`
          )
          .bind(
            movId,
            businessId,
            branchId,
            movementNumber,
            product.id,
            input.type,
            signedQty,
            businessId,
            branchId,
            product.id,
            businessId,
            branchId,
            product.id,
            signedQty,
            product.purchase_price_minor,
            adjId,
            adjustmentNumber,
            input.reason,
            input.notes || null,
            businessDateKey,
            userId
          )
      )
    }

    // Update inventory_balances atomically
    statements.push(
      this.db
        .prepare(
          `UPDATE inventory_balances
           SET quantity_on_hand = quantity_on_hand + ?, updated_at = datetime('now')
           WHERE business_id = ? AND branch_id = ? AND product_id = ?`
        )
        .bind(signedQty, businessId, branchId, product.id)
    )

    statements.push(
      this.changeLogRepo.createLiveStockChangeEventStatement({
        businessId,
        branchId,
        productId: product.id,
        resourceId: `${branchId}:${product.id}`,
        resourceVersion: 0,
        unit: product.unit,
        updatedAt: nowIso,
        eventId: `${businessId}:stock:${branchId}:${product.id}:${movId}`,
      })
    )

    // Audit log
    statements.push(
      this.db
        .prepare(
          `INSERT INTO audit_logs (id, business_id, branch_id, user_id, action, entity_type, entity_id, diff_json, created_at)
           VALUES (?, ?, ?, ?, 'STOCK_ADJUSTMENT', 'inventory', ?, ?, datetime('now'))`
        )
        .bind(
          `aud_${crypto.randomUUID()}`,
          businessId,
          branchId,
          userId,
          adjId,
          JSON.stringify({
            productId: product.id,
            productName: product.name,
            type: input.type,
            quantityChange: signedQty,
            previousQuantity: currentQty,
            newQuantity: newQty,
            reason: input.reason,
          })
        )
    )

    const dto: StockMovementDTO = {
      id: movId,
      businessId,
      branchId,
      movementNumber,
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      unit: product.unit,
      type: input.type,
      quantityChange: signedQty,
      previousQuantity: currentQty,
      newQuantity: newQty,
      unitCostMinor: product.purchase_price_minor,
      referenceType: 'adjustment',
      referenceId: adjId,
      referenceNumber: adjustmentNumber,
      reason: input.reason,
      notes: input.notes || null,
      businessDateKey,
      createdBy: userId,
      createdAt: nowIso,
    }

    if (idempotencyKey) {
      statements.push(
        buildIdempotencyInsertStatement(
          this.db,
          businessId,
          'stock_adjustment',
          idempotencyKey,
          requestHash,
          201,
          dto
        )
      )
    }

    try {
      await this.repo.executeAtomicBatch(statements)
    } catch (err) {
      if (err instanceof Error && err.message.includes('stock_movements.new_quantity')) {
        throw new HttpError(
          422,
          'INSUFFICIENT_STOCK',
          `Insufficient stock for '${product.name}' at commit time due to concurrent inventory update.`
        )
      }
      throw err
    }

    const persistedMov = await this.db
      .prepare('SELECT previous_quantity, new_quantity FROM stock_movements WHERE id = ? LIMIT 1')
      .bind(movId)
      .first<{ previous_quantity: number; new_quantity: number }>()

    if (persistedMov) {
      dto.previousQuantity = persistedMov.previous_quantity
      dto.newQuantity = persistedMov.new_quantity
    }

    return dto
  }

  // --- STOCK COUNTS ---
  async listCounts(businessId: string, filters: StockCountFilterParams, authorizedBranchIds: string[]) {
    const totalCount = await this.repo.countCounts(businessId, filters, authorizedBranchIds)
    const items = await this.repo.listCounts(businessId, filters, authorizedBranchIds)
    const totalPages = Math.max(1, Math.ceil(totalCount / filters.limit))
    const hasNextPage = filters.page < totalPages

    return {
      items,
      meta: {
        page: filters.page,
        limit: filters.limit,
        totalCount,
        totalPages,
        hasNextPage,
      },
    }
  }

  async getCountById(
    businessId: string,
    countId: string,
    authorizedBranchIds: string[]
  ): Promise<StockCountDTO> {
    const count = await this.repo.getCountById(businessId, countId, authorizedBranchIds)
    if (!count) {
      throw HttpError.notFound('Stock count sheet not found.')
    }
    return count
  }

  async createCountDraft(
    businessId: string,
    branchId: string,
    userId: string,
    input: CreateStockCountInput
  ): Promise<StockCountDTO> {
    const branch = await this.db
      .prepare('SELECT id, name, status FROM branches WHERE business_id = ? AND id = ? LIMIT 1')
      .bind(businessId, branchId)
      .first<{ id: string; name: string; status: string }>()
    if (!branch || branch.status !== 'active') {
      throw HttpError.badRequest('Target branch does not exist or is inactive.')
    }

    const countId = `cnt_${crypto.randomUUID()}`
    const businessDateKey = getCurrentBusinessDateKey()
    const countNumber = `STK-${businessDateKey.replace(/-/g, '')}-${crypto.randomUUID().substring(0, 6).toUpperCase()}`

    const statements: D1PreparedStatement[] = []

    statements.push(
      this.db
        .prepare(
          `INSERT INTO stock_counts (
            id, business_id, branch_id, count_number, name, status,
            business_date_key, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, datetime('now'))`
        )
        .bind(countId, businessId, branchId, countNumber, input.name, businessDateKey, userId)
    )

    // For each item, look up system quantity and cost
    const itemsDTO = []
    for (const item of input.items) {
      const prod = await this.db
        .prepare(
          'SELECT id, name, sku, unit, purchase_price_minor FROM products WHERE business_id = ? AND id = ? LIMIT 1'
        )
        .bind(businessId, item.productId)
        .first<ProductRecord>()
      if (!prod) {
        throw HttpError.badRequest(`Product '${item.productId}' not found in business.`)
      }

      const bal = await this.db
        .prepare(
          'SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ? LIMIT 1'
        )
        .bind(businessId, branchId, item.productId)
        .first<{ quantity_on_hand: number }>()

      const systemQty = bal?.quantity_on_hand ?? 0.0
      const variance =
        item.physicalQuantity !== undefined ? item.physicalQuantity - systemQty : null

      const sciId = `sci_${crypto.randomUUID()}`
      statements.push(
        this.db
          .prepare(
            `INSERT INTO stock_count_items (
              id, count_id, product_id, system_quantity, physical_quantity,
              variance, unit_cost_minor, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            sciId,
            countId,
            prod.id,
            systemQty,
            item.physicalQuantity !== undefined ? item.physicalQuantity : null,
            variance,
            prod.purchase_price_minor,
            item.notes || null
          )
      )

      itemsDTO.push({
        id: sciId,
        countId,
        productId: prod.id,
        productName: prod.name,
        sku: prod.sku,
        unit: prod.unit,
        systemQuantity: systemQty,
        physicalQuantity: item.physicalQuantity !== undefined ? item.physicalQuantity : null,
        variance,
        unitCostMinor: prod.purchase_price_minor,
        notes: item.notes || null,
      })
    }

    // Execute atomic batch (NO balance change!)
    await this.repo.executeAtomicBatch(statements)

    return {
      id: countId,
      businessId,
      branchId,
      branchName: branch.name,
      countNumber,
      name: input.name,
      status: 'draft',
      businessDateKey,
      confirmedAt: null,
      confirmedBy: null,
      createdBy: userId,
      createdAt: new Date().toISOString(),
      items: itemsDTO,
    }
  }

  async completeCount(
    businessId: string,
    countId: string,
    userId: string,
    idempotencyKey?: string | null,
    authorizedBranchIds?: string[]
  ): Promise<StockCountDTO> {
    let requestHash = ''
    if (idempotencyKey) {
      requestHash = await computeCanonicalRequestHash({ countId })
      const cached = await checkIdempotency(
        this.db,
        businessId,
        'stock_count_complete',
        idempotencyKey,
        requestHash
      )
      if (cached) {
        return cached.body as StockCountDTO
      }
    }

    const count = await this.db
      .prepare('SELECT * FROM stock_counts WHERE business_id = ? AND id = ? LIMIT 1')
      .bind(businessId, countId)
      .first<{
        id: string
        business_id: string
        branch_id: string
        count_number: string
        status: string
      }>()

    if (!count) {
      throw HttpError.notFound('Stock count sheet not found.')
    }

    if (authorizedBranchIds && !authorizedBranchIds.includes(count.branch_id)) {
      throw HttpError.forbidden('You are not authorized to complete stock counts in this branch.')
    }

    if (count.status !== 'draft') {
      throw HttpError.badRequest(`Cannot complete stock count: Sheet is already ${count.status}.`)
    }

    const itemsRes = await this.db
      .prepare(
        `SELECT sci.*, p.unit
         FROM stock_count_items sci
         INNER JOIN products p ON sci.product_id = p.id
         WHERE sci.count_id = ?`
      )
      .bind(countId)
      .all<{
        id: string
        product_id: string
        unit: string
        system_quantity: number
        physical_quantity: number | null
        variance: number | null
        unit_cost_minor: number
      }>()

    const items = itemsRes.results || []
    const businessDateKey = getCurrentBusinessDateKey()
    const nowIso = new Date().toISOString()
    const statements: D1PreparedStatement[] = []

    // For every item with variance != 0, create stock movement and update inventory balance
    for (const item of items) {
      const variance = item.variance
      if (variance !== null && variance !== 0) {
        const movId = `mov_${crypto.randomUUID()}`
        const movementNumber = `MOV-${businessDateKey.replace(/-/g, '')}-${crypto.randomUUID().substring(0, 6).toUpperCase()}`

        statements.push(
          this.db
            .prepare(
              `INSERT OR IGNORE INTO inventory_balances (
                id, business_id, branch_id, product_id, quantity_on_hand, updated_at
              ) VALUES (?, ?, ?, ?, 0.0, datetime('now'))`
            )
            .bind(`inv_${crypto.randomUUID()}`, businessId, count.branch_id, item.product_id)
        )

        if (variance < 0) {
          statements.push(
            this.db
              .prepare(
                `INSERT INTO stock_movements (
                  id, business_id, branch_id, movement_number, product_id, type,
                  quantity_change, previous_quantity, new_quantity, unit_cost_minor,
                  reference_type, reference_id, reference_number, reason, notes,
                  business_date_key, created_by, created_at
                ) VALUES (
                  ?, ?, ?, ?, ?, 'stock_count_adjustment',
                  ?,
                  COALESCE((SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?), 0.0),
                  CASE
                    WHEN COALESCE((SELECT allow_negative_stock FROM business_settings WHERE business_id = ? LIMIT 1), 1) = 0
                      AND (COALESCE((SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?), 0.0) + ?) < 0
                    THEN NULL
                    ELSE COALESCE((SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?), 0.0) + ?
                  END,
                  ?, 'stock_count', ?, ?, 'Physical Stocktake Reconciliation', 'Variance adjustment from count', ?, ?, datetime('now')
                )`
              )
              .bind(
                movId,
                businessId,
                count.branch_id,
                movementNumber,
                item.product_id,
                variance,
                businessId,
                count.branch_id,
                item.product_id,
                businessId,
                businessId,
                count.branch_id,
                item.product_id,
                variance,
                businessId,
                count.branch_id,
                item.product_id,
                variance,
                item.unit_cost_minor,
                count.id,
                count.count_number,
                businessDateKey,
                userId
              )
          )
        } else {
          statements.push(
            this.db
              .prepare(
                `INSERT INTO stock_movements (
                  id, business_id, branch_id, movement_number, product_id, type,
                  quantity_change, previous_quantity, new_quantity, unit_cost_minor,
                  reference_type, reference_id, reference_number, reason, notes,
                  business_date_key, created_by, created_at
                ) VALUES (
                  ?, ?, ?, ?, ?, 'stock_count_adjustment',
                  ?,
                  COALESCE((SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?), 0.0),
                  COALESCE((SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?), 0.0) + ?,
                  ?, 'stock_count', ?, ?, 'Physical Stocktake Reconciliation', 'Variance adjustment from count', ?, ?, datetime('now')
                )`
              )
              .bind(
                movId,
                businessId,
                count.branch_id,
                movementNumber,
                item.product_id,
                variance,
                businessId,
                count.branch_id,
                item.product_id,
                businessId,
                count.branch_id,
                item.product_id,
                variance,
                item.unit_cost_minor,
                count.id,
                count.count_number,
                businessDateKey,
                userId
              )
          )
        }

        statements.push(
          this.db
            .prepare(
              `UPDATE inventory_balances
               SET quantity_on_hand = quantity_on_hand + ?,
                   last_counted_at = datetime('now'),
                   updated_at = datetime('now')
               WHERE business_id = ? AND branch_id = ? AND product_id = ?`
            )
            .bind(variance, businessId, count.branch_id, item.product_id)
        )

        statements.push(
          this.changeLogRepo.createLiveStockChangeEventStatement({
            businessId,
            branchId: count.branch_id,
            productId: item.product_id,
            resourceId: `${count.branch_id}:${item.product_id}`,
            resourceVersion: 0,
            unit: item.unit,
            updatedAt: nowIso,
            eventId: `${businessId}:stock:${count.branch_id}:${item.product_id}:${movId}`,
          })
        )
      }
    }

    // Update stock count status
    statements.push(
      this.db
        .prepare(
          `UPDATE stock_counts
           SET status = 'confirmed', confirmed_at = datetime('now'), confirmed_by = ?
           WHERE id = ?`
        )
        .bind(userId, countId)
    )

    // Audit log
    statements.push(
      this.db
        .prepare(
          `INSERT INTO audit_logs (id, business_id, branch_id, user_id, action, entity_type, entity_id, diff_json, created_at)
           VALUES (?, ?, ?, ?, 'CONFIRM_STOCK_COUNT', 'inventory', ?, ?, datetime('now'))`
        )
        .bind(
          `aud_${crypto.randomUUID()}`,
          businessId,
          count.branch_id,
          userId,
          countId,
          JSON.stringify({ countNumber: count.count_number, adjustedItemsCount: items.filter((i) => i.variance).length })
        )
    )

    try {
      await this.repo.executeAtomicBatch(statements)
    } catch (err) {
      if (err instanceof Error && err.message.includes('stock_movements.new_quantity')) {
        throw new HttpError(
          422,
          'INSUFFICIENT_STOCK',
          'Stock count variance reduction exceeds available stock at commit time.'
        )
      }
      throw err
    }

    const updated = await this.repo.getCountById(businessId, countId, [count.branch_id])
    return updated!
  }
}

