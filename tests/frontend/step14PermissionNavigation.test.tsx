// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from '../../src/layouts/components/Sidebar'
import { MobileNavigation } from '../../src/layouts/components/MobileNavigation'
import { PermissionGuard } from '../../src/app/PermissionGuard'
import { AuthContext } from '../../src/features/auth/context/authContextInstance'
import type { AuthContextValue, BusinessMembershipInfo } from '../../src/features/auth/types'

function mockAuthContext(role: BusinessMembershipInfo['role']): AuthContextValue {
  return {
    status: 'authenticated',
    user: {
      id: 'usr-1',
      name: 'Role Test User',
      email: `${role}@retail.example.pk`,
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

describe('Step 14.4 — Role-Based Permission-Aware Navigation & Guards', () => {
  beforeEach(() => {
    cleanup()
  })

  it('restricts Cashier from seeing administrative and managerial menus in Sidebar', () => {
    render(
      <AuthContext.Provider value={mockAuthContext('cashier')}>
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      </AuthContext.Provider>
    )

    // Allowed for cashier:
    expect(screen.getByText('Dashboard')).toBeDefined()
    expect(screen.getByText('Point of sale')).toBeDefined()
    expect(screen.getByText('Customers')).toBeDefined()
    expect(screen.getAllByText('Customer Payments').length).toBeGreaterThanOrEqual(1)

    // Restricted for cashier:
    expect(screen.queryByText('Staff Management')).toBeNull()
    expect(screen.queryByText('Settings')).toBeNull()
    expect(screen.queryByText('Expenses')).toBeNull()
    expect(screen.queryByText('Ledger Hub')).toBeNull()
    expect(screen.queryByText('Inventory')).toBeNull()
    expect(screen.queryByText('Purchases')).toBeNull()
    expect(screen.queryByText('Supplier Payments')).toBeNull()
  })

  it('restricts Accountant from POS and Staff Management, but grants Financial Ledgers & Expenses', () => {
    render(
      <AuthContext.Provider value={mockAuthContext('accountant')}>
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      </AuthContext.Provider>
    )

    // Allowed for accountant:
    expect(screen.getByText('Ledger Hub')).toBeDefined()
    expect(screen.getByText('Customer Ledger')).toBeDefined()
    expect(screen.getByText('Supplier Ledger')).toBeDefined()
    expect(screen.getByText('Expenses')).toBeDefined()
    expect(screen.getAllByText('Customer Payments').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Supplier Payments').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Reports')).toBeDefined()

    // Restricted for accountant:
    expect(screen.queryByText('Point of sale')).toBeNull()
    expect(screen.queryByText('Staff Management')).toBeNull()
    expect(screen.queryByText('Settings')).toBeNull()
  })

  it('applies permission filtering to MobileNavigation as well', () => {
    render(
      <AuthContext.Provider value={mockAuthContext('cashier')}>
        <MemoryRouter>
          <MobileNavigation open={true} onClose={vi.fn()} />
        </MemoryRouter>
      </AuthContext.Provider>
    )

    const nav = screen.getByTestId('mobile-nav')
    expect(nav.textContent).toContain('Point of sale')
    expect(nav.textContent).not.toContain('Staff Management')
    expect(nav.textContent).not.toContain('Expenses')
  })

  it('PermissionGuard denies direct route access when user role lacks required permission', () => {
    render(
      <AuthContext.Provider value={mockAuthContext('cashier')}>
        <MemoryRouter>
          <PermissionGuard permission="manage_staff">
            <div data-testid="protected-content">Secret Staff Content</div>
          </PermissionGuard>
        </MemoryRouter>
      </AuthContext.Provider>
    )

    expect(screen.getByTestId('permission-denied')).toBeDefined()
    expect(screen.getByText('Access Restricted')).toBeDefined()
    expect(screen.queryByTestId('protected-content')).toBeNull()
  })

  it('PermissionGuard allows direct route access when user role holds permission', () => {
    render(
      <AuthContext.Provider value={mockAuthContext('owner')}>
        <MemoryRouter>
          <PermissionGuard permission="manage_staff">
            <div data-testid="protected-content">Secret Staff Content</div>
          </PermissionGuard>
        </MemoryRouter>
      </AuthContext.Provider>
    )

    expect(screen.queryByTestId('permission-denied')).toBeNull()
    expect(screen.getByTestId('protected-content')).toBeDefined()
  })
})
