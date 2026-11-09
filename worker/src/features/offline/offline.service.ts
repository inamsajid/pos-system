import { HttpError } from '../../lib/errors'
import { getCurrentBusinessDateKey } from '../../lib/businessDate'
import {
  computeCanonicalRequestHash,
  checkIdempotency,
  buildIdempotencyInsertStatement,
} from '../../lib/idempotency'
import { validateQuantityByUnit, calculateLineSubtotalMinor } from '../../lib/money'
import { signAuthorizationPayload, verifyAuthorizationPayload } from './offlineCrypto'
import type {
  CreateOfflineAuthorizationInput,
  OfflineAuthorizationDTO,
  ProductAllocationDTO,
  CommitOfflineSaleInput,
  CommitOfflineSaleResponse,
  AllocationReconciliationResponse,
} from './offline.types'

interface ProductRow {
  id: string
  name: string
  sku: string
  unit: string
  selling_price_minor: number
  purchase_price_minor: number
  track_inventory: number
  status: string
}

interface DeviceRow {
  id: string
  business_id: string
  status: string
  installation_id: string
}

interface AuthRow {
  id: string
  business_id: string
  branch_id: string
  user_id: string
  device_id: string
  catalog_version: number
  pricing_version: number
  max_transactions: number
  max_total_amount_minor: number
  allow_discounts: number
  status: string
  issued_at: string
  expires_at: string
  signature: string
}

interface AllocationRow {
  id: string
  authorization_id: string
  business_id: string
  branch_id: string
  device_id: string
  user_id: string
  product_id: string
  allocated_quantity: number
  consumed_quantity: number
  status: string
}

