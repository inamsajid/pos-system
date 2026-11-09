import { HttpError } from '../../lib/errors'
import { getCurrentBusinessDateKey } from '../../lib/businessDate'
import {
  computeCanonicalRequestHash,
  checkIdempotency,
  buildIdempotencyInsertStatement,
} from '../../lib/idempotency'
import { validateQuantityByUnit } from '../../lib/money'
import { GoodsReceiptsRepository } from './goodsReceipts.repository'
import { ChangeLogRepository } from '../sync/changeLog.repository'
import type {
  GoodsReceiptDTO,
  GoodsReceiptFilterParams,
  CreateGoodsReceiptInput,
  GoodsReceiptItemDTO,
} from './goodsReceipts.types'

interface PurchaseRecord {
  id: string
  business_id: string
  branch_id: string
  purchase_number: string
  supplier_id: string
  status: string
}

interface PurchaseItemRecord {
  id: string
  purchase_id: string
  product_id: string
  sku: string
  product_name: string
  unit: string
  ordered_quantity: number
  received_quantity: number
  unit_cost_minor: number
}

interface ProductCostRecord {
  id: string
  purchase_price_minor: number
}

export class GoodsReceiptsService {
  private readonly repo: GoodsReceiptsRepository
  private readonly db: D1Database
  private readonly changeLogRepo: ChangeLogRepository

  constructor(db: D1Database) {
    this.repo = new GoodsReceiptsRepository(db)
    this.db = db
    this.changeLogRepo = new ChangeLogRepository(db)
  }

