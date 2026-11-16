import { HttpError } from '../../lib/errors'
import { type MemberRole, ROLE_PERMISSIONS } from '../../auth/tenantContext'
import { revokeAllUserSessions } from '../../auth/sessionService'
import { sha256Hex, hashPassword, verifyPassword, generateId } from '../../auth/crypto'
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
  private readonly db: D1Database
  private readonly repo: StaffRepository

  constructor(db: D1Database) {
    this.db = db
    this.repo = new StaffRepository(db)
  }

  private async validateBranchIdsForBusiness(
    businessId: string,
    branchIds: string[]
  ): Promise<string[]> {
    const uniqueBranchIds = [...new Set(branchIds.map((id) => id.trim()).filter(Boolean))]
    if (uniqueBranchIds.length === 0) {
      return []
    }

    const activeIds = new Set(await this.repo.findActiveBranchIds(businessId, uniqueBranchIds))
    const invalidIds = uniqueBranchIds.filter((id) => !activeIds.has(id))
    if (invalidIds.length > 0) {
      throw HttpError.badRequest(
        `One or more branchIds are invalid, inactive, or do not belong to this business: ${invalidIds.join(', ')}`,
        { field: 'branchIds', invalidBranchIds: invalidIds }
      )
    }

    return uniqueBranchIds
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

    const validatedBranchIds =
      input.branchIds && input.branchIds.length > 0
        ? await this.validateBranchIdsForBusiness(businessId, input.branchIds)
        : []

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
    const branchIdsJson = validatedBranchIds.length > 0 ? JSON.stringify(validatedBranchIds) : null

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
      JSON.stringify({ email: input.email, role: input.role, branchIds: validatedBranchIds })
    )

    return {
      id: invitationId,
      businessId,
      email: input.email,
      role: input.role,
      branchIds: validatedBranchIds,
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

    let branchIds: string[] = []
    if (invitation.branch_ids_json) {
      let parsed: unknown = null
      try {
        parsed = JSON.parse(invitation.branch_ids_json)
      } catch {
        parsed = null
      }
      if (Array.isArray(parsed) && parsed.length > 0) {
        branchIds = await this.validateBranchIdsForBusiness(invitation.business_id, parsed as string[])
      }
    }

    const memberId = `bm-${crypto.randomUUID()}`
    const finalMemberId = await this.repo.upsertBusinessMember(
      memberId,
      invitation.business_id,
      userId,
      invitation.role
    )

    if (branchIds.length > 0) {
      await this.repo.updateMemberBranches(finalMemberId, branchIds)
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

  async getInvitationInfo(token: string): Promise<{
    id: string
    email: string
    role: string
    businessId: string
    businessName: string
    invitedByName: string | null
    isExpired: boolean
    isUsed: boolean
  }> {
    if (!token || !token.trim()) {
      throw HttpError.badRequest('Invitation token is required.')
    }
    const tokenHash = await sha256Hex(token.trim())
    const inv = await this.repo.getInvitationDetails(tokenHash)
    if (!inv) {
      throw HttpError.notFound('Invalid or non-existent invitation token.')
    }
    return {
      id: inv.id,
      email: inv.email,
      role: inv.role,
      businessId: inv.business_id,
      businessName: inv.business_name || 'Northstar POS Store',
      invitedByName: inv.invited_by_name || null,
      isExpired: new Date(inv.expires_at).getTime() < Date.now(),
      isUsed: Boolean(inv.used_at),
    }
  }

  async registerAndAcceptInvitation(
    token: string,
    name: string,
    password: string
  ): Promise<{ userId: string; userEmail: string; memberId: string; businessId: string; role: string }> {
    if (!token || !token.trim()) {
      throw HttpError.badRequest('Invitation token is required.')
    }
    if (!name || name.trim().length < 2) {
      throw HttpError.badRequest('Full name is required (minimum 2 characters).')
    }
    if (!password || password.length < 8) {
      throw HttpError.badRequest('Password must be at least 8 characters.')
    }

    const tokenHash = await sha256Hex(token.trim())
    const inv = await this.repo.getInvitationByTokenHash(tokenHash)
    if (!inv) {
      throw HttpError.notFound('Invalid or non-existent invitation token.')
    }
    if (inv.used_at) {
      throw HttpError.badRequest('This invitation has already been accepted.')
    }
    if (new Date(inv.expires_at).getTime() < Date.now()) {
      throw HttpError.badRequest('This invitation has expired.')
    }

    let existingUser = await this.repo.findUserByEmail(inv.email)
    let userId: string

    if (existingUser) {
      const ok = await verifyPassword(password, existingUser.password_hash)
      if (!ok) {
        throw HttpError.conflict('An account with this email already exists. Please verify your password to accept.')
      }
      userId = existingUser.id
    } else {
      userId = generateId()
      const passwordHash = await hashPassword(password)
      await this.repo.createUser(userId, inv.email, name, passwordHash)
    }

    const result = await this.acceptInvitation(userId, inv.email, token)
    return {
      userId,
      userEmail: inv.email,
      memberId: result.memberId,
      businessId: result.businessId,
      role: result.role,
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

    const validatedBranchIds = await this.validateBranchIdsForBusiness(businessId, input.branchIds)
    await this.repo.updateMemberBranches(targetMemberId, validatedBranchIds)

    await this.repo.insertAuditLog(
      businessId,
      actorUserId,
      'update_staff_branches',
      'staff_member',
      targetMemberId,
      JSON.stringify({ branchIds: validatedBranchIds })
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
    await revokeAllUserSessions(this.db, target.userId)

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

