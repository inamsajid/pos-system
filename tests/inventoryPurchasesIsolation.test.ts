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

describe('Inventory, Purchases & Supplier Tenant/Branch Isolation', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const biz1Id = 'biz_iso_1'
  const biz2Id = 'biz_iso_2'
  const branch1A = 'branch_iso_1a'
  const branch1B = 'branch_iso_1b'
  const branch2A = 'branch_iso_2a'

  const userBiz1Owner = 'usr_iso_b1_owner'
  const userBiz1Staff = 'usr_iso_b1_staff'
  const userBiz2Owner = 'usr_iso_b2_owner'

  let tokenBiz1Owner: string
  let tokenBiz1Staff: string
  let tokenBiz2Owner: string

  const suppBiz1 = 'supp_iso_b1'
  const suppBiz2 = 'supp_iso_b2'
  const prodBiz1 = 'prod_iso_b1'
  const prodBiz2 = 'prod_iso_b2'

  let poBiz1Id = 'po_iso_b1'
  let poBiz2Id = 'po_iso_b2'

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

    // Seed 2 Businesses
    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'BIZ1', 'Alpha Enterprise', 'active'),
             (?, 'BIZ2', 'Beta Competitor', 'active')
    `).run(biz1Id, biz2Id)

    // Seed Branches: Biz1 has 1A (main) and 1B; Biz2 has 2A (main)
    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'B1A', 'Alpha HQ', 1, 'active'),
             (?, ?, 'B1B', 'Alpha North', 0, 'active'),
             (?, ?, 'B2A', 'Beta Main', 1, 'active')
    `).run(branch1A, biz1Id, branch1B, biz1Id, branch2A, biz2Id)

    // Seed Users
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'b1_owner@alpha.pk', 'Alpha Owner', 'hash', 'active'),
             (?, 'b1_staff@alpha.pk', 'Alpha Branch Staff', 'hash', 'active'),
             (?, 'b2_owner@beta.pk', 'Beta Owner', 'hash', 'active')
    `).run(userBiz1Owner, userBiz1Staff, userBiz2Owner)

    // Seed Memberships:
    // User 1: Owner of Biz1 (all branches)
    // User 2: Manager of Biz1 restricted ONLY to branch 1A
    // User 3: Owner of Biz2
    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_b1_owner', ?, ?, 'owner', 1),
             ('mem_b1_staff', ?, ?, 'manager', 1),
             ('mem_b2_owner', ?, ?, 'owner', 1)
    `).run(biz1Id, userBiz1Owner, biz1Id, userBiz1Staff, biz2Id, userBiz2Owner)

    sqlite.prepare(`
      INSERT INTO member_branches (id, member_id, branch_id)
      VALUES ('mb_staff_1a', 'mem_b1_staff', ?)
    `).run(branch1A)

    // Seed Suppliers
    sqlite.prepare(`
      INSERT INTO suppliers (id, business_id, supplier_code, name, company_name, phone, email, status)
      VALUES (?, ?, 'SUPP-B1', 'Alpha Vendor', 'Alpha Supplier Ltd', '03001', 'v1@alpha.pk', 'active'),
             (?, ?, 'SUPP-B2', 'Beta Vendor', 'Beta Supplier Ltd', '03002', 'v2@beta.pk', 'active')
    `).run(suppBiz1, biz1Id, suppBiz2, biz2Id)

    // Seed Categories
    sqlite.prepare(`
      INSERT INTO categories (id, business_id, name, slug)
      VALUES ('cat_b1', ?, 'Alpha Cat', 'alpha-cat'),
             ('cat_b2', ?, 'Beta Cat', 'beta-cat')
    `).run(biz1Id, biz2Id)

    // Seed Products
    sqlite.prepare(`
      INSERT INTO products (id, business_id, category_id, name, sku, unit, purchase_price_minor, selling_price_minor, status)
      VALUES (?, ?, 'cat_b1', 'Alpha Product', 'SKU-A1', 'piece', 10000, 20000, 'active'),
             (?, ?, 'cat_b2', 'Beta Product', 'SKU-B1', 'piece', 30000, 60000, 'active')
    `).run(prodBiz1, biz1Id, prodBiz2, biz2Id)

    // Seed Inventory Balances:
    // Biz1 Branch 1A: 100 units
    // Biz1 Branch 1B: 50 units
    // Biz2 Branch 2A: 200 units
    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand)
      VALUES ('bal_b1_1a', ?, ?, ?, 100.0),
             ('bal_b1_1b', ?, ?, ?, 50.0),
             ('bal_b2_2a', ?, ?, ?, 200.0)
    `).run(biz1Id, branch1A, prodBiz1, biz1Id, branch1B, prodBiz1, biz2Id, branch2A, prodBiz2)

    // Seed Purchases in Biz 1 and Biz 2
    sqlite.prepare(`
      INSERT INTO purchases (id, business_id, branch_id, purchase_number, supplier_id, supplier_snapshot_json, subtotal_minor, discount_minor, tax_minor, total_amount_minor, paid_amount_minor, status, purchase_date_key, created_by)
      VALUES (?, ?, ?, 'PO-B1-01', ?, '{}', 100000, 0, 0, 100000, 0, 'ordered', '2026-11-09', ?),
             (?, ?, ?, 'PO-B2-01', ?, '{}', 500000, 0, 0, 500000, 0, 'ordered', '2026-11-09', ?)
    `).run(poBiz1Id, biz1Id, branch1A, suppBiz1, userBiz1Owner, poBiz2Id, biz2Id, branch2A, suppBiz2, userBiz2Owner)

    tokenBiz1Owner = (await createSession(d1, userBiz1Owner)).token
    tokenBiz1Staff = (await createSession(d1, userBiz1Staff)).token
    tokenBiz2Owner = (await createSession(d1, userBiz2Owner)).token
  })

  it('strictly isolates inventory balances across businesses', async () => {
    // Biz 1 Owner lists balances
    const resB1 = await worker.fetch(
      new Request('https://pos.internal/api/v1/inventory/balances', {
        method: 'GET',
        headers: { Cookie: `__session=${tokenBiz1Owner}`, 'X-Business-Id': biz1Id },
      }),
      env,
      executionCtx
    )
    expect(resB1.status).toBe(200)
    const jsonB1 = (await resB1.json()) as { data: Array<{ productId: string }> }
    expect(jsonB1.data.every((b) => b.productId === prodBiz1)).toBe(true)
    expect(jsonB1.data.some((b) => b.productId === prodBiz2)).toBe(false)

    // Biz 2 Owner lists balances
    const resB2 = await worker.fetch(
      new Request('https://pos.internal/api/v1/inventory/balances', {
        method: 'GET',
        headers: { Cookie: `__session=${tokenBiz2Owner}`, 'X-Business-Id': biz2Id },
      }),
      env,
      executionCtx
    )
    expect(resB2.status).toBe(200)
    const jsonB2 = (await resB2.json()) as { data: Array<{ productId: string }> }
    expect(jsonB2.data.every((b) => b.productId === prodBiz2)).toBe(true)
    expect(jsonB2.data.some((b) => b.productId === prodBiz1)).toBe(false)
  })

  it('restricts branch-scoped staff from viewing unauthorized branch stock', async () => {
    // Biz 1 Staff is authorized ONLY for Branch 1A
    const resStaff = await worker.fetch(
      new Request('https://pos.internal/api/v1/inventory/balances', {
        method: 'GET',
        headers: { Cookie: `__session=${tokenBiz1Staff}`, 'X-Business-Id': biz1Id },
      }),
      env,
      executionCtx
    )
    expect(resStaff.status).toBe(200)
    const jsonStaff = (await resStaff.json()) as { data: Array<{ branchId: string; quantityOnHand: number }> }
    expect(jsonStaff.data.length).toBe(1)
    expect(jsonStaff.data[0].branchId).toBe(branch1A)
    expect(jsonStaff.data[0].quantityOnHand).toBe(100.0)

    // Staff attempts to pass X-Branch-Id for Branch 1B -> strictly rejected with 403 Forbidden
    const resStaffB = await worker.fetch(
      new Request(`https://pos.internal/api/v1/inventory/balances?branchId=${branch1B}`, {
        method: 'GET',
        headers: {
          Cookie: `__session=${tokenBiz1Staff}`,
          'X-Business-Id': biz1Id,
          'X-Branch-Id': branch1B,
        },
      }),
      env,
      executionCtx
    )
    expect(resStaffB.status).toBe(403)
  })

  it('prevents cross-business access to purchase orders and supplier ledgers', async () => {
    // Biz 1 Owner attempts to view Biz 2 Purchase Order -> 404
    const poRes = await worker.fetch(
      new Request(`https://pos.internal/api/v1/purchases/${poBiz2Id}`, {
        method: 'GET',
        headers: { Cookie: `__session=${tokenBiz1Owner}`, 'X-Business-Id': biz1Id },
      }),
      env,
      executionCtx
    )
    expect(poRes.status).toBe(404)

    // Biz 1 Owner attempts to view Biz 2 Supplier Ledger -> 404
    const ledgerRes = await worker.fetch(
      new Request(`https://pos.internal/api/v1/suppliers/${suppBiz2}/ledger`, {
        method: 'GET',
        headers: { Cookie: `__session=${tokenBiz1Owner}`, 'X-Business-Id': biz1Id },
      }),
      env,
      executionCtx
    )
    expect(ledgerRes.status).toBe(404)
  })
})
