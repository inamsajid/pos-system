import { HttpError } from '../../lib/errors'
import {
  computeCanonicalRequestHash,
  checkIdempotency,
  buildIdempotencyInsertStatement,
} from '../../lib/idempotency'
import { SupplierPaymentsRepository } from './supplierPayments.repository'
import type {
  CreateSupplierPaymentInput,
  AllocateSupplierAdvanceInput,
  SupplierPaymentDTO,
  SupplierPaymentFilterParams,
  SupplierPaymentAllocationDTO,
} from './supplierPayments.types'
import type { SupplierSnapshot } from '../purchases/purchases.types'

interface SupplierRow {
  id: string
  supplier_code: string
  name: string
  company_name: string | null
  contact_person: string | null
  phone: string | null
  email: string | null
  tax_number: string | null
  opening_payable_minor: number
  status: string
}

interface PurchaseCheckRow {
  id: string
  business_id: string
  branch_id: string
  supplier_id: string
  purchase_number: string
  status: string
  total_amount_minor: number
  paid_amount_minor: number
}

export class SupplierPaymentsService {
  private readonly db: D1Database
  private readonly repo: SupplierPaymentsRepository

  constructor(db: D1Database, repo?: SupplierPaymentsRepository) {
    this.db = db
    this.repo = repo ?? new SupplierPaymentsRepository(db)
  }

  async listPayments(
    businessId: string,
    filters: SupplierPaymentFilterParams,
    authorizedBranchIds: string[]
  ): Promise<{ payments: SupplierPaymentDTO[]; total: number; page: number; limit: number }> {
    const result = await this.repo.listPayments(businessId, filters, authorizedBranchIds)
    return {
      payments: result.payments,
      total: result.total,
      page: filters.page,
      limit: filters.limit,
    }
  }

  async getPaymentById(
    businessId: string,
    paymentId: string,
    authorizedBranchIds: string[]
  ): Promise<SupplierPaymentDTO> {
    const payment = await this.repo.getPaymentById(businessId, paymentId, authorizedBranchIds)
    if (!payment) {
      throw HttpError.notFound('Supplier payment not found.')
    }
    return payment
  }