export class OfflineService {
  private readonly db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  /**
   * Generates a cryptographically signed offline authorization package and allocates device stock.
   */
  async createAuthorization(params: {
    businessId: string
    branchId: string
    userId: string
    input: CreateOfflineAuthorizationInput
    secret: string
  }): Promise<OfflineAuthorizationDTO> {
    const { businessId, branchId, userId, input, secret } = params

    // 1. Validate device registration
    const device = await this.db
      .prepare('SELECT id, business_id, status FROM devices WHERE id = ? AND business_id = ? LIMIT 1')
      .bind(input.deviceId, businessId)
      .first<DeviceRow>()

    if (!device) {
      throw HttpError.notFound(`Device '${input.deviceId}' is not registered with business '${businessId}'.`)
    }
    if (device.status !== 'active') {
      throw HttpError.forbidden(`Device '${input.deviceId}' is revoked and cannot be authorized for offline sales.`)
    }

    if (!input.products || input.products.length === 0) {
      throw HttpError.badRequest('At least one product allocation is required for offline authorization.')
    }

    // 2. Validate products & check available stock
    const productIds = input.products.map((p) => p.productId)
    const placeholders = productIds.map(() => '?').join(', ')

    const productsRes = await this.db
      .prepare(
        `SELECT id, name, sku, unit, selling_price_minor, purchase_price_minor, track_inventory, status
         FROM products
         WHERE business_id = ? AND id IN (${placeholders})`
      )
      .bind(businessId, ...productIds)
      .all<ProductRow>()

    const productMap = new Map<string, ProductRow>()
    for (const p of productsRes.results || []) {
      productMap.set(p.id, p)
    }

    // Query physical inventory
    const invRes = await this.db
      .prepare(
        `SELECT product_id, quantity_on_hand
         FROM inventory_balances
         WHERE business_id = ? AND branch_id = ? AND product_id IN (${placeholders})`
      )
      .bind(businessId, branchId, ...productIds)
      .all<{ product_id: string; quantity_on_hand: number }>()

    const physicalMap = new Map<string, number>()
    for (const r of invRes.results || []) {
      physicalMap.set(r.product_id, r.quantity_on_hand)
    }

    // Query active allocations on other/current devices for these products
    const allocRes = await this.db
      .prepare(
        `SELECT product_id, SUM(allocated_quantity - consumed_quantity) as reserved_quantity
         FROM device_stock_allocations
         WHERE business_id = ? AND branch_id = ? AND status = 'active' AND product_id IN (${placeholders})
         GROUP BY product_id`
      )
      .bind(businessId, branchId, ...productIds)
      .all<{ product_id: string; reserved_quantity: number }>()

    const reservedMap = new Map<string, number>()
    for (const r of allocRes.results || []) {
      reservedMap.set(r.product_id, r.reserved_quantity || 0)
    }

    // Validate allocations
    const allocationDTOs: ProductAllocationDTO[] = []
    const allocationInserts: D1PreparedStatement[] = []
    const authId = `auth_${crypto.randomUUID()}`
    const now = new Date()
    const nowIso = now.toISOString()

    const durationHours = Math.min(Math.max(input.durationHours || 8, 1), 24)
    const expiresAt = new Date(now.getTime() + durationHours * 3600 * 1000).toISOString()

    for (const req of input.products) {
      const prod = productMap.get(req.productId)
      if (!prod || prod.status !== 'active') {
        throw HttpError.badRequest(`Product '${req.productId}' is inactive or does not belong to this business.`)
      }

      const validatedQty = validateQuantityByUnit(req.allocatedQuantity, prod.unit, 'allocatedQuantity')
      const physical = physicalMap.get(prod.id) ?? 0
      const reserved = reservedMap.get(prod.id) ?? 0
      const availableToSell = Math.max(0, physical - reserved)

      if (Boolean(prod.track_inventory) && availableToSell < validatedQty) {
        throw new HttpError(
          422,
          'INSUFFICIENT_STOCK',
          `Insufficient available stock for '${prod.name}'. Available: ${availableToSell} ${prod.unit} (Physical: ${physical}, Active Allocations: ${reserved}), Requested: ${validatedQty} ${prod.unit}.`,
          {
            productId: prod.id,
            availableQuantity: availableToSell,
            requestedQuantity: validatedQty,
          }
        )
      }

      // Reserve in running map to prevent double-counting across line items
      reservedMap.set(prod.id, reserved + validatedQty)

      const allocId = `alloc_${crypto.randomUUID()}`
      allocationDTOs.push({
        allocationId: allocId,
        productId: prod.id,
        sku: prod.sku,
        name: prod.name,
        unit: prod.unit,
        sellingPriceMinor: prod.selling_price_minor,
        allocatedQuantity: validatedQty,
        consumedQuantity: 0,
        remainingQuantity: validatedQty,
      })

      allocationInserts.push(
        this.db
          .prepare(
            `INSERT INTO device_stock_allocations (
               id, authorization_id, business_id, branch_id, device_id, user_id,
               product_id, allocated_quantity, consumed_quantity, status, allocated_at, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, ?)`
          )
          .bind(
            allocId,
            authId,
            businessId,
            branchId,
            input.deviceId,
            userId,
            prod.id,
            validatedQty,
            nowIso,
            nowIso,
            nowIso
          )
      )
    }

    // 3. Generate Cryptographic Signature
    const signature = await signAuthorizationPayload(secret, {
      authorizationId: authId,
      businessId,
      branchId,
      userId,
      deviceId: input.deviceId,
      expiresAt,
      productIds,
    })

    const maxTransactions = input.maxTransactions || 100
    const maxTotalAmountMinor = input.maxTotalAmountMinor || 5_000_000

    const authInsert = this.db
      .prepare(
        `INSERT INTO offline_authorizations (
           id, business_id, branch_id, user_id, device_id, catalog_version, pricing_version,
           max_transactions, max_total_amount_minor, allow_discounts, status, issued_at, expires_at,
           signature, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, 0, 'active', ?, ?, ?, ?, ?)`
      )
      .bind(
        authId,
        businessId,
        branchId,
        userId,
        input.deviceId,
        maxTransactions,
        maxTotalAmountMinor,
        nowIso,
        expiresAt,
        signature,
        nowIso,
        nowIso
      )

    // Execute atomic batch insert
    await this.db.batch([authInsert, ...allocationInserts])

    return {
      authorizationId: authId,
      businessId,
      branchId,
      userId,
      deviceId: input.deviceId,
      catalogVersion: 1,
      pricingVersion: 1,
      maxTransactions,
      maxTotalAmountMinor,
      allowDiscounts: false,
      status: 'active',
      issuedAt: nowIso,
      expiresAt,
      allowedPaymentMethods: ['cash'],
      productAllocations: allocationDTOs,
      signature,
    }
  }

