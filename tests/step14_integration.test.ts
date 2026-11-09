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

describe('Step 14 — Cross-Module Business Management Integration', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const businessId = 'biz_integration_14'
  const branchId = 'br_integration_14'
  const ownerUserId = 'usr_owner_int'
  let ownerToken: string

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
      VALUES (?, 'BIZINT14', 'All-in-One Retail System', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'BRMAIN', 'Main Central Branch', 1, 'active')
    `).run(branchId, businessId)

    // Seed Owner
    sqlite.prepare(`INSERT INTO users (id, email, name, status) VALUES (?, 'owner@retail.com', 'System Owner', 'active')`).run(ownerUserId)
    sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role, is_active) VALUES ('bm_int_owner', ?, ?, 'owner', 1)`).run(businessId, ownerUserId)

    const ownerSession = await createSession(d1, ownerUserId)
    ownerToken = ownerSession.token
  })

  it('guarantees tenant isolation across ledgers, expenses, and staff', async () => {
    // Another tenant
    const otherBizId = 'biz_other_tenant'
    sqlite.prepare(`INSERT INTO businesses (id, business_code, name, status) VALUES (?, 'BIZOTHER', 'Other Tenant', 'active')`).run(otherBizId)

    // Create expense in businessId
    const catId = 'cat_test_int'
    sqlite.prepare(`INSERT INTO expense_categories (id, business_id, name, status) VALUES (?, ?, 'Office', 'active')`).run(catId, businessId)

    const expRes = await worker.fetch(new Request('https://api.pos.local/api/v1/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}`, 'X-Business-Id': businessId },
      body: JSON.stringify({ branchId, categoryId: catId, amountMinor: 750000, paymentMethod: 'cash', title: 'Tenant Isolation Test' }),
    }), env, executionCtx)
    expect(expRes.status).toBe(201)

    // Try to read expenses as other tenant
    const otherUser = 'usr_other'
    sqlite.prepare(`INSERT INTO users (id, email, name, status) VALUES (?, 'other@user.com', 'Other', 'active')`).run(otherUser)
    sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role, is_active) VALUES ('bm_other', ?, ?, 'owner', 1)`).run(otherBizId, otherUser)
    const otherSession = await createSession(d1, otherUser)

    const readOtherRes = await worker.fetch(new Request('https://api.pos.local/api/v1/expenses', {
      method: 'GET',
      headers: { Authorization: `Bearer ${otherSession.token}`, 'X-Business-Id': otherBizId },
    }), env, executionCtx)
    expect(readOtherRes.status).toBe(200)
    const otherJson = (await readOtherRes.json()) as any
    expect(otherJson.success).toBe(true)
    expect(otherJson.data.items.length).toBe(0) // Completely isolated
  })

  it('records full audit log trail across all management actions', async () => {
    // 1. Create Category
    await worker.fetch(new Request('https://api.pos.local/api/v1/expense-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}`, 'X-Business-Id': businessId },
      body: JSON.stringify({ name: 'Fleet Fuel' }),
    }), env, executionCtx)

    // Find category ID
    const cat = sqlite.prepare(`SELECT id FROM expense_categories WHERE business_id = ? AND name = 'Fleet Fuel'`).get(businessId) as any

    // 2. Record Expense
    const expRes = await worker.fetch(new Request('https://api.pos.local/api/v1/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}`, 'X-Business-Id': businessId },
      body: JSON.stringify({ branchId, categoryId: cat.id, amountMinor: 500000, paymentMethod: 'card', title: 'Van Fuel' }),
    }), env, executionCtx)
    const expJson = (await expRes.json()) as any
    const exp = expJson.data

    // 3. Void Expense
    await worker.fetch(new Request(`https://api.pos.local/api/v1/expenses/${exp.id}/void`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}`, 'X-Business-Id': businessId },
      body: JSON.stringify({ reason: 'Charged to wrong vehicle' }),
    }), env, executionCtx)

    // 4. Invite Staff
    await worker.fetch(new Request('https://api.pos.local/api/v1/staff/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}`, 'X-Business-Id': businessId },
      body: JSON.stringify({ email: 'driver@fleet.com', role: 'cashier' }),
    }), env, executionCtx)

    // Audit logs inspection
    const auditLogs = sqlite.prepare(`SELECT * FROM audit_logs WHERE business_id = ? ORDER BY created_at ASC`).all(businessId) as any[]
    expect(auditLogs.length).toBeGreaterThanOrEqual(3)

    const actions = auditLogs.map(l => l.action)
    expect(actions).toContain('create_expense')
    expect(actions).toContain('void_expense')
    expect(actions).toContain('invite_staff')
  })
})
