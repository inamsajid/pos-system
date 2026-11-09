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

describe('Multi-Tenant Catalog Isolation (Zero-Trust Guarantees)', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  // Tenant A
  const bizA = 'biz_tenant_a'
  const userA = 'usr_owner_a'
  let tokenA: string
  let catA: string
  let prodA: string

  // Tenant B
  const bizB = 'biz_tenant_b'
  const userB = 'usr_owner_b'
  let tokenB: string
  let catB: string
  let prodB: string

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

    // Seed Business A
    sqlite.prepare(`INSERT INTO businesses (id, business_code, name) VALUES (?, 'BIZA', 'Market A')`).run(bizA)
    sqlite.prepare(`INSERT INTO branches (id, business_id, branch_code, name, is_main_branch) VALUES ('branch_a', ?, 'MAIN', 'Branch A', 1)`).run(bizA)
    sqlite.prepare(`INSERT INTO users (id, email, name, password_hash) VALUES (?, 'a@store.pk', 'Owner A', 'hash_a')`).run(userA)
    sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role, is_active) VALUES ('mem_a', ?, ?, 'owner', 1)`).run(bizA, userA)
    const sessionA = await createSession(d1, userA)
    tokenA = sessionA.token

    catA = 'cat_a_grocery'
    sqlite.prepare(`INSERT INTO categories (id, business_id, name, slug) VALUES (?, ?, 'Grocery A', 'grocery-a')`).run(catA, bizA)
    prodA = 'prod_a_rice'
    sqlite.prepare(`INSERT INTO products (id, business_id, category_id, sku, name, unit, purchase_price_minor, selling_price_minor) VALUES (?, ?, ?, 'SKU-A-01', 'Rice A', 'kg', 1000, 1500)`).run(prodA, bizA, catA)

    // Seed Business B
    sqlite.prepare(`INSERT INTO businesses (id, business_code, name) VALUES (?, 'BIZB', 'Market B')`).run(bizB)
    sqlite.prepare(`INSERT INTO branches (id, business_id, branch_code, name, is_main_branch) VALUES ('branch_b', ?, 'MAIN', 'Branch B', 1)`).run(bizB)
    sqlite.prepare(`INSERT INTO users (id, email, name, password_hash) VALUES (?, 'b@store.pk', 'Owner B', 'hash_b')`).run(userB)
    sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role, is_active) VALUES ('mem_b', ?, ?, 'owner', 1)`).run(bizB, userB)
    const sessionB = await createSession(d1, userB)
    tokenB = sessionB.token

    catB = 'cat_b_dairy'
    sqlite.prepare(`INSERT INTO categories (id, business_id, name, slug) VALUES (?, ?, 'Dairy B', 'dairy-b')`).run(catB, bizB)
    prodB = 'prod_b_milk'
    sqlite.prepare(`INSERT INTO products (id, business_id, category_id, sku, name, unit, purchase_price_minor, selling_price_minor) VALUES (?, ?, ?, 'SKU-B-01', 'Milk B', 'liter', 2000, 2500)`).run(prodB, bizB, catB)
  })

  function makeRequest(
    method: string,
    path: string,
    token: string,
    activeBusinessId: string,
    body?: unknown,
    headers: Record<string, string> = {}
  ): Request {
    const allHeaders: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Origin: 'http://localhost:5173',
      'X-Business-Id': activeBusinessId,
      ...headers,
    }

    if (body !== undefined) {
      allHeaders['Content-Type'] = 'application/json'
    }

    return new Request(`http://localhost:8787${path}`, {
      method,
      headers: allHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  it('symmetrically isolates products: Business A cannot list or see Business B products', async () => {
    // 1. User A lists products
    const reqA = makeRequest('GET', '/api/v1/products', tokenA, bizA)
    const resA = await worker.fetch(reqA, env, executionCtx)
    expect(resA.status).toBe(200)
    const jsonA = (await resA.json()) as { data: Array<{ id: string; name: string }> }
    expect(jsonA.data.length).toBe(1)
    expect(jsonA.data[0].id).toBe(prodA)

    // 2. User B lists products
    const reqB = makeRequest('GET', '/api/v1/products', tokenB, bizB)
    const resB = await worker.fetch(reqB, env, executionCtx)
    expect(resB.status).toBe(200)
    const jsonB = (await resB.json()) as { data: Array<{ id: string; name: string }> }
    expect(jsonB.data.length).toBe(1)
    expect(jsonB.data[0].id).toBe(prodB)
  })

  it('symmetrically isolates categories: Business A cannot list or see Business B categories', async () => {
    const reqA = makeRequest('GET', '/api/v1/categories', tokenA, bizA)
    const resA = await worker.fetch(reqA, env, executionCtx)
    expect(resA.status).toBe(200)
    const jsonA = (await resA.json()) as { data: Array<{ id: string }> }
    expect(jsonA.data.length).toBe(1)
    expect(jsonA.data[0].id).toBe(catA)

    const reqB = makeRequest('GET', '/api/v1/categories', tokenB, bizB)
    const resB = await worker.fetch(reqB, env, executionCtx)
    expect(resB.status).toBe(200)
    const jsonB = (await resB.json()) as { data: Array<{ id: string }> }
    expect(jsonB.data.length).toBe(1)
    expect(jsonB.data[0].id).toBe(catB)
  })

  it('blocks ID tampering: User A requesting Business B product ID receives 404 Not Found', async () => {
    // User A attempts to fetch prodB (which belongs to bizB)
    const req = makeRequest('GET', `/api/v1/products/${prodB}`, tokenA, bizA)
    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(404)
  })

  it('blocks ID tampering: User A requesting Business B category ID receives 404 Not Found', async () => {
    const req = makeRequest('GET', `/api/v1/categories/${catB}`, tokenA, bizA)
    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(404)
  })

  it('blocks cross-tenant modification: User A cannot update or archive Business B product', async () => {
    // PATCH
    const reqUpdate = makeRequest('PATCH', `/api/v1/products/${prodB}`, tokenA, bizA, {
      name: 'Hacked Product Name',
    })
    const resUpdate = await worker.fetch(reqUpdate, env, executionCtx)
    expect(resUpdate.status).toBe(404)

    // DELETE
    const reqDelete = makeRequest('DELETE', `/api/v1/products/${prodB}`, tokenA, bizA)
    const resDelete = await worker.fetch(reqDelete, env, executionCtx)
    expect(resDelete.status).toBe(404)

    // Verify prodB was NOT modified in the database
    const stored = sqlite.prepare('SELECT name, status FROM products WHERE id = ?').get(prodB) as { name: string; status: string }
    expect(stored.name).toBe('Milk B')
    expect(stored.status).toBe('active')
  })

  it('blocks cross-tenant modification: User A cannot update or archive Business B category', async () => {
    // PATCH
    const reqUpdate = makeRequest('PATCH', `/api/v1/categories/${catB}`, tokenA, bizA, {
      name: 'Hacked Category Name',
    })
    const resUpdate = await worker.fetch(reqUpdate, env, executionCtx)
    expect(resUpdate.status).toBe(404)

    // DELETE
    const reqDelete = makeRequest('DELETE', `/api/v1/categories/${catB}`, tokenA, bizA)
    const resDelete = await worker.fetch(reqDelete, env, executionCtx)
    expect(resDelete.status).toBe(404)

    const stored = sqlite.prepare('SELECT name, status FROM categories WHERE id = ?').get(catB) as { name: string; status: string }
    expect(stored.name).toBe('Dairy B')
    expect(stored.status).toBe('active')
  })

  it('blocks client-supplied X-Business-Id spoofing if user is not a member (403 Forbidden)', async () => {
    // User A specifies X-Business-Id: bizB in headers
    const req = makeRequest('GET', '/api/v1/products', tokenA, bizB)
    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(403)
    const json = (await res.json()) as { success: boolean; error: { code: string; message: string } }
    expect(json.success).toBe(false)
    expect(json.error.code).toBe('FORBIDDEN')
    expect(json.error.message).toContain('Access to specified business is denied.')
  })

  it('blocks assigning a category belonging to Tenant B to a product created in Tenant A', async () => {
    const req = makeRequest('POST', '/api/v1/products', tokenA, bizA, {
      name: 'Product with Foreign Category',
      sku: 'SKU-FOREIGN-CAT',
      categoryId: catB, // Category belongs to bizB!
      unit: 'piece',
      sellingPriceMinor: 1000,
      purchasePriceMinor: 500,
    })
    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(400)
    const json = (await res.json()) as { success: boolean; error: { message: string } }
    expect(json.error.message).toContain('Category does not exist or belongs to another business')
  })
})
