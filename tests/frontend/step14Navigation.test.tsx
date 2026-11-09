// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { navigationGroups } from '../../src/layouts/navigation'
import { Sidebar } from '../../src/layouts/components/Sidebar'
import { AuthContext } from '../../src/features/auth/context/authContextInstance'
import type { AuthContextValue, BusinessMembershipInfo } from '../../src/features/auth/types'

function mockAuthContext(role: BusinessMembershipInfo['role'] = 'owner'): AuthContextValue {
  return {
    status: 'authenticated',
    user: {
      id: 'usr-1',
      name: 'Owner User',
      email: 'owner@retail.example.pk',
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
        role,
      },
    ],
    activeBusiness: {
      id: 'biz-1',
      name: 'Apex Superstore',
      business_code: 'APX-01',
      currency: 'PKR',
      status: 'active',
      role,
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

describe('Step 14.4 — Application Navigation Architecture', () => {
  it('defines structured navigation groups covering missing business modules', () => {
    const groupLabels = navigationGroups.map((g) => g.label)
    expect(groupLabels).toContain('OVERVIEW')
    expect(groupLabels).toContain('CONTACTS & LEDGERS')
    expect(groupLabels).toContain('FINANCIAL MANAGEMENT')
    expect(groupLabels).toContain('ADMINISTRATION')

    const allPaths = navigationGroups.flatMap((g) => g.items.map((i) => i.path))
    // Customer and Supplier Ledgers
    expect(allPaths).toContain('/ledger?tab=customers')
    expect(allPaths).toContain('/ledger?tab=suppliers')
    expect(allPaths).toContain('/ledger')
    // Expenses
    expect(allPaths).toContain('/expenses')
    // Staff
    expect(allPaths).toContain('/staff')
    // Core Operations
    expect(allPaths).toContain('/dashboard')
    expect(allPaths).toContain('/pos')
    expect(allPaths).toContain('/payments')
    expect(allPaths).toContain('/supplier-payments')
    expect(allPaths).toContain('/settings')
  })

  it('renders all authorized links in the Sidebar for Owner role', () => {
    render(
      <AuthContext.Provider value={mockAuthContext('owner')}>
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      </AuthContext.Provider>
    )

    // Verify key modules are present
    expect(screen.getByText('Dashboard')).toBeDefined()
    expect(screen.getByText('Point of sale')).toBeDefined()
    expect(screen.getByText('Customers')).toBeDefined()
    expect(screen.getByText('Customer Ledger')).toBeDefined()
    expect(screen.getByText('Suppliers')).toBeDefined()
    expect(screen.getByText('Supplier Ledger')).toBeDefined()
    expect(screen.getByText('Customer Payments')).toBeDefined()
    expect(screen.getByText('Supplier Payments')).toBeDefined()
    expect(screen.getByText('Ledger Hub')).toBeDefined()
    expect(screen.getByText('Expenses')).toBeDefined()
    expect(screen.getByText('Staff Management')).toBeDefined()
    expect(screen.getByText('Settings')).toBeDefined()
  })
})

