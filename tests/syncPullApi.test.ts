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

describe('Sync Pull API & Cursor Pagination (/api/v1/sync/changes, /ack)', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const ownerUserId = 'usr_owner_pull'
  const cashierUserId = 'usr_cashier_pull'
  const businessId = 'biz_pull_test'
  const branchA = 'branch_pull_a'
  const branchB = 'branch_pull_b'
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
      JWT_SECRET: 'test-jwt-secret-pull-tests-32-chars-min',
      COOKIE_SECRET: 'test-cookie-secret-pull-tests-32-chars-min',
      TOKEN_EXPIRATION_SECONDS: '3600',
      REFRESH_TOKEN_EXPIRATION_SECONDS: '86400',
    }

    // Seed Business & Branches
    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'BIZPULL', 'Pull Test Store', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'BRA', 'Branch A', 1, 'active'), (?, ?, 'BRB', 'Branch B', 0, 'active')
    `).run(branchA, businessId, branchB, businessId)

    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES 
        (?, 'owner@pull.pk', 'Owner Pull', 'dummy_hash', 'active'),
        (?, 'cashier@pull.pk', 'Cashier Pull', 'dummy_hash', 'active')
    `).run(ownerUserId, cashierUserId)

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES 
        ('mem_owner_pull', ?, ?, 'owner', 1),
        ('mem_cashier_pull', ?, ?, 'cashier', 1)
    `).run(businessId, ownerUserId, businessId, cashierUserId)

    // Cashier is assigned only to Branch A
    sqlite.prepare(`
      INSERT INTO member_branches (id, member_id, branch_id)
      VALUES ('mb_cashier_bra', 'mem_cashier_pull', ?)
    `).run(branchA)

    const ownerSession = await createSession(d1, ownerUserId)
    ownerToken = ownerSession.token

    const cashierSession = await createSession(d1, cashierUserId)
    cashierToken = cashierSession.token

    // Register devices
    sqlite.prepare(`
      INSERT INTO devices (id, business_id, user_id, installation_id, label, status, registered_at, last_seen_at, created_at, updated_at)
      VALUES 
        ('dev_owner_reg', ?, ?, 'dev_owner_inst', 'Owner Device', 'active', datetime('now'), datetime('now'), datetime('now'), datetime('now')),
        ('dev_cashier_reg', ?, ?, 'dev_cashier_inst', 'Cashier Device', 'active', datetime('now'), datetime('now'), datetime('now'), datetime('now'))
    `).run(businessId, ownerUserId, businessId, cashierUserId)
  })

  it('paginates changes monotonically using sequence cursor', async () => {
    // Insert 4 change log records
    const now = new Date().toISOString()
    for (let i = 1; i <= 4; i++) {
      sqlite.prepare(`
        INSERT INTO sync_change_log (id, business_id, resource_type, resource_id, resource_version, operation, payload, event_id, created_at)
        VALUES (?, ?, 'product', 'prod_${i}', 1, 'upsert', '{"name":"Product ${i}"}', 'event_${i}', '${now}')
      `).run(i, businessId)
    }

    // Page 1: limit = 2, no cursor
    const res1 = await worker.fetch(
      new Request('http://localhost/api/v1/sync/changes?limit=2', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Device-Id': 'dev_owner_inst',
        },
      }),
      env,
      executionCtx
    )
    expect(res1.status).toBe(200)
    const page1 = (await res1.json()) as {
      data: {
        changes: Array<{ id: number; cursor: string }>
        hasMore: boolean
        nextCursor: string
      }
    }

    expect(page1.data.changes.length).toBe(2)
    expect(page1.data.changes[0].seq).toBe(1)
    expect(page1.data.changes[1].seq).toBe(2)
    expect(page1.data.hasMore).toBe(true)
    expect(page1.data.nextCursor).toBe('seq_2')

    // Page 2: cursor = seq_2, limit = 2
    const res2 = await worker.fetch(
      new Request('http://localhost/api/v1/sync/changes?cursor=seq_2&limit=2', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Device-Id': 'dev_owner_inst',
        },
      }),
      env,
      executionCtx
    )
    expect(res2.status).toBe(200)
    const page2 = (await res2.json()) as {
      data: {
        changes: Array<{ seq: number }>
        hasMore: boolean
        nextCursor: string
      }
    }

    expect(page2.data.changes.length).toBe(2)
    expect(page2.data.changes[0].seq).toBe(3)
    expect(page2.data.changes[1].seq).toBe(4)
    expect(page2.data.hasMore).toBe(false)
    expect(page2.data.nextCursor).toBe('seq_4')
  })

  it('rejects malformed cursor with 400 Bad Request', async () => {
    const res = await worker.fetch(
      new Request('http://localhost/api/v1/sync/changes?cursor=malformed_xyz', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Device-Id': 'dev_owner_inst',
        },
      }),
      env,
      executionCtx
    )
    expect(res.status).toBe(400)
  })

  it('enforces branch isolation: cashier cannot pull stock changes for unauthorized Branch B', async () => {
    const res = await worker.fetch(
      new Request(`http://localhost/api/v1/sync/changes?branchId=${branchB}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchB,
          'X-Device-Id': 'dev_cashier_inst',
        },
      }),
      env,
      executionCtx
    )
    expect(res.status).toBe(403)
  })

  it('acknowledges cursor consumption and updates device last_sync_at', async () => {
    const ackRes = await worker.fetch(
      new Request('http://localhost/api/v1/sync/ack', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'X-Business-Id': businessId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          installationId: 'dev_owner_inst',
          cursor: 'seq_4',
        }),
      }),
      env,
      executionCtx
    )
    expect(ackRes.status).toBe(200)

    const device = sqlite
      .prepare('SELECT last_sync_at FROM devices WHERE business_id = ? AND installation_id = ?')
      .get(businessId, 'dev_owner_inst') as { last_sync_at: string | null }
    expect(device.last_sync_at).not.toBeNull()
  })
})
