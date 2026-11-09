// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ExpensesPage } from '../../src/features/expenses/pages/ExpensesPage'
import { AuthContext } from '../../src/features/auth/context/authContextInstance'
import { apiClient } from '../../src/lib/api-client'
import type { AuthContextValue } from '../../src/features/auth/types'

function mockAuthContext(): AuthContextValue {
  return {
    status: 'authenticated',
    user: {
      id: 'usr-1',
      name: 'Operations Manager',
      email: 'manager@retail.example.pk',
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
        role: 'manager',
      },
    ],
    activeBusiness: {
      id: 'biz-1',
      name: 'Apex Superstore',
      business_code: 'APX-01',
      currency: 'PKR',
      status: 'active',
      role: 'manager',
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

const sampleExpenses = [
  {
    id: 'exp-101',
    businessId: 'biz-1',
    branchId: 'br-1',
    branchName: 'Main Branch',
    expenseNumber: 'EXP-20261109-0101',
    categoryId: 'cat-util',
    categoryName: 'Utilities',
    amountMinor: 250000,
    amount: 2500,
    paymentMethod: 'cash',
    title: 'Store Electricity Bill',
    notes: 'Paid via petty cash',
    businessDateKey: '2026-11-09',
    createdBy: 'usr-1',
    createdByName: 'Operations Manager',
    createdAt: '2026-11-09T08:00:00Z',
    status: 'posted',
  },
  {
    id: 'exp-102',
    businessId: 'biz-1',
    branchId: 'br-1',
    branchName: 'Main Branch',
    expenseNumber: 'EXP-20261109-0102',
    categoryId: 'cat-supp',
    categoryName: 'Supplies',
    amountMinor: 60000,
    amount: 600,
    paymentMethod: 'bank_transfer',
    title: 'Cleaning Materials',
    notes: 'Mops and disinfectants',
    businessDateKey: '2026-11-09',
    createdBy: 'usr-1',
    createdByName: 'Operations Manager',
    createdAt: '2026-11-09T09:00:00Z',
    status: 'voided',
    voidReason: 'Wrong vendor bill',
  },
]

const sampleCategories = [
  { id: 'cat-util', name: 'Utilities', status: 'active' },
  { id: 'cat-supp', name: 'Supplies', status: 'active' },
]

describe('Step 14.4 — Expenses Management Module Integration', () => {
  beforeEach(() => {
    cleanup()
    vi.restoreAllMocks()

    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.startsWith('/expenses/summary')) {
        return Promise.resolve({
          totalMinor: 250000,
          total: 2500,
          count: 1,
          voidedCount: 1,
          byCategory: [{ categoryId: 'cat-util', categoryName: 'Utilities', totalMinor: 250000, total: 2500, count: 1 }],
        })
      }
      if (path.startsWith('/expenses')) {
        return Promise.resolve({
          items: sampleExpenses,
          total: 2,
          limit: 50,
          offset: 0,
        })
      }
      if (path.startsWith('/expense-categories')) {
        return Promise.resolve(sampleCategories)
      }
      return Promise.resolve([])
    })
  })

  it('renders ExpensesPage with KPIs, filters, categories, and expense listing', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={mockAuthContext()}>
          <MemoryRouter>
            <ExpensesPage />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>
    )

    // Wait for data load
    await waitFor(() => {
      expect(screen.getAllByText('Store Electricity Bill').length).toBeGreaterThanOrEqual(1)
    })

    expect(screen.getAllByText('Expenses Management').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Record Expense')).toBeDefined()
    expect(screen.getByText('Categories')).toBeDefined()

    // Status badges exist
    expect(screen.getAllByText('Posted').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Voided').length).toBeGreaterThanOrEqual(1)
  })

  it('opens Record Expense modal when clicking Record Expense button', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={mockAuthContext()}>
          <MemoryRouter>
            <ExpensesPage />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getAllByText('Store Electricity Bill').length).toBeGreaterThanOrEqual(1)
    })

    const recordBtn = screen.getByText('Record Expense')
    fireEvent.click(recordBtn)

    expect(screen.getByText('Record Business Expense')).toBeDefined()
    expect(screen.getByLabelText('Expense title')).toBeDefined()
    expect(screen.getByLabelText('Expense amount')).toBeDefined()
  })
})