  async listGoodsReceipts(
    businessId: string,
    filters: GoodsReceiptFilterParams,
    authorizedBranchIds: string[]
  ) {
    const totalCount = await this.repo.countGoodsReceipts(businessId, filters, authorizedBranchIds)
    const items = await this.repo.listGoodsReceipts(businessId, filters, authorizedBranchIds)
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

  async getGoodsReceiptById(
    businessId: string,
    receiptId: string,
    authorizedBranchIds: string[]
  ): Promise<GoodsReceiptDTO> {
    const receipt = await this.repo.getGoodsReceiptById(businessId, receiptId, authorizedBranchIds)
    if (!receipt) {
      throw HttpError.notFound('Goods receipt not found.')
    }
    return receipt
  }

  async receiveGoods(
    businessId: string,
    purchaseId: string,
    userId: string,
    input: CreateGoodsReceiptInput,
    idempotencyKey?: string | null
  ): Promise<GoodsReceiptDTO> {
    // 1. Idempotency Check
    let requestHash = ''
    if (idempotencyKey) {
      requestHash = await computeCanonicalRequestHash({ purchaseId, ...input })
      const cached = await checkIdempotency(
        this.db,
        businessId,
        'goods_receipt',
        idempotencyKey,
        requestHash
      )
      if (cached) {
        return cached.body as GoodsReceiptDTO
      }
    }

    // 2. Validate Purchase
    const purchase = await this.db
      .prepare('SELECT * FROM purchases WHERE business_id = ? AND id = ? LIMIT 1')
      .bind(businessId, purchaseId)
      .first<PurchaseRecord>()

    if (!purchase) {
      throw HttpError.notFound('Purchase order not found.')
    }

    if (!['draft', 'ordered', 'partially_received'].includes(purchase.status)) {
      throw HttpError.badRequest(
        `Cannot receive goods against purchase in status '${purchase.status}'.`
      )
    }

    // 3. Load Purchase Items
    const allItemsRes = await this.db
      .prepare('SELECT * FROM purchase_items WHERE purchase_id = ?')
      .bind(purchaseId)
      .all<PurchaseItemRecord>()

    const allItems = allItemsRes.results || []
    const itemMap = new Map<string, PurchaseItemRecord>()
    for (const it of allItems) {
      itemMap.set(it.id, it)
    }

    // 4. Validate Receipt Items
    interface ValidatedReceiptLine {
      item: PurchaseItemRecord
      quantityReceived: number
      unitCostMinor: number
    }
    const validatedLines: ValidatedReceiptLine[] = []
    let totalReceivedValueMinor = 0

    for (let i = 0; i < input.items.length; i++) {
      const line = input.items[i]
      const pItem = itemMap.get(line.purchaseItemId)

      if (!pItem) {
        throw HttpError.badRequest(
          `Purchase item '${line.purchaseItemId}' does not belong to purchase order '${purchase.purchase_number}'.`,
          { field: `items[${i}].purchaseItemId` }
        )
      }

      validateQuantityByUnit(line.quantityReceived, pItem.unit)

      const remainingAllowed = pItem.ordered_quantity - pItem.received_quantity
      if (line.quantityReceived > remainingAllowed) {
        throw HttpError.badRequest(
          `Received quantity (${line.quantityReceived}) exceeds remaining receivable quantity (${remainingAllowed}) for product '${pItem.product_name}'.`,
          { field: `items[${i}].quantityReceived` }
        )
      }

      const lineVal = Math.round(line.quantityReceived * pItem.unit_cost_minor)
      totalReceivedValueMinor += lineVal

      validatedLines.push({
        item: pItem,
        quantityReceived: line.quantityReceived,
        unitCostMinor: pItem.unit_cost_minor,
      })
    }

    // 5. Generate Receipt Numbers & IDs
    const businessDateKey = getCurrentBusinessDateKey()
    const receiptId = `gr_${crypto.randomUUID()}`
    const receiptNumber = `REC-${businessDateKey.replace(/-/g, '')}-${crypto.randomUUID().substring(0, 6).toUpperCase()}`

    const statements: D1PreparedStatement[] = []

    // 6. Insert goods_receipts header
    statements.push(
      this.db
        .prepare(
          `INSERT INTO goods_receipts (
            id, business_id, branch_id, receipt_number, purchase_id,
            supplier_id, notes, business_date_key, received_by,
            received_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
        )
        .bind(
          receiptId,
          businessId,
          purchase.branch_id,
          receiptNumber,
          purchase.id,
          purchase.supplier_id,
          input.notes || null,
          businessDateKey,
          userId
        )
    )

    // 7. Process each receipt line: goods_receipt_items, purchase_items, stock_movements, inventory_balances, MWA cost
    const receiptItemsDTO: GoodsReceiptItemDTO[] = []

    for (const vLine of validatedLines) {
      const griId = `gri_${crypto.randomUUID()}`
      statements.push(
        this.db
          .prepare(
            `INSERT INTO goods_receipt_items (
              id, receipt_id, purchase_item_id, product_id,
              quantity_received, unit_cost_minor
            ) VALUES (?, ?, ?, ?, ?, ?)`
          )
          .bind(
            griId,
            receiptId,
            vLine.item.id,
            vLine.item.product_id,
            vLine.quantityReceived,
            vLine.unitCostMinor
          )
      )

      // Update purchase_item received quantity
      statements.push(
        this.db
          .prepare(
            `UPDATE purchase_items
             SET received_quantity = received_quantity + ?
             WHERE id = ?`
          )
          .bind(vLine.quantityReceived, vLine.item.id)
      )

      // MWA Cost Calculation & Inventory Balance Update
      const bal = await this.db
        .prepare(
          'SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ? LIMIT 1'
        )
        .bind(businessId, purchase.branch_id, vLine.item.product_id)
        .first<{ quantity_on_hand: number }>()

      const currentQoh = bal?.quantity_on_hand ?? 0.0
      const newQoh = currentQoh + vLine.quantityReceived

      const prodCost = await this.db
        .prepare('SELECT purchase_price_minor FROM products WHERE id = ?')
        .bind(vLine.item.product_id)
        .first<ProductCostRecord>()

      const currentCost = prodCost?.purchase_price_minor ?? 0
      let updatedMwaCost: number

      if (currentQoh <= 0) {
        updatedMwaCost = vLine.unitCostMinor
      } else {
        const totalCostSum = currentQoh * currentCost + vLine.quantityReceived * vLine.unitCostMinor
        const totalQtySum = currentQoh + vLine.quantityReceived
        updatedMwaCost = Math.round(totalCostSum / totalQtySum)
      }

      // Update product baseline purchase cost with new MWA cost
      statements.push(
        this.db
          .prepare(
            `UPDATE products
             SET purchase_price_minor = ?, updated_at = datetime('now')
             WHERE id = ?`
          )
          .bind(updatedMwaCost, vLine.item.product_id)
      )

      // Stock Movement entry
      const movId = `mov_${crypto.randomUUID()}`
      const movementNumber = `MOV-${businessDateKey.replace(/-/g, '')}-${crypto.randomUUID().substring(0, 6).toUpperCase()}`

      statements.push(
        this.db
          .prepare(
            `INSERT INTO stock_movements (
              id, business_id, branch_id, movement_number, product_id, type,
              quantity_change, previous_quantity, new_quantity, unit_cost_minor,
              reference_type, reference_id, reference_number, notes,
              business_date_key, created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, 'purchase_receipt', ?, ?, ?, ?, 'purchase', ?, ?, 'Goods Receipt Confirmed', ?, ?, datetime('now'))`
          )
          .bind(
            movId,
            businessId,
            purchase.branch_id,
            movementNumber,
            vLine.item.product_id,
            vLine.quantityReceived,
            currentQoh,
            newQoh,
            vLine.unitCostMinor,
            purchase.id,
            receiptNumber,
            businessDateKey,
            userId
          )
      )

      // Inventory Balance Upsert
      statements.push(
        this.db
          .prepare(
            `INSERT INTO inventory_balances (
              id, business_id, branch_id, product_id, quantity_on_hand, updated_at
            ) VALUES (?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(branch_id, product_id) DO UPDATE SET
              quantity_on_hand = quantity_on_hand + excluded.quantity_on_hand,
              updated_at = datetime('now')`
          )
          .bind(
            `inv_${crypto.randomUUID()}`,
            businessId,
            purchase.branch_id,
            vLine.item.product_id,
            vLine.quantityReceived
          )
      )

      statements.push(
        this.changeLogRepo.createChangeEventStatement({
          businessId,
          branchId: purchase.branch_id,
          resourceType: 'stock',
          resourceId: `${purchase.branch_id}:${vLine.item.product_id}`,
          resourceVersion: 0,
          operation: 'upsert',
          payload: {
            productId: vLine.item.product_id,
            branchId: purchase.branch_id,
            quantityOnHand: newQoh,
            unit: vLine.item.unit,
            updatedAt: new Date().toISOString(),
          },
          eventId: `${businessId}:stock:${purchase.branch_id}:${vLine.item.product_id}:${movId}`,
        })
      )

      receiptItemsDTO.push({
        id: griId,
        receiptId,
        purchaseItemId: vLine.item.id,
        productId: vLine.item.product_id,
        productName: vLine.item.product_name,
        sku: vLine.item.sku,
        unit: vLine.item.unit,
        quantityReceived: vLine.quantityReceived,
        unitCostMinor: vLine.unitCostMinor,
        lineTotalMinor: Math.round(vLine.quantityReceived * vLine.unitCostMinor),
      })
    }

    // 8. Determine New Purchase Status
    let allReceived = true
    for (const it of allItems) {
      const line = validatedLines.find((l) => l.item.id === it.id)
      const newlyReceived = line ? line.quantityReceived : 0
      const totalRec = it.received_quantity + newlyReceived
      if (totalRec < it.ordered_quantity) {
        allReceived = false
        break
      }
    }

    const newPurchaseStatus = allReceived ? 'received' : 'partially_received'
    statements.push(
      this.db
        .prepare(
          `UPDATE purchases
           SET status = ?, updated_at = datetime('now')
           WHERE id = ?`
        )
        .bind(newPurchaseStatus, purchase.id)
    )

    // 9. Post Supplier Ledger Transaction (Purchase Bill Liability)
    if (totalReceivedValueMinor > 0) {
      const lastLedger = await this.db
        .prepare(
          `SELECT balance_minor FROM supplier_ledger_transactions
           WHERE business_id = ? AND supplier_id = ?
           ORDER BY rowid DESC
           LIMIT 1`
        )
        .bind(businessId, purchase.supplier_id)
        .first<{ balance_minor: number }>()

      let currentSupplierBal = 0
      if (lastLedger) {
        currentSupplierBal = lastLedger.balance_minor
      } else {
        const supp = await this.db
          .prepare('SELECT opening_payable_minor FROM suppliers WHERE id = ?')
          .bind(purchase.supplier_id)
          .first<{ opening_payable_minor: number }>()
        currentSupplierBal = supp?.opening_payable_minor ?? 0
      }

      const newSupplierBal = currentSupplierBal + totalReceivedValueMinor // Credit increases payable owed

      const sltId = `slt_${crypto.randomUUID()}`
      statements.push(
        this.db
          .prepare(
            `INSERT INTO supplier_ledger_transactions (
              id, business_id, branch_id, supplier_id, type, reference_id,
              reference_number, description, debit_minor, credit_minor,
              balance_minor, business_date_key, created_at
            ) VALUES (?, ?, ?, ?, 'bill', ?, ?, ?, 0, ?, ?, ?, datetime('now'))`
          )
          .bind(
            sltId,
            businessId,
            purchase.branch_id,
            purchase.supplier_id,
            purchase.id,
            purchase.purchase_number,
            `Goods received against PO ${purchase.purchase_number} (Receipt ${receiptNumber})`,
            totalReceivedValueMinor,
            newSupplierBal,
            businessDateKey
          )
      )
    }

    // 10. Audit log
    statements.push(
      this.db
        .prepare(
          `INSERT INTO audit_logs (id, business_id, branch_id, user_id, action, entity_type, entity_id, diff_json, created_at)
           VALUES (?, ?, ?, ?, 'GOODS_RECEIPT', 'inventory', ?, ?, datetime('now'))`
        )
        .bind(
          `aud_${crypto.randomUUID()}`,
          businessId,
          purchase.branch_id,
          userId,
          receiptId,
          JSON.stringify({
            receiptNumber,
            purchaseNumber: purchase.purchase_number,
            itemsCount: validatedLines.length,
            totalReceivedValueMinor,
            newPurchaseStatus,
          })
        )
    )

    const dto: GoodsReceiptDTO = {
      id: receiptId,
      businessId,
      branchId: purchase.branch_id,
      receiptNumber,
      purchaseId: purchase.id,
      purchaseNumber: purchase.purchase_number,
      supplierId: purchase.supplier_id,
      notes: input.notes || null,
      businessDateKey,
      receivedBy: userId,
      receivedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      items: receiptItemsDTO,
    }

    if (idempotencyKey) {
      statements.push(
        buildIdempotencyInsertStatement(
          this.db,
          businessId,
          'goods_receipt',
          idempotencyKey,
          requestHash,
          201,
          dto
        )
      )
    }

    // Single atomic batch execution!
    await this.repo.executeAtomicBatch(statements)

    const created = await this.repo.getGoodsReceiptById(businessId, receiptId, [purchase.branch_id])
    return created!
  }
}

