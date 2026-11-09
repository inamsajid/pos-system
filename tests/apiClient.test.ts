import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiClient, apiRequest, ApiError } from '../src/lib/api-client'

describe('Frontend API Client — Transport, Helpers & Envelopes', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('unwraps { success: true, data } response envelope on GET', async () => {
    const mockData = { status: 'healthy', version: 'v1' }
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ success: true, data: mockData }),
    })

    const result = await apiClient.get<typeof mockData>('/health')
    expect(result).toEqual(mockData)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/health'),
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('serializes query parameters properly', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ success: true, data: [] }),
    })

    await apiClient.get('/products', { params: { search: 'rice', page: 1, empty: '' } })
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/products?search=rice&page=1'),
      expect.anything()
    )
  })

  it('sends JSON body on POST, PUT, and PATCH', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ success: true, data: { id: 'created' } }),
    })

    const payload = { name: 'Item' }
    await apiClient.post('/items', payload)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/items'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
      })
    )
  })

  it('throws ApiError with structured error details on failure response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      headers: new Headers({
        'content-type': 'application/json',
        'x-request-id': 'req-err-999',
      }),
      text: async () =>
        JSON.stringify({
          success: false,
          error: {
            code: 'INSUFFICIENT_STOCK',
            message: 'Out of stock.',
            details: { productId: 'p1' },
          },
        }),
    })

    await expect(apiClient.post('/sales', {})).rejects.toThrow(ApiError)

    try {
      await apiRequest('/sales', { method: 'POST' })
    } catch (err) {
      const apiErr = err as ApiError
      expect(apiErr.status).toBe(422)
      expect(apiErr.code).toBe('INSUFFICIENT_STOCK')
      expect(apiErr.message).toBe('Out of stock.')
      expect(apiErr.details).toEqual({ productId: 'p1' })
      expect(apiErr.requestId).toBe('req-err-999')
    }
  })
})