  async createPayment(
    businessId: string,
    currentBranchId: string | null,
    userId: string,
    input: CreateSupplierPaymentInput,
    idempotencyKey?: string | null
  ): Promise<SupplierPaymentDTO> {
    const branchId = input.branchId || currentBranchId
    if (!branchId) {
      throw HttpError.badRequest('Branch context or branchId is required.', { field: 'branchId' })
    }

    // 1. Idempotency Check
    let requestHash: string | undefined
    if (idempotencyKey) {
      requestHash = await computeCanonicalRequestHash(input)
      const cached = await checkIdempotency(
        this.db,
        businessId,
        'supplier_payment',
        idempotencyKey,
        requestHash
      )
      if (cached) {
        return cached.body as SupplierPaymentDTO
      }
    }

    // 2. Fetch and Validate Supplier
    const supplier = await this.db
      .prepare(
        'SELECT id, supplier_code, name, company_name, contact_person, phone, email, tax_number, opening_payable_minor, status FROM suppliers WHERE business_id = ? AND id = ? LIMIT 1'
      )
      .bind(businessId, input.supplierId)
      .first<SupplierRow>()

    if (!supplier) {
      throw HttpError.notFound('Supplier not found.')
    }

    if (supplier.status === 'archived' || supplier.status === 'inactive') {
      throw HttpError.badRequest('Cannot disburse payment to an archived or inactive supplier.', {
        field: 'supplierId',
      })
    }

    // 3. Validate Allocations (if provided)
    let totalAllocated = 0
    interface ValidatedAllocation {
      purchase: PurchaseCheckRow
      amountMinor: number
    }
    const validatedAllocations: ValidatedAllocation[] = []

    if (input.allocations && input.allocations.length > 0) {
      for (const alloc of input.allocations) {
        const purchase = await this.db
          .prepare(
            'SELECT id, business_id, branch_id, supplier_id, purchase_number, status, total_amount_minor, paid_amount_minor FROM purchases WHERE business_id = ? AND id = ? LIMIT 1'
          )
          .bind(businessId, alloc.purchaseId)
          .first<PurchaseCheckRow>()

        if (!purchase) {
          throw HttpError.notFound(`Purchase ${alloc.purchaseId} not found.`)
        }

        if (purchase.supplier_id !== supplier.id) {
          throw HttpError.badRequest(
            `Purchase ${purchase.purchase_number} does not belong to supplier ${supplier.name}.`,
            { field: 'allocations' }
          )
        }

        if (purchase.status === 'draft' || purchase.status === 'cancelled') {
          throw HttpError.badRequest(
            `Cannot allocate payment to a purchase with status '${purchase.status}'.`,
            { field: 'allocations' }
          )
        }

        const remainingUnpaid = purchase.total_amount_minor - purchase.paid_amount_minor
        if (alloc.amountMinor > remainingUnpaid) {
          throw HttpError.badRequest(
            `Allocation amount (${alloc.amountMinor}) exceeds remaining unpaid balance (${remainingUnpaid}) on purchase ${purchase.purchase_number}.`,
            { field: 'allocations' }
          )
        }

        totalAllocated += alloc.amountMinor
        validatedAllocations.push({
          purchase,
          amountMinor: alloc.amountMinor,
        })
      }

      if (totalAllocated > input.amountMinor) {
        throw HttpError.badRequest(
          `Total allocated amount (${totalAllocated}) cannot exceed payment amount (${input.amountMinor}).`,
          { field: 'allocations' }
        )
      }
    }

    const unallocatedAmount = input.amountMinor - totalAllocated
    const paymentId = `spay_${crypto.randomUUID()}`
    const businessDateKey = new Date().toISOString().slice(0, 10)
    const receiptNumber = `SPAY-${businessDateKey.replace(/-/g, '')}-${crypto.randomUUID().substring(0, 6).toUpperCase()}`

    const supplierSnapshot: SupplierSnapshot = {
      id: supplier.id,
      supplierCode: supplier.supplier_code,
      name: supplier.name,
      companyName: supplier.company_name,
      phone: supplier.phone,
      email: supplier.email,
      taxNumber: supplier.tax_number,
    }

    // 4. Calculate Supplier Ledger Balance (Running balance)
    const lastLedger = await this.db
      .prepare(
        `SELECT balance_minor FROM supplier_ledger_transactions
         WHERE business_id = ? AND supplier_id = ?
         ORDER BY rowid DESC
         LIMIT 1`
      )
      .bind(businessId, supplier.id)
      .first<{ balance_minor: number }>()

    let currentSupplierBal = 0
    if (lastLedger) {
      currentSupplierBal = lastLedger.balance_minor
    } else {
      currentSupplierBal = supplier.opening_payable_minor ?? 0
    }

    // Debit reduces payable owed
    const newSupplierBal = currentSupplierBal - input.amountMinor

    const statements: D1PreparedStatement[] = []

    // 5. Insert into supplier_payments
    statements.push(
      this.db
        .prepare(
          `INSERT INTO supplier_payments (
            id, business_id, branch_id, receipt_number, supplier_id,
            supplier_snapshot_json, amount_minor, unallocated_amount_minor,
            method, reference, notes, business_date_key, paid_by,
            paid_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
        )
        .bind(
          paymentId,
          businessId,
          branchId,
          receiptNumber,
          supplier.id,
          JSON.stringify(supplierSnapshot),
          input.amountMinor,
          unallocatedAmount,
          input.method,
          input.reference || null,
          input.notes || null,
          businessDateKey,
          userId
        )
    )

    // 6. Insert Allocations & Update Purchases
    const allocationDTOs: SupplierPaymentAllocationDTO[] = []
    for (const alloc of validatedAllocations) {
      const allocId = `spa_${crypto.randomUUID()}`
      statements.push(
        this.db
          .prepare(
          `INSERT INTO supplier_payment_allocations (
            id, business_id, payment_id, purchase_id, purchase_number,
            amount_minor, allocated_at
          ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
          )
          .bind(
            allocId,
            businessId,
            paymentId,
            alloc.purchase.id,
            alloc.purchase.purchase_number,
            alloc.amountMinor
          )
      )

      statements.push(
        this.db
          .prepare(
            `UPDATE purchases
             SET paid_amount_minor = paid_amount_minor + ?, updated_at = datetime('now')
             WHERE id = ?`
          )
          .bind(alloc.amountMinor, alloc.purchase.id)
      )

      allocationDTOs.push({
        id: allocId,
        paymentId,
        purchaseId: alloc.purchase.id,
        purchaseNumber: alloc.purchase.purchase_number,
        amountMinor: alloc.amountMinor,
        allocatedAt: new Date().toISOString(),
      })
    }

    // 7. Post Supplier Ledger Transaction (Debit - decreases liability)
    const sltId = `slt_${crypto.randomUUID()}`
    statements.push(
      this.db
        .prepare(
          `INSERT INTO supplier_ledger_transactions (
            id, business_id, branch_id, supplier_id, type, reference_id,
            reference_number, description, debit_minor, credit_minor,
            balance_minor, business_date_key, created_at
          ) VALUES (?, ?, ?, ?, 'payment', ?, ?, ?, ?, 0, ?, ?, datetime('now'))`
        )
        .bind(
          sltId,
          businessId,
          branchId,
          supplier.id,
          paymentId,
          receiptNumber,
          `Supplier payment (${receiptNumber})`,
          input.amountMinor,
          newSupplierBal,
          businessDateKey
        )
    )

    // 8. Audit Log
    const auditId = `aud_${crypto.randomUUID()}`
    statements.push(
      this.db
        .prepare(
          `INSERT INTO audit_logs (
            id, business_id, branch_id, user_id, action, entity_type,
            entity_id, diff_json, created_at
          ) VALUES (?, ?, ?, ?, 'SUPPLIER_PAYMENT', 'supplier_payment', ?, ?, datetime('now'))`
        )
        .bind(
          auditId,
          businessId,
          branchId,
          userId,
          paymentId,
          JSON.stringify({
            receiptNumber,
            supplierId: supplier.id,
            amountMinor: input.amountMinor,
            unallocatedAmountMinor: unallocatedAmount,
            method: input.method,
            allocatedPurchases: validatedAllocations.map((a) => a.purchase.purchase_number),
          })
        )
    )

    const resultDTO: SupplierPaymentDTO = {
      id: paymentId,
      businessId,
      branchId,
      receiptNumber,
      supplierId: supplier.id,
      supplierName: supplier.name,
      supplierSnapshot,
      amountMinor: input.amountMinor,
      unallocatedAmountMinor: unallocatedAmount,
      method: input.method,
      reference: input.reference || null,
      notes: input.notes || null,
      businessDateKey,
      paidBy: userId,
      paidAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      allocations: allocationDTOs,
    }

    // 9. Idempotency Insert Statement
    if (idempotencyKey && requestHash) {
      statements.push(
        buildIdempotencyInsertStatement(
          this.db,
          businessId,
          'supplier_payment',
          idempotencyKey,
          requestHash,
          201,
          resultDTO
        )
      )
    }

    // 10. Atomic Batch Execution
    await this.repo.executeAtomicBatch(statements)

    return resultDTO
  }

