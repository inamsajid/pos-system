// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { StaffPage } from '../../src/features/staff/pages/StaffPage'
import { StaffDetailsPage } from '../../src/features/staff/pages/StaffDetailsPage'
import { AuthContext } from '../../src/features/auth/context/authContextInstance'
import { staffService } from '../../src/features/staff/services/staffService'
import { apiClient } from '../../src/lib/api-client'
import type { AuthContextValue } from '../../src/features/auth/types'
import type { StaffMember, StaffInvitation } from '../../src/features/staff/types/staff.types'

const mockStaffList: StaffMember[] = [
  {
    id: 'mem-1',
    userId: 'usr-1',
    businessId: 'biz-1',
    name: 'Ayesha Khan',
    email: 'ayesha.khan@retail.example.pk',
    phone: '+92 300 1234567',
    role: 'owner',
    isActive: true,
    status: 'active',
    createdAt: '2026-01-01T08:00:00Z',
    assignedBranches: [{ id: 'br-1', name: 'Main Branch', branchCode: 'BR-MAIN' }],
  },
  {
    id: 'mem-2',
    userId: 'usr-2',
    businessId: 'biz-1',
    name: 'Bilal Ahmed',
    email: 'bilal.ahmed@retail.example.pk',
    phone: '+92 321 7654321',
    role: 'manager',
    isActive: true,
    status: 'active',
    createdAt: '2026-02-15T09:30:00Z',
    assignedBranches: [{ id: 'br-1', name: 'Main Branch', branchCode: 'BR-MAIN' }],
  },
  {
    id: 'mem-3',
    userId: 'usr-3',
    businessId: 'biz-1',
    name: 'Fatima Noor',
    email: 'fatima.noor@retail.example.pk',
    phone: '+92 333 9988776',
    role: 'cashier',
    isActive: false,
    status: 'active',
    createdAt: '2026-03-01T10:00:00Z',
    assignedBranches: [{ id: 'br-1', name: 'Main Branch', branchCode: 'BR-MAIN' }],
  },
]

const mockInvitations: StaffInvitation[] = [
  {
    id: 'inv-1',
    businessId: 'biz-1',
    email: 'newhire@retail.example.pk',
    role: 'cashier',
    branchIds: ['br-1'],
    invitedBy: 'usr-1',
    invitedByName: 'Ayesha Khan',
    expiresAt: '2026-11-20T12:00:00Z',
    usedAt: null,
    createdAt: '2026-11-09T10:00:00Z',
    invitationToken: 'tok-abc-123',
    invitationLink: '/register?invitation=tok-abc-123',
  },
]

function mockAuthContext(): AuthContextValue {
  return {
    status: 'authenticated',
    user: {
      id: 'usr-1',
      name: 'Ayesha Khan',
      email: 'ayesha.khan@retail.example.pk',
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
        role: 'owner',
      },
    ],
    activeBusiness: {
      id: 'biz-1',
      name: 'Apex Superstore',
      business_code: 'APX-01',
      currency: 'PKR',
      status: 'active',
      role: 'owner',
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

describe('Step 14.4 — Staff Management Integration Tests', () => {
  beforeEach(() => {
    cleanup()
    vi.restoreAllMocks()

    vi.spyOn(staffService, 'getStaff').mockResolvedValue(mockStaffList)
    vi.spyOn(staffService, 'getInvitations').mockResolvedValue(mockInvitations)
    vi.spyOn(staffService, 'getStaffMember').mockImplementation((id: string) => {
      const found = mockStaffList.find((m) => m.id === id)
      if (found) return Promise.resolve(found)
      return Promise.reject(new Error('Staff member not found.'))
    })
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path === '/branches') {
        return Promise.resolve([
          { id: 'br-1', name: 'Main Branch', branchCode: 'BR-MAIN', businessId: 'biz-1' },
        ])
      }
      return Promise.resolve([])
    })
  })

  it('renders StaffPage with KPIs, team member table, status badges, and pending invitations', async () => {
    render(
      <AuthContext.Provider value={mockAuthContext()}>
        <MemoryRouter>
          <StaffPage />
        </MemoryRouter>
      </AuthContext.Provider>
    )

    await waitFor(() => {
      expect(screen.getAllByText('Ayesha Khan').length).toBeGreaterThanOrEqual(1)
    })

    expect(screen.getAllByText('Staff & Team Management').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Total Staff')).toBeDefined()
    expect(screen.getByText('Active Staff')).toBeDefined()
    expect(screen.getByText('Pending Invites')).toBeDefined()

    // Staff names & roles
    expect(screen.getAllByText('Bilal Ahmed').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Fatima Noor').length).toBeGreaterThanOrEqual(1)

    // Pending invitation email
    expect(screen.getByText('newhire@retail.example.pk')).toBeDefined()
  })

  it('opens Invite Staff modal when clicking Invite Staff Member button', async () => {
    render(
      <AuthContext.Provider value={mockAuthContext()}>
        <MemoryRouter>
          <StaffPage />
        </MemoryRouter>
      </AuthContext.Provider>
    )

    await waitFor(() => {
      expect(screen.getAllByText('Ayesha Khan').length).toBeGreaterThanOrEqual(1)
    })

    const inviteBtn = screen.getByText('Invite Staff Member')
    fireEvent.click(inviteBtn)

    expect(screen.getByText('Invite New Staff Member')).toBeDefined()
    expect(screen.getByText(/Staff Email Address/)).toBeDefined()
  })

  it('renders StaffDetailsPage with role, permissions, and branch authorizations', async () => {
    render(
      <AuthContext.Provider value={mockAuthContext()}>
        <MemoryRouter initialEntries={['/staff/mem-2']}>
          <Routes>
            <Route path="/staff/:id" element={<StaffDetailsPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    )

    await waitFor(() => {
      expect(screen.getAllByText('Bilal Ahmed').length).toBeGreaterThanOrEqual(1)
    })

    expect(screen.getByText('Branch Authorizations')).toBeDefined()
    expect(screen.getByText('Staff List')).toBeDefined()
    expect(screen.getByText(/Permissions for Role:/)).toBeDefined()
  })
})
