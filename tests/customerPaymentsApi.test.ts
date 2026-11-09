import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import worker from '../worker/src/index'
import type { Env } from '../worker/src/types/environment'
import { createSession } from '../worker/src/auth/sessionService'

function createRealD1(sqlite: DatabaseSync): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T = Record<string, unknown>>() {
              const stmt = sqlite.prepare(query)
              const row = stmt.get(...args)
              return (row as T) || null
            },
            async all<T = Record<string, unknown>>() {
              const stmt = sqlite.prepare(query)
              const results = stmt.all(...args) as T[]
              return { results, success: true, meta: {} }
            },
            async run() {
              const stmt = sqlite.prepare(query)
              const info = stmt.run(...args)
              return { success: true, meta: { changes: info.changes } }
            },
            async raw() {
              const stmt = sqlite.prepare(query)
              return stmt.all(...args) as unknown[]
            },
          } as unknown as D1PreparedStatement
        },
        async first<T = Record<string, unknown>>() {
          const stmt = sqlite.prepare(query)
          const row = stmt.get()
          return (row as T) || null
        },
        async all<T = Record<string, unknown>>() {
          const stmt = sqlite.prepare(query)
          const results = stmt.all() as T[]
          return { results, success: true, meta: {} }
        },
        async run() {
          const stmt = sqlite.prepare(query)
          const info = stmt.run()
          return { success: true, meta: { changes: info.changes } }
        },
      } as unknown as D1PreparedStatement
    },
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      sqlite.exec('BEGIN TRANSACTION;')
      try {
        const results = []
        for (const s of statements) {
          results.push(await s.run())
        }
        sqlite.exec('COMMIT;')
        return results
      } catch (e) {
        sqlite.exec('ROLLBACK;')
        throw e
      }
    },
    async exec(query: string) {
      sqlite.exec(query)
      return { count: 1, duration: 0 }
    },
  } as unknown as D1Database
}

const executionCtx: ExecutionContext = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
}

