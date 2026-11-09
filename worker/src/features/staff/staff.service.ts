import { HttpError } from '../../lib/errors'
import { type MemberRole, ROLE_PERMISSIONS } from '../../auth/tenantContext'
import { StaffRepository } from './staff.repository'
import type {
  StaffMemberDTO,
  StaffInvitationDTO,
  StaffFilterParams,
  InviteStaffInput,
  UpdateStaffRoleInput,
  UpdateStaffBranchesInput,
  AssignedBranchDTO,
} from './staff.types'

export class StaffService {
  private readonly repo: StaffRepository

  constructor(db: D1Database) {
    this.repo = new StaffRepository(db)
  }

  async listStaff(businessId: string, filters: StaffFilterParams = {}): Promise<StaffMemberDTO[]> {
    return this.repo.listStaffMembers(businessId, filters)
  }

  async getStaffMember(businessId: string, memberId: string): Promise<StaffMemberDTO> {
    const member = await this.repo.getStaffMemberById(businessId, memberId)
    if (!member) {
      throw HttpError.notFound('Staff member not found.')
    }
    return member
  }

  async getStaffPermissions(businessId: string, memberId: string): Promise<{ role: MemberRole; permissions: string[] }> {
    const member = await this.getStaffMember(businessId, memberId)
    const permissions = ROLE_PERMISSIONS[member.role] || []
    return {
      role: member.role,
      permissions: [...permissions],
    }
  }

  async getStaffBranches(businessId: string, memberId: string): Promise<AssignedBranchDTO[]> {
    const member = await this.getStaffMember(businessId, memberId)
    return member.assignedBranches
  }

  async inviteStaff(
    businessId: string,
    actorRole: MemberRole,
    actorUserId: string,
    input: InviteStaffInput
  ): Promise<StaffInvitationDTO> {
    // RBAC Guardrails
    if (actorRole !== 'owner' && input.role === 'owner') {
      throw HttpError.forbidden('Only business owners can invite new owners.')
    }
    if (actorRole !== 'owner' && input.role === 'admin') {
      throw HttpError.forbidden('Only business owners can invite admins.')
    }

    const invitationId = `inv-${crypto.randomUUID()}`

    // Generate secure token
    const tokenBytes = new Uint8Array(24)
    crypto.getRandomValues(tokenBytes)
    const token = Array.from(tokenBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    // SHA-256 hash of token
    const encoder = new TextEncoder()
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(token))
    const tokenHash = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
    const branchIdsJson = input.branchIds && input.branchIds.length > 0 ? JSON.stringify(input.branchIds) : null

    await this.repo.createInvitation(
      invitationId,
      businessId,
      input.email,
      input.role,
      tokenHash,
      branchIdsJson,
      actorUserId,
      expiresAt
    )

    await this.repo.insertAuditLog(
      businessId,
      actorUserId,
      'invite_staff',
      'staff_invitation',
      invitationId,
      JSON.stringify({ email: input.email, role: input.role, branchIds: input.branchIds })
    )

    return {
      id: invitationId,
      businessId,
      email: input.email,
      role: input.role,
      branchIds: input.branchIds || [],
      invitedBy: actorUserId,
      expiresAt,
      usedAt: null,
      createdAt: new Date().toISOString(),
      invitationToken: token,
      invitationLink: `/register?invitation=${token}&email=${encodeURIComponent(input.email)}`,
    }
  }

  async listPendingInvitations(businessId: string): Promise<StaffInvitationDTO[]> {
    return this.repo.listPendingInvitations(businessId)
  }

  async revokeInvitation(businessId: string, actorUserId: string, invitationId: string): Promise<void> {
    await this.repo.revokeInvitation(businessId, invitationId)
    await this.repo.insertAuditLog(
      businessId,
      actorUserId,
      'revoke_invitation',
      'staff_invitation',
      invitationId
    )
  }

  async acceptInvitation(
    userId: string,
    userEmail: string,
    token: string
  ): Promise<{ memberId: string; businessId: string; role: string }> {
    if (!token || !token.trim()) {
      throw HttpError.badRequest('Invitation token is required.')
    }

    // SHA-256 hash of provided token
    const encoder = new TextEncoder()
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(token.trim()))
    const tokenHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    const invitation = await this.repo.getInvitationByTokenHash(tokenHash)
    if (!invitation) {
      throw HttpError.notFound('Invalid or non-existent invitation token.')
    }

    if (invitation.used_at) {
      throw HttpError.badRequest('This invitation has already been accepted.')
    }

    if (new Date(invitation.expires_at).getTime() < Date.now()) {
      throw HttpError.badRequest('This invitation has expired.')
    }

    if (userEmail.toLowerCase() !== invitation.email.toLowerCase()) {
      throw HttpError.forbidden(
        `Invitation was issued for ${invitation.email}, but current user is ${userEmail}.`
      )
    }

    const memberId = `bm-${crypto.randomUUID()}`
    const finalMemberId = await this.repo.upsertBusinessMember(
      memberId,
      invitation.business_id,
      userId,
      invitation.role
    )

