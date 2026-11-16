// @vitest-environment jsdom
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import worker from '../worker/src/index'
import type { Env } from '../worker/src/types/environment'
import { hashPassword, sha256Hex } from '../worker/src/auth/crypto'
import {
  clearSessionCookie,
  createSession,
  validateSession,
} from '../worker/src/auth/sessionService'
import { ForgotPasswordPage } from '../src/features/auth/pages/AuthPages'

function createRealD1(sqlite: DatabaseSync): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T = Record<string, unknown>>() {
              const row = sqlite.prepare(query).get(...args)
              return (row as T) || null
            },
            async all<T = Record<string, unknown>>() {
              const results = sqlite.prepare(query).all(...args) as T[]
              return { results, success: true, meta: {} }
            },
            async run() {
              const info = sqlite.prepare(query).run(...args)
              return { success: true, meta: { changes: info.changes } }
            },
            async raw() {
              return sqlite.prepare(query).all(...args) as unknown[]
            },
          } as unknown as D1PreparedStatement
        },
        async first<T = Record<string, unknown>>() {
          const row = sqlite.prepare(query).get()
          return (row as T) || null
        },
        async all<T = Record<string, unknown>>() {
          const results = sqlite.prepare(query).all() as T[]
          return { results, success: true, meta: {} }
        },
        async run() {
          const info = sqlite.prepare(query).run()
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
      } catch (err) {
        sqlite.exec('ROLLBACK;')
        throw err
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

function applyMigrationsThrough(sqlite: DatabaseSync, maxPrefix?: string) {
  const migrationsDir = path.resolve(process.cwd(), 'worker/migrations')
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => !maxPrefix || f <= maxPrefix)

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
    sqlite.exec(sql)
  }
}

