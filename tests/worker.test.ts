import { describe, it, expect, vi } from 'vitest'
import worker from '../worker/src/index'
import type { Env } from '../worker/src/types/environment'

function createMockEnv(dbOverrides?: Partial<D1Database>): Env {
  const mockDb: D1Database = {
    prepare: vi.fn((query: string) => {
      return {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn(async () => {
          if (query.includes('SELECT 1')) {
            return { alive: 1 }
          }
          return null
        }),
        all: vi.fn(async () => ({ results: [], success: true, meta: {} })),
        run: vi.fn(async () => ({ success: true, meta: {} })),
        raw: vi.fn(async () => []),
      } as unknown as D1PreparedStatement
    }),
    batch: vi.fn(async () => []),
    exec: vi.fn(async () => ({ count: 0, duration: 0 })),
    dump: vi.fn(async () => new ArrayBuffer(0)),
    ...dbOverrides,
  } as unknown as D1Database

  const mockR2: R2Bucket = {} as unknown as R2Bucket

  return {
    DB: mockDb,
    FILES: mockR2,
    ENVIRONMENT: 'local',
    SERVICE_NAME: 'pos-system-api',
    API_VERSION: 'v1',
  }
}

const executionCtx: ExecutionContext = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
}

describe('Worker — Router & Health Endpoints', () => {
  it('GET /api/v1/health returns 200 with standard healthy payload', async () => {
    const env = createMockEnv()
    const request = new Request('http://localhost:8787/api/v1/health', {
      method: 'GET',
    })

    const response = await worker.fetch(request, env, executionCtx)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('x-request-id')).toBeTruthy()

    const body = (await response.json()) as { success: boolean; data: Record<string, unknown>; requestId: string }
    expect(body.success).toBe(true)
    expect(body.data).toEqual({
      status: 'healthy',
      service: 'pos-system-api',
      version: 'v1',
    })
    expect(body.requestId).toBe(response.headers.get('x-request-id'))
  })

  it('GET /api/v1/ready returns 200 when database connectivity succeeds', async () => {
    const env = createMockEnv()
    const request = new Request('http://localhost:8787/api/v1/ready', {
      method: 'GET',
    })

    const response = await worker.fetch(request, env, executionCtx)
    expect(response.status).toBe(200)

    const body = (await response.json()) as { success: boolean; data: Record<string, unknown> }
    expect(body.success).toBe(true)
    expect(body.data).toEqual({
      status: 'ready',
      database: 'connected',
    })
  })

  it('GET /api/v1/ready returns 503 when database connectivity fails', async () => {
    const failingDb = {
      prepare: vi.fn(() => ({
        first: vi.fn(async () => {
          throw new Error('Connection refused')
        }),
      })) as unknown as D1Database['prepare'],
    }

    const env = createMockEnv(failingDb)
    const request = new Request('http://localhost:8787/api/v1/ready', {
      method: 'GET',
    })

    const response = await worker.fetch(request, env, executionCtx)
    expect(response.status).toBe(503)

    const body = (await response.json()) as { success: boolean; error: { code: string; message: string } }
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('DATABASE_UNAVAILABLE')
    expect(body.error.message).toContain('Database connectivity check failed')
  })

  it('preserves existing X-Request-Id header when supplied', async () => {
    const env = createMockEnv()
    const customRequestId = 'test-request-id-12345'
    const request = new Request('http://localhost:8787/api/v1/health', {
      method: 'GET',
      headers: {
        'x-request-id': customRequestId,
      },
    })

    const response = await worker.fetch(request, env, executionCtx)
    expect(response.headers.get('x-request-id')).toBe(customRequestId)

    const body = (await response.json()) as { requestId: string }
    expect(body.requestId).toBe(customRequestId)
  })

  it('returns 404 structured JSON for unknown routes', async () => {
    const env = createMockEnv()
    const request = new Request('http://localhost:8787/api/v1/unknown-endpoint', {
      method: 'GET',
    })

    const response = await worker.fetch(request, env, executionCtx)
    expect(response.status).toBe(404)

    const body = (await response.json()) as { success: boolean; error: { code: string; message: string } }
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('NOT_FOUND')
    expect(body.error.message).toContain('not found')
  })

  it('returns 405 Method Not Allowed when method does not match route', async () => {
    const env = createMockEnv()
    const request = new Request('http://localhost:8787/api/v1/health', {
      method: 'POST',
    })

    const response = await worker.fetch(request, env, executionCtx)
    expect(response.status).toBe(405)

    const body = (await response.json()) as { success: boolean; error: { code: string } }
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('handles CORS OPTIONS preflight with 204 status for approved origins', async () => {
    const env = createMockEnv()
    const request = new Request('http://localhost:8787/api/v1/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
      },
    })

    const response = await worker.fetch(request, env, executionCtx)
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    expect(response.headers.get('access-control-allow-methods')).toContain('GET')
  })
})
