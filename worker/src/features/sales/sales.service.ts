import { HttpError } from '../../lib/errors'
import { getCurrentBusinessDateKey } from '../../lib/businessDate'
import { hasPermission, type MemberRole } from '../../auth/tenantContext'
import {
  computeCanonicalRequestHash,
  checkIdempotency,
  buildIdempotencyInsertStatement,
} from '../../lib/idempotency'
import {
  validateQuantityByUnit,
  calculateLineSubtotalMinor,
  calculateDiscountMinor,
  distributeDiscountProportionalMinor,
  calculateTaxMinor,
  bpsFromPercent,
} from '../../lib/money'
import { SalesRepository } from './sales.repository'
import { ChangeLogRepository } from '../sync/changeLog.repository'
import type {
  CreateSaleInput,
  SaleDTO,
  SaleFilterParams,
  SaleListResult,
  CustomerSnapshot,
  SaleRow,
  SaleItemRow,
  SalePaymentDTO,
} from './sales.types'

interface ProductRecord {
  id: string
  name: string
  sku: string
  unit: string
  purchase_price_minor: number
  selling_price_minor: number
  track_inventory: number
  status: string
}

interface CustomerRecord {
  id: string
  name: string
  customer_code: string
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  is_walk_in: number
  status: string
  opening_balance_minor: number
  credit_limit_minor: number
}

interface BusinessSettings {
  allow_negative_stock: number
  default_tax_rate: number
  settings_json: string | null
}

export class SalesService {
  private readonly repo: SalesRepository
  private readonly db: D1Database
  private readonly changeLogRepo: ChangeLogRepository

  constructor(db: D1Database) {
    this.repo = new SalesRepository(db)
    this.db = db
    this.changeLogRepo = new ChangeLogRepository(db)
  }