describe('Phase 7 — Session Security, Suspension Revocation, Branch Validation, CORS & Password Reset', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:')
    sqlite.exec('PRAGMA foreign_keys = ON;')
    applyMigrationsThrough(sqlite)
    d1 = createRealD1(sqlite)
    env = {
      DB: d1,
      FILES: {} as unknown as R2Bucket,
      ENVIRONMENT: 'local',
      SERVICE_NAME: 'pos-system-api',
      API_VERSION: 'v1',
    }
  })

  it('SEC-002: stores only SHA-256 session digests in D1 and never plaintext tokens', async () => {
    sqlite
      .prepare(`INSERT INTO users (id, email, name, status) VALUES ('u_sec', 'sec@northstar.pk', 'Sec User', 'active')`)
      .run()

    const { token, session } = await createSession(d1, 'u_sec', '127.0.0.1', 'Vitest')
    const expectedHash = await sha256Hex(token)

    expect(session.token_hash).toBe(expectedHash)
    expect((session as unknown as Record<string, unknown>).token).toBeUndefined()

    const storedRow = sqlite
      .prepare(`SELECT id, token, token_hash FROM sessions WHERE id = ?`)
      .get(session.id) as { id: string; token: string; token_hash: string }

    expect(storedRow.token_hash).toBe(expectedHash)
    expect(storedRow.token).not.toBe(token)
    expect(storedRow.token).toBe(`sha256:${session.id}`)

    // Valid token authenticates; tampered token fails; HTTPS sign-out cookie includes Secure
    const validated = await validateSession(d1, token)
    expect(validated?.user.id).toBe('u_sec')
    expect(await validateSession(d1, `${token.slice(0, -1)}x`)).toBeNull()
    expect(clearSessionCookie(true)).toContain('Secure')
    expect(clearSessionCookie(false)).not.toContain('Secure')
  })

  it('SEC-002 migration 0018: invalidates legacy plaintext session rows without deleting rows', async () => {
    const preCutoverSqlite = new DatabaseSync(':memory:')
    preCutoverSqlite.exec('PRAGMA foreign_keys = ON;')
    applyMigrationsThrough(preCutoverSqlite, '0017_offline_auth_usage_tracking.sql')
    const preCutoverD1 = createRealD1(preCutoverSqlite)

    preCutoverSqlite
      .prepare(`INSERT INTO users (id, email, name, status) VALUES ('u_legacy', 'legacy@northstar.pk', 'Legacy', 'active')`)
      .run()
    preCutoverSqlite
      .prepare(
        `INSERT INTO sessions (id, user_id, token, expires_at)
         VALUES ('sess_legacy_1', 'u_legacy', 'raw-plaintext-bearer-token-abc', '2099-01-01T00:00:00.000Z')`
      )
      .run()

    const migration0018Sql = fs.readFileSync(
      path.resolve(process.cwd(), 'worker/migrations/0018_hash_session_tokens.sql'),
      'utf-8'
    )
    preCutoverSqlite.exec(migration0018Sql)

    const rowAfter = preCutoverSqlite
      .prepare(`SELECT id, token, token_hash, expires_at FROM sessions WHERE id = 'sess_legacy_1'`)
      .get() as { id: string; token: string; token_hash: string | null; expires_at: string }

    expect(rowAfter).toBeDefined()
    expect(rowAfter.token).not.toBe('raw-plaintext-bearer-token-abc')
    expect(rowAfter.token).toBe('LEGACY_INVALIDATED_sess_legacy_1')
    expect(rowAfter.token_hash).toBeNull()
    expect(rowAfter.expires_at).toBe('1970-01-01T00:00:00.000Z')

    // Legacy plaintext bearer fails validation immediately
    expect(await validateSession(preCutoverD1, 'raw-plaintext-bearer-token-abc')).toBeNull()
  })

  it('SEC-003: suspending a staff member immediately revokes pre-issued sessions while preserving audit history', async () => {
    const ownerPassHash = await hashPassword('OwnerPass#2026')
    const cashierPassHash = await hashPassword('CashierPass#2026')

    sqlite.exec(`
      INSERT INTO businesses (id, business_code, name, currency, status)
      VALUES ('biz_s3', 'BIZS3', 'Suspension Store', 'PKR', 'active');

      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES ('br_s3', 'biz_s3', 'MAIN', 'Main Branch', 1, 'active');

      INSERT INTO users (id, email, name, password_hash, status)
      VALUES ('u_owner_s3', 'owner@s3.pk', 'Owner S3', '${ownerPassHash}', 'active'),
             ('u_cashier_s3', 'cashier@s3.pk', 'Cashier S3', '${cashierPassHash}', 'active');

      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('bm_owner_s3', 'biz_s3', 'u_owner_s3', 'owner', 1),
             ('bm_cashier_s3', 'biz_s3', 'u_cashier_s3', 'cashier', 1);

      INSERT INTO member_branches (id, member_id, branch_id)
      VALUES ('mb_cashier_s3', 'bm_cashier_s3', 'br_s3');
    `)

    const ownerSession = await createSession(d1, 'u_owner_s3')
    const cashierSession = await createSession(d1, 'u_cashier_s3')
    const cashierCookie = `__session=${encodeURIComponent(cashierSession.token)}`

    // Pre-suspension request succeeds with cookie
    const preMeRes = await worker.fetch(
      new Request('http://localhost:8787/api/v1/auth/me', {
        method: 'GET',
        headers: { Cookie: cashierCookie },
      }),
      env,
      executionCtx
    )
    expect(preMeRes.status).toBe(200)

    // Owner suspends cashier
    const suspendRes = await worker.fetch(
      new Request('http://localhost:8787/api/v1/staff/bm_cashier_s3/suspend', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerSession.token}`,
          'X-Business-Id': 'biz_s3',
          Origin: 'http://localhost:5173',
        },
      }),
      env,
      executionCtx
    )
    expect(suspendRes.status).toBe(200)

    // Pre-issued cookie & bearer fail immediately with 401 on /auth/me AND tenant API
    const postMeRes = await worker.fetch(
      new Request('http://localhost:8787/api/v1/auth/me', {
        method: 'GET',
        headers: { Cookie: cashierCookie },
      }),
      env,
      executionCtx
    )
    expect(postMeRes.status).toBe(401)

    const postCustomersRes = await worker.fetch(
      new Request('http://localhost:8787/api/v1/customers', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${cashierSession.token}`,
          'X-Business-Id': 'biz_s3',
        },
      }),
      env,
      executionCtx
    )
    expect(postCustomersRes.status).toBe(401)

    // Membership row is marked inactive (not deleted) and audit log preserved
    const remainingSessions = sqlite
      .prepare(`SELECT COUNT(*) AS count FROM sessions WHERE user_id = 'u_cashier_s3'`)
      .get() as { count: number }
    expect(remainingSessions.count).toBe(0)

    const membership = sqlite
      .prepare(`SELECT is_active FROM business_members WHERE id = 'bm_cashier_s3'`)
      .get() as { is_active: number }
    expect(membership.is_active).toBe(0)

    const audit = sqlite
      .prepare(`SELECT action FROM audit_logs WHERE business_id = 'biz_s3' AND entity_id = 'bm_cashier_s3'`)
      .get() as { action: string }
    expect(audit.action).toBe('suspend_staff')
  })

  it('SEC-004: rejects cross-tenant branch assignment atomically without partial updates', async () => {
    sqlite.exec(`
      INSERT INTO businesses (id, business_code, name, currency, status)
      VALUES ('biz_a4', 'BIZA4', 'Business A4', 'PKR', 'active'),
             ('biz_b4', 'BIZB4', 'Business B4', 'PKR', 'active');

      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES ('br_a4_main', 'biz_a4', 'MAIN', 'A4 Main', 1, 'active'),
             ('br_a4_two', 'biz_a4', 'TWO', 'A4 Two', 0, 'active'),
             ('br_b4_foreign', 'biz_b4', 'FOR', 'Foreign B4 Branch', 1, 'active');

      INSERT INTO users (id, email, name, status)
      VALUES ('u_owner_a4', 'owner@a4.pk', 'Owner A4', 'active'),
             ('u_staff_a4', 'staff@a4.pk', 'Staff A4', 'active');

      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('bm_owner_a4', 'biz_a4', 'u_owner_a4', 'owner', 1),
             ('bm_staff_a4', 'biz_a4', 'u_staff_a4', 'cashier', 1);

      INSERT INTO member_branches (id, member_id, branch_id)
      VALUES ('mb_init_a4', 'bm_staff_a4', 'br_a4_main');
    `)

    const ownerSession = await createSession(d1, 'u_owner_a4')

    const mixedInvalidRes = await worker.fetch(
      new Request('http://localhost:8787/api/v1/staff/bm_staff_a4/branches', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerSession.token}`,
          'X-Business-Id': 'biz_a4',
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({
          branchIds: ['br_a4_two', 'br_b4_foreign'],
        }),
      }),
      env,
      executionCtx
    )
    expect(mixedInvalidRes.status).toBe(400)

    // Existing assignment must remain untouched (no partial overwrite)
    const afterInvalidRes = await worker.fetch(
      new Request('http://localhost:8787/api/v1/staff/bm_staff_a4/branches', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${ownerSession.token}`,
          'X-Business-Id': 'biz_a4',
        },
      }),
      env,
      executionCtx
    )
    expect(afterInvalidRes.status).toBe(200)
    const afterInvalidBody = (await afterInvalidRes.json()) as { data: Array<{ id: string }> }
    expect(afterInvalidBody.data.map((b) => b.id)).toEqual(['br_a4_main'])

    // Valid same-tenant update succeeds and persists
    const validRes = await worker.fetch(
      new Request('http://localhost:8787/api/v1/staff/bm_staff_a4/branches', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerSession.token}`,
          'X-Business-Id': 'biz_a4',
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({
          branchIds: ['br_a4_main', 'br_a4_two'],
        }),
      }),
      env,
      executionCtx
    )
    expect(validRes.status).toBe(200)

    const reloadedRes = await worker.fetch(
      new Request('http://localhost:8787/api/v1/staff/bm_staff_a4/branches', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${ownerSession.token}`,
          'X-Business-Id': 'biz_a4',
        },
      }),
      env,
      executionCtx
    )
    const reloadedBody = (await reloadedRes.json()) as { data: Array<{ id: string }> }
    expect(reloadedBody.data.map((b) => b.id).sort()).toEqual(['br_a4_main', 'br_a4_two'])
  })

  it('SEC-005: CORS preflight includes X-Device-Id in Access-Control-Allow-Headers', async () => {
    const withOriginRes = await worker.fetch(
      new Request('http://localhost:8787/api/v1/offline/sales/commit', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, X-Business-Id, X-Device-Id',
        },
      }),
      env,
      executionCtx
    )
    expect(withOriginRes.status).toBe(204)
    expect(withOriginRes.headers.get('Access-Control-Allow-Headers')).toContain('X-Device-Id')

    const noOriginRes = await worker.fetch(
      new Request('http://localhost:8787/api/v1/offline/sales/commit', {
        method: 'OPTIONS',
      }),
      env,
      executionCtx
    )
    expect(noOriginRes.status).toBe(204)
    expect(noOriginRes.headers.get('Access-Control-Allow-Headers')).toContain('X-Device-Id')
  })

  it('AUTH-001: ForgotPasswordPage presents honest unavailable state without fake email-sent success', () => {
    render(
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>
    )

    expect(screen.getByText(/Password reset unavailable/i)).toBeTruthy()
    expect(screen.getByText(/Self-service password reset is not active/i)).toBeTruthy()
    expect(screen.getByText(/contact your business owner or system administrator/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Send reset link/i })).toBeNull()
    expect(screen.queryByText(/recovery link has been prepared/i)).toBeNull()
  })
})
