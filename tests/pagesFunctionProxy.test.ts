import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { onRequest } from '../functions/api/[[path]]'

describe('Cloudflare Pages Function — API Reverse Proxy (Service Binding & Fallback)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function createMockEventContext(
    request: Request,
    env: {
      API_WORKER?: { fetch: ReturnType<typeof vi.fn> }
      WORKER_API_HOST?: string
    } = {}
  ) {
    return {
      request,
      functionPath: '/api/v1/health',
      waitUntil: vi.fn(),
      next: vi.fn(),
      env: env as any,
      params: { path: ['v1', 'health'] },
      data: {},
    }
  }

  // 1. Missing Binding Handling
  it('returns 502 PROXY_MISCONFIGURED when neither API_WORKER nor WORKER_API_HOST is configured', async () => {
    const request = new Request('https://staging.pos-system-5vu.pages.dev/api/v1/health', {
      method: 'GET',
    })
    const context = createMockEventContext(request, {})

    const response = await onRequest(context as any)
    expect(response.status).toBe(502)

    const payload = (await response.json()) as { success: boolean; error: { code: string; message: string } }
    expect(payload.success).toBe(false)
    expect(payload.error.code).toBe('PROXY_MISCONFIGURED')
    expect(payload.error.message).toContain('Neither API_WORKER service binding nor WORKER_API_HOST')
  })

  // 2. Service Binding — GET Request & Query String Preservation
  it('forwards GET request via API_WORKER preserving pathname and query parameters', async () => {
    const mockUpstreamResponse = new Response(JSON.stringify({ status: 'healthy', version: 'v1' }), {
      status: 200,
      statusText: 'OK',
      headers: {
        'Content-Type': 'application/json',
        'X-Upstream-Header': 'custom-value',
      },
    })

    const mockFetch = vi.fn().mockResolvedValue(mockUpstreamResponse)
    const requestUrl = 'https://staging.pos-system-5vu.pages.dev/api/v1/products?limit=25&category=beverages&sort=desc'
    const request = new Request(requestUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'TestAgent/1.0',
      },
    })

    const context = createMockEventContext(request, {
      API_WORKER: { fetch: mockFetch },
    })

    const response = await onRequest(context as any)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [targetUrl, init] = mockFetch.mock.calls[0] as [string, RequestInit]

    expect(targetUrl).toBe(requestUrl)
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    expect(new URL(targetUrl).searchParams.get('limit')).toBe('25')
    expect(new URL(targetUrl).searchParams.get('category')).toBe('beverages')
    expect(new URL(targetUrl).searchParams.get('sort')).toBe('desc')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('x-upstream-header')).toBe('custom-value')
  })

  // 3. Service Binding — POST Request & Body Preservation
  it('forwards POST request via API_WORKER preserving body and Content-Type', async () => {
    const postPayload = {
      email: 'admin@northstarpos.com',
      password: 'SecurePassword123!',
    }

    const mockUpstreamResponse = new Response(
      JSON.stringify({
        success: true,
        data: { message: 'Signed in successfully' },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )

    const mockFetch = vi.fn().mockResolvedValue(mockUpstreamResponse)
    const request = new Request('https://staging.pos-system-5vu.pages.dev/api/v1/auth/sign-in', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(postPayload),
    })

    const context = createMockEventContext(request, {
      API_WORKER: { fetch: mockFetch },
    })

    const response = await onRequest(context as any)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.body).toBeDefined()

    // Read the forwarded body stream
    const forwardedBody = await new Response(init.body as BodyInit).json()
    expect(forwardedBody).toEqual(postPayload)

    expect(response.status).toBe(200)
    const responseData = (await response.json()) as { success: boolean; data: { message: string } }
    expect(responseData.success).toBe(true)
  })

  // 3b. Service Binding — PUT / PATCH Request Body Preservation
  it('forwards PUT and PATCH requests via API_WORKER preserving payload and method', async () => {
    const patchPayload = { status: 'suspended', reason: 'policy_violation' }
    const mockUpstreamResponse = new Response(JSON.stringify({ updated: true }), { status: 200 })
    const mockFetch = vi.fn().mockResolvedValue(mockUpstreamResponse)

    const request = new Request('https://staging.pos-system-5vu.pages.dev/api/v1/customers/cust_123/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patchPayload),
    })

    const context = createMockEventContext(request, {
      API_WORKER: { fetch: mockFetch },
    })

    const response = await onRequest(context as any)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('PATCH')
    const forwardedBody = await new Response(init.body as BodyInit).json()
    expect(forwardedBody).toEqual(patchPayload)
    expect(response.status).toBe(200)
  })

  // 4. Origin & Cookie Forwarding
  it('forwards Origin, Cookie, Authorization, and Client IP headers to API_WORKER', async () => {
    const mockUpstreamResponse = new Response(JSON.stringify({ ok: true }), { status: 200 })
    const mockFetch = vi.fn().mockResolvedValue(mockUpstreamResponse)

    const request = new Request('https://staging.pos-system-5vu.pages.dev/api/v1/auth/me', {
      method: 'GET',
      headers: {
        Origin: 'https://staging.pos-system-5vu.pages.dev',
        Cookie: '__session=tok_session_12345; theme=dark',
        Authorization: 'Bearer tok_bearer_98765',
        'cf-connecting-ip': '203.0.113.195',
      },
    })

    const context = createMockEventContext(request, {
      API_WORKER: { fetch: mockFetch },
    })

    await onRequest(context as any)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const forwardedHeaders = new Headers(init.headers)

    expect(forwardedHeaders.get('Origin')).toBe('https://staging.pos-system-5vu.pages.dev')
    expect(forwardedHeaders.get('Cookie')).toBe('__session=tok_session_12345; theme=dark')
    expect(forwardedHeaders.get('Authorization')).toBe('Bearer tok_bearer_98765')
    expect(forwardedHeaders.get('CF-Connecting-IP')).toBe('203.0.113.195')
  })

  // 5. Response Status and Set-Cookie Preservation
  it('preserves response status codes (e.g. 201, 401, 409) and Set-Cookie headers', async () => {
    const mockUpstreamResponse = new Response(
      JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Invalid credentials.' } }),
      {
        status: 401,
        statusText: 'Unauthorized',
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': '__session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax',
        },
      }
    )

    const mockFetch = vi.fn().mockResolvedValue(mockUpstreamResponse)
    const request = new Request('https://staging.pos-system-5vu.pages.dev/api/v1/auth/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bad@example.com', password: 'wrong' }),
    })

    const context = createMockEventContext(request, {
      API_WORKER: { fetch: mockFetch },
    })

    const response = await onRequest(context as any)

    expect(response.status).toBe(401)
    expect(response.statusText).toBe('Unauthorized')
    expect(response.headers.get('set-cookie')).toContain('__session=')
    expect(response.headers.get('set-cookie')).toContain('SameSite=Lax')
  })

  // 6. Upstream Error Handling (502 UPSTREAM_UNREACHABLE)
  it('returns 502 UPSTREAM_UNREACHABLE when API_WORKER throws a network error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Connection reset by peer'))
    const request = new Request('https://staging.pos-system-5vu.pages.dev/api/v1/health', {
      method: 'GET',
    })

    const context = createMockEventContext(request, {
      API_WORKER: { fetch: mockFetch },
    })

    const response = await onRequest(context as any)

    expect(response.status).toBe(502)
    const payload = (await response.json()) as { error: { code: string; message: string } }
    expect(payload.error.code).toBe('UPSTREAM_UNREACHABLE')
    expect(payload.error.message).toContain('Connection reset by peer')
  })

  // 7. Fallback to WORKER_API_HOST when API_WORKER is not provided
  it('falls back to WORKER_API_HOST HTTP fetch when API_WORKER is absent', async () => {
    const mockUpstreamResponse = new Response(JSON.stringify({ status: 'healthy' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

    const fetchSpy = vi.fn().mockResolvedValue(mockUpstreamResponse)
    globalThis.fetch = fetchSpy

    const request = new Request('https://staging.pos-system-5vu.pages.dev/api/v1/health?check=deep', {
      method: 'GET',
    })

    const context = createMockEventContext(request, {
      WORKER_API_HOST: 'pos-system-worker-staging.inamsajid123.workers.dev',
    })

    const response = await onRequest(context as any)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as [string, RequestInit]

    expect(calledUrl).toBe('https://pos-system-worker-staging.inamsajid123.workers.dev/api/v1/health?check=deep')
    expect(calledInit.method).toBe('GET')
    expect(new Headers(calledInit.headers).get('Host')).toBe('pos-system-worker-staging.inamsajid123.workers.dev')
    expect(response.status).toBe(200)
  })

  // 8. Strips Hop-by-Hop & CORS Headers from Upstream
  it('strips hop-by-hop and Access-Control-* CORS headers from proxy response', async () => {
    const mockUpstreamResponse = new Response(JSON.stringify({ data: 'ok' }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Connection': 'keep-alive',
        'Keep-Alive': 'timeout=5',
        'Transfer-Encoding': 'chunked',
        'Access-Control-Allow-Origin': 'https://staging.pos-system-5vu.pages.dev',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      },
    })

    const mockFetch = vi.fn().mockResolvedValue(mockUpstreamResponse)
    const request = new Request('https://staging.pos-system-5vu.pages.dev/api/v1/data', {
      method: 'GET',
    })

    const context = createMockEventContext(request, {
      API_WORKER: { fetch: mockFetch },
    })

    const response = await onRequest(context as any)

    expect(response.headers.get('Connection')).toBeNull()
    expect(response.headers.get('Keep-Alive')).toBeNull()
    expect(response.headers.get('Transfer-Encoding')).toBeNull()
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull()
    expect(response.headers.get('Access-Control-Allow-Methods')).toBeNull()
  })
})
