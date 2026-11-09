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

describe('CSV Reports Export & Formula Injection Protection (Step 12.6)', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const bizId = 'biz_csv_rep'
  const branchId = 'branch_csv_1'
  const ownerUserId = 'usr_csv_owner'
  const cashierUserId = 'usr_csv_cashier'
  let ownerToken: string
  let cashierToken: string

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
      VALUES (?, 'BIZCSV', 'Export Corp', 'active')
    `).run(bizId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Export Branch', 1, 'active')
    `).run(branchId, bizId)

    // Seed Users
    sqlite.prepare(`
      INSERT INTO users (id, email, password_hash, name, status)
      VALUES (?, 'owner@csv.pk', 'hash', 'Export Owner', 'active'),
             (?, 'cashier@csv.pk', 'hash', 'Export Cashier', 'active')
    `).run(ownerUserId, cashierUserId)

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('bm_csv_owner', ?, ?, 'owner', 1),
             ('bm_csv_cashier', ?, ?, 'cashier', 1)
    `).run(bizId, ownerUserId, bizId, cashierUserId)

    sqlite.prepare(`
      INSERT INTO member_branches (id, member_id, branch_id)
      VALUES ('mb_csv_c', 'bm_csv_cashier', ?)
    `).run(branchId)

    const sessOwner = await createSession(d1, ownerUserId)
    ownerToken = sessOwner.token

    const sessCashier = await createSession(d1, cashierUserId)
    cashierToken = sessCashier.token

    // Seed Category & Product with formula-like name to test injection escaping
    sqlite.prepare(`
      INSERT INTO categories (id, business_id, name, slug, status)
      VALUES ('cat_exp', ?, 'Exportables', 'exportables', 'active')
    `).run(bizId)

    // Product name begins with '=SUM(A1:A10)' to simulate spreadsheet formula injection attempt
    sqlite.prepare(`
      INSERT INTO products (id, business_id, category_id, sku, name, unit, purchase_price_minor, selling_price_minor, status)
      VALUES ('p_inj', ?, 'cat_exp', '+CMD|calc', '=SUM(1,2)*calc', 'piece', 5000, 10000, 'active')
    `).run(bizId)

    // Seed Customer starting with '@admin' to test @ formula injection
    sqlite.prepare(`
      INSERT INTO customers (id, business_id, customer_code, name, phone, status)
      VALUES ('c_inj', ?, 'C-INJ', '@MaliciousCustomer', '03001234567', 'active')
    `).run(bizId)

    // Seed Sale
    sqlite.prepare(`
      INSERT INTO sales (
        id, business_id, branch_id, sale_number, receipt_number, invoice_number,
        customer_id, customer_snapshot_json, cashier_id, cashier_name,
        subtotal_minor, discount_minor, tax_minor, total_amount_minor,
        amount_paid_minor, remaining_balance_minor, status, business_date_key
      ) VALUES
        ('s_csv', ?, ?, 'S-CSV-1', 'R-CSV-1', 'I-CSV-1', 'c_inj', '{}', ?, 'Owner', 10000, 0, 0, 10000, 0, 10000, 'completed', '2026-11-08')
    `).run(bizId, branchId, ownerUserId)

    sqlite.prepare(`
      INSERT INTO sale_items (
        id, sale_id, product_id, sku, product_name, unit, unit_price_minor, unit_cost_minor, quantity, subtotal_minor, line_total_minor
      ) VALUES
        ('si_csv', 's_csv', 'p_inj', '+CMD|calc', '=SUM(1,2)*calc', 'piece', 10000, 5000, 1.0, 10000, 10000)
    `).run()
  })

  it('rejects cashier without reports_view permission with 403', async () => {
    const req = new Request('http://localhost/api/v1/reports/export?reportType=sales', {
      headers: { Cookie: `__session=${cashierToken}`, 'X-Business-Id': bizId },
    })
    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(403)
  })

  it('exports sales CSV with proper headers and content type', async () => {
    const req = new Request('http://localhost/api/v1/reports/export?reportType=sales&fromDate=2026-11-01&toDate=2026-11-30', {
      headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': bizId },
    })
    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/csv')
    expect(res.headers.get('Content-Disposition')).toContain('attachment; filename="sales-report-')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')

    const csv = await res.text()
    expect(csv).toContain('Date')
    expect(csv).toContain('Gross Sales (Rs)')
    expect(csv).toContain('2026-11-08')
  })

  it('mitigates CSV formula injection by prepending single quote on dangerous characters', async () => {
    // 1. Export Products CSV (product name has '=SUM(1,2)*calc' and SKU has '+CMD|calc')
    const req = new Request('http://localhost/api/v1/reports/export?reportType=products&fromDate=2026-11-01&toDate=2026-11-30', {
      headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': bizId },
    })
    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(200)

    const csv = await res.text()
    // Formula triggers = and + must be neutralized with leading '
    expect(csv).toContain("'=SUM(1,2)*calc")
    expect(csv).toContain("'+CMD|calc")

    // 2. Export Customers CSV (customer name has '@MaliciousCustomer')
    const custReq = new Request('http://localhost/api/v1/reports/export?reportType=customers', {
      headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': bizId },
    })
    const custRes = await worker.fetch(custReq, env, executionCtx)
    expect(custRes.status).toBe(200)
    const custCsv = await custRes.text()
    expect(custCsv).toContain("'@MaliciousCustomer")
  })

  it('rejects unsupported reportType with 400 Bad Request', async () => {
    const req = new Request('http://localhost/api/v1/reports/export?reportType=unsupported_metric', {
      headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': bizId },
    })
    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toMatch(/Unsupported reportType/i)
  })
})
