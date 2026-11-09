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

describe('Customer Master Data API (/api/v1/customers)', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const businessAId = 'biz_cust_a'
  const businessBId = 'biz_cust_b'
  const userAId = 'usr_cust_a'
  const userBId = 'usr_cust_b'
  let sessionTokenA: string
  let sessionTokenB: string

  beforeEach(async () => {
    sqlite = new DatabaseSync(':memory:')
    sqlite.exec('PRAGMA foreign_keys = ON;')

    const migrationsDir = path.resolve(process.cwd(), 'worker/migrations')
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
      sqlite.exec(sql)
    }

    d1 = createRealD1(sqlite)
    env = {
      DB: d1,
      ENVIRONMENT: 'test',
      TIMEZONE: 'Asia/Karachi',
    } as unknown as Env

    // Seed Business A & Business B
    sqlite.exec(`
      INSERT INTO businesses (id, business_code, name, currency, timezone, status)
      VALUES ('${businessAId}', 'BIZ-CUST-A', 'Business A Customers', 'PKR', 'Asia/Karachi', 'active'),
             ('${businessBId}', 'BIZ-CUST-B', 'Business B Customers', 'PKR', 'Asia/Karachi', 'active');

      INSERT INTO users (id, email, name, password_hash, status)
      VALUES ('${userAId}', 'owner.a@example.com', 'Owner A', 'pbkdf2:hash', 'active'),
             ('${userBId}', 'owner.b@example.com', 'Owner B', 'pbkdf2:hash', 'active');

      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('bm_cust_a', '${businessAId}', '${userAId}', 'owner', 1),
             ('bm_cust_b', '${businessBId}', '${userBId}', 'owner', 1);

      INSERT INTO customers (id, business_id, customer_code, name, type, is_walk_in, status)
      VALUES ('walkin_a', '${businessAId}', 'WALKIN', 'Walk-in Customer', 'individual', 1, 'active'),
             ('walkin_b', '${businessBId}', 'WALKIN', 'Walk-in Customer', 'individual', 1, 'active');
    `)

    const sA = await createSession(d1, userAId, '127.0.0.1', 'Vitest')
    sessionTokenA = sA.session.token

    const sB = await createSession(d1, userBId, '127.0.0.1', 'Vitest')
    sessionTokenB = sB.session.token
  })

  it('GET /api/v1/customers lists customers scoped to the active business', async () => {
    const req = new Request('http://localhost:8787/api/v1/customers', {
      headers: {
        Authorization: `Bearer ${sessionTokenA}`,
        'X-Business-Id': businessAId,
      },
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(200)

    const json = (await res.json()) as { success: boolean; data: Array<{ id: string; name: string }>; meta: { total: number } }
    expect(json.success).toBe(true)
    expect(json.data.length).toBeGreaterThanOrEqual(1)
    expect(json.data[0].name).toBe('Walk-in Customer')
    expect(json.meta.total).toBe(1)
  })

  it('POST /api/v1/customers creates a new customer profile with generated code', async () => {
    const payload = {
      name: 'Tariq Mehmood',
      type: 'individual',
      phone: '+92 300 9876543',
      email: 'tariq@example.com',
      city: 'Lahore',
      address: 'Gulberg III',
      creditLimitMinor: 500000,
    }

    const req = new Request('http://localhost:8787/api/v1/customers', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionTokenA}`,
        'X-Business-Id': businessAId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(201)

    const json = (await res.json()) as { success: boolean; data: { id: string; customerCode: string; name: string; city: string; creditLimitMinor: number } }
    expect(json.success).toBe(true)
    expect(json.data.name).toBe('Tariq Mehmood')
    expect(json.data.customerCode).toMatch(/^CUS-\d+$/)
    expect(json.data.city).toBe('Lahore')
    expect(json.data.creditLimitMinor).toBe(500000)

    // Verify persisted in D1
    const row = sqlite.prepare('SELECT * FROM customers WHERE id = ?').get(json.data.id) as { name: string; business_id: string }
    expect(row).toBeDefined()
    expect(row.name).toBe('Tariq Mehmood')
    expect(row.business_id).toBe(businessAId)
  })

  it('POST /api/v1/customers rejects duplicate customer name in the same business', async () => {
    const payload = {
      name: 'Duplicate Customer',
      type: 'individual',
    }

    const req1 = new Request('http://localhost:8787/api/v1/customers', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionTokenA}`,
        'X-Business-Id': businessAId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const res1 = await worker.fetch(req1, env, executionCtx)
    expect(res1.status).toBe(201)

    const req2 = new Request('http://localhost:8787/api/v1/customers', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionTokenA}`,
        'X-Business-Id': businessAId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const res2 = await worker.fetch(req2, env, executionCtx)
    expect(res2.status).toBe(409)
  })

  it('enforces strict tenant isolation between businesses', async () => {
    // Create customer in Business A
    const reqCreate = new Request('http://localhost:8787/api/v1/customers', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionTokenA}`,
        'X-Business-Id': businessAId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Tenant A Customer' }),
    })
    const resCreate = await worker.fetch(reqCreate, env, executionCtx)
    const created = (await resCreate.json()) as { data: { id: string } }
    const customerAId = created.data.id

    // Try to access from Business B
    const reqGetFromB = new Request(`http://localhost:8787/api/v1/customers/${customerAId}`, {
      headers: {
        Authorization: `Bearer ${sessionTokenB}`,
        'X-Business-Id': businessBId,
      },
    })
    const resGetFromB = await worker.fetch(reqGetFromB, env, executionCtx)
    expect(resGetFromB.status).toBe(404)
  })

  it('PATCH /api/v1/customers/:id updates customer profile fields', async () => {
    const reqCreate = new Request('http://localhost:8787/api/v1/customers', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionTokenA}`,
        'X-Business-Id': businessAId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Editable Customer', city: 'Karachi' }),
    })
    const resCreate = await worker.fetch(reqCreate, env, executionCtx)
    const created = (await resCreate.json()) as { data: { id: string } }

    const reqUpdate = new Request(`http://localhost:8787/api/v1/customers/${created.data.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${sessionTokenA}`,
        'X-Business-Id': businessAId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ city: 'Islamabad', phone: '+92 321 0000000' }),
    })
    const resUpdate = await worker.fetch(reqUpdate, env, executionCtx)
    expect(resUpdate.status).toBe(200)

    const updatedJson = (await resUpdate.json()) as { data: { city: string; phone: string } }
    expect(updatedJson.data.city).toBe('Islamabad')
    expect(updatedJson.data.phone).toBe('+92 321 0000000')
  })

  it('protects Walk-in customer from modification or archival', async () => {
    const reqUpdate = new Request(`http://localhost:8787/api/v1/customers/walkin_a`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${sessionTokenA}`,
        'X-Business-Id': businessAId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Changed Walk-in' }),
    })
    const resUpdate = await worker.fetch(reqUpdate, env, executionCtx)
    expect(resUpdate.status).toBe(400)

    const reqArchive = new Request(`http://localhost:8787/api/v1/customers/walkin_a`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${sessionTokenA}`,
        'X-Business-Id': businessAId,
      },
    })
    const resArchive = await worker.fetch(reqArchive, env, executionCtx)
    expect(resArchive.status).toBe(400)
  })

  it('DELETE /api/v1/customers/:id archives regular customer', async () => {
    const reqCreate = new Request('http://localhost:8787/api/v1/customers', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionTokenA}`,
        'X-Business-Id': businessAId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'To Be Archived' }),
    })
    const resCreate = await worker.fetch(reqCreate, env, executionCtx)
    const created = (await resCreate.json()) as { data: { id: string } }

    const reqDelete = new Request(`http://localhost:8787/api/v1/customers/${created.data.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${sessionTokenA}`,
        'X-Business-Id': businessAId,
      },
    })
    const resDelete = await worker.fetch(reqDelete, env, executionCtx)
    expect(resDelete.status).toBe(200)

    const deletedJson = (await resDelete.json()) as { data: { status: string } }
    expect(deletedJson.data.status).toBe('archived')
  })
})
