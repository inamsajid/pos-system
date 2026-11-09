import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import worker from '../worker/src/index'
import type { Env } from '../worker/src/types/environment'
import { createSession } from '../worker/src/auth/sessionService'
import { productService } from '../src/features/products/services/productService'
import { categoryService } from '../src/features/categories/services/categoryService'
import { apiClient, ApiError } from '../src/lib/api-client'

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

describe('Catalog HTTP PUT Semantics & Frontend Fallback Safety', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env
  const businessId = 'biz_put_test'
  const branchId = 'branch_put_test'
  let ownerToken: string

  beforeEach(async () => {
    vi.restoreAllMocks()
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

    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'BIZPUT', 'PUT Test Store', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Main Store', 1, 'active')
    `).run(branchId, businessId)

    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES ('usr_owner_put', 'owner@put.pk', 'Put Owner', 'dummy_hash', 'active')
    `).run()

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_owner_put', ?, 'usr_owner_put', 'owner', 1)
    `).run(businessId)

    const sess = await createSession(d1, 'usr_owner_put')
    ownerToken = sess.token
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  function makeApiRequest(method: string, urlPath: string, body?: unknown): Request {
    return new Request(`http://localhost:8787${urlPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'X-Business-Id': businessId,
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  describe('1. Category PUT Full Replacement vs PATCH Partial Update', () => {
    it('PUT replaces entire category and resets omitted optional fields to null', async () => {
      // Create initial category with description and parentId
      const parentRes = await worker.fetch(
        makeApiRequest('POST', '/api/v1/categories', {
          name: 'Parent Cat',
          description: 'Original Parent Description',
          displayOrder: 1,
        }),
        env,
        executionCtx
      )
      const parentBody = (await parentRes.json()) as { data: { id: string } }
      const parentId = parentBody.data.id

      const childRes = await worker.fetch(
        makeApiRequest('POST', '/api/v1/categories', {
          name: 'Child Cat',
          description: 'Original Child Description',
          parentId,
          displayOrder: 2,
        }),
        env,
        executionCtx
      )
      const childBody = (await childRes.json()) as { data: { id: string } }
      const childId = childBody.data.id

      // Execute PUT with only mandatory fields (name) - description and parentId are omitted
      const putRes = await worker.fetch(
        makeApiRequest('PUT', `/api/v1/categories/${childId}`, {
          name: 'Replaced Child Name',
        }),
        env,
        executionCtx
      )

      expect(putRes.status).toBe(200)
      const putBody = (await putRes.json()) as { data: { name: string; description: string | null; parentId: string | null; displayOrder: number } }
      expect(putBody.data.name).toBe('Replaced Child Name')
      // Omitted optional fields must be reset to defaults / null
      expect(putBody.data.description).toBeNull()
      expect(putBody.data.parentId).toBeNull()
      expect(putBody.data.displayOrder).toBe(0)
    })

    it('PUT rejects missing mandatory fields (missing name)', async () => {
      const catRes = await worker.fetch(
        makeApiRequest('POST', '/api/v1/categories', { name: 'Initial Cat' }),
        env,
        executionCtx
      )
      const catBody = (await catRes.json()) as { data: { id: string } }

      const putRes = await worker.fetch(
        makeApiRequest('PUT', `/api/v1/categories/${catBody.data.id}`, {
          description: 'Only Description without name',
        }),
        env,
        executionCtx
      )
      expect(putRes.status).toBe(400)
    })

    it('PATCH performs partial update, preserving omitted fields', async () => {
      const catRes = await worker.fetch(
        makeApiRequest('POST', '/api/v1/categories', {
          name: 'Patch Category',
          description: 'Preserved Description',
          displayOrder: 5,
        }),
        env,
        executionCtx
      )
      const catBody = (await catRes.json()) as { data: { id: string } }

      const patchRes = await worker.fetch(
        makeApiRequest('PATCH', `/api/v1/categories/${catBody.data.id}`, {
          name: 'Updated Name Only',
        }),
        env,
        executionCtx
      )
      expect(patchRes.status).toBe(200)
      const patchBody = (await patchRes.json()) as { data: { name: string; description: string; displayOrder: number } }
      expect(patchBody.data.name).toBe('Updated Name Only')
      expect(patchBody.data.description).toBe('Preserved Description')
      expect(patchBody.data.displayOrder).toBe(5)
    })
  })

  describe('2. Product PUT Full Replacement vs PATCH Partial Update', () => {
    it('PUT replaces entire product and resets omitted optional fields to null / default', async () => {
      // Create initial product with optional barcode, category, description, imageUrl
      const catRes = await worker.fetch(
        makeApiRequest('POST', '/api/v1/categories', { name: 'Prod Cat' }),
        env,
        executionCtx
      )
      const catId = ((await catRes.json()) as { data: { id: string } }).data.id

      const prodRes = await worker.fetch(
        makeApiRequest('POST', '/api/v1/products', {
          name: 'Original Product',
          sku: 'SKU-ORIGINAL',
          barcode: 'BAR-123456',
          categoryId: catId,
          description: 'Original Product Description',
          imageUrl: 'https://example.com/img.jpg',
          unit: 'piece',
          purchasePriceMinor: 1000,
          sellingPriceMinor: 2000,
          lowStockThreshold: 12,
        }),
        env,
        executionCtx
      )
      const prodId = ((await prodRes.json()) as { data: { id: string } }).data.id

      // Execute PUT with only mandatory fields (name, sku, unit, purchasePriceMinor, sellingPriceMinor)
      // Omit barcode, categoryId, description, imageUrl
      const putRes = await worker.fetch(
        makeApiRequest('PUT', `/api/v1/products/${prodId}`, {
          name: 'Fully Replaced Product',
          sku: 'SKU-REPLACED',
          unit: 'box',
          purchasePriceMinor: 3000,
          sellingPriceMinor: 4500,
        }),
        env,
        executionCtx
      )

      expect(putRes.status).toBe(200)
      const putBody = (await putRes.json()) as {
        data: {
          name: string
          sku: string
          barcode: string | null
          categoryId: string | null
          description: string | null
          imageUrl: string | null
          unit: string
          purchasePriceMinor: number
          sellingPriceMinor: number
          lowStockThreshold: number
        }
      }

      expect(putBody.data.name).toBe('Fully Replaced Product')
      expect(putBody.data.sku).toBe('SKU-REPLACED')
      expect(putBody.data.unit).toBe('box')
      expect(putBody.data.purchasePriceMinor).toBe(3000)
      expect(putBody.data.sellingPriceMinor).toBe(4500)
      // Omitted optional fields must be reset to null / defaults
      expect(putBody.data.barcode).toBeNull()
      expect(putBody.data.categoryId).toBeNull()
      expect(putBody.data.description).toBeNull()
      expect(putBody.data.imageUrl).toBeNull()
      expect(putBody.data.lowStockThreshold).toBe(5.0)
    })

    it('PUT rejects missing mandatory fields on products (missing selling price or sku)', async () => {
      const prodRes = await worker.fetch(
        makeApiRequest('POST', '/api/v1/products', {
          name: 'Mandatory Check Prod',
          sku: 'SKU-MANDATORY',
          unit: 'piece',
          purchasePriceMinor: 1000,
          sellingPriceMinor: 1500,
        }),
        env,
        executionCtx
      )
      const prodId = ((await prodRes.json()) as { data: { id: string } }).data.id

      // Missing sellingPriceMinor
      const badPutRes1 = await worker.fetch(
        makeApiRequest('PUT', `/api/v1/products/${prodId}`, {
          name: 'Prod Name',
          sku: 'SKU-MANDATORY',
          unit: 'piece',
          purchasePriceMinor: 1000,
        }),
        env,
        executionCtx
      )
      expect(badPutRes1.status).toBe(400)

      // Missing SKU
      const badPutRes2 = await worker.fetch(
        makeApiRequest('PUT', `/api/v1/products/${prodId}`, {
          name: 'Prod Name',
          unit: 'piece',
          purchasePriceMinor: 1000,
          sellingPriceMinor: 1500,
        }),
        env,
        executionCtx
      )
      expect(badPutRes2.status).toBe(400)
    })

    it('PATCH preserves unspecified product fields', async () => {
      const prodRes = await worker.fetch(
        makeApiRequest('POST', '/api/v1/products', {
          name: 'Patch Product',
          sku: 'SKU-PATCH-ME',
          barcode: 'BAR-PRESERVE',
          description: 'Keep this description',
          unit: 'kg',
          purchasePriceMinor: 2000,
          sellingPriceMinor: 3000,
          lowStockThreshold: 8,
        }),
        env,
        executionCtx
      )
      const prodId = ((await prodRes.json()) as { data: { id: string } }).data.id

      const patchRes = await worker.fetch(
        makeApiRequest('PATCH', `/api/v1/products/${prodId}`, {
          sellingPriceMinor: 3500,
        }),
        env,
        executionCtx
      )
      expect(patchRes.status).toBe(200)
      const patchBody = (await patchRes.json()) as { data: { name: string; barcode: string; description: string; sellingPriceMinor: number; lowStockThreshold: number } }
      expect(patchBody.data.sellingPriceMinor).toBe(3500)
      expect(patchBody.data.name).toBe('Patch Product')
      expect(patchBody.data.barcode).toBe('BAR-PRESERVE')
      expect(patchBody.data.description).toBe('Keep this description')
      expect(patchBody.data.lowStockThreshold).toBe(8)
    })
  })

  describe('3. Frontend Fallback Safety & Error Handling', () => {
    it('In API mode (default): 401 Unauthorized propagates ApiError', async () => {
      vi.stubEnv('VITE_DATA_SOURCE', 'api')
      vi.spyOn(apiClient, 'get').mockRejectedValue(
        new ApiError('Authentication required. Session is invalid or expired.', 401, 'UNAUTHENTICATED')
      )

      await expect(productService.getProducts()).rejects.toMatchObject({
        status: 401,
        code: 'UNAUTHENTICATED',
      })
    })

    it('In API mode (default): 403 Forbidden propagates ApiError', async () => {
      vi.stubEnv('VITE_DATA_SOURCE', 'api')
      vi.spyOn(apiClient, 'get').mockRejectedValue(
        new ApiError('Missing required permission.', 403, 'FORBIDDEN')
      )

      await expect(categoryService.getCategories()).rejects.toMatchObject({
        status: 403,
        code: 'FORBIDDEN',
      })
    })

    it('In API mode: Network errors are distinct and thrown directly without mask', async () => {
      vi.stubEnv('VITE_DATA_SOURCE', 'api')
      vi.spyOn(apiClient, 'get').mockRejectedValue(new TypeError('Failed to fetch (connection refused)'))

      await expect(productService.getProducts()).rejects.toThrow('Failed to fetch')
    })

    it('In API mode: Failed backend mutations never silently succeed or fake local success', async () => {
      vi.stubEnv('VITE_DATA_SOURCE', 'api')
      vi.spyOn(apiClient, 'post').mockRejectedValue(
        new ApiError('SKU already exists in business.', 409, 'CONFLICT')
      )

      await expect(
        productService.createProduct({
          name: 'Duplicate Item',
          sku: 'SKU-DUP',
          unit: 'piece',
          purchasePrice: 10,
          sellingPrice: 15,
          stockQuantity: 5,
          lowStockThreshold: 2,
          trackInventory: true,
          status: 'active',
          categoryId: '',
        })
      ).rejects.toThrow(ApiError)
    })

    it('In explicit demo mode (VITE_DATA_SOURCE=mock): operates on in-memory demo data without invoking API', async () => {
      vi.stubEnv('VITE_DATA_SOURCE', 'mock')
      const apiGetSpy = vi.spyOn(apiClient, 'get')

      const products = await productService.getProducts()
      expect(apiGetSpy).not.toHaveBeenCalled()
      expect(products.length).toBeGreaterThan(0)
    })
  })
})
