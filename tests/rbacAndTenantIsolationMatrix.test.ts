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

class MemoryR2Bucket {
  private store = new Map<string, Uint8Array>()

  async put(key: string, value: unknown): Promise<R2Object> {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer)
    this.store.set(key, bytes)
    return {
      key,
      size: bytes.byteLength,
      etag: 'etag_test',
      httpEtag: '"etag_test"',
    } as unknown as R2Object
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const body = this.store.get(key)
    if (!body) return null
    return {
      key,
      size: body.byteLength,
      httpEtag: '"etag_test"',
      body: new ReadableStream({
        start(c) {
          c.enqueue(body)
          c.close()
        },
      }),
    } as unknown as R2ObjectBody
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }
}

const executionCtx: ExecutionContext = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
}

describe('Phase 4 — Route RBAC, Branch Scoping & Tenant Isolation Matrix (SEC-001, SEC-004, TEN-001, TEN-002)', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const bizA = 'biz_matrix_a'
  const bizB = 'biz_matrix_b'
  const branchA1 = 'br_mat_a1'
  const branchA2 = 'br_mat_a2'
  const branchA3 = 'br_mat_a3'
  const branchB1 = 'br_mat_b1'
  const branchAInactive = 'br_mat_a_inactive'

  const users = {
    owner: 'usr_mat_owner',
    admin: 'usr_mat_admin',
    manager: 'usr_mat_manager',
    cashier: 'usr_mat_cashier',
    cashier2: 'usr_mat_cashier2',
    inventory_manager: 'usr_mat_inv',
    accountant: 'usr_mat_acc',
    unassignedManager: 'usr_mat_unassigned',
    bizBOwner: 'usr_mat_b_owner',
  }

  const tokens: Record<keyof typeof users, string> = {
    owner: '',
    admin: '',
    manager: '',
    cashier: '',
    cashier2: '',
    inventory_manager: '',
    accountant: '',
    unassignedManager: '',
    bizBOwner: '',
  }

  function req(
    urlPath: string,
    token: string | null,
    init: RequestInit & { businessId?: string; branchId?: string } = {}
  ): Request {
    const headers = new Headers(init.headers)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    if (init.businessId !== undefined) {
      if (init.businessId) headers.set('X-Business-Id', init.businessId)
    } else if (token) {
      headers.set('X-Business-Id', bizA)
    }
    if (init.branchId) headers.set('X-Branch-Id', init.branchId)
    return new Request(`http://localhost${urlPath}`, {
      ...init,
      headers,
    })
  }

  beforeEach(async () => {
    sqlite = new DatabaseSync(':memory:')
    sqlite.exec('PRAGMA foreign_keys = ON;')

    const migrationsDir = path.resolve(process.cwd(), 'worker/migrations')
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
    for (const file of files) {
      sqlite.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf-8'))
    }

    d1 = createRealD1(sqlite)
    env = {
      DB: d1,
      FILES: new MemoryR2Bucket() as unknown as R2Bucket,
      ENVIRONMENT: 'local',
      SERVICE_NAME: 'pos-system-api',
      API_VERSION: 'v1',
      AUTH_SECRET: 'test-matrix-signing-secret-32chars!',
    }

    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'MATA', 'Matrix Alpha Store', 'active'),
             (?, 'MATB', 'Matrix Beta Store', 'active')
    `).run(bizA, bizB)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'A1', 'Alpha One', 1, 'active'),
             (?, ?, 'A2', 'Alpha Two', 0, 'active'),
             (?, ?, 'A3', 'Alpha Three', 0, 'active'),
             (?, ?, 'AIN', 'Alpha Inactive', 0, 'inactive'),
             (?, ?, 'B1', 'Beta One', 1, 'active')
    `).run(branchA1, bizA, branchA2, bizA, branchA3, bizA, branchAInactive, bizA, branchB1, bizB)

    sqlite.prepare(`
      INSERT INTO business_settings (business_id, allow_negative_stock, default_tax_rate)
      VALUES (?, 0, 0), (?, 0, 0)
    `).run(bizA, bizB)

    for (const [key, id] of Object.entries(users)) {
      sqlite.prepare(`
        INSERT INTO users (id, email, name, password_hash, status)
        VALUES (?, ?, ?, 'hash', 'active')
      `).run(id, `${key}@matrix.pk`, key.toUpperCase())
      tokens[key as keyof typeof users] = (await createSession(d1, id)).token
    }

    // Seed memberships in Business A
    const memberships: Array<{ id: string; userId: string; role: string; branches: string[] }> = [
      { id: 'mem_mat_owner', userId: users.owner, role: 'owner', branches: [] },
      { id: 'mem_mat_admin', userId: users.admin, role: 'admin', branches: [] },
      { id: 'mem_mat_manager', userId: users.manager, role: 'manager', branches: [branchA1, branchA2] },
      { id: 'mem_mat_cashier', userId: users.cashier, role: 'cashier', branches: [branchA1] },
      { id: 'mem_mat_cashier2', userId: users.cashier2, role: 'cashier', branches: [branchA2] },
      { id: 'mem_mat_inv', userId: users.inventory_manager, role: 'inventory_manager', branches: [branchA1] },
      { id: 'mem_mat_acc', userId: users.accountant, role: 'accountant', branches: [branchA1] },
      { id: 'mem_mat_unassigned', userId: users.unassignedManager, role: 'manager', branches: [] },
    ]

    for (const m of memberships) {
      sqlite.prepare(`
        INSERT INTO business_members (id, business_id, user_id, role, is_active)
        VALUES (?, ?, ?, ?, 1)
      `).run(m.id, bizA, m.userId, m.role)
      for (const bId of m.branches) {
        sqlite.prepare(`
          INSERT INTO member_branches (id, member_id, branch_id)
          VALUES (?, ?, ?)
        `).run(`mb_${m.id}_${bId}`, m.id, bId)
      }
    }

    // Seed owner in Business B
    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_mat_b_owner', ?, ?, 'owner', 1)
    `).run(bizB, users.bizBOwner)

    // Seed shared fixtures
    sqlite.prepare(`
      INSERT INTO products (id, business_id, sku, name, unit, purchase_price_minor, selling_price_minor, track_inventory, status)
      VALUES ('prod_mat_1', ?, 'MAT-1', 'Matrix Product', 'piece', 10000, 15000, 1, 'active')
    `).run(bizA)
    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand)
      VALUES ('ib_mat_a1', ?, ?, 'prod_mat_1', 20),
             ('ib_mat_a2', ?, ?, 'prod_mat_1', 15),
             ('ib_mat_a3', ?, ?, 'prod_mat_1', 30)
    `).run(bizA, branchA1, bizA, branchA2, bizA, branchA3)

    sqlite.prepare(`
      INSERT INTO customers (id, business_id, customer_code, name, phone, status)
      VALUES ('cust_mat_1', ?, 'C-MAT-1', 'Matrix Customer', '03001230001', 'active')
    `).run(bizA)

    sqlite.prepare(`
      INSERT INTO suppliers (id, business_id, supplier_code, name, phone, status)
      VALUES ('supp_mat_1', ?, 'S-MAT-1', 'Matrix Supplier', '03001230002', 'active')
    `).run(bizA)

    sqlite.prepare(`
      INSERT INTO expense_categories (id, business_id, name, status)
      VALUES ('exp_cat_mat_1', ?, 'Utilities', 'active')
    `).run(bizA)
  })

  it('rejects unauthenticated requests with 401 across all protected resource groups', async () => {
    const protectedEndpoints: Array<{ method: string; path: string }> = [
      { method: 'GET', path: '/api/v1/settings' },
      { method: 'GET', path: '/api/v1/customers' },
      { method: 'GET', path: '/api/v1/suppliers' },
      { method: 'GET', path: '/api/v1/sales' },
      { method: 'GET', path: '/api/v1/invoices' },
      { method: 'GET', path: '/api/v1/customer-payments' },
      { method: 'GET', path: '/api/v1/supplier-payments' },
      { method: 'GET', path: '/api/v1/inventory/balances' },
      { method: 'GET', path: '/api/v1/purchases' },
      { method: 'GET', path: '/api/v1/goods-receipts' },
      { method: 'GET', path: '/api/v1/expenses' },
      { method: 'GET', path: '/api/v1/staff' },
      { method: 'GET', path: '/api/v1/files' },
      { method: 'GET', path: '/api/v1/reports/dashboard' },
      { method: 'GET', path: '/api/v1/sync/devices' },
      { method: 'POST', path: '/api/v1/offline/authorizations' },
    ]

    for (const ep of protectedEndpoints) {
      const res = await worker.fetch(req(ep.path, null, { method: ep.method }), env, executionCtx)
      expect(res.status, `${ep.method} ${ep.path} must require auth`).toBe(401)
    }
  })

  it('enforces least-privilege RBAC across all 6 roles on newly guarded routes', async () => {
    // 1. Settings read (owner/admin/manager 200; cashier/inv/accountant 403) & write (owner only 200)
    expect((await worker.fetch(req('/api/v1/settings', tokens.admin), env, executionCtx)).status).toBe(200)
    expect((await worker.fetch(req('/api/v1/settings', tokens.manager), env, executionCtx)).status).toBe(200)
    expect((await worker.fetch(req('/api/v1/settings', tokens.cashier), env, executionCtx)).status).toBe(403)
    expect((await worker.fetch(req('/api/v1/settings', tokens.inventory_manager), env, executionCtx)).status).toBe(403)
    expect((await worker.fetch(req('/api/v1/settings', tokens.accountant), env, executionCtx)).status).toBe(403)
    expect(
      (
        await worker.fetch(
          req('/api/v1/settings', tokens.admin, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ allowNegativeStock: true }),
          }),
          env,
          executionCtx
        )
      ).status
    ).toBe(403)

    // 2. Customers & Suppliers RBAC
    expect((await worker.fetch(req('/api/v1/customers', tokens.cashier), env, executionCtx)).status).toBe(200)
    expect((await worker.fetch(req('/api/v1/customers', tokens.inventory_manager), env, executionCtx)).status).toBe(403)
    expect(
      (
        await worker.fetch(
          req('/api/v1/customers', tokens.cashier, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Walk Cashier Fail' }),
          }),
          env,
          executionCtx
        )
      ).status
    ).toBe(403)

    expect((await worker.fetch(req('/api/v1/suppliers', tokens.cashier), env, executionCtx)).status).toBe(403)
    expect((await worker.fetch(req('/api/v1/suppliers', tokens.inventory_manager), env, executionCtx)).status).toBe(200)
    expect((await worker.fetch(req('/api/v1/suppliers', tokens.accountant), env, executionCtx)).status).toBe(200)

    // 3. Sales & Invoices read
    expect((await worker.fetch(req('/api/v1/sales', tokens.inventory_manager), env, executionCtx)).status).toBe(403)
    expect((await worker.fetch(req('/api/v1/invoices', tokens.inventory_manager), env, executionCtx)).status).toBe(403)
    expect((await worker.fetch(req('/api/v1/sales', tokens.accountant), env, executionCtx)).status).toBe(200)

    // 4. Payments & Ledgers
    expect((await worker.fetch(req('/api/v1/customer-payments', tokens.inventory_manager), env, executionCtx)).status).toBe(403)
    expect((await worker.fetch(req('/api/v1/supplier-payments', tokens.cashier), env, executionCtx)).status).toBe(403)
    expect((await worker.fetch(req('/api/v1/supplier-payments', tokens.inventory_manager), env, executionCtx)).status).toBe(403)
    expect((await worker.fetch(req('/api/v1/supplier-payments', tokens.accountant), env, executionCtx)).status).toBe(200)
    expect((await worker.fetch(req('/api/v1/customers/cust_mat_1/ledger', tokens.cashier), env, executionCtx)).status).toBe(403)
    expect((await worker.fetch(req('/api/v1/customers/cust_mat_1/ledger/summary', tokens.cashier), env, executionCtx)).status).toBe(200)
    expect((await worker.fetch(req('/api/v1/customers/cust_mat_1/ledger/summary', tokens.inventory_manager), env, executionCtx)).status).toBe(403)
    expect((await worker.fetch(req('/api/v1/suppliers/supp_mat_1/ledger', tokens.cashier), env, executionCtx)).status).toBe(403)
    expect((await worker.fetch(req('/api/v1/suppliers/supp_mat_1/ledger', tokens.accountant), env, executionCtx)).status).toBe(200)

    // 5. Inventory, Purchases, Goods Receipts
    expect((await worker.fetch(req('/api/v1/inventory/balances', tokens.cashier), env, executionCtx)).status).toBe(403)
    expect((await worker.fetch(req('/api/v1/inventory/balances', tokens.accountant), env, executionCtx)).status).toBe(200)
    expect(
      (
        await worker.fetch(
          req('/api/v1/inventory/adjustments', tokens.accountant, {
            method: 'POST',
            branchId: branchA1,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: 'prod_mat_1', type: 'adjustment_in', quantityChange: 1 }),
          }),
          env,
          executionCtx
        )
      ).status
    ).toBe(403)
    expect((await worker.fetch(req('/api/v1/purchases', tokens.cashier), env, executionCtx)).status).toBe(403)
    expect((await worker.fetch(req('/api/v1/goods-receipts', tokens.cashier), env, executionCtx)).status).toBe(403)

    // 6. Expenses & Staff
    expect((await worker.fetch(req('/api/v1/expenses', tokens.cashier), env, executionCtx)).status).toBe(403)
    expect((await worker.fetch(req('/api/v1/expenses', tokens.accountant), env, executionCtx)).status).toBe(200)
    expect((await worker.fetch(req('/api/v1/staff', tokens.cashier), env, executionCtx)).status).toBe(403)
    expect((await worker.fetch(req('/api/v1/staff', tokens.manager), env, executionCtx)).status).toBe(200)
    expect(
      (
        await worker.fetch(
          req('/api/v1/staff/invitations', tokens.manager, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'new@matrix.pk', name: 'New', role: 'cashier', branchIds: [branchA1] }),
          }),
          env,
          executionCtx
        )
      ).status
    ).toBe(403)

    // 7. Sync & Offline
    expect((await worker.fetch(req('/api/v1/sync/devices', tokens.inventory_manager), env, executionCtx)).status).toBe(403)
    expect((await worker.fetch(req('/api/v1/sync/devices', tokens.accountant), env, executionCtx)).status).toBe(403)
    expect(
      (
        await worker.fetch(
          req('/api/v1/offline/allocations/alloc_missing/reconcile', tokens.cashier, { method: 'POST' }),
          env,
          executionCtx
        )
      ).status
    ).toBe(403)
    expect(
      (
        await worker.fetch(
          req('/api/v1/offline/devices/dev_missing/reconcile-lost', tokens.manager, { method: 'POST' }),
          env,
          executionCtx
        )
      ).status
    ).toBe(403)
  })

  it('fails closed when non-owner/non-admin staff has zero assigned member_branches (TEN-001)', async () => {
    // 1. /branches returns empty array for unassigned manager, but returns active branches for owner
    const brUnassigned = await worker.fetch(req('/api/v1/branches', tokens.unassignedManager), env, executionCtx)
    expect(brUnassigned.status).toBe(200)
    const brBody = (await brUnassigned.json()) as { data: unknown[] }
    expect(brBody.data).toEqual([])

    const brOwner = await worker.fetch(req('/api/v1/branches', tokens.owner), env, executionCtx)
    expect(brOwner.status).toBe(200)
    expect(((await brOwner.json()) as { data: unknown[] }).data.length).toBe(3)

    // 2. Mutations requiring a branch fail closed with 403
    const createSaleRes = await worker.fetch(
      req('/api/v1/sales', tokens.unassignedManager, {
        method: 'POST',
        branchId: branchA1,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ productId: 'prod_mat_1', quantity: 1 }],
          payments: [{ method: 'cash', amountMinor: 15000 }],
        }),
      }),
      env,
      executionCtx
    )
    expect(createSaleRes.status).toBe(403)

    const createExpRes = await worker.fetch(
      req('/api/v1/expenses', tokens.unassignedManager, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId: branchA1,
          categoryId: 'exp_cat_mat_1',
          amountMinor: 5000,
          paymentMethod: 'cash',
          title: 'Unauthorized Branch Expense',
          businessDateKey: '2026-11-08',
        }),
      }),
      env,
      executionCtx
    )
    expect(createExpRes.status).toBe(403)

    // 3. Seed a sale on branchA1 as owner -> unassigned manager MUST NOT see it in lists or reports
    sqlite.prepare(`
      INSERT INTO sales (
        id, business_id, branch_id, sale_number, receipt_number, invoice_number,
        customer_id, customer_snapshot_json, cashier_id, cashier_name,
        subtotal_minor, discount_minor, tax_minor, total_amount_minor,
        amount_paid_minor, remaining_balance_minor, status, business_date_key
      ) VALUES
        ('sale_mat_a1', ?, ?, 'SM-1', 'RM-1', 'IM-1', 'cust_mat_1', '{}', ?, 'Owner', 15000, 0, 0, 15000, 0, 15000, 'completed', '2026-11-08')
    `).run(bizA, branchA1, users.owner)

    const salesRes = await worker.fetch(req('/api/v1/sales', tokens.unassignedManager), env, executionCtx)
    expect(salesRes.status).toBe(200)
    expect(((await salesRes.json()) as { data: unknown[] }).data).toEqual([])

    const repRes = await worker.fetch(
      req('/api/v1/reports/dashboard?fromDate=2026-11-01&toDate=2026-11-30', tokens.unassignedManager),
      env,
      executionCtx
    )
    expect(repRes.status).toBe(200)
    const repData = ((await repRes.json()) as { data: any }).data
    expect(repData.sales.totalCompletedSalesMinor).toBe(0)
    expect(repData.inventory.totalQuantityOnHand).toBe(0)
    expect(repData.collections.outstandingReceivablesMinor).toBe(0)
  })

  it('enforces multi-branch isolation on reports, ledgers, receivables/payables, and single-ID operations', async () => {
    // Seed sales across branchA1 (authorized for manager), branchA2 (authorized), and branchA3 (FORBIDDEN for manager)
    sqlite.prepare(`
      INSERT INTO sales (
        id, business_id, branch_id, sale_number, receipt_number, invoice_number,
        customer_id, customer_snapshot_json, cashier_id, cashier_name,
        subtotal_minor, discount_minor, tax_minor, total_amount_minor,
        amount_paid_minor, remaining_balance_minor, status, business_date_key
      ) VALUES
        ('s_m_a1', ?, ?, 'S-A1', 'R-A1', 'I-A1', 'cust_mat_1', '{}', ?, 'Cashier', 10000, 0, 0, 10000, 0, 10000, 'completed', '2026-11-08'),
        ('s_m_a2', ?, ?, 'S-A2', 'R-A2', 'I-A2', 'cust_mat_1', '{}', ?, 'Cashier', 20000, 0, 0, 20000, 0, 20000, 'completed', '2026-11-08'),
        ('s_m_a3', ?, ?, 'S-A3', 'R-A3', 'I-A3', 'cust_mat_1', '{}', ?, 'Owner',   90000, 0, 0, 90000, 0, 90000, 'completed', '2026-11-08')
    `).run(bizA, branchA1, users.cashier, bizA, branchA2, users.cashier2, bizA, branchA3, users.owner)

    // Unfiltered sales summary for manager ([branchA1, branchA2]): 30,000, NOT 120,000
    const summaryRes = await worker.fetch(
      req('/api/v1/reports/sales/summary?fromDate=2026-11-01&toDate=2026-11-30', tokens.manager),
      env,
      executionCtx
    )
    expect(summaryRes.status).toBe(200)
    const summaryData = ((await summaryRes.json()) as { data: any }).data
    expect(summaryData.completedSalesCount).toBe(2)
    expect(summaryData.totalAmountMinor).toBe(30000)

    // Customer receivables report respects [branchA1, branchA2]
    const recvRes = await worker.fetch(req('/api/v1/reports/customers/receivables', tokens.manager), env, executionCtx)
    expect(recvRes.status).toBe(200)
    const recvData = ((await recvRes.json()) as { data: Array<{ balanceMinor: number }> }).data
    expect(recvData[0].balanceMinor).toBe(30000)

    // Explicit branchA3 filter in query returns 403 for manager
    expect(
      (await worker.fetch(req(`/api/v1/reports/sales/summary?branchId=${branchA3}`, tokens.manager), env, executionCtx)).status
    ).toBe(403)

    // Single-ID void on branchA3 sale fails with 403 for manager
    expect(
      (
        await worker.fetch(
          req('/api/v1/sales/s_m_a3/void', tokens.manager, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'Cross branch void attempt' }),
          }),
          env,
          executionCtx
        )
      ).status
    ).toBe(403)

    // Single-ID expense in branchA3 fails with 403 for manager
    sqlite.prepare(`
      INSERT INTO expenses (id, business_id, branch_id, expense_number, category_id, title, amount_minor, payment_method, status, business_date_key, created_by)
      VALUES ('exp_m_a3', ?, ?, 'EXP-A3-1', 'exp_cat_mat_1', 'Branch 3 Rent', 50000, 'cash', 'posted', '2026-11-08', ?)
    `).run(bizA, branchA3, users.owner)

    expect((await worker.fetch(req('/api/v1/expenses/exp_m_a3', tokens.manager), env, executionCtx)).status).toBe(403)
    expect(
      (
        await worker.fetch(
          req('/api/v1/expenses/exp_m_a3/void', tokens.manager, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'Cross branch expense void' }),
          }),
          env,
          executionCtx
        )
      ).status
    ).toBe(403)
  })

  it('enforces file category RBAC, branch isolation, and prevents unauthorized deletion', async () => {
    // 1. Cashier cannot upload business_logo
    const logoForm = new FormData()
    logoForm.set('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'logo.png', { type: 'image/png' }))
    logoForm.set('category', 'business_logo')
    const logoFail = await worker.fetch(
      req('/api/v1/files', tokens.cashier, { method: 'POST', branchId: branchA1, body: logoForm }),
      env,
      executionCtx
    )
    expect(logoFail.status).toBe(403)

    // 2. Accountant uploads receipt_attachment on branchA1 (201)
    const expReceiptForm = new FormData()
    expReceiptForm.set('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'receipt.png', { type: 'image/png' }))
    expReceiptForm.set('category', 'receipt_attachment')
    const receiptRes = await worker.fetch(
      req('/api/v1/files', tokens.accountant, { method: 'POST', branchId: branchA1, body: expReceiptForm }),
      env,
      executionCtx
    )
    expect(receiptRes.status).toBe(201)
    const receiptFileId = ((await receiptRes.json()) as { data: { id: string } }).data.id

    // 3. Inventory manager cannot see/read receipt_attachment
    const invList = await worker.fetch(req('/api/v1/files', tokens.inventory_manager), env, executionCtx)
    expect(invList.status).toBe(200)
    expect(((await invList.json()) as { data: Array<{ id: string }> }).data.some((f) => f.id === receiptFileId)).toBe(false)
    expect((await worker.fetch(req(`/api/v1/files/${receiptFileId}`, tokens.inventory_manager), env, executionCtx)).status).toBe(403)

    // 4. Cashier2 (assigned ONLY to branchA2) cannot read branchA1 file or delete it
    expect((await worker.fetch(req(`/api/v1/files/${receiptFileId}`, tokens.cashier2), env, executionCtx)).status).toBe(403)
    expect((await worker.fetch(req(`/api/v1/files/${receiptFileId}`, tokens.cashier, { method: 'DELETE' }), env, executionCtx)).status).toBe(403)

    // 5. Manager uploads a receipt_attachment, then gets demoted to cashier -> can no longer delete their own file (TEN-002)
    const mgrForm = new FormData()
    mgrForm.set('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'mgr.png', { type: 'image/png' }))
    mgrForm.set('category', 'receipt_attachment')
    const mgrUp = await worker.fetch(
      req('/api/v1/files', tokens.manager, { method: 'POST', branchId: branchA1, body: mgrForm }),
      env,
      executionCtx
    )
    expect(mgrUp.status).toBe(201)
    const mgrFileId = ((await mgrUp.json()) as { data: { id: string } }).data.id

    sqlite.prepare("UPDATE business_members SET role = 'cashier' WHERE id = 'mem_mat_manager'").run()
    expect((await worker.fetch(req(`/api/v1/files/${mgrFileId}`, tokens.manager, { method: 'DELETE' }), env, executionCtx)).status).toBe(403)
  })

  it('rejects cross-tenant and inactive branchIds in staff invitations and branch updates (SEC-004)', async () => {
    // 1. Invite staff with Business B's branchId -> 400
    const crossBizInvite = await worker.fetch(
      req('/api/v1/staff/invitations', tokens.owner, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'badbranch@matrix.pk',
          name: 'Bad Branch',
          role: 'cashier',
          branchIds: [branchB1],
        }),
      }),
      env,
      executionCtx
    )
    expect(crossBizInvite.status).toBe(400)

    // 2. Invite staff with inactive Business A branchId -> 400
    const inactiveInvite = await worker.fetch(
      req('/api/v1/staff/invitations', tokens.owner, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'inactive@matrix.pk',
          name: 'Inactive Branch',
          role: 'cashier',
          branchIds: [branchAInactive],
        }),
      }),
      env,
      executionCtx
    )
    expect(inactiveInvite.status).toBe(400)

    // 3. Update staff branches with foreign branchId -> 400 & original branches preserved
    const updateBranchesRes = await worker.fetch(
      req('/api/v1/staff/mem_mat_cashier/branches', tokens.owner, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchIds: [branchA1, branchB1] }),
      }),
      env,
      executionCtx
    )
    expect(updateBranchesRes.status).toBe(400)

    const assignedRows = sqlite
      .prepare('SELECT branch_id FROM member_branches WHERE member_id = ?')
      .all('mem_mat_cashier') as Array<{ branch_id: string }>
    expect(assignedRows.map((r) => r.branch_id)).toEqual([branchA1])

    // 4. Legacy/forged invitation carrying foreign branchB1 fails closed BEFORE creating membership
    const rawInviteToken = 'tok_forged_br_123'
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawInviteToken))
    const tokenHash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    sqlite.prepare(`
      INSERT INTO staff_invitations (
        id, business_id, email, role, token_hash, branch_ids_json, invited_by, expires_at
      ) VALUES (
        'inv_forged_branch', ?, 'bizbowner@matrix.pk', 'cashier', ?, ?, ?, '2099-12-31T23:59:59Z'
      )
    `).run(bizA, tokenHash, JSON.stringify([branchB1]), users.owner)

    const acceptRes = await worker.fetch(
      req('/api/v1/staff/invitations/accept', tokens.bizBOwner, {
        method: 'POST',
        businessId: '',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: rawInviteToken }),
      }),
      env,
      executionCtx
    )
    expect(acceptRes.status).toBe(400)
    const leakedMem = sqlite
      .prepare('SELECT * FROM business_members WHERE business_id = ? AND user_id = ?')
      .get(bizA, users.bizBOwner)
    expect(leakedMem).toBeUndefined()
  })

  it('prevents sync device impersonation across users in the same business', async () => {
    // Cashier 1 registers dev_cashier_1
    const regRes = await worker.fetch(
      req('/api/v1/sync/devices/register', tokens.cashier, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installationId: 'inst_c1', label: 'Counter 1' }),
      }),
      env,
      executionCtx
    )
    expect(regRes.status).toBe(201)
    const devId = ((await regRes.json()) as { data: { id: string } }).data.id

    // Cashier 2 attempts heartbeat, pull changes, ack, and revoke using Cashier 1's device
    expect(
      (
        await worker.fetch(
          req('/api/v1/sync/devices/heartbeat', tokens.cashier2, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ installationId: 'inst_c1' }),
          }),
          env,
          executionCtx
        )
      ).status
    ).toBe(403)

    expect(
      (
        await worker.fetch(
          req('/api/v1/sync/changes', tokens.cashier2, {
            branchId: branchA2,
            headers: { 'X-Device-Id': 'inst_c1' },
          }),
          env,
          executionCtx
        )
      ).status
    ).toBe(403)

    expect(
      (
        await worker.fetch(
          req('/api/v1/sync/ack', tokens.cashier2, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'inst_c1' },
            body: JSON.stringify({ installationId: 'inst_c1', cursor: 'seq_0' }),
          }),
          env,
          executionCtx
        )
      ).status
    ).toBe(403)

    expect(
      (
        await worker.fetch(
          req(`/api/v1/sync/devices/${devId}/revoke`, tokens.cashier2, { method: 'POST' }),
          env,
          executionCtx
        )
      ).status
    ).toBe(403)
  })
})
