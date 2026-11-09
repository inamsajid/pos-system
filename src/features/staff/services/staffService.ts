import { apiClient } from '../../../lib/api-client'
import type {
  StaffMember,
  StaffInvitation,
  InviteStaffDraft,
  StaffFilters,
  StaffRole,
} from '../types/staff.types'

function isExplicitDemo(): boolean {
  return import.meta.env?.VITE_DATA_SOURCE === 'mock'
}

let mockStaff: StaffMember[] = [
  {
    id: 'mem-1',
    userId: 'usr-1',
    businessId: 'biz-default',
    name: 'Ayesha Khan',
    email: 'ayesha.khan@retail.example.pk',
    phone: '+92 300 1234567',
    role: 'owner',
    isActive: true,
    status: 'active',
    createdAt: '2026-01-01T08:00:00Z',
    assignedBranches: [
      { id: 'branch-main', name: 'Main Store', branchCode: 'BR-MAIN' },
    ],
  },
  {
    id: 'mem-2',
    userId: 'usr-2',
    businessId: 'biz-default',
    name: 'Bilal Ahmed',
    email: 'bilal.ahmed@retail.example.pk',
    phone: '+92 321 7654321',
    role: 'manager',
    isActive: true,
    status: 'active',
    createdAt: '2026-02-15T09:30:00Z',
    assignedBranches: [
      { id: 'branch-main', name: 'Main Store', branchCode: 'BR-MAIN' },
    ],
  },
  {
    id: 'mem-3',
    userId: 'usr-3',
    businessId: 'biz-default',
    name: 'Fatima Noor',
    email: 'fatima.noor@retail.example.pk',
    phone: '+92 333 9988776',
    role: 'cashier',
    isActive: true,
    status: 'active',
    createdAt: '2026-03-01T10:00:00Z',
    assignedBranches: [
      { id: 'branch-main', name: 'Main Store', branchCode: 'BR-MAIN' },
    ],
  },
  {
    id: 'mem-4',
    userId: 'usr-4',
    businessId: 'biz-default',
    name: 'Zainab Tariq',
    email: 'zainab.tariq@retail.example.pk',
    phone: '+92 345 5544332',
    role: 'accountant',
    isActive: true,
    status: 'active',
    createdAt: '2026-03-10T11:00:00Z',
    assignedBranches: [
      { id: 'branch-main', name: 'Main Store', branchCode: 'BR-MAIN' },
    ],
  },
]

let mockInvitations: StaffInvitation[] = []

