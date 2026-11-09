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

describe('Supplier Ledger & Financial Statement APIs', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const businessId = 'biz_sl_test'
  const branchId = 'branch_sl_main'
  const ownerUserId = 'usr_sl_owner'
  let ownerToken: string

  const supplierId = 'supp_sl_1'

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
      VALUES (?, 'BIZSL', 'Apex Accounting Group', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Central Accounting HQ', 1, 'active')
    `).run(branchId, businessId)

    // Seed Owner
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'owner@apexsl.pk', 'Accountant General', 'dummy_hash', 'active')
    `).run(ownerUserId)

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_sl_owner', ?, ?, 'owner', 1)
    `).run(businessId, ownerUserId)

    // Seed Supplier with Rs 50,000 minor opening payable
    sqlite.prepare(`
      INSERT INTO suppliers (id, business_id, supplier_code, name, company_name, contact_person, phone, email, tax_number, opening_payable_minor, status)
      VALUES (?, ?, 'SUPP-SL-01', 'Samsung Electronics PK', 'Samsung Ltd', 'Mr. Tariq', '03001239876', 'finance@samsung.pk', 'NTN889900', 50000, 'active')
    `).run(supplierId, businessId)

    // Seed 4 Ledger entries across dates:
    // 1. 2026-11-01: Bill Rs 200,000 (credit) -> balance = 50,000 + 200,000 = 250,000
    // 2. 2026-11-03: Payment Rs 150,000 (debit) -> balance = 250,000 - 150,000 = 100,000
    // 3. 2026-11-05: Bill Rs 400,000 (credit) -> balance = 100,000 + 400,000 = 500,000
    // 4. 2026-11-08: Payment Rs 200,000 (debit) -> balance = 500,000 - 200,000 = 300,000
    sqlite.prepare(`
      INSERT INTO supplier_ledger_transactions (id, business_id, branch_id, supplier_id, type, reference_id, reference_number, description, debit_minor, credit_minor, balance_minor, business_date_key, created_at)
      VALUES ('slt_1', ?, ?, ?, 'bill', 'po_1', 'PO-1001', 'Goods receipt PO-1001', 0, 200000, 250000, '2026-11-01', '2026-11-01 10:00:00'),
             ('slt_2', ?, ?, ?, 'payment', 'pay_1', 'SPAY-1001', 'Supplier payment SPAY-1001', 150000, 0, 100000, '2026-11-03', '2026-11-03 12:00:00'),
             ('slt_3', ?, ?, ?, 'bill', 'po_2', 'PO-1002', 'Goods receipt PO-1002', 0, 400000, 500000, '2026-11-05', '2026-11-05 14:00:00'),
             ('slt_4', ?, ?, ?, 'payment', 'pay_2', 'SPAY-1002', 'Supplier payment SPAY-1002', 200000, 0, 300000, '2026-11-08', '2026-11-08 16:00:00')
    `).run(
      businessId, branchId, supplierId,
      businessId, branchId, supplierId,
      businessId, branchId, supplierId,
      businessId, branchId, supplierId
    )

    // Seed Purchases for summary testing:
    // PO 1: total 200,000, paid 200,000, status 'received'
    // PO 2: total 400,000, paid 150,000, status 'received' (remaining unpaid 250,000)
    sqlite.prepare(`
      INSERT INTO purchases (id, business_id, branch_id, purchase_number, supplier_id, supplier_snapshot_json, subtotal_minor, discount_minor, tax_minor, total_amount_minor, paid_amount_minor, status, purchase_date_key, created_by)
      VALUES ('po_1', ?, ?, 'PO-1001', ?, '{}', 200000, 0, 0, 200000, 200000, 'received', '2026-11-01', ?),
             ('po_2', ?, ?, 'PO-1002', ?, '{}', 400000, 0, 0, 400000, 150000, 'received', '2026-11-05', ?)
    `).run(businessId, branchId, supplierId, ownerUserId, businessId, branchId, supplierId, ownerUserId)

    // Seed Supplier Payments for summary testing
    sqlite.prepare(`
      INSERT INTO supplier_payments (id, business_id, branch_id, receipt_number, supplier_id, supplier_snapshot_json, amount_minor, unallocated_amount_minor, method, business_date_key, paid_by)
      VALUES ('pay_1', ?, ?, 'SPAY-1001', ?, '{}', 150000, 0, 'cash', '2026-11-03', ?),
             ('pay_2', ?, ?, 'SPAY-1002', ?, '{}', 200000, 0, 'bank_transfer', '2026-11-08', ?)
    `).run(businessId, branchId, supplierId, ownerUserId, businessId, branchId, supplierId, ownerUserId)

    ownerToken = (await createSession(d1, ownerUserId)).token
  })

  it('generates accurate chronological supplier statement with running balances and double-entry invariants', async () => {
    const res = await worker.fetch(
      new Request(`https://pos.internal/api/v1/suppliers/${supplierId}/ledger`, {
        method: 'GET',
        headers: {
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
        },
      }),
      env,
      executionCtx
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      data: {
        supplierId: string
        supplierName: string
        openingBalanceMinor: number
        closingBalanceMinor: number
        totalDebitsMinor: number
        totalCreditsMinor: number
        netChangeMinor: number
        entries: Array<{
          id: string
          type: string
          debitMinor: number
          creditMinor: number
          balanceMinor: number
          businessDateKey: string
        }>
        meta: { totalCount: number }
      }
    }

    const stmt = json.data
    expect(stmt.supplierId).toBe(supplierId)
    expect(stmt.openingBalanceMinor).toBe(50000)
    expect(stmt.totalDebitsMinor).toBe(350000) // 150,000 + 200,000
    expect(stmt.totalCreditsMinor).toBe(600000) // 200,000 + 400,000
    expect(stmt.netChangeMinor).toBe(250000) // 600,000 - 350,000
    expect(stmt.closingBalanceMinor).toBe(300000) // 50,000 + 250,000 = 300,000
    expect(stmt.entries.length).toBe(4)

    // Check chronological order and individual line running balances
    expect(stmt.entries[0].type).toBe('bill')
    expect(stmt.entries[0].balanceMinor).toBe(250000)

    expect(stmt.entries[1].type).toBe('payment')
    expect(stmt.entries[1].balanceMinor).toBe(100000)

    expect(stmt.entries[2].type).toBe('bill')
    expect(stmt.entries[2].balanceMinor).toBe(500000)

    expect(stmt.entries[3].type).toBe('payment')
    expect(stmt.entries[3].balanceMinor).toBe(300000)
  })

  it('filters statement by date range and calculates correct period opening balance', async () => {
    // Filter from 2026-11-04 onwards
    // Prior balance before 2026-11-04 was 100,000 (after entry 2 on Nov 3)
    const res = await worker.fetch(
      new Request(`https://pos.internal/api/v1/suppliers/${supplierId}/ledger?startDate=2026-11-04`, {
        method: 'GET',
        headers: {
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
        },
      }),
      env,
      executionCtx
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      data: {
        openingBalanceMinor: number
        closingBalanceMinor: number
        totalDebitsMinor: number
        totalCreditsMinor: number
        entries: unknown[]
      }
    }

    const stmt = json.data
    expect(stmt.openingBalanceMinor).toBe(100000)
    expect(stmt.entries.length).toBe(2) // entries 3 and 4
    expect(stmt.totalCreditsMinor).toBe(400000)
    expect(stmt.totalDebitsMinor).toBe(200000)
    expect(stmt.closingBalanceMinor).toBe(300000) // 100,000 + (400,000 - 200,000) = 300,000
  })

  it('filters statement by transaction type', async () => {
    const res = await worker.fetch(
      new Request(`https://pos.internal/api/v1/suppliers/${supplierId}/ledger?type=payment`, {
        method: 'GET',
        headers: {
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
        },
      }),
      env,
      executionCtx
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: { entries: Array<{ type: string }> } }
    expect(json.data.entries.length).toBe(2)
    expect(json.data.entries.every((e) => e.type === 'payment')).toBe(true)
  })

  it('returns supplier financial summary metrics', async () => {
    const res = await worker.fetch(
      new Request(`https://pos.internal/api/v1/suppliers/${supplierId}/ledger/summary`, {
        method: 'GET',
        headers: {
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
        },
      }),
      env,
      executionCtx
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      data: {
        supplierId: string
        openingPayableMinor: number
        currentPayableMinor: number
        totalBilledMinor: number
        totalPaidMinor: number
        openPurchasesCount: number
      }
    }

    const summary = json.data
    expect(summary.supplierId).toBe(supplierId)
    expect(summary.openingPayableMinor).toBe(50000)
    expect(summary.currentPayableMinor).toBe(300000)
    expect(summary.totalBilledMinor).toBe(600000)
    expect(summary.totalPaidMinor).toBe(350000)
    expect(summary.openPurchasesCount).toBe(1) // PO 2 has remaining unpaid
  })

  it('returns 404 for nonexistent supplier ledger request', async () => {
    const res = await worker.fetch(
      new Request('https://pos.internal/api/v1/suppliers/nonexistent_id/ledger', {
        method: 'GET',
        headers: {
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
        },
      }),
      env,
      executionCtx
    )
    expect(res.status).toBe(404)
  })
})