  async listSales(
    businessId: string,
    filters: SaleFilterParams,
    authorizedBranchIds: string[]
  ): Promise<SaleListResult> {
    const totalCount = await this.repo.countSales(businessId, filters, authorizedBranchIds)
    const items = await this.repo.listSales(businessId, filters, authorizedBranchIds)
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

  async getSaleById(
    businessId: string,
    saleId: string,
    authorizedBranchIds: string[]
  ): Promise<SaleDTO> {
    const sale = await this.repo.getSaleById(businessId, saleId, authorizedBranchIds)
    if (!sale) {
      throw HttpError.notFound('Sale not found.')
    }
    return sale
  }

  async completeSale(
    businessId: string,
    branchId: string,
    cashierId: string,
    cashierName: string,
    input: CreateSaleInput,
    idempotencyKey?: string | null,
    actorRole: MemberRole = 'cashier'
  ): Promise<SaleDTO> {
    // 1. Idempotency Check
    let requestHash = ''
    if (idempotencyKey) {
      requestHash = await computeCanonicalRequestHash(input)
      const cached = await checkIdempotency(
        this.db,
        businessId,
        'complete_sale',
        idempotencyKey,
        requestHash
      )
      if (cached) {
        return cached.body as SaleDTO
      }
    }

    // 2. Validate Branch exists and belongs to business
    const branch = await this.db
      .prepare('SELECT id, name, status FROM branches WHERE business_id = ? AND id = ? LIMIT 1')
      .bind(businessId, branchId)
      .first<{ id: string; name: string; status: string }>()
    if (!branch || branch.status !== 'active') {
      throw HttpError.badRequest('Target branch does not exist or is inactive.')
    }

    // 3. Resolve Customer
    let customer: CustomerRecord
    if (input.customerId && input.customerId !== 'walk-in') {
      const found = await this.db
        .prepare('SELECT * FROM customers WHERE business_id = ? AND id = ? LIMIT 1')
        .bind(businessId, input.customerId)
        .first<CustomerRecord>()
      if (!found || found.status === 'archived') {
        throw HttpError.badRequest('Customer does not exist or is archived.', { field: 'customerId' })
      }
      customer = found
    } else {
      // Look up walk-in customer
      let walkIn = await this.db
        .prepare('SELECT * FROM customers WHERE business_id = ? AND is_walk_in = 1 LIMIT 1')
        .bind(businessId)
        .first<CustomerRecord>()

      if (!walkIn) {
        // Auto-provision standard walk-in customer for this business idempotently (safe under concurrent checkouts)
        const walkInId = `cust_walkin_${businessId}`
        await this.db
          .prepare(
            `INSERT OR IGNORE INTO customers (id, business_id, customer_code, name, type, is_walk_in, status, created_at, updated_at)
             VALUES (?, ?, 'WALKIN', 'Walk-in Customer', 'individual', 1, 'active', datetime('now'), datetime('now'))`
          )
          .bind(walkInId, businessId)
          .run()

        walkIn = (await this.db
          .prepare('SELECT * FROM customers WHERE business_id = ? AND is_walk_in = 1 LIMIT 1')
          .bind(businessId)
          .first<CustomerRecord>())!
      }
      customer = walkIn
    }

    const customerSnapshot: CustomerSnapshot = {
      id: customer.id,
      name: customer.name,
      customerCode: customer.customer_code,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      city: customer.city,
      isWalkIn: Boolean(customer.is_walk_in),
    }

    // 4. Fetch Business Settings (inventory policy, tax policy, discount policy)
    const settings = await this.db
      .prepare(
        'SELECT allow_negative_stock, default_tax_rate, settings_json FROM business_settings WHERE business_id = ? LIMIT 1'
      )
      .bind(businessId)
      .first<BusinessSettings>()
    const allowNegativeStock = settings?.allow_negative_stock !== 0 // Default allowed with warning unless explicitly 0

    let parsedSettingsJson: Record<string, unknown> = {}
    if (settings?.settings_json) {
      try {
        parsedSettingsJson = JSON.parse(settings.settings_json) as Record<string, unknown>
      } catch {
        parsedSettingsJson = {}
      }
    }
    const taxInclusive = Boolean(parsedSettingsJson.taxInclusive ?? false)
    const maxCashierDiscountPercent =
      typeof parsedSettingsJson.maxCashierDiscountPercent === 'number' &&
      Number.isFinite(parsedSettingsJson.maxCashierDiscountPercent) &&
      parsedSettingsJson.maxCashierDiscountPercent >= 0
        ? Math.min(100, parsedSettingsJson.maxCashierDiscountPercent)
        : 10
    const taxRatePercent =
      typeof settings?.default_tax_rate === 'number' &&
      Number.isFinite(settings.default_tax_rate) &&
      settings.default_tax_rate > 0
        ? settings.default_tax_rate
        : 0
    const taxRateBps = bpsFromPercent(taxRatePercent)

    // 5. Validate Products & Quantities & Stock
    const productIds = input.items.map((i) => i.productId)
    const placeholders = productIds.map(() => '?').join(', ')
    const productsRes = await this.db
      .prepare(
        `SELECT id, name, sku, unit, purchase_price_minor, selling_price_minor, track_inventory, status
         FROM products
         WHERE business_id = ? AND id IN (${placeholders})`
      )
      .bind(businessId, ...productIds)
      .all<ProductRecord>()

    const productMap = new Map<string, ProductRecord>()
    for (const p of productsRes.results || []) {
      productMap.set(p.id, p)
    }

    // Query inventory balances for this branch
    const invRes = await this.db
      .prepare(
        `SELECT product_id, quantity_on_hand
         FROM inventory_balances
         WHERE business_id = ? AND branch_id = ? AND product_id IN (${placeholders})`
      )
      .bind(businessId, branchId, ...productIds)
      .all<{ product_id: string; quantity_on_hand: number }>()

    const stockMap = new Map<string, number>()
    for (const row of invRes.results || []) {
      stockMap.set(row.product_id, row.quantity_on_hand)
    }

    // Query active device stock allocations to prevent online sales from overselling reserved offline quota
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
    for (const row of allocRes.results || []) {
      reservedMap.set(row.product_id, row.reserved_quantity || 0)
    }

    const nowIso = new Date().toISOString()

    // Compute Item Lines with Server-Authoritative Pricing & Override Controls
    interface ProcessedItemLine {
      id: string
      product: ProductRecord
      quantity: number
      unitPriceMinor: number
      originalUnitPriceMinor: number | null
      priceOverrideReason: string | null
      priceOverrideBy: string | null
      priceOverrideAt: string | null
      unitCostMinor: number
      subtotalMinor: number
      itemDiscountMinor: number
      allocatedOrderDiscountMinor: number
      discountMinor: number
      taxMinor: number
      lineTotalMinor: number
      currentStock: number
      newStock: number
      requestedTaxMinor?: number
      requestedTaxOverride?: boolean
      overrideReason?: string
    }

    const processedLines: ProcessedItemLine[] = []
    const overrideAuditEntries: Array<{ action: string; diff: Record<string, unknown> }> = []
    let computedSubtotalMinor = 0
    let totalItemDiscountMinor = 0

    for (let i = 0; i < input.items.length; i++) {
      const itemInput = input.items[i]
      const product = productMap.get(itemInput.productId)
      if (!product || product.status !== 'active') {
        throw HttpError.badRequest(
          `Product at line ${i + 1} does not exist, belongs to another business, or is inactive.`,
          { field: `items[${i}].productId` }
        )
      }

      // Quantity validation against unit
      const validatedQty = validateQuantityByUnit(itemInput.quantity, product.unit, `items[${i}].quantity`)

      // Server-authoritative catalog pricing + gated override validation
      const catalogUnitPriceMinor = product.selling_price_minor
      let unitPriceMinor = catalogUnitPriceMinor
      let originalUnitPriceMinor: number | null = null
      let priceOverrideReason: string | null = null
      let priceOverrideBy: string | null = null
      let priceOverrideAt: string | null = null

      if (itemInput.unitPriceMinor !== undefined && itemInput.unitPriceMinor !== catalogUnitPriceMinor) {
        if (!hasPermission(actorRole, 'price_override')) {
          throw HttpError.forbidden(
            `Price override for '${product.name}' requires price_override permission.`,
            {
              field: `items[${i}].unitPriceMinor`,
              catalogUnitPriceMinor,
              requestedUnitPriceMinor: itemInput.unitPriceMinor,
            }
          )
        }
        const reason = (itemInput.overrideReason || input.overrideReason || '').trim()
        if (reason.length < 3) {
          throw HttpError.badRequest(
            `A price override reason (minimum 3 characters) is required for '${product.name}'.`,
            { field: `items[${i}].overrideReason` }
          )
        }
        unitPriceMinor = itemInput.unitPriceMinor
        originalUnitPriceMinor = catalogUnitPriceMinor
        priceOverrideReason = reason
        priceOverrideBy = cashierId
        priceOverrideAt = nowIso
        overrideAuditEntries.push({
          action: 'SALE_PRICE_OVERRIDE',
          diff: {
            productId: product.id,
            sku: product.sku,
            originalUnitPriceMinor: catalogUnitPriceMinor,
            overriddenUnitPriceMinor: unitPriceMinor,
            reason,
          },
        })
      }

      const subtotalMinor = calculateLineSubtotalMinor(validatedQty, unitPriceMinor)
      const itemDiscountMinor = itemInput.discountMinor ?? 0
      if (itemDiscountMinor > subtotalMinor) {
        throw HttpError.badRequest(
          `Item discount at line ${i + 1} cannot exceed line subtotal.`,
          { field: `items[${i}].discountMinor` }
        )
      }
      if (itemDiscountMinor > 0) {
        if (!hasPermission(actorRole, 'discount_override')) {
          throw HttpError.forbidden(
            `Line-item discount override for '${product.name}' requires discount_override permission.`,
            { field: `items[${i}].discountMinor` }
          )
        }
        const reason = (itemInput.overrideReason || input.overrideReason || '').trim()
        if (reason.length < 3) {
          throw HttpError.badRequest(
            `An override reason (minimum 3 characters) is required for line-item discount on '${product.name}'.`,
            { field: `items[${i}].overrideReason` }
          )
        }
        overrideAuditEntries.push({
          action: 'SALE_DISCOUNT_OVERRIDE',
          diff: {
            scope: 'line',
            productId: product.id,
            discountMinor: itemDiscountMinor,
            reason,
          },
        })
      }

      // Stock checks (accounting for physical stock minus active offline allocations)
      const physicalStock = stockMap.get(product.id) ?? 0
      const reservedStock = reservedMap.get(product.id) ?? 0
      const currentStock = Math.max(0, physicalStock - reservedStock)
      if (Boolean(product.track_inventory) && !allowNegativeStock && currentStock < validatedQty) {
        throw new HttpError(
          422,
          'INSUFFICIENT_STOCK',
          `Insufficient stock for '${product.name}'. Available: ${currentStock} ${product.unit} (Physical: ${physicalStock}, Reserved for Offline: ${reservedStock}), Requested: ${validatedQty} ${product.unit}.`,
          {
            productId: product.id,
            availableQuantity: currentStock,
            physicalQuantity: physicalStock,
            reservedQuantity: reservedStock,
            requestedQuantity: validatedQty,
          }
        )
      }

      const newStock = physicalStock - validatedQty
      stockMap.set(product.id, newStock) // Update running map for multiple lines of same product

      computedSubtotalMinor += subtotalMinor
      totalItemDiscountMinor += itemDiscountMinor

      processedLines.push({
        id: `si_${crypto.randomUUID()}`,
        product,
        quantity: validatedQty,
        unitPriceMinor,
        originalUnitPriceMinor,
        priceOverrideReason,
        priceOverrideBy,
        priceOverrideAt,
        unitCostMinor: product.purchase_price_minor,
        subtotalMinor,
        itemDiscountMinor,
        allocatedOrderDiscountMinor: 0,
        discountMinor: itemDiscountMinor,
        taxMinor: 0,
        lineTotalMinor: subtotalMinor - itemDiscountMinor,
        currentStock,
        newStock,
        requestedTaxMinor: itemInput.taxMinor,
        requestedTaxOverride: itemInput.taxOverride,
        overrideReason: itemInput.overrideReason || input.overrideReason,
      })
    }

    // 6. Discount & Tax Authority Validation + Proportional Allocation
    const discountType = input.discountType ?? 'fixed'
    const discountValue = input.discountValue ?? 0
    const postItemDiscountSubtotal = Math.max(0, computedSubtotalMinor - totalItemDiscountMinor)
    const orderDiscountMinor = calculateDiscountMinor(
      postItemDiscountSubtotal,
      discountType,
      discountValue,
      input.discountMinor
    )

    if (orderDiscountMinor > 0) {
      if (!hasPermission(actorRole, 'apply_discount')) {
        throw HttpError.forbidden('Applying order discounts requires apply_discount permission.', {
          field: 'discountValue',
        })
      }

      const totalCandidateDiscountMinor = totalItemDiscountMinor + orderDiscountMinor
      const maxCashierDiscountMinor = Math.floor(
        (computedSubtotalMinor * bpsFromPercent(maxCashierDiscountPercent)) / 10000
      )
      const exceedsCashierLimit =
        totalCandidateDiscountMinor > maxCashierDiscountMinor ||
        (discountType === 'percent' && discountValue > maxCashierDiscountPercent)

      if (exceedsCashierLimit) {
        if (!hasPermission(actorRole, 'discount_override')) {
          throw HttpError.forbidden(
            `Discount exceeds standard cashier limit of ${maxCashierDiscountPercent}% and requires discount_override permission.`,
            {
              field: 'discountValue',
              maxCashierDiscountPercent,
              requestedDiscountMinor: totalCandidateDiscountMinor,
              maxCashierDiscountMinor,
            }
          )
        }
        const reason = (input.overrideReason || '').trim()
        if (reason.length < 3) {
          throw HttpError.badRequest(
            'An override reason (minimum 3 characters) is required when exceeding standard cashier discount limit.',
            { field: 'overrideReason' }
          )
        }
        overrideAuditEntries.push({
          action: 'SALE_DISCOUNT_OVERRIDE',
          diff: {
            scope: 'order',
            discountType,
            discountValue,
            orderDiscountMinor,
            totalDiscountMinor: totalCandidateDiscountMinor,
            maxCashierDiscountPercent,
            reason,
          },
        })
      }
    }

    const lineWeights = processedLines.map((l) => Math.max(0, l.subtotalMinor - l.itemDiscountMinor))
    const allocatedOrderDiscounts = distributeDiscountProportionalMinor(lineWeights, orderDiscountMinor)

    let totalSaleDiscountMinor = 0
    let totalLineTaxMinor = 0
    let totalAmountMinor = 0

    for (let i = 0; i < processedLines.length; i++) {
      const line = processedLines[i]
      line.allocatedOrderDiscountMinor = allocatedOrderDiscounts[i] ?? 0
      line.discountMinor = line.itemDiscountMinor + line.allocatedOrderDiscountMinor
      const netLineMinor = Math.max(0, line.subtotalMinor - line.discountMinor)
      const serverTaxMinor = calculateTaxMinor(netLineMinor, taxRateBps, taxInclusive)

      if (line.requestedTaxMinor !== undefined && line.requestedTaxMinor !== serverTaxMinor) {
        if (!hasPermission(actorRole, 'tax_override')) {
          throw HttpError.forbidden(
            `Modifying computed tax for '${line.product.name}' requires tax_override permission.`,
            {
              field: `items[${i}].taxMinor`,
              serverTaxMinor,
              requestedTaxMinor: line.requestedTaxMinor,
            }
          )
        }
        const hasFlag = Boolean(line.requestedTaxOverride || input.taxOverride)
        const reason = (line.overrideReason || '').trim()
        if (!hasFlag || reason.length < 3) {
          throw HttpError.badRequest(
            `Explicit taxOverride flag and overrideReason (minimum 3 characters) are required to override tax for '${line.product.name}'.`,
            { field: `items[${i}].taxOverride` }
          )
        }
        line.taxMinor = line.requestedTaxMinor
        overrideAuditEntries.push({
          action: 'SALE_TAX_OVERRIDE',
          diff: {
            productId: line.product.id,
            serverTaxMinor,
            overriddenTaxMinor: line.taxMinor,
            reason,
          },
        })
      } else {
        line.taxMinor = serverTaxMinor
      }

      line.lineTotalMinor = taxInclusive ? netLineMinor : netLineMinor + line.taxMinor
      totalSaleDiscountMinor += line.discountMinor
      totalLineTaxMinor += line.taxMinor
      totalAmountMinor += line.lineTotalMinor
    }

    // 7. Payment Processing & Verification
    const payments = input.payments || []
    let creditPaymentMinor = 0
    let cashPaymentMinor = 0
    let electronicPaymentMinor = 0

    for (const p of payments) {
      if (p.method === 'credit') {
        creditPaymentMinor += p.amountMinor
      } else if (p.method === 'cash') {
        cashPaymentMinor += p.amountMinor
      } else {
        electronicPaymentMinor += p.amountMinor
      }
    }

    if (electronicPaymentMinor + creditPaymentMinor > totalAmountMinor) {
      throw HttpError.badRequest('Non-cash payments and credit cannot exceed the total amount.')
    }

    const cashAppliedMinor = Math.min(cashPaymentMinor, totalAmountMinor - electronicPaymentMinor - creditPaymentMinor)
    const changeReturnedMinor = cashPaymentMinor - cashAppliedMinor
    const amountPaidMinor = electronicPaymentMinor + cashAppliedMinor
    const remainingBalanceMinor = totalAmountMinor - amountPaidMinor

    if (creditPaymentMinor > 0 && creditPaymentMinor !== remainingBalanceMinor) {
      throw HttpError.badRequest('Credit payment does not match remaining balance.')
    }

    if (remainingBalanceMinor > 0 && customer.is_walk_in === 1) {
      throw HttpError.badRequest('Walk-in customer cannot purchase on credit. Balance must be fully settled.')
    }

    // Check customer credit limit if buying on credit
    if (remainingBalanceMinor > 0 && customer.credit_limit_minor > 0) {
      const balanceRes = await this.db
        .prepare(
          `SELECT balance_minor FROM customer_ledger_transactions
           WHERE business_id = ? AND customer_id = ?
           ORDER BY business_date_key DESC, created_at DESC, id DESC LIMIT 1`
        )
        .bind(businessId, customer.id)
        .first<{ balance_minor: number }>()

      const currentReceivable = balanceRes?.balance_minor ?? customer.opening_balance_minor
      if (currentReceivable + remainingBalanceMinor > customer.credit_limit_minor) {
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          `Sale exceeds customer's authorized credit limit of PKR ${(customer.credit_limit_minor / 100).toFixed(2)}. Current debt: PKR ${(currentReceivable / 100).toFixed(2)}.`,
          {
            currentDebtMinor: currentReceivable,
            newDebtMinor: remainingBalanceMinor,
            creditLimitMinor: customer.credit_limit_minor,
          }
        )
      }
    }

    // 8. Unique Number Generation
    const businessDateKey = getCurrentBusinessDateKey()
    const timestamp = Date.now()
    const randSuffix = crypto.randomUUID().slice(0, 6).toUpperCase()

    const saleId = `sale_${crypto.randomUUID()}`
    const invoiceId = `inv_${crypto.randomUUID()}`
    const saleNumber = `SALE-${businessDateKey.replace(/-/g, '')}-${randSuffix}`
    const receiptNumber = `RCP-${businessDateKey.replace(/-/g, '')}-${randSuffix}`
    const invoiceNumber = `INV-${businessDateKey.slice(0, 4)}-${timestamp.toString().slice(-6)}-${randSuffix}`

    // 9. Construct Statements for Atomic Batch
    const statements: D1PreparedStatement[] = []

    // Statement A: Insert Sale
    const insertSaleSql = `
      INSERT INTO sales (
        id, business_id, branch_id, sale_number, receipt_number, invoice_number,
        customer_id, customer_snapshot_json, terminal_id, cashier_id, cashier_name,
        subtotal_minor, discount_type, discount_value, discount_minor, tax_minor,
        total_amount_minor, amount_paid_minor, remaining_balance_minor, change_returned_minor,
        status, business_date_key, idempotency_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, datetime('now'), datetime('now'))
    `
    statements.push(
      this.db.prepare(insertSaleSql).bind(
        saleId,
        businessId,
        branchId,
        saleNumber,
        receiptNumber,
        invoiceNumber,
        customer.id,
        JSON.stringify(customerSnapshot),
        input.terminalId || 'POS01',
        cashierId,
        cashierName,
        computedSubtotalMinor,
        discountType,
        discountValue,
        totalSaleDiscountMinor,
        totalLineTaxMinor,
        totalAmountMinor,
        amountPaidMinor,
        remainingBalanceMinor,
        changeReturnedMinor,
        businessDateKey,
        idempotencyKey ?? null
      )
    )

    // Statement B: Insert Sale Items (including price override audit metadata)
    const insertItemSql = `
      INSERT INTO sale_items (
        id, sale_id, product_id, sku, product_name, unit,
        unit_price_minor, original_unit_price_minor, price_override_reason, price_override_by, price_override_at,
        unit_cost_minor, cogs_estimated, quantity,
        subtotal_minor, discount_minor, tax_minor, line_total_minor, returned_quantity
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 0.0)
    `
    for (const line of processedLines) {
      statements.push(
        this.db.prepare(insertItemSql).bind(
          line.id,
          saleId,
          line.product.id,
          line.product.sku,
          line.product.name,
          line.product.unit,
          line.unitPriceMinor,
          line.originalUnitPriceMinor,
          line.priceOverrideReason,
          line.priceOverrideBy,
          line.priceOverrideAt,
          line.unitCostMinor,
          line.quantity,
          line.subtotalMinor,
          line.discountMinor,
          line.taxMinor,
          line.lineTotalMinor
        )
      )
    }

    // Statement B2: Audit log entries for price/discount/tax overrides
    for (const auditEntry of overrideAuditEntries) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO audit_logs (id, business_id, branch_id, user_id, action, entity_type, entity_id, diff_json, created_at)
             VALUES (?, ?, ?, ?, ?, 'sale', ?, ?, datetime('now'))`
          )
          .bind(
            `aud_${crypto.randomUUID()}`,
            businessId,
            branchId,
            cashierId,
            auditEntry.action,
            saleId,
            JSON.stringify(auditEntry.diff)
          )
      )
    }

    // Statement C: Insert Invoice
    const paymentStatus =
      remainingBalanceMinor === 0 ? 'paid' : amountPaidMinor > 0 ? 'partial' : 'unpaid'

    const insertInvoiceSql = `
      INSERT INTO invoices (
        id, business_id, branch_id, invoice_number, sale_id, customer_id,
        business_date_key, total_amount_minor, paid_amount_minor, remaining_amount_minor,
        payment_status, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))
    `
    statements.push(
      this.db.prepare(insertInvoiceSql).bind(
        invoiceId,
        businessId,
        branchId,
        invoiceNumber,
        saleId,
        customer.id,
        businessDateKey,
        totalAmountMinor,
        amountPaidMinor,
        remainingBalanceMinor,
        paymentStatus
      )
    )

    // Statement D: Payments & Allocations (if amountPaidMinor > 0)
    const paymentMethodsDTO: SalePaymentDTO[] = []
    if (amountPaidMinor > 0) {
      const paymentId = `pay_${crypto.randomUUID()}`
      const payReceiptNumber = `PAY-${receiptNumber}`

      const insertPaymentSql = `
        INSERT INTO payments (
          id, business_id, branch_id, receipt_number, customer_id, customer_snapshot_json,
          amount_minor, unallocated_amount_minor, source, notes, business_date_key,
          received_by, received_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'pos_checkout', ?, ?, ?, datetime('now'), datetime('now'))
      `
      statements.push(
        this.db.prepare(insertPaymentSql).bind(
          paymentId,
          businessId,
          branchId,
          payReceiptNumber,
          customer.id,
          JSON.stringify(customerSnapshot),
          amountPaidMinor,
          input.notes ?? null,
          businessDateKey,
          cashierId
        )
      )

      // Insert payment methods breakdown
      const insertMethodSql = `
        INSERT INTO payment_methods (id, payment_id, method, amount_minor, reference)
        VALUES (?, ?, ?, ?, ?)
      `
      // Non-credit methods
      for (const p of payments) {
        if (p.method === 'credit') continue
        const methodAmount = p.method === 'cash' ? cashAppliedMinor : p.amountMinor
        if (methodAmount <= 0) continue

        paymentMethodsDTO.push({
          method: p.method,
          amountMinor: methodAmount,
          reference: p.reference ?? null,
        })

        statements.push(
          this.db.prepare(insertMethodSql).bind(
            `pm_${crypto.randomUUID()}`,
            paymentId,
            p.method,
            methodAmount,
            p.reference ?? null
          )
        )
      }

      // Insert payment allocation against this sale/invoice
      const insertAllocationSql = `
        INSERT INTO payment_allocations (id, business_id, payment_id, sale_id, invoice_number, amount_minor, allocated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `
      statements.push(
        this.db.prepare(insertAllocationSql).bind(
          `pa_${crypto.randomUUID()}`,
          businessId,
          paymentId,
          saleId,
          invoiceNumber,
          amountPaidMinor
        )
      )
    }

    if (creditPaymentMinor > 0) {
      paymentMethodsDTO.push({
        method: 'credit',
        amountMinor: creditPaymentMinor,
      })
    }

    // Statement E: Customer Subledger Entries (for named account customers)
    if (customer.is_walk_in === 0) {
      // Look up previous running balance
      const lastEntry = await this.db
        .prepare(
          `SELECT balance_minor FROM customer_ledger_transactions
           WHERE business_id = ? AND customer_id = ?
           ORDER BY business_date_key DESC, created_at DESC, id DESC LIMIT 1`
        )
        .bind(businessId, customer.id)
        .first<{ balance_minor: number }>()

      const baseBalance = lastEntry?.balance_minor ?? customer.opening_balance_minor

      // 1. Invoice Debit Entry
      const balanceAfterInvoice = baseBalance + totalAmountMinor
      const insertLedgerDebitSql = `
        INSERT INTO customer_ledger_transactions (
          id, business_id, branch_id, customer_id, type, reference_id,
          reference_number, description, debit_minor, credit_minor,
          balance_minor, business_date_key, created_at
        ) VALUES (?, ?, ?, ?, 'invoice', ?, ?, ?, ?, 0, ?, ?, datetime('now'))
      `
      statements.push(
        this.db.prepare(insertLedgerDebitSql).bind(
          `clt_${crypto.randomUUID()}`,
          businessId,
          branchId,
          customer.id,
          saleId,
          invoiceNumber,
          `Sales Invoice ${invoiceNumber}`,
          totalAmountMinor,
          balanceAfterInvoice,
          businessDateKey
        )
      )

      // 2. Payment Credit Entry (if paid at POS checkout)
      if (amountPaidMinor > 0) {
        const balanceAfterPayment = balanceAfterInvoice - amountPaidMinor
        const insertLedgerCreditSql = `
          INSERT INTO customer_ledger_transactions (
            id, business_id, branch_id, customer_id, type, reference_id,
            reference_number, description, debit_minor, credit_minor,
            balance_minor, business_date_key, created_at
          ) VALUES (?, ?, ?, ?, 'payment', ?, ?, ?, 0, ?, ?, ?, datetime('now'))
        `
        statements.push(
          this.db.prepare(insertLedgerCreditSql).bind(
            `clt_${crypto.randomUUID()}`,
            businessId,
            branchId,
            customer.id,
            saleId,
            receiptNumber,
            `POS Payment for Invoice ${invoiceNumber}`,
            amountPaidMinor,
            balanceAfterPayment,
            businessDateKey
          )
        )
      }
    }

    // Statement F: Inventory Movements and Balances Updates (Atomic Commit-Time Guard + Live Balance)
    for (const line of processedLines) {
      if (!line.product.track_inventory) continue

      const movementId = `mov_${crypto.randomUUID()}`
      const movementNumber = `MOV-${businessDateKey.replace(/-/g, '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`

      // 1. Ensure inventory_balances row exists initialized to 0.0 (never bind +line.quantity on initial insert)
      statements.push(
        this.db
          .prepare(
            `INSERT OR IGNORE INTO inventory_balances (
              id, business_id, branch_id, product_id, quantity_on_hand, updated_at
            ) VALUES (?, ?, ?, ?, 0.0, datetime('now'))`
          )
          .bind(`bal_${crypto.randomUUID()}`, businessId, branchId, line.product.id)
      )

      // 2. Insert canonical stock movement computing previous & new quantity from live in-tx balance.
      //    When allow_negative_stock = 0 and available stock < line.quantity, new_quantity evaluates to NULL,
      //    triggering NOT NULL constraint rollback across the entire D1 batch transaction.
      const insertMovementSql = `
        INSERT INTO stock_movements (
          id, business_id, branch_id, movement_number, product_id, type,
          quantity_change, previous_quantity, new_quantity, unit_cost_minor,
          reference_type, reference_id, reference_number, business_date_key,
          created_by, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, 'sale',
          ?,
          COALESCE((SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?), 0.0),
          CASE
            WHEN COALESCE((SELECT allow_negative_stock FROM business_settings WHERE business_id = ? LIMIT 1), 1) = 0
              AND (
                COALESCE((SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?), 0.0)
                - COALESCE((SELECT SUM(allocated_quantity - consumed_quantity) FROM device_stock_allocations WHERE business_id = ? AND branch_id = ? AND product_id = ? AND status = 'active'), 0.0)
              ) < ?
            THEN NULL
            ELSE COALESCE((SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?), 0.0) - ?
          END,
          ?, 'sale', ?, ?, ?, ?, datetime('now')
        )
      `
      statements.push(
        this.db.prepare(insertMovementSql).bind(
          movementId,
          businessId,
          branchId,
          movementNumber,
          line.product.id,
          -line.quantity,
          businessId,
          branchId,
          line.product.id,
          businessId,
          businessId,
          branchId,
          line.product.id,
          businessId,
          branchId,
          line.product.id,
          line.quantity,
          businessId,
          branchId,
          line.product.id,
          line.quantity,
          line.unitCostMinor,
          saleId,
          saleNumber,
          businessDateKey,
          cashierId
        )
      )

      // 3. Decrement existing Inventory Balance atomically
      statements.push(
        this.db
          .prepare(
            `UPDATE inventory_balances
             SET quantity_on_hand = quantity_on_hand - ?, updated_at = datetime('now')
             WHERE business_id = ? AND branch_id = ? AND product_id = ?`
          )
          .bind(line.quantity, businessId, branchId, line.product.id)
      )

      // 4. Emit authoritative post-deduction stock snapshot to sync_change_log
      statements.push(
        this.changeLogRepo.createLiveStockChangeEventStatement({
          businessId,
          branchId,
          productId: line.product.id,
          resourceId: `${branchId}:${line.product.id}`,
          resourceVersion: 0,
          unit: line.product.unit,
          updatedAt: nowIso,
          eventId: `${businessId}:stock:${branchId}:${line.product.id}:${movementId}`,
        })
      )
    }

    // 10. Construct Return DTO
    const createdSaleDTO: SaleDTO = {
      id: saleId,
      businessId,
      branchId,
      saleNumber,
      receiptNumber,
      invoiceNumber,
      customerId: customer.id,
      customerSnapshot,
      terminalId: input.terminalId || 'POS01',
      cashierId,
      cashierName,
      subtotalMinor: computedSubtotalMinor,
      discountType,
      discountValue,
      discountMinor: totalSaleDiscountMinor,
      taxMinor: totalLineTaxMinor,
      totalAmountMinor,
      amountPaidMinor,
      remainingBalanceMinor,
      changeReturnedMinor,
      status: 'completed',
      businessDateKey,
      createdAt: new Date(timestamp).toISOString(),
      updatedAt: new Date(timestamp).toISOString(),
      items: processedLines.map((line) => ({
        id: line.id,
        productId: line.product.id,
        sku: line.product.sku,
        productName: line.product.name,
        unit: line.product.unit,
        unitPriceMinor: line.unitPriceMinor,
        originalUnitPriceMinor: line.originalUnitPriceMinor,
        priceOverrideReason: line.priceOverrideReason,
        priceOverrideBy: line.priceOverrideBy,
        priceOverrideAt: line.priceOverrideAt,
        unitCostMinor: line.unitCostMinor,
        cogsEstimated: false,
        quantity: line.quantity,
        subtotalMinor: line.subtotalMinor,
        discountMinor: line.discountMinor,
        taxMinor: line.taxMinor,
        lineTotalMinor: line.lineTotalMinor,
        returnedQuantity: 0,
      })),
      payments: paymentMethodsDTO,
    }

    // Statement G: Idempotency Key (included in the atomic batch!)
    if (idempotencyKey) {
      statements.push(
        buildIdempotencyInsertStatement(
          this.db,
          businessId,
          'complete_sale',
          idempotencyKey,
          requestHash,
          201,
          createdSaleDTO
        )
      )
    }

    // 11. Execute Batch Atomically
    try {
      await this.repo.executeAtomicBatch(statements)
    } catch (err) {
      if (err instanceof Error && err.message.includes('stock_movements.new_quantity')) {
        throw new HttpError(
          422,
          'INSUFFICIENT_STOCK',
          'Insufficient stock available at commit time due to a concurrent update.'
        )
      }
      throw err
    }

    return createdSaleDTO
  }

  async voidSale(
    businessId: string,
    saleId: string,
    operatorId: string,
    operatorRole: string,
    reason?: string,
    authorizedBranchIds?: string[]
  ): Promise<SaleDTO> {
    // RBAC: Check void_sale permission
    if (!hasPermission(operatorRole as MemberRole, 'void_sale')) {
      throw HttpError.forbidden('Sale void requires manager or supervisor authorization.')
    }

    // Fetch sale
    const saleRow = await this.db
      .prepare('SELECT * FROM sales WHERE business_id = ? AND id = ? LIMIT 1')
      .bind(businessId, saleId)
      .first<SaleRow>()

    if (!saleRow) {
      throw HttpError.notFound('Sale not found.')
    }

    if (authorizedBranchIds && !authorizedBranchIds.includes(saleRow.branch_id)) {
      throw HttpError.forbidden('You are not authorized to void sales in this branch.')
    }

    if (saleRow.status === 'voided') {
      throw HttpError.badRequest('Sale has already been voided.')
    }

    if (saleRow.status !== 'completed') {
      throw HttpError.badRequest(`Cannot void sale with status '${saleRow.status}'.`)
    }

    // Check business settings for void window limit
    const settings = await this.db
      .prepare('SELECT max_void_hours FROM business_settings WHERE business_id = ? LIMIT 1')
      .bind(businessId)
      .first<{ max_void_hours: number | null }>()
    const maxVoidHours = settings?.max_void_hours ?? 24

    const saleCreatedAt = new Date(saleRow.created_at).getTime()
    if (!isNaN(saleCreatedAt)) {
      const elapsedHours = (Date.now() - saleCreatedAt) / (1000 * 60 * 60)
      if (elapsedHours > maxVoidHours) {
        throw HttpError.badRequest(
          `Void window expired. Sale is ${Math.round(elapsedHours)} hours old (max allowed: ${maxVoidHours}h). Use return workflow instead.`
        )
      }
    }

    // Same-business-day constraint as per BDR-08
    const currentBusinessDateKey = getCurrentBusinessDateKey()
    if (saleRow.business_date_key !== currentBusinessDateKey) {
      throw HttpError.badRequest(
        `Sale can only be voided on the same business date (${saleRow.business_date_key}). Current business date is ${currentBusinessDateKey}.`
      )
    }

    // Fetch items
    const itemsRes = await this.db
      .prepare('SELECT * FROM sale_items WHERE sale_id = ?')
      .bind(saleId)
      .all<SaleItemRow>()
    const items = itemsRes.results || []

    const statements: D1PreparedStatement[] = []

    // 1. Update sale status to voided
    statements.push(
      this.db
        .prepare(`UPDATE sales SET status = 'voided', updated_at = datetime('now') WHERE id = ?`)
        .bind(saleId)
    )

    // 2. Update invoice status to voided
    statements.push(
      this.db
        .prepare(`UPDATE invoices SET status = 'voided', remaining_amount_minor = 0, updated_at = datetime('now') WHERE sale_id = ?`)
        .bind(saleId)
    )

    // 2b. Reverse and void associated payments
    statements.push(
      this.db
        .prepare(
          `UPDATE payments
           SET status = 'voided', reversed_at = datetime('now'), reversal_reason = ?, voided_by_sale_id = ?
           WHERE business_id = ? AND receipt_number = ?`
        )
        .bind(reason || 'Sale void reversal', saleId, businessId, saleRow.receipt_number)
    )

    // Reverse any payment allocations to this sale and return amount to parent advance
    const allocationsRes = await this.db
      .prepare('SELECT payment_id, amount_minor FROM payment_allocations WHERE business_id = ? AND sale_id = ?')
      .bind(businessId, saleId)
      .all<{ payment_id: string; amount_minor: number }>()

    for (const alloc of allocationsRes.results || []) {
      statements.push(
        this.db
          .prepare(
            `UPDATE payments
             SET unallocated_amount_minor = unallocated_amount_minor + ?
             WHERE business_id = ? AND id = ?`
          )
          .bind(alloc.amount_minor, businessId, alloc.payment_id)
      )
    }

    statements.push(
      this.db
        .prepare('DELETE FROM payment_allocations WHERE business_id = ? AND sale_id = ?')
        .bind(businessId, saleId)
    )

    // 3. Restore inventory for tracked products (live SQL balance + tenant-scoped)
    const voidNowIso = new Date().toISOString()
    for (const item of items) {
      const prod = await this.db
        .prepare('SELECT track_inventory FROM products WHERE business_id = ? AND id = ?')
        .bind(businessId, item.product_id)
        .first<{ track_inventory: number }>()

      if (prod?.track_inventory) {
        const movId = `mov_${crypto.randomUUID()}`
        const movNumber = `MOV-${currentBusinessDateKey.replace(/-/g, '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`

        statements.push(
          this.db
            .prepare(
              `INSERT OR IGNORE INTO inventory_balances (
                id, business_id, branch_id, product_id, quantity_on_hand, updated_at
              ) VALUES (?, ?, ?, ?, 0.0, datetime('now'))`
            )
            .bind(`bal_${crypto.randomUUID()}`, businessId, saleRow.branch_id, item.product_id)
        )

        statements.push(
          this.db
            .prepare(
              `INSERT INTO stock_movements (
                id, business_id, branch_id, movement_number, product_id, type,
                quantity_change, previous_quantity, new_quantity, unit_cost_minor,
                reference_type, reference_id, reference_number, reason, notes,
                business_date_key, created_by, created_at
              ) VALUES (
                ?, ?, ?, ?, ?, 'adjustment_in',
                ?,
                COALESCE((SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?), 0.0),
                COALESCE((SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?), 0.0) + ?,
                ?, 'sale', ?, ?, 'sale_void', ?, ?, ?, datetime('now')
              )`
            )
            .bind(
              movId,
              businessId,
              saleRow.branch_id,
              movNumber,
              item.product_id,
              item.quantity,
              businessId,
              saleRow.branch_id,
              item.product_id,
              businessId,
              saleRow.branch_id,
              item.product_id,
              item.quantity,
              item.unit_cost_minor,
              saleId,
              saleRow.sale_number,
              reason || 'Voided sale stock restoration',
              currentBusinessDateKey,
              operatorId
            )
        )

        statements.push(
          this.db
            .prepare(
              `UPDATE inventory_balances
               SET quantity_on_hand = quantity_on_hand + ?, updated_at = datetime('now')
               WHERE business_id = ? AND branch_id = ? AND product_id = ?`
            )
            .bind(item.quantity, businessId, saleRow.branch_id, item.product_id)
        )

        statements.push(
          this.changeLogRepo.createLiveStockChangeEventStatement({
            businessId,
            branchId: saleRow.branch_id,
            productId: item.product_id,
            resourceId: `${saleRow.branch_id}:${item.product_id}`,
            resourceVersion: 0,
            unit: item.unit,
            updatedAt: voidNowIso,
            eventId: `${businessId}:stock:${saleRow.branch_id}:${item.product_id}:${movId}`,
          })
        )
      }
    }

    // 4. Contra ledger entries if account customer
    const customer = await this.db
      .prepare('SELECT is_walk_in, opening_balance_minor FROM customers WHERE id = ?')
      .bind(saleRow.customer_id)
      .first<{ is_walk_in: number; opening_balance_minor: number }>()

    if (customer && customer.is_walk_in === 0) {
      const lastEntry = await this.db
        .prepare(
          `SELECT balance_minor FROM customer_ledger_transactions
           WHERE business_id = ? AND customer_id = ?
           ORDER BY business_date_key DESC, created_at DESC, id DESC LIMIT 1`
        )
        .bind(businessId, saleRow.customer_id)
        .first<{ balance_minor: number }>()

      let currentBal = lastEntry?.balance_minor ?? customer.opening_balance_minor

      // Reverse invoice (credit)
      currentBal -= saleRow.total_amount_minor
      statements.push(
        this.db
          .prepare(
            `INSERT INTO customer_ledger_transactions (
              id, business_id, branch_id, customer_id, type, reference_id,
              reference_number, description, debit_minor, credit_minor,
              balance_minor, business_date_key, created_at
            ) VALUES (?, ?, ?, ?, 'void', ?, ?, ?, 0, ?, ?, ?, datetime('now'))`
          )
          .bind(
            `clt_${crypto.randomUUID()}`,
            businessId,
            saleRow.branch_id,
            saleRow.customer_id,
            saleId,
            saleRow.invoice_number,
            `Void Sales Invoice ${saleRow.invoice_number}`,
            saleRow.total_amount_minor,
            currentBal,
            currentBusinessDateKey
          )
      )

      // If payment was made at sale time, reverse payment (debit back)
      if (saleRow.amount_paid_minor > 0) {
        currentBal += saleRow.amount_paid_minor
        statements.push(
          this.db
            .prepare(
              `INSERT INTO customer_ledger_transactions (
                id, business_id, branch_id, customer_id, type, reference_id,
                reference_number, description, debit_minor, credit_minor,
                balance_minor, business_date_key, created_at
              ) VALUES (?, ?, ?, ?, 'void', ?, ?, ?, ?, 0, ?, ?, datetime('now'))`
            )
            .bind(
              `clt_${crypto.randomUUID()}`,
              businessId,
              saleRow.branch_id,
              saleRow.customer_id,
              saleId,
              saleRow.receipt_number,
              `Reversal of POS Payment for ${saleRow.invoice_number}`,
              saleRow.amount_paid_minor,
              currentBal,
              currentBusinessDateKey
            )
        )
      }
    }

    // 5. Audit log
    const auditId = `aud_${crypto.randomUUID()}`
    statements.push(
      this.db
        .prepare(
          `INSERT INTO audit_logs (id, business_id, branch_id, user_id, action, entity_type, entity_id, diff_json, created_at)
           VALUES (?, ?, ?, ?, 'VOID_SALE', 'sale', ?, ?, datetime('now'))`
        )
        .bind(
          auditId,
          businessId,
          saleRow.branch_id,
          operatorId,
          saleId,
          JSON.stringify({ previousStatus: saleRow.status, newStatus: 'voided', reason })
        )
    )

    await this.repo.executeAtomicBatch(statements)

    const updatedSale = await this.repo.getSaleById(businessId, saleId, [saleRow.branch_id])
    return updatedSale!
  }
}
