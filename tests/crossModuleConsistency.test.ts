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

describe('Cross-Module Consistency & Full Business Lifecycle (12.3 -> 12.4 -> 12.5)', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const businessId = 'biz_cross_test'
  const branchId = 'branch_cross_main'
  const ownerUserId = 'usr_cross_owner'
  let ownerToken: string

  const supplierId = 'supp_cross_1'
  const customerId = 'cust_cross_1'
  const categoryId = 'cat_cross_1'

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
      VALUES (?, 'BIZCR', 'Apex Cross-Lifecycle Retailer', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Flagship Outlet', 1, 'active')
    `).run(branchId, businessId)

    // Seed Owner User
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'director@apexcross.pk', 'General Manager', 'dummy_hash', 'active')
    `).run(ownerUserId)

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_cross_owner', ?, ?, 'owner', 1)
    `).run(businessId, ownerUserId)

    // Seed Supplier
    sqlite.prepare(`
      INSERT INTO suppliers (id, business_id, supplier_code, name, company_name, phone, email, status)
      VALUES (?, ?, 'SUPP-MAIN', 'National Wholesaler', 'National Ltd', '03001234000', 'orders@national.pk', 'active')
    `).run(supplierId, businessId)

    // Seed Customer
    sqlite.prepare(`
      INSERT INTO customers (id, business_id, customer_code, name, phone, email, credit_limit_minor, status)
      VALUES (?, ?, 'CUST-001', 'Loyal Retail Buyer', '03219876543', 'buyer@gmail.com', 5000000, 'active')
    `).run(customerId, businessId)

    // Seed Category
    sqlite.prepare(`
      INSERT INTO categories (id, business_id, name, slug)
      VALUES (?, ?, 'Beverages', 'beverages')
    `).run(categoryId, businessId)

    ownerToken = (await createSession(d1, ownerUserId)).token
  })

  it('completes full purchase -> receive -> sale -> payment -> supplier ledger lifecycle with mathematical precision', async () => {
    // 1. Step 12.3: Create Product via API
    const prodRes = await worker.fetch(
      new Request('https://pos.internal/api/v1/products', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
        },
        body: JSON.stringify({
          categoryId,
          name: 'Premium Roasted Coffee 500g',
          sku: 'SKU-COFFEE-500',
          barcode: '8964000001',
          unit: 'piece',
          purchasePriceMinor: 100000, // Rs 1,000
          sellingPriceMinor: 150000, // Rs 1,500
          lowStockThreshold: 5,
        }),
      }),
      env,
      executionCtx
    )
    expect(prodRes.status).toBe(201)
    const product = ((await prodRes.json()) as { data: { id: string } }).data
    const productId = product.id

    // Check initial stock is 0
    const bal0 = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND product_id = ?').get(businessId, productId) as { quantity_on_hand: number } | undefined
    expect(bal0?.quantity_on_hand ?? 0).toBe(0)

    // 2. Step 12.5: Create Purchase Order for 50 units @ Rs 1,000 minor = Rs 5,000,000 minor
    const poRes = await worker.fetch(
      new Request('https://pos.internal/api/v1/purchases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          supplierId,
          items: [{ productId, orderedQuantity: 50, unitCostMinor: 100000 }],
        }),
      }),
      env,
      executionCtx
    )
    expect(poRes.status).toBe(201)
    const po = ((await poRes.json()) as { data: { id: string; items: Array<{ id: string }> } }).data
    const poItemId = po.items[0].id

    // Confirm PO
    const confRes = await worker.fetch(
      new Request(`https://pos.internal/api/v1/purchases/${po.id}/confirm`, {
        method: 'POST',
        headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': businessId },
      }),
      env,
      executionCtx
    )
    expect(confRes.status).toBe(200)

    // Verify stock is STILL 0 after confirmation
    const balAfterConfirm = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND product_id = ?').get(businessId, productId) as { quantity_on_hand: number } | undefined
    expect(balAfterConfirm?.quantity_on_hand ?? 0).toBe(0)

    // 3. Step 12.5: Partial Goods Receipt of 30 units
    const gr1Res = await worker.fetch(
      new Request(`https://pos.internal/api/v1/purchases/${po.id}/receipts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          items: [{ purchaseItemId: poItemId, quantityReceived: 30 }],
        }),
      }),
      env,
      executionCtx
    )
    expect(gr1Res.status).toBe(201)

    // Stock becomes 30
    const balAfterGr1 = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND product_id = ?').get(businessId, productId) as { quantity_on_hand: number }
    expect(balAfterGr1.quantity_on_hand).toBe(30)

    // Supplier Ledger credited Rs 3,000,000 (30 * 100,000)
    const slt1 = sqlite.prepare('SELECT balance_minor FROM supplier_ledger_transactions WHERE business_id = ? AND supplier_id = ? ORDER BY rowid DESC LIMIT 1').get(businessId, supplierId) as { balance_minor: number }
    expect(slt1.balance_minor).toBe(3000000)

    // 4. Step 12.4: POS Sale of 10 units @ Rs 1,500 minor = Rs 1,500,000 minor
    const saleRes = await worker.fetch(
      new Request('https://pos.internal/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          customerId,
          items: [{ productId, quantity: 10, unitPriceMinor: 150000 }],
          paymentMethods: [{ method: 'cash', amountMinor: 1500000 }],
        }),
      }),
      env,
      executionCtx
    )
    expect(saleRes.status).toBe(201)

    // Stock decreases by 10: 30 - 10 = 20
    const balAfterSale = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND product_id = ?').get(businessId, productId) as { quantity_on_hand: number }
    expect(balAfterSale.quantity_on_hand).toBe(20)

    // 5. Step 12.5: Receive remaining 20 units @ Rs 120,000 minor
    const gr2Res = await worker.fetch(
      new Request(`https://pos.internal/api/v1/purchases/${po.id}/receipts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          items: [{ purchaseItemId: poItemId, quantityReceived: 20, unitCostMinor: 120000 }],
        }),
      }),
      env,
      executionCtx
    )
    expect(gr2Res.status).toBe(201)

    // Stock becomes 20 + 20 = 40
    const balAfterGr2 = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND product_id = ?').get(businessId, productId) as { quantity_on_hand: number }
    expect(balAfterGr2.quantity_on_hand).toBe(40)

    // PO status becomes 'received'
    const poStatus = sqlite.prepare('SELECT status FROM purchases WHERE id = ?').get(po.id) as { status: string }
    expect(poStatus.status).toBe('received')

    // Supplier Ledger credited 20 * 100,000 = 2,000,000 -> Running balance = 3,000,000 + 2,000,000 = 5,000,000
    const slt2 = sqlite.prepare('SELECT balance_minor FROM supplier_ledger_transactions WHERE business_id = ? AND supplier_id = ? ORDER BY rowid DESC LIMIT 1').get(businessId, supplierId) as { balance_minor: number }
    expect(slt2.balance_minor).toBe(5000000)

    // 6. Step 12.5: Supplier Payment of Rs 6,000,000: Rs 5,000,000 settling PO, Rs 1,000,000 unallocated advance
    const payRes = await worker.fetch(
      new Request('https://pos.internal/api/v1/supplier-payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          supplierId,
          amountMinor: 6000000,
          method: 'bank_transfer',
          allocations: [{ purchaseId: po.id, amountMinor: 5000000 }], // PO total was 5,000,000
        }),
      }),
      env,
      executionCtx
    )
    expect(payRes.status).toBe(201)
    const payment = ((await payRes.json()) as { data: { id: string; unallocatedAmountMinor: number } }).data
    expect(payment.unallocatedAmountMinor).toBe(1000000) // 6,000,000 - 5,000,000 = 1,000,000 unallocated advance

    // Ledger debited 6,000,000: 5,000,000 - 6,000,000 = -1,000,000
    const slt3 = sqlite.prepare('SELECT balance_minor FROM supplier_ledger_transactions WHERE business_id = ? AND supplier_id = ? ORDER BY rowid DESC LIMIT 1').get(businessId, supplierId) as { balance_minor: number }
    expect(slt3.balance_minor).toBe(-1000000)

    // 7. Verify Statement & Summary
    const stmtRes = await worker.fetch(
      new Request(`https://pos.internal/api/v1/suppliers/${supplierId}/ledger`, {
        method: 'GET',
        headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': businessId },
      }),
      env,
      executionCtx
    )
    expect(stmtRes.status).toBe(200)
    const stmt = ((await stmtRes.json()) as { data: { closingBalanceMinor: number; entries: unknown[] } }).data
    expect(stmt.closingBalanceMinor).toBe(-1000000)
    expect(stmt.entries.length).toBe(3) // 2 bills + 1 payment
  })
})
