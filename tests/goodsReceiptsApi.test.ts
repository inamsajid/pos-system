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

describe('Goods Receipts & Inward Stock APIs', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const businessId = 'biz_gr_test'
  const branchId = 'branch_gr_main'
  const ownerUserId = 'usr_gr_owner'
  const cashierUserId = 'usr_gr_cashier'
  let ownerToken: string
  let cashierToken: string

  const supplierId = 'supp_gr_1'
  const prodAId = 'prod_gr_a'
  const prodBId = 'prod_gr_b'

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
      VALUES (?, 'BIZGR', 'Apex Inward Logistics', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Main Distribution Center', 1, 'active')
    `).run(branchId, businessId)

    // Seed Users (Owner & Cashier)
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'owner@apexgr.pk', 'Warehouse Manager', 'dummy_hash', 'active'),
             (?, 'cashier@apexgr.pk', 'Front Desk', 'dummy_hash', 'active')
    `).run(ownerUserId, cashierUserId)

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_gr_owner', ?, ?, 'owner', 1),
             ('mem_gr_cashier', ?, ?, 'cashier', 1)
    `).run(businessId, ownerUserId, businessId, cashierUserId)

    sqlite.prepare(`
      INSERT INTO member_branches (id, member_id, branch_id)
      VALUES ('mb_gr_cashier', 'mem_gr_cashier', ?)
    `).run(branchId)

    // Seed Supplier
    sqlite.prepare(`
      INSERT INTO suppliers (id, business_id, supplier_code, name, company_name, phone, email, tax_number, opening_payable_minor, status)
      VALUES (?, ?, 'SUPP-GR-01', 'Logitech Distribution', 'Logitech Ltd', '03001112233', 'supply@logitech.pk', 'NTN556677', 0, 'active')
    `).run(supplierId, businessId)

    // Seed Category & Products
    sqlite.prepare(`
      INSERT INTO categories (id, business_id, name, slug)
      VALUES ('cat_gr_1', ?, 'Peripherals', 'peripherals')
    `).run(businessId)

    // Initial product A: unit purchase price Rs 100,000 (Rs 1,000), stock 10
    // Initial product B: unit purchase price Rs 50,000 (Rs 500), stock 0
    sqlite.prepare(`
      INSERT INTO products (id, business_id, category_id, name, sku, unit, purchase_price_minor, selling_price_minor, status)
      VALUES (?, ?, 'cat_gr_1', 'Ergonomic Mouse', 'SKU-ERGO-01', 'piece', 100000, 180000, 'active'),
             (?, ?, 'cat_gr_1', 'Gaming Headset', 'SKU-HEAD-01', 'piece', 50000, 95000, 'active')
    `).run(prodAId, businessId, prodBId, businessId)

    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand)
      VALUES ('bal_gr_a', ?, ?, ?, 10.0),
             ('bal_gr_b', ?, ?, ?, 0.0)
    `).run(businessId, branchId, prodAId, businessId, branchId, prodBId)

    ownerToken = (await createSession(d1, ownerUserId)).token
    cashierToken = (await createSession(d1, cashierUserId)).token
  })

  it('receives full goods against purchase order, updates inventory balances, movements, and posts supplier ledger bill', async () => {
    // 1. Create and Confirm Purchase Order: 20 Headsets @ Rs 50,000 minor = Rs 1,000,000 minor
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
          items: [{ productId: prodBId, orderedQuantity: 20, unitCostMinor: 50000 }],
        }),
      }),
      env,
      executionCtx
    )
    const po = ((await poRes.json()) as { data: { id: string; items: Array<{ id: string }> } }).data
    const poItemId = po.items[0].id

    await worker.fetch(
      new Request(`https://pos.internal/api/v1/purchases/${po.id}/confirm`, {
        method: 'POST',
        headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': businessId },
      }),
      env,
      executionCtx
    )

    // 2. Perform Full Goods Receipt
    const receiptRes = await worker.fetch(
      new Request(`https://pos.internal/api/v1/purchases/${po.id}/receipts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          items: [{ purchaseItemId: poItemId, quantityReceived: 20 }],
          notes: 'Full delivery in good condition',
        }),
      }),
      env,
      executionCtx
    )
    expect(receiptRes.status).toBe(201)
    const receiptJson = (await receiptRes.json()) as { data: { id: string; receiptNumber: string } }
    expect(receiptJson.data.id).toBeTruthy()

    // Verify purchase status updated to 'received'
    const updatedPo = sqlite.prepare('SELECT status FROM purchases WHERE id = ?').get(po.id) as { status: string }
    expect(updatedPo.status).toBe('received')

    // 3. Verify Inventory Balance: Prod B increased from 0 to 20
    const balB = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND product_id = ?').get(businessId, prodBId) as { quantity_on_hand: number }
    expect(balB.quantity_on_hand).toBe(20.0)

    // 4. Verify Stock Movements: 1 movement of type purchase_receipt
    const mov = sqlite.prepare('SELECT * FROM stock_movements WHERE business_id = ? AND product_id = ?').get(businessId, prodBId) as { type: string; quantity_change: number; new_quantity: number }
    expect(mov.type).toBe('purchase_receipt')
    expect(mov.quantity_change).toBe(20.0)
    expect(mov.new_quantity).toBe(20.0)

    // 5. Verify Supplier Ledger: Credited Rs 1,000,000 (type = 'bill')
    const ledger = sqlite.prepare('SELECT * FROM supplier_ledger_transactions WHERE business_id = ? AND supplier_id = ?').get(businessId, supplierId) as { type: string; credit_minor: number; debit_minor: number; balance_minor: number }
    expect(ledger).toBeTruthy()
    expect(ledger.type).toBe('bill')
    expect(ledger.credit_minor).toBe(1000000)
    expect(ledger.debit_minor).toBe(0)
    expect(ledger.balance_minor).toBe(1000000) // Supplier owed 1,000,000
  })

  it('updates product purchase price using perpetual Moving Weighted Average (MWA)', async () => {
    // Current stock: Prod A = 10 units @ Rs 100,000 minor
    // Inward shipment: 10 units @ Rs 150,000 minor
    // Expected MWA = (10 * 100,000 + 10 * 150,000) / 20 = (1,000,000 + 1,500,000) / 20 = 2,500,000 / 20 = 125,000 minor
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
          items: [{ productId: prodAId, orderedQuantity: 10, unitCostMinor: 150000 }],
        }),
      }),
      env,
      executionCtx
    )
    const po = ((await poRes.json()) as { data: { id: string; items: Array<{ id: string }> } }).data

    await worker.fetch(
      new Request(`https://pos.internal/api/v1/purchases/${po.id}/confirm`, {
        method: 'POST',
        headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': businessId },
      }),
      env,
      executionCtx
    )

    const recRes = await worker.fetch(
      new Request(`https://pos.internal/api/v1/purchases/${po.id}/receipts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          items: [{ purchaseItemId: po.items[0].id, quantityReceived: 10, unitCostMinor: 150000 }],
        }),
      }),
      env,
      executionCtx
    )
    expect(recRes.status).toBe(201)

    // Verify branch inventory balance has updated average_cost_minor to 125,000 minor
    const bal = sqlite.prepare('SELECT quantity_on_hand, average_cost_minor FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?').get(businessId, branchId, prodAId) as { quantity_on_hand: number; average_cost_minor: number }
    expect(bal.average_cost_minor).toBe(125000)
    expect(bal.quantity_on_hand).toBe(20.0)
  })

  it('supports partial goods receipts and rejects over-receiving', async () => {
    // 1. Order 30 Headsets
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
          items: [{ productId: prodBId, orderedQuantity: 30, unitCostMinor: 50000 }],
        }),
      }),
      env,
      executionCtx
    )
    const po = ((await poRes.json()) as { data: { id: string; items: Array<{ id: string }> } }).data

    await worker.fetch(
      new Request(`https://pos.internal/api/v1/purchases/${po.id}/confirm`, {
        method: 'POST',
        headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': businessId },
      }),
      env,
      executionCtx
    )

    // 2. First receipt: 10 units -> PO status becomes 'partially_received'
    const rec1Res = await worker.fetch(
      new Request(`https://pos.internal/api/v1/purchases/${po.id}/receipts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          items: [{ purchaseItemId: po.items[0].id, quantityReceived: 10 }],
        }),
      }),
      env,
      executionCtx
    )
    expect(rec1Res.status).toBe(201)
    const updatedPo1 = sqlite.prepare('SELECT status FROM purchases WHERE id = ?').get(po.id) as { status: string }
    expect(updatedPo1.status).toBe('partially_received')

    // 3. Attempt over-receiving: remaining is 20, attempt 25 -> must be rejected with 400
    const overRes = await worker.fetch(
      new Request(`https://pos.internal/api/v1/purchases/${po.id}/receipts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          items: [{ purchaseItemId: po.items[0].id, quantityReceived: 25 }],
        }),
      }),
      env,
      executionCtx
    )
    expect(overRes.status).toBe(400)
    const err = (await overRes.json()) as { error: { message: string } }
    expect(err.error.message).toContain('exceeds remaining')

    // 4. Second receipt: remaining 20 units -> PO status becomes 'received'
    const rec2Res = await worker.fetch(
      new Request(`https://pos.internal/api/v1/purchases/${po.id}/receipts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          items: [{ purchaseItemId: po.items[0].id, quantityReceived: 20 }],
        }),
      }),
      env,
      executionCtx
    )
    expect(rec2Res.status).toBe(201)
    const updatedPo2 = sqlite.prepare('SELECT status FROM purchases WHERE id = ?').get(po.id) as { status: string }
    expect(updatedPo2.status).toBe('received')

    // Total stock in branch is 30
    const balB = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND product_id = ?').get(businessId, prodBId) as { quantity_on_hand: number }
    expect(balB.quantity_on_hand).toBe(30.0)
  })

  it('guarantees idempotency on goods receipt and rejects payload modifications with 409', async () => {
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
          items: [{ productId: prodBId, orderedQuantity: 5, unitCostMinor: 50000 }],
        }),
      }),
      env,
      executionCtx
    )
    const po = ((await poRes.json()) as { data: { id: string; items: Array<{ id: string }> } }).data

    await worker.fetch(
      new Request(`https://pos.internal/api/v1/purchases/${po.id}/confirm`, {
        method: 'POST',
        headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': businessId },
      }),
      env,
      executionCtx
    )

    const idemKey = 'idemp_gr_test_12345'
    const payload1 = {
      items: [{ purchaseItemId: po.items[0].id, quantityReceived: 5 }],
      notes: 'Initial delivery attempt',
    }

    // Call 1: success
    const res1 = await worker.fetch(
      new Request(`https://pos.internal/api/v1/purchases/${po.id}/receipts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
          'Idempotency-Key': idemKey,
        },
        body: JSON.stringify(payload1),
      }),
      env,
      executionCtx
    )
    expect(res1.status).toBe(201)
    const json1 = (await res1.json()) as { data: { id: string; receiptNumber: string } }

    // Call 2: replay identical payload -> returns cached 201 response
    const res2 = await worker.fetch(
      new Request(`https://pos.internal/api/v1/purchases/${po.id}/receipts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
          'Idempotency-Key': idemKey,
        },
        body: JSON.stringify(payload1),
      }),
      env,
      executionCtx
    )
    expect(res2.status).toBe(201)
    const json2 = (await res2.json()) as { data: { id: string; receiptNumber: string } }
    expect(json2.data.id).toBe(json1.data.id)

    // Call 3: same idempotency key with DIFFERENT payload -> 409 Conflict
    const res3 = await worker.fetch(
      new Request(`https://pos.internal/api/v1/purchases/${po.id}/receipts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
          'Idempotency-Key': idemKey,
        },
        body: JSON.stringify({
          items: [{ purchaseItemId: po.items[0].id, quantityReceived: 2 }],
          notes: 'Altered payload',
        }),
      }),
      env,
      executionCtx
    )
    expect(res3.status).toBe(409)
  })

  it('enforces RBAC permissions: cashier cannot receive goods', async () => {
    const res = await worker.fetch(
      new Request('https://pos.internal/api/v1/purchases/dummy_po/receipts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `__session=${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          items: [{ purchaseItemId: 'dummy_item', quantityReceived: 1 }],
        }),
      }),
      env,
      executionCtx
    )
    expect(res.status).toBe(403)
  })
})
