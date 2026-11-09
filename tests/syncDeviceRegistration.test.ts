import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import worker from '../worker/src/index'
import type { Env } from '../worker/src/types/environment'
import { generateId } from '../worker/src/auth/crypto'
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

describe('Device Registration & Management API (/api/v1/sync/devices)', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const ownerUserId = 'usr_owner_dev'
  const cashierUserId = 'usr_cashier_dev'
  const businessId = 'biz_dev_test'
  const branchId = 'branch_dev_test'
  let ownerToken: string
  let cashierToken: string

  beforeEach(async () => {
    sqlite = new DatabaseSync(':memory:')
    sqlite.exec('PRAGMA foreign_keys = ON;')

    const migrationsDir = path.resolve(process.cwd(), 'worker/migrations')
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
      const sanitized = sql
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
      for (const statement of sanitized.split(';')) {
        const trimmed = statement.trim()
        if (trimmed) {
          try {
            sqlite.exec(trimmed)
          } catch (err: unknown) {
            const e = err as Error
            if (!e.message.includes('duplicate column name')) {
              throw err
            }
          }
        }
      }
    }

    d1 = createRealD1(sqlite)
    env = {
      DB: d1,
      ENVIRONMENT: 'test',
      JWT_SECRET: 'test-jwt-secret-for-device-tests-32-chars-min',
      COOKIE_SECRET: 'test-cookie-secret-for-device-tests-32-chars-min',
      TOKEN_EXPIRATION_SECONDS: '3600',
      REFRESH_TOKEN_EXPIRATION_SECONDS: '86400',
    }

    // Seed Business & Branch
    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'BIZDEV', 'Device Test Biz', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Main Branch', 1, 'active')
    `).run(branchId, businessId)

    // Seed Owner
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'owner@devtest.pk', 'Owner Dev', 'dummy_hash', 'active')
    `).run(ownerUserId)

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_owner_dev', ?, ?, 'owner', 1)
    `).run(businessId, ownerUserId)

    // Seed Cashier
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'cashier@devtest.pk', 'Cashier Dev', 'dummy_hash', 'active')
    `).run(cashierUserId)

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_cashier_dev', ?, ?, 'cashier', 1)
    `).run(businessId, cashierUserId)

    const ownerSession = await createSession(d1, ownerUserId)
    ownerToken = ownerSession.token

    const cashierSession = await createSession(d1, cashierUserId)
    cashierToken = cashierSession.token
  })

  it('registers a new device and returns active DeviceDTO', async () => {
    const res = await worker.fetch(
      new Request('http://localhost/api/v1/sync/devices/register', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'X-Business-Id': businessId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          installationId: 'dev_inst_terminal_01',
          label: 'POS Counter 1 Terminal',
        }),
      }),
      env,
      executionCtx
    )

    expect(res.status).toBe(201)
    const body = (await res.json()) as { success: boolean; data: Record<string, unknown> }
    expect(body.success).toBe(true)
    expect(body.data.installationId).toBe('dev_inst_terminal_01')
    expect(body.data.label).toBe('POS Counter 1 Terminal')
    expect(body.data.status).toBe('active')
    expect(body.data.businessId).toBe(businessId)
    expect(body.data.userId).toBe(ownerUserId)
  })

  it('is idempotent when re-registering an existing device installation ID', async () => {
    // First registration
    const res1 = await worker.fetch(
      new Request('http://localhost/api/v1/sync/devices/register', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'X-Business-Id': businessId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          installationId: 'dev_inst_terminal_01',
          label: 'Terminal 1 Initial',
        }),
      }),
      env,
      executionCtx
    )
    const data1 = (await res1.json()) as { data: { id: string; label: string } }

    // Second registration with updated label
    const res2 = await worker.fetch(
      new Request('http://localhost/api/v1/sync/devices/register', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'X-Business-Id': businessId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          installationId: 'dev_inst_terminal_01',
          label: 'Terminal 1 Renamed',
        }),
      }),
      env,
      executionCtx
    )
    const data2 = (await res2.json()) as { data: { id: string; label: string } }

    expect(res2.status).toBe(201)
    expect(data2.data.id).toBe(data1.data.id)
    expect(data2.data.label).toBe('Terminal 1 Renamed')
  })

  it('updates last_seen_at upon heartbeat', async () => {
    await worker.fetch(
      new Request('http://localhost/api/v1/sync/devices/register', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          installationId: 'dev_inst_cashier_tab',
          label: 'Cashier Tablet',
        }),
      }),
      env,
      executionCtx
    )

    const hbRes = await worker.fetch(
      new Request('http://localhost/api/v1/sync/devices/heartbeat', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          installationId: 'dev_inst_cashier_tab',
        }),
      }),
      env,
      executionCtx
    )

    expect(hbRes.status).toBe(200)
    const hbBody = (await hbRes.json()) as { success: boolean; data: { success: boolean; status: string } }
    expect(hbBody.data.success).toBe(true)
    expect(hbBody.data.status).toBe('active')
  })

  it('enforces role scoping on device listing: owner sees all, cashier sees own', async () => {
    // Owner registers Device 1
    await worker.fetch(
      new Request('http://localhost/api/v1/sync/devices/register', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'X-Business-Id': businessId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          installationId: 'dev_owner_pc',
          label: 'Back Office PC',
        }),
      }),
      env,
      executionCtx
    )

    // Cashier registers Device 2
    await worker.fetch(
      new Request('http://localhost/api/v1/sync/devices/register', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          installationId: 'dev_cashier_tab',
          label: 'Front Counter Tab',
        }),
      }),
      env,
      executionCtx
    )

    // Owner listing
    const ownerListRes = await worker.fetch(
      new Request('http://localhost/api/v1/sync/devices', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'X-Business-Id': businessId,
        },
      }),
      env,
      executionCtx
    )
    const ownerList = (await ownerListRes.json()) as { data: Array<{ installationId: string }> }
    expect(ownerList.data.length).toBe(2)

    // Cashier listing
    const cashierListRes = await worker.fetch(
      new Request('http://localhost/api/v1/sync/devices', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
        },
      }),
      env,
      executionCtx
    )
    const cashierList = (await cashierListRes.json()) as { data: Array<{ installationId: string }> }
    expect(cashierList.data.length).toBe(1)
    expect(cashierList.data[0].installationId).toBe('dev_cashier_tab')
  })

  it('allows owner to revoke any device and blocks revoked device from pulling changes', async () => {
    // Register cashier device
    const regRes = await worker.fetch(
      new Request('http://localhost/api/v1/sync/devices/register', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          installationId: 'dev_compromised_tab',
          label: 'Lost Tablet',
        }),
      }),
      env,
      executionCtx
    )
    const regData = (await regRes.json()) as { data: { id: string } }
    const deviceDbId = regData.data.id

    // Owner revokes device
    const revokeRes = await worker.fetch(
      new Request(`http://localhost/api/v1/sync/devices/${deviceDbId}/revoke`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'X-Business-Id': businessId,
        },
      }),
      env,
      executionCtx
    )
    expect(revokeRes.status).toBe(200)
    const revokeData = (await revokeRes.json()) as { data: { status: string } }
    expect(revokeData.data.status).toBe('revoked')

    // Revoked device attempts to pull changes -> 403 Forbidden
    const pullRes = await worker.fetch(
      new Request('http://localhost/api/v1/sync/changes', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Device-Id': 'dev_compromised_tab',
        },
      }),
      env,
      executionCtx
    )
    expect(pullRes.status).toBe(403)
    const pullErr = (await pullRes.json()) as { error: { code: string; message: string } }
    expect(pullErr.error.code).toBe('FORBIDDEN')
    expect(pullErr.error.message).toContain('revoked')
  })
})
