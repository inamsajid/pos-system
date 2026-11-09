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

describe('Business Settings API (/api/v1/settings)', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const businessAId = 'biz_set_a'
  const businessBId = 'biz_set_b'
  const ownerId = 'usr_set_owner'
  const cashierId = 'usr_set_cashier'
  let ownerToken: string
  let cashierToken: string

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

    // Seed Business A & Business B with owner and cashier roles
    sqlite.exec(`
      INSERT INTO businesses (id, business_code, name, currency, timezone, status)
      VALUES ('${businessAId}', 'BIZ-SET-A', 'Business A Settings', 'PKR', 'Asia/Karachi', 'active'),
             ('${businessBId}', 'BIZ-SET-B', 'Business B Settings', 'PKR', 'Asia/Karachi', 'active');

      INSERT INTO users (id, email, name, password_hash, status)
      VALUES ('${ownerId}', 'owner.set@example.com', 'Owner User', 'pbkdf2:hash', 'active'),
             ('${cashierId}', 'cashier.set@example.com', 'Cashier User', 'pbkdf2:hash', 'active');

      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('bm_set_owner', '${businessAId}', '${ownerId}', 'owner', 1),
             ('bm_set_cashier', '${businessAId}', '${cashierId}', 'cashier', 1);
    `)

    const sOwner = await createSession(d1, ownerId, '127.0.0.1', 'Vitest')
    ownerToken = sOwner.session.token

    const sCashier = await createSession(d1, cashierId, '127.0.0.1', 'Vitest')
    cashierToken = sCashier.session.token
  })

  it('GET /api/v1/settings fetches configuration and auto-initializes defaults', async () => {
    const req = new Request('http://localhost:8787/api/v1/settings', {
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'X-Business-Id': businessAId,
      },
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(200)

    const json = (await res.json()) as { success: boolean; data: { name: string; currency: string; defaultTaxRate: number; allowNegativeStock: boolean; maxVoidHours: number } }
    expect(json.success).toBe(true)
    expect(json.data.name).toBe('Business A Settings')
    expect(json.data.currency).toBe('PKR')
    expect(json.data.defaultTaxRate).toBe(0.0)
    expect(json.data.allowNegativeStock).toBe(true)
    expect(json.data.maxVoidHours).toBe(24)
  })

  it('PATCH /api/v1/settings updates business profile and operational parameters', async () => {
    const payload = {
      name: 'Northstar Mega Store',
      legalName: 'Northstar Mega Store Pvt Ltd',
      taxNumber: 'NTN-7771234',
      currency: 'PKR',
      defaultTaxRate: 16.5,
      receiptHeader: 'Shop with pride at Northstar!',
      receiptFooter: 'No returns without original barcode receipt.',
      allowNegativeStock: false,
      maxVoidHours: 48,
    }

    const req = new Request('http://localhost:8787/api/v1/settings', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'X-Business-Id': businessAId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(200)

    const json = (await res.json()) as { success: boolean; data: { name: string; defaultTaxRate: number; allowNegativeStock: boolean; maxVoidHours: number; receiptHeader: string } }
    expect(json.success).toBe(true)
    expect(json.data.name).toBe('Northstar Mega Store')
    expect(json.data.defaultTaxRate).toBe(16.5)
    expect(json.data.allowNegativeStock).toBe(false)
    expect(json.data.maxVoidHours).toBe(48)
    expect(json.data.receiptHeader).toBe('Shop with pride at Northstar!')

    // Verify D1 records
    const bizRow = sqlite.prepare('SELECT name, tax_number FROM businesses WHERE id = ?').get(businessAId) as { name: string; tax_number: string }
    expect(bizRow.name).toBe('Northstar Mega Store')
    expect(bizRow.tax_number).toBe('NTN-7771234')

    const setRow = sqlite.prepare('SELECT default_tax_rate, allow_negative_stock, max_void_hours FROM business_settings WHERE business_id = ?').get(businessAId) as { default_tax_rate: number; allow_negative_stock: number; max_void_hours: number }
    expect(setRow.default_tax_rate).toBe(16.5)
    expect(setRow.allow_negative_stock).toBe(0)
    expect(setRow.max_void_hours).toBe(48)
  })

  it('enforces RBAC: Cashiers cannot modify business settings (HTTP 403 Forbidden)', async () => {
    const payload = {
      defaultTaxRate: 5.0,
    }

    const req = new Request('http://localhost:8787/api/v1/settings', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${cashierToken}`,
        'X-Business-Id': businessAId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(403)
  })
})
