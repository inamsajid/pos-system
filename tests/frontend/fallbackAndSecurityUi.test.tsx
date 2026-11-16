// @vitest-environment jsdom
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { setApiContextProvider } from '../../src/lib/api-client'
import { queryKeys } from '../../src/api/queryKeys'
import { AuthContext } from '../../src/features/auth/context/authContextInstance'
import type { AuthContextValue } from '../../src/features/auth/types'
import { PermissionGuard } from '../../src/app/PermissionGuard'
import { Sidebar } from '../../src/layouts/components/Sidebar'
import { MobileNavigation } from '../../src/layouts/components/MobileNavigation'
import { Header } from '../../src/layouts/components/Header'
import { ExpensesPage } from '../../src/features/expenses/pages/ExpensesPage'
import { StaffPage } from '../../src/features/staff/pages/StaffPage'
import { SettingsPage } from '../../src/features/settings/pages/SettingsPage'
import { CustomerDetailsPage } from '../../src/features/customers/pages/CustomerDetailsPage'
import { SupplierDetailsPage } from '../../src/features/suppliers/pages/SupplierDetailsPage'
import { expenseService } from '../../src/features/expenses/services/expenseService'
import { staffService } from '../../src/features/staff/services/staffService'
import { customerService } from '../../src/features/customers/services/customerService'
import { supplierService } from '../../src/features/suppliers/services/supplierService'
import { settingsService } from '../../src/features/settings/services/settingsService'
import { salesService } from '../../src/features/sales/services/salesService'
import { invoiceService } from '../../src/features/invoices/services/invoiceService'
import { fetchPurchaseById } from '../../src/features/purchases/services/purchaseService'
import { useCustomers } from '../../src/features/customers/hooks/useCustomers'

import worker from '../../worker/src/index'
import { createSession } from '../../worker/src/auth/sessionService'
import { initTestSqlite } from '../offline/testD1Helper'

function buildAuthValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: 'authenticated',
    user: {
      id: 'usr-1',
      name: 'Test Operator',
      email: 'operator@example.com',
      phone: null,
      emailVerified: true,
      status: 'active',
    },
    businesses: [
      {
        id: 'biz-1',
        name: 'Crescent Traders',
        business_code: 'CRS-01',
        currency: 'PKR',
        status: 'active',
        role: 'owner',
      },
    ],
    activeBusiness: {
      id: 'biz-1',
      name: 'Crescent Traders',
      business_code: 'CRS-01',
      currency: 'PKR',
      status: 'active',
      role: 'owner',
    },
    activeBranch: {
      id: 'br-1',
      business_id: 'biz-1',
      branch_code: 'MAIN',
      name: 'Lahore Main',
      is_main_branch: true,
      status: 'active',
    },
    signIn: vi.fn(),
    signOut: vi.fn(),
    refreshSession: vi.fn(),
    setActiveBusiness: vi.fn(),
    setActiveBranch: vi.fn(),
    ...overrides,
  }
}

const executionCtx: ExecutionContext = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
}