  /**
   * Commits a provisional offline cash sale into central D1 with atomic financial and inventory updates.
   */
  async commitOfflineSale(params: {
    businessId: string
    branchId: string
    userId: string
    cashierName: string
    input: CommitOfflineSaleInput
    idempotencyKey?: string
    secret: string
  }): Promise<CommitOfflineSaleResponse> {
    const { businessId, branchId, userId, cashierName, input, idempotencyKey, secret } = params

    // 1. Check Idempotency First (Ensures Exactly-Once Processing and Response Recovery)
    let requestHash = ''
    if (idempotencyKey) {
      requestHash = await computeCanonicalRequestHash(input)
      const cached = await checkIdempotency(
        this.db,
        businessId,
        'commit_offline_sale',
        idempotencyKey,
        requestHash
      )
      if (cached) {
        return {
          ...(cached.body as CommitOfflineSaleResponse),
          isCached: true,
        }
      }
    }

    // 2. Validate Device
    const device = await this.db
      .prepare('SELECT id, business_id, status FROM devices WHERE id = ? AND business_id = ? LIMIT 1')
      .bind(input.deviceId, businessId)
      .first<DeviceRow>()

    if (!device || device.status !== 'active') {
      throw HttpError.forbidden(`Device '${input.deviceId}' is revoked or not found for business '${businessId}'.`)
    }

    // 3. Validate Authorization
    const auth = await this.db
      .prepare('SELECT * FROM offline_authorizations WHERE id = ? AND business_id = ? LIMIT 1')
      .bind(input.authorizationId, businessId)
      .first<AuthRow>()

    if (!auth) {
      throw HttpError.notFound(`Offline authorization '${input.authorizationId}' not found.`)
    }
    if (auth.status !== 'active') {
      throw HttpError.forbidden(`Offline authorization '${auth.id}' is '${auth.status}'.`)
    }
    if (auth.branch_id !== branchId) {
      throw HttpError.forbidden(`Offline authorization is bound to branch '${auth.branch_id}', not '${branchId}'.`)
    }
    if (auth.device_id !== input.deviceId) {
      throw HttpError.forbidden(`Offline authorization is bound to device '${auth.device_id}', not '${input.deviceId}'.`)
    }

    // Check expiry
    const now = new Date()
    if (new Date(auth.expires_at).getTime() < now.getTime()) {
      throw HttpError.forbidden(`Offline authorization '${auth.id}' expired at ${auth.expires_at}.`)
    }

    // 4. Validate Cryptographic Signature
    const productIds = input.items.map((i) => i.productId)
    const isSignatureValid = await verifyAuthorizationPayload(
      secret,
      {
        authorizationId: auth.id,
        businessId,
        branchId,
        userId: auth.user_id,
        deviceId: auth.device_id,
        expiresAt: auth.expires_at,
        productIds,
      },
      auth.signature
    )

    if (!isSignatureValid) {
      throw HttpError.forbidden('Invalid or tampered offline authorization signature.')
    }

    // 5. Validate Line Items, Allocations, and Quota
    const placeholders = productIds.map(() => '?').join(', ')
    const productsRes = await this.db
      .prepare(
        `SELECT id, name, sku, unit, selling_price_minor, purchase_price_minor, track_inventory, status
         FROM products
         WHERE business_id = ? AND id IN (${placeholders})`
      )
      .bind(businessId, ...productIds)
      .all<ProductRow>()

    const productMap = new Map<string, ProductRow>()
    for (const p of productsRes.results || []) {
      productMap.set(p.id, p)
    }

    const allocIds = input.items.map((i) => i.allocationId)
    const allocPlaceholders = allocIds.map(() => '?').join(', ')
    const allocationsRes = await this.db
      .prepare(
        `SELECT * FROM device_stock_allocations
         WHERE business_id = ? AND authorization_id = ? AND device_id = ? AND id IN (${allocPlaceholders})`
      )
      .bind(businessId, auth.id, input.deviceId, ...allocIds)
      .all<AllocationRow>()

    const allocationMap = new Map<string, AllocationRow>()
    for (const a of allocationsRes.results || []) {
      allocationMap.set(a.id, a)
    }

    // Query physical inventory to track previous and new quantities for stock movements
    const invBalances = await this.db
      .prepare(
        `SELECT product_id, quantity_on_hand
         FROM inventory_balances
         WHERE business_id = ? AND branch_id = ? AND product_id IN (${placeholders})`
      )
      .bind(businessId, branchId, ...productIds)
      .all<{ product_id: string; quantity_on_hand: number }>()

    const stockMap = new Map<string, number>()
    for (const r of invBalances.results || []) {
      stockMap.set(r.product_id, r.quantity_on_hand)
    }

    interface ProcessedOfflineLine {
      id: string
      product: ProductRow
      allocation: AllocationRow
      quantity: number
      unitPriceMinor: number
      unitCostMinor: number
      lineTotalMinor: number
    }

    const processedLines: ProcessedOfflineLine[] = []
    let computedTotalMinor = 0

    for (let i = 0; i < input.items.length; i++) {
      const item = input.items[i]
      const product = productMap.get(item.productId)
      if (!product || product.status !== 'active') {
        throw HttpError.badRequest(`Product at line ${i + 1} does not exist or is inactive.`)
      }

      const validatedQty = validateQuantityByUnit(item.quantity, product.unit, `items[${i}].quantity`)
      const allocation = allocationMap.get(item.allocationId)
      if (!allocation || allocation.status !== 'active') {
        throw HttpError.badRequest(`Active stock allocation not found for product '${product.name}'.`)
      }
      if (allocation.product_id !== product.id) {
        throw HttpError.badRequest(`Allocation '${item.allocationId}' belongs to different product.`)
      }

      const remainingQuota = allocation.allocated_quantity - allocation.consumed_quantity
      if (remainingQuota < validatedQty) {
        throw new HttpError(
          422,
          'ALLOCATION_EXCEEDS_BALANCE',
          `Offline allocation quota exceeded for '${product.name}'. Remaining quota: ${remainingQuota}, Requested: ${validatedQty}.`,
          {
            productId: product.id,
            remainingQuota,
            requestedQuantity: validatedQty,
          }
        )
      }

      // Authoritative pricing from server catalog snapshot
      const unitPriceMinor = product.selling_price_minor
      const lineTotalMinor = calculateLineSubtotalMinor(validatedQty, unitPriceMinor)
      computedTotalMinor += lineTotalMinor

      processedLines.push({
        id: `si_${crypto.randomUUID()}`,
        product,
        allocation,
        quantity: validatedQty,
        unitPriceMinor,
        unitCostMinor: product.purchase_price_minor,
        lineTotalMinor,
      })
    }

    // 6. Validate Cash Payment
    if (input.cashTenderedMinor < computedTotalMinor) {
      throw HttpError.badRequest(
        `Cash tendered (${input.cashTenderedMinor} paise) is less than total sale amount (${computedTotalMinor} paise).`
      )
    }
    const changeReturnedMinor = input.cashTenderedMinor - computedTotalMinor

    // 7. Auto-provision or query Walk-in Customer for this business
    let walkIn = await this.db
      .prepare('SELECT id, name, customer_code FROM customers WHERE business_id = ? AND is_walk_in = 1 LIMIT 1')
      .bind(businessId)
      .first<{ id: string; name: string; customer_code: string }>()

    if (!walkIn) {
      const walkInId = `cust_walkin_${businessId}`
      await this.db
        .prepare(
          `INSERT INTO customers (id, business_id, customer_code, name, type, is_walk_in, status, created_at, updated_at)
           VALUES (?, ?, 'WALKIN', 'Walk-in Customer', 'individual', 1, 'active', datetime('now'), datetime('now'))`
        )
        .bind(walkInId, businessId)
        .run()

      walkIn = { id: walkInId, name: 'Walk-in Customer', customer_code: 'WALKIN' }
    }

    const customerSnapshot = {
      id: walkIn.id,
      name: walkIn.name,
      customerCode: walkIn.customer_code,
      isWalkIn: true,
    }

    // 8. Generate Primary Financial Keys
    const saleId = `sale_${crypto.randomUUID()}`
    const invoiceId = `inv_${crypto.randomUUID()}`
    const paymentId = `pay_${crypto.randomUUID()}`
    const allocationId = `alloc_pay_${crypto.randomUUID()}`
    const businessDateKey = getCurrentBusinessDateKey()
    const nowIso = now.toISOString()
    const timestamp = now.getTime()

    const saleNumber = `SALE-${timestamp.toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`
    const receiptNumber = `RCP-${timestamp.toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`
    const invoiceNumber = `INV-${timestamp.toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`
    const paymentReceiptNumber = `PAY-${timestamp.toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`

    const statements: D1PreparedStatement[] = []

    // Statement 1: Insert Sale Header
    statements.push(
      this.db
        .prepare(
          `INSERT INTO sales (
             id, business_id, branch_id, sale_number, receipt_number, invoice_number,
             customer_id, customer_snapshot_json, terminal_id, cashier_id, cashier_name,
             subtotal_minor, discount_type, discount_value, discount_minor, tax_minor,
             total_amount_minor, amount_paid_minor, remaining_balance_minor,
             change_returned_minor, status, business_date_key, idempotency_key, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'fixed', 0, 0, 0, ?, ?, 0, ?, 'completed', ?, ?, datetime('now'), datetime('now'))`
        )
        .bind(
          saleId,
          businessId,
          branchId,
          saleNumber,
          receiptNumber,
          invoiceNumber,
          walkIn.id,
          JSON.stringify(customerSnapshot),
          input.terminalId || 'OFFLINE-POS',
          userId,
          cashierName,
          computedTotalMinor,
          computedTotalMinor,
          computedTotalMinor,
          changeReturnedMinor,
          businessDateKey,
          idempotencyKey ?? null
        )
    )

    // Statement 2: Insert Sale Items
    for (const line of processedLines) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO sale_items (
               id, sale_id, product_id, sku, product_name, unit, unit_price_minor, unit_cost_minor,
               cogs_estimated, quantity, subtotal_minor, discount_minor, tax_minor, line_total_minor,
               returned_quantity
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, 0, ?, 0.0)`
          )
          .bind(
            line.id,
            saleId,
            line.product.id,
            line.product.sku,
            line.product.name,
            line.product.unit,
            line.unitPriceMinor,
            line.unitCostMinor,
            line.quantity,
            line.lineTotalMinor,
            line.lineTotalMinor
          )
      )

      // Statement 3: Insert Stock Movement
      const prevQty = stockMap.get(line.product.id) ?? 0
      const nextQty = prevQty - line.quantity
      stockMap.set(line.product.id, nextQty)

      const movementId = `mov_${crypto.randomUUID()}`
      const movementNumber = `SM-${timestamp.toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`
      statements.push(
        this.db
          .prepare(
            `INSERT INTO stock_movements (
               id, business_id, branch_id, movement_number, product_id, type,
               quantity_change, previous_quantity, new_quantity, unit_cost_minor,
               reference_type, reference_id, reference_number, notes, business_date_key,
               created_by, created_at
             ) VALUES (?, ?, ?, ?, ?, 'sale', ?, ?, ?, ?, 'sale', ?, ?, 'Offline POS Cash Sale', ?, ?, datetime('now'))`
          )
          .bind(
            movementId,
            businessId,
            branchId,
            movementNumber,
            line.product.id,
            -line.quantity,
            prevQty,
            nextQty,
            line.unitCostMinor,
            saleId,
            saleNumber,
            businessDateKey,
            userId
          )
      )

      // Statement 4: Decrement Physical Inventory Balance
      statements.push(
        this.db
          .prepare(
            `UPDATE inventory_balances
             SET quantity_on_hand = quantity_on_hand - ?, updated_at = datetime('now')
             WHERE business_id = ? AND branch_id = ? AND product_id = ?`
          )
          .bind(line.quantity, businessId, branchId, line.product.id)
      )

      // Statement 5: Consume Device Allocation Quota (Guarded by CHECK constraint: consumed_quantity <= allocated_quantity)
      statements.push(
        this.db
          .prepare(
            `UPDATE device_stock_allocations
             SET consumed_quantity = consumed_quantity + ?, updated_at = datetime('now')
             WHERE id = ? AND authorization_id = ?`
          )
          .bind(line.quantity, line.allocation.id, auth.id)
      )

      // Statement 6: Multi-Device Change Feed Log for Stock Changes
      const eventId = `evt_${crypto.randomUUID()}`
      statements.push(
        this.db
          .prepare(
            `INSERT INTO sync_change_log (
               business_id, branch_id, resource_type, resource_id, resource_version,
               operation, payload, event_id, created_at
             ) VALUES (?, ?, 'stock', ?, 1, 'upsert', ?, ?, datetime('now'))`
          )
          .bind(
            businessId,
            branchId,
            line.product.id,
            JSON.stringify({
              productId: line.product.id,
              branchId,
              quantityDeducted: line.quantity,
              reason: 'offline_sale_commit',
            }),
            eventId
          )
      )
    }

    // Statement 7: Insert Invoice
    statements.push(
      this.db
        .prepare(
          `INSERT INTO invoices (
             id, business_id, branch_id, invoice_number, sale_id, customer_id,
             business_date_key, total_amount_minor, paid_amount_minor, remaining_amount_minor,
             payment_status, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'paid', 'active', datetime('now'), datetime('now'))`
        )
        .bind(
          invoiceId,
          businessId,
          branchId,
          invoiceNumber,
          saleId,
          walkIn.id,
          businessDateKey,
          computedTotalMinor,
          computedTotalMinor
        )
    )

    // Statement 8: Insert Cash Payment
    statements.push(
      this.db
        .prepare(
          `INSERT INTO payments (
             id, business_id, branch_id, receipt_number, customer_id, customer_snapshot_json,
             amount_minor, unallocated_amount_minor, source, notes, business_date_key,
             received_by, received_at, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'pos_checkout', 'Offline POS Cash Tender', ?, ?, datetime('now'), datetime('now'))`
        )
        .bind(
          paymentId,
          businessId,
          branchId,
          paymentReceiptNumber,
          walkIn.id,
          JSON.stringify(customerSnapshot),
          computedTotalMinor,
          businessDateKey,
          userId
        )
    )

    // Statement 9: Insert Payment Method (cash)
    const methodId = `pm_${crypto.randomUUID()}`
    statements.push(
      this.db
        .prepare(
          `INSERT INTO payment_methods (id, payment_id, method, amount_minor, reference)
           VALUES (?, ?, 'cash', ?, ?)`
        )
        .bind(methodId, paymentId, computedTotalMinor, input.provisionalReceiptNumber)
    )

    // Statement 10: Insert Payment Allocation
    statements.push(
      this.db
        .prepare(
          `INSERT INTO payment_allocations (id, business_id, payment_id, sale_id, invoice_number, amount_minor, allocated_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
        )
        .bind(allocationId, businessId, paymentId, saleId, invoiceNumber, computedTotalMinor)
    )

    const responseDTO: CommitOfflineSaleResponse = {
      saleId,
      saleNumber,
      invoiceId,
      invoiceNumber,
      totalAmountMinor: computedTotalMinor,
      cashTenderedMinor: input.cashTenderedMinor,
      changeReturnedMinor,
      provisionalReceiptNumber: input.provisionalReceiptNumber,
      provisionalSaleId: input.provisionalSaleId,
      status: 'completed',
      createdAt: nowIso,
    }

    // Statement 11: Idempotency Key Insert
    if (idempotencyKey) {
      statements.push(
        buildIdempotencyInsertStatement(
          this.db,
          businessId,
          'commit_offline_sale',
          idempotencyKey,
          requestHash,
          201,
          responseDTO
        )
      )
    }

    // 8. Execute Atomic D1 Batch
    await this.db.batch(statements)

    return responseDTO
  }

