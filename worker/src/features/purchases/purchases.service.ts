import { HttpError } from '../../lib/errors'
import { getCurrentBusinessDateKey } from '../../lib/businessDate'
import {
  computeCanonicalRequestHash,
  checkIdempotency,
  buildIdempotencyInsertStatement,
} from '../../lib/idempotency'
import { validateQuantityByUnit } from '../../lib/money'
import { PurchasesRepository } from './purchases.repository'
import type {
  PurchaseDTO,
  PurchaseFilterParams,
  CreatePurchaseInput,
  UpdatePurchaseInput,
  SupplierSnapshot,
} from './purchases.types'

interface SupplierRecord {
  id: string
  supplier_code: string
  name: string
  company_name: string | null
  phone: string | null
  email: string | null
  tax_number: string | null
  status: string
}

interface ProductRecord {
  id: string
  name: string
  sku: string
  unit: string
  status: string
}

export class PurchasesService {
  private readonly repo: PurchasesRepository
  private readonly db: D1Database

  constructor(db: D1Database) {
    this.repo = new PurchasesRepository(db)
    this.db = db
  }

  async listPurchases(
    businessId: string,
    filters: PurchaseFilterParams,
    authorizedBranchIds: string[]
  ) {
    const totalCount = await this.repo.countPurchases(businessId, filters, authorizedBranchIds)
    const items = await this.repo.listPurchases(businessId, filters, authorizedBranchIds)
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

  async getPurchaseById(
    businessId: string,
    purchaseId: string,
    authorizedBranchIds: string[]
  ): Promise<PurchaseDTO> {
    const purchase = await this.repo.getPurchaseById(businessId, purchaseId, authorizedBranchIds)
    if (!purchase) {
      throw HttpError.notFound('Purchase order not found.')
    }
    return purchase
  }

  async createPurchase(
    businessId: string,
    branchId: string,
    userId: string,
    input: CreatePurchaseInput,
    idempotencyKey?: string | null
  ): Promise<PurchaseDTO> {
    // 1. Idempotency Check
    let requestHash = ''
    if (idempotencyKey) {
      requestHash = await computeCanonicalRequestHash(input)
      const cached = await checkIdempotency(
        this.db,
        businessId,
        'create_purchase',
        idempotencyKey,
        requestHash
      )
      if (cached) {
        return cached.body as PurchaseDTO
      }
    }

    // 2. Validate Branch
    const branch = await this.db
      .prepare('SELECT id, name, status FROM branches WHERE business_id = ? AND id = ? LIMIT 1')
      .bind(businessId, branchId)
      .first<{ id: string; name: string; status: string }>()
    if (!branch || branch.status !== 'active') {
      throw HttpError.badRequest('Target branch does not exist or is inactive.')
    }

    // 3. Validate Supplier
    const supplier = await this.db
      .prepare('SELECT * FROM suppliers WHERE business_id = ? AND id = ? LIMIT 1')
      .bind(businessId, input.supplierId)
      .first<SupplierRecord>()

    if (!supplier) {
      throw HttpError.badRequest('Supplier not found in business.', { field: 'supplierId' })
    }

    if (supplier.status === 'archived') {
      throw HttpError.badRequest('Cannot create purchase orders for an archived supplier.', {
        field: 'supplierId',
      })
    }

    const supplierSnapshot: SupplierSnapshot = {
      id: supplier.id,
      supplierCode: supplier.supplier_code,
      name: supplier.name,
      companyName: supplier.company_name,
      phone: supplier.phone,
      email: supplier.email,
      taxNumber: supplier.tax_number,
    }

    // 4. Validate Products & Quantities
    const productIds = input.items.map((i) => i.productId)
    const placeholders = productIds.map(() => '?').join(', ')
    const productsRes = await this.db
      .prepare(
        `SELECT id, name, sku, unit, status
         FROM products
         WHERE business_id = ? AND id IN (${placeholders})`
      )
      .bind(businessId, ...productIds)
      .all<ProductRecord>()

    const productMap = new Map<string, ProductRecord>()
    for (const p of productsRes.results || []) {
      productMap.set(p.id, p)
    }

    let subtotalMinor = 0
    let totalDiscountMinor = 0

    interface ValidatedItem {
      product: ProductRecord
      orderedQuantity: number
      unitCostMinor: number
      discountMinor: number
      lineTotalMinor: number
    }
    const validatedItems: ValidatedItem[] = []

    for (let i = 0; i < input.items.length; i++) {
      const it = input.items[i]
      const prod = productMap.get(it.productId)
      if (!prod) {
        throw HttpError.badRequest(`Product '${it.productId}' not found in business.`, {
          field: `items[${i}].productId`,
        })
      }
      if (prod.status === 'archived') {
        throw HttpError.badRequest(`Cannot order archived product '${prod.name}'.`, {
          field: `items[${i}].productId`,
        })
      }

      validateQuantityByUnit(it.orderedQuantity, prod.unit)

      const disc = it.discountMinor ?? 0
      const lineSubtotal = Math.round(it.orderedQuantity * it.unitCostMinor)
      const lineTotal = Math.max(0, lineSubtotal - disc)

      subtotalMinor += lineSubtotal
      totalDiscountMinor += disc

      validatedItems.push({
        product: prod,
        orderedQuantity: it.orderedQuantity,
        unitCostMinor: it.unitCostMinor,
        discountMinor: disc,
        lineTotalMinor: lineTotal,
      })
    }

    const totalAmountMinor = Math.max(0, subtotalMinor - totalDiscountMinor)
    const businessDateKey = getCurrentBusinessDateKey()
    const purchaseId = `po_${crypto.randomUUID()}`
    const purchaseNumber = `PO-${businessDateKey.replace(/-/g, '')}-${crypto.randomUUID().substring(0, 6).toUpperCase()}`

    const statements: D1PreparedStatement[] = []

    // 5. Insert purchases header
    statements.push(
      this.db
        .prepare(
          `INSERT INTO purchases (
            id, business_id, branch_id, purchase_number, supplier_id,
            supplier_snapshot_json, supplier_invoice_number, subtotal_minor,
            discount_minor, tax_minor, total_amount_minor, paid_amount_minor,
            status, purchase_date_key, expected_delivery_date, notes,
            created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 'draft', ?, ?, ?, ?, datetime('now'), datetime('now'))`
        )
        .bind(
          purchaseId,
          businessId,
          branchId,
          purchaseNumber,
          supplier.id,
          JSON.stringify(supplierSnapshot),
          input.supplierInvoiceNumber || null,
          subtotalMinor,
          totalDiscountMinor,
          totalAmountMinor,
          businessDateKey,
          input.expectedDeliveryDate || null,
          input.notes || null,
          userId
        )
    )

    // 6. Insert purchase_items
    for (const vItem of validatedItems) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO purchase_items (
              id, purchase_id, product_id, sku, product_name, unit,
              ordered_quantity, received_quantity, unit_cost_minor,
              discount_minor, line_total_minor
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
          )
          .bind(
            `poi_${crypto.randomUUID()}`,
            purchaseId,
            vItem.product.id,
            vItem.product.sku,
            vItem.product.name,
            vItem.product.unit,
            vItem.orderedQuantity,
            vItem.unitCostMinor,
            vItem.discountMinor,
            vItem.lineTotalMinor
          )
      )
    }