describe('Customer Payments API (/api/v1/customer-payments)', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const businessId = 'biz_pay_test'
  const branchId = 'branch_pay_main'
  const cashierUserId = 'usr_cashier_pay'
  let cashierToken: string

  const custId = 'cust_pay_1'
  const prodId = 'prod_pay_1'
  let unpaidInvoiceId: string
  let unpaidSaleId: string

  beforeEach(async () => {
    sqlite = new DatabaseSync(':memory:')
    sqlite.exec('PRAGMA foreign_keys = ON;')

    const migrationsDir = path.resolve(process.cwd(), 'worker/migrations')
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
      sqlite.exec(sql)
    }

    d1 = createRealD1(sqlite)
    env = {
      DB: d1,
      FILES: {} as unknown as R2Bucket,
      ENVIRONMENT: 'local',
      SERVICE_NAME: 'pos-system-api',
      API_VERSION: 'v1',
    }

    // Seed Business & Branch
    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'BIZPAY', 'Apex Receivables Co', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Apex Main Branch', 1, 'active')
    `).run(branchId, businessId)

    // Seed Cashier
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'cashier@apexpay.pk', 'Payment Collector', 'dummy_hash', 'active')
    `).run(cashierUserId)
    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_cashier_pay', ?, ?, 'cashier', 1)
    `).run(businessId, cashierUserId)
    sqlite.prepare(`
      INSERT INTO member_branches (id, member_id, branch_id)
      VALUES ('mb_cashier_pay', 'mem_cashier_pay', ?)
    `).run(branchId)

    // Seed Customer (Credit Limit: 1,000,000 minor)
    sqlite.prepare(`
      INSERT INTO customers (id, business_id, customer_code, name, type, phone, opening_balance_minor, credit_limit_minor, is_walk_in, status)
      VALUES (?, ?, 'CUST-009', 'Chaudhry & Sons Ltd', 'business', '03211234567', 0, 10000000, 0, 'active')
    `).run(custId, businessId)

    // Seed Product & Stock
    sqlite.prepare(`
      INSERT INTO products (id, business_id, name, sku, barcode, unit, purchase_price_minor, selling_price_minor, track_inventory, status)
      VALUES (?, ?, 'Wholesale Cooking Oil 16L', 'OIL-16L', '8966000100', 'piece', 600000, 750000, 1, 'active')
    `).run(prodId, businessId)
    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand, updated_at)
      VALUES ('inv_bal_pay', ?, ?, ?, 100.0, datetime('now'))
    `).run(businessId, branchId, prodId)

    cashierToken = (await createSession(d1, cashierUserId)).token

    // Create an unpaid credit sale (1 tin = 750,000 minor)
    const saleRes = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          customerId: custId,
          items: [{ productId: prodId, quantity: 1 }],
          payments: [],
        }),
      }),
      env,
      executionCtx
    )
    const saleData = ((await saleRes.json()) as { data: { id: string } }).data
    unpaidSaleId = saleData.id

    const inv = sqlite.prepare('SELECT id FROM invoices WHERE sale_id = ?').get(unpaidSaleId) as { id: string }
    unpaidInvoiceId = inv.id
  })

  it('records a customer payment and allocates it against an open invoice', async () => {
    // Customer owes 750,000. Customer pays 500,000 (split: 300,000 cash, 200,000 bank_transfer)
    const paymentPayload = {
      customerId: custId,
      amountMinor: 500000,
      paymentMethods: [
        { method: 'cash', amountMinor: 300000 },
        { method: 'bank_transfer', amountMinor: 200000, reference: 'HBL-TXN-9988' },
      ],
      allocations: [
        { invoiceId: unpaidInvoiceId, amountMinor: 500000 },
      ],
      notes: 'Partial payment on account',
    }

    const res = await worker.fetch(
      new Request('http://localhost/api/v1/customer-payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify(paymentPayload),
      }),
      env,
      executionCtx
    )

    expect(res.status).toBe(201)
    const json = (await res.json()) as { data: { id: string; receiptNumber: string; unallocatedAmountMinor: number } }
    const payment = json.data

    expect(payment.id).toBeDefined()
    expect(payment.receiptNumber).toMatch(/^RCP-/)
    expect(payment.unallocatedAmountMinor).toBe(0)

    // Verify invoice was updated
    const inv = sqlite
      .prepare('SELECT paid_amount_minor, remaining_amount_minor, payment_status FROM invoices WHERE id = ?')
      .get(unpaidInvoiceId) as { paid_amount_minor: number; remaining_amount_minor: number; payment_status: string }
    expect(inv.paid_amount_minor).toBe(500000)
    expect(inv.remaining_amount_minor).toBe(250000)
    expect(inv.payment_status).toBe('partial')

    // Verify sale was updated
    const sale = sqlite
      .prepare('SELECT amount_paid_minor, remaining_balance_minor FROM sales WHERE id = ?')
      .get(unpaidSaleId) as { amount_paid_minor: number; remaining_balance_minor: number }
    expect(sale.amount_paid_minor).toBe(500000)
    expect(sale.remaining_balance_minor).toBe(250000)

    // Verify customer ledger balance: was 750000, credited 500000 -> now 250000
    const lastLedger = sqlite
      .prepare('SELECT type, debit_minor, credit_minor, balance_minor FROM customer_ledger_transactions WHERE customer_id = ? ORDER BY rowid DESC LIMIT 1')
      .get(custId) as { type: string; debit_minor: number; credit_minor: number; balance_minor: number }
    expect(lastLedger.type).toBe('payment')
    expect(lastLedger.debit_minor).toBe(0)
    expect(lastLedger.credit_minor).toBe(500000)
    expect(lastLedger.balance_minor).toBe(250000)
  })

  it('rejects payment if method amounts do not sum to total amount', async () => {
    const paymentPayload = {
      customerId: custId,
      amountMinor: 500000,
      paymentMethods: [
        { method: 'cash', amountMinor: 400000 }, // sum 400000 != 500000
      ],
    }

    const res = await worker.fetch(
      new Request('http://localhost/api/v1/customer-payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify(paymentPayload),
      }),
      env,
      executionCtx
    )

    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: { message: string } }
    expect(json.error.message).toMatch(/does not match total payment amount/i)
  })

  it('rejects allocation exceeding invoice remaining balance', async () => {
    // Invoice remaining balance is 750,000. Attempt to allocate 800,000
    const paymentPayload = {
      customerId: custId,
      amountMinor: 800000,
      paymentMethods: [{ method: 'cash', amountMinor: 800000 }],
      allocations: [{ invoiceId: unpaidInvoiceId, amountMinor: 800000 }],
    }

    const res = await worker.fetch(
      new Request('http://localhost/api/v1/customer-payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify(paymentPayload),
      }),
      env,
      executionCtx
    )

    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: { message: string } }
    expect(json.error.message).toMatch(/exceeds remaining balance/i)
  })

  it('accepts unallocated advance payment and later allocates it to an invoice via /allocations', async () => {
    // 1. Customer pays 1,000,000 on account with NO initial allocations (pure advance credit)
    const advancePayload = {
      customerId: custId,
      amountMinor: 1000000,
      paymentMethods: [{ method: 'cash', amountMinor: 1000000 }],
      notes: 'Customer advance deposit',
    }

    const payRes = await worker.fetch(
      new Request('http://localhost/api/v1/customer-payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify(advancePayload),
      }),
      env,
      executionCtx
    )

    expect(payRes.status).toBe(201)
    const payData = ((await payRes.json()) as { data: { id: string; unallocatedAmountMinor: number } }).data
    expect(payData.unallocatedAmountMinor).toBe(1000000)

    // Customer ledger: was +750000, credited 1000000 -> balance is now -250000 (advance)
    let ledger = sqlite
      .prepare('SELECT balance_minor FROM customer_ledger_transactions WHERE customer_id = ? ORDER BY rowid DESC LIMIT 1')
      .get(custId) as { balance_minor: number }
    expect(ledger.balance_minor).toBe(-250000)

    // 2. Allocate 750,000 from the advance to pay off the unpaid invoice
    const allocRes = await worker.fetch(
      new Request(`http://localhost/api/v1/customer-payments/${payData.id}/allocations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          allocations: [{ invoiceId: unpaidInvoiceId, amountMinor: 750000 }],
        }),
      }),
      env,
      executionCtx
    )

    expect(allocRes.status).toBe(200)
    const updatedPay = ((await allocRes.json()) as { data: { unallocatedAmountMinor: number } }).data
    expect(updatedPay.unallocatedAmountMinor).toBe(250000) // 1,000,000 - 750,000

    // Invoice is now fully paid
    const inv = sqlite
      .prepare('SELECT remaining_amount_minor, payment_status FROM invoices WHERE id = ?')
      .get(unpaidInvoiceId) as { remaining_amount_minor: number; payment_status: string }
    expect(inv.remaining_amount_minor).toBe(0)
    expect(inv.payment_status).toBe('paid')

    // Customer ledger transaction count was 2 (invoice + payment); advance allocation does NOT duplicate ledger entry
    const count = sqlite
      .prepare('SELECT COUNT(*) as cnt FROM customer_ledger_transactions WHERE customer_id = ?')
      .get(custId) as { cnt: number }
    expect(count.cnt).toBe(2)
  })

  it('enforces idempotency on payment creation', async () => {
    const idempotencyKey = 'pay-idem-key-888'
    const payload = {
      customerId: custId,
      amountMinor: 100000,
      paymentMethods: [{ method: 'cash', amountMinor: 100000 }],
    }

    const res1 = await worker.fetch(
      new Request('http://localhost/api/v1/customer-payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(payload),
      }),
      env,
      executionCtx
    )
    expect(res1.status).toBe(201)
    const json1 = (await res1.json()) as { data: { id: string } }

    // Duplicate call
    const res2 = await worker.fetch(
      new Request('http://localhost/api/v1/customer-payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(payload),
      }),
      env,
      executionCtx
    )
    expect(res2.status).toBe(201)
    const json2 = (await res2.json()) as { data: { id: string } }
    expect(json2.data.id).toBe(json1.data.id)

    // Only 1 payment row in database
    const paymentsCount = sqlite.prepare('SELECT COUNT(*) as cnt FROM payments WHERE business_id = ?').get(businessId) as { cnt: number }
    expect(paymentsCount.cnt).toBe(1)
  })
})