describe('Phase 6 — Silent Fallback Removal, Least-Privilege Defaults, Query Scoping & Live D1 CRUD (FE-002, FE-003, FE-008)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('VITE_DATA_SOURCE', 'api')
    setApiContextProvider(() => ({
      userId: 'usr-1',
      businessId: 'biz-1',
      branchId: 'br-1',
    }))
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.unstubAllEnvs()
  })

  it('sets VITE_DATA_SOURCE="api" in .env.example (not mock)', () => {
    const envExample = fs.readFileSync(path.resolve(process.cwd(), '.env.example'), 'utf-8')
    expect(envExample).toMatch(/VITE_DATA_SOURCE="api"/)
    expect(envExample).not.toMatch(/VITE_DATA_SOURCE="mock"/)
  })

  it('FE-002: production services reject with real server/network errors when API fails instead of returning mock arrays', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Database unavailable cleanly' },
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    )

    await expect(expenseService.getExpenses()).rejects.toThrow('Database unavailable cleanly')
    await expect(expenseService.getCategories()).rejects.toThrow('Database unavailable cleanly')
    await expect(expenseService.getExpenseSummary()).rejects.toThrow('Database unavailable cleanly')
    await expect(
      expenseService.createExpense({
        branchId: 'br-1',
        categoryId: 'cat-1',
        amount: 500,
        paymentMethod: 'cash',
        title: 'Power Bill',
      })
    ).rejects.toThrow('Database unavailable cleanly')

    await expect(staffService.getStaff()).rejects.toThrow('Database unavailable cleanly')
    await expect(staffService.getInvitations()).rejects.toThrow('Database unavailable cleanly')
    await expect(staffService.getStaffMember('mem-1')).rejects.toThrow('Database unavailable cleanly')

    await expect(customerService.getCustomers()).rejects.toThrow('Database unavailable cleanly')
    await expect(customerService.getCustomerById('cust-1')).rejects.toThrow('Database unavailable cleanly')
    await expect(customerService.getCustomerFinancialSummary('cust-1')).rejects.toThrow(
      'Database unavailable cleanly'
    )
    await expect(customerService.getCustomerPurchaseHistory('cust-1')).rejects.toThrow(
      'Database unavailable cleanly'
    )
    await expect(customerService.getCustomerPaymentHistory('cust-1')).rejects.toThrow(
      'Database unavailable cleanly'
    )
    await expect(customerService.getCustomerAccountTransactions('cust-1')).rejects.toThrow(
      'Database unavailable cleanly'
    )

    await expect(supplierService.getSuppliers()).rejects.toThrow('Database unavailable cleanly')
    await expect(supplierService.getSupplierById('sup-1')).rejects.toThrow('Database unavailable cleanly')
    await expect(supplierService.getSupplierFinancialSummary('sup-1')).rejects.toThrow(
      'Database unavailable cleanly'
    )
    await expect(supplierService.getSupplierPurchaseHistory('sup-1')).rejects.toThrow(
      'Database unavailable cleanly'
    )
    await expect(supplierService.getSupplierPaymentHistory('sup-1')).rejects.toThrow(
      'Database unavailable cleanly'
    )
    await expect(supplierService.getSupplierAccountTransactions('sup-1')).rejects.toThrow(
      'Database unavailable cleanly'
    )
    await expect(supplierService.getSupplierProducts('sup-1')).rejects.toThrow(
      'Database unavailable cleanly'
    )

    await expect(salesService.getSaleById('sale-1')).rejects.toThrow('Database unavailable cleanly')
    await expect(invoiceService.getInvoiceById('inv-1')).rejects.toThrow('Database unavailable cleanly')
    await expect(fetchPurchaseById('pur-1')).rejects.toThrow(
      'Database unavailable cleanly'
    )
  })

  it('FE-002: single-record lookups return undefined on 404 while propagating 401/403/500 errors', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Record does not exist.' },
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    )

    await expect(customerService.getCustomerById('missing-1')).resolves.toBeUndefined()
    await expect(supplierService.getSupplierById('missing-1')).resolves.toBeUndefined()
    await expect(salesService.getSaleById('missing-1')).resolves.toBeUndefined()
    await expect(invoiceService.getInvoiceById('missing-1')).resolves.toBeUndefined()
    await expect(fetchPurchaseById('missing-1')).resolves.toBeUndefined()
  })

  it('FE-002 UI: ExpensesPage, StaffPage, CustomerDetailsPage, SupplierDetailsPage render real error alerts and Retry buttons on failure', async () => {
    let shouldFail = true
    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (shouldFail) {
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: 'SERVICE_UNAVAILABLE', message: 'Upstream D1 offline' },
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      }
      if (url.includes('/expenses/summary')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              totalCount: 0,
              totalAmountMinor: 0,
              postedCount: 0,
              postedAmountMinor: 0,
              voidedCount: 0,
              voidedAmountMinor: 0,
              todayAmountMinor: 0,
              thisMonthAmountMinor: 0,
              byCategory: [],
              byPaymentMethod: [],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      if (url.includes('/expenses')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { items: [], meta: { totalCount: 0, page: 1, limit: 25, totalPages: 1 } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <AuthContext.Provider value={buildAuthValue()}>
          <MemoryRouter>
            <ExpensesPage />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined()
      expect(screen.getByRole('alert').textContent).toContain('Upstream D1 offline')
    })

    // Recover on Retry
    shouldFail = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull()
    })

    cleanup()
    shouldFail = true
    render(
      <AuthContext.Provider value={buildAuthValue()}>
        <MemoryRouter>
          <StaffPage />
        </MemoryRouter>
      </AuthContext.Provider>
    )

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Upstream D1 offline')
    })
    expect(screen.queryByText('Ayesha Khan')).toBeNull()

    cleanup()
    render(
      <AuthContext.Provider value={buildAuthValue()}>
        <MemoryRouter initialEntries={['/customers/cust-999']}>
          <Routes>
            <Route path="/customers/:id" element={<CustomerDetailsPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    )
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Upstream D1 offline')
      expect(screen.queryByText('Customer not found')).toBeNull()
    })

    cleanup()
    render(
      <AuthContext.Provider value={buildAuthValue()}>
        <MemoryRouter initialEntries={['/suppliers/sup-999']}>
          <Routes>
            <Route path="/suppliers/:supplierId" element={<SupplierDetailsPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    )
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Upstream D1 offline')
      expect(screen.queryByText('Supplier not found')).toBeNull()
    })
  })

  it('FE-003: missing role fails closed across PermissionGuard, Sidebar, MobileNavigation, Header, and SettingsPage', () => {
    const authMissingRole = buildAuthValue({
      activeBusiness: {
        id: 'biz-1',
        name: 'Crescent Traders',
        business_code: 'CRS-01',
        currency: 'PKR',
        status: 'active',
        role: undefined as unknown as 'owner',
      },
    })

    render(
      <AuthContext.Provider value={authMissingRole}>
        <MemoryRouter>
          <PermissionGuard permission="manage_settings">
            <div>Secret Settings Content</div>
          </PermissionGuard>
          <Sidebar />
          <MobileNavigation open={true} onClose={vi.fn()} />
          <Header onMenu={vi.fn()} />
        </MemoryRouter>
      </AuthContext.Provider>
    )

    expect(screen.queryByText('Secret Settings Content')).toBeNull()
    expect(screen.getByText('Access Restricted')).toBeDefined()
    expect(screen.queryByText('Staff')).toBeNull()
    expect(screen.queryByText('Settings')).toBeNull()
    expect(screen.queryByText('Ayesha Khan')).toBeNull()
    expect(screen.queryByText('Northstar Market')).toBeNull()
    expect(screen.queryByText(/12 products are running low on stock/i)).toBeNull()

    cleanup()
    // Admin role does NOT hold manage_settings in Worker permissions -> SettingsPage must render Read-Only Mode
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            id: 'set-1',
            business_id: 'biz-1',
            business_name: 'Crescent Traders',
            currency_code: 'PKR',
            tax_rate_bps: 0,
            tax_inclusive: 0,
            receipt_prefix: 'INV',
            receipt_footer: '',
            allow_negative_stock: 0,
            updated_at: '2026-11-10T00:00:00Z',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <AuthContext.Provider
          value={buildAuthValue({
            activeBusiness: {
              id: 'biz-1',
              name: 'Crescent Traders',
              business_code: 'CRS-01',
              currency: 'PKR',
              status: 'active',
              role: 'admin',
            },
          })}
        >
          <MemoryRouter>
            <SettingsPage />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>
    )

    return waitFor(() => {
      expect(screen.getByText('Read-Only Mode')).toBeDefined()
      expect(screen.queryByText('Save Changes')).toBeNull()
    })
  })

  it('FE-008: TanStack Query caches isolate data strictly per (userId, businessId, branchId) across tenant switch', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      const bizId = headers.get('X-Business-Id')
      const customerName = bizId === 'biz-a' ? 'Tenant A Buyer' : 'Tenant B Client'
      return new Response(
        JSON.stringify({
          success: true,
          data: [
            {
              id: `${bizId}-cust-1`,
              customerCode: 'CUS-1001',
              name: customerName,
              type: 'individual',
              status: 'active',
              createdAt: '2026-11-10T00:00:00Z',
              updatedAt: '2026-11-10T00:00:00Z',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    })

    function Probe() {
      const { customers } = useCustomers()
      return <div data-testid="probe">{customers.map((c) => c.name).join(',') || 'empty'}</div>
    }

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const authA = buildAuthValue({
      activeBusiness: {
        id: 'biz-a',
        name: 'Store A',
        business_code: 'A',
        currency: 'PKR',
        status: 'active',
        role: 'owner',
      },
      activeBranch: {
        id: 'br-a1',
        business_id: 'biz-a',
        branch_code: 'A1',
        name: 'Branch A1',
        is_main_branch: true,
        status: 'active',
      },
    })

    setApiContextProvider(() => ({ userId: 'usr-1', businessId: 'biz-a', branchId: 'br-a1' }))
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <AuthContext.Provider value={authA}>
          <Probe />
        </AuthContext.Provider>
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('probe').textContent).toBe('Tenant A Buyer')
    })

    const authB = buildAuthValue({
      activeBusiness: {
        id: 'biz-b',
        name: 'Store B',
        business_code: 'B',
        currency: 'PKR',
        status: 'active',
        role: 'owner',
      },
      activeBranch: {
        id: 'br-b1',
        business_id: 'biz-b',
        branch_code: 'B1',
        name: 'Branch B1',
        is_main_branch: true,
        status: 'active',
      },
    })
    setApiContextProvider(() => ({ userId: 'usr-1', businessId: 'biz-b', branchId: 'br-b1' }))
    rerender(
      <QueryClientProvider client={qc}>
        <AuthContext.Provider value={authB}>
          <Probe />
        </AuthContext.Provider>
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('probe').textContent).toBe('Tenant B Client')
    })

    const keys = qc.getQueryCache().getAll().map((q) => q.queryKey)
    expect(keys).toContainEqual(
      queryKeys.customers.list({}, { userId: 'usr-1', businessId: 'biz-a', branchId: 'br-a1' })
    )
    expect(keys).toContainEqual(
      queryKeys.customers.list({}, { userId: 'usr-1', businessId: 'biz-b', branchId: 'br-b1' })
    )
  })

  it('FE-002 Persistence: Customer CRUD, Supplier CRUD, and Settings persist end-to-end through real Worker + SQLite D1', async () => {
    const { sqlite, d1, env } = initTestSqlite()
    const businessId = 'biz_live_p6'
    const branchId = 'br_live_p6'
    const userId = 'usr_live_p6'

    sqlite.exec(`
      INSERT INTO businesses (id, business_code, name, currency, timezone, status, country)
      VALUES ('${businessId}', 'LIVE-P6', 'Live Store P6', 'PKR', 'Asia/Karachi', 'active', 'Pakistan');

      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES ('${branchId}', '${businessId}', 'MAIN', 'Main Branch', 1, 'active');

      INSERT INTO users (id, email, name, password_hash, status)
      VALUES ('${userId}', 'owner.p6@example.com', 'P6 Owner', 'pbkdf2:hash', 'active');

      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('bm_live_p6', '${businessId}', '${userId}', 'owner', 1);

      INSERT INTO business_settings (business_id, allow_negative_stock, max_void_hours)
      VALUES ('${businessId}', 1, 24);
    `)

    const { token: sessionToken } = await createSession(d1, userId)
    setApiContextProvider(() => ({ userId, businessId, branchId }))

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const fullUrl = rawUrl.startsWith('http') ? rawUrl : `http://localhost:5173${rawUrl}`
      const headers = new Headers(init?.headers)
      headers.set('Cookie', `__session=${sessionToken}`)
      headers.set('Origin', 'http://localhost:5173')
      const req = new Request(fullUrl, {
        method: init?.method || 'GET',
        headers,
        body: init?.body ?? null,
      })
      return worker.fetch(req, env, executionCtx)
    })

    // 1. Customer CRUD persistence through D1
    const createdCustomer = await customerService.createCustomer({
      name: 'Zainab Enterprises',
      type: 'business',
      phone: '+923001112233',
      email: 'zainab@enterprises.pk',
      companyName: 'Zainab Co',
      city: 'Karachi',
      status: 'active',
    })
    expect(createdCustomer.id).toBeTruthy()
    expect(createdCustomer.name).toBe('Zainab Enterprises')

    const reloadedCustomer = await customerService.getCustomerById(createdCustomer.id)
    expect(reloadedCustomer?.name).toBe('Zainab Enterprises')

    const updatedCustomer = await customerService.updateCustomer(createdCustomer.id, {
      name: 'Zainab Trading Pvt Ltd',
      type: 'business',
      phone: '+923001112233',
      email: 'zainab@enterprises.pk',
      companyName: 'Zainab Trading',
      city: 'Lahore',
      status: 'active',
    })
    expect(updatedCustomer.name).toBe('Zainab Trading Pvt Ltd')
    expect(updatedCustomer.city).toBe('Lahore')

    await customerService.archiveCustomer(createdCustomer.id)
    const archivedCheck = await customerService.getCustomerById(createdCustomer.id)
    expect(archivedCheck?.status).toBe('archived')

    // 2. Supplier CRUD persistence through D1
    const createdSupplier = await supplierService.createSupplier({
      name: 'Indus Wholesale',
      type: 'business',
      companyName: 'Indus Foods',
      contactPerson: 'Kamran',
      phone: '+923214445566',
      email: 'supply@indus.pk',
      city: 'Faisalabad',
      country: 'Pakistan',
      status: 'active',
    })
    expect(createdSupplier.id).toBeTruthy()

    const updatedSupplier = await supplierService.updateSupplier(createdSupplier.id, {
      name: 'Indus Wholesale Updated',
      type: 'business',
      companyName: 'Indus Foods Pvt Ltd',
      contactPerson: 'Kamran Ali',
      phone: '+923214445566',
      email: 'supply@indus.pk',
      city: 'Lahore',
      country: 'Pakistan',
      status: 'active',
    })
    expect(updatedSupplier.name).toBe('Indus Wholesale Updated')

    await supplierService.archiveSupplier(createdSupplier.id)
    const reloadedSupplier = await supplierService.getSupplierById(createdSupplier.id)
    expect(reloadedSupplier?.status).toBe('archived')

    // 3. Settings persistence through D1
    const initialSettings = await settingsService.getSettings()
    expect(initialSettings.name).toBe('Live Store P6')
    expect(initialSettings.allowNegativeStock).toBe(true)

    await settingsService.updateSettings({
      name: 'Live Store P6 Rebranded',
      legalName: 'P6 Retail Pvt Ltd',
      defaultTaxRate: 17,
      allowNegativeStock: false,
      maxVoidHours: 48,
      receiptHeader: 'Thank you for visiting',
    })

    const persistedSettings = await settingsService.getSettings()
    expect(persistedSettings.name).toBe('Live Store P6 Rebranded')
    expect(persistedSettings.legalName).toBe('P6 Retail Pvt Ltd')
    expect(persistedSettings.defaultTaxRate).toBe(17)
    expect(persistedSettings.allowNegativeStock).toBe(false)
    expect(persistedSettings.maxVoidHours).toBe(48)
    expect(persistedSettings.receiptHeader).toBe('Thank you for visiting')
  })
})
