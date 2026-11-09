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

describe('Server Change Feed Recording & Zero Cost Leakage (/sync_change_log)', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const ownerUserId = 'usr_owner_feed'
  const businessId = 'biz_feed_test'
  const branchId = 'branch_feed_test'
  let ownerToken: string

  beforeEach(async () => {
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
      JWT_SECRET: 'test-jwt-secret-feed-tests-32-chars-min',
      COOKIE_SECRET: 'test-cookie-secret-feed-tests-32-chars-min',
      TOKEN_EXPIRATION_SECONDS: '3600',
      REFRESH_TOKEN_EXPIRATION_SECONDS: '86400',
    }

    // Seed Business & Branch
    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'BIZFEED', 'Feed Test Store', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Main Feed Branch', 1, 'active')
    `).run(branchId, businessId)

    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'owner@feed.pk', 'Owner Feed', 'dummy_hash', 'active')
    `).run(ownerUserId)

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_owner_feed', ?, ?, 'owner', 1)
    `).run(businessId, ownerUserId)

    const ownerSession = await createSession(d1, ownerUserId)
    ownerToken = ownerSession.token
  })

  it('records category mutations and increments version numbers in sequence', async () => {
    // 1. Create Category
    const createRes = await worker.fetch(
      new Request('http://localhost/api/v1/categories', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'X-Business-Id': businessId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Beverages',
          slug: 'beverages',
          description: 'Drinks and juices',
        }),
      }),
      env,
      executionCtx
    )
    expect(createRes.status).toBe(201)
    const catData = (await createRes.json()) as { data: { id: string; version: number } }
    expect(catData.data.version).toBe(1)
    const catId = catData.data.id

    // Check sync_change_log record for create
    const catEvents = sqlite
      .prepare('SELECT * FROM sync_change_log WHERE business_id = ? AND resource_id = ? ORDER BY id ASC')
      .all(businessId, catId) as Array<{
        resource_type: string
        resource_version: number
        operation: string
        payload: string
      }>

    expect(catEvents.length).toBe(1)
    expect(catEvents[0].resource_type).toBe('category')
    expect(catEvents[0].resource_version).toBe(1)
    expect(catEvents[0].operation).toBe('upsert')
    const createPayload = JSON.parse(catEvents[0].payload)
    expect(createPayload.name).toBe('Beverages')

    // 2. Update Category
    const updateRes = await worker.fetch(
      new Request(`http://localhost/api/v1/categories/${catId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'X-Business-Id': businessId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Cold Beverages',
          expectedVersion: 1,
        }),
      }),
      env,
      executionCtx
    )
    expect(updateRes.status).toBe(200)
    const updateData = (await updateRes.json()) as { data: { version: number } }
    expect(updateData.data.version).toBe(2)

    // 3. Archive Category
    const archiveRes = await worker.fetch(
      new Request(`http://localhost/api/v1/categories/${catId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'X-Business-Id': businessId,
        },
      }),
      env,
      executionCtx
    )
    expect(archiveRes.status).toBe(200)

    // Check all 3 events
    const allCatEvents = sqlite
      .prepare('SELECT * FROM sync_change_log WHERE business_id = ? AND resource_id = ? ORDER BY id ASC')
      .all(businessId, catId) as Array<{
        resource_version: number
        operation: string
      }>

    expect(allCatEvents.length).toBe(3)
    expect(allCatEvents[1].resource_version).toBe(2)
    expect(allCatEvents[1].operation).toBe('upsert')
    expect(allCatEvents[2].resource_version).toBe(3)
    expect(allCatEvents[2].operation).toBe('archive')
  })

  it('records product mutations and strictly strips wholesale purchase price from payloads', async () => {
    // 1. Create Product with purchase price
    const createRes = await worker.fetch(
      new Request('http://localhost/api/v1/products', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'X-Business-Id': businessId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Mineral Water 500ml',
          sku: 'WAT-500',
          unit: 'piece',
          purchasePriceMinor: 4000, // PKR 40.00 (wholesale secret)
          sellingPriceMinor: 7000,  // PKR 70.00
          trackInventory: true,
        }),
      }),
      env,
      executionCtx
    )
    expect(createRes.status).toBe(201)
    const prodData = (await createRes.json()) as { data: { id: string; version: number } }
    expect(prodData.data.version).toBe(1)
    const prodId = prodData.data.id

    // Check sync_change_log for create product
    const prodEvents = sqlite
      .prepare('SELECT * FROM sync_change_log WHERE business_id = ? AND resource_id = ? ORDER BY id ASC')
      .all(businessId, prodId) as Array<{
        resource_type: string
        resource_version: number
        operation: string
        payload: string
      }>

    expect(prodEvents.length).toBe(1)
    expect(prodEvents[0].resource_type).toBe('product')
    expect(prodEvents[0].resource_version).toBe(1)
    const prodPayload = JSON.parse(prodEvents[0].payload)
    expect(prodPayload.name).toBe('Mineral Water 500ml')
    expect(prodPayload.sellingPriceMinor).toBe(7000)
    // CRITICAL: purchasePriceMinor must be undefined/null
    expect(prodPayload.purchasePriceMinor).toBeUndefined()
    expect(prodPayload.purchase_price_minor).toBeUndefined()

    // 2. Update Product Price
    const updateRes = await worker.fetch(
      new Request(`http://localhost/api/v1/products/${prodId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'X-Business-Id': businessId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sellingPriceMinor: 7500,
          purchasePriceMinor: 4500,
          expectedVersion: 1,
        }),
      }),
      env,
      executionCtx
    )
    expect(updateRes.status).toBe(200)

    const updatedEvents = sqlite
      .prepare('SELECT * FROM sync_change_log WHERE business_id = ? AND resource_id = ? ORDER BY id ASC')
      .all(businessId, prodId) as Array<{
        resource_version: number
        operation: string
        payload: string
      }>

    expect(updatedEvents.length).toBe(2)
    expect(updatedEvents[1].resource_version).toBe(2)
    const updatePayload = JSON.parse(updatedEvents[1].payload)
    expect(updatePayload.sellingPriceMinor).toBe(7500)
    expect(updatePayload.purchasePriceMinor).toBeUndefined()
    expect(updatePayload.purchase_price_minor).toBeUndefined()

    // 3. Archive Product
    const archiveRes = await worker.fetch(
      new Request(`http://localhost/api/v1/products/${prodId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'X-Business-Id': businessId,
        },
      }),
      env,
      executionCtx
    )
    expect(archiveRes.status).toBe(200)

    const allEvents = sqlite
      .prepare('SELECT * FROM sync_change_log WHERE business_id = ? AND resource_id = ? ORDER BY id ASC')
      .all(businessId, prodId) as Array<{
        resource_version: number
        operation: string
      }>

    expect(allEvents.length).toBe(3)
    expect(allEvents[2].resource_version).toBe(3)
    expect(allEvents[2].operation).toBe('archive')
  })

  it('records branch stock mutations in change log upon inventory adjustment', async () => {
    // 1. Create Product
    const prodRes = await worker.fetch(
      new Request('http://localhost/api/v1/products', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'X-Business-Id': businessId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Basmati Rice 1kg',
          sku: 'RIC-01',
          unit: 'kg',
          purchasePriceMinor: 25000,
          sellingPriceMinor: 32000,
          trackInventory: true,
        }),
      }),
      env,
      executionCtx
    )
    const prod = (await prodRes.json()) as { data: { id: string } }

    // 2. Record Stock Adjustment
    const adjRes = await worker.fetch(
      new Request('http://localhost/api/v1/inventory/adjustments', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          productId: prod.data.id,
          type: 'adjustment_in',
          quantityChange: 50,
          reason: 'Initial stock intake',
        }),
      }),
      env,
      executionCtx
    )
    expect(adjRes.status).toBe(201)

    // Check stock change event
    const stockEvents = sqlite
      .prepare('SELECT * FROM sync_change_log WHERE business_id = ? AND resource_type = ? ORDER BY id ASC')
      .all(businessId, 'stock') as Array<{
        branch_id: string
        resource_id: string
        payload: string
      }>

    expect(stockEvents.length).toBe(1)
    expect(stockEvents[0].branch_id).toBe(branchId)
    const stockPayload = JSON.parse(stockEvents[0].payload)
    expect(stockPayload.productId).toBe(prod.data.id)
    expect(stockPayload.quantityOnHand).toBe(50)
  })
})
