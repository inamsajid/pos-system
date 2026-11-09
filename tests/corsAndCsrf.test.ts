import { describe, it, expect, vi } from 'vitest'
import worker from '../worker/src/index'
import type { Env } from '../worker/src/types/environment'

function createMockEnv(): Env {
  const mockDb = {
    prepare: vi.fn(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn(async () => null),
      all: vi.fn(async () => ({ results: [], success: true, meta: {} })),
      run: vi.fn(async () => ({ success: true, meta: {} })),
    })),
    batch: vi.fn(async () => []),
    exec: vi.fn(async () => ({ count: 0, duration: 0 })),
  } as unknown as D1Database

  return {
    DB: mockDb,
    FILES: {} as unknown as R2Bucket,
    ENVIRONMENT: 'local',
    ALLOWED_ORIGINS: 'http://localhost:5173,http://localhost:4173',
  }
}

const executionCtx: ExecutionContext = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
}

describe('CORS & CSRF Security Policies', () => {
  const env = createMockEnv()

  describe('CORS Origin Allowlisting', () => {
    it('approves legitimate local development origin on preflight OPTIONS', async () => {
      const request = new Request('http://localhost:8787/api/v1/health', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
        },
      })

      const response = await worker.fetch(request, env, executionCtx)
      expect(response.status).toBe(204)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true')
      expect(response.headers.get('Vary')).toContain('Origin')
    })

    it('rejects unapproved origin on preflight with 403 and never reflects origin', async () => {
      const request = new Request('http://localhost:8787/api/v1/health', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://evil.com',
          'Access-Control-Request-Method': 'POST',
        },
      })

      const response = await worker.fetch(request, env, executionCtx)
      expect(response.status).toBe(403)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    })

    it('rejects origin with different port', async () => {
      const request = new Request('http://localhost:8787/api/v1/health', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:8080',
        },
      })

      const response = await worker.fetch(request, env, executionCtx)
      expect(response.status).toBe(403)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    })

    it('rejects origin with different protocol (https vs http)', async () => {
      const request = new Request('http://localhost:8787/api/v1/health', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://localhost:5173',
        },
      })

      const response = await worker.fetch(request, env, executionCtx)
      expect(response.status).toBe(403)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    })

    it('rejects origin with deceptive subdomain prefix or suffix', async () => {
      // Deceptive prefix: evil-localhost:5173
      const req1 = new Request('http://localhost:8787/api/v1/health', {
        method: 'OPTIONS',
        headers: { Origin: 'http://evil-localhost:5173' },
      })
      const res1 = await worker.fetch(req1, env, executionCtx)
      expect(res1.status).toBe(403)
      expect(res1.headers.get('Access-Control-Allow-Origin')).toBeNull()

      // Deceptive suffix: localhost.evil.com:5173
      const req2 = new Request('http://localhost:8787/api/v1/health', {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost.evil.com:5173' },
      })
      const res2 = await worker.fetch(req2, env, executionCtx)
      expect(res2.status).toBe(403)
      expect(res2.headers.get('Access-Control-Allow-Origin')).toBeNull()
    })

    it('handles requests with missing Origin header safely', async () => {
      const request = new Request('http://localhost:8787/api/v1/health', {
        method: 'GET',
      })

      const response = await worker.fetch(request, env, executionCtx)
      expect(response.status).toBe(200)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    })
  })

  describe('CSRF Defense on State Mutations', () => {
    it('rejects state mutations from unapproved origins with 403', async () => {
      const request = new Request('http://localhost:8787/api/v1/auth/sign-in', {
        method: 'POST',
        headers: {
          Origin: 'http://malicious-attacker.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'admin@northstar.pk', password: 'Password123#' }),
      })

      const response = await worker.fetch(request, env, executionCtx)
      expect(response.status).toBe(403)
      const body = (await response.json()) as { error: { message: string } }
      expect(body.error.message).toContain('Unapproved origin rejected')
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    })

    it('rejects unapproved Referer header on mutations without Origin', async () => {
      const request = new Request('http://localhost:8787/api/v1/auth/sign-in', {
        method: 'POST',
        headers: {
          Referer: 'http://phishing-site.com/login-form',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'admin@northstar.pk', password: 'Password123#' }),
      })

      const response = await worker.fetch(request, env, executionCtx)
      expect(response.status).toBe(403)
      const body = (await response.json()) as { error: { message: string } }
      expect(body.error.message).toContain('Unapproved referer origin rejected')
    })

    it('rejects blind cross-origin form POSTs carrying session cookies without origin verification', async () => {
      // Simulating a blind HTML <form method="POST"> attack that sends browser cookies without JSON or custom headers
      const request = new Request('http://localhost:8787/api/v1/auth/sign-out', {
        method: 'POST',
        headers: {
          Cookie: '__session=valid-stolen-token-1234567890',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'dummy=payload',
      })

      const response = await worker.fetch(request, env, executionCtx)
      expect(response.status).toBe(403)
      const body = (await response.json()) as { error: { message: string } }
      expect(body.error.message).toContain('CSRF policy')
    })

    it('allows state mutations from approved origins with proper credentials', async () => {
      const request = new Request('http://localhost:8787/api/v1/auth/sign-in', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'admin@northstar.pk', password: 'Password123#' }),
      })

      const response = await worker.fetch(request, env, executionCtx)
      // Endpoint executes (401 because user not in mock DB, but NOT blocked by 403 CORS/CSRF)
      expect(response.status).toBe(401)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true')
    })
  })
})

