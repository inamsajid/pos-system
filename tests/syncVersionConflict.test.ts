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

describe('Optimistic Concurrency & 409 Conflict Handling', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const ownerUserId = 'usr_owner_conflict'
  const businessId = 'biz_conflict_test'
  const branchId = 'branch_conflict_test'
  let token: string

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
      JWT_SECRET: 'test-jwt-secret-conflict-tests-32-chars-min',
      COOKIE_SECRET: 'test-cookie-secret-conflict-tests-32-chars-min',
      TOKEN_EXPIRATION_SECONDS: '3600',
      REFRESH_TOKEN_EXPIRATION_SECONDS: '86400',
    }

    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'BIZCONF', 'Conflict Test Store', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Main Conflict Branch', 1, 'active')
    `).run(branchId, businessId)

    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'owner@conflict.pk', 'Owner Conflict', 'dummy_hash', 'active')
    `).run(ownerUserId)

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_owner_conflict', ?, ?, 'owner', 1)
    `).run(businessId, ownerUserId)

    const ownerSession = await createSession(d1, ownerUserId)
    token = ownerSession.token
  })

  it('rejects product update with 409 Conflict when expectedVersion is stale', async () => {
    // 1. Create Product at version 1
    const createRes = await worker.fetch(
      new Request('http://localhost/api/v1/products', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Business-Id': businessId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Green Tea 100g',
          sku: 'TEA-100',
          unit: 'box',
          purchasePriceMinor: 20000,
          sellingPriceMinor: 30000,
        }),
      }),
      env,
      executionCtx
    )
    const prod = (await createRes.json()) as { data: { id: string; version: number } }
    expect(prod.data.version).toBe(1)
    const productId = prod.data.id

    // 2. Terminal A updates the product successfully (expectedVersion: 1)
    const updateResA = await worker.fetch(
      new Request(`http://localhost/api/v1/products/${productId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Business-Id': businessId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Green Tea Premium 100g',
          expectedVersion: 1,
        }),
      }),
      env,
      executionCtx
    )
    expect(updateResA.status).toBe(200)
    const prodA = (await updateResA.json()) as { data: { version: number } }
    expect(prodA.data.version).toBe(2)

    // 3. Terminal B tries to update using stale version 1
    const updateResB = await worker.fetch(
      new Request(`http://localhost/api/v1/products/${productId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Business-Id': businessId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sellingPriceMinor: 32000,
          expectedVersion: 1, // Stale!
        }),
      }),
      env,
      executionCtx
    )

    expect(updateResB.status).toBe(409)
    const errBody = (await updateResB.json()) as { error: { code: string; message: string; details: Record<string, unknown> } }
    expect(errBody.error.code).toBe('CONFLICT')
    expect(errBody.error.message).toContain('modified by another device')
    expect(errBody.error.details.serverVersion).toBe(2)
    expect(errBody.error.details.expectedVersion).toBe(1)

    // 4. Terminal B accepts current server version and re-applies
    const retryRes = await worker.fetch(
      new Request(`http://localhost/api/v1/products/${productId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Business-Id': businessId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sellingPriceMinor: 32000,
          expectedVersion: 2, // Current server version!
        }),
      }),
      env,
      executionCtx
    )
    expect(retryRes.status).toBe(200)
    const retryData = (await retryRes.json()) as { data: { version: number; sellingPriceMinor: number } }
    expect(retryData.data.version).toBe(3)
    expect(retryData.data.sellingPriceMinor).toBe(32000)
  })

  it('rejects category update with 409 Conflict when expectedVersion is stale', async () => {
    // 1. Create Category at version 1
    const createRes = await worker.fetch(
      new Request('http://localhost/api/v1/categories', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Business-Id': businessId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Stationery',
          slug: 'stationery',
        }),
      }),
      env,
      executionCtx
    )
    const cat = (await createRes.json()) as { data: { id: string; version: number } }
    expect(cat.data.version).toBe(1)
    const categoryId = cat.data.id

    // 2. Device A updates category to version 2
    const updateResA = await worker.fetch(
      new Request(`http://localhost/api/v1/categories/${categoryId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Business-Id': businessId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Office Stationery',
          expectedVersion: 1,
        }),
      }),
      env,
      executionCtx
    )
    expect(updateResA.status).toBe(200)
    const catA = (await updateResA.json()) as { data: { version: number } }
    expect(catA.data.version).toBe(2)

    // 3. Device B attempts update with stale expectedVersion: 1 -> 409 Conflict
    const updateResB = await worker.fetch(
      new Request(`http://localhost/api/v1/categories/${categoryId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Business-Id': businessId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          description: 'Pens and papers',
          expectedVersion: 1, // Stale!
        }),
      }),
      env,
      executionCtx
    )

    expect(updateResB.status).toBe(409)
    const errBody = (await updateResB.json()) as { error: { code: string; message: string; details: Record<string, unknown> } }
    expect(errBody.error.code).toBe('CONFLICT')
    expect(errBody.error.details.serverVersion).toBe(2)
  })
})

