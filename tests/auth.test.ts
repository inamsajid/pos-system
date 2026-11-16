import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import worker from '../worker/src/index'
import type { Env } from '../worker/src/types/environment'
import {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  generateId,
  needsRehash,
  sha256Hex,
} from '../worker/src/auth/crypto'
import {
  createSession,
  validateSession,
  revokeSession,
  SESSION_COOKIE_NAME,
} from '../worker/src/auth/sessionService'

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

describe('Authentication & Session Management', () => {
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

  describe('Crypto & Password Hashing', () => {
    it('hashes passwords with PBKDF2 salt and correctly verifies match', async () => {
      const password = 'CorrectHorseBatteryStaple#2026'
      const hash = await hashPassword(password)

      expect(hash).toMatch(/^pbkdf2:100000:[0-9a-f]{32}:[0-9a-f]{64}$/)
      expect(await verifyPassword(password, hash)).toBe(true)
      expect(await verifyPassword('WrongPassword123', hash)).toBe(false)
    })

    it('generates cryptographically distinct tokens and UUIDs', () => {
      const token1 = generateSessionToken()
      const token2 = generateSessionToken()
      const id1 = generateId()
      const id2 = generateId()

      expect(token1).toHaveLength(64)
      expect(token2).toHaveLength(64)
      expect(token1).not.toBe(token2)
      expect(id1).not.toBe(id2)
    })

    it('identifies hashes that require opportunistic rehashing', async () => {
      const lowWorkHash = await hashPassword('password123', 50_000)
      const currentWorkHash = await hashPassword('password123', 100_000)

      expect(needsRehash(lowWorkHash, 100_000)).toBe(true)
      expect(needsRehash(currentWorkHash, 100_000)).toBe(false)
      expect(needsRehash(currentWorkHash, 210_000)).toBe(true)
    })
  })

  describe('Database Sessions & Cookies', () => {
    it('creates active session and validates against D1', async () => {
      const userId = generateId()
      sqlite.prepare(`
        INSERT INTO users (id, email, name, status)
        VALUES (?, 'user@test.com', 'Test User', 'active')
      `).run(userId)

      const { token, cookie, session } = await createSession(d1, userId, '127.0.0.1', 'Vitest')
      expect(token).toBeTruthy()
      expect(cookie).toContain(SESSION_COOKIE_NAME)
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('SameSite=Lax')
      expect(cookie).toContain('Path=/')
      expect(cookie).toContain('Max-Age=604800')
      expect(session.user_id).toBe(userId)

      const validated = await validateSession(d1, token)
      expect(validated).not.toBeNull()
      expect(validated?.user.id).toBe(userId)
      expect(validated?.user.email).toBe('user@test.com')
    })

    it('sets Secure flag over HTTPS and omits it over HTTP', async () => {
      const userId = generateId()
      sqlite.prepare(`
        INSERT INTO users (id, email, name, status)
        VALUES (?, 'secure@test.com', 'Secure User', 'active')
      `).run(userId)

      const secureRes = await createSession(d1, userId, null, null, true)
      expect(secureRes.cookie).toContain('Secure')

      const insecureRes = await createSession(d1, userId, null, null, false)
      expect(insecureRes.cookie).not.toContain('Secure')
    })

    it('rejects expired sessions and automatically prunes them', async () => {
      const userId = generateId()
      sqlite.prepare(`
        INSERT INTO users (id, email, name, status)
        VALUES (?, 'user@test.com', 'Test User', 'active')
      `).run(userId)

      const expiredTime = new Date(Date.now() - 3600 * 1000).toISOString()
      const token = generateSessionToken()
      const tokenHash = await sha256Hex(token)
      sqlite.prepare(`
        INSERT INTO sessions (id, user_id, token, token_hash, expires_at)
        VALUES ('sess-exp', ?, 'sha256:sess-exp', ?, ?)
      `).run(userId, tokenHash, expiredTime)

      const validated = await validateSession(d1, token)
      expect(validated).toBeNull()

      const checkRow = sqlite.prepare('SELECT id FROM sessions WHERE id = ?').get('sess-exp')
      expect(checkRow).toBeUndefined()
    })

    it('revokes session on sign-out', async () => {
      const userId = generateId()
      sqlite.prepare(`
        INSERT INTO users (id, email, name, status)
        VALUES (?, 'user@test.com', 'Test User', 'active')
      `).run(userId)

      const { token } = await createSession(d1, userId)
      await revokeSession(d1, token)

      const validated = await validateSession(d1, token)
      expect(validated).toBeNull()
    })
  })

  describe('Endpoints — Bootstrap, Sign-in, Sign-out, Me', () => {
    it('POST /api/v1/auth/bootstrap initializes first owner and returns session cookie', async () => {
      const request = new Request('http://localhost:8787/api/v1/auth/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'owner@northstarmarket.pk',
          password: 'SuperSecretPassword#2026',
          name: 'Tariq Mehmood',
          businessName: 'Northstar Market',
        }),
      })

      const response = await worker.fetch(request, env, executionCtx)
      expect(response.status).toBe(201)

      const setCookie = response.headers.get('set-cookie') || ''
      expect(setCookie).toContain(SESSION_COOKIE_NAME)
      expect(setCookie).toContain('HttpOnly')
      expect(setCookie).toContain('SameSite=Lax')
      expect(setCookie).toContain('Path=/')

      const body = (await response.json()) as { success: boolean; data: Record<string, unknown> }
      expect(body.success).toBe(true)

      const user = body.data.user as Record<string, unknown>
      expect(user.email).toBe('owner@northstarmarket.pk')
      expect(user.name).toBe('Tariq Mehmood')
      expect(user.password_hash).toBeUndefined()
      expect(user.password).toBeUndefined()

      const session = body.data.session as Record<string, unknown>
      expect(session.id).toBeTruthy()
      expect(session.token).toBeUndefined()
    })

    it('POST /api/v1/auth/bootstrap validates input fields strictly', async () => {
      // Invalid email
      const badEmailRes = await worker.fetch(
        new Request('http://localhost:8787/api/v1/auth/bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'not-an-email',
            password: 'Password123#',
            name: 'Valid Name',
            businessName: 'Valid Store',
          }),
        }),
        env,
        executionCtx
      )
      expect(badEmailRes.status).toBe(400)
      const badEmailBody = (await badEmailRes.json()) as { error: { message: string } }
      expect(badEmailBody.error.message).toContain('email')

      // Short password (<8 chars)
      const badPassRes = await worker.fetch(
        new Request('http://localhost:8787/api/v1/auth/bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'valid@store.pk',
            password: 'short',
            name: 'Valid Name',
            businessName: 'Valid Store',
          }),
        }),
        env,
        executionCtx
      )
      expect(badPassRes.status).toBe(400)
      const badPassBody = (await badPassRes.json()) as { error: { message: string } }
      expect(badPassBody.error.message).toContain('8 characters')

      // Blank owner name
      const badNameRes = await worker.fetch(
        new Request('http://localhost:8787/api/v1/auth/bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'valid@store.pk',
            password: 'Password123#',
            name: '  ',
            businessName: 'Valid Store',
          }),
        }),
        env,
        executionCtx
      )
      expect(badNameRes.status).toBe(400)

      // Blank business name
      const badBizRes = await worker.fetch(
        new Request('http://localhost:8787/api/v1/auth/bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'valid@store.pk',
            password: 'Password123#',
            name: 'Valid Name',
            businessName: '  ',
          }),
        }),
        env,
        executionCtx
      )
      expect(badBizRes.status).toBe(400)
    })

    it('POST /api/v1/auth/bootstrap fails with 409 Conflict if system is already initialized', async () => {
      const req1 = new Request('http://localhost:8787/api/v1/auth/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'owner@northstarmarket.pk',
          password: 'SuperSecretPassword#2026',
          name: 'Tariq Mehmood',
          businessName: 'Northstar Market',
        }),
      })
      const res1 = await worker.fetch(req1, env, executionCtx)
      expect(res1.status).toBe(201)

      const req2 = new Request('http://localhost:8787/api/v1/auth/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'attacker@evil.com',
          password: 'Password123!',
          name: 'Attacker',
          businessName: 'Hacked Business',
        }),
      })
      const res2 = await worker.fetch(req2, env, executionCtx)
      expect(res2.status).toBe(409)

      const body = (await res2.json()) as { success: boolean; error: { code: string; message: string } }
      expect(body.success).toBe(false)
      expect(body.error.code).toBe('CONFLICT')
    })

    it('POST /api/v1/auth/sign-in authenticates valid user and sets session cookie', async () => {
      await worker.fetch(
        new Request('http://localhost:8787/api/v1/auth/bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'cashier@northstar.pk',
            password: 'CorrectPassword123',
            name: 'Ali Raza',
            businessName: 'Northstar Store',
          }),
        }),
        env,
        executionCtx
      )

      const signInReq = new Request('http://localhost:8787/api/v1/auth/sign-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'cashier@northstar.pk',
          password: 'CorrectPassword123',
        }),
      })
      const signInRes = await worker.fetch(signInReq, env, executionCtx)
      expect(signInRes.status).toBe(200)

      const cookieHeader = signInRes.headers.get('set-cookie') || ''
      expect(cookieHeader).toContain(SESSION_COOKIE_NAME)
      expect(cookieHeader).toContain('HttpOnly')
      expect(cookieHeader).toContain('SameSite=Lax')

      const body = (await signInRes.json()) as { data: { user: Record<string, unknown>; session: Record<string, unknown> } }
      expect(body.data.user.email).toBe('cashier@northstar.pk')
      expect(body.data.user.password_hash).toBeUndefined()
      expect(body.data.user.password).toBeUndefined()
      expect(body.data.session.token).toBeUndefined()

      // Sign in with invalid password fails with 401
      const badReq = new Request('http://localhost:8787/api/v1/auth/sign-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'cashier@northstar.pk',
          password: 'WrongPassword!',
        }),
      })
      const badRes = await worker.fetch(badReq, env, executionCtx)
      expect(badRes.status).toBe(401)
      const badBody = (await badRes.json()) as { error: { message: string } }
      expect(badBody.error.message).toContain('Invalid email or password')
    })

    it('POST /api/v1/auth/sign-in rejects unknown email without user enumeration', async () => {
      const badEmailReq = new Request('http://localhost:8787/api/v1/auth/sign-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'nonexistent-user-999@northstar.pk',
          password: 'AnyPassword123#',
        }),
      })
      const badEmailRes = await worker.fetch(badEmailReq, env, executionCtx)
      expect(badEmailRes.status).toBe(401)
      const body = (await badEmailRes.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('AUTHENTICATION_REQUIRED')
      expect(body.error.message).toBe('Invalid email or password.')
    })

    it('POST /api/v1/auth/sign-in rejects malformed and empty payloads', async () => {
      // Empty JSON object
      const emptyRes = await worker.fetch(
        new Request('http://localhost:8787/api/v1/auth/sign-in', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
        env,
        executionCtx
      )
      expect(emptyRes.status).toBe(400)

      // Missing password
      const noPassRes = await worker.fetch(
        new Request('http://localhost:8787/api/v1/auth/sign-in', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'user@test.pk' }),
        }),
        env,
        executionCtx
      )
      expect(noPassRes.status).toBe(400)

      // Missing email
      const noEmailRes = await worker.fetch(
        new Request('http://localhost:8787/api/v1/auth/sign-in', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: 'Password123#' }),
        }),
        env,
        executionCtx
      )
      expect(noEmailRes.status).toBe(400)

      // Malformed non-JSON
      const malformedRes = await worker.fetch(
        new Request('http://localhost:8787/api/v1/auth/sign-in', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{ invalid-json-payload',
        }),
        env,
        executionCtx
      )
      expect(malformedRes.status).toBe(400)
    })

    it('GET /api/v1/auth/me returns 401 when unauthenticated and 200 with profile when authenticated', async () => {
      const unauthReq = new Request('http://localhost:8787/api/v1/auth/me', {
        method: 'GET',
      })
      const unauthRes = await worker.fetch(unauthReq, env, executionCtx)
      expect(unauthRes.status).toBe(401)

      const bootRes = await worker.fetch(
        new Request('http://localhost:8787/api/v1/auth/bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'admin@northstar.pk',
            password: 'AdminPassword123',
            name: 'Admin User',
            businessName: 'Northstar Flagship',
          }),
        }),
        env,
        executionCtx
      )
      const cookieHeader = bootRes.headers.get('set-cookie')!.split(';')[0]

      const authReq = new Request('http://localhost:8787/api/v1/auth/me', {
        method: 'GET',
        headers: {
          Cookie: cookieHeader,
        },
      })
      const authRes = await worker.fetch(authReq, env, executionCtx)
      expect(authRes.status).toBe(200)

      const body = (await authRes.json()) as { success: boolean; data: { user: Record<string, unknown>; businesses: unknown[] } }
      expect(body.success).toBe(true)
      expect(body.data.user.email).toBe('admin@northstar.pk')
      expect(body.data.user.password_hash).toBeUndefined()
      expect(body.data.user.password).toBeUndefined()
      expect(body.data.businesses).toHaveLength(1)
    })

    it('supports Bearer token authorization as approved alternative', async () => {
      const userId = generateId()
      sqlite.prepare(`
        INSERT INTO users (id, email, name, status)
        VALUES (?, 'bearer@test.com', 'Bearer User', 'active')
      `).run(userId)

      const { token } = await createSession(d1, userId)

      // Valid bearer token
      const validBearerReq = new Request('http://localhost:8787/api/v1/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      })
      const validRes = await worker.fetch(validBearerReq, env, executionCtx)
      expect(validRes.status).toBe(200)
      const body = (await validRes.json()) as { data: { user: { email: string } } }
      expect(body.data.user.email).toBe('bearer@test.com')

      // Invalid bearer token
      const badBearerReq = new Request('http://localhost:8787/api/v1/auth/me', {
        method: 'GET',
        headers: { Authorization: 'Bearer bad-token-64chars00000000000000000000000000000000000000000000000000000' },
      })
      const badRes = await worker.fetch(badBearerReq, env, executionCtx)
      expect(badRes.status).toBe(401)
    })

    it('POST /api/v1/auth/sign-out clears session and deletes cookie', async () => {
      const bootRes = await worker.fetch(
        new Request('http://localhost:8787/api/v1/auth/bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'signout@northstar.pk',
            password: 'Password123',
            name: 'Sign Out Tester',
            businessName: 'Test Business',
          }),
        }),
        env,
        executionCtx
      )
      const cookieHeader = bootRes.headers.get('set-cookie')!.split(';')[0]

      const signOutReq = new Request('http://localhost:8787/api/v1/auth/sign-out', {
        method: 'POST',
        headers: {
          Cookie: cookieHeader,
          Origin: 'http://localhost:5173',
        },
      })
      const signOutRes = await worker.fetch(signOutReq, env, executionCtx)
      expect(signOutRes.status).toBe(200)
      expect(signOutRes.headers.get('set-cookie')).toContain('Max-Age=0')

      const meReq = new Request('http://localhost:8787/api/v1/auth/me', {
        method: 'GET',
        headers: { Cookie: cookieHeader },
      })
      const meRes = await worker.fetch(meReq, env, executionCtx)
      expect(meRes.status).toBe(401)
    })
  })
})
