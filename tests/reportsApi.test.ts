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

describe('Reports & Analytics APIs (Step 12.6)', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const bizA = 'biz_reports_a'
  const bizB = 'biz_reports_b'
  const branchA1 = 'branch_rep_a1'
  const branchA2 = 'branch_rep_a2'
  const branchB1 = 'branch_rep_b1'

  const ownerUserId = 'usr_rep_owner'
  const cashierUserId = 'usr_rep_cashier'
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

    // Seed Businesses
    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'BIZA', 'Alpha Store', 'active'),
             (?, 'BIZB', 'Beta Store', 'active')
    `).run(bizA, bizB)

    // Seed Branches
    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN_A', 'Alpha Main', 1, 'active'),
             (?, ?, 'SUB_A', 'Alpha Branch 2', 0, 'active'),
             (?, ?, 'MAIN_B', 'Beta Main', 1, 'active')
    `).run(branchA1, bizA, branchA2, bizA, branchB1, bizB)

    // Seed Users
    sqlite.prepare(`
      INSERT INTO users (id, email, password_hash, name, status)
      VALUES (?, 'owner@alpha.pk', 'hash', 'Alpha Owner', 'active'),
             (?, 'cashier@alpha.pk', 'hash', 'Alpha Cashier', 'active')
    `).run(ownerUserId, cashierUserId)

    // Seed Business Memberships
    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('bm_rep_owner', ?, ?, 'owner', 1),
             ('bm_rep_cashier', ?, ?, 'cashier', 1)
    `).run(bizA, ownerUserId, bizA, cashierUserId)

    // Assign cashier to branchA1 only
    sqlite.prepare(`
      INSERT INTO member_branches (id, member_id, branch_id)
      VALUES ('mb_cashier', 'bm_rep_cashier', ?)
    `).run(branchA1)

    // Seed sessions
    const ownerSess = await createSession(d1, ownerUserId)
    ownerToken = ownerSess.token

    const cashierSess = await createSession(d1, cashierUserId)
    cashierToken = cashierSess.token

    // Seed Categories
    sqlite.prepare(`
      INSERT INTO categories (id, business_id, name, slug, status)
      VALUES ('cat_bev', ?, 'Beverages', 'beverages', 'active'),
             ('cat_snk', ?, 'Snacks', 'snacks', 'active')
    `).run(bizA, bizA)

    // Seed Products
    sqlite.prepare(`
      INSERT INTO products (id, business_id, category_id, sku, name, unit, purchase_price_minor, selling_price_minor, low_stock_threshold, status)
      VALUES ('p_tea', ?, 'cat_bev', 'BEV-TEA', 'Green Tea', 'box', 40000, 60000, 10, 'active'),
             ('p_bis', ?, 'cat_snk', 'SNK-BIS', 'Butter Biscuit', 'pack', 15000, 25000, 5, 'active')
    `).run(bizA, bizA)

    // Seed Customers
    sqlite.prepare(`
      INSERT INTO customers (id, business_id, customer_code, name, phone, status)
      VALUES ('c_walkin', ?, 'CUST-001', 'Walk-in Customer', '03001234567', 'active'),
             ('c_corp', ?, 'CUST-002', 'Corporate Buyer', '03009999999', 'active')
    `).run(bizA, bizA)

    // Seed Suppliers
    sqlite.prepare(`
      INSERT INTO suppliers (id, business_id, supplier_code, name, phone, status)
      VALUES ('supp_alpha', ?, 'SUPP-001', 'Tea Importers Ltd', '03211112233', 'active')
    `).run(bizA)

    // Seed Inventory Balances
    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand)
      VALUES ('ib_tea_1', ?, ?, 'p_tea', 25.0),
             ('ib_bis_1', ?, ?, 'p_bis', 4.0),
             ('ib_tea_2', ?, ?, 'p_tea', 15.0)
    `).run(bizA, branchA1, bizA, branchA1, bizA, branchA2)
  })

  it('rejects cashier with 403 Forbidden because cashier lacks reports_view permission', async () => {
    const req = new Request('http://localhost/api/v1/reports/dashboard', {
      headers: {
        Cookie: `__session=${cashierToken}`,
        'X-Business-Id': bizA,
      },
    })
    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toMatch(/reports_view/)
  })

  it('allows owner to access dashboard and returns correct structure with financial honesty', async () => {
    const req = new Request('http://localhost/api/v1/reports/dashboard?fromDate=2026-11-01&toDate=2026-11-30', {
      headers: {
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': bizA,
      },
    })
    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: any }
    const data = json.data

    expect(data.businessDateRange.fromDate).toBe('2026-11-01')
    expect(data.businessDateRange.toDate).toBe('2026-11-30')
    expect(data.businessDateRange.timezone).toBe('Asia/Karachi')

    // Inventory metrics checked against seeded data
    expect(data.inventory.totalTrackedProducts).toBe(2)
    // p_bis has 4.0 qty on branchA1 <= low_stock_threshold (5)
    expect(data.inventory.lowStockProductsCount).toBe(1)
    expect(data.inventory.outOfStockProductsCount).toBe(0)
    expect(data.inventory.totalQuantityOnHand).toBe(44) // 25 + 4 + 15

    // Financial honesty: expenses & netProfit must explicitly report isAvailable: false
    expect(data.financial.expenses.isAvailable).toBe(false)
    expect(data.financial.expenses.reason).toMatch(/not yet implemented/i)
    expect(data.financial.netProfit.isAvailable).toBe(false)
    expect(data.financial.netProfit.reason).toMatch(/expense tracking/i)
  })

  it('calculates dashboard sales and collections accurately without double counting', async () => {
    // Insert a sale with 2 items and 2 payments
    const saleId = 'sale_double_test'
    sqlite.prepare(`
      INSERT INTO sales (
        id, business_id, branch_id, sale_number, receipt_number, invoice_number,
        customer_id, customer_snapshot_json, cashier_id, cashier_name,
        subtotal_minor, discount_minor, tax_minor, total_amount_minor,
        amount_paid_minor, remaining_balance_minor, status, business_date_key
      ) VALUES (
        ?, ?, ?, 'SALE-001', 'REC-001', 'INV-001',
        'c_walkin', '{}', ?, 'Alpha Owner',
        110000, 10000, 5000, 105000,
        105000, 0, 'completed', '2026-11-08'
      )
    `).run(saleId, bizA, branchA1, ownerUserId)

    // Insert 2 sale items
    sqlite.prepare(`
      INSERT INTO sale_items (
        id, sale_id, product_id, sku, product_name, unit, unit_price_minor, unit_cost_minor, quantity, subtotal_minor, line_total_minor
      ) VALUES
        ('si_1', ?, 'p_tea', 'BEV-TEA', 'Green Tea', 'box', 60000, 40000, 1.0, 60000, 60000),
        ('si_2', ?, 'p_bis', 'SNK-BIS', 'Butter Biscuit', 'pack', 25000, 15000, 2.0, 50000, 50000)
    `).run(saleId, saleId)

    // Insert 2 payments for this sale (split payment: 50,000 cash + 55,000 card)
    sqlite.prepare(`
      INSERT INTO payments (id, business_id, branch_id, receipt_number, customer_id, customer_snapshot_json, amount_minor, unallocated_amount_minor, business_date_key, received_by)
      VALUES ('pay_1', ?, ?, 'PAY-001', 'c_walkin', '{}', 50000, 0, '2026-11-08', ?),
             ('pay_2', ?, ?, 'PAY-002', 'c_walkin', '{}', 55000, 0, '2026-11-08', ?)
    `).run(bizA, branchA1, ownerUserId, bizA, branchA1, ownerUserId)

    sqlite.prepare(`
      INSERT INTO payment_methods (id, payment_id, method, amount_minor)
      VALUES ('pm_1', 'pay_1', 'cash', 50000),
             ('pm_2', 'pay_2', 'card', 55000)
    `).run()

    sqlite.prepare(`
      INSERT INTO payment_allocations (id, business_id, payment_id, sale_id, invoice_number, amount_minor)
      VALUES ('pa_1', ?, 'pay_1', ?, 'INV-001', 50000),
             ('pa_2', ?, 'pay_2', ?, 'INV-001', 55000)
    `).run(bizA, saleId, bizA, saleId)

    // Fetch dashboard report
    const req = new Request('http://localhost/api/v1/reports/dashboard?fromDate=2026-11-01&toDate=2026-11-30', {
      headers: {
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': bizA,
      },
    })
    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: any }
    const data = json.data

    // Total sales must be exactly 105,000 (NOT multiplied by items or payments!)
    expect(data.sales.salesCount).toBe(1)
    expect(data.sales.totalCompletedSalesMinor).toBe(105000)
    expect(data.sales.netSalesMinor).toBe(100000) // subtotal 110,000 - discount 10,000
    expect(data.sales.discountTotalMinor).toBe(10000)
    expect(data.sales.taxTotalMinor).toBe(5000)
    expect(data.sales.averageTransactionValueMinor).toBe(105000)

    // COGS: (40,000 * 1) + (15,000 * 2) = 70,000
    expect(data.financial.cogs.totalCogsMinor).toBe(70000)
    // Gross profit: netSales (100,000) - cogs (70,000) = 30,000
    expect(data.financial.grossProfitMinor).toBe(30000)

    // Collections: exactly 105,000 total (50,000 cash + 55,000 digital)
    expect(data.collections.totalCollectedMinor).toBe(105000)
    expect(data.collections.cashCollectedMinor).toBe(50000)
    expect(data.collections.digitalCollectedMinor).toBe(55000)
    expect(data.collections.outstandingReceivablesMinor).toBe(0)
  })

  it('enforces branch scoping on sales summary', async () => {
    // Insert sale on branchA1 and sale on branchA2
    sqlite.prepare(`
      INSERT INTO sales (
        id, business_id, branch_id, sale_number, receipt_number, invoice_number,
        customer_id, customer_snapshot_json, cashier_id, cashier_name,
        subtotal_minor, discount_minor, tax_minor, total_amount_minor,
        amount_paid_minor, remaining_balance_minor, status, business_date_key
      ) VALUES
        ('s_b1', ?, ?, 'S-B1', 'R-B1', 'I-B1', 'c_walkin', '{}', ?, 'Owner', 20000, 0, 0, 20000, 20000, 0, 'completed', '2026-11-08'),
        ('s_b2', ?, ?, 'S-B2', 'R-B2', 'I-B2', 'c_walkin', '{}', ?, 'Owner', 30000, 0, 0, 30000, 30000, 0, 'completed', '2026-11-08')
    `).run(bizA, branchA1, ownerUserId, bizA, branchA2, ownerUserId)

    // Query with branchA1 scope
    const reqBranch1 = new Request(`http://localhost/api/v1/reports/sales/summary?branchId=${branchA1}`, {
      headers: {
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': bizA,
      },
    })
    const res1 = await worker.fetch(reqBranch1, env, executionCtx)
    expect(res1.status).toBe(200)
    const json1 = (await res1.json()) as { data: any }
    expect(json1.data.completedSalesCount).toBe(1)
    expect(json1.data.totalAmountMinor).toBe(20000)

    // Query without branch scope (all branches)
    const reqAll = new Request('http://localhost/api/v1/reports/sales/summary', {
      headers: {
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': bizA,
      },
    })
    const resAll = await worker.fetch(reqAll, env, executionCtx)
    expect(resAll.status).toBe(200)
    const jsonAll = (await resAll.json()) as { data: any }
    expect(jsonAll.data.completedSalesCount).toBe(2)
    expect(jsonAll.data.totalAmountMinor).toBe(50000)
  })

  it('rejects invalid or reversed date ranges', async () => {
    // Reversed date range
    const reqReversed = new Request('http://localhost/api/v1/reports/sales/summary?fromDate=2026-11-20&toDate=2026-11-10', {
      headers: {
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': bizA,
      },
    })
    const resReversed = await worker.fetch(reqReversed, env, executionCtx)
    expect(resReversed.status).toBe(400)
    const bodyReversed = (await resReversed.json()) as { error: { message: string } }
    expect(bodyReversed.error.message).toMatch(/Reversed date range/i)

    // Invalid calendar date
    const reqInvalid = new Request('http://localhost/api/v1/reports/sales/summary?fromDate=2026-02-31', {
      headers: {
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': bizA,
      },
    })
    const resInvalid = await worker.fetch(reqInvalid, env, executionCtx)
    expect(resInvalid.status).toBe(400)
  })

  it('reports sales trends, sales by product, and sales by category', async () => {
    const saleId = 's_perf_test'
    sqlite.prepare(`
      INSERT INTO sales (
        id, business_id, branch_id, sale_number, receipt_number, invoice_number,
        customer_id, customer_snapshot_json, cashier_id, cashier_name,
        subtotal_minor, discount_minor, tax_minor, total_amount_minor,
        amount_paid_minor, remaining_balance_minor, status, business_date_key
      ) VALUES (?, ?, ?, 'S-P1', 'R-P1', 'I-P1', 'c_walkin', '{}', ?, 'Owner', 100000, 0, 0, 100000, 100000, 0, 'completed', '2026-11-08')
    `).run(saleId, bizA, branchA1, ownerUserId)

    sqlite.prepare(`
      INSERT INTO sale_items (
        id, sale_id, product_id, sku, product_name, unit, unit_price_minor, unit_cost_minor, quantity, subtotal_minor, line_total_minor
      ) VALUES
        ('si_p1', ?, 'p_tea', 'BEV-TEA', 'Green Tea', 'box', 60000, 40000, 1.0, 60000, 60000),
        ('si_p2', ?, 'p_bis', 'SNK-BIS', 'Butter Biscuit', 'pack', 20000, 10000, 2.0, 40000, 40000)
    `).run(saleId, saleId)

    // 1. Sales Trends
    const trendsReq = new Request('http://localhost/api/v1/reports/sales/trends?fromDate=2026-11-01&toDate=2026-11-30', {
      headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': bizA },
    })
    const trendsRes = await worker.fetch(trendsReq, env, executionCtx)
    expect(trendsRes.status).toBe(200)
    const trendsJson = (await trendsRes.json()) as { data: any[] }
    expect(trendsJson.data.length).toBe(1)
    expect(trendsJson.data[0].dateKey).toBe('2026-11-08')
    expect(trendsJson.data[0].totalAmountMinor).toBe(100000)

    // 2. Sales by Product
    const prodReq = new Request('http://localhost/api/v1/reports/sales/by-product?fromDate=2026-11-01&toDate=2026-11-30', {
      headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': bizA },
    })
    const prodRes = await worker.fetch(prodReq, env, executionCtx)
    expect(prodRes.status).toBe(200)
    const prodJson = (await prodRes.json()) as { data: any[] }
    expect(prodJson.data.length).toBe(2)
    expect(prodJson.data[0].productName).toBe('Green Tea')
    expect(prodJson.data[0].totalRevenueMinor).toBe(60000)
    expect(prodJson.data[0].estimatedMarginMinor).toBe(20000) // 60,000 - 40,000

    // 3. Sales by Category
    const catReq = new Request('http://localhost/api/v1/reports/sales/by-category?fromDate=2026-11-01&toDate=2026-11-30', {
      headers: { Cookie: `__session=${ownerToken}`, 'X-Business-Id': bizA },
    })
    const catRes = await worker.fetch(catReq, env, executionCtx)
    expect(catRes.status).toBe(200)
    const catJson = (await catRes.json()) as { data: any[] }
    expect(catJson.data.length).toBe(2)
  })

  it('guarantees tenant isolation: Business B data never appears in Business A reports', async () => {
    // Insert sale under bizB
    sqlite.prepare(`
      INSERT INTO sales (
        id, business_id, branch_id, sale_number, receipt_number, invoice_number,
        customer_id, customer_snapshot_json, cashier_id, cashier_name,
        subtotal_minor, discount_minor, tax_minor, total_amount_minor,
        amount_paid_minor, remaining_balance_minor, status, business_date_key
      ) VALUES
        ('sale_b', ?, ?, 'S-BIZB', 'R-BIZB', 'I-BIZB', 'c_walkin', '{}', ?, 'Beta Cashier', 500000, 0, 0, 500000, 500000, 0, 'completed', '2026-11-08')
    `).run(bizB, branchB1, ownerUserId)

    // Query Business A dashboard
    const req = new Request('http://localhost/api/v1/reports/dashboard?fromDate=2026-11-01&toDate=2026-11-30', {
      headers: {
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': bizA,
      },
    })
    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: any }
    // Business B's 500,000 sale must NOT be present
    expect(json.data.sales.totalCompletedSalesMinor).toBe(0)
    expect(json.data.sales.salesCount).toBe(0)
  })
})
