import { describe, it, expect } from 'vitest'
import {
  queryKeys,
  buildQueryString,
  createStandardHeaders,
  parseApiResponse,
  ApiClientError,
} from '../src/api'

describe('API Preparation — Query Key Factory', () => {
  it('generates predictable tenant-scoped query keys for products', () => {
    expect(queryKeys.products.all).toEqual(['products'])
    expect(queryKeys.products.lists()).toEqual(['products', 'anon', 'no-biz', 'all-branches', 'list'])
    expect(queryKeys.products.list({ categoryId: 'cat-1' })).toEqual([
      'products',
      'anon',
      'no-biz',
      'all-branches',
      'list',
      { categoryId: 'cat-1' },
    ])
    expect(queryKeys.products.detail('prod-123')).toEqual([
      'products',
      'anon',
      'no-biz',
      'all-branches',
      'detail',
      'prod-123',
    ])
  })

  it('generates predictable tenant-scoped query keys for customer ledgers and balances', () => {
    expect(queryKeys.customers.ledger('cust-456')).toEqual([
      'customers',
      'anon',
      'no-biz',
      'all-branches',
      'detail',
      'cust-456',
      'ledger',
      {},
    ])
    expect(queryKeys.customers.balances()).toEqual([
      'customers',
      'anon',
      'no-biz',
      'all-branches',
      'balances',
    ])
  })

  it('generates predictable tenant-scoped query keys for sales and inventory', () => {
    expect(queryKeys.sales.lists()).toEqual(['sales', 'anon', 'no-biz', 'all-branches', 'list'])
    expect(queryKeys.inventory.balances('branch-main')).toEqual([
      'inventory',
      'anon',
      'no-biz',
      'branch-main',
      'balances',
    ])
    expect(queryKeys.inventory.balances()).toEqual([
      'inventory',
      'anon',
      'no-biz',
      'all-branches',
      'balances',
    ])
    expect(
      queryKeys.products.lists({ userId: 'u1', businessId: 'biz-a', branchId: 'br-1' })
    ).not.toEqual(
      queryKeys.products.lists({ userId: 'u1', businessId: 'biz-b', branchId: 'br-1' })
    )
  })
})

describe('API Preparation — Client Transport & Header Helpers', () => {
  it('builds query strings accurately omitting undefined and empty params', () => {
    expect(buildQueryString()).toBe('')
    expect(buildQueryString({ search: 'rice', page: 2, limit: 50 })).toBe('?search=rice&page=2&limit=50')
    expect(buildQueryString({ search: '', category: undefined, active: true })).toBe('?active=true')
  })

  it('generates standard headers with tenant context and idempotency keys', () => {
    const config = {
      baseUrl: 'https://pos.northstarmarket.pk/api/v1',
      businessId: 'biz_default',
      branchId: 'branch_main',
      getAuthToken: () => 'sample_jwt_token',
    }

    const headers = createStandardHeaders(config, {
      idempotencyKey: 'd3b07384-d113-49d6-8488-842c676f4e1f',
    })

    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['Accept']).toBe('application/json')
    expect(headers['X-Business-Id']).toBe('biz_default')
    expect(headers['X-Branch-Id']).toBe('branch_main')
    expect(headers['Idempotency-Key']).toBe('d3b07384-d113-49d6-8488-842c676f4e1f')
    expect(headers['Authorization']).toBe('Bearer sample_jwt_token')
  })

  it('allows overriding businessId and branchId per request', () => {
    const config = { baseUrl: 'https://example.com', businessId: 'biz_1' }
    const headers = createStandardHeaders(config, { businessId: 'biz_override' })
    expect(headers['X-Business-Id']).toBe('biz_override')
  })
})

describe('API Preparation — Response Parser & Error Envelope', () => {
  it('unwraps successful API response envelopes', () => {
    const successPayload = {
      success: true,
      data: { id: 'sale-001', totalAmountMinor: 15000 },
      requestId: 'req-123',
    }

    const data = parseApiResponse<typeof successPayload.data>(successPayload, 200)
    expect(data.id).toBe('sale-001')
    expect(data.totalAmountMinor).toBe(15000)
  })

  it('throws ApiClientError when response contains error envelope', () => {
    const errorPayload = {
      success: false,
      error: {
        code: 'INSUFFICIENT_STOCK' as const,
        message: 'Product is out of stock.',
        details: { productId: 'prod-44' },
      },
      requestId: 'req-err-456',
    }

    expect(() => parseApiResponse(errorPayload, 422)).toThrow(ApiClientError)

    try {
      parseApiResponse(errorPayload, 422)
    } catch (err) {
      const apiErr = err as ApiClientError
      expect(apiErr.code).toBe('INSUFFICIENT_STOCK')
      expect(apiErr.message).toBe('Product is out of stock.')
      expect(apiErr.status).toBe(422)
      expect(apiErr.requestId).toBe('req-err-456')
      expect(apiErr.details).toEqual({ productId: 'prod-44' })
    }
  })

  it('handles malformed non-envelope JSON gracefully', () => {
    const malformed = { unexpected: 'data' }
    expect(() => parseApiResponse(malformed, 500)).toThrow(ApiClientError)
  })
})