    // Assign branches if specified
    if (invitation.branch_ids_json) {
      try {
        const branchIds = JSON.parse(invitation.branch_ids_json)
        if (Array.isArray(branchIds) && branchIds.length > 0) {
          await this.repo.updateMemberBranches(finalMemberId, branchIds)
        }
      } catch {}
    }

    await this.repo.markInvitationUsed(invitation.id)

    await this.repo.insertAuditLog(
      invitation.business_id,
      userId,
      'accept_invitation',
      'staff_invitation',
      invitation.id,
      JSON.stringify({ memberId: finalMemberId, role: invitation.role })
    )

    return {
      memberId: finalMemberId,
      businessId: invitation.business_id,
      role: invitation.role,
    }
  }

  async updateStaffRole(
    businessId: string,
    actorRole: MemberRole,
    actorUserId: string,
    targetMemberId: string,
    input: UpdateStaffRoleInput
  ): Promise<StaffMemberDTO> {
    const target = await this.repo.getStaffMemberById(businessId, targetMemberId)
    if (!target) {
      throw HttpError.notFound('Staff member not found.')
    }

    if (target.role === input.role) {
      return target
    }

    // Guardrail: Cannot demote the last remaining active owner
    if (target.role === 'owner' && input.role !== 'owner') {
      const activeOwners = await this.repo.countActiveOwners(businessId)
      if (activeOwners <= 1) {
        throw HttpError.badRequest('Cannot demote the only remaining active owner of the business.')
      }
    }

    // Guardrail: Non-owners cannot promote or demote owners
    if (actorRole !== 'owner') {
      if (target.role === 'owner') {
        throw HttpError.forbidden('Only owners can modify owner privileges.')
      }
      if (input.role === 'owner') {
        throw HttpError.forbidden('Only owners can promote members to owner.')
      }
    }

    await this.repo.updateMemberRole(businessId, targetMemberId, input.role)

    await this.repo.insertAuditLog(
      businessId,
      actorUserId,
      'update_staff_role',
      'staff_member',
      targetMemberId,
      JSON.stringify({ previousRole: target.role, newRole: input.role, targetUserId: target.userId })
    )

    const updated = await this.repo.getStaffMemberById(businessId, targetMemberId)
    return updated!
  }

  async updateStaffBranches(
    businessId: string,
    actorUserId: string,
    targetMemberId: string,
    input: UpdateStaffBranchesInput
  ): Promise<StaffMemberDTO> {
    const target = await this.repo.getStaffMemberById(businessId, targetMemberId)
    if (!target) {
      throw HttpError.notFound('Staff member not found.')
    }

    await this.repo.updateMemberBranches(targetMemberId, input.branchIds)

    await this.repo.insertAuditLog(
      businessId,
      actorUserId,
      'update_staff_branches',
      'staff_member',
      targetMemberId,
      JSON.stringify({ branchIds: input.branchIds })
    )

    const updated = await this.repo.getStaffMemberById(businessId, targetMemberId)
    return updated!
  }

  async suspendStaff(
    businessId: string,
    actorRole: MemberRole,
    actorUserId: string,
    targetMemberId: string
  ): Promise<StaffMemberDTO> {
    const target = await this.repo.getStaffMemberById(businessId, targetMemberId)
    if (!target) {
      throw HttpError.notFound('Staff member not found.')
    }

    if (target.userId === actorUserId) {
      throw HttpError.badRequest('You cannot suspend your own account.')
    }

    if (target.role === 'owner') {
      const activeOwners = await this.repo.countActiveOwners(businessId)
      if (activeOwners <= 1) {
        throw HttpError.badRequest('Cannot suspend the only remaining active owner of the business.')
      }
      if (actorRole !== 'owner') {
        throw HttpError.forbidden('Only owners can suspend another owner.')
      }
    }

    await this.repo.setMemberActiveStatus(businessId, targetMemberId, false)

    await this.repo.insertAuditLog(
      businessId,
      actorUserId,
      'suspend_staff',
      'staff_member',
      targetMemberId,
      JSON.stringify({ targetUserId: target.userId })
    )

    const updated = await this.repo.getStaffMemberById(businessId, targetMemberId)
    return updated!
  }

  async reactivateStaff(
    businessId: string,
    actorRole: MemberRole,
    actorUserId: string,
    targetMemberId: string
  ): Promise<StaffMemberDTO> {
    const target = await this.repo.getStaffMemberById(businessId, targetMemberId)
    if (!target) {
      throw HttpError.notFound('Staff member not found.')
    }

    if (target.role === 'owner' && actorRole !== 'owner') {
      throw HttpError.forbidden('Only owners can reactivate an owner.')
    }

    await this.repo.setMemberActiveStatus(businessId, targetMemberId, true)

    await this.repo.insertAuditLog(
      businessId,
      actorUserId,
      'reactivate_staff',
      'staff_member',
      targetMemberId,
      JSON.stringify({ targetUserId: target.userId })
    )

    const updated = await this.repo.getStaffMemberById(businessId, targetMemberId)
    return updated!
  }
}

