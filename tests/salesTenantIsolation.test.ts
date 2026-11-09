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

describe('Sales, Invoices & Payments Multi-Tenant & Branch Isolation', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  // Business 1
  const biz1 = 'biz_iso_1'
  const branch1A = 'branch_iso_1a'
  const branch1B = 'branch_iso_1b'
  const user1 = 'usr_owner_biz1'
  const cashier1A = 'usr_cashier_1a'
  let token1Owner: string
  let token1CashierA: string

  // Business 2
  const biz2 = 'biz_iso_2'
  const branch2 = 'branch_iso_2'
  const user2 = 'usr_owner_biz2'
  let token2Owner: string

  // Entity IDs from Business 1
  let saleIdBiz1BranchA: string
  let saleIdBiz1BranchB: string
  let invoiceIdBiz1: string
  let paymentIdBiz1: string
  let customerIdBiz1: string

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

    // Seed Business 1
    sqlite.prepare(`INSERT INTO businesses (id, business_code, name, status) VALUES (?, 'BIZ1', 'Business One', 'active')`).run(biz1)
    sqlite.prepare(`INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status) VALUES (?, ?, 'B1A', 'Branch 1A', 1, 'active')`).run(branch1A, biz1)
    sqlite.prepare(`INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status) VALUES (?, ?, 'B1B', 'Branch 1B', 0, 'active')`).run(branch1B, biz1)

    // Seed Owner 1
    sqlite.prepare(`INSERT INTO users (id, email, name, password_hash, status) VALUES (?, 'owner1@iso.pk', 'Owner 1', 'dummy', 'active')`).run(user1)
    sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role, is_active) VALUES ('mem_owner_1', ?, ?, 'owner', 1)`).run(biz1, user1)

    // Seed Cashier 1A (assigned ONLY to Branch 1A)
    sqlite.prepare(`INSERT INTO users (id, email, name, password_hash, status) VALUES (?, 'cashier1a@iso.pk', 'Cashier 1A', 'dummy', 'active')`).run(cashier1A)
    sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role, is_active) VALUES ('mem_cashier_1a', ?, ?, 'cashier', 1)`).run(biz1, cashier1A)
    sqlite.prepare(`INSERT INTO member_branches (id, member_id, branch_id) VALUES ('mb_1a', 'mem_cashier_1a', ?)`).run(branch1A)

    // Seed Business 2
    sqlite.prepare(`INSERT INTO businesses (id, business_code, name, status) VALUES (?, 'BIZ2', 'Business Two', 'active')`).run(biz2)
    sqlite.prepare(`INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status) VALUES (?, ?, 'B2', 'Branch 2', 1, 'active')`).run(branch2, biz2)
    sqlite.prepare(`INSERT INTO users (id, email, name, password_hash, status) VALUES (?, 'owner2@iso.pk', 'Owner 2', 'dummy', 'active')`).run(user2)
    sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role, is_active) VALUES ('mem_owner_2', ?, ?, 'owner', 1)`).run(biz2, user2)

    // Seed Customer for Business 1
    customerIdBiz1 = 'cust_biz1'
    sqlite.prepare(`INSERT INTO customers (id, business_id, customer_code, name, type, phone, opening_balance_minor, credit_limit_minor, is_walk_in, status) VALUES (?, ?, 'C1', 'Client One', 'individual', '03001', 0, 1000000, 0, 'active')`).run(customerIdBiz1, biz1)

    // Seed Products in Business 1
    const p1A = 'prod_1a'
    const p1B = 'prod_1b'
    sqlite.prepare(`INSERT INTO products (id, business_id, name, sku, barcode, unit, purchase_price_minor, selling_price_minor, track_inventory, status) VALUES (?, ?, 'Item 1A', 'SKU1A', '111', 'piece', 1000, 2000, 1, 'active')`).run(p1A, biz1)
    sqlite.prepare(`INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand, updated_at) VALUES ('inv_1a', ?, ?, ?, 100.0, datetime('now'))`).run(biz1, branch1A, p1A)

    sqlite.prepare(`INSERT INTO products (id, business_id, name, sku, barcode, unit, purchase_price_minor, selling_price_minor, track_inventory, status) VALUES (?, ?, 'Item 1B', 'SKU1B', '222', 'piece', 1000, 2000, 1, 'active')`).run(p1B, biz1)
    sqlite.prepare(`INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand, updated_at) VALUES ('inv_1b', ?, ?, ?, 100.0, datetime('now'))`).run(biz1, branch1B, p1B)

    token1Owner = (await createSession(d1, user1)).token
    token1CashierA = (await createSession(d1, cashier1A)).token
    token2Owner = (await createSession(d1, user2)).token

    // Create Sale in Branch 1A
    const resA = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token1CashierA}`,
          'X-Business-Id': biz1,
          'X-Branch-Id': branch1A,
        },
        body: JSON.stringify({
          customerId: customerIdBiz1,
          items: [{ productId: p1A, quantity: 2 }],
          payments: [{ method: 'cash', amountMinor: 4000 }],
        }),
      }),
      env,
      executionCtx
    )
    const saleA = ((await resA.json()) as { data: { id: string } }).data
    saleIdBiz1BranchA = saleA.id

    const inv = sqlite.prepare('SELECT id FROM invoices WHERE sale_id = ?').get(saleIdBiz1BranchA) as { id: string }
    invoiceIdBiz1 = inv.id

    const pay = sqlite.prepare('SELECT id FROM payments WHERE business_id = ?').get(biz1) as { id: string }
    paymentIdBiz1 = pay.id

    // Create Sale in Branch 1B (by Owner 1)
    const resB = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token1Owner}`,
          'X-Business-Id': biz1,
          'X-Branch-Id': branch1B,
        },
        body: JSON.stringify({
          customerId: customerIdBiz1,
          items: [{ productId: p1B, quantity: 1 }],
          payments: [{ method: 'cash', amountMinor: 2000 }],
        }),
      }),
      env,
      executionCtx
    )
    const saleB = ((await resB.json()) as { data: { id: string } }).data
    saleIdBiz1BranchB = saleB.id
  })

  it('prevents Business 2 user from accessing Business 1 sales', async () => {
    // Attempt to GET Business 1 sale using Business 2 session & header
    const res = await worker.fetch(
      new Request(`http://localhost/api/v1/sales/${saleIdBiz1BranchA}`, {
        headers: {
          Authorization: `Bearer ${token2Owner}`,
          'X-Business-Id': biz2,
        },
      }),
      env,
      executionCtx
    )
    expect(res.status).toBe(404)
  })

  it('prevents Business 2 user from accessing Business 1 invoices', async () => {
    const res = await worker.fetch(
      new Request(`http://localhost/api/v1/invoices/${invoiceIdBiz1}`, {
        headers: {
          Authorization: `Bearer ${token2Owner}`,
          'X-Business-Id': biz2,
        },
      }),
      env,
      executionCtx
    )
    expect(res.status).toBe(404)
  })

  it('prevents Business 2 user from accessing Business 1 payments', async () => {
    const res = await worker.fetch(
      new Request(`http://localhost/api/v1/customer-payments/${paymentIdBiz1}`, {
        headers: {
          Authorization: `Bearer ${token2Owner}`,
          'X-Business-Id': biz2,
        },
      }),
      env,
      executionCtx
    )
    expect(res.status).toBe(404)
  })

  it('prevents Business 2 user from viewing Business 1 customer ledger', async () => {
    const res = await worker.fetch(
      new Request(`http://localhost/api/v1/customers/${customerIdBiz1}/ledger`, {
        headers: {
          Authorization: `Bearer ${token2Owner}`,
          'X-Business-Id': biz2,
        },
      }),
      env,
      executionCtx
    )
    expect(res.status).toBe(404)
  })

  it('restricts Branch 1A cashier from viewing sales from Branch 1B', async () => {
    // Cashier 1A queries sales listing: should only see Branch 1A sale
    const listRes = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        headers: {
          Authorization: `Bearer ${token1CashierA}`,
          'X-Business-Id': biz1,
          'X-Branch-Id': branch1A,
        },
      }),
      env,
      executionCtx
    )
    expect(listRes.status).toBe(200)
    const listData = (await listRes.json()) as { data: Array<{ id: string; branchId: string }> }
    expect(listData.data.length).toBe(1)
    expect(listData.data[0].id).toBe(saleIdBiz1BranchA)

    // Cashier 1A directly queries Branch 1B sale: 404 Not Found
    const directRes = await worker.fetch(
      new Request(`http://localhost/api/v1/sales/${saleIdBiz1BranchB}`, {
        headers: {
          Authorization: `Bearer ${token1CashierA}`,
          'X-Business-Id': biz1,
          'X-Branch-Id': branch1A,
        },
      }),
      env,
      executionCtx
    )
    expect(directRes.status).toBe(404)
  })

  it('allows Owner 1 to view sales from both branches within Business 1', async () => {
    const listRes = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        headers: {
          Authorization: `Bearer ${token1Owner}`,
          'X-Business-Id': biz1,
        },
      }),
      env,
      executionCtx
    )
    expect(listRes.status).toBe(200)
    const listData = (await listRes.json()) as { data: Array<{ id: string }> }
    expect(listData.data.length).toBe(2)
  })
})
