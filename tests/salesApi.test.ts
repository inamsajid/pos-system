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

describe('Sales API (/api/v1/sales)', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const businessId = 'biz_sales_test'
  const branchId = 'branch_sales_main'
  const ownerUserId = 'usr_owner_sales'
  const managerUserId = 'usr_manager_sales'
  const cashierUserId = 'usr_cashier_sales'

  let managerToken: string
  let cashierToken: string

  const productId1 = 'prod_tea_1'
  const productId2 = 'prod_sugar_1'
  const customerId1 = 'cust_credit_1'

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
      VALUES (?, 'BIZSALES', 'Apex Supermarket', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Main Store Branch', 1, 'active')
    `).run(branchId, businessId)

    sqlite.prepare(`
      INSERT INTO business_settings (business_id, allow_negative_stock)
      VALUES (?, 0)
    `).run(businessId)

    // Seed Users & Memberships
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'owner@apex.pk', 'Owner User', 'dummy_hash', 'active')
    `).run(ownerUserId)
    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_owner_sales', ?, ?, 'owner', 1)
    `).run(businessId, ownerUserId)

    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'manager@apex.pk', 'Manager User', 'dummy_hash', 'active')
    `).run(managerUserId)
    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_mgr_sales', ?, ?, 'manager', 1)
    `).run(businessId, managerUserId)

    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'cashier@apex.pk', 'Cashier User', 'dummy_hash', 'active')
    `).run(cashierUserId)
    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_cashier_sales', ?, ?, 'cashier', 1)
    `).run(businessId, cashierUserId)
    sqlite.prepare(`
      INSERT INTO member_branches (id, member_id, branch_id)
      VALUES ('mb_cashier_sales', 'mem_cashier_sales', ?)
    `).run(branchId)

    // Seed Products & Inventory
    sqlite.prepare(`
      INSERT INTO products (id, business_id, name, sku, barcode, unit, purchase_price_minor, selling_price_minor, track_inventory, status)
      VALUES (?, ?, 'Tapal Danedar Tea 450g', 'TAPAL-450', '8964000100', 'piece', 45000, 55000, 1, 'active')
    `).run(productId1, businessId)

    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand, updated_at)
      VALUES ('inv_bal_1', ?, ?, ?, 50.0, datetime('now'))
    `).run(businessId, branchId, productId1)

    sqlite.prepare(`
      INSERT INTO products (id, business_id, name, sku, barcode, unit, purchase_price_minor, selling_price_minor, track_inventory, status)
      VALUES (?, ?, 'Premium White Sugar 1kg', 'SUGAR-1KG', '8964000200', 'kg', 14000, 16000, 1, 'active')
    `).run(productId2, businessId)

    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand, updated_at)
      VALUES ('inv_bal_2', ?, ?, ?, 20.5, datetime('now'))
    `).run(businessId, branchId, productId2)

    // Seed Registered Credit Customer (Credit Limit: PKR 50,000 = 5,000,000 minor)
    sqlite.prepare(`
      INSERT INTO customers (id, business_id, customer_code, name, type, phone, opening_balance_minor, credit_limit_minor, is_walk_in, status)
      VALUES (?, ?, 'CUST-001', 'Haji Abdullah Traders', 'business', '03001234567', 0, 5000000, 0, 'active')
    `).run(customerId1, businessId)

    // Create Sessions
    managerToken = (await createSession(d1, managerUserId)).token
    cashierToken = (await createSession(d1, cashierUserId)).token
  })

  it('completes a full cash POS sale for a walk-in customer', async () => {
    const salePayload = {
      items: [
        { productId: productId1, quantity: 2 }, // 2 * 55000 = 110000
        { productId: productId2, quantity: 1.5 }, // 1.5 * 16000 = 24000 -> Total: 134000
      ],
      payments: [
        { method: 'cash', amountMinor: 134000 },
      ],
    }

    const res = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify(salePayload),
      }),
      env,
      executionCtx
    )

    expect(res.status).toBe(201)
    const json = (await res.json()) as { data: Record<string, unknown> }
    const sale = json.data

    expect(sale.id).toBeDefined()
    expect(sale.saleNumber).toBeDefined()
    expect(sale.invoiceNumber).toBeDefined()
    expect(sale.receiptNumber).toBeDefined()
    expect(sale.totalAmountMinor).toBe(134000)
    expect(sale.amountPaidMinor).toBe(134000)
    expect(sale.remainingBalanceMinor).toBe(0)
    expect(sale.status).toBe('completed')

    // Verify inventory balances updated
    const bal1 = sqlite
      .prepare('SELECT quantity_on_hand FROM inventory_balances WHERE product_id = ? AND branch_id = ?')
      .get(productId1, branchId) as { quantity_on_hand: number }
    expect(bal1.quantity_on_hand).toBe(48.0) // 50 - 2

    const bal2 = sqlite
      .prepare('SELECT quantity_on_hand FROM inventory_balances WHERE product_id = ? AND branch_id = ?')
      .get(productId2, branchId) as { quantity_on_hand: number }
    expect(bal2.quantity_on_hand).toBe(19.0) // 20.5 - 1.5

    // Verify stock_movements recorded
    const movements = sqlite
      .prepare('SELECT * FROM stock_movements WHERE business_id = ? ORDER BY created_at ASC')
      .all(businessId)
    expect(movements.length).toBe(2)

    // Verify invoice created
    const invoice = sqlite
      .prepare('SELECT * FROM invoices WHERE sale_id = ?')
      .get(sale.id as string) as {
      total_amount_minor: number
      paid_amount_minor: number
      remaining_amount_minor: number
      payment_status: string
      status: string
    }
    expect(invoice).toBeDefined()
    expect(invoice.total_amount_minor).toBe(134000)
    expect(invoice.paid_amount_minor).toBe(134000)
    expect(invoice.remaining_amount_minor).toBe(0)
    expect(invoice.payment_status).toBe('paid')
    expect(invoice.status).toBe('active')

    // Verify payment and allocation recorded
    const payments = sqlite
      .prepare('SELECT * FROM payments WHERE business_id = ?')
      .all(businessId) as Array<{ amount_minor: number; unallocated_amount_minor: number }>
    expect(payments.length).toBe(1)
    expect(payments[0].amount_minor).toBe(134000)
    expect(payments[0].unallocated_amount_minor).toBe(0)

    const allocs = sqlite
      .prepare('SELECT * FROM payment_allocations WHERE business_id = ?')
      .all(businessId) as Array<{ amount_minor: number }>
    expect(allocs.length).toBe(1)
    expect(allocs[0].amount_minor).toBe(134000)
  })

  it('completes a credit sale for a registered customer with ledger entries', async () => {
    const salePayload = {
      customerId: customerId1,
      items: [{ productId: productId1, quantity: 3 }], // 3 * 55000 = 165000
      payments: [], // Pure credit, 0 paid now
    }

    const res = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify(salePayload),
      }),
      env,
      executionCtx
    )

    expect(res.status).toBe(201)
    const json = (await res.json()) as { data: Record<string, unknown> }
    const sale = json.data
    expect(sale.totalAmountMinor).toBe(165000)
    expect(sale.amountPaidMinor).toBe(0)
    expect(sale.remainingBalanceMinor).toBe(165000)

    // Verify invoice is unpaid
    const invoice = sqlite
      .prepare('SELECT * FROM invoices WHERE sale_id = ?')
      .get(sale.id as string) as { remaining_amount_minor: number; payment_status: string }
    expect(invoice.remaining_amount_minor).toBe(165000)
    expect(invoice.payment_status).toBe('unpaid')

    // Verify Customer Ledger has the debit entry
    const ledger = sqlite
      .prepare('SELECT * FROM customer_ledger_transactions WHERE customer_id = ?')
      .all(customerId1) as Array<{
      type: string
      debit_minor: number
      credit_minor: number
      balance_minor: number
    }>
    expect(ledger.length).toBe(1)
    expect(ledger[0].type).toBe('invoice')
    expect(ledger[0].debit_minor).toBe(165000)
    expect(ledger[0].credit_minor).toBe(0)
    expect(ledger[0].balance_minor).toBe(165000)
  })

  it('rejects credit sales for walk-in customers', async () => {
    const salePayload = {
      // walk-in default
      items: [{ productId: productId1, quantity: 1 }], // 55000
      payments: [{ method: 'cash', amountMinor: 20000 }], // Underpaid by 35000
    }

    const res = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify(salePayload),
      }),
      env,
      executionCtx
    )

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toMatch(/Walk-in customer cannot purchase on credit/i)
  })

  it('rejects credit sale when customer credit limit is exceeded', async () => {
    // Customer has credit limit 5,000,000 minor.
    // Try to purchase 100 units of tea = 100 * 55,000 = 5,500,000 minor on credit.
    // First give stock of 100
    sqlite.prepare('UPDATE inventory_balances SET quantity_on_hand = 200 WHERE product_id = ?').run(productId1)

    const salePayload = {
      customerId: customerId1,
      items: [{ productId: productId1, quantity: 100 }], // 5,500,000 > 5,000,000
      payments: [],
    }

    const res = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify(salePayload),
      }),
      env,
      executionCtx
    )

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toMatch(/exceeds customer's authorized credit limit/i)
  })

  it('rejects sale with insufficient stock when allow_negative_stock is 0', async () => {
    const salePayload = {
      items: [{ productId: productId1, quantity: 100 }], // Only 50 available
      payments: [{ method: 'cash', amountMinor: 5500000 }],
    }

    const res = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify(salePayload),
      }),
      env,
      executionCtx
    )

    expect([400, 422]).toContain(res.status)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toMatch(/Insufficient stock/i)
  })

  it('enforces idempotency: identical key returns cached sale without duplicating inventory deduction', async () => {
    const idempotencyKey = 'idem-pos-checkout-001'
    const salePayload = {
      items: [{ productId: productId1, quantity: 2 }], // 110,000
      payments: [{ method: 'cash', amountMinor: 110000 }],
    }

    // First request
    const res1 = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(salePayload),
      }),
      env,
      executionCtx
    )
    expect(res1.status).toBe(201)
    const body1 = (await res1.json()) as { data: { id: string } }

    // Second request with SAME key and payload
    const res2 = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(salePayload),
      }),
      env,
      executionCtx
    )
    expect(res2.status).toBe(201)
    const body2 = (await res2.json()) as { data: { id: string } }
    expect(body2.data.id).toBe(body1.data.id)

    // Stock should only have been deducted ONCE (50 - 2 = 48)
    const bal = sqlite
      .prepare('SELECT quantity_on_hand FROM inventory_balances WHERE product_id = ? AND branch_id = ?')
      .get(productId1, branchId) as { quantity_on_hand: number }
    expect(bal.quantity_on_hand).toBe(48.0)

    // Sales table has exactly 1 row
    const count = sqlite.prepare('SELECT COUNT(*) as cnt FROM sales WHERE business_id = ?').get(businessId) as {
      cnt: number
    }
    expect(count.cnt).toBe(1)
  })

  it('returns 409 conflict when idempotency key is reused with different payload', async () => {
    const idempotencyKey = 'idem-pos-conflict-002'
    const payload1 = {
      items: [{ productId: productId1, quantity: 1 }],
      payments: [{ method: 'cash', amountMinor: 55000 }],
    }
    const payload2 = {
      items: [{ productId: productId1, quantity: 2 }], // different quantity
      payments: [{ method: 'cash', amountMinor: 110000 }],
    }

    const res1 = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(payload1),
      }),
      env,
      executionCtx
    )
    expect(res1.status).toBe(201)

    const res2 = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(payload2),
      }),
      env,
      executionCtx
    )
    expect(res2.status).toBe(409)
  })

  it('allows manager to void a sale on the same business day, restoring stock and ledger', async () => {
    // Create a credit sale first
    const salePayload = {
      customerId: customerId1,
      items: [{ productId: productId1, quantity: 2 }], // 110,000
      payments: [],
    }

    const createRes = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify(salePayload),
      }),
      env,
      executionCtx
    )
    expect(createRes.status).toBe(201)
    const sale = ((await createRes.json()) as { data: { id: string } }).data

    // Stock was 50, now 48
    let bal = sqlite
      .prepare('SELECT quantity_on_hand FROM inventory_balances WHERE product_id = ?')
      .get(productId1) as { quantity_on_hand: number }
    expect(bal.quantity_on_hand).toBe(48)

    // Manager voids the sale
    const voidRes = await worker.fetch(
      new Request(`http://localhost/api/v1/sales/${sale.id}/void`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${managerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({ reason: 'Customer changed mind at counter' }),
      }),
      env,
      executionCtx
    )
    expect(voidRes.status).toBe(200)

    // Stock is restored to 50
    bal = sqlite
      .prepare('SELECT quantity_on_hand FROM inventory_balances WHERE product_id = ?')
      .get(productId1) as { quantity_on_hand: number }
    expect(bal.quantity_on_hand).toBe(50)

    // Invoice status is voided
    const invoice = sqlite
      .prepare('SELECT status FROM invoices WHERE sale_id = ?')
      .get(sale.id) as { status: string }
    expect(invoice.status).toBe('voided')

    // Customer ledger should have contra void entry restoring balance to 0
    const lastLedger = sqlite
      .prepare('SELECT * FROM customer_ledger_transactions WHERE customer_id = ? ORDER BY rowid DESC LIMIT 1')
      .get(customerId1) as { type: string; balance_minor: number }
    expect(lastLedger.type).toBe('void')
    expect(lastLedger.balance_minor).toBe(0)
  })

  it('forbids cashier from voiding a sale', async () => {
    // Create sale
    const salePayload = {
      items: [{ productId: productId1, quantity: 1 }],
      payments: [{ method: 'cash', amountMinor: 55000 }],
    }
    const createRes = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify(salePayload),
      }),
      env,
      executionCtx
    )
    const sale = ((await createRes.json()) as { data: { id: string } }).data

    // Cashier attempts to void
    const voidRes = await worker.fetch(
      new Request(`http://localhost/api/v1/sales/${sale.id}/void`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({ reason: 'Unauthorized void attempt' }),
      }),
      env,
      executionCtx
    )
    expect(voidRes.status).toBe(403)
  })

  it('retrieves sale by ID and associated invoice', async () => {
    const salePayload = {
      items: [{ productId: productId1, quantity: 1 }],
      payments: [{ method: 'cash', amountMinor: 55000 }],
    }
    const createRes = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify(salePayload),
      }),
      env,
      executionCtx
    )
    const sale = ((await createRes.json()) as { data: { id: string } }).data

    // GET /api/v1/sales/:id
    const getRes = await worker.fetch(
      new Request(`http://localhost/api/v1/sales/${sale.id}`, {
        headers: {
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
      }),
      env,
      executionCtx
    )
    expect(getRes.status).toBe(200)
    const getBody = (await getRes.json()) as { data: { id: string; items: unknown[] } }
    expect(getBody.data.id).toBe(sale.id)
    expect(getBody.data.items.length).toBe(1)

    // GET /api/v1/sales/:id/invoice
    const invRes = await worker.fetch(
      new Request(`http://localhost/api/v1/sales/${sale.id}/invoice`, {
        headers: {
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
      }),
      env,
      executionCtx
    )
    expect(invRes.status).toBe(200)
    const invBody = (await invRes.json()) as { data: { sale_id: string } }
    expect(invBody.data.sale_id).toBe(sale.id)
  })
})
