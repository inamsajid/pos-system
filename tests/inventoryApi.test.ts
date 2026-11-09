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

describe('Inventory & Stock Management APIs', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const businessId = 'biz_inv_test'
  const branchId = 'branch_inv_main'
  const branchBId = 'branch_inv_secondary'
  const ownerUserId = 'usr_inv_owner'
  const cashierUserId = 'usr_inv_cashier'
  let ownerToken: string
  let cashierToken: string

  const catId = 'cat_inv_1'
  const prodAId = 'prod_inv_a'
  const prodBId = 'prod_inv_b'

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

    // Seed Business & Branches
    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'BIZINV', 'Apex Inventory Corp', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO business_settings (business_id, allow_negative_stock)
      VALUES (?, 0)
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Main Warehouse', 1, 'active'),
             (?, ?, 'SEC', 'Secondary Store', 0, 'active')
    `).run(branchId, businessId, branchBId, businessId)

    // Seed Owner
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'owner@apexinv.pk', 'Inventory Director', 'dummy_hash', 'active')
    `).run(ownerUserId)
    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_inv_owner', ?, ?, 'owner', 1)
    `).run(businessId, ownerUserId)

    // Seed Cashier
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'cashier@apexinv.pk', 'Front Desk', 'dummy_hash', 'active')
    `).run(cashierUserId)
    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_inv_cashier', ?, ?, 'cashier', 1)
    `).run(businessId, cashierUserId)
    sqlite.prepare(`
      INSERT INTO member_branches (id, member_id, branch_id)
      VALUES ('mb_inv_cashier', 'mem_inv_cashier', ?)
    `).run(branchId)

    // Seed Category & Products
    sqlite.prepare(`
      INSERT INTO categories (id, business_id, name, slug)
      VALUES (?, ?, 'Electronics', 'electronics')
    `).run(catId, businessId)

    sqlite.prepare(`
      INSERT INTO products (id, business_id, category_id, name, sku, barcode, unit, purchase_price_minor, selling_price_minor, status)
      VALUES (?, ?, ?, 'USB Wireless Mouse', 'SKU-MOUSE-01', '10000001', 'piece', 100000, 150000, 'active'),
             (?, ?, ?, 'Mechanical Keyboard', 'SKU-KEY-01', '10000002', 'piece', 300000, 450000, 'active')
    `).run(prodAId, businessId, catId, prodBId, businessId, catId)

    // Seed Initial Balances: Mouse = 50 in Main, Keyboard = 20 in Main, 10 in Secondary
    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand)
      VALUES ('bal_1', ?, ?, ?, 50.0),
             ('bal_2', ?, ?, ?, 20.0),
             ('bal_3', ?, ?, ?, 10.0)
    `).run(businessId, branchId, prodAId, businessId, branchId, prodBId, businessId, branchBId, prodBId)

    // Create Sessions
    const ownerSession = await createSession(d1, ownerUserId)
    ownerToken = ownerSession.token

    const cashierSession = await createSession(d1, cashierUserId)
    cashierToken = cashierSession.token
  })

  it('lists inventory balances with branch filtering and retrieves product specific balances', async () => {
    // 1. List for Main branch
    const req = new Request('https://pos.internal/api/v1/inventory/balances?branchId=' + branchId, {
      method: 'GET',
      headers: {
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': businessId,
        'X-Branch-Id': branchId,
      },
    })
    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: Array<{ productId: string; quantityOnHand: number }>; meta: { total: number } }
    expect(json.data.length).toBe(2)
    const mouse = json.data.find((b) => b.productId === prodAId)
    expect(mouse?.quantityOnHand).toBe(50)

    // 2. Lookup single product across authorized branches
    const reqProd = new Request(`https://pos.internal/api/v1/inventory/balances/${prodBId}`, {
      method: 'GET',
      headers: {
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': businessId,
      },
    })
    const resProd = await worker.fetch(reqProd, env, executionCtx)
    expect(resProd.status).toBe(200)
    const jsonProd = (await resProd.json()) as { data: Array<{ branchId: string; quantityOnHand: number }> }
    expect(jsonProd.data.length).toBe(2) // Main (20) and Secondary (10)
  })

  it('records a positive manual stock adjustment and creates an audit movement', async () => {
    const adjustPayload = {
      productId: prodAId,
      type: 'adjustment_in',
      quantityChange: 15.0,
      reason: 'found',
      notes: 'Audit adjustment #101',
    }

    const req = new Request('https://pos.internal/api/v1/inventory/adjustments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': businessId,
        'X-Branch-Id': branchId,
      },
      body: JSON.stringify(adjustPayload),
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(201)
    const json = (await res.json()) as { data: { previousQuantity: number; newQuantity: number; quantityChange: number } }
    expect(json.data.previousQuantity).toBe(50.0)
    expect(json.data.quantityChange).toBe(15.0)
    expect(json.data.newQuantity).toBe(65.0)

    // Verify DB state
    const bal = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?').get(businessId, branchId, prodAId) as { quantity_on_hand: number }
    expect(bal.quantity_on_hand).toBe(65.0)

    const mov = sqlite.prepare('SELECT * FROM stock_movements WHERE business_id = ? AND product_id = ? AND type = ?').get(businessId, prodAId, 'adjustment_in') as { quantity_change: number; new_quantity: number }
    expect(mov).toBeTruthy()
    expect(mov.quantity_change).toBe(15.0)
    expect(mov.new_quantity).toBe(65.0)
  })

  it('rejects negative stock adjustment if allow_negative_stock=0 and resulting balance would be negative', async () => {
    const adjustPayload = {
      productId: prodAId,
      type: 'adjustment_out',
      quantityChange: 60.0, // Current stock is 50 -> would be -10
      reason: 'damaged',
    }

    const req = new Request('https://pos.internal/api/v1/inventory/adjustments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': businessId,
        'X-Branch-Id': branchId,
      },
      body: JSON.stringify(adjustPayload),
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect([400, 422]).toContain(res.status)
    const err = (await res.json()) as { error: { message: string } }
    expect(err.error.message).toContain('Insufficient stock')

    // Verify DB balance was NOT modified
    const bal = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?').get(businessId, branchId, prodAId) as { quantity_on_hand: number }
    expect(bal.quantity_on_hand).toBe(50.0)
  })

  it('creates draft stock count sheet with zero immediate balance mutation', async () => {
    const countPayload = {
      name: 'End of month cycle count',
      notes: 'End of month cycle count',
      items: [
        { productId: prodAId, physicalQuantity: 48.0 }, // Expected 50, variance -2
        { productId: prodBId, physicalQuantity: 20.0 }, // Expected 20, variance 0
      ],
    }

    const req = new Request('https://pos.internal/api/v1/inventory/counts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': businessId,
        'X-Branch-Id': branchId,
      },
      body: JSON.stringify(countPayload),
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(201)
    const json = (await res.json()) as { data: { id: string; status: string; items: Array<{ productId: string; systemQuantity: number; physicalQuantity: number; variance: number }> } }
    expect(json.data.status).toBe('draft')
    expect(json.data.items.length).toBe(2)

    const mouseItem = json.data.items.find((i) => i.productId === prodAId)
    expect(mouseItem?.systemQuantity).toBe(50.0)
    expect(mouseItem?.physicalQuantity).toBe(48.0)
    expect(mouseItem?.variance).toBe(-2.0)

    // CRITICAL: Verify NO changes occurred in inventory_balances and NO stock_movements inserted
    const bal = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?').get(businessId, branchId, prodAId) as { quantity_on_hand: number }
    expect(bal.quantity_on_hand).toBe(50.0)

    const movementsCount = sqlite.prepare('SELECT COUNT(*) as cnt FROM stock_movements WHERE business_id = ?').get(businessId) as { cnt: number }
    expect(movementsCount.cnt).toBe(0)
  })

  it('completes stock count and reconciles variance by generating stock_count_adjustment movements', async () => {
    // 1. Create Count Sheet
    const countPayload = {
      name: 'Variance reconciliation count',
      items: [
        { productId: prodAId, physicalQuantity: 47.0 }, // Variance -3
        { productId: prodBId, physicalQuantity: 20.0 }, // Variance 0
      ],
    }

    const createReq = new Request('https://pos.internal/api/v1/inventory/counts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': businessId,
        'X-Branch-Id': branchId,
      },
      body: JSON.stringify(countPayload),
    })
    const createRes = await worker.fetch(createReq, env, executionCtx)
    const createJson = (await createRes.json()) as { data: { id: string } }
    const countId = createJson.data.id

    // 2. Complete / Confirm Count
    const completeReq = new Request(`https://pos.internal/api/v1/inventory/counts/${countId}/complete`, {
      method: 'POST',
      headers: {
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': businessId,
        'X-Branch-Id': branchId,
      },
    })
    const completeRes = await worker.fetch(completeReq, env, executionCtx)
    expect(completeRes.status).toBe(200)
    const completeJson = (await completeRes.json()) as { data: { status: string } }
    expect(completeJson.data.status).toBe('confirmed')

    // 3. Verify mouse balance reconciled to 47.0
    const balA = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?').get(businessId, branchId, prodAId) as { quantity_on_hand: number }
    expect(balA.quantity_on_hand).toBe(47.0)

    // 4. Verify keyboard balance remains 20.0
    const balB = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?').get(businessId, branchId, prodBId) as { quantity_on_hand: number }
    expect(balB.quantity_on_hand).toBe(20.0)

    // 5. Verify movements: only prodA with variance -3 generated a movement of type stock_count_adjustment
    const movements = sqlite.prepare('SELECT * FROM stock_movements WHERE business_id = ?').all(businessId) as Array<{ product_id: string; type: string; quantity_change: number; new_quantity: number }>
    expect(movements.length).toBe(1)
    expect(movements[0].product_id).toBe(prodAId)
    expect(movements[0].type).toBe('stock_count_adjustment')
    expect(movements[0].quantity_change).toBe(-3.0)
    expect(movements[0].new_quantity).toBe(47.0)

    // 6. Completing again should be rejected with 400
    const secondReq = new Request(`https://pos.internal/api/v1/inventory/counts/${countId}/complete`, {
      method: 'POST',
      headers: {
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': businessId,
        'X-Branch-Id': branchId,
      },
    })
    const secondRes = await worker.fetch(secondReq, env, executionCtx)
    expect(secondRes.status).toBe(400)
  })

  it('enforces RBAC permissions: cashier cannot make stock adjustments or confirm stocktakes', async () => {
    // Attempt stock adjustment as cashier
    const adjustReq = new Request('https://pos.internal/api/v1/inventory/adjustments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `__session=${cashierToken}`,
        'X-Business-Id': businessId,
        'X-Branch-Id': branchId,
      },
      body: JSON.stringify({
        productId: prodAId,
        quantityChange: 5,
        reason: 'Unauthorized adjustment',
      }),
    })
    const adjustRes = await worker.fetch(adjustReq, env, executionCtx)
    expect(adjustRes.status).toBe(403)

    // Attempt stocktake completion as cashier
    const countReq = new Request('https://pos.internal/api/v1/inventory/counts/dummy_count/complete', {
      method: 'POST',
      headers: {
        Cookie: `__session=${cashierToken}`,
        'X-Business-Id': businessId,
        'X-Branch-Id': branchId,
      },
    })
    const countRes = await worker.fetch(countReq, env, executionCtx)
    expect(countRes.status).toBe(403)
  })
})
