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

describe('Inventory Reports APIs (Step 12.6)', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const bizId = 'biz_inv_rep'
  const branch1 = 'branch_inv_1'
  const branch2 = 'branch_inv_2'
  const ownerUserId = 'usr_inv_owner'
  let ownerToken: string

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
      VALUES (?, 'BIZINV', 'Inventory Test Store', 'active')
    `).run(bizId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'BR1', 'Main Branch', 1, 'active'),
             (?, ?, 'BR2', 'Warehouse Branch', 0, 'active')
    `).run(branch1, bizId, branch2, bizId)

    // Seed Owner
    sqlite.prepare(`
      INSERT INTO users (id, email, password_hash, name, status)
      VALUES (?, 'owner@inv.pk', 'hash', 'Inventory Owner', 'active')
    `).run(ownerUserId)

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('bm_inv_owner', ?, ?, 'owner', 1)
    `).run(bizId, ownerUserId)

    const sess = await createSession(d1, ownerUserId)
    ownerToken = sess.token

    // Seed Category
    sqlite.prepare(`
      INSERT INTO categories (id, business_id, name, slug, status)
      VALUES ('cat_staples', ?, 'Staples', 'staples', 'active')
    `).run(bizId)

    // Seed Products:
    // 1. Basmati Rice (threshold 10, price 30,000)
    // 2. Cooking Oil (threshold 5, price 50,000)
    // 3. Sugar (threshold 20, price 12,000)
    sqlite.prepare(`
      INSERT INTO products (id, business_id, category_id, sku, name, unit, purchase_price_minor, selling_price_minor, low_stock_threshold, status)
      VALUES
        ('p_rice', ?, 'cat_staples', 'STP-RICE', 'Basmati Rice 5kg', 'pack', 30000, 45000, 10, 'active'),
        ('p_oil', ?, 'cat_staples', 'STP-OIL', 'Canola Oil 1L', 'liter', 50000, 65000, 5, 'active'),
        ('p_sugar', ?, 'cat_staples', 'STP-SUGAR', 'White Sugar 1kg', 'kg', 12000, 16000, 20, 'active')
    `).run(bizId, bizId, bizId)

    // Seed Inventory Balances:
    // Branch 1:
    // Rice: 15.0 (in stock)
    // Oil: 3.0 (low stock, <= 5)
    // Sugar: 0.0 (out of stock, <= 0)
    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand)
      VALUES
        ('ib_r1', ?, ?, 'p_rice', 15.0),
        ('ib_o1', ?, ?, 'p_oil', 3.0),
        ('ib_s1', ?, ?, 'p_sugar', 0.0),
        ('ib_r2', ?, ?, 'p_rice', 40.0)
    `).run(bizId, branch1, bizId, branch1, bizId, branch1, bizId, branch2)
  })

  it('retrieves inventory summary with accurate stock counts and valuation', async () => {
    // For Branch 1:
    // in-stock: 1 (rice = 15 > 10)
    // low-stock: 1 (oil = 3 <= 5 and > 0)
    // out-of-stock: 1 (sugar = 0 <= 0)
    // total qty: 18.0
    // valuation: (15 * 30,000) + (3 * 50,000) = 450,000 + 150,000 = 600,000
    const req = new Request(`http://localhost/api/v1/reports/inventory/summary?branchId=${branch1}`, {
      headers: {
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': bizId,
      },
    })
    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: any }
    const data = json.data

    expect(data.totalTrackedProducts).toBe(3)
    expect(data.inStockCount).toBe(1)
    expect(data.lowStockCount).toBe(1)
    expect(data.outOfStockCount).toBe(1)
    expect(data.totalQuantityOnHand).toBe(18)
    expect(data.totalValuationMinor).toBe(600000)
    expect(data.costMethod).toBe('perpetual_cost_baseline')
  })

  it('retrieves low stock products correctly', async () => {
    const req = new Request(`http://localhost/api/v1/reports/inventory/low-stock?branchId=${branch1}`, {
      headers: {
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': bizId,
      },
    })
    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: any[]; meta: { total: number } }
    expect(json.meta.total).toBe(2) // Sugar (0) and Oil (3)
    expect(json.data.length).toBe(2)
    expect(json.data[0].productName).toBe('White Sugar 1kg') // 0 qty comes first (ASC)
    expect(json.data[0].quantityOnHand).toBe(0)
    expect(json.data[1].productName).toBe('Canola Oil 1L')
    expect(json.data[1].quantityOnHand).toBe(3)
  })

  it('retrieves inventory valuation breakdown', async () => {
    const req = new Request(`http://localhost/api/v1/reports/inventory/valuation?branchId=${branch1}`, {
      headers: {
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': bizId,
      },
    })
    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: any[] }
    expect(json.data.length).toBe(3)
    // Rice has highest valuation: 15 * 30,000 = 450,000
    expect(json.data[0].productName).toBe('Basmati Rice 5kg')
    expect(json.data[0].valuationMinor).toBe(450000)
    // Oil: 3 * 50,000 = 150,000
    expect(json.data[1].productName).toBe('Canola Oil 1L')
    expect(json.data[1].valuationMinor).toBe(150000)
    // Sugar: 0
    expect(json.data[2].productName).toBe('White Sugar 1kg')
    expect(json.data[2].valuationMinor).toBe(0)
  })

  it('tracks and filters inventory movements', async () => {
    // Seed 2 movements
    sqlite.prepare(`
      INSERT INTO stock_movements (
        id, business_id, branch_id, movement_number, product_id, type,
        quantity_change, previous_quantity, new_quantity, unit_cost_minor,
        reference_type, reference_number, business_date_key, created_by
      ) VALUES
        ('mov_1', ?, ?, 'MOV-001', 'p_rice', 'opening_stock', 15.0, 0.0, 15.0, 30000, 'opening_stock', 'OP-1', '2026-11-08', ?),
        ('mov_2', ?, ?, 'MOV-002', 'p_oil', 'purchase_receipt', 3.0, 0.0, 3.0, 50000, 'purchase', 'PO-1', '2026-11-08', ?)
    `).run(bizId, branch1, ownerUserId, bizId, branch1, ownerUserId)

    // Query movements for p_rice
    const req = new Request(`http://localhost/api/v1/reports/inventory/movements?productId=p_rice&fromDate=2026-11-01&toDate=2026-11-30`, {
      headers: {
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': bizId,
      },
    })
    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: any[]; meta: { total: number } }
    expect(json.meta.total).toBe(1)
    expect(json.data[0].productName).toBe('Basmati Rice 5kg')
    expect(json.data[0].type).toBe('opening_stock')
    expect(json.data[0].quantityChange).toBe(15)
  })
})

