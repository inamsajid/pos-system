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

describe('Financial & Ledger Reports APIs (Step 12.6)', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const bizId = 'biz_fin_rep'
  const branchId = 'branch_fin_1'
  const ownerUserId = 'usr_fin_owner'
  let ownerToken: string

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

    // Seed Business & Branch
    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'BIZFIN', 'Financial Reports Corp', 'active')
    `).run(bizId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Headquarters', 1, 'active')
    `).run(branchId, bizId)

    // Seed Owner
    sqlite.prepare(`
      INSERT INTO users (id, email, password_hash, name, status)
      VALUES (?, 'owner@fin.pk', 'hash', 'Finance Director', 'active')
    `).run(ownerUserId)

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('bm_fin_owner', ?, ?, 'owner', 1)
    `).run(bizId, ownerUserId)

    const sess = await createSession(d1, ownerUserId)
    ownerToken = sess.token

    // Seed Customer & Supplier
    sqlite.prepare(`
      INSERT INTO customers (id, business_id, customer_code, name, phone, status)
      VALUES ('c_acme', ?, 'C-ACME', 'Acme Wholesale', '03001112222', 'active')
    `).run(bizId)

    sqlite.prepare(`
      INSERT INTO suppliers (id, business_id, supplier_code, name, company_name, phone, status)
      VALUES ('s_grain', ?, 'S-GRAIN', 'Grain Logistics', 'Grain Corp', '03219998888', 'active')
    `).run(bizId)
  })

  it('reports payments summary and payment methods breakdown accurately', async () => {
    // Seed 2 payments:
    // 1. 60,000 via Cash (allocated 50,000, unallocated 10,000)
    // 2. 40,000 via Card (allocated 40,000, unallocated 0)
    sqlite.prepare(`
      INSERT INTO payments (id, business_id, branch_id, receipt_number, customer_id, customer_snapshot_json, amount_minor, unallocated_amount_minor, business_date_key, received_by)
      VALUES
        ('pay_c', ?, ?, 'REC-C', 'c_acme', '{}', 60000, 10000, '2026-11-08', ?),
        ('pay_d', ?, ?, 'REC-D', 'c_acme', '{}', 40000, 0, '2026-11-08', ?)
    `).run(bizId, branchId, ownerUserId, bizId, branchId, ownerUserId)

    sqlite.prepare(`
      INSERT INTO payment_methods (id, payment_id, method, amount_minor)
      VALUES
        ('pm_c', 'pay_c', 'cash', 60000),
        ('pm_d', 'pay_d', 'card', 40000)
    `).run()

    // 1. Payments Summary
    const sumReq = new Request('http://localhost/api/v1/reports/payments/summary?fromDate=2026-11-01&toDate=2026-11-30', {
      headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': bizId },
    })
    const sumRes = await worker.fetch(sumReq, env, executionCtx)
    expect(sumRes.status).toBe(200)
    const sumJson = (await sumRes.json()) as { data: any }
    expect(sumJson.data.totalCollectedMinor).toBe(100000)
    expect(sumJson.data.totalPaymentsCount).toBe(2)
    expect(sumJson.data.cashCollectedMinor).toBe(60000)
    expect(sumJson.data.digitalCollectedMinor).toBe(40000)
    expect(sumJson.data.allocatedMinor).toBe(90000)
    expect(sumJson.data.unallocatedAdvanceMinor).toBe(10000)

    // 2. Payments by Method
    const methodReq = new Request('http://localhost/api/v1/reports/payments/by-method?fromDate=2026-11-01&toDate=2026-11-30', {
      headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': bizId },
    })
    const methodRes = await worker.fetch(methodReq, env, executionCtx)
    expect(methodRes.status).toBe(200)
    const methodJson = (await methodRes.json()) as { data: any[] }
    expect(methodJson.data.length).toBe(2)
    expect(methodJson.data[0].method).toBe('cash')
    expect(methodJson.data[0].totalAmountMinor).toBe(60000)
    expect(methodJson.data[0].percentage).toBe(60)
    expect(methodJson.data[1].method).toBe('card')
    expect(methodJson.data[1].totalAmountMinor).toBe(40000)
    expect(methodJson.data[1].percentage).toBe(40)
  })

  it('reports purchases summary and trends accurately', async () => {
    // Seed 2 purchases:
    // PO-1: ordered, total 150,000, paid 50,000
    // PO-2: received, total 80,000, paid 80,000
    // PO-3: cancelled, total 30,000, paid 0
    sqlite.prepare(`
      INSERT INTO purchases (
        id, business_id, branch_id, purchase_number, supplier_id, supplier_snapshot_json,
        subtotal_minor, discount_minor, tax_minor, total_amount_minor, paid_amount_minor,
        status, purchase_date_key, created_by
      ) VALUES
        ('po_1', ?, ?, 'PO-001', 's_grain', '{}', 150000, 0, 0, 150000, 50000, 'ordered', '2026-11-08', ?),
        ('po_2', ?, ?, 'PO-002', 's_grain', '{}', 80000, 0, 0, 80000, 80000, 'received', '2026-11-08', ?),
        ('po_3', ?, ?, 'PO-003', 's_grain', '{}', 30000, 0, 0, 30000, 0, 'cancelled', '2026-11-08', ?)
    `).run(bizId, branchId, ownerUserId, bizId, branchId, ownerUserId, bizId, branchId, ownerUserId)

    // Purchases Summary
    const poReq = new Request('http://localhost/api/v1/reports/purchases/summary?fromDate=2026-11-01&toDate=2026-11-30', {
      headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': bizId },
    })
    const poRes = await worker.fetch(poReq, env, executionCtx)
    expect(poRes.status).toBe(200)
    const poJson = (await poRes.json()) as { data: any }
    expect(poJson.data.totalPurchasesMinor).toBe(230000) // 150,000 + 80,000 (cancelled excluded)
    expect(poJson.data.totalPurchasesCount).toBe(3)
    expect(poJson.data.orderedPurchasesCount).toBe(1)
    expect(poJson.data.receivedPurchasesCount).toBe(1)
    expect(poJson.data.cancelledPurchasesCount).toBe(1)
    expect(poJson.data.paidAmountMinor).toBe(130000)
    expect(poJson.data.outstandingPayableMinor).toBe(100000)

    // Purchases Trends
    const trendsReq = new Request('http://localhost/api/v1/reports/purchases/trends?fromDate=2026-11-01&toDate=2026-11-30', {
      headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': bizId },
    })
    const trendsRes = await worker.fetch(trendsReq, env, executionCtx)
    expect(trendsRes.status).toBe(200)
    const trendsJson = (await trendsRes.json()) as { data: any[] }
    expect(trendsJson.data.length).toBe(1)
    expect(trendsJson.data[0].dateKey).toBe('2026-11-08')
    expect(trendsJson.data[0].totalAmountMinor).toBe(230000)
  })

  it('reports customer receivables and supplier payables balances', async () => {
    // 1. Customer has an unpaid sale of 35,000
    sqlite.prepare(`
      INSERT INTO sales (
        id, business_id, branch_id, sale_number, receipt_number, invoice_number,
        customer_id, customer_snapshot_json, cashier_id, cashier_name,
        subtotal_minor, discount_minor, tax_minor, total_amount_minor,
        amount_paid_minor, remaining_balance_minor, status, business_date_key
      ) VALUES
        ('s_rec', ?, ?, 'S-REC', 'R-REC', 'I-REC', 'c_acme', '{}', ?, 'Owner', 35000, 0, 0, 35000, 0, 35000, 'completed', '2026-11-08')
    `).run(bizId, branchId, ownerUserId)

    // 2. Supplier has an unpaid purchase of 45,000
    sqlite.prepare(`
      INSERT INTO purchases (
        id, business_id, branch_id, purchase_number, supplier_id, supplier_snapshot_json,
        subtotal_minor, discount_minor, tax_minor, total_amount_minor, paid_amount_minor,
        status, purchase_date_key, created_by
      ) VALUES
        ('po_pay', ?, ?, 'PO-PAY', 's_grain', '{}', 45000, 0, 0, 45000, 0, 'ordered', '2026-11-08', ?)
    `).run(bizId, branchId, ownerUserId)

    // Check Customer Receivables
    const custReq = new Request('http://localhost/api/v1/reports/customers/receivables', {
      headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': bizId },
    })
    const custRes = await worker.fetch(custReq, env, executionCtx)
    expect(custRes.status).toBe(200)
    const custJson = (await custRes.json()) as { data: any[] }
    expect(custJson.data.length).toBe(1)
    expect(custJson.data[0].customerName).toBe('Acme Wholesale')
    expect(custJson.data[0].balanceMinor).toBe(35000)

    // Check Supplier Payables
    const suppReq = new Request('http://localhost/api/v1/reports/suppliers/payables', {
      headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': bizId },
    })
    const suppRes = await worker.fetch(suppReq, env, executionCtx)
    expect(suppRes.status).toBe(200)
    const suppJson = (await suppRes.json()) as { data: any[] }
    expect(suppJson.data.length).toBe(1)
    expect(suppJson.data[0].supplierName).toBe('Grain Logistics')
    expect(suppJson.data[0].balanceMinor).toBe(45000)
  })
})

