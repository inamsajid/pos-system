// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  apiClient,
  getApiBaseUrl,
  resolveApiUrl,
  setApiContextProvider,
} from '../../src/lib/api-client'
import { customerService } from '../../src/features/customers/services/customerService'
import { supplierService } from '../../src/features/suppliers/services/supplierService'
import { settingsService } from '../../src/features/settings/services/settingsService'
import { downloadReportCsv } from '../../src/features/reports/services/reportService'
import { fileService } from '../../src/features/files/services/fileService'
import { ReconnectionService } from '../../src/lib/offline/reconnectionService'
import { commandRegistry } from '../../src/lib/offline/outbox/outbox.registry'
import type { OutboxCommandRecord } from '../../src/lib/offline/outbox/outbox.types'

describe('Phase 1 — API URL Normalization & Frontend Service Paths (FE-001, FE-010)', () => {
  let fetchedRequests: Array<{ url: string; init?: RequestInit }> = []

  beforeEach(() => {
    fetchedRequests = []
    vi.unstubAllEnvs()
    vi.stubEnv('VITE_DATA_SOURCE', 'api')
    setApiContextProvider(() => ({
      userId: 'usr-1',
      businessId: 'biz-1',
      branchId: 'br-1',
    }))

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      fetchedRequests.push({ url, init })

      if (url.includes('/reports/export')) {
        return new Response('col1,col2\na,b\n', {
          status: 200,
          headers: { 'Content-Type': 'text/csv; charset=utf-8' },
        })
      }

      if (url.includes('/customers/cust-1')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { id: 'cust-1', name: 'Ali', phone: '0300', status: 'active' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      if (url.includes('/suppliers/sup-1/products')) {
        return new Response(JSON.stringify({ success: true, data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/suppliers/sup-1')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { id: 'sup-1', name: 'Metro Wholesale', status: 'active' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      if (url.includes('/settings')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              id: 'set-1',
              business_id: 'biz-1',
              business_name: 'Northstar Store',
              currency_code: 'PKR',
              tax_rate_bps: 0,
              tax_inclusive: 0,
              receipt_prefix: 'INV',
              receipt_footer: null,
              allow_negative_stock: 0,
              updated_at: '2026-01-01T00:00:00Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      if (url.includes('/files')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              id: 'file-1',
              key: 'products/file-1.png',
              filename: 'item.png',
              contentType: 'image/png',
              sizeBytes: 128,
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        )
      }

      if (url.includes('/offline/sales/commit')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { saleId: 'sale-srv-1', invoiceNumber: 'INV-SRV-001', status: 'committed' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    setApiContextProvider(null)
  })

  it('normalizes base URL and resolves relative, origin-only, full-URL, and query-string targets safely', () => {
    expect(getApiBaseUrl('')).toBe('/api/v1')
    expect(getApiBaseUrl('/api/v1/')).toBe('/api/v1')
    expect(getApiBaseUrl('https://api.example.com')).toBe('https://api.example.com/api/v1')
    expect(getApiBaseUrl('https://api.example.com/')).toBe('https://api.example.com/api/v1')
    expect(getApiBaseUrl('https://api.example.com/api/v1/')).toBe('https://api.example.com/api/v1')
    expect(getApiBaseUrl('/custom/v2/')).toBe('/custom/v2')

    expect(resolveApiUrl('/customers', { page: 2 }, '/api/v1')).toBe('/api/v1/customers?page=2')
    expect(resolveApiUrl('/api/v1/customers', { page: 2 }, '/api/v1')).toBe('/api/v1/customers?page=2')
    expect(resolveApiUrl('/customers?active=true', { page: 2 }, 'https://api.example.com')).toBe(
      'https://api.example.com/api/v1/customers?active=true&page=2'
    )
    expect(resolveApiUrl('/api/v1/health', undefined, 'https://api.example.com/api/v1/')).toBe(
      'https://api.example.com/api/v1/health'
    )
    expect(resolveApiUrl('https://cdn.example.com/export?format=csv', { token: 'abc' })).toBe(
      'https://cdn.example.com/export?format=csv&token=abc'
    )
  })

  it('prevents duplicate /api/v1 prefixes across all customer, supplier, and settings endpoints', async () => {
    await customerService.getCustomers()
    await customerService.getCustomerById('cust-1')
    await customerService.createCustomer({ name: 'Walk-in', phone: '03001234567' })
    await customerService.updateCustomer('cust-1', { name: 'Updated' })
    await customerService.updateCustomerStatus('cust-1', 'inactive')
    await customerService.archiveCustomer('cust-1')

    await supplierService.getSuppliers()
    await supplierService.getSupplierById('sup-1')
    await supplierService.createSupplier({ name: 'Distributor' })
    await supplierService.updateSupplier('sup-1', { name: 'Distributor 2' })
    await supplierService.updateSupplierStatus('sup-1', 'inactive')
    await supplierService.archiveSupplier('sup-1')
    await supplierService.getSupplierProducts('sup-1')

    await settingsService.getSettings()
    await settingsService.updateSettings({ name: 'Northstar Updated' })

    const urls = fetchedRequests.map((r) => r.url)
    expect(urls).toContain('/api/v1/customers?limit=100')
    expect(urls).toContain('/api/v1/customers/cust-1')
    expect(urls).toContain('/api/v1/customers')
    expect(urls).toContain('/api/v1/customers/cust-1/status')
    expect(urls).toContain('/api/v1/suppliers?limit=100')
    expect(urls).toContain('/api/v1/suppliers/sup-1')
    expect(urls).toContain('/api/v1/suppliers')
    expect(urls).toContain('/api/v1/suppliers/sup-1/status')
    expect(urls).toContain('/api/v1/suppliers/sup-1/products')
    expect(urls).toContain('/api/v1/products?limit=100')
    expect(urls).toContain('/api/v1/categories')
    expect(urls).toContain('/api/v1/settings')
    expect(urls).toHaveLength(17)

    for (const url of urls) {
      expect(url).not.toContain('/api/v1/api/v1')
    }
  })

  it('honors configured VITE_API_BASE_URL origin cleanly across services and health probe', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://pos-api.northstar.test')

    await customerService.getCustomers()
    await settingsService.getSettings()
    const recon = new ReconnectionService()
    const online = await recon.probeConnectivity()

    expect(online).toBe(true)
    expect(fetchedRequests.map((r) => r.url)).toEqual([
      'https://pos-api.northstar.test/api/v1/customers?limit=100',
      'https://pos-api.northstar.test/api/v1/settings',
      'https://pos-api.northstar.test/api/v1/health',
    ])
  })

  it('calls registered Worker /reports/export route with reportType query param and auth headers (FE-010)', async () => {
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url')
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clickSpy = vi.fn()
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag.toLowerCase() === 'a') {
        return { href: '', download: '', click: clickSpy } as unknown as HTMLAnchorElement
      }
      return document.createElementNS('http://www.w3.org/1999/xhtml', tag)
    })

    await downloadReportCsv('sales', { fromDate: '2026-01-01', toDate: '2026-01-31' })

    expect(fetchedRequests).toHaveLength(1)
    expect(fetchedRequests[0].url).toBe('/api/v1/reports/export?reportType=sales&fromDate=2026-01-01&toDate=2026-01-31')
    const headers = new Headers(fetchedRequests[0].init?.headers)
    expect(headers.get('X-Business-Id')).toBe('biz-1')
    expect(headers.get('X-Branch-Id')).toBe('br-1')
    expect(fetchedRequests[0].init?.credentials).toBe('include')
    expect(clickSpy).toHaveBeenCalledTimes(1)

    createObjectUrlSpy.mockRestore()
    revokeObjectUrlSpy.mockRestore()
    createElementSpy.mockRestore()
  })

  it('resolves fileService upload and content URLs through canonical API base URL', async () => {
    const uploaded = await fileService.uploadFile(new File(['abc'], 'logo.png', { type: 'image/png' }), 'product')
    expect(fetchedRequests[0].url).toBe('/api/v1/files')
    expect(uploaded.url).toBe('/api/v1/files/file-1/content')
    expect(fileService.getFileContentUrl('file-1')).toBe('/api/v1/files/file-1/content')

    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com/api/v1')
    expect(fileService.getFileContentUrl('file-1')).toBe('https://api.example.com/api/v1/files/file-1/content')
  })

  it('routes OutboxRegistry create_offline_sale through apiClient with single prefix and credentials', async () => {
    const cmd: OutboxCommandRecord = {
      id: 'cmd-1',
      idempotencyKey: 'idem-1',
      commandType: 'create_offline_sale',
      commandVersion: 1,
      payloadHash: 'hash-1',
      businessId: 'biz-1',
      branchId: 'br-1',
      userId: 'usr-1',
      deviceId: 'dev-1',
      payload: {
        authorizationId: 'auth-1',
        deviceId: 'dev-1',
        provisionalId: 'off-1',
        provisionalReceiptNumber: 'OFF-001',
        provisionalCreatedAt: '2026-01-01T10:00:00Z',
        items: [{ productId: 'p1', quantity: 1, unitPriceMinor: 5000 }],
        paymentMethods: [{ method: 'cash', amountMinor: 5000 }],
        authorizationToken: 'tok',
      },
      status: 'pending',
      attemptCount: 0,
      nextAttemptAt: null,
      lastAttemptAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
      lastErrorCode: null,
      lastErrorAt: null,
      serverResultId: null,
      acknowledgedAt: null,
      expiresAt: null,
      createdAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-01-01T10:00:00Z',
    }

    const def = commandRegistry.getDefinition('create_offline_sale')
    expect(def?.handler).toBeDefined()
    const result = await def!.handler!(cmd)
    expect(result).toEqual({
      serverResultId: 'sale-srv-1',
      data: { saleId: 'sale-srv-1', invoiceNumber: 'INV-SRV-001', status: 'committed' },
    })
    expect(fetchedRequests).toHaveLength(1)
    expect(fetchedRequests[0].url).toBe('/api/v1/offline/sales/commit')
    const headers = new Headers(fetchedRequests[0].init?.headers)
    expect(headers.get('Idempotency-Key')).toBe('idem-1')
    expect(headers.get('X-Business-Id')).toBe('biz-1')
    expect(headers.get('X-Branch-Id')).toBe('br-1')
    expect(headers.get('X-Device-Id')).toBe('dev-1')
    expect(fetchedRequests[0].init?.credentials).toBe('include')

    // Verify clean apiClient usage as well
    await apiClient.get('/health')
    expect(fetchedRequests[1].url).toBe('/api/v1/health')
  })
})
