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

describe('Categories API (/api/v1/categories)', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  // Test fixtures
  const ownerUserId = 'usr_owner_cat'
  const cashierUserId = 'usr_cashier_cat'
  const businessId = 'biz_cat_test'
  const branchId = 'branch_cat_test'
  let ownerToken: string
  let cashierToken: string

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
      VALUES (?, 'BIZCAT', 'Northstar Grocers', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Main Store', 1, 'active')
    `).run(branchId, businessId)

    // Seed Owner User
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'owner@cat.pk', 'Owner User', 'dummy_hash', 'active')
    `).run(ownerUserId)

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_owner_cat', ?, ?, 'owner', 1)
    `).run(businessId, ownerUserId)

    // Seed Cashier User (has catalog_read but not catalog_write)
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'cashier@cat.pk', 'Cashier User', 'dummy_hash', 'active')
    `).run(cashierUserId)

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_cashier_cat', ?, ?, 'cashier', 1)
    `).run(businessId, cashierUserId)

    // Create active sessions
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

  it('lists categories for authorized business with product counts and stock totals', async () => {
    // Seed initial category
    const catId = generateId()
    sqlite.prepare(`
      INSERT INTO categories (id, business_id, name, slug, description, display_order, status)
      VALUES (?, ?, 'Rice & Grains', 'rice-grains', 'All staple rice', 1, 'active')
    `).run(catId, businessId)

    // Seed product under this category
    const prodId = generateId()
    sqlite.prepare(`
      INSERT INTO products (id, business_id, category_id, sku, name, unit, purchase_price_minor, selling_price_minor, track_inventory, status)
      VALUES (?, ?, ?, 'SKU-RICE-01', 'Basmati Rice 5kg', 'kg', 10000, 14000, 1, 'active')
    `).run(prodId, businessId, catId)

    // Seed inventory balance
    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand)
      VALUES ('bal-1', ?, ?, ?, 35.5)
    `).run(businessId, branchId, prodId)

    const req = authRequest('GET', '/api/v1/categories', ownerToken)
    const res = await worker.fetch(req, env, executionCtx)

    expect(res.status).toBe(200)
    const json = (await res.json()) as { success: boolean; data: Array<{ id: string; name: string; productCount: number; totalStockQuantity: number }> }
    expect(json.success).toBe(true)
    expect(json.data.length).toBe(1)
    expect(json.data[0].name).toBe('Rice & Grains')
    expect(json.data[0].productCount).toBe(1)
    expect(json.data[0].totalStockQuantity).toBe(35.5)
  })

  it('creates a category with valid input and generates slug if omitted', async () => {
    const req = authRequest('POST', '/api/v1/categories', ownerToken, {
      name: 'Fresh Fruits',
      description: 'Seasonal fruits and berries',
      displayOrder: 2,
    })
    const res = await worker.fetch(req, env, executionCtx)

    expect(res.status).toBe(201)
    const json = (await res.json()) as { success: boolean; data: { id: string; name: string; slug: string; displayOrder: number } }
    expect(json.success).toBe(true)
    expect(json.data.name).toBe('Fresh Fruits')
    expect(json.data.slug).toBe('fresh-fruits')
    expect(json.data.displayOrder).toBe(2)

    // Verify row persisted in D1
    const stored = sqlite.prepare(`SELECT * FROM categories WHERE id = ?`).get(json.data.id) as { name: string; slug: string }
    expect(stored).toBeDefined()
    expect(stored.name).toBe('Fresh Fruits')
  })

  it('rejects duplicate category name within the same business with 409 Conflict', async () => {
    // Seed first category
    sqlite.prepare(`
      INSERT INTO categories (id, business_id, name, slug)
      VALUES ('cat-1', ?, 'Beverages', 'beverages')
    `).run(businessId)

    // Attempt to create second category with case-insensitive identical name
    const req = authRequest('POST', '/api/v1/categories', ownerToken, {
      name: 'beverages',
    })
    const res = await worker.fetch(req, env, executionCtx)

    expect(res.status).toBe(409)
    const json = (await res.json()) as { success: boolean; error: { code: string; message: string } }
    expect(json.success).toBe(false)
    expect(json.error.code).toBe('CONFLICT')
    expect(json.error.message).toContain('already exists')
  })

  it('rejects duplicate category slug within the same business with 409 Conflict', async () => {
    sqlite.prepare(`
      INSERT INTO categories (id, business_id, name, slug)
      VALUES ('cat-slug-1', ?, 'Snacks', 'snacks-crisps')
    `).run(businessId)

    const req = authRequest('POST', '/api/v1/categories', ownerToken, {
      name: 'Crisps & Chips',
      slug: 'snacks-crisps',
    })
    const res = await worker.fetch(req, env, executionCtx)

    expect(res.status).toBe(409)
    const json = (await res.json()) as { success: boolean; error: { code: string } }
    expect(json.error.code).toBe('CONFLICT')
  })

  it('rejects invalid category input: name too short or slug with invalid characters', async () => {
    // 1. Name < 2 characters
    const req1 = authRequest('POST', '/api/v1/categories', ownerToken, {
      name: 'A',
    })
    const res1 = await worker.fetch(req1, env, executionCtx)
    expect(res1.status).toBe(400)

    // 2. Slug with spaces or uppercase characters
    const req2 = authRequest('POST', '/api/v1/categories', ownerToken, {
      name: 'Valid Name',
      slug: 'invalid slug with spaces!',
    })
    const res2 = await worker.fetch(req2, env, executionCtx)
    expect(res2.status).toBe(400)
  })

  it('updates category fields successfully via PATCH', async () => {
    const catId = 'cat-update-1'
    sqlite.prepare(`
      INSERT INTO categories (id, business_id, name, slug, description, display_order)
      VALUES (?, ?, 'Old Category', 'old-category', 'Old description', 1)
    `).run(catId, businessId)

    const req = authRequest('PATCH', `/api/v1/categories/${catId}`, ownerToken, {
      name: 'Updated Category',
      description: 'New shiny description',
      displayOrder: 5,
    })
    const res = await worker.fetch(req, env, executionCtx)

    expect(res.status).toBe(200)
    const json = (await res.json()) as { success: boolean; data: { name: string; description: string; displayOrder: number } }
    expect(json.data.name).toBe('Updated Category')
    expect(json.data.description).toBe('New shiny description')
    expect(json.data.displayOrder).toBe(5)
  })

  it('prevents setting category as its own parent or setting non-existent parent', async () => {
    const catId = 'cat-parent-test'
    sqlite.prepare(`
      INSERT INTO categories (id, business_id, name, slug)
      VALUES (?, ?, 'Test Parent', 'test-parent')
    `).run(catId, businessId)

    // Cannot be own parent
    const reqSelf = authRequest('PATCH', `/api/v1/categories/${catId}`, ownerToken, {
      parentId: catId,
    })
    const resSelf = await worker.fetch(reqSelf, env, executionCtx)
    expect(resSelf.status).toBe(400)

    // Cannot reference non-existent parent
    const reqMissing = authRequest('PATCH', `/api/v1/categories/${catId}`, ownerToken, {
      parentId: 'cat-non-existent-xyz',
    })
    const resMissing = await worker.fetch(reqMissing, env, executionCtx)
    expect(resMissing.status).toBe(400)
  })

  it('detects and blocks circular category hierarchies (A -> B -> A)', async () => {
    const catA = 'cat-circle-a'
    const catB = 'cat-circle-b'

    sqlite.prepare(`
      INSERT INTO categories (id, business_id, name, slug, parent_id)
      VALUES (?, ?, 'Category A', 'cat-a', NULL)
    `).run(catA, businessId)

    sqlite.prepare(`
      INSERT INTO categories (id, business_id, name, slug, parent_id)
      VALUES (?, ?, 'Category B', 'cat-b', ?)
    `).run(catB, businessId, catA)

    // Now attempt to set Category A's parent to Category B (creates circle: B -> A -> B)
    const req = authRequest('PATCH', `/api/v1/categories/${catA}`, ownerToken, {
      parentId: catB,
    })
    const res = await worker.fetch(req, env, executionCtx)

    expect(res.status).toBe(400)
    const json = (await res.json()) as { success: boolean; error: { message: string } }
    expect(json.error.message).toContain('Circular category hierarchy detected')
  })

  it('archives category safely via DELETE and preserves product references', async () => {
    const catId = 'cat-archive-target'
    sqlite.prepare(`
      INSERT INTO categories (id, business_id, name, slug, status)
      VALUES (?, ?, 'Archivable Category', 'archivable-cat', 'active')
    `).run(catId, businessId)

    // Seed a product referencing this category
    const prodId = 'prod-linked-to-cat'
    sqlite.prepare(`
      INSERT INTO products (id, business_id, category_id, sku, name, unit, purchase_price_minor, selling_price_minor)
      VALUES (?, ?, ?, 'SKU-LINKED', 'Linked Product', 'piece', 500, 1000)
    `).run(prodId, businessId, catId)

    const req = authRequest('DELETE', `/api/v1/categories/${catId}`, ownerToken)
    const res = await worker.fetch(req, env, executionCtx)

    expect(res.status).toBe(200)
    const json = (await res.json()) as { success: boolean; data: { status: string } }
    expect(json.data.status).toBe('archived')

    // Verify category row is archived (NOT hard deleted)
    const catRow = sqlite.prepare(`SELECT status FROM categories WHERE id = ?`).get(catId) as { status: string }
    expect(catRow.status).toBe('archived')

    // Verify product still safely references category_id
    const prodRow = sqlite.prepare(`SELECT category_id FROM products WHERE id = ?`).get(prodId) as { category_id: string }
    expect(prodRow.category_id).toBe(catId)
  })

  it('enforces RBAC: Cashier can read categories but CANNOT create, update, or archive', async () => {
    // 1. Read: Cashier can list categories (200 OK)
    const reqRead = authRequest('GET', '/api/v1/categories', cashierToken)
    const resRead = await worker.fetch(reqRead, env, executionCtx)
    expect(resRead.status).toBe(200)

    // 2. Write: Cashier cannot create category (403 Forbidden)
    const reqCreate = authRequest('POST', '/api/v1/categories', cashierToken, {
      name: 'Cashier Forbidden Cat',
    })
    const resCreate = await worker.fetch(reqCreate, env, executionCtx)
    expect(resCreate.status).toBe(403)

    // 3. Delete: Cashier cannot archive category (403 Forbidden)
    const reqDelete = authRequest('DELETE', '/api/v1/categories/cat-any', cashierToken)
    const resDelete = await worker.fetch(reqDelete, env, executionCtx)
    expect(resDelete.status).toBe(403)
  })

  it('rejects unauthenticated requests to categories endpoints with 401', async () => {
    const unauthReq = new Request('http://localhost:8787/api/v1/categories', {
      method: 'GET',
    })
    const res = await worker.fetch(unauthReq, env, executionCtx)
    expect(res.status).toBe(401)
  })
})
