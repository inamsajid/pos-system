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

describe('Branch-Level Stock Visibility & Isolation', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  // Business Alpha (Multi-Branch)
  const bizAlphaId = 'biz_alpha'
  const branchAId = 'branch_alpha_a'
  const branchBId = 'branch_alpha_b'
  const catAlphaId = 'cat_alpha_groceries'
  const prodAlpha1Id = 'prod_alpha_sugar'
  const prodAlpha2Id = 'prod_alpha_tea'

  // Business Beta (Competitor / Separate Tenant)
  const bizBetaId = 'biz_beta'
  const branchBetaId = 'branch_beta_main'
  const catBetaId = 'cat_beta_snacks'
  const prodBeta1Id = 'prod_beta_chips'

  // Users & Tokens
  let ownerAlphaToken: string
  let cashierBranchAToken: string
  let cashierBranchBToken: string
  let ownerBetaToken: string

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

    // --- Seed Business Alpha ---
    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'BIZALPHA', 'Alpha Supermart', 'active')
    `).run(bizAlphaId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'BRA-A', 'Branch A (Downtown)', 1, 'active'),
             (?, ?, 'BRA-B', 'Branch B (Uptown)', 0, 'active')
    `).run(branchAId, bizAlphaId, branchBId, bizAlphaId)

    sqlite.prepare(`
      INSERT INTO categories (id, business_id, name, slug, description, display_order, status)
      VALUES (?, ?, 'Groceries', 'groceries', 'General staples', 1, 'active')
    `).run(catAlphaId, bizAlphaId)

    sqlite.prepare(`
      INSERT INTO products (id, business_id, category_id, sku, name, unit, purchase_price_minor, selling_price_minor, low_stock_threshold, track_inventory, status)
      VALUES (?, ?, ?, 'SKU-SUGAR', 'White Sugar 1kg', 'kg', 12000, 15000, 10, 1, 'active'),
             (?, ?, ?, 'SKU-TEA', 'Black Tea 500g', 'box', 40000, 50000, 15, 1, 'active')
    `).run(prodAlpha1Id, bizAlphaId, catAlphaId, prodAlpha2Id, bizAlphaId, catAlphaId)

    // Stock for Alpha:
    // Sugar: Branch A = 8.0, Branch B = 50.0  (Total across business = 58.0)
    // Tea:   Branch A = 30.0, Branch B = 0.0   (Total across business = 30.0)
    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand)
      VALUES ('bal_a_1', ?, ?, ?, 8.0),
             ('bal_a_2', ?, ?, ?, 50.0),
             ('bal_a_3', ?, ?, ?, 30.0),
             ('bal_a_4', ?, ?, ?, 0.0)
    `).run(
      bizAlphaId, branchAId, prodAlpha1Id,
      bizAlphaId, branchBId, prodAlpha1Id,
      bizAlphaId, branchAId, prodAlpha2Id,
      bizAlphaId, branchBId, prodAlpha2Id
    )

    // --- Seed Business Beta (Separate Tenant) ---
    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'BIZBETA', 'Beta Retail', 'active')
    `).run(bizBetaId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'BETA-1', 'Beta Central', 1, 'active')
    `).run(branchBetaId, bizBetaId)

    sqlite.prepare(`
      INSERT INTO categories (id, business_id, name, slug, description, display_order, status)
      VALUES (?, ?, 'Snacks', 'snacks', 'Crunchy snacks', 1, 'active')
    `).run(catBetaId, bizBetaId)

    sqlite.prepare(`
      INSERT INTO products (id, business_id, category_id, sku, name, unit, purchase_price_minor, selling_price_minor, low_stock_threshold, track_inventory, status)
      VALUES (?, ?, ?, 'SKU-CHIPS', 'Potato Chips', 'pack', 5000, 8000, 5, 1, 'active')
    `).run(prodBeta1Id, bizBetaId, catBetaId)

    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand)
      VALUES ('bal_beta_1', ?, ?, ?, 500.0)
    `).run(bizBetaId, branchBetaId, prodBeta1Id)

    // --- Users & Memberships ---
    // User 1: Alpha Owner (has access to all branches in Alpha)
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES ('usr_owner_alpha', 'owner@alpha.pk', 'Alpha Owner', 'dummy_hash', 'active')
    `).run()
    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_owner_alpha', ?, 'usr_owner_alpha', 'owner', 1)
    `).run(bizAlphaId)

    // User 2: Cashier at Branch A ONLY
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES ('usr_cashier_a', 'cashier.a@alpha.pk', 'Branch A Cashier', 'dummy_hash', 'active')
    `).run()
    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_cashier_a', ?, 'usr_cashier_a', 'cashier', 1)
    `).run(bizAlphaId)
    sqlite.prepare(`
      INSERT INTO member_branches (id, member_id, branch_id)
      VALUES ('mb_a', 'mem_cashier_a', ?)
    `).run(branchAId)

    // User 3: Cashier at Branch B ONLY
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES ('usr_cashier_b', 'cashier.b@alpha.pk', 'Branch B Cashier', 'dummy_hash', 'active')
    `).run()
    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_cashier_b', ?, 'usr_cashier_b', 'cashier', 1)
    `).run(bizAlphaId)
    sqlite.prepare(`
      INSERT INTO member_branches (id, member_id, branch_id)
      VALUES ('mb_b', 'mem_cashier_b', ?)
    `).run(branchBId)

    // User 4: Beta Owner
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES ('usr_owner_beta', 'owner@beta.pk', 'Beta Owner', 'dummy_hash', 'active')
    `).run()
    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_owner_beta', ?, 'usr_owner_beta', 'owner', 1)
    `).run(bizBetaId)

    // Create sessions
    const sessOwnerAlpha = await createSession(d1, 'usr_owner_alpha')
    ownerAlphaToken = sessOwnerAlpha.token

    const sessCashierA = await createSession(d1, 'usr_cashier_a')
    cashierBranchAToken = sessCashierA.token

    const sessCashierB = await createSession(d1, 'usr_cashier_b')
    cashierBranchBToken = sessCashierB.token

    const sessOwnerBeta = await createSession(d1, 'usr_owner_beta')
    ownerBetaToken = sessOwnerBeta.token
  })

  function makeRequest(
    method: string,
    urlPath: string,
    token: string,
    businessId: string,
    extraHeaders: Record<string, string> = {}
  ): Request {
    return new Request(`http://localhost:8787${urlPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Business-Id': businessId,
        Origin: 'http://localhost:5173',
        ...extraHeaders,
      },
    })
  }

  it('1. Branch A user sees Branch A stock only', async () => {
    const req = makeRequest('GET', '/api/v1/products', cashierBranchAToken, bizAlphaId)
    const res = await worker.fetch(req, env, executionCtx)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Array<{ sku: string; stockQuantity: number }> }

    const sugar = body.data.find((p) => p.sku === 'SKU-SUGAR')
    const tea = body.data.find((p) => p.sku === 'SKU-TEA')

    expect(sugar).toBeDefined()
    expect(tea).toBeDefined()

    // In Branch A: Sugar is 8.0, Tea is 30.0
    expect(sugar!.stockQuantity).toBe(8.0)
    expect(tea!.stockQuantity).toBe(30.0)
  })

  it('2. Branch A user cannot see Branch B stock through product listing', async () => {
    // In Branch B: Sugar is 50.0. Branch A user must not see Branch B stock (50.0 or 58.0 total)
    const reqA = makeRequest('GET', '/api/v1/products', cashierBranchAToken, bizAlphaId)
    const resA = await worker.fetch(reqA, env, executionCtx)
    const bodyA = (await resA.json()) as { data: Array<{ sku: string; stockQuantity: number }> }
    const sugarA = bodyA.data.find((p) => p.sku === 'SKU-SUGAR')

    expect(sugarA!.stockQuantity).toBe(8.0)
    expect(sugarA!.stockQuantity).not.toBe(50.0)
    expect(sugarA!.stockQuantity).not.toBe(58.0)

    // Contrast with Branch B user who sees Branch B stock (50.0 for sugar, 0.0 for tea)
    const reqB = makeRequest('GET', '/api/v1/products', cashierBranchBToken, bizAlphaId)
    const resB = await worker.fetch(reqB, env, executionCtx)
    const bodyB = (await resB.json()) as { data: Array<{ sku: string; stockQuantity: number }> }
    const sugarB = bodyB.data.find((p) => p.sku === 'SKU-SUGAR')
    const teaB = bodyB.data.find((p) => p.sku === 'SKU-TEA')

    expect(sugarB!.stockQuantity).toBe(50.0)
    expect(teaB!.stockQuantity).toBe(0.0)
  })

  it('3. Branch A user cannot see Branch B stock through product detail', async () => {
    const reqA = makeRequest('GET', `/api/v1/products/${prodAlpha1Id}`, cashierBranchAToken, bizAlphaId)
    const resA = await worker.fetch(reqA, env, executionCtx)

    expect(resA.status).toBe(200)
    const bodyA = (await resA.json()) as { data: { id: string; stockQuantity: number } }
    expect(bodyA.data.stockQuantity).toBe(8.0)

    const reqB = makeRequest('GET', `/api/v1/products/${prodAlpha1Id}`, cashierBranchBToken, bizAlphaId)
    const resB = await worker.fetch(reqB, env, executionCtx)

    expect(resB.status).toBe(200)
    const bodyB = (await resB.json()) as { data: { id: string; stockQuantity: number } }
    expect(bodyB.data.stockQuantity).toBe(50.0)
  })

  it('4. Branch A user cannot see Branch B stock through category statistics', async () => {
    // Total stock in Groceries:
    // Branch A: 8.0 (sugar) + 30.0 (tea) = 38.0
    // Branch B: 50.0 (sugar) + 0.0 (tea) = 50.0
    // Combined Business Total: 88.0

    // List categories for Branch A user
    const listReqA = makeRequest('GET', '/api/v1/categories', cashierBranchAToken, bizAlphaId)
    const listResA = await worker.fetch(listReqA, env, executionCtx)
    expect(listResA.status).toBe(200)
    const listBodyA = (await listResA.json()) as { data: Array<{ id: string; totalStockQuantity: number }> }
    const catA = listBodyA.data.find((c) => c.id === catAlphaId)
    expect(catA!.totalStockQuantity).toBe(38.0)

    // Detail category for Branch A user
    const detailReqA = makeRequest('GET', `/api/v1/categories/${catAlphaId}`, cashierBranchAToken, bizAlphaId)
    const detailResA = await worker.fetch(detailReqA, env, executionCtx)
    expect(detailResA.status).toBe(200)
    const detailBodyA = (await detailResA.json()) as { data: { id: string; totalStockQuantity: number } }
    expect(detailBodyA.data.totalStockQuantity).toBe(38.0)

    // List categories for Branch B user
    const listReqB = makeRequest('GET', '/api/v1/categories', cashierBranchBToken, bizAlphaId)
    const listResB = await worker.fetch(listReqB, env, executionCtx)
    expect(listResB.status).toBe(200)
    const listBodyB = (await listResB.json()) as { data: Array<{ id: string; totalStockQuantity: number }> }
    const catB = listBodyB.data.find((c) => c.id === catAlphaId)
    expect(catB!.totalStockQuantity).toBe(50.0)
  })

  it('5. Owner/admin can see all authorized branches within their business', async () => {
    // By default without X-Branch-Id, Owner sees aggregated stock across all branches in Alpha
    const reqAll = makeRequest('GET', '/api/v1/products', ownerAlphaToken, bizAlphaId)
    const resAll = await worker.fetch(reqAll, env, executionCtx)
    expect(resAll.status).toBe(200)
    const bodyAll = (await resAll.json()) as { data: Array<{ sku: string; stockQuantity: number }> }
    const sugarAll = bodyAll.data.find((p) => p.sku === 'SKU-SUGAR')
    const teaAll = bodyAll.data.find((p) => p.sku === 'SKU-TEA')

    // 8.0 + 50.0 = 58.0; 30.0 + 0.0 = 30.0
    expect(sugarAll!.stockQuantity).toBe(58.0)
    expect(teaAll!.stockQuantity).toBe(30.0)

    // Category stock for Owner (all branches = 88.0)
    const reqCatAll = makeRequest('GET', `/api/v1/categories/${catAlphaId}`, ownerAlphaToken, bizAlphaId)
    const resCatAll = await worker.fetch(reqCatAll, env, executionCtx)
    const bodyCatAll = (await resCatAll.json()) as { data: { totalStockQuantity: number } }
    expect(bodyCatAll.data.totalStockQuantity).toBe(88.0)

    // Owner can also filter by specific branch using X-Branch-Id header
    const reqBranchA = makeRequest('GET', '/api/v1/products', ownerAlphaToken, bizAlphaId, {
      'X-Branch-Id': branchAId,
    })
    const resBranchA = await worker.fetch(reqBranchA, env, executionCtx)
    const bodyBranchA = (await resBranchA.json()) as { data: Array<{ sku: string; stockQuantity: number }> }
    const sugarBranchA = bodyBranchA.data.find((p) => p.sku === 'SKU-SUGAR')
    expect(sugarBranchA!.stockQuantity).toBe(8.0)
  })

  it('6. No role can see stock from another business', async () => {
    // Owner of Alpha cannot access Beta's products
    const reqCrossProd = makeRequest('GET', `/api/v1/products/${prodBeta1Id}`, ownerAlphaToken, bizAlphaId)
    const resCrossProd = await worker.fetch(reqCrossProd, env, executionCtx)
    expect(resCrossProd.status).toBe(404)

    // Owner of Beta cannot access Alpha's products
    const reqBetaProd = makeRequest('GET', `/api/v1/products/${prodAlpha1Id}`, ownerBetaToken, bizBetaId)
    const resBetaProd = await worker.fetch(reqBetaProd, env, executionCtx)
    expect(resBetaProd.status).toBe(404)

    // Owner of Beta listing products only sees Beta items
    const reqBetaList = makeRequest('GET', '/api/v1/products', ownerBetaToken, bizBetaId)
    const resBetaList = await worker.fetch(reqBetaList, env, executionCtx)
    const bodyBeta = (await resBetaList.json()) as { data: Array<{ id: string; stockQuantity: number }> }
    expect(bodyBeta.data.length).toBe(1)
    expect(bodyBeta.data[0].id).toBe(prodBeta1Id)
    expect(bodyBeta.data[0].stockQuantity).toBe(500.0)
  })

  it('7. Branch A user attempting to supply X-Branch-Id of Branch B receives 403 Forbidden', async () => {
    const req = makeRequest('GET', '/api/v1/products', cashierBranchAToken, bizAlphaId, {
      'X-Branch-Id': branchBId,
    })
    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('FORBIDDEN')
  })

  it('8. Low stock filter respects authorized branch stock boundaries', async () => {
    // Sugar has low_stock_threshold = 10.
    // In Branch A: stock is 8.0 (<= 10, so LOW STOCK in Branch A).
    // In Branch B: stock is 50.0 (> 10, so NOT low stock in Branch B).

    // Branch A user queries lowStock=true -> Sugar should be returned
    const reqLowStockA = makeRequest('GET', '/api/v1/products?lowStock=true', cashierBranchAToken, bizAlphaId)
    const resLowStockA = await worker.fetch(reqLowStockA, env, executionCtx)
    const bodyLowStockA = (await resLowStockA.json()) as { data: Array<{ sku: string }> }
    const skusA = bodyLowStockA.data.map((p) => p.sku)
    expect(skusA).toContain('SKU-SUGAR')

    // Branch B user queries lowStock=true -> Sugar should NOT be returned (Tea is 0.0 <= 15, so Tea is returned)
    const reqLowStockB = makeRequest('GET', '/api/v1/products?lowStock=true', cashierBranchBToken, bizAlphaId)
    const resLowStockB = await worker.fetch(reqLowStockB, env, executionCtx)
    const bodyLowStockB = (await resLowStockB.json()) as { data: Array<{ sku: string }> }
    const skusB = bodyLowStockB.data.map((p) => p.sku)
    expect(skusB).not.toContain('SKU-SUGAR')
    expect(skusB).toContain('SKU-TEA')
  })
})