    // 7. Audit log
    statements.push(
      this.db
        .prepare(
          `INSERT INTO audit_logs (id, business_id, branch_id, user_id, action, entity_type, entity_id, diff_json, created_at)
           VALUES (?, ?, ?, ?, 'CREATE_PURCHASE', 'purchase', ?, ?, datetime('now'))`
        )
        .bind(
          `aud_${crypto.randomUUID()}`,
          businessId,
          branchId,
          userId,
          purchaseId,
          JSON.stringify({ purchaseNumber, supplierName: supplier.name, totalAmountMinor, itemsCount: validatedItems.length })
        )
    )

    // Construct response DTO
    const dto: PurchaseDTO = {
      id: purchaseId,
      businessId,
      branchId,
      branchName: branch.name,
      purchaseNumber,
      supplierId: supplier.id,
      supplierName: supplier.name,
      supplierSnapshot,
      supplierInvoiceNumber: input.supplierInvoiceNumber || null,
      subtotalMinor,
      discountMinor: totalDiscountMinor,
      taxMinor: 0,
      totalAmountMinor,
      paidAmountMinor: 0,
      remainingAmountMinor: totalAmountMinor,
      status: 'draft',
      purchaseDateKey: businessDateKey,
      expectedDeliveryDate: input.expectedDeliveryDate || null,
      notes: input.notes || null,
      confirmedAt: null,
      createdBy: userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: validatedItems.map((vi) => ({
        id: `poi_temp`,
        purchaseId,
        productId: vi.product.id,
        productName: vi.product.name,
        sku: vi.product.sku,
        unit: vi.product.unit,
        orderedQuantity: vi.orderedQuantity,
        receivedQuantity: 0,
        remainingQuantity: vi.orderedQuantity,
        unitCostMinor: vi.unitCostMinor,
        discountMinor: vi.discountMinor,
        lineTotalMinor: vi.lineTotalMinor,
      })),
      receipts: [],
      allocations: [],
    }

