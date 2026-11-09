import { HttpError } from '../../lib/errors'
import { getCurrentBusinessDateKey } from '../../lib/businessDate'
import {
  computeCanonicalRequestHash,
  checkIdempotency,
  buildIdempotencyInsertStatement,
} from '../../lib/idempotency'
import { CustomerPaymentsRepository } from './customerPayments.repository'
import type {
  CreateCustomerPaymentInput,
  AllocateAdvanceInput,
  CustomerPaymentDTO,
  CustomerPaymentFilterParams,
  CustomerPaymentListResult,
  PaymentAllocationDTO,
} from './customerPayments.types'
import type { CustomerSnapshot } from '../sales/sales.types'

interface CustomerRow {
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

interface InvoiceCheckRow {
  id: string
  sale_id: string
  invoice_number: string
  customer_id: string
  total_amount_minor: number
  paid_amount_minor: number
  remaining_amount_minor: number
  payment_status: string
  status: string
}

export class CustomerPaymentsService {
  private readonly repo: CustomerPaymentsRepository
  private readonly db: D1Database

  constructor(db: D1Database) {
    this.repo = new CustomerPaymentsRepository(db)
    this.db = db
  }

  async listPayments(
    businessId: string,
    filters: CustomerPaymentFilterParams,
    authorizedBranchIds: string[]
  ): Promise<CustomerPaymentListResult> {
    const totalCount = await this.repo.countPayments(businessId, filters, authorizedBranchIds)
    const items = await this.repo.listPayments(businessId, filters, authorizedBranchIds)
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

  async getPaymentById(
    businessId: string,
    paymentId: string,
    authorizedBranchIds: string[]
  ): Promise<CustomerPaymentDTO> {
    const payment = await this.repo.getPaymentById(businessId, paymentId, authorizedBranchIds)
    if (!payment) {
      throw HttpError.notFound('Payment not found.')
    }
    return payment
  }

  async getPaymentAllocations(
    businessId: string,
    paymentId: string,
    authorizedBranchIds: string[]
  ): Promise<PaymentAllocationDTO[]> {
    // Assert payment exists and is accessible
    await this.getPaymentById(businessId, paymentId, authorizedBranchIds)
    return this.repo.getAllocationsByPaymentId(businessId, paymentId)
  }

  async createPayment(
    businessId: string,
    branchId: string,
    receivedById: string,
    input: CreateCustomerPaymentInput,
    idempotencyKey?: string | null
  ): Promise<CustomerPaymentDTO> {
    // 1. Idempotency Check
    let requestHash = ''
    if (idempotencyKey) {
      requestHash = await computeCanonicalRequestHash(input)
      const cached = await checkIdempotency(
        this.db,
        businessId,
        'customer_payment',
        idempotencyKey,
        requestHash
      )
      if (cached) {
        return cached.body as CustomerPaymentDTO
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

    // 3. Resolve Customer
    const customer = await this.db
      .prepare('SELECT * FROM customers WHERE business_id = ? AND id = ? LIMIT 1')
      .bind(businessId, input.customerId)
      .first<CustomerRow>()

    if (!customer || customer.status === 'archived') {
      throw HttpError.badRequest('Customer does not exist or is archived.', { field: 'customerId' })
    }

    // Walk-in customer cannot have unallocated advances
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

    // 4. Validate Allocations
    let totalAllocatedMinor = 0
    interface ValidatedAlloc {
      invoice: InvoiceCheckRow
      amountMinor: number
    }
    const validatedAllocations: ValidatedAlloc[] = []

    if (input.allocations && input.allocations.length > 0) {
      for (let i = 0; i < input.allocations.length; i++) {
        const item = input.allocations[i]
        const inv = await this.db
          .prepare(
            `SELECT id, sale_id, invoice_number, customer_id, total_amount_minor,
                    paid_amount_minor, remaining_amount_minor, payment_status, status
             FROM invoices
             WHERE business_id = ? AND id = ? LIMIT 1`
          )
          .bind(businessId, item.invoiceId)
          .first<InvoiceCheckRow>()

        if (!inv) {
          throw HttpError.badRequest(`Invoice '${item.invoiceId}' does not exist.`, {
            field: `allocations[${i}].invoiceId`,
          })
        }

        if (inv.customer_id !== customer.id) {
          throw HttpError.badRequest(
            `Invoice '${inv.invoice_number}' does not belong to customer '${customer.name}'.`,
            { field: `allocations[${i}].invoiceId` }
          )
        }

        if (inv.status === 'voided') {
          throw HttpError.badRequest(
            `Cannot allocate payment to voided invoice '${inv.invoice_number}'.`,
            { field: `allocations[${i}].invoiceId` }
          )
        }

        if (inv.remaining_amount_minor <= 0) {
          throw HttpError.badRequest(
            `Invoice '${inv.invoice_number}' is already fully paid.`,
            { field: `allocations[${i}].invoiceId` }
          )
        }

        if (item.amountMinor > inv.remaining_amount_minor) {
          throw HttpError.badRequest(
            `Allocation amount (${item.amountMinor}) exceeds remaining balance (${inv.remaining_amount_minor}) of invoice '${inv.invoice_number}'.`,
            { field: `allocations[${i}].amountMinor` }
          )
        }

        totalAllocatedMinor += item.amountMinor
        validatedAllocations.push({
          invoice: inv,
          amountMinor: item.amountMinor,
        })
      }
    }

    if (totalAllocatedMinor > input.amountMinor) {
      throw HttpError.badRequest(
        `Total allocated amount (${totalAllocatedMinor}) cannot exceed total payment amount (${input.amountMinor}).`,
        { field: 'allocations' }
      )
    }

    const unallocatedAmountMinor = input.amountMinor - totalAllocatedMinor

    if (customer.is_walk_in && unallocatedAmountMinor > 0) {
      throw HttpError.badRequest(
        'Walk-in customers cannot carry unallocated advance credit balance.',
        { field: 'amountMinor' }
      )
    }

    // 5. Customer Ledger running balance
    const lastLedger = await this.db
      .prepare(
        `SELECT balance_minor FROM customer_ledger_transactions
         WHERE business_id = ? AND customer_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`
      )
      .bind(businessId, customer.id)
      .first<{ balance_minor: number }>()

    const currentBal = lastLedger !== null ? lastLedger.balance_minor : (customer.opening_balance_minor || 0)
    const newBal = currentBal - input.amountMinor // Payment is credit, decreases customer balance

    // 6. Generate IDs
    const businessDateKey = getCurrentBusinessDateKey()
    const paymentId = `pay_${crypto.randomUUID()}`
    const receiptNumber = `RCP-${businessDateKey.replace(/-/g, '')}-${crypto.randomUUID().substring(0, 6).toUpperCase()}`

    const statements: D1PreparedStatement[] = []

    // Insert payment record
    statements.push(
      this.db
        .prepare(
          `INSERT INTO payments (
            id, business_id, branch_id, receipt_number, customer_id, customer_snapshot_json,
            amount_minor, unallocated_amount_minor, source, notes, business_date_key,
            received_by, received_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, datetime('now'), datetime('now'))`
        )
        .bind(
          paymentId,
          businessId,
          branchId,
          receiptNumber,
          customer.id,
          JSON.stringify(customerSnapshot),
          input.amountMinor,
          unallocatedAmountMinor,
          input.notes || null,
          businessDateKey,
          receivedById
        )
    )

    // Insert payment methods
    for (const pm of input.paymentMethods) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO payment_methods (id, payment_id, method, amount_minor, reference)
             VALUES (?, ?, ?, ?, ?)`
          )
          .bind(
            `pm_${crypto.randomUUID()}`,
            paymentId,
            pm.method,
            pm.amountMinor,
            pm.reference || null
          )
      )
    }

    // Insert allocations and update invoices & sales
    for (const alloc of validatedAllocations) {
      const allocId = `pa_${crypto.randomUUID()}`
      statements.push(
        this.db
          .prepare(
            `INSERT INTO payment_allocations (id, business_id, payment_id, sale_id, invoice_number, amount_minor, allocated_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
          )
          .bind(
            allocId,
            businessId,
            paymentId,
            alloc.invoice.sale_id,
            alloc.invoice.invoice_number,
            alloc.amountMinor
          )
      )

      const newPaid = alloc.invoice.paid_amount_minor + alloc.amountMinor
      const newRemaining = alloc.invoice.remaining_amount_minor - alloc.amountMinor
      const newStatus = newRemaining === 0 ? 'paid' : 'partial'

      statements.push(
        this.db
          .prepare(
            `UPDATE invoices
             SET paid_amount_minor = ?, remaining_amount_minor = ?, payment_status = ?, updated_at = datetime('now')
             WHERE id = ?`
          )
          .bind(newPaid, newRemaining, newStatus, alloc.invoice.id)
      )

      statements.push(
        this.db
          .prepare(
            `UPDATE sales
             SET amount_paid_minor = amount_paid_minor + ?,
                 remaining_balance_minor = MAX(0, total_amount_minor - (amount_paid_minor + ?)),
                 updated_at = datetime('now')
             WHERE id = ?`
          )
          .bind(alloc.amountMinor, alloc.amountMinor, alloc.invoice.sale_id)
      )
    }

    // Insert Customer Ledger Transaction
    const cltId = `clt_${crypto.randomUUID()}`
    const desc =
      validatedAllocations.length > 0
        ? `Payment received (Receipt ${receiptNumber}) for Invoice ${validatedAllocations.map((a) => a.invoice.invoice_number).join(', ')}`
        : `Payment received on account (Receipt ${receiptNumber})`

    statements.push(
      this.db
        .prepare(
          `INSERT INTO customer_ledger_transactions (
            id, business_id, branch_id, customer_id, type, reference_id,
            reference_number, description, debit_minor, credit_minor,
            balance_minor, business_date_key, created_at
          ) VALUES (?, ?, ?, ?, 'payment', ?, ?, ?, 0, ?, ?, ?, datetime('now'))`
        )
        .bind(
          cltId,
          businessId,
          branchId,
          customer.id,
          paymentId,
          receiptNumber,
          desc,
          input.amountMinor,
          newBal,
          businessDateKey
        )
    )

    // Audit log
    statements.push(
      this.db
        .prepare(
          `INSERT INTO audit_logs (id, business_id, branch_id, user_id, action, entity_type, entity_id, diff_json, created_at)
           VALUES (?, ?, ?, ?, 'CUSTOMER_PAYMENT', 'payment', ?, ?, datetime('now'))`
        )
        .bind(
          `aud_${crypto.randomUUID()}`,
          businessId,
          branchId,
          receivedById,
          paymentId,
          JSON.stringify({
            amountMinor: input.amountMinor,
            receiptNumber,
            allocationsCount: validatedAllocations.length,
            unallocatedAmountMinor,
          })
        )
    )

    // Construct response DTO
    const paymentDTO: CustomerPaymentDTO = {
      id: paymentId,
      businessId,
      branchId,
      receiptNumber,
      customerId: customer.id,
      customerName: customer.name,
      customerSnapshot,
      amountMinor: input.amountMinor,
      unallocatedAmountMinor,
      source: 'manual',
      notes: input.notes || null,
      businessDateKey,
      receivedBy: receivedById,
      receivedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      paymentMethods: input.paymentMethods,
      allocations: validatedAllocations.map((a) => ({
        id: `pa_${a.invoice.id}`,
        paymentId,
        saleId: a.invoice.sale_id,
        invoiceNumber: a.invoice.invoice_number,
        amountMinor: a.amountMinor,
        allocatedAt: new Date().toISOString(),
      })),
    }

    // Idempotency insert
    if (idempotencyKey) {
      statements.push(
        buildIdempotencyInsertStatement(
          this.db,
          businessId,
          'customer_payment',
          idempotencyKey,
          requestHash,
          201,
          paymentDTO
        )
      )
    }

    // Atomic execution
    await this.repo.executeAtomicBatch(statements)

    return paymentDTO
  }

  async allocateAdvance(
    businessId: string,
    paymentId: string,
    operatorId: string,
    input: AllocateAdvanceInput
  ): Promise<CustomerPaymentDTO> {
    const payment = await this.db
      .prepare('SELECT * FROM payments WHERE business_id = ? AND id = ? LIMIT 1')
      .bind(businessId, paymentId)
      .first<{
        id: string
        business_id: string
        branch_id: string
        customer_id: string
        receipt_number: string
        unallocated_amount_minor: number
        amount_minor: number
      }>()

    if (!payment) {
      throw HttpError.notFound('Payment not found.')
    }

    if (payment.unallocated_amount_minor <= 0) {
      throw HttpError.badRequest('This payment has no unallocated advance balance available.')
    }

    let totalAlloc = 0
    interface ValidatedAdvanceAlloc {
      invoice: InvoiceCheckRow
      amountMinor: number
    }
    const validatedAllocations: ValidatedAdvanceAlloc[] = []

    for (let i = 0; i < input.allocations.length; i++) {
      const item = input.allocations[i]
      const inv = await this.db
        .prepare(
          `SELECT id, sale_id, invoice_number, customer_id, total_amount_minor,
                  paid_amount_minor, remaining_amount_minor, payment_status, status
           FROM invoices
           WHERE business_id = ? AND id = ? LIMIT 1`
        )
        .bind(businessId, item.invoiceId)
        .first<InvoiceCheckRow>()

      if (!inv) {
        throw HttpError.badRequest(`Invoice '${item.invoiceId}' does not exist.`, {
          field: `allocations[${i}].invoiceId`,
        })
      }

      if (inv.customer_id !== payment.customer_id) {
        throw HttpError.badRequest(
          `Invoice '${inv.invoice_number}' belongs to a different customer.`,
          { field: `allocations[${i}].invoiceId` }
        )
      }

      if (inv.status === 'voided') {
        throw HttpError.badRequest(
          `Cannot allocate advance to voided invoice '${inv.invoice_number}'.`,
          { field: `allocations[${i}].invoiceId` }
        )
      }

      if (inv.remaining_amount_minor <= 0) {
        throw HttpError.badRequest(
          `Invoice '${inv.invoice_number}' is already fully paid.`,
          { field: `allocations[${i}].invoiceId` }
        )
      }

      if (item.amountMinor > inv.remaining_amount_minor) {
        throw HttpError.badRequest(
          `Allocation amount (${item.amountMinor}) exceeds remaining balance (${inv.remaining_amount_minor}) of invoice '${inv.invoice_number}'.`,
          { field: `allocations[${i}].amountMinor` }
        )
      }

      totalAlloc += item.amountMinor
      validatedAllocations.push({
        invoice: inv,
        amountMinor: item.amountMinor,
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
          `UPDATE payments
           SET unallocated_amount_minor = unallocated_amount_minor - ?
           WHERE id = ?`
        )
        .bind(totalAlloc, paymentId)
    )

    // Insert allocations and update invoices/sales
    for (const alloc of validatedAllocations) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO payment_allocations (id, business_id, payment_id, sale_id, invoice_number, amount_minor, allocated_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
          )
          .bind(
            `pa_${crypto.randomUUID()}`,
            businessId,
            paymentId,
            alloc.invoice.sale_id,
            alloc.invoice.invoice_number,
            alloc.amountMinor
          )
      )

      const newPaid = alloc.invoice.paid_amount_minor + alloc.amountMinor
      const newRemaining = alloc.invoice.remaining_amount_minor - alloc.amountMinor
      const newStatus = newRemaining === 0 ? 'paid' : 'partial'

      statements.push(
        this.db
          .prepare(
            `UPDATE invoices
             SET paid_amount_minor = ?, remaining_amount_minor = ?, payment_status = ?, updated_at = datetime('now')
             WHERE id = ?`
          )
          .bind(newPaid, newRemaining, newStatus, alloc.invoice.id)
      )

      statements.push(
        this.db
          .prepare(
            `UPDATE sales
             SET amount_paid_minor = amount_paid_minor + ?,
                 remaining_balance_minor = MAX(0, total_amount_minor - (amount_paid_minor + ?)),
                 updated_at = datetime('now')
             WHERE id = ?`
          )
          .bind(alloc.amountMinor, alloc.amountMinor, alloc.invoice.sale_id)
      )
    }

    // Audit log
    statements.push(
      this.db
        .prepare(
          `INSERT INTO audit_logs (id, business_id, branch_id, user_id, action, entity_type, entity_id, diff_json, created_at)
           VALUES (?, ?, ?, ?, 'ALLOCATE_ADVANCE', 'payment', ?, ?, datetime('now'))`
        )
        .bind(
          `aud_${crypto.randomUUID()}`,
          businessId,
          payment.branch_id,
          operatorId,
          paymentId,
          JSON.stringify({
            allocatedAmountMinor: totalAlloc,
            remainingUnallocatedMinor: payment.unallocated_amount_minor - totalAlloc,
            invoices: validatedAllocations.map((a) => a.invoice.invoice_number),
          })
        )
    )

    await this.repo.executeAtomicBatch(statements)

    const updated = await this.repo.getPaymentById(businessId, paymentId, [payment.branch_id])
    return updated!
  }
}