export const staffService = {
  async getStaff(filters: StaffFilters = {}): Promise<StaffMember[]> {
    if (!isExplicitDemo()) {
      try {
        const query = new URLSearchParams()
        if (filters.search) query.set('search', filters.search)
        if (filters.role) query.set('role', filters.role)
        if (filters.branchId) query.set('branchId', filters.branchId)
        if (filters.isActive !== undefined) query.set('isActive', String(filters.isActive))

        const qs = query.toString()
        return await apiClient.get<StaffMember[]>(`/staff${qs ? `?${qs}` : ''}`)
      } catch (err) {
        console.warn('Backend staff API failed, falling back to mock:', err)
      }
    }

    let result = [...mockStaff]
    if (filters.search) {
      const q = filters.search.toLowerCase()
      result = result.filter(
        m =>
          m.name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q) ||
          (m.phone && m.phone.includes(q))
      )
    }
    if (filters.role) {
      result = result.filter(m => m.role === filters.role)
    }
    if (filters.branchId) {
      result = result.filter(m => m.assignedBranches.some(b => b.id === filters.branchId))
    }
    if (filters.isActive !== undefined) {
      result = result.filter(m => m.isActive === filters.isActive)
    }
    return result
  },

  async getStaffMember(id: string): Promise<StaffMember> {
    if (!isExplicitDemo()) {
      try {
        return await apiClient.get<StaffMember>(`/staff/${id}`)
      } catch (err) {
        console.warn('Backend staff get failed, using mock:', err)
      }
    }
    const member = mockStaff.find(m => m.id === id)
    if (!member) throw new Error('Staff member not found.')
    return member
  },

  async inviteStaff(draft: InviteStaffDraft): Promise<StaffInvitation> {
    if (!isExplicitDemo()) {
      try {
        return await apiClient.post<StaffInvitation>('/staff/invitations', draft)
      } catch (err) {
        console.warn('Backend staff invite failed, using mock:', err)
      }
    }

    const token = `inv-tok-${Date.now()}`
    const newInvite: StaffInvitation = {
      id: `inv-${Date.now()}`,
      businessId: 'biz-default',
      email: draft.email.trim().toLowerCase(),
      role: draft.role,
      branchIds: draft.branchIds || [],
      invitedBy: 'usr-1',
      invitedByName: 'Ayesha Khan',
      expiresAt: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
      usedAt: null,
      createdAt: new Date().toISOString(),
      invitationToken: token,
      invitationLink: `/register?invitation=${token}&email=${encodeURIComponent(draft.email)}`,
    }

    mockInvitations = [newInvite, ...mockInvitations]
    return newInvite
  },

  async getInvitations(): Promise<StaffInvitation[]> {
    if (!isExplicitDemo()) {
      try {
        return await apiClient.get<StaffInvitation[]>('/staff/invitations')
      } catch (err) {
        console.warn('Backend staff invitations get failed, using mock:', err)
      }
    }
    return [...mockInvitations]
  },

  async revokeInvitation(id: string): Promise<void> {
    if (!isExplicitDemo()) {
      try {
        await apiClient.post(`/staff/invitations/${id}/revoke`, {})
        return
      } catch (err) {
        console.warn('Backend staff revoke invite failed, using mock:', err)
      }
    }
    mockInvitations = mockInvitations.filter(i => i.id !== id)
  },

  async updateRole(memberId: string, role: StaffRole): Promise<StaffMember> {
    if (!isExplicitDemo()) {
      try {
        return await apiClient.patch<StaffMember>(`/staff/${memberId}/role`, { role })
      } catch (err) {
        console.warn('Backend staff role update failed, using mock:', err)
      }
    }

    const index = mockStaff.findIndex(m => m.id === memberId)
    if (index === -1) throw new Error('Staff member not found.')
    mockStaff[index] = { ...mockStaff[index], role }
    return mockStaff[index]
  },

  async updateBranches(memberId: string, branchIds: string[]): Promise<StaffMember> {
    if (!isExplicitDemo()) {
      try {
        return await apiClient.put<StaffMember>(`/staff/${memberId}/branches`, { branchIds })
      } catch (err) {
        console.warn('Backend staff branches update failed, using mock:', err)
      }
    }

    const index = mockStaff.findIndex(m => m.id === memberId)
    if (index === -1) throw new Error('Staff member not found.')
    mockStaff[index] = {
      ...mockStaff[index],
      assignedBranches: branchIds.map(id => ({ id, name: id, branchCode: id })),
    }
    return mockStaff[index]
  },

  async suspendStaff(memberId: string): Promise<StaffMember> {
    if (!isExplicitDemo()) {
      try {
        return await apiClient.post<StaffMember>(`/staff/${memberId}/suspend`, {})
      } catch (err) {
        console.warn('Backend staff suspend failed, using mock:', err)
      }
    }

    const index = mockStaff.findIndex(m => m.id === memberId)
    if (index === -1) throw new Error('Staff member not found.')
    mockStaff[index] = { ...mockStaff[index], isActive: false }
    return mockStaff[index]
  },

  async reactivateStaff(memberId: string): Promise<StaffMember> {
    if (!isExplicitDemo()) {
      try {
        return await apiClient.post<StaffMember>(`/staff/${memberId}/reactivate`, {})
      } catch (err) {
        console.warn('Backend staff reactivate failed, using mock:', err)
      }
    }

    const index = mockStaff.findIndex(m => m.id === memberId)
    if (index === -1) throw new Error('Staff member not found.')
    mockStaff[index] = { ...mockStaff[index], isActive: true }
    return mockStaff[index]
  },
}

