import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import worker from '../worker/src/index'
import type { Env } from '../worker/src/types/environment'
import { generateId } from '../worker/src/auth/crypto'
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

describe('Products API (/api/v1/products)', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const ownerUserId = 'usr_owner_prod'
  const cashierUserId = 'usr_cashier_prod'
  const businessId = 'biz_prod_test'
  const branchId = 'branch_prod_test'
  let ownerToken: string
  let cashierToken: string
  let testCategoryId: string

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
      VALUES (?, 'BIZPROD', 'Northstar Products Store', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Main Store', 1, 'active')
    `).run(branchId, businessId)

    // Seed Owner
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'owner@prod.pk', 'Owner User', 'dummy_hash', 'active')
    `).run(ownerUserId)

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_owner_prod', ?, ?, 'owner', 1)
    `).run(businessId, ownerUserId)

    // Seed Cashier
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'cashier@prod.pk', 'Cashier User', 'dummy_hash', 'active')
    `).run(cashierUserId)

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_cashier_prod', ?, ?, 'cashier', 1)
    `).run(businessId, cashierUserId)

    // Seed Category
    testCategoryId = 'cat_grocery_prod'
    sqlite.prepare(`
      INSERT INTO categories (id, business_id, name, slug, status)
      VALUES (?, ?, 'Grocery', 'grocery', 'active')
    `).run(testCategoryId, businessId)

    const ownerSession = await createSession(d1, ownerUserId)
    ownerToken = ownerSession.token

    const cashierSession = await createSession(d1, cashierUserId)
    cashierToken = cashierSession.token
  })

  function authRequest(
    method: string,
    path: string,
    token: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {}
  ): Request {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Origin: 'http://localhost:5173',
      'X-Business-Id': businessId,
      ...extraHeaders,
    }

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }

    return new Request(`http://localhost:8787${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  it('creates product with valid integer minor amounts and returns ProductDTO', async () => {
    const req = authRequest('POST', '/api/v1/products', ownerToken, {
      name: 'Premium Basmati Rice 5kg',
      sku: 'SKU-RICE-05KG',
      barcode: '8964000123456',
      categoryId: testCategoryId,
      unit: 'kg',
      purchasePriceMinor: 120000, // PKR 1,200.00
      sellingPriceMinor: 155000,  // PKR 1,550.00
      lowStockThreshold: 10,
      trackInventory: true,
    })
    const res = await worker.fetch(req, env, executionCtx)

    expect(res.status).toBe(201)
    const json = (await res.json()) as { success: boolean; data: { id: string; name: string; sku: string; sellingPriceMinor: number; purchasePriceMinor: number; stockQuantity: number } }
    expect(json.success).toBe(true)
    expect(json.data.name).toBe('Premium Basmati Rice 5kg')
    expect(json.data.sku).toBe('SKU-RICE-05KG')
    expect(json.data.sellingPriceMinor).toBe(155000)
    expect(json.data.purchasePriceMinor).toBe(120000)
    expect(json.data.stockQuantity).toBe(0) // 0 stock on creation

    // Check DB record directly
    const stored = sqlite.prepare('SELECT * FROM products WHERE id = ?').get(json.data.id) as { selling_price_minor: number }
    expect(stored.selling_price_minor).toBe(155000)
  })

  it('lists products with pagination metadata, category names, and computed stock', async () => {
    // Seed two products
    const prod1 = generateId()
    const prod2 = generateId()

    sqlite.prepare(`
      INSERT INTO products (id, business_id, category_id, sku, barcode, name, unit, purchase_price_minor, selling_price_minor, track_inventory, status)
      VALUES (?, ?, ?, 'SKU-A', '111111', 'Product Alpha', 'piece', 5000, 8000, 1, 'active')
    `).run(prod1, businessId, testCategoryId)

    sqlite.prepare(`
      INSERT INTO products (id, business_id, category_id, sku, barcode, name, unit, purchase_price_minor, selling_price_minor, track_inventory, status)
      VALUES (?, ?, ?, 'SKU-B', '222222', 'Product Beta', 'kg', 10000, 15000, 1, 'active')
    `).run(prod2, businessId, testCategoryId)

    // Seed stock for prod1
    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand)
      VALUES ('bal-prod1', ?, ?, ?, 42)
    `).run(businessId, branchId, prod1)

    const req = authRequest('GET', '/api/v1/products?page=1&limit=10', ownerToken)
    const res = await worker.fetch(req, env, executionCtx)

    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      success: boolean
      data: Array<{ id: string; name: string; categoryName: string; stockQuantity: number }>
      meta: { page: number; limit: number; totalCount: number; totalPages: number; hasNextPage: boolean }
    }
    expect(json.success).toBe(true)
    expect(json.data.length).toBe(2)
    expect(json.meta.totalCount).toBe(2)
    expect(json.meta.totalPages).toBe(1)
    expect(json.meta.hasNextPage).toBe(false)

    const alpha = json.data.find((p) => p.name === 'Product Alpha')
    expect(alpha).toBeDefined()
    expect(alpha!.categoryName).toBe('Grocery')
    expect(alpha!.stockQuantity).toBe(42)
  })

  it('searches products by name, SKU, and barcode accurately', async () => {
    sqlite.prepare(`
      INSERT INTO products (id, business_id, category_id, sku, barcode, name, unit, purchase_price_minor, selling_price_minor, status)
      VALUES ('p-tea', ?, ?, 'SKU-TEA-01', '778899', 'Tapal Danedar Tea', 'pack', 20000, 25000, 'active')
    `).run(businessId, testCategoryId)

    // Search by name query
    const reqName = authRequest('GET', '/api/v1/products?search=Tapal', ownerToken)
    const resName = await worker.fetch(reqName, env, executionCtx)
    const jsonName = (await resName.json()) as { data: Array<{ name: string }> }
    expect(jsonName.data.length).toBe(1)
    expect(jsonName.data[0].name).toBe('Tapal Danedar Tea')

    // Search by SKU query
    const reqSku = authRequest('GET', '/api/v1/products?search=SKU-TEA', ownerToken)
    const resSku = await worker.fetch(reqSku, env, executionCtx)
    const jsonSku = (await resSku.json()) as { data: Array<{ name: string }> }
    expect(jsonSku.data.length).toBe(1)

    // Search by Barcode query
    const reqBarcode = authRequest('GET', '/api/v1/products?search=778899', ownerToken)
    const resBarcode = await worker.fetch(reqBarcode, env, executionCtx)
    const jsonBarcode = (await resBarcode.json()) as { data: Array<{ name: string }> }
    expect(jsonBarcode.data.length).toBe(1)
  })

  it('filters products by low-stock threshold', async () => {
    const prodLow = generateId()
    const prodOk = generateId()

    sqlite.prepare(`
      INSERT INTO products (id, business_id, category_id, sku, name, unit, purchase_price_minor, selling_price_minor, low_stock_threshold, track_inventory, status)
      VALUES (?, ?, ?, 'SKU-LOW', 'Low Item', 'piece', 100, 200, 5.0, 1, 'active')
    `).run(prodLow, businessId, testCategoryId)

    sqlite.prepare(`
      INSERT INTO products (id, business_id, category_id, sku, name, unit, purchase_price_minor, selling_price_minor, low_stock_threshold, track_inventory, status)
      VALUES (?, ?, ?, 'SKU-OK', 'Stocked Item', 'piece', 100, 200, 5.0, 1, 'active')
    `).run(prodOk, businessId, testCategoryId)

    // Low item has 2 on hand (<= 5 threshold)
    sqlite.prepare(`INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand) VALUES ('b-low', ?, ?, ?, 2)`).run(businessId, branchId, prodLow)
    // Ok item has 50 on hand (> 5 threshold)
    sqlite.prepare(`INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand) VALUES ('b-ok', ?, ?, ?, 50)`).run(businessId, branchId, prodOk)

    const req = authRequest('GET', '/api/v1/products?lowStock=true', ownerToken)
    const res = await worker.fetch(req, env, executionCtx)
    const json = (await res.json()) as { data: Array<{ name: string }> }

    expect(json.data.length).toBe(1)
    expect(json.data[0].name).toBe('Low Item')
  })

  it('rejects invalid product input: missing required fields, negative prices, invalid unit', async () => {
    // 1. Negative price
    const req1 = authRequest('POST', '/api/v1/products', ownerToken, {
      name: 'Invalid Price Product',
      sku: 'SKU-NEG',
      unit: 'piece',
      sellingPriceMinor: -500,
      purchasePriceMinor: 1000,
    })
    const res1 = await worker.fetch(req1, env, executionCtx)
    expect(res1.status).toBe(400)

    // 2. Invalid unit
    const req2 = authRequest('POST', '/api/v1/products', ownerToken, {
      name: 'Invalid Unit Product',
      sku: 'SKU-UNIT',
      unit: 'bottle', // Not in approved enum
      sellingPriceMinor: 500,
      purchasePriceMinor: 300,
    })
    const res2 = await worker.fetch(req2, env, executionCtx)
    expect(res2.status).toBe(400)

    // 3. Empty SKU
    const req3 = authRequest('POST', '/api/v1/products', ownerToken, {
      name: 'Empty SKU Product',
      sku: '',
      unit: 'piece',
      sellingPriceMinor: 500,
      purchasePriceMinor: 300,
    })
    const res3 = await worker.fetch(req3, env, executionCtx)
    expect(res3.status).toBe(400)
  })

  it('rejects duplicate SKU within the same business with 409 Conflict', async () => {
    sqlite.prepare(`
      INSERT INTO products (id, business_id, category_id, sku, name, unit, purchase_price_minor, selling_price_minor)
      VALUES ('p-dup-1', ?, ?, 'SKU-UNIQUE-01', 'First Product', 'piece', 500, 1000)
    `).run(businessId, testCategoryId)

    const req = authRequest('POST', '/api/v1/products', ownerToken, {
      name: 'Second Product With Same SKU',
      sku: 'sku-unique-01', // case-insensitive match
      unit: 'piece',
      sellingPriceMinor: 1000,
      purchasePriceMinor: 500,
    })
    const res = await worker.fetch(req, env, executionCtx)

    expect(res.status).toBe(409)
    const json = (await res.json()) as { success: boolean; error: { code: string } }
    expect(json.error.code).toBe('CONFLICT')
  })

  it('rejects duplicate Barcode within the same business with 409 Conflict', async () => {
    sqlite.prepare(`
      INSERT INTO products (id, business_id, category_id, sku, barcode, name, unit, purchase_price_minor, selling_price_minor)
      VALUES ('p-bar-1', ?, ?, 'SKU-BAR-01', 'BAR-889900', 'Barcode Product 1', 'piece', 500, 1000)
    `).run(businessId, testCategoryId)

    const req = authRequest('POST', '/api/v1/products', ownerToken, {
      name: 'Barcode Product 2',
      sku: 'SKU-BAR-02',
      barcode: 'BAR-889900',
      unit: 'piece',
      sellingPriceMinor: 1000,
      purchasePriceMinor: 500,
    })
    const res = await worker.fetch(req, env, executionCtx)

    expect(res.status).toBe(409)
    const json = (await res.json()) as { success: boolean; error: { code: string } }
    expect(json.error.code).toBe('CONFLICT')
  })

  it('rejects category ID belonging to another business with 400 Bad Request', async () => {
    // Seed foreign business & category
    const foreignBizId = 'biz_foreign_cat'
    sqlite.prepare(`INSERT INTO businesses (id, business_code, name) VALUES (?, 'FORBIZ', 'Foreign Business')`).run(foreignBizId)
    const foreignCatId = 'cat_foreign_1'
    sqlite.prepare(`INSERT INTO categories (id, business_id, name, slug) VALUES (?, ?, 'Foreign Cat', 'foreign-cat')`).run(foreignCatId, foreignBizId)

    const req = authRequest('POST', '/api/v1/products', ownerToken, {
      name: 'Cross Tenant Category Attempt',
      sku: 'SKU-CROSS-CAT',
      categoryId: foreignCatId, // Belongs to foreignBizId!
      unit: 'piece',
      sellingPriceMinor: 1000,
      purchasePriceMinor: 500,
    })
    const res = await worker.fetch(req, env, executionCtx)

    expect(res.status).toBe(400)
    const json = (await res.json()) as { success: boolean; error: { message: string } }
    expect(json.error.message).toContain('Category does not exist or belongs to another business')
  })

  it('fetches a single product by ID, returning 404 for missing product', async () => {
    const prodId = 'prod-single-test'
    sqlite.prepare(`
      INSERT INTO products (id, business_id, category_id, sku, name, unit, purchase_price_minor, selling_price_minor)
      VALUES (?, ?, ?, 'SKU-SINGLE', 'Single Test Product', 'piece', 1000, 1500)
    `).run(prodId, businessId, testCategoryId)

    // Valid fetch
    const reqOk = authRequest('GET', `/api/v1/products/${prodId}`, ownerToken)
    const resOk = await worker.fetch(reqOk, env, executionCtx)
    expect(resOk.status).toBe(200)
    const jsonOk = (await resOk.json()) as { data: { name: string } }
    expect(jsonOk.data.name).toBe('Single Test Product')

    // Missing fetch
    const reqMissing = authRequest('GET', '/api/v1/products/prod-does-not-exist', ownerToken)
    const resMissing = await worker.fetch(reqMissing, env, executionCtx)
    expect(resMissing.status).toBe(404)
  })

  it('updates product fields and soft-archives via DELETE', async () => {
    const prodId = 'prod-patch-archive'
    sqlite.prepare(`
      INSERT INTO products (id, business_id, category_id, sku, name, unit, purchase_price_minor, selling_price_minor, status)
      VALUES (?, ?, ?, 'SKU-PATCH', 'Original Name', 'piece', 1000, 1500, 'active')
    `).run(prodId, businessId, testCategoryId)

    // 1. PATCH
    const reqPatch = authRequest('PATCH', `/api/v1/products/${prodId}`, ownerToken, {
      name: 'Updated Name Via Patch',
      sellingPriceMinor: 2000,
    })
    const resPatch = await worker.fetch(reqPatch, env, executionCtx)
    expect(resPatch.status).toBe(200)
    const jsonPatch = (await resPatch.json()) as { data: { name: string; sellingPriceMinor: number } }
    expect(jsonPatch.data.name).toBe('Updated Name Via Patch')
    expect(jsonPatch.data.sellingPriceMinor).toBe(2000)

    // 2. DELETE (soft archive)
    const reqDelete = authRequest('DELETE', `/api/v1/products/${prodId}`, ownerToken)
    const resDelete = await worker.fetch(reqDelete, env, executionCtx)
    expect(resDelete.status).toBe(200)

    const stored = sqlite.prepare('SELECT status FROM products WHERE id = ?').get(prodId) as { status: string }
    expect(stored.status).toBe('archived')
  })

  it('CRITICAL: Product operations (create, update, archive) NEVER create inventory movements or alter stock', async () => {
    // Check initial stock_movements count
    const initialMovCount = (sqlite.prepare('SELECT COUNT(*) as count FROM stock_movements').get() as { count: number }).count
    const initialBalCount = (sqlite.prepare('SELECT COUNT(*) as count FROM inventory_balances').get() as { count: number }).count

    // 1. Create product
    const reqCreate = authRequest('POST', '/api/v1/products', ownerToken, {
      name: 'Invariance Check Product',
      sku: 'SKU-INVARIANCE',
      unit: 'piece',
      sellingPriceMinor: 1000,
      purchasePriceMinor: 500,
    })
    const resCreate = await worker.fetch(reqCreate, env, executionCtx)
    expect(resCreate.status).toBe(201)
    const createdId = ((await resCreate.json()) as { data: { id: string } }).data.id

    // 2. Update product
    const reqUpdate = authRequest('PATCH', `/api/v1/products/${createdId}`, ownerToken, {
      name: 'Invariance Check Product Updated',
      sellingPriceMinor: 1200,
    })
    const resUpdate = await worker.fetch(reqUpdate, env, executionCtx)
    expect(resUpdate.status).toBe(200)

    // 3. Archive product
    const reqArchive = authRequest('DELETE', `/api/v1/products/${createdId}`, ownerToken)
    const resArchive = await worker.fetch(reqArchive, env, executionCtx)
    expect(resArchive.status).toBe(200)

    // Assert that stock movements and inventory balances remain completely untouched!
    const finalMovCount = (sqlite.prepare('SELECT COUNT(*) as count FROM stock_movements').get() as { count: number }).count
    const finalBalCount = (sqlite.prepare('SELECT COUNT(*) as count FROM inventory_balances').get() as { count: number }).count

    expect(finalMovCount).toBe(initialMovCount)
    expect(finalBalCount).toBe(initialBalCount)
  })

  it('enforces RBAC: Cashier can read products but CANNOT create, update, or archive', async () => {
    // 1. Read: Cashier can list products (200 OK)
    const reqRead = authRequest('GET', '/api/v1/products', cashierToken)
    const resRead = await worker.fetch(reqRead, env, executionCtx)
    expect(resRead.status).toBe(200)

    // 2. Write: Cashier cannot create product (403 Forbidden)
    const reqCreate = authRequest('POST', '/api/v1/products', cashierToken, {
      name: 'Cashier Forbidden Prod',
      sku: 'SKU-CASHIER-NO',
      unit: 'piece',
      sellingPriceMinor: 100,
      purchasePriceMinor: 50,
    })
    const resCreate = await worker.fetch(reqCreate, env, executionCtx)
    expect(resCreate.status).toBe(403)

    // 3. Delete: Cashier cannot archive product (403 Forbidden)
    const reqDelete = authRequest('DELETE', '/api/v1/products/prod-any', cashierToken)
    const resDelete = await worker.fetch(reqDelete, env, executionCtx)
    expect(resDelete.status).toBe(403)
  })
})

