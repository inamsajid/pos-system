import type { RequestContext } from '../../router'
import { jsonResponse } from '../../lib/response'
import { HttpError } from '../../lib/errors'
import {
  requireAuth,
  requireBusinessContext,
  requirePermission,
} from '../../middleware/authMiddleware'
import { checkRateLimit } from '../../middleware/rateLimiter'
import { StaffService } from './staff.service'
import {
  validateInviteStaffInput,
  validateUpdateStaffRoleInput,
  validateUpdateStaffBranchesInput,
  parseStaffFilterParams,
} from './staff.validation'

export async function handleListStaff(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const role = ctx.tenant!.membership.role
  if (!['owner', 'admin', 'manager'].includes(role)) {
    throw HttpError.forbidden('You do not have permission to view staff members.')
  }

  const businessId = ctx.tenant!.business.id
  const filters = parseStaffFilterParams(ctx.url)

  const service = new StaffService(ctx.env.DB)
  const staff = await service.listStaff(businessId, filters)

  return jsonResponse(staff, 200, ctx.requestId)
}

export async function handleGetStaffMember(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const role = ctx.tenant!.membership.role
  if (!['owner', 'admin', 'manager'].includes(role)) {
    throw HttpError.forbidden('You do not have permission to view staff member details.')
  }

  const businessId = ctx.tenant!.business.id
  const memberId = ctx.params.id

  const service = new StaffService(ctx.env.DB)
  const member = await service.getStaffMember(businessId, memberId)

  return jsonResponse(member, 200, ctx.requestId)
}

export async function handleGetStaffPermissions(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const role = ctx.tenant!.membership.role
  if (!['owner', 'admin', 'manager'].includes(role)) {
    throw HttpError.forbidden('You do not have permission to view staff permissions.')
  }

  const businessId = ctx.tenant!.business.id
  const memberId = ctx.params.id

  const service = new StaffService(ctx.env.DB)
  const result = await service.getStaffPermissions(businessId, memberId)

  return jsonResponse(result, 200, ctx.requestId)
}

export async function handleGetStaffBranches(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const role = ctx.tenant!.membership.role
  if (!['owner', 'admin', 'manager'].includes(role)) {
    throw HttpError.forbidden('You do not have permission to view staff branches.')
  }

  const businessId = ctx.tenant!.business.id
  const memberId = ctx.params.id

  const service = new StaffService(ctx.env.DB)
  const branches = await service.getStaffBranches(businessId, memberId)

  return jsonResponse(branches, 200, ctx.requestId)
}

export async function handleAcceptInvitation(ctx: RequestContext): Promise<Response> {
  await checkRateLimit(ctx, { keyPrefix: 'invite_accept', maxRequests: 20, windowSeconds: 60 })
  await requireAuth(ctx)

  const userId = ctx.auth!.user.id
  const userEmail = ctx.auth!.user.email
  const body = (await ctx.req.json().catch(() => ({}))) as Record<string, unknown>
  const token = typeof body.token === 'string' ? body.token : ctx.params.token

  const service = new StaffService(ctx.env.DB)
  const result = await service.acceptInvitation(userId, userEmail, token)

  return jsonResponse(result, 200, ctx.requestId)
}

export async function handleInviteStaff(ctx: RequestContext): Promise<Response> {
  await checkRateLimit(ctx, { keyPrefix: 'invite_staff', maxRequests: 30, windowSeconds: 60 })
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('manage_staff')(ctx)

  const businessId = ctx.tenant!.business.id
  const actorRole = ctx.tenant!.membership.role
  const actorUserId = ctx.auth!.user.id

  const body = await ctx.req.json().catch(() => ({}))
  const input = validateInviteStaffInput(body)

  const service = new StaffService(ctx.env.DB)
  const invitation = await service.inviteStaff(businessId, actorRole, actorUserId, input)

  return jsonResponse(invitation, 201, ctx.requestId)
}

export async function handleListInvitations(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('manage_staff')(ctx)

  const businessId = ctx.tenant!.business.id
  const service = new StaffService(ctx.env.DB)
  const invitations = await service.listPendingInvitations(businessId)

  return jsonResponse(invitations, 200, ctx.requestId)
}

export async function handleRevokeInvitation(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('manage_staff')(ctx)

  const businessId = ctx.tenant!.business.id
  const actorUserId = ctx.auth!.user.id
  const invitationId = ctx.params.id

  const service = new StaffService(ctx.env.DB)
  await service.revokeInvitation(businessId, actorUserId, invitationId)

  return jsonResponse({ success: true, revokedId: invitationId }, 200, ctx.requestId)
}

export async function handleUpdateStaffRole(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('manage_staff')(ctx)

  const businessId = ctx.tenant!.business.id
  const actorRole = ctx.tenant!.membership.role
  const actorUserId = ctx.auth!.user.id
  const memberId = ctx.params.id

  const body = await ctx.req.json().catch(() => ({}))
  const input = validateUpdateStaffRoleInput(body)

  const service = new StaffService(ctx.env.DB)
  const updated = await service.updateStaffRole(businessId, actorRole, actorUserId, memberId, input)

  return jsonResponse(updated, 200, ctx.requestId)
}

export async function handleUpdateStaffBranches(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('manage_staff')(ctx)

  const businessId = ctx.tenant!.business.id
  const actorUserId = ctx.auth!.user.id
  const memberId = ctx.params.id

  const body = await ctx.req.json().catch(() => ({}))
  const input = validateUpdateStaffBranchesInput(body)

  const service = new StaffService(ctx.env.DB)
  const updated = await service.updateStaffBranches(businessId, actorUserId, memberId, input)

  return jsonResponse(updated, 200, ctx.requestId)
}

export async function handleSuspendStaff(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('manage_staff')(ctx)

  const businessId = ctx.tenant!.business.id
  const actorRole = ctx.tenant!.membership.role
  const actorUserId = ctx.auth!.user.id
  const memberId = ctx.params.id

  const service = new StaffService(ctx.env.DB)
  const updated = await service.suspendStaff(businessId, actorRole, actorUserId, memberId)

  return jsonResponse(updated, 200, ctx.requestId)
}

export async function handleReactivateStaff(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('manage_staff')(ctx)

  const businessId = ctx.tenant!.business.id
  const actorRole = ctx.tenant!.membership.role
  const actorUserId = ctx.auth!.user.id
  const memberId = ctx.params.id

  const service = new StaffService(ctx.env.DB)
  const updated = await service.reactivateStaff(businessId, actorRole, actorUserId, memberId)

  return jsonResponse(updated, 200, ctx.requestId)
}

