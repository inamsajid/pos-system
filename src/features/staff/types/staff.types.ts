export type StaffRole =
  | 'owner'
  | 'admin'
  | 'manager'
  | 'cashier'
  | 'accountant'
  | 'inventory_manager'

export interface AssignedBranch {
  id: string
  name: string
  branchCode: string
}

export interface StaffMember {
  id: string
  userId: string
  businessId: string
  name: string
  email: string
  phone: string | null
  role: StaffRole
  isActive: boolean
  status: string
  createdAt: string
  assignedBranches: AssignedBranch[]
}

export interface StaffInvitation {
  id: string
  businessId: string
  email: string
  role: StaffRole
  branchIds: string[]
  invitedBy: string
  invitedByName?: string
  expiresAt: string
  usedAt: string | null
  createdAt: string
  invitationToken?: string
  invitationLink?: string
}

export interface InviteStaffDraft {
  email: string
  role: StaffRole
  branchIds?: string[]
}

export interface StaffFilters {
  search?: string
  role?: StaffRole
  branchId?: string
  isActive?: boolean
}

