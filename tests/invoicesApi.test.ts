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

describe('Invoices API (/api/v1/invoices)', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const businessId = 'biz_inv_test'
  const branchId = 'branch_inv_main'
  const cashierUserId = 'usr_cashier_inv'
  let cashierToken: string

  const cust1 = 'cust_inv_1'
  const cust2 = 'cust_inv_2'
  const prodId = 'prod_inv_1'

  let invoicePaidId: string
  let invoiceUnpaidId: string
  let invoicePartialId: string

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
      VALUES (?, 'BIZINV', 'Invoicing Hub', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Invoicing Main Branch', 1, 'active')
    `).run(branchId, businessId)

    // Seed Cashier
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'cashier@inv.pk', 'Invoice Cashier', 'dummy_hash', 'active')
    `).run(cashierUserId)
    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_cashier_inv', ?, ?, 'cashier', 1)
    `).run(businessId, cashierUserId)
    sqlite.prepare(`
      INSERT INTO member_branches (id, member_id, branch_id)
      VALUES ('mb_cashier_inv', 'mem_cashier_inv', ?)
    `).run(branchId)

    // Seed Customers
    sqlite.prepare(`
      INSERT INTO customers (id, business_id, customer_code, name, type, phone, opening_balance_minor, credit_limit_minor, is_walk_in, status)
      VALUES (?, ?, 'CUST-A', 'Ahmed Trading', 'business', '03001111111', 0, 10000000, 0, 'active')
    `).run(cust1, businessId)

    sqlite.prepare(`
      INSERT INTO customers (id, business_id, customer_code, name, type, phone, opening_balance_minor, credit_limit_minor, is_walk_in, status)
      VALUES (?, ?, 'CUST-B', 'Bilal Associates', 'business', '03002222222', 0, 10000000, 0, 'active')
    `).run(cust2, businessId)

    // Seed Product
    sqlite.prepare(`
      INSERT INTO products (id, business_id, name, sku, barcode, unit, purchase_price_minor, selling_price_minor, track_inventory, status)
      VALUES (?, ?, 'Standard Item', 'STD-001', '1234567890', 'piece', 5000, 10000, 1, 'active')
    `).run(prodId, businessId)
    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand, updated_at)
      VALUES ('inv_bal_inv', ?, ?, ?, 1000.0, datetime('now'))
    `).run(businessId, branchId, prodId)

    cashierToken = (await createSession(d1, cashierUserId)).token

    // Create 3 sales via Worker API to populate invoices, items, and allocations naturally:
    // 1. Paid invoice for cust1
    const res1 = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          customerId: cust1,
          items: [{ productId: prodId, quantity: 5 }], // 50,000
          payments: [{ method: 'cash', amountMinor: 50000 }],
        }),
      }),
      env,
      executionCtx
    )
    const sale1 = ((await res1.json()) as { data: { id: string } }).data
    invoicePaidId = (sqlite.prepare('SELECT id FROM invoices WHERE sale_id = ?').get(sale1.id) as { id: string }).id

    // 2. Unpaid credit invoice for cust1
    const res2 = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          customerId: cust1,
          items: [{ productId: prodId, quantity: 3 }], // 30,000
          payments: [],
        }),
      }),
      env,
      executionCtx
    )
    const sale2 = ((await res2.json()) as { data: { id: string } }).data
    invoiceUnpaidId = (sqlite.prepare('SELECT id FROM invoices WHERE sale_id = ?').get(sale2.id) as { id: string }).id

    // 3. Partial invoice for cust2
    const res3 = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          customerId: cust2,
          items: [{ productId: prodId, quantity: 4 }], // 40,000
          payments: [{ method: 'cash', amountMinor: 15000 }], // 15,000 paid, 25,000 remaining
        }),
      }),
      env,
      executionCtx
    )
    const sale3 = ((await res3.json()) as { data: { id: string } }).data
    invoicePartialId = (sqlite.prepare('SELECT id FROM invoices WHERE sale_id = ?').get(sale3.id) as { id: string }).id
  })

  it('lists all invoices with pagination metadata', async () => {
    const res = await worker.fetch(
      new Request('http://localhost/api/v1/invoices?page=1&limit=10', {
        headers: {
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
      }),
      env,
      executionCtx
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: Array<{ id: string }>; meta: { totalCount: number; totalPages: number } }
    expect(json.data.length).toBe(3)
    expect(json.meta.totalCount).toBe(3)
    expect(json.meta.totalPages).toBe(1)
  })

  it('filters invoices by paymentStatus', async () => {
    // Unpaid
    const resUnpaid = await worker.fetch(
      new Request('http://localhost/api/v1/invoices?paymentStatus=unpaid', {
        headers: {
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
      }),
      env,
      executionCtx
    )
    expect(resUnpaid.status).toBe(200)
    const jsonUnpaid = (await resUnpaid.json()) as { data: Array<{ id: string; paymentStatus: string }> }
    expect(jsonUnpaid.data.length).toBe(1)
    expect(jsonUnpaid.data[0].id).toBe(invoiceUnpaidId)
    expect(jsonUnpaid.data[0].paymentStatus).toBe('unpaid')

    // Partial
    const resPartial = await worker.fetch(
      new Request('http://localhost/api/v1/invoices?paymentStatus=partial', {
        headers: {
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
      }),
      env,
      executionCtx
    )
    expect(resPartial.status).toBe(200)
    const jsonPartial = (await resPartial.json()) as { data: Array<{ id: string; paymentStatus: string }> }
    expect(jsonPartial.data.length).toBe(1)
    expect(jsonPartial.data[0].id).toBe(invoicePartialId)
    expect(jsonPartial.data[0].paymentStatus).toBe('partial')
  })

  it('filters invoices by customerId', async () => {
    const res = await worker.fetch(
      new Request(`http://localhost/api/v1/invoices?customerId=${cust2}`, {
        headers: {
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
      }),
      env,
      executionCtx
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: Array<{ customerId: string }> }
    expect(json.data.length).toBe(1)
    expect(json.data[0].customerId).toBe(cust2)
  })

  it('retrieves single invoice detail with items and allocations', async () => {
    const res = await worker.fetch(
      new Request(`http://localhost/api/v1/invoices/${invoicePartialId}`, {
        headers: {
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
      }),
      env,
      executionCtx
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      data: {
        id: string
        totalAmountMinor: number
        paidAmountMinor: number
        remainingAmountMinor: number
        items: Array<{ productId: string; quantity: number }>
        allocations: Array<{ amountMinor: number }>
      }
    }
    const inv = json.data
    expect(inv.id).toBe(invoicePartialId)
    expect(inv.totalAmountMinor).toBe(40000)
    expect(inv.paidAmountMinor).toBe(15000)
    expect(inv.remainingAmountMinor).toBe(25000)
    // Integrity check
    expect(inv.totalAmountMinor).toBe(inv.paidAmountMinor + inv.remainingAmountMinor)

    expect(inv.items.length).toBe(1)
    expect(inv.items[0].quantity).toBe(4)

    expect(inv.allocations.length).toBe(1)
    expect(inv.allocations[0].amountMinor).toBe(15000)
  })

  it('retrieves the associated sale for an invoice via /invoices/:id/sale', async () => {
    const res = await worker.fetch(
      new Request(`http://localhost/api/v1/invoices/${invoicePaidId}/sale`, {
        headers: {
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
      }),
      env,
      executionCtx
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: { id: string; totalAmountMinor: number } }
    expect(json.data.id).toBeDefined()
    expect(json.data.totalAmountMinor).toBe(50000)
  })

  it('returns 404 for non-existent invoice', async () => {
    const res = await worker.fetch(
      new Request('http://localhost/api/v1/invoices/inv_does_not_exist', {
        headers: {
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
      }),
      env,
      executionCtx
    )
    expect(res.status).toBe(404)
  })
})

