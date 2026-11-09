import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import worker from '../worker/src/index'
import type { Env } from '../worker/src/types/environment'
import { createSession } from '../worker/src/auth/sessionService'
import { apiClient, setApiContextProvider } from '../src/lib/api-client'
import { offlineDb } from '../src/lib/offline/database'
import { SyncClient } from '../src/lib/offline/sync/sync.client'

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

describe('Multi-Device Catalog & Stock Synchronization', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const testUserId = 'usr_owner_multi'
  const businessId = 'biz_multi_test'
  const branchId = 'branch_multi_test'
  let token: string

  beforeEach(async () => {
    vi.restoreAllMocks()
    await offlineDb.clearAllOfflineData()

    sqlite = new DatabaseSync(':memory:')
    sqlite.exec('PRAGMA foreign_keys = ON;')

    const migrationsDir = path.resolve(process.cwd(), 'worker/migrations')
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
      const sanitized = sql
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
      for (const statement of sanitized.split(';')) {
        const trimmed = statement.trim()
        if (trimmed) {
          try {
            sqlite.exec(trimmed)
          } catch (err: unknown) {
            const e = err as Error
            if (!e.message.includes('duplicate column name')) {
              throw err
            }
          }
        }
      }
    }

    d1 = createRealD1(sqlite)
    env = {
      DB: d1,
      ENVIRONMENT: 'test',
      JWT_SECRET: 'test-jwt-secret-multi-tests-32-chars-min',
      COOKIE_SECRET: 'test-cookie-secret-multi-tests-32-chars-min',
      TOKEN_EXPIRATION_SECONDS: '3600',
      REFRESH_TOKEN_EXPIRATION_SECONDS: '86400',
    }

    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'BIZMULTI', 'Multi Device Store', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Main Store Branch', 1, 'active')
    `).run(branchId, businessId)

    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'owner@multi.pk', 'Owner Multi', 'dummy_hash', 'active')
    `).run(testUserId)

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_owner_multi', ?, ?, 'owner', 1)
    `).run(businessId, testUserId)

    const session = await createSession(d1, testUserId)
    token = session.token

    setApiContextProvider(() => ({
      userId: testUserId,
      businessId,
      branchId,
    }))

    vi.stubGlobal('navigator', {
      onLine: true,
      platform: 'Linux x86_64',
      storage: {
        estimate: async () => ({ quota: 1000000, usage: 200000 }),
        persisted: async () => true,
        persist: async () => true,
      },
    })
  })

  afterEach(async () => {
    setApiContextProvider(null)
    vi.unstubAllGlobals()
    await offlineDb.clearAllOfflineData()
  })

  it('Device A modifies catalog and Device B pulls updates into Dexie without leaking purchase cost', async () => {
    // 1. Device A creates a Category
    const catRes = await worker.fetch(
      new Request('http://localhost/api/v1/categories', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Business-Id': businessId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Fresh Dairy',
          slug: 'fresh-dairy',
        }),
      }),
      env,
      executionCtx
    )
    const cat = (await catRes.json()) as { data: { id: string } }

    // 2. Device A creates a Product
    const prodRes = await worker.fetch(
      new Request('http://localhost/api/v1/products', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Business-Id': businessId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Whole Milk 1L',
          sku: 'MLK-01',
          categoryId: cat.data.id,
          unit: 'liter',
          purchasePriceMinor: 18000, // PKR 180 (wholesale cost)
          sellingPriceMinor: 24000,  // PKR 240
          trackInventory: true,
        }),
      }),
      env,
      executionCtx
    )
    const prod = (await prodRes.json()) as { data: { id: string; version: number } }
    const productId = prod.data.id

    // 3. Device A updates the selling price (version 1 -> version 2)
    const updateRes = await worker.fetch(
      new Request(`http://localhost/api/v1/products/${productId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Business-Id': businessId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sellingPriceMinor: 25000, // PKR 250
          expectedVersion: 1,
        }),
      }),
      env,
      executionCtx
    )
    expect(updateRes.status).toBe(200)

    // 4. Device A adds stock via inventory adjustment
    const adjRes = await worker.fetch(
      new Request('http://localhost/api/v1/inventory/adjustments', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          productId,
          type: 'adjustment_in',
          quantityChange: 100,
          reason: 'Initial delivery',
        }),
      }),
      env,
      executionCtx
    )
    expect(adjRes.status).toBe(201)

    // Wire apiClient mocks to call worker
    const customApi = {
      ...apiClient,
      async get<T>(path: string, options: any = {}): Promise<T> {
        const url = new URL(`http://localhost/api/v1${path}`)
        if (options.params) {
          for (const [k, v] of Object.entries(options.params)) {
            if (v !== undefined && v !== null) {
              url.searchParams.set(k, String(v))
            }
          }
        }
        const req = new Request(url.toString(), {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Business-Id': businessId,
            ...(options.headers || {}),
          },
        })
        const res = await worker.fetch(req, env, executionCtx)
        const json = (await res.json()) as { data?: T }
        return (json.data ?? json) as T
      },
      async post<T>(path: string, body?: any): Promise<T> {
        const req = new Request(`http://localhost/api/v1${path}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Business-Id': businessId,
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
        })
        const res = await worker.fetch(req, env, executionCtx)
        const json = (await res.json()) as { data?: T }
        return (json.data ?? json) as T
      },
    }

    // 5. Device B registers with its own installation ID
    const deviceBId = await offlineDb.getDeviceId()
    const syncClient = new SyncClient({ db: offlineDb, api: customApi as any })
    const regResult = await syncClient.registerDevice('Device B Counter Terminal')
    expect(regResult.installationId).toBe(deviceBId)
    expect(regResult.status).toBe('active')

    // 6. Device B pulls and applies changes
    const result1 = await syncClient.pullAndApplyChanges({
      userId: testUserId,
      businessId,
      branchId,
    })

    expect(result1.pulledCount).toBeGreaterThanOrEqual(3) // category, product create/update, stock
    expect(result1.appliedCount).toBeGreaterThanOrEqual(3)
    expect(result1.cursor).toMatch(/^seq_/)

    // 7. Verify Device B's local Dexie state
    const cachedProducts = await offlineDb.cachedProducts.toArray()
    const cachedMilk = cachedProducts.find((p) => p.productId === productId)
    expect(cachedMilk).toBeDefined()
    expect(cachedMilk?.name).toBe('Whole Milk 1L')
    expect(cachedMilk?.sellingPriceMinor).toBe(25000)
    expect(cachedMilk?.version).toBe(2)
    // ZERO COST LEAKAGE: purchase price is not in CachedProductRecord!
    expect((cachedMilk as any).purchasePriceMinor).toBeUndefined()
    expect((cachedMilk as any).purchase_price_minor).toBeUndefined()

    // Verify category cached
    const cachedCategories = await offlineDb.cachedCategories.toArray()
    const cachedDairy = cachedCategories.find((c) => c.categoryId === cat.data.id)
    expect(cachedDairy).toBeDefined()
    expect(cachedDairy?.name).toBe('Fresh Dairy')

    // Verify stock cached
    const cachedStock = await offlineDb.cachedBranchStock.toArray()
    const milkStock = cachedStock.find((s) => s.productId === productId)
    expect(milkStock).toBeDefined()
    expect(milkStock?.quantityOnHand).toBe(100)

    // Verify sync cursor is saved
    const savedCursor = await offlineDb.getSyncCursor(testUserId, businessId, branchId, 'catalog')
    expect(savedCursor).toBeDefined()
    expect(savedCursor?.cursor).toBe(result1.cursor)

    // 8. Subsequent pull without new server mutations yields 0 new changes
    const result2 = await syncClient.pullAndApplyChanges({
      userId: testUserId,
      businessId,
      branchId,
    })
    expect(result2.pulledCount).toBe(0)
    expect(result2.appliedCount).toBe(0)
  })
})