  /**
   * Reconciles an allocation, releasing unconsumed quota back into available inventory pool.
   */
  async reconcileAllocation(
    businessId: string,
    allocationId: string
  ): Promise<AllocationReconciliationResponse> {
    const alloc = await this.db
      .prepare('SELECT * FROM device_stock_allocations WHERE id = ? AND business_id = ? LIMIT 1')
      .bind(allocationId, businessId)
      .first<AllocationRow>()

    if (!alloc) {
      throw HttpError.notFound(`Stock allocation '${allocationId}' not found.`)
    }

    const nowIso = new Date().toISOString()
    const released = Math.max(0, alloc.allocated_quantity - alloc.consumed_quantity)

    await this.db
      .prepare(
        `UPDATE device_stock_allocations
         SET status = 'reconciled', reconciled_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(nowIso, nowIso, alloc.id)
      .run()

    return {
      allocationId: alloc.id,
      productId: alloc.product_id,
      allocatedQuantity: alloc.allocated_quantity,
      consumedQuantity: alloc.consumed_quantity,
      releasedQuantity: released,
      status: 'reconciled',
      reconciledAt: nowIso,
    }
  }

  /**
   * Admin-initiated reconciliation for a lost or stolen device.
   */
  async reconcileLostDevice(
    businessId: string,
    deviceId: string
  ): Promise<{ deviceId: string; status: 'revoked'; reconciledAllocationsCount: number }> {
    const nowIso = new Date().toISOString()

    const allocations = await this.db
      .prepare('SELECT id FROM device_stock_allocations WHERE business_id = ? AND device_id = ? AND status = ?')
      .bind(businessId, deviceId, 'active')
      .all<{ id: string }>()

    const stmts: D1PreparedStatement[] = [
      this.db
        .prepare('UPDATE devices SET status = ?, updated_at = ? WHERE id = ? AND business_id = ?')
        .bind('revoked', nowIso, deviceId, businessId),
      this.db
        .prepare(
          'UPDATE device_stock_allocations SET status = ?, reconciled_at = ?, updated_at = ? WHERE business_id = ? AND device_id = ? AND status = ?'
        )
        .bind('revoked', nowIso, nowIso, businessId, deviceId, 'active'),
    ]

    await this.db.batch(stmts)

    return {
      deviceId,
      status: 'revoked',
      reconciledAllocationsCount: allocations.results?.length || 0,
    }
  }
}
