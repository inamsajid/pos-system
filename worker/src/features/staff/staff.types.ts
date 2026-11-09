import type { MemberRole } from '../../auth/tenantContext'

export interface AssignedBranchDTO {
  id: string
  name: string
  branchCode: string
}

export interface StaffMemberDTO {
  id: string
  userId: string
  businessId: string
  name: string
  email: string
  phone: string | null
  role: MemberRole
  isActive: boolean
  status: string
  createdAt: string
  assignedBranches: AssignedBranchDTO[]
}

export interface StaffInvitationDTO {
  id: string
  businessId: string
  email: string
  role: MemberRole
  branchIds: string[]
  invitedBy: string
  invitedByName?: string
  expiresAt: string
  usedAt: string | null
  createdAt: string
  invitationToken?: string
  invitationLink?: string
}

export interface InviteStaffInput {
  email: string
  role: MemberRole
  branchIds?: string[]
}

export interface UpdateStaffRoleInput {
  role: MemberRole
}

export interface UpdateStaffBranchesInput {
  branchIds: string[]
}

export interface StaffFilterParams {
  search?: string
  role?: MemberRole
  branchId?: string
  isActive?: boolean
}

