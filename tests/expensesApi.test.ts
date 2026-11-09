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

describe('Step 14.2 — Expenses Management API (/api/v1/expenses)', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const businessId = 'biz_exp_14'
  const branchId = 'br_exp_14'
  const ownerUserId = 'usr_owner_exp'
  const cashierUserId = 'usr_cashier_exp'
  const accountantUserId = 'usr_acct_exp'

  let ownerToken: string
  let cashierToken: string
  let accountantToken: string
  let categoryId: string

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
      VALUES (?, 'BIZEXP', 'Expense Retail Corp', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'BRMAIN', 'Main Store', 1, 'active')
    `).run(branchId, businessId)

    // Seed Users & Roles
    sqlite.prepare(`INSERT INTO users (id, email, name, status) VALUES (?, 'owner@exp.com', 'Owner', 'active')`).run(ownerUserId)
    sqlite.prepare(`INSERT INTO users (id, email, name, status) VALUES (?, 'cashier@exp.com', 'Cashier', 'active')`).run(cashierUserId)
    sqlite.prepare(`INSERT INTO users (id, email, name, status) VALUES (?, 'accountant@exp.com', 'Accountant', 'active')`).run(accountantUserId)

    sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role, is_active) VALUES ('bm_owner', ?, ?, 'owner', 1)`).run(businessId, ownerUserId)
    sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role, is_active) VALUES ('bm_cashier', ?, ?, 'cashier', 1)`).run(businessId, cashierUserId)
    sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role, is_active) VALUES ('bm_acct', ?, ?, 'accountant', 1)`).run(businessId, accountantUserId)

    const ownerSession = await createSession(d1, ownerUserId)
    ownerToken = ownerSession.token

    const cashierSession = await createSession(d1, cashierUserId)
    cashierToken = cashierSession.token

    const acctSession = await createSession(d1, accountantUserId)
    accountantToken = acctSession.token

    // Seed Category
    categoryId = 'cat_utilities_14'
    sqlite.prepare(`
      INSERT INTO expense_categories (id, business_id, name, description, status)
      VALUES (?, ?, 'Utilities & Bills', 'Monthly electric and gas bills', 'active')
    `).run(categoryId, businessId)
  })

  it('records an expense with integer minor paise amount and generates sequential EXP- number', async () => {
    const req = new Request('https://api.pos.local/api/v1/expenses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
        'X-Business-Id': businessId,
        'X-Branch-Id': branchId,
      },
      body: JSON.stringify({
        branchId,
        categoryId,
        amountMinor: 1250000, // 12,500.00 Rs
        paymentMethod: 'bank_transfer',
        title: 'Electricity Bill Oct 2026',
        notes: 'LESCO bill paid via bank transfer',
      }),
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(201)

    const json = (await res.json()) as any
    expect(json.success).toBe(true)
    const data = json.data
    expect(data.id).toMatch(/^exp-/)
    expect(data.expenseNumber).toMatch(/^EXP-\d{8}-\d{4}$/)
    expect(data.amountMinor).toBe(1250000)
    expect(data.amount).toBe(12500)
    expect(data.status).toBe('posted')
    expect(data.categoryName).toBe('Utilities & Bills')
  })

  it('rejects recording an expense if amount is zero or negative', async () => {
    const req = new Request('https://api.pos.local/api/v1/expenses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
        'X-Business-Id': businessId,
        'X-Branch-Id': branchId,
      },
      body: JSON.stringify({
        branchId,
        categoryId,
        amountMinor: 0,
        paymentMethod: 'cash',
        title: 'Zero Amount Expense',
      }),
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(400)
  })

  it('rejects expense recording from a cashier role lacking expenses_write permission', async () => {
    const req = new Request('https://api.pos.local/api/v1/expenses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cashierToken}`,
        'X-Business-Id': businessId,
        'X-Branch-Id': branchId,
      },
      body: JSON.stringify({
        branchId,
        categoryId,
        amountMinor: 50000,
        paymentMethod: 'cash',
        title: 'Unauthorized cashier expense',
      }),
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(403)
  })

  it('voids an expense with audit log reason and prevents duplicate voiding', async () => {
    // 1. Create expense
    const createReq = new Request('https://api.pos.local/api/v1/expenses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
        'X-Business-Id': businessId,
      },
      body: JSON.stringify({
        branchId,
        categoryId,
        amountMinor: 450000,
        paymentMethod: 'cash',
        title: 'Packaging Bags Purchase',
      }),
    })
    const createRes = await worker.fetch(createReq, env, executionCtx)
    expect(createRes.status).toBe(201)
    const createJson = (await createRes.json()) as any
    const created = createJson.data

    // 2. Void expense
    const voidReq = new Request(`https://api.pos.local/api/v1/expenses/${created.id}/void`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
        'X-Business-Id': businessId,
      },
      body: JSON.stringify({
        reason: 'Vendor cancelled delivery and refunded cash',
      }),
    })
    const voidRes = await worker.fetch(voidReq, env, executionCtx)
    expect(voidRes.status).toBe(200)

    const voidJson = (await voidRes.json()) as any
    expect(voidJson.success).toBe(true)
    const voidedData = voidJson.data
    expect(voidedData.status).toBe('voided')
    expect(voidedData.voidReason).toBe('Vendor cancelled delivery and refunded cash')
    expect(voidedData.voidedBy).toBe(ownerUserId)

    // 3. Duplicate void rejection
    const dupVoidReq = new Request(`https://api.pos.local/api/v1/expenses/${created.id}/void`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
        'X-Business-Id': businessId,
      },
      body: JSON.stringify({
        reason: 'Attempting duplicate void',
      }),
    })
    const dupRes = await worker.fetch(dupVoidReq, env, executionCtx)
    expect(dupRes.status).toBe(400)
  })

  it('forbids an accountant from voiding an expense', async () => {
    // 1. Create expense as owner
    const createReq = new Request('https://api.pos.local/api/v1/expenses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
        'X-Business-Id': businessId,
      },
      body: JSON.stringify({
        branchId,
        categoryId,
        amountMinor: 300000,
        paymentMethod: 'cash',
        title: 'Office Water Supply',
      }),
    })
    const createRes = await worker.fetch(createReq, env, executionCtx)
    const createJson = (await createRes.json()) as any
    const created = createJson.data

    // 2. Attempt void as accountant
    const voidReq = new Request(`https://api.pos.local/api/v1/expenses/${created.id}/void`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accountantToken}`,
        'X-Business-Id': businessId,
      },
      body: JSON.stringify({
        reason: 'Accountant trying to void',
      }),
    })
    const voidRes = await worker.fetch(voidReq, env, executionCtx)
    expect(voidRes.status).toBe(403)
  })

  it('creates and lists expense categories with duplicate name rejection', async () => {
    // 1. Create new category
    const createReq = new Request('https://api.pos.local/api/v1/expense-categories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
        'X-Business-Id': businessId,
      },
      body: JSON.stringify({
        name: 'Advertising & Marketing',
        description: 'Facebook and Google ads campaigns',
      }),
    })
    const createRes = await worker.fetch(createReq, env, executionCtx)
    expect(createRes.status).toBe(201)

    // 2. Reject duplicate name
    const dupReq = new Request('https://api.pos.local/api/v1/expense-categories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
        'X-Business-Id': businessId,
      },
      body: JSON.stringify({
        name: 'Advertising & Marketing',
      }),
    })
    const dupRes = await worker.fetch(dupReq, env, executionCtx)
    expect(dupRes.status).toBe(400)

    // 3. List categories
    const listReq = new Request('https://api.pos.local/api/v1/expense-categories', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'X-Business-Id': businessId,
      },
    })
    const listRes = await worker.fetch(listReq, env, executionCtx)
    expect(listRes.status).toBe(200)
    const listJson = (await listRes.json()) as any
    expect(listJson.success).toBe(true)
    const categories = listJson.data as any[]
    expect(categories.length).toBe(2)
  })

  it('aggregates summary metrics accurately', async () => {
    // Create 2 posted expenses and 1 that gets voided
    await worker.fetch(new Request('https://api.pos.local/api/v1/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}`, 'X-Business-Id': businessId },
      body: JSON.stringify({ branchId, categoryId, amountMinor: 100000, paymentMethod: 'cash', title: 'Exp 1' }),
    }), env, executionCtx)

    await worker.fetch(new Request('https://api.pos.local/api/v1/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}`, 'X-Business-Id': businessId },
      body: JSON.stringify({ branchId, categoryId, amountMinor: 200000, paymentMethod: 'bank_transfer', title: 'Exp 2' }),
    }), env, executionCtx)

    const sumReq = new Request('https://api.pos.local/api/v1/expenses/summary', {
      method: 'GET',
      headers: { Authorization: `Bearer ${ownerToken}`, 'X-Business-Id': businessId },
    })
    const sumRes = await worker.fetch(sumReq, env, executionCtx)
    expect(sumRes.status).toBe(200)
    const sumJson = (await sumRes.json()) as any
    expect(sumJson.success).toBe(true)
    const summary = sumJson.data as any
    expect(summary.postedCount).toBe(2)
    expect(summary.postedAmountMinor).toBe(300000)
  })

  it('handles Idempotency-Key correctly with cache return and 409 conflict on differing payload', async () => {
    const idempotencyKey = 'idemp_exp_test_123'
    const payload1 = {
      branchId,
      categoryId,
      amountMinor: 150000,
      paymentMethod: 'cash',
      title: 'Idempotent Expense 1',
    }

    // First call: creates expense
    const res1 = await worker.fetch(new Request('https://api.pos.local/api/v1/expenses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
        'X-Business-Id': businessId,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload1),
    }), env, executionCtx)

    expect(res1.status).toBe(201)
    const json1 = (await res1.json()) as any
    const createdId = json1.data.id

    // Second call with same key & identical payload: returns cached response
    const res2 = await worker.fetch(new Request('https://api.pos.local/api/v1/expenses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
        'X-Business-Id': businessId,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload1),
    }), env, executionCtx)

    expect(res2.status).toBe(201)
    const json2 = (await res2.json()) as any
    expect(json2.data.id).toBe(createdId)

    // Verify count in database is still only 1
    const countRow = sqlite.prepare("SELECT COUNT(*) as c FROM expenses WHERE title = 'Idempotent Expense 1'").get() as any
    expect(countRow.c).toBe(1)

    // Third call with same key but differing payload: returns 409 Conflict
    const payloadDiff = {
      ...payload1,
      amountMinor: 999999,
    }
    const res3 = await worker.fetch(new Request('https://api.pos.local/api/v1/expenses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
        'X-Business-Id': businessId,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payloadDiff),
    }), env, executionCtx)

    expect(res3.status).toBe(409)
  })

  it('updates expense notes and title via PATCH /api/v1/expenses/:id', async () => {
    // Create an expense
    const createRes = await worker.fetch(new Request('https://api.pos.local/api/v1/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}`, 'X-Business-Id': businessId },
      body: JSON.stringify({ branchId, categoryId, amountMinor: 75000, paymentMethod: 'card', title: 'Office Snacks' }),
    }), env, executionCtx)

    const exp = ((await createRes.json()) as any).data

    // PATCH update
    const patchRes = await worker.fetch(new Request(`https://api.pos.local/api/v1/expenses/${exp.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}`, 'X-Business-Id': businessId },
      body: JSON.stringify({ title: 'Office Refreshments & Snacks', notes: 'Purchased for client meeting' }),
    }), env, executionCtx)

    expect(patchRes.status).toBe(200)
    const patchJson = (await patchRes.json()) as any
    expect(patchJson.data.title).toBe('Office Refreshments & Snacks')
    expect(patchJson.data.notes).toBe('Purchased for client meeting')
  })

  it('updates and archives expense categories via PATCH and DELETE', async () => {
    // 1. Create a category
    const catRes = await worker.fetch(new Request('https://api.pos.local/api/v1/expense-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}`, 'X-Business-Id': businessId },
      body: JSON.stringify({ name: 'Courier & Freight', description: 'Logistics expenses' }),
    }), env, executionCtx)

    const cat = ((await catRes.json()) as any).data

    // 2. PATCH category
    const patchRes = await worker.fetch(new Request(`https://api.pos.local/api/v1/expense-categories/${cat.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}`, 'X-Business-Id': businessId },
      body: JSON.stringify({ name: 'Logistics & Shipping', description: 'Updated courier description' }),
    }), env, executionCtx)

    expect(patchRes.status).toBe(200)
    const patchJson = (await patchRes.json()) as any
    expect(patchJson.data.name).toBe('Logistics & Shipping')

    // 3. Create an expense under this category
    await worker.fetch(new Request('https://api.pos.local/api/v1/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}`, 'X-Business-Id': businessId },
      body: JSON.stringify({ branchId, categoryId: cat.id, amountMinor: 25000, paymentMethod: 'cash', title: 'TCS parcel' }),
    }), env, executionCtx)

    // 4. DELETE category -> should soft-archive because it has associated expenses
    const delRes = await worker.fetch(new Request(`https://api.pos.local/api/v1/expense-categories/${cat.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}`, 'X-Business-Id': businessId },
    }), env, executionCtx)

    expect(delRes.status).toBe(200)
    const delJson = (await delRes.json()) as any
    expect(delJson.data.archived).toBe(true)
    expect(delJson.data.deleted).toBe(false)

    // Category should now be archived in database
    const catRow = sqlite.prepare('SELECT status FROM expense_categories WHERE id = ?').get(cat.id) as any
    expect(catRow.status).toBe('archived')
  })
})
