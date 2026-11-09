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

describe('Suppliers Read-Only Lookup APIs', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const businessId = 'biz_sup_lookup'
  const otherBizId = 'biz_other_lookup'
  const branchId = 'branch_sup_lookup'
  const userId = 'usr_sup_lookup'
  let userToken: string

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

    // Seed Businesses & Branches
    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'BIZSUP', 'Apex Suppliers Test', 'active'),
             (?, 'BIZOTH', 'Other Corp', 'active')
    `).run(businessId, otherBizId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Main', 1, 'active')
    `).run(branchId, businessId)

    // Seed User
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'user@apexsup.pk', 'Lookup User', 'dummy_hash', 'active')
    `).run(userId)

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_sup_lookup', ?, ?, 'owner', 1)
    `).run(businessId, userId)

    // Seed Suppliers in Business 1
    sqlite.prepare(`
      INSERT INTO suppliers (id, business_id, supplier_code, name, company_name, contact_person, phone, email, status)
      VALUES ('supp_1', ?, 'SUPP-001', 'Alpha Distributions', 'Alpha Ltd', 'Ali', '03001234567', 'ali@alpha.pk', 'active'),
             ('supp_2', ?, 'SUPP-002', 'Beta Wholesale', 'Beta Ltd', 'Bilal', '03007654321', 'bilal@beta.pk', 'archived')
    `).run(businessId, businessId)

    // Seed Supplier in Other Business
    sqlite.prepare(`
      INSERT INTO suppliers (id, business_id, supplier_code, name, company_name, status)
      VALUES ('supp_other', ?, 'SUPP-OTH', 'Foreign Supplier', 'Foreign Ltd', 'active')
    `).run(otherBizId)

    userToken = (await createSession(d1, userId)).token
  })

  it('lists active suppliers with search and pagination, excluding other businesses', async () => {
    const res = await worker.fetch(
      new Request('https://pos.internal/api/v1/suppliers', {
        method: 'GET',
        headers: {
          Cookie: `__session=${userToken}`,
          'X-Business-Id': businessId,
        },
      }),
      env,
      executionCtx
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: Array<{ id: string; name: string }>; meta: { total: number } }
    expect(json.data.length).toBe(1) // Default excludes archived
    expect(json.data[0].id).toBe('supp_1')

    // Search query
    const searchRes = await worker.fetch(
      new Request('https://pos.internal/api/v1/suppliers?search=Alpha', {
        method: 'GET',
        headers: {
          Cookie: `__session=${userToken}`,
          'X-Business-Id': businessId,
        },
      }),
      env,
      executionCtx
    )
    expect(searchRes.status).toBe(200)
    const searchJson = (await searchRes.json()) as { data: Array<{ id: string }> }
    expect(searchJson.data.length).toBe(1)
    expect(searchJson.data[0].id).toBe('supp_1')
  })

  it('retrieves single supplier by ID and blocks cross-tenant access', async () => {
    // 1. Own supplier
    const ownRes = await worker.fetch(
      new Request('https://pos.internal/api/v1/suppliers/supp_1', {
        method: 'GET',
        headers: {
          Cookie: `__session=${userToken}`,
          'X-Business-Id': businessId,
        },
      }),
      env,
      executionCtx
    )
    expect(ownRes.status).toBe(200)
    const ownJson = (await ownRes.json()) as { data: { id: string; name: string } }
    expect(ownJson.data.id).toBe('supp_1')

    // 2. Cross-tenant supplier -> 404
    const crossRes = await worker.fetch(
      new Request('https://pos.internal/api/v1/suppliers/supp_other', {
        method: 'GET',
        headers: {
          Cookie: `__session=${userToken}`,
          'X-Business-Id': businessId,
        },
      }),
      env,
      executionCtx
    )
    expect(crossRes.status).toBe(404)
  })
})

