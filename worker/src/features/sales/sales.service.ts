import { HttpError } from '../../lib/errors'
import { getCurrentBusinessDateKey } from '../../lib/businessDate'
import {
  computeCanonicalRequestHash,
  checkIdempotency,
  buildIdempotencyInsertStatement,
} from '../../lib/idempotency'
import {
  validateQuantityByUnit,
  calculateLineSubtotalMinor,
  calculateDiscountMinor,
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
    idempotencyKey?: string | null
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
        // Auto-provision standard walk-in customer for this business
        const walkInId = `cust_walkin_${businessId}`
        await this.db
          .prepare(
            `INSERT INTO customers (id, business_id, customer_code, name, type, is_walk_in, status, created_at, updated_at)
             VALUES (?, ?, 'WALKIN', 'Walk-in Customer', 'individual', 1, 'active', datetime('now'), datetime('now'))`
          )
          .bind(walkInId, businessId)
          .run()

        walkIn = (await this.db
          .prepare('SELECT * FROM customers WHERE id = ?')
          .bind(walkInId)
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

    // 4. Fetch Business Settings (e.g. allow_negative_stock)
    const settings = await this.db
      .prepare('SELECT allow_negative_stock FROM business_settings WHERE business_id = ? LIMIT 1')
      .bind(businessId)
      .first<BusinessSettings>()
    const allowNegativeStock = settings?.allow_negative_stock !== 0 // Default allowed with warning unless explicitly 0

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

    // Compute Item Lines
    interface ProcessedItemLine {
      id: string
      product: ProductRecord
      quantity: number
      unitPriceMinor: number
      unitCostMinor: number
      subtotalMinor: number
      discountMinor: number
      taxMinor: number
      lineTotalMinor: number
      currentStock: number
      newStock: number
    }

    const processedLines: ProcessedItemLine[] = []
    let computedSubtotalMinor = 0
    let totalLineTaxMinor = 0

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
      const unitPriceMinor =
        itemInput.unitPriceMinor !== undefined
          ? itemInput.unitPriceMinor
          : product.selling_price_minor

      const subtotalMinor = calculateLineSubtotalMinor(validatedQty, unitPriceMinor)
      const discountMinor = itemInput.discountMinor ?? 0
      const taxMinor = itemInput.taxMinor ?? 0
      const lineTotalMinor = subtotalMinor - discountMinor + taxMinor

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
      totalLineTaxMinor += taxMinor

      processedLines.push({
        id: `si_${crypto.randomUUID()}`,
        product,
        quantity: validatedQty,
        unitPriceMinor,
        unitCostMinor: product.purchase_price_minor,
        subtotalMinor,
        discountMinor,
        taxMinor,
        lineTotalMinor,
        currentStock,
        newStock,
      })
    }

    // 6. Discount & Order Totals
    const discountType = input.discountType ?? 'fixed'
    const discountValue = input.discountValue ?? 0
    const orderDiscountMinor = calculateDiscountMinor(
      computedSubtotalMinor,
      discountType,
      discountValue
    )

    const totalAmountMinor = Math.max(0, computedSubtotalMinor - orderDiscountMinor + totalLineTaxMinor)

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
        orderDiscountMinor,
        totalLineTaxMinor,
        totalAmountMinor,
        amountPaidMinor,
        remainingBalanceMinor,
        changeReturnedMinor,
        businessDateKey,
        idempotencyKey ?? null
      )
    )

    // Statement B: Insert Sale Items
    const insertItemSql = `
      INSERT INTO sale_items (
        id, sale_id, product_id, sku, product_name, unit,
        unit_price_minor, unit_cost_minor, cogs_estimated, quantity,
        subtotal_minor, discount_minor, tax_minor, line_total_minor, returned_quantity
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 0.0)
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
          line.unitCostMinor,
          line.quantity,
          line.subtotalMinor,
          line.discountMinor,
          line.taxMinor,
          line.lineTotalMinor
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

    // Statement F: Inventory Movements and Balances Updates
    for (const line of processedLines) {
      if (!line.product.track_inventory) continue

      const movementId = `mov_${crypto.randomUUID()}`
      const movementNumber = `MOV-${businessDateKey.replace(/-/g, '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`

      const insertMovementSql = `
        INSERT INTO stock_movements (
          id, business_id, branch_id, movement_number, product_id, type,
          quantity_change, previous_quantity, new_quantity, unit_cost_minor,
          reference_type, reference_id, reference_number, business_date_key,
          created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, 'sale', ?, ?, ?, ?, 'sale', ?, ?, ?, ?, datetime('now'))
      `
      statements.push(
        this.db.prepare(insertMovementSql).bind(
          movementId,
          businessId,
          branchId,
          movementNumber,
          line.product.id,
          -line.quantity,
          line.currentStock,
          line.newStock,
          line.unitCostMinor,
          saleId,
          saleNumber,
          businessDateKey,
          cashierId
        )
      )

      // Upsert Inventory Balance
      const upsertBalanceSql = `
        INSERT INTO inventory_balances (
          id, business_id, branch_id, product_id, quantity_on_hand, updated_at
        ) VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(branch_id, product_id) DO UPDATE SET
          quantity_on_hand = quantity_on_hand - excluded.quantity_on_hand,
          updated_at = datetime('now')
      `
      statements.push(
        this.db.prepare(upsertBalanceSql).bind(
          `bal_${crypto.randomUUID()}`,
          businessId,
          branchId,
          line.product.id,
          line.quantity // subtracted via excluded.quantity_on_hand
        )
      )

      statements.push(
        this.changeLogRepo.createChangeEventStatement({
          businessId,
          branchId,
          resourceType: 'stock',
          resourceId: `${branchId}:${line.product.id}`,
          resourceVersion: 0,
          operation: 'upsert',
          payload: {
            productId: line.product.id,
            branchId,
            quantityOnHand: line.newStock,
            unit: line.product.unit,
            updatedAt: new Date().toISOString(),
          },
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
      discountMinor: orderDiscountMinor,
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
    await this.repo.executeAtomicBatch(statements)

    return createdSaleDTO
  }

  async voidSale(
    businessId: string,
    saleId: string,
    operatorId: string,
    operatorRole: string,
    reason?: string
  ): Promise<SaleDTO> {
    // RBAC: Only owner, admin, or manager can void a sale
    if (operatorRole !== 'owner' && operatorRole !== 'admin' && operatorRole !== 'manager') {
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

    if (saleRow.status === 'voided') {
      throw HttpError.badRequest('Sale has already been voided.')
    }

    if (saleRow.status !== 'completed') {
      throw HttpError.badRequest(`Cannot void sale with status '${saleRow.status}'.`)
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
        .prepare(`UPDATE invoices SET status = 'voided', updated_at = datetime('now') WHERE sale_id = ?`)
        .bind(saleId)
    )

    // 3. Restore inventory for tracked products
    for (const item of items) {
      const prod = await this.db
        .prepare('SELECT track_inventory FROM products WHERE id = ?')
        .bind(item.product_id)
        .first<{ track_inventory: number }>()

      if (prod?.track_inventory) {
        // Query current balance
        const bal = await this.db
          .prepare(
            'SELECT quantity_on_hand FROM inventory_balances WHERE branch_id = ? AND product_id = ?'
          )
          .bind(saleRow.branch_id, item.product_id)
          .first<{ quantity_on_hand: number }>()

        const currentQty = bal?.quantity_on_hand ?? 0
        const restoredQty = currentQty + item.quantity

        const movId = `mov_${crypto.randomUUID()}`
        const movNumber = `MOV-${currentBusinessDateKey.replace(/-/g, '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`

        statements.push(
          this.db
            .prepare(
              `INSERT INTO stock_movements (
                id, business_id, branch_id, movement_number, product_id, type,
                quantity_change, previous_quantity, new_quantity, unit_cost_minor,
                reference_type, reference_id, reference_number, reason, notes,
                business_date_key, created_by, created_at
              ) VALUES (?, ?, ?, ?, ?, 'adjustment_in', ?, ?, ?, ?, 'sale', ?, ?, 'sale_void', ?, ?, ?, datetime('now'))`
            )
            .bind(
              movId,
              businessId,
              saleRow.branch_id,
              movNumber,
              item.product_id,
              item.quantity,
              currentQty,
              restoredQty,
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
               WHERE branch_id = ? AND product_id = ?`
            )
            .bind(item.quantity, saleRow.branch_id, item.product_id)
        )

        statements.push(
          this.changeLogRepo.createChangeEventStatement({
            businessId,
            branchId: saleRow.branch_id,
            resourceType: 'stock',
            resourceId: `${saleRow.branch_id}:${item.product_id}`,
            resourceVersion: 0,
            operation: 'upsert',
            payload: {
              productId: item.product_id,
              branchId: saleRow.branch_id,
              quantityOnHand: restoredQty,
              unit: item.unit,
              updatedAt: new Date().toISOString(),
            },
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
