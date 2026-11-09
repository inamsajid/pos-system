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

describe('Sales Atomicity and ACID Rollback', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const businessId = 'biz_atom_test'
  const branchId = 'branch_atom_main'
  const cashierUserId = 'usr_cashier_atom'
  let cashierToken: string
  const productId = 'prod_atom_1'
  const customerId = 'cust_atom_1'

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
      VALUES (?, 'BIZATOM', 'Atomicity Superstore', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Atom Main Branch', 1, 'active')
    `).run(branchId, businessId)

    // Seed Cashier
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'cashier@atom.pk', 'Atom Cashier', 'dummy_hash', 'active')
    `).run(cashierUserId)
    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_cashier_atom', ?, ?, 'cashier', 1)
    `).run(businessId, cashierUserId)
    sqlite.prepare(`
      INSERT INTO member_branches (id, member_id, branch_id)
      VALUES ('mb_cashier_atom', 'mem_cashier_atom', ?)
    `).run(branchId)

    // Seed Product & Initial Stock
    sqlite.prepare(`
      INSERT INTO products (id, business_id, name, sku, barcode, unit, purchase_price_minor, selling_price_minor, track_inventory, status)
      VALUES (?, ?, 'Atom Rice 5kg', 'RICE-5KG', '8965000100', 'piece', 120000, 150000, 1, 'active')
    `).run(productId, businessId)

    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand, updated_at)
      VALUES ('inv_atom_1', ?, ?, ?, 10.0, datetime('now'))
    `).run(businessId, branchId, productId)

    // Seed Customer
    sqlite.prepare(`
      INSERT INTO customers (id, business_id, customer_code, name, type, phone, opening_balance_minor, credit_limit_minor, is_walk_in, status)
      VALUES (?, ?, 'CUST-ATOM', 'Atom Corporate Client', 'business', '03009999999', 0, 5000000, 0, 'active')
    `).run(customerId, businessId)

    cashierToken = (await createSession(d1, cashierUserId)).token
  })

  it('guarantees complete zero partial state rollback when a batch statement fails', async () => {
    // Intercept db.batch to inject a fatal database exception mid-batch
    const originalBatch = d1.batch.bind(d1)
    d1.batch = async (statements) => {
      // Intentionally insert a statement that triggers a FOREIGN KEY constraint failure inside the transaction
      const badStmt = {
        async run() {
          sqlite.prepare('INSERT INTO sales (id, business_id, branch_id, sale_number, receipt_number, invoice_number, customer_id, customer_snapshot_json, terminal_id, cashier_id, cashier_name, total_amount_minor, amount_paid_minor, remaining_balance_minor, change_returned_minor, business_date_key) VALUES ("bad", "non_existent_biz", "bad_branch", "S-BAD", "R-BAD", "INV-BAD", "bad_cust", "{}", "t1", "u1", "c1", 100, 100, 0, 0, "2026-11-09")').run()
        },
      }
      return originalBatch([...statements, badStmt as unknown as D1PreparedStatement])
    }

    const salePayload = {
      customerId,
      items: [{ productId, quantity: 2 }],
      payments: [{ method: 'cash', amountMinor: 300000 }],
    }

    const res = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
          'Idempotency-Key': 'atom-idem-key-001',
        },
        body: JSON.stringify(salePayload),
      }),
      env,
      executionCtx
    )

    expect(res.status).toBe(500)

    // ASSERT: Zero partial state
    const salesCount = sqlite.prepare('SELECT COUNT(*) as cnt FROM sales WHERE business_id = ?').get(businessId) as { cnt: number }
    expect(salesCount.cnt).toBe(0)

    const saleItemsCount = sqlite.prepare('SELECT COUNT(*) as cnt FROM sale_items').get() as { cnt: number }
    expect(saleItemsCount.cnt).toBe(0)

    const invoicesCount = sqlite.prepare('SELECT COUNT(*) as cnt FROM invoices WHERE business_id = ?').get(businessId) as { cnt: number }
    expect(invoicesCount.cnt).toBe(0)

    const paymentsCount = sqlite.prepare('SELECT COUNT(*) as cnt FROM payments WHERE business_id = ?').get(businessId) as { cnt: number }
    expect(paymentsCount.cnt).toBe(0)

    const paymentAllocsCount = sqlite.prepare('SELECT COUNT(*) as cnt FROM payment_allocations WHERE business_id = ?').get(businessId) as { cnt: number }
    expect(paymentAllocsCount.cnt).toBe(0)

    const ledgerCount = sqlite.prepare('SELECT COUNT(*) as cnt FROM customer_ledger_transactions WHERE business_id = ?').get(businessId) as { cnt: number }
    expect(ledgerCount.cnt).toBe(0)

    const stockMovementsCount = sqlite.prepare('SELECT COUNT(*) as cnt FROM stock_movements WHERE business_id = ?').get(businessId) as { cnt: number }
    expect(stockMovementsCount.cnt).toBe(0)

    // ASSERT: Stock remains untouched at 10.0
    const stock = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE product_id = ?').get(productId) as { quantity_on_hand: number }
    expect(stock.quantity_on_hand).toBe(10.0)

    // ASSERT: Idempotency key was NOT persisted, permitting clean client retry
    const idemCount = sqlite.prepare('SELECT COUNT(*) as cnt FROM idempotency_keys WHERE business_id = ?').get(businessId) as { cnt: number }
    expect(idemCount.cnt).toBe(0)
  })

  it('allows safe retry with the same idempotency key after transient failure is resolved', async () => {
    let failOnce = true
    const originalBatch = d1.batch.bind(d1)
    d1.batch = async (statements) => {
      if (failOnce) {
        failOnce = false
        sqlite.exec('BEGIN TRANSACTION;')
        sqlite.exec('ROLLBACK;')
        throw new Error('Transient SQLite disk I/O lock')
      }
      return originalBatch(statements)
    }

    const idempotencyKey = 'retry-safe-key-777'
    const salePayload = {
      customerId,
      items: [{ productId, quantity: 1 }],
      payments: [{ method: 'cash', amountMinor: 150000 }],
    }

    // 1st attempt: fails
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
    expect(res1.status).toBe(500)

    // 2nd attempt: succeeds cleanly with same key
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

    // Stock deducted exactly once (10 - 1 = 9)
    const stock = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE product_id = ?').get(productId) as { quantity_on_hand: number }
    expect(stock.quantity_on_hand).toBe(9.0)

    // Exactly 1 sale created
    const salesCount = sqlite.prepare('SELECT COUNT(*) as cnt FROM sales WHERE business_id = ?').get(businessId) as { cnt: number }
    expect(salesCount.cnt).toBe(1)
  })
})