    if (idempotencyKey) {
      statements.push(
        buildIdempotencyInsertStatement(
          this.db,
          businessId,
          'create_purchase',
          idempotencyKey,
          requestHash,
          201,
          dto
        )
      )
    }

    // Single atomic batch execution (NO stock modification!)
    await this.repo.executeAtomicBatch(statements)

    const created = await this.repo.getPurchaseById(businessId, purchaseId, [branchId])
    return created!
  }

  async updatePurchase(
    businessId: string,
    purchaseId: string,
    userId: string,
    input: UpdatePurchaseInput
  ): Promise<PurchaseDTO> {
    const purchase = await this.db
      .prepare('SELECT * FROM purchases WHERE business_id = ? AND id = ? LIMIT 1')
      .bind(businessId, purchaseId)
      .first<{ id: string; branch_id: string; status: string; total_amount_minor: number }>()

    if (!purchase) {
      throw HttpError.notFound('Purchase order not found.')
    }

    if (purchase.status !== 'draft') {
      throw HttpError.badRequest(`Cannot modify purchase in status '${purchase.status}'. Only draft orders may be edited.`)
    }

    const statements: D1PreparedStatement[] = []

    if (input.items !== undefined) {
      // Validate replacement items
      const productIds = input.items.map((i) => i.productId)
      const placeholders = productIds.map(() => '?').join(', ')
      const productsRes = await this.db
        .prepare(
          `SELECT id, name, sku, unit, status
           FROM products
           WHERE business_id = ? AND id IN (${placeholders})`
        )
        .bind(businessId, ...productIds)
        .all<ProductRecord>()

      const productMap = new Map<string, ProductRecord>()
      for (const p of productsRes.results || []) {
        productMap.set(p.id, p)
      }

      let subtotalMinor = 0
      let totalDiscountMinor = 0

      // Delete existing purchase_items
      statements.push(
        this.db.prepare('DELETE FROM purchase_items WHERE purchase_id = ?').bind(purchaseId)
      )

      for (let i = 0; i < input.items.length; i++) {
        const it = input.items[i]
        const prod = productMap.get(it.productId)
        if (!prod || prod.status === 'archived') {
          throw HttpError.badRequest(`Invalid or archived product '${it.productId}'.`)
        }
        validateQuantityByUnit(it.orderedQuantity, prod.unit)

        const disc = it.discountMinor ?? 0
        const lineSubtotal = Math.round(it.orderedQuantity * it.unitCostMinor)
        const lineTotal = Math.max(0, lineSubtotal - disc)

        subtotalMinor += lineSubtotal
        totalDiscountMinor += disc

        statements.push(
          this.db
            .prepare(
              `INSERT INTO purchase_items (
                id, purchase_id, product_id, sku, product_name, unit,
                ordered_quantity, received_quantity, unit_cost_minor,
                discount_minor, line_total_minor
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
            )
            .bind(
              `poi_${crypto.randomUUID()}`,
              purchaseId,
              prod.id,
              prod.sku,
              prod.name,
              prod.unit,
              it.orderedQuantity,
              it.unitCostMinor,
              disc,
              lineTotal
            )
        )
      }

      const totalAmountMinor = Math.max(0, subtotalMinor - totalDiscountMinor)
      statements.push(
        this.db
          .prepare(
            `UPDATE purchases
             SET subtotal_minor = ?, discount_minor = ?, total_amount_minor = ?,
                 supplier_invoice_number = COALESCE(?, supplier_invoice_number),
                 expected_delivery_date = COALESCE(?, expected_delivery_date),
                 notes = COALESCE(?, notes),
                 updated_at = datetime('now')
             WHERE id = ?`
          )
          .bind(
            subtotalMinor,
            totalDiscountMinor,
            totalAmountMinor,
            input.supplierInvoiceNumber ?? null,
            input.expectedDeliveryDate ?? null,
            input.notes ?? null,
            purchaseId
          )
      )
    } else {
      statements.push(
        this.db
          .prepare(
            `UPDATE purchases
             SET supplier_invoice_number = COALESCE(?, supplier_invoice_number),
                 expected_delivery_date = COALESCE(?, expected_delivery_date),
                 notes = COALESCE(?, notes),
                 updated_at = datetime('now')
             WHERE id = ?`
          )
          .bind(
            input.supplierInvoiceNumber ?? null,
            input.expectedDeliveryDate ?? null,
            input.notes ?? null,
            purchaseId
          )
      )
    }

    statements.push(
      this.db
        .prepare(
          `INSERT INTO audit_logs (id, business_id, branch_id, user_id, action, entity_type, entity_id, diff_json, created_at)
           VALUES (?, ?, ?, ?, 'UPDATE_PURCHASE', 'purchase', ?, ?, datetime('now'))`
        )
        .bind(
          `aud_${crypto.randomUUID()}`,
          businessId,
          purchase.branch_id,
          userId,
          purchaseId,
          JSON.stringify({ updatedFields: Object.keys(input) })
        )
    )

    await this.repo.executeAtomicBatch(statements)
    return (await this.repo.getPurchaseById(businessId, purchaseId, [purchase.branch_id]))!
  }

  async confirmPurchase(businessId: string, purchaseId: string, userId: string): Promise<PurchaseDTO> {
    const purchase = await this.db
      .prepare('SELECT * FROM purchases WHERE business_id = ? AND id = ? LIMIT 1')
      .bind(businessId, purchaseId)
      .first<{ id: string; branch_id: string; status: string }>()

    if (!purchase) {
      throw HttpError.notFound('Purchase order not found.')
    }

    if (purchase.status !== 'draft') {
      throw HttpError.badRequest(`Cannot confirm purchase: Order is already in status '${purchase.status}'.`)
    }

    const statements: D1PreparedStatement[] = []

    statements.push(
      this.db
        .prepare(
          `UPDATE purchases
           SET status = 'ordered', confirmed_at = datetime('now'), updated_at = datetime('now')
           WHERE id = ?`
        )
        .bind(purchaseId)
    )

    statements.push(
      this.db
        .prepare(
          `INSERT INTO audit_logs (id, business_id, branch_id, user_id, action, entity_type, entity_id, diff_json, created_at)
           VALUES (?, ?, ?, ?, 'CONFIRM_PURCHASE', 'purchase', ?, ?, datetime('now'))`
        )
        .bind(
          `aud_${crypto.randomUUID()}`,
          businessId,
          purchase.branch_id,
          userId,
          purchaseId,
          JSON.stringify({ fromStatus: 'draft', toStatus: 'ordered' })
        )
    )

    // Execute atomic batch (NO stock modification!)
    await this.repo.executeAtomicBatch(statements)
    return (await this.repo.getPurchaseById(businessId, purchaseId, [purchase.branch_id]))!
  }

  async cancelPurchase(
    businessId: string,
    purchaseId: string,
    userId: string,
    reason?: string
  ): Promise<PurchaseDTO> {
    const purchase = await this.db
      .prepare('SELECT * FROM purchases WHERE business_id = ? AND id = ? LIMIT 1')
      .bind(businessId, purchaseId)
      .first<{ id: string; branch_id: string; status: string; paid_amount_minor: number }>()

    if (!purchase) {
      throw HttpError.notFound('Purchase order not found.')
    }

    if (purchase.status === 'cancelled') {
      throw HttpError.badRequest('Purchase order is already cancelled.')
    }

    // BDR-10: Hard blocking if any items received or payments allocated
    const receivedRes = await this.db
      .prepare('SELECT SUM(received_quantity) as total_received FROM purchase_items WHERE purchase_id = ?')
      .bind(purchaseId)
      .first<{ total_received: number | null }>()

    const totalReceived = receivedRes?.total_received ?? 0
    if (totalReceived > 0) {
      throw HttpError.badRequest(
        `Cannot cancel purchase order: ${totalReceived} items have already been received. Reversal/debit note required.`
      )
    }

    if (purchase.paid_amount_minor > 0) {
      throw HttpError.badRequest(
        `Cannot cancel purchase order: Supplier payments of PKR ${(purchase.paid_amount_minor / 100).toFixed(2)} have already been allocated.`
      )
    }

    const statements: D1PreparedStatement[] = []

    statements.push(
      this.db
        .prepare(
          `UPDATE purchases
           SET status = 'cancelled', updated_at = datetime('now')
           WHERE id = ?`
        )
        .bind(purchaseId)
    )

    statements.push(
      this.db
        .prepare(
          `INSERT INTO audit_logs (id, business_id, branch_id, user_id, action, entity_type, entity_id, diff_json, created_at)
           VALUES (?, ?, ?, ?, 'CANCEL_PURCHASE', 'purchase', ?, ?, datetime('now'))`
        )
        .bind(
          `aud_${crypto.randomUUID()}`,
          businessId,
          purchase.branch_id,
          userId,
          purchaseId,
          JSON.stringify({ previousStatus: purchase.status, reason: reason || 'Cancelled by user' })
        )
    )

    await this.repo.executeAtomicBatch(statements)
    return (await this.repo.getPurchaseById(businessId, purchaseId, [purchase.branch_id]))!
  }
}
