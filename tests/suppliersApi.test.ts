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

describe('Supplier Master Data API (/api/v1/suppliers)', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const businessAId = 'biz_sup_a'
  const businessBId = 'biz_sup_b'
  const userAId = 'usr_sup_a'
  const userBId = 'usr_sup_b'
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
      VALUES ('${businessAId}', 'BIZ-SUP-A', 'Business A Suppliers', 'PKR', 'Asia/Karachi', 'active'),
             ('${businessBId}', 'BIZ-SUP-B', 'Business B Suppliers', 'PKR', 'Asia/Karachi', 'active');

      INSERT INTO users (id, email, name, password_hash, status)
      VALUES ('${userAId}', 'sup.owner.a@example.com', 'Owner A', 'pbkdf2:hash', 'active'),
             ('${userBId}', 'sup.owner.b@example.com', 'Owner B', 'pbkdf2:hash', 'active');

      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('bm_sup_a', '${businessAId}', '${userAId}', 'owner', 1),
             ('bm_sup_b', '${businessBId}', '${userBId}', 'owner', 1);

      INSERT INTO categories (id, business_id, name, slug)
      VALUES ('cat_sup_1', '${businessAId}', 'Beverages', 'beverages');

      INSERT INTO products (id, business_id, category_id, name, sku, unit, purchase_price_minor, selling_price_minor)
      VALUES ('prod_sup_1', '${businessAId}', 'cat_sup_1', 'Mineral Water 500ml', 'SKU-WATER-500', 'piece', 3000, 5000);
    `)

    const sA = await createSession(d1, userAId, '127.0.0.1', 'Vitest')
    sessionTokenA = sA.token

    const sB = await createSession(d1, userBId, '127.0.0.1', 'Vitest')
    sessionTokenB = sB.token
  })

  it('POST /api/v1/suppliers creates a supplier with auto-generated supplier code', async () => {
    const payload = {
      name: 'Nestle Pakistan Distribution',
      type: 'business',
      companyName: 'Nestle Pakistan Ltd',
      contactPerson: 'Zubair Shah',
      phone: '+92 42 111 637 853',
      city: 'Lahore',
      country: 'Pakistan',
      taxNumber: 'STRN-0301-2948192',
      openingPayableMinor: 1000000,
    }

    const req = new Request('http://localhost:8787/api/v1/suppliers', {
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

    const json = (await res.json()) as { success: boolean; data: { id: string; supplierCode: string; name: string; contactPerson: string } }
    expect(json.success).toBe(true)
    expect(json.data.name).toBe('Nestle Pakistan Distribution')
    expect(json.data.supplierCode).toMatch(/^SUP-\d+$/)
    expect(json.data.contactPerson).toBe('Zubair Shah')

    // Verify D1 persistence
    const row = sqlite.prepare('SELECT * FROM suppliers WHERE id = ?').get(json.data.id) as { name: string; business_id: string }
    expect(row).toBeDefined()
    expect(row.name).toBe('Nestle Pakistan Distribution')
    expect(row.business_id).toBe(businessAId)
  })

  it('POST /api/v1/suppliers rejects duplicate supplier name within the same tenant', async () => {
    const payload = {
      name: 'Unilever Distribution',
      type: 'business',
    }

    const req1 = new Request('http://localhost:8787/api/v1/suppliers', {
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

    const req2 = new Request('http://localhost:8787/api/v1/suppliers', {
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

  it('enforces tenant isolation: Supplier from Business A cannot be accessed by Business B', async () => {
    const reqCreate = new Request('http://localhost:8787/api/v1/suppliers', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionTokenA}`,
        'X-Business-Id': businessAId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Business A Sole Supplier' }),
    })
    const resCreate = await worker.fetch(reqCreate, env, executionCtx)
    const created = (await resCreate.json()) as { data: { id: string } }

    const reqGetB = new Request(`http://localhost:8787/api/v1/suppliers/${created.data.id}`, {
      headers: {
        Authorization: `Bearer ${sessionTokenB}`,
        'X-Business-Id': businessBId,
      },
    })
    const resGetB = await worker.fetch(reqGetB, env, executionCtx)
    expect(resGetB.status).toBe(404)
  })

  it('PATCH /api/v1/suppliers/:id updates supplier information', async () => {
    const reqCreate = new Request('http://localhost:8787/api/v1/suppliers', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionTokenA}`,
        'X-Business-Id': businessAId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Supplier To Update', city: 'Karachi' }),
    })
    const resCreate = await worker.fetch(reqCreate, env, executionCtx)
    const created = (await resCreate.json()) as { data: { id: string } }

    const reqUpdate = new Request(`http://localhost:8787/api/v1/suppliers/${created.data.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${sessionTokenA}`,
        'X-Business-Id': businessAId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ city: 'Faisalabad', contactPerson: 'Hassan Ali' }),
    })
    const resUpdate = await worker.fetch(reqUpdate, env, executionCtx)
    expect(resUpdate.status).toBe(200)

    const updatedJson = (await resUpdate.json()) as { data: { city: string; contactPerson: string } }
    expect(updatedJson.data.city).toBe('Faisalabad')
    expect(updatedJson.data.contactPerson).toBe('Hassan Ali')
  })

  it('manages supplier product associations correctly', async () => {
    const reqCreate = new Request('http://localhost:8787/api/v1/suppliers', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionTokenA}`,
        'X-Business-Id': businessAId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Beverages Wholesale' }),
    })
    const resCreate = await worker.fetch(reqCreate, env, executionCtx)
    const created = (await resCreate.json()) as { data: { id: string } }
    const supplierId = created.data.id

    // Associate product
    const assocPayload = {
      productId: 'prod_sup_1',
      supplierSku: 'NEST-WTR-500',
      purchasePriceMinor: 2800,
      isPreferred: true,
    }

    const reqAssoc = new Request(`http://localhost:8787/api/v1/suppliers/${supplierId}/products`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionTokenA}`,
        'X-Business-Id': businessAId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(assocPayload),
    })

    const resAssoc = await worker.fetch(reqAssoc, env, executionCtx)
    expect(resAssoc.status).toBe(201)

    // List supplier products
    const reqList = new Request(`http://localhost:8787/api/v1/suppliers/${supplierId}/products`, {
      headers: {
        Authorization: `Bearer ${sessionTokenA}`,
        'X-Business-Id': businessAId,
      },
    })
    const resList = await worker.fetch(reqList, env, executionCtx)
    expect(resList.status).toBe(200)

    const listJson = (await resList.json()) as { success: boolean; data: Array<{ productId: string; supplierSku: string; purchasePriceMinor: number }> }
    expect(listJson.data.length).toBe(1)
    expect(listJson.data[0].productId).toBe('prod_sup_1')
    expect(listJson.data[0].supplierSku).toBe('NEST-WTR-500')
    expect(listJson.data[0].purchasePriceMinor).toBe(2800)
  })
})
