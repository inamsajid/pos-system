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

describe('Step 14.1 — Customer and Supplier Ledgers API & Navigation', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const businessId = 'biz_ledger_14'
  const branchId = 'br_ledger_14'
  const ownerUserId = 'usr_owner_ledger'
  let token: string

  const customerId = 'cust_ledger_01'
  const supplierId = 'supp_ledger_01'

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
      FILES: {} as unknown as R2Bucket,
      ENVIRONMENT: 'local',
      SERVICE_NAME: 'pos-system-api',
      API_VERSION: 'v1',
    }

    // Seed Business & Branch
    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'BIZLEDGER', 'Ledger Retail Mart', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'BRMAIN', 'Main Central Branch', 1, 'active')
    `).run(branchId, businessId)

    // Seed Owner User & Membership
    sqlite.prepare(`
      INSERT INTO users (id, email, name, status)
      VALUES (?, 'ledger.owner@example.com', 'Ledger Owner', 'active')
    `).run(ownerUserId)

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('bm_ledger_owner', ?, ?, 'owner', 1)
    `).run(businessId, ownerUserId)

    const session = await createSession(d1, ownerUserId)
    token = session.token

    // Seed Customer with opening_balance_minor = 500000
    sqlite.prepare(`
      INSERT INTO customers (id, business_id, customer_code, name, phone, email, is_walk_in, status, opening_balance_minor)
      VALUES (?, ?, 'CUS-1001', 'Tariq Mehmood', '+923001122334', 'tariq@test.com', 0, 'active', 500000)
    `).run(customerId, businessId)

    // Seed Customer Ledger Transactions:
    // Debit increases receivable (invoices/opening), Credit decreases receivable (payments)
    sqlite.prepare(`
      INSERT INTO customer_ledger_transactions (
        id, business_id, branch_id, customer_id, type, reference_id, reference_number, description, debit_minor, credit_minor, balance_minor, business_date_key, created_at
      ) VALUES
      ('cl_01', ?, ?, ?, 'opening', 'OPEN-01', 'OPEN-01', 'Opening balance', 500000, 0, 500000, '2026-11-01', '2026-11-01T09:00:00Z'),
      ('cl_02', ?, ?, ?, 'invoice', 'INV-001', 'INV-001', 'Retail invoice', 350000, 0, 850000, '2026-11-02', '2026-11-02T10:30:00Z'),
      ('cl_03', ?, ?, ?, 'payment', 'PAY-001', 'PAY-001', 'Customer payment', 0, 600000, 250000, '2026-11-05', '2026-11-05T14:00:00Z')
    `).run(
      businessId, branchId, customerId,
      businessId, branchId, customerId,
      businessId, branchId, customerId
    )

    // Seed Supplier with opening_payable_minor = 800000
    sqlite.prepare(`
      INSERT INTO suppliers (id, business_id, supplier_code, name, contact_person, phone, email, status, opening_payable_minor)
      VALUES (?, ?, 'SUP-1001', 'Al-Rahim Traders', 'Abdul Rahim', '+923214455667', 'rahim@test.com', 'active', 800000)
    `).run(supplierId, businessId)

    // Seed Supplier Ledger Transactions:
    // Credit increases payable (bills/opening), Debit decreases payable (payments)
    sqlite.prepare(`
      INSERT INTO supplier_ledger_transactions (
        id, business_id, branch_id, supplier_id, type, reference_id, reference_number, description, debit_minor, credit_minor, balance_minor, business_date_key, created_at
      ) VALUES
      ('sl_01', ?, ?, ?, 'opening', 'OPEN-01', 'OPEN-01', 'Opening payable', 0, 800000, 800000, '2026-11-01', '2026-11-01T09:00:00Z'),
      ('sl_02', ?, ?, ?, 'bill', 'PUR-001', 'PUR-001', 'Purchase bill', 0, 450000, 1250000, '2026-11-03', '2026-11-03T11:00:00Z'),
      ('sl_03', ?, ?, ?, 'payment', 'SPAY-001', 'SPAY-001', 'Supplier payment', 700000, 0, 550000, '2026-11-06', '2026-11-06T15:00:00Z')
    `).run(
      businessId, branchId, supplierId,
      businessId, branchId, supplierId,
      businessId, branchId, supplierId
    )
  })

  it('retrieves detailed customer ledger statement and summary with running balance', async () => {
    // Test Statement
    const req = new Request(`https://api.pos.local/api/v1/customers/${customerId}/ledger`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Business-Id': businessId,
        'X-Branch-Id': branchId,
      },
    })
    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(200)

    const json = (await res.json()) as any
    expect(json.success).toBe(true)
    const data = json.data
    expect(data.customerId).toBe(customerId)
    expect(data.customerName).toBe('Tariq Mehmood')
    expect(data.entries.length).toBe(3)
    expect(data.closingBalanceMinor).toBe(750000)

    // Test Summary
    const sumReq = new Request(`https://api.pos.local/api/v1/customers/${customerId}/ledger/summary`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Business-Id': businessId,
      },
    })
    const sumRes = await worker.fetch(sumReq, env, executionCtx)
    expect(sumRes.status).toBe(200)

    const sumJson = (await sumRes.json()) as any
    expect(sumJson.success).toBe(true)
    const sumData = sumJson.data
    expect(sumData.customerId).toBe(customerId)
    expect(sumData.openingBalanceMinor).toBe(500000)
    expect(sumData.currentBalanceMinor).toBe(250000)
  })

  it('retrieves detailed supplier ledger statement and summary with running balance', async () => {
    // Test Statement
    const req = new Request(`https://api.pos.local/api/v1/suppliers/${supplierId}/ledger`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Business-Id': businessId,
        'X-Branch-Id': branchId,
      },
    })
    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(200)

    const json = (await res.json()) as any
    expect(json.success).toBe(true)
    const data = json.data
    expect(data.supplierId).toBe(supplierId)
    expect(data.supplierName).toBe('Al-Rahim Traders')
    expect(data.entries.length).toBe(3)
    expect(data.closingBalanceMinor).toBe(1350000)

    // Test Summary
    const sumReq = new Request(`https://api.pos.local/api/v1/suppliers/${supplierId}/ledger/summary`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Business-Id': businessId,
      },
    })
    const sumRes = await worker.fetch(sumReq, env, executionCtx)
    expect(sumRes.status).toBe(200)

    const sumJson = (await sumRes.json()) as any
    expect(sumJson.success).toBe(true)
    const sumData = sumJson.data
    expect(sumData.supplierId).toBe(supplierId)
    expect(sumData.openingPayableMinor).toBe(800000)
    expect(sumData.currentPayableMinor).toBe(550000)
  })

  it('filters customer ledger by date range and branch isolation', async () => {
    const req = new Request(
      `https://api.pos.local/api/v1/customers/${customerId}/ledger?startDate=2026-11-02&endDate=2026-11-04`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
      }
    )
    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(200)

    const json = (await res.json()) as any
    expect(json.success).toBe(true)
    const data = json.data
    expect(data.entries.length).toBe(1)
    expect(data.entries[0].referenceId).toBe('INV-001')
  })
})