  async allocateAdvance(
    businessId: string,
    paymentId: string,
    operatorId: string,
    input: AllocateSupplierAdvanceInput,
    idempotencyKey?: string | null
  ): Promise<SupplierPaymentDTO> {
    const payment = await this.db
      .prepare('SELECT * FROM supplier_payments WHERE business_id = ? AND id = ? LIMIT 1')
      .bind(businessId, paymentId)
      .first<{
        id: string
        business_id: string
        branch_id: string
        supplier_id: string
        receipt_number: string
        unallocated_amount_minor: number
        amount_minor: number
      }>()

    if (!payment) {
      throw HttpError.notFound('Supplier payment not found.')
    }

    if (payment.unallocated_amount_minor <= 0) {
      throw HttpError.badRequest('This payment has no unallocated advance balance available.')
    }

    // 1. Idempotency Check
    let requestHash: string | undefined
    if (idempotencyKey) {
      requestHash = await computeCanonicalRequestHash(input)
      const cached = await checkIdempotency(
        this.db,
        businessId,
        'supplier_payment_advance',
        idempotencyKey,
        requestHash
      )
      if (cached) {
        return cached.body as SupplierPaymentDTO
      }
    }

    let totalAlloc = 0
    interface ValidatedAdvanceAlloc {
      purchase: PurchaseCheckRow
      amountMinor: number
    }
    const validatedAllocations: ValidatedAdvanceAlloc[] = []

    for (const alloc of input.allocations) {
      const purchase = await this.db
        .prepare(
          'SELECT id, business_id, branch_id, supplier_id, purchase_number, status, total_amount_minor, paid_amount_minor FROM purchases WHERE business_id = ? AND id = ? LIMIT 1'
        )
        .bind(businessId, alloc.purchaseId)
        .first<PurchaseCheckRow>()

      if (!purchase) {
        throw HttpError.notFound(`Purchase ${alloc.purchaseId} not found.`)
      }

      if (purchase.supplier_id !== payment.supplier_id) {
        throw HttpError.badRequest(
          `Purchase ${purchase.purchase_number} belongs to a different supplier.`,
          { field: 'allocations' }
        )
      }

      if (purchase.status === 'draft' || purchase.status === 'cancelled') {
        throw HttpError.badRequest(
          `Cannot allocate advance to a purchase with status '${purchase.status}'.`,
          { field: 'allocations' }
        )
      }

      const remainingUnpaid = purchase.total_amount_minor - purchase.paid_amount_minor
      if (alloc.amountMinor > remainingUnpaid) {
        throw HttpError.badRequest(
          `Allocation amount (${alloc.amountMinor}) exceeds remaining unpaid balance (${remainingUnpaid}) on purchase ${purchase.purchase_number}.`,
          { field: 'allocations' }
        )
      }

      totalAlloc += alloc.amountMinor
      validatedAllocations.push({
        purchase,
        amountMinor: alloc.amountMinor,
      })
    }

    if (totalAlloc > payment.unallocated_amount_minor) {
      throw HttpError.badRequest(
        `Total allocation (${totalAlloc}) exceeds available unallocated amount (${payment.unallocated_amount_minor}).`,
        { field: 'allocations' }
      )
    }

    const statements: D1PreparedStatement[] = []

    // Deduct unallocated amount on payment
    statements.push(
      this.db
        .prepare(
          `UPDATE supplier_payments
           SET unallocated_amount_minor = unallocated_amount_minor - ?
           WHERE id = ?`
        )
        .bind(totalAlloc, paymentId)
    )

    // Insert allocations and update purchases
    for (const alloc of validatedAllocations) {
      const allocId = `spa_${crypto.randomUUID()}`
      statements.push(
        this.db
          .prepare(
            `INSERT INTO supplier_payment_allocations (
              id, business_id, payment_id, purchase_id, purchase_number,
              amount_minor, allocated_at
            ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
          )
          .bind(
            allocId,
            businessId,
            paymentId,
            alloc.purchase.id,
            alloc.purchase.purchase_number,
            alloc.amountMinor
          )
      )

      statements.push(
        this.db
          .prepare(
            `UPDATE purchases
             SET paid_amount_minor = paid_amount_minor + ?, updated_at = datetime('now')
             WHERE id = ?`
          )
          .bind(alloc.amountMinor, alloc.purchase.id)
      )
    }

    // Audit Log
    const auditId = `aud_${crypto.randomUUID()}`
    statements.push(
      this.db
        .prepare(
          `INSERT INTO audit_logs (
            id, business_id, branch_id, user_id, action, entity_type,
            entity_id, diff_json, created_at
          ) VALUES (?, ?, ?, ?, 'ALLOCATE_SUPPLIER_ADVANCE', 'supplier_payment', ?, ?, datetime('now'))`
        )
        .bind(
          auditId,
          businessId,
          payment.branch_id,
          operatorId,
          paymentId,
          JSON.stringify({
            allocatedAmountMinor: totalAlloc,
            remainingUnallocatedMinor: payment.unallocated_amount_minor - totalAlloc,
            purchases: validatedAllocations.map((a) => a.purchase.purchase_number),
          })
        )
    )

    // Retrieve updated payment
    const updated = await this.repo.getPaymentById(businessId, paymentId, [payment.branch_id])
    if (!updated) {
      throw HttpError.internal('Failed to retrieve updated payment.')
    }

    if (idempotencyKey && requestHash) {
      statements.push(
        buildIdempotencyInsertStatement(
          this.db,
          businessId,
          'supplier_payment_advance',
          idempotencyKey,
          requestHash,
          200,
          updated
        )
      )
    }

    await this.repo.executeAtomicBatch(statements)

    return (await this.repo.getPaymentById(businessId, paymentId, [payment.branch_id])) || updated
  }
}
