// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LedgerPage } from '../../src/features/ledger/pages/LedgerPage'
import { AuthContext } from '../../src/features/auth/context/authContextInstance'
import { customerService } from '../../src/features/customers/services/customerService'
import * as customerLedgerService from '../../src/features/customers/services/customerLedgerService'
import { supplierService } from '../../src/features/suppliers/services/supplierService'
import * as supplierLedgerService from '../../src/features/suppliers/services/supplierLedgerService'
import type { AuthContextValue } from '../../src/features/auth/types'

function mockAuthContext(): AuthContextValue {
  return {
    status: 'authenticated',
    user: {
      id: 'usr-1',
      name: 'Accountant User',
      email: 'accountant@retail.example.pk',
      phone: null,
      emailVerified: true,
      status: 'active',
    },
    businesses: [
      {
        id: 'biz-1',
        name: 'Apex Superstore',
        business_code: 'APX-01',
        currency: 'PKR',
        status: 'active',
        role: 'accountant',
      },
    ],
    activeBusiness: {
      id: 'biz-1',
      name: 'Apex Superstore',
      business_code: 'APX-01',
      currency: 'PKR',
      status: 'active',
      role: 'accountant',
    },
    activeBranch: {
      id: 'br-1',
      business_id: 'biz-1',
      branch_code: 'MAIN',
      name: 'Main Branch',
      is_main_branch: true,
      status: 'active',
    },
    signIn: vi.fn(),
    signOut: vi.fn(),
    refreshSession: vi.fn(),
    setActiveBusiness: vi.fn(),
    setActiveBranch: vi.fn(),
  }
}

describe('Step 14.4 — Cross-Module Ledger Integration Tests', () => {
  beforeEach(() => {
    cleanup()
    vi.restoreAllMocks()

    vi.spyOn(customerService, 'getCustomers').mockResolvedValue([
      {
        id: 'cust-1',
        name: 'Tariq Mehmood',
        customerCode: 'CUST-001',
        phone: '03001234567',
        status: 'active',
        type: 'retail',
        businessId: 'biz-1',
        branchId: 'br-1',
        createdAt: '2026-01-01T00:00:00Z',
      } as any,
    ])

    vi.spyOn(customerLedgerService, 'fetchCustomerLedgerSummary').mockResolvedValue({
      customerId: 'cust-1',
      totalPurchases: 50000,
      totalPaid: 30000,
      outstandingBalance: 20000,
      advanceBalance: 0,
      openingBalance: 0,
      currentAccountBalance: 20000,
    })

    vi.spyOn(supplierService, 'getSuppliers').mockResolvedValue([
      {
        id: 'sup-1',
        name: 'National Distributing Co.',
        supplierCode: 'SUP-001',
        contactPerson: 'Zubair',
        phone: '03217654321',
        status: 'active',
        businessId: 'biz-1',
        createdAt: '2026-01-01T00:00:00Z',
      } as any,
    ])

    vi.spyOn(supplierLedgerService, 'fetchSupplierLedgerSummary').mockResolvedValue({
      supplierId: 'sup-1',
      totalPurchases: 80000,
      totalPaid: 50000,
      outstandingPayable: 30000,
      advanceBalance: 0,
      openingPayable: 0,
      currentAccountBalance: 30000,
    })
  })

  it('renders Ledger Hub with customer receivables and switches tabs to supplier payables', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={mockAuthContext()}>
          <MemoryRouter initialEntries={['/ledger']}>
            <LedgerPage />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>
    )

    // Wait for customer data to resolve
    await waitFor(() => {
      expect(screen.getByText('Tariq Mehmood')).toBeDefined()
    })

    expect(screen.getAllByText('Financial Ledgers & Statements').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Customer Receivables/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Supplier Payables/).length).toBeGreaterThanOrEqual(1)

    // View Ledger button exists for customer linking to ledger
    const viewLinks = screen.getAllByRole('link')
    const customerLedgerLink = viewLinks.find((l) =>
      l.getAttribute('href')?.includes('/customers/cust-1/ledger')
    )
    expect(customerLedgerLink).toBeDefined()

    // Switch to Supplier Payables tab
    const supplierTabBtn = screen.getByRole('button', { name: /Supplier Payables/ })
    fireEvent.click(supplierTabBtn)

    await waitFor(() => {
      expect(screen.getByText('National Distributing Co.')).toBeDefined()
    })

    const supplierLedgerLink = screen
      .getAllByRole('link')
      .find((l) => l.getAttribute('href')?.includes('/suppliers/sup-1/ledger'))
    expect(supplierLedgerLink).toBeDefined()
  })

  it('directly activates Supplier Payables when navigated with ?tab=suppliers query parameter', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={mockAuthContext()}>
          <MemoryRouter initialEntries={['/ledger?tab=suppliers']}>
            <LedgerPage />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('National Distributing Co.')).toBeDefined()
    })
  })
})
