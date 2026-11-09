import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import worker from '../worker/src/index'
import type { Env } from '../worker/src/types/environment'
import { checkRateLimit } from '../worker/src/middleware/rateLimiter'
import type { RequestContext } from '../worker/src/router'
import { HttpError } from '../worker/src/lib/errors'

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

describe('API Rate Limiter & Edge Protection', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  beforeEach(() => {
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
      ENVIRONMENT: 'test',
      TIMEZONE: 'Asia/Karachi',
    } as unknown as Env
  })

  it('allows requests within the configured threshold and records buckets in D1', async () => {
    const fakeCtx: RequestContext = {
      req: new Request('http://localhost:8787/api/v1/auth/sign-in', {
        headers: { 'CF-Connecting-IP': '192.168.1.100' },
      }),
      url: new URL('http://localhost:8787/api/v1/auth/sign-in'),
      env,
      ctx: { waitUntil: vi.fn(), passThroughOnException: vi.fn() },
      requestId: 'req-rate-1',
      params: {},
    }

    // Call 3 times with limit = 3
    await expect(checkRateLimit(fakeCtx, { keyPrefix: 'test_limit', maxRequests: 3, windowSeconds: 60 })).resolves.not.toThrow()
    await expect(checkRateLimit(fakeCtx, { keyPrefix: 'test_limit', maxRequests: 3, windowSeconds: 60 })).resolves.not.toThrow()
    await expect(checkRateLimit(fakeCtx, { keyPrefix: 'test_limit', maxRequests: 3, windowSeconds: 60 })).resolves.not.toThrow()

    // 4th call should throw HttpError(429)
    await expect(checkRateLimit(fakeCtx, { keyPrefix: 'test_limit', maxRequests: 3, windowSeconds: 60 })).rejects.toThrow(HttpError)
  })

  it('throws 429 with Retry-After header and structured error response', async () => {
    const fakeCtx: RequestContext = {
      req: new Request('http://localhost:8787/api/v1/auth/sign-in', {
        headers: { 'CF-Connecting-IP': '10.0.0.5' },
      }),
      url: new URL('http://localhost:8787/api/v1/auth/sign-in'),
      env,
      ctx: { waitUntil: vi.fn(), passThroughOnException: vi.fn() },
      requestId: 'req-rate-2',
      params: {},
    }

    try {
      await checkRateLimit(fakeCtx, { keyPrefix: 'auth_test', maxRequests: 1, windowSeconds: 30 })
      await checkRateLimit(fakeCtx, { keyPrefix: 'auth_test', maxRequests: 1, windowSeconds: 30 })
      expect.fail('Should have thrown 429')
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(HttpError)
      const httpErr = err as HttpError
      expect(httpErr.status).toBe(429)
      expect(httpErr.code).toBe('RATE_LIMITED')
      expect(httpErr.details?.retryAfter).toBeGreaterThanOrEqual(1)
      expect(httpErr.details?.limit).toBe(1)
    }
  })

  it('isolates different client IPs so one client cannot DOS other users', async () => {
    const clientA: RequestContext = {
      req: new Request('http://localhost:8787/api/v1/auth/sign-in', {
        headers: { 'CF-Connecting-IP': '203.0.113.1' },
      }),
      url: new URL('http://localhost:8787/api/v1/auth/sign-in'),
      env,
      ctx: { waitUntil: vi.fn(), passThroughOnException: vi.fn() },
      requestId: 'req-rate-a',
      params: {},
    }

    const clientB: RequestContext = {
      req: new Request('http://localhost:8787/api/v1/auth/sign-in', {
        headers: { 'CF-Connecting-IP': '198.51.100.2' },
      }),
      url: new URL('http://localhost:8787/api/v1/auth/sign-in'),
      env,
      ctx: { waitUntil: vi.fn(), passThroughOnException: vi.fn() },
      requestId: 'req-rate-b',
      params: {},
    }

    // Client A uses up their limit
    await checkRateLimit(clientA, { keyPrefix: 'ip_iso', maxRequests: 1, windowSeconds: 60 })
    await expect(checkRateLimit(clientA, { keyPrefix: 'ip_iso', maxRequests: 1, windowSeconds: 60 })).rejects.toThrow()

    // Client B is unaffected and can proceed
    await expect(checkRateLimit(clientB, { keyPrefix: 'ip_iso', maxRequests: 1, windowSeconds: 60 })).resolves.not.toThrow()
  })
})

