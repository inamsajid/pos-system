import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import worker from '../worker/src/index'
import { Router } from '../worker/src/router'
import { jsonResponse } from '../worker/src/lib/response'
import type { Env } from '../worker/src/types/environment'
import { generateId } from '../worker/src/auth/crypto'
import { createSession } from '../worker/src/auth/sessionService'
import { hasPermission } from '../worker/src/auth/tenantContext'
import {
  requirePermission,
  requireBranchContext,
} from '../worker/src/middleware/authMiddleware'

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

describe('Zero-Trust Tenant & Branch Isolation', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  beforeEach(() => {
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
  })

  it('verifies RBAC permission matrix definitions strictly', () => {
    // Owner has unrestricted rights
    expect(hasPermission('owner', 'manage_settings')).toBe(true)
    expect(hasPermission('owner', 'export_backup')).toBe(true)

    // Admin can manage staff but cannot export full backup
    expect(hasPermission('admin', 'manage_staff')).toBe(true)
    expect(hasPermission('admin', 'export_backup')).toBe(false)

    // Cashier can do POS sales and collect customer payments, but CANNOT write catalog or disburse supplier payments
    expect(hasPermission('cashier', 'pos_sale')).toBe(true)
    expect(hasPermission('cashier', 'collect_payments')).toBe(true)
    expect(hasPermission('cashier', 'catalog_write')).toBe(false)
    expect(hasPermission('cashier', 'disburse_payments')).toBe(false)
    expect(hasPermission('cashier', 'stock_adjustment')).toBe(false)

    // Inventory Manager can adjust stock, receive goods, and create purchase orders, but CANNOT collect payments
    expect(hasPermission('inventory_manager', 'stock_adjustment')).toBe(true)
    expect(hasPermission('inventory_manager', 'receive_goods')).toBe(true)
    expect(hasPermission('inventory_manager', 'collect_payments')).toBe(false)

    // Accountant can view reports and payments, but CANNOT complete sales
    expect(hasPermission('accountant', 'reports_view')).toBe(true)
    expect(hasPermission('accountant', 'disburse_payments')).toBe(true)
    expect(hasPermission('accountant', 'pos_sale')).toBe(false)

    // Default deny for undefined / unapproved permissions
    // @ts-expect-error verifying invalid permission fallback
    expect(hasPermission('cashier', 'unknown_permission')).toBe(false)
  })

  it('enforces symmetrical tenant boundaries: User A cannot access Business B, User B cannot access Business A', async () => {
    // 1. Seed Business A & User A
    const userA = generateId()
    const bizA = generateId()
    const branchA = generateId()
    sqlite.prepare(`INSERT INTO users (id, email, name, status) VALUES (?, 'userA@store.pk', 'User A', 'active')`).run(userA)
    sqlite.prepare(`INSERT INTO businesses (id, business_code, name, status) VALUES (?, 'BIZA', 'Store A', 'active')`).run(bizA)
    sqlite.prepare(`INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status) VALUES (?, ?, 'MAIN', 'Branch A', 1, 'active')`).run(branchA, bizA)
    sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role, is_active) VALUES ('m-a', ?, ?, 'owner', 1)`).run(bizA, userA)

    // 2. Seed Business B & User B
    const userB = generateId()
    const bizB = generateId()
    const branchB = generateId()
    sqlite.prepare(`INSERT INTO users (id, email, name, status) VALUES (?, 'userB@store.pk', 'User B', 'active')`).run(userB)
    sqlite.prepare(`INSERT INTO businesses (id, business_code, name, status) VALUES (?, 'BIZB', 'Store B', 'active')`).run(bizB)
    sqlite.prepare(`INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status) VALUES (?, ?, 'MAIN', 'Branch B', 1, 'active')`).run(branchB, bizB)
    sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role, is_active) VALUES ('m-b', ?, ?, 'owner', 1)`).run(bizB, userB)

    const { cookie: cookieA } = await createSession(d1, userA)
    const { cookie: cookieB } = await createSession(d1, userB)

    // User A can access Business A
    const listA = await worker.fetch(
      new Request('http://localhost:8787/api/v1/businesses', { headers: { Cookie: cookieA } }),
      env,
      executionCtx
    )
    expect(listA.status).toBe(200)

    // User A attempting to query Business B via header injection is rejected
    const crossReqA = new Request('http://localhost:8787/api/v1/branches', {
      headers: { Cookie: cookieA, 'X-Business-Id': bizB },
    })
    const crossResA = await worker.fetch(crossReqA, env, executionCtx)
    expect(crossResA.status).toBe(403)

    // User B attempting to query Business A via header injection is symmetrically rejected
    const crossReqB = new Request('http://localhost:8787/api/v1/branches', {
      headers: { Cookie: cookieB, 'X-Business-Id': bizA },
    })
    const crossResB = await worker.fetch(crossReqB, env, executionCtx)
    expect(crossResB.status).toBe(403)
  })

  it('rejects suspended memberships and banned users', async () => {
    const user = generateId()
    const biz = generateId()
    const branch = generateId()

    sqlite.prepare(`INSERT INTO users (id, email, name, status) VALUES (?, 'banned@store.pk', 'Banned User', 'banned')`).run(user)
    sqlite.prepare(`INSERT INTO businesses (id, business_code, name, status) VALUES (?, 'BIZ_ACT', 'Active Store', 'active')`).run(biz)
    sqlite.prepare(`INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status) VALUES (?, ?, 'M', 'Main', 1, 'active')`).run(branch, biz)
    sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role, is_active) VALUES ('m-1', ?, ?, 'owner', 1)`).run(biz, user)

    const { cookie } = await createSession(d1, user)

    // Banned user cannot authenticate (validateSession rejects non-active users)
    const res = await worker.fetch(
      new Request('http://localhost:8787/api/v1/auth/me', { headers: { Cookie: cookie } }),
      env,
      executionCtx
    )
    expect(res.status).toBe(401)

    // Inactive membership test: user is active, but membership is deactivated (is_active = 0)
    const user2 = generateId()
    sqlite.prepare(`INSERT INTO users (id, email, name, status) VALUES (?, 'inactive_mem@store.pk', 'Inactive Member', 'active')`).run(user2)
    sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role, is_active) VALUES ('m-2', ?, ?, 'cashier', 0)`).run(biz, user2)

    const { cookie: cookie2 } = await createSession(d1, user2)
    const listRes = await worker.fetch(
      new Request('http://localhost:8787/api/v1/businesses', { headers: { Cookie: cookie2 } }),
      env,
      executionCtx
    )
    expect(listRes.status).toBe(200)
    const listBody = (await listRes.json()) as { data: unknown[] }
    expect(listBody.data).toHaveLength(0) // No active business memberships returned

    const branchRes = await worker.fetch(
      new Request('http://localhost:8787/api/v1/branches', { headers: { Cookie: cookie2, 'X-Business-Id': biz } }),
      env,
      executionCtx
    )
    expect(branchRes.status).toBe(403) // Access denied
  })

  it('requires X-Business-Id when user belongs to multiple businesses', async () => {
    const user = generateId()
    const biz1 = generateId()
    const biz2 = generateId()

    sqlite.prepare(`INSERT INTO users (id, email, name, status) VALUES (?, 'multi@store.pk', 'Multi Owner', 'active')`).run(user)
    sqlite.prepare(`INSERT INTO businesses (id, business_code, name, status) VALUES (?, 'BIZ1', 'Store One', 'active')`).run(biz1)
    sqlite.prepare(`INSERT INTO businesses (id, business_code, name, status) VALUES (?, 'BIZ2', 'Store Two', 'active')`).run(biz2)
    sqlite.prepare(`INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status) VALUES ('br1', ?, 'M1', 'Main 1', 1, 'active')`).run(biz1)
    sqlite.prepare(`INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status) VALUES ('br2', ?, 'M2', 'Main 2', 1, 'active')`).run(biz2)

    sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role, is_active) VALUES ('m-1', ?, ?, 'owner', 1)`).run(biz1, user)
    sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role, is_active) VALUES ('m-2', ?, ?, 'owner', 1)`).run(biz2, user)

    const { cookie } = await createSession(d1, user)

    const ambiguousReq = new Request('http://localhost:8787/api/v1/branches', {
      headers: { Cookie: cookie },
    })
    const res = await worker.fetch(ambiguousReq, env, executionCtx)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toContain('Specify target business via X-Business-Id header')

    const explicitReq = new Request('http://localhost:8787/api/v1/branches', {
      headers: {
        Cookie: cookie,
        'X-Business-Id': biz1,
      },
    })
    const explicitRes = await worker.fetch(explicitReq, env, executionCtx)
    expect(explicitRes.status).toBe(200)
    const explicitBody = (await explicitRes.json()) as { data: Array<{ id: string }> }
    expect(explicitBody.data).toHaveLength(1)
    expect(explicitBody.data[0].id).toBe('br1')
  })

  describe('Branch Authorization & Restriction Enforcement', () => {
    it('enforces branch restrictions: manager or cashier assigned only to Branch 1 cannot access Branch 2', async () => {
      const bizId = generateId()
      const branch1 = generateId()
      const branch2 = generateId()
      const cashierId = generateId()
      const managerId = generateId()

      sqlite.prepare(`INSERT INTO businesses (id, business_code, name) VALUES (?, 'STORE', 'Retail Store')`).run(bizId)
      sqlite.prepare(`INSERT INTO branches (id, business_id, branch_code, name, is_main_branch) VALUES (?, ?, 'B1', 'Branch 1', 1)`).run(branch1, bizId)
      sqlite.prepare(`INSERT INTO branches (id, business_id, branch_code, name, is_main_branch) VALUES (?, ?, 'B2', 'Branch 2', 0)`).run(branch2, bizId)

      // Cashier assigned only to Branch 1
      sqlite.prepare(`INSERT INTO users (id, email, name) VALUES (?, 'cashier1@store.pk', 'Cashier One')`).run(cashierId)
      sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role) VALUES ('mem-cashier', ?, ?, 'cashier')`).run(bizId, cashierId)
      sqlite.prepare(`INSERT INTO member_branches (id, member_id, branch_id) VALUES ('mb-1', 'mem-cashier', ?)`).run(branch1)

      // Manager assigned only to Branch 1
      sqlite.prepare(`INSERT INTO users (id, email, name) VALUES (?, 'manager1@store.pk', 'Manager One')`).run(managerId)
      sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role) VALUES ('mem-manager', ?, ?, 'manager')`).run(bizId, managerId)
      sqlite.prepare(`INSERT INTO member_branches (id, member_id, branch_id) VALUES ('mb-2', 'mem-manager', ?)`).run(branch1)

      const testRouter = new Router()
      testRouter.get('/api/v1/test/guarded-branch', async (ctx) => {
        await requireBranchContext(ctx)
        return jsonResponse({ branchId: ctx.branch?.id })
      })

      const { cookie: cashierCookie } = await createSession(d1, cashierId)
      const { cookie: managerCookie } = await createSession(d1, managerId)

      // Cashier accesses Branch 1 (allowed)
      const c1 = await testRouter.handle(
        new Request(`http://localhost:8787/api/v1/test/guarded-branch`, {
          headers: { Cookie: cashierCookie, 'X-Business-Id': bizId, 'X-Branch-Id': branch1 },
        }),
        env,
        executionCtx
      )
      expect(c1.status).toBe(200)

      // Cashier accesses Branch 2 (forbidden)
      const c2 = await testRouter.handle(
        new Request(`http://localhost:8787/api/v1/test/guarded-branch`, {
          headers: { Cookie: cashierCookie, 'X-Business-Id': bizId, 'X-Branch-Id': branch2 },
        }),
        env,
        executionCtx
      )
      expect(c2.status).toBe(403)

      // Manager accesses Branch 2 (forbidden)
      const m2 = await testRouter.handle(
        new Request(`http://localhost:8787/api/v1/test/guarded-branch`, {
          headers: { Cookie: managerCookie, 'X-Business-Id': bizId, 'X-Branch-Id': branch2 },
        }),
        env,
        executionCtx
      )
      expect(m2.status).toBe(403)
    })

    it('allows owner and admin full access across all branches in their business', async () => {
      const bizId = generateId()
      const branch1 = generateId()
      const branch2 = generateId()
      const ownerId = generateId()
      const adminId = generateId()

      sqlite.prepare(`INSERT INTO businesses (id, business_code, name) VALUES (?, 'STORE2', 'Retail Store 2')`).run(bizId)
      sqlite.prepare(`INSERT INTO branches (id, business_id, branch_code, name, is_main_branch) VALUES (?, ?, 'B1', 'Branch 1', 1)`).run(branch1, bizId)
      sqlite.prepare(`INSERT INTO branches (id, business_id, branch_code, name, is_main_branch) VALUES (?, ?, 'B2', 'Branch 2', 0)`).run(branch2, bizId)

      sqlite.prepare(`INSERT INTO users (id, email, name) VALUES (?, 'owner@store2.pk', 'Owner')`).run(ownerId)
      sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role) VALUES ('mem-own', ?, ?, 'owner')`).run(bizId, ownerId)

      sqlite.prepare(`INSERT INTO users (id, email, name) VALUES (?, 'admin@store2.pk', 'Admin')`).run(adminId)
      sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role) VALUES ('mem-adm', ?, ?, 'admin')`).run(bizId, adminId)

      const testRouter = new Router()
      testRouter.get('/api/v1/test/branch', async (ctx) => {
        await requireBranchContext(ctx)
        return jsonResponse({ branchId: ctx.branch?.id })
      })

      const { cookie: ownerCookie } = await createSession(d1, ownerId)
      const { cookie: adminCookie } = await createSession(d1, adminId)

      // Owner accesses Branch 1 and Branch 2
      const o1 = await testRouter.handle(
        new Request(`http://localhost:8787/api/v1/test/branch`, {
          headers: { Cookie: ownerCookie, 'X-Business-Id': bizId, 'X-Branch-Id': branch1 },
        }),
        env,
        executionCtx
      )
      expect(o1.status).toBe(200)

      const o2 = await testRouter.handle(
        new Request(`http://localhost:8787/api/v1/test/branch`, {
          headers: { Cookie: ownerCookie, 'X-Business-Id': bizId, 'X-Branch-Id': branch2 },
        }),
        env,
        executionCtx
      )
      expect(o2.status).toBe(200)

      // Admin accesses Branch 2
      const a2 = await testRouter.handle(
        new Request(`http://localhost:8787/api/v1/test/branch`, {
          headers: { Cookie: adminCookie, 'X-Business-Id': bizId, 'X-Branch-Id': branch2 },
        }),
        env,
        executionCtx
      )
      expect(a2.status).toBe(200)
    })

    it('rejects foreign branches even when requested by an owner (cannot bypass business tenant boundary)', async () => {
      const bizA = generateId()
      const bizB = generateId()
      const branchA = generateId()
      const branchB = generateId()
      const ownerA = generateId()

      sqlite.prepare(`INSERT INTO businesses (id, business_code, name) VALUES (?, 'BIZA', 'Store A')`).run(bizA)
      sqlite.prepare(`INSERT INTO businesses (id, business_code, name) VALUES (?, 'BIZB', 'Store B')`).run(bizB)
      sqlite.prepare(`INSERT INTO branches (id, business_id, branch_code, name) VALUES (?, ?, 'A1', 'Branch A')`).run(branchA, bizA)
      sqlite.prepare(`INSERT INTO branches (id, business_id, branch_code, name) VALUES (?, ?, 'B1', 'Branch B')`).run(branchB, bizB)

      sqlite.prepare(`INSERT INTO users (id, email, name) VALUES (?, 'ownera@test.pk', 'Owner A')`).run(ownerA)
      sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role) VALUES ('mem-a', ?, ?, 'owner')`).run(bizA, ownerA)

      const testRouter = new Router()
      testRouter.get('/api/v1/test/branch', async (ctx) => {
        await requireBranchContext(ctx)
        return jsonResponse({ branchId: ctx.branch?.id })
      })

      const { cookie } = await createSession(d1, ownerA)

      // Owner A specifies active Business A, but requests Branch B (which belongs to Business B)
      const res = await testRouter.handle(
        new Request('http://localhost:8787/api/v1/test/branch', {
          headers: { Cookie: cookie, 'X-Business-Id': bizA, 'X-Branch-Id': branchB },
        }),
        env,
        executionCtx
      )
      expect(res.status).toBe(403)
      const body = (await res.json()) as { error: { message: string } }
      expect(body.error.message).toContain('Access to specified branch is denied')
    })
  })

  describe('RBAC Middleware Enforcement (requirePermission)', () => {
    it('enforces role permission guards and blocks client-supplied role escalation attempts', async () => {
      const bizId = generateId()
      const branchId = generateId()
      const cashierId = generateId()
      const ownerId = generateId()

      sqlite.prepare(`INSERT INTO businesses (id, business_code, name) VALUES (?, 'PERM_BIZ', 'Permission Test Store')`).run(bizId)
      sqlite.prepare(`INSERT INTO branches (id, business_id, branch_code, name, is_main_branch) VALUES (?, ?, 'M', 'Main', 1)`).run(branchId, bizId)

      sqlite.prepare(`INSERT INTO users (id, email, name) VALUES (?, 'cashier@perm.pk', 'Cashier User')`).run(cashierId)
      sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role) VALUES ('mem-c', ?, ?, 'cashier')`).run(bizId, cashierId)

      sqlite.prepare(`INSERT INTO users (id, email, name) VALUES (?, 'owner@perm.pk', 'Owner User')`).run(ownerId)
      sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role) VALUES ('mem-o', ?, ?, 'owner')`).run(bizId, ownerId)

      const testRouter = new Router()
      // Operation requiring owner-level settings permission
      testRouter.post('/api/v1/test/settings', async (ctx) => {
        await requirePermission('manage_settings')(ctx)
        return jsonResponse({ success: true, message: 'Settings modified.' })
      })
      // Operation requiring cashier-level pos sale permission
      testRouter.post('/api/v1/test/checkout', async (ctx) => {
        await requirePermission('pos_sale')(ctx)
        return jsonResponse({ success: true, message: 'Sale completed.' })
      })

      const { cookie: cashierCookie } = await createSession(d1, cashierId)
      const { cookie: ownerCookie } = await createSession(d1, ownerId)

      // Cashier completing sale succeeds (200)
      const saleRes = await testRouter.handle(
        new Request('http://localhost:8787/api/v1/test/checkout', {
          method: 'POST',
          headers: { Cookie: cashierCookie, 'X-Business-Id': bizId, 'Content-Type': 'application/json' },
        }),
        env,
        executionCtx
      )
      expect(saleRes.status).toBe(200)

      // Cashier attempting to modify settings fails (403)
      const badSettingsRes = await testRouter.handle(
        new Request('http://localhost:8787/api/v1/test/settings', {
          method: 'POST',
          headers: { Cookie: cashierCookie, 'X-Business-Id': bizId, 'Content-Type': 'application/json' },
        }),
        env,
        executionCtx
      )
      expect(badSettingsRes.status).toBe(403)
      const badBody = (await badSettingsRes.json()) as { error: { message: string } }
      expect(badBody.error.message).toContain("Role 'cashier' lacks 'manage_settings' permission")

      // Cashier attempting privilege escalation via malicious X-Role header is denied
      const spoofRoleRes = await testRouter.handle(
        new Request('http://localhost:8787/api/v1/test/settings', {
          method: 'POST',
          headers: {
            Cookie: cashierCookie,
            'X-Business-Id': bizId,
            'X-Role': 'owner', // Malicious header attempt
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ role: 'owner' }), // Malicious body attempt
        }),
        env,
        executionCtx
      )
      expect(spoofRoleRes.status).toBe(403)

      // Cashier attempting user ID spoofing in body/query cannot override session identity
      const spoofUserRes = await testRouter.handle(
        new Request(`http://localhost:8787/api/v1/test/settings?user_id=${ownerId}`, {
          method: 'POST',
          headers: {
            Cookie: cashierCookie,
            'X-Business-Id': bizId,
            'X-User-Id': ownerId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ user_id: ownerId }),
        }),
        env,
        executionCtx
      )
      expect(spoofUserRes.status).toBe(403)

      // Real owner modifying settings succeeds (200)
      const ownerSettingsRes = await testRouter.handle(
        new Request('http://localhost:8787/api/v1/test/settings', {
          method: 'POST',
          headers: { Cookie: ownerCookie, 'X-Business-Id': bizId, 'Content-Type': 'application/json' },
        }),
        env,
        executionCtx
      )
      expect(ownerSettingsRes.status).toBe(200)
    })
  })
})
