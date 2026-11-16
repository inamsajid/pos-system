import type { RequestContext } from '../../router'
import { jsonResponse } from '../../lib/response'
import {
  requireAuth,
  requireBusinessContext,
  requirePermission,
} from '../../middleware/authMiddleware'
import { checkRateLimit } from '../../middleware/rateLimiter'
import { createSession } from '../../auth/sessionService'
import { HttpError } from '../../lib/errors'
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
  await requirePermission('staff_read')(ctx)

  const businessId = ctx.tenant!.business.id
  const filters = parseStaffFilterParams(ctx.url)

  const service = new StaffService(ctx.env.DB)
  const staff = await service.listStaff(businessId, filters)

  return jsonResponse(staff, 200, ctx.requestId)
}

export async function handleGetStaffMember(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('staff_read')(ctx)

  const businessId = ctx.tenant!.business.id
  const memberId = ctx.params.id

  const service = new StaffService(ctx.env.DB)
  const member = await service.getStaffMember(businessId, memberId)

  return jsonResponse(member, 200, ctx.requestId)
}

export async function handleGetStaffPermissions(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('staff_read')(ctx)

  const businessId = ctx.tenant!.business.id
  const memberId = ctx.params.id

  const service = new StaffService(ctx.env.DB)
  const result = await service.getStaffPermissions(businessId, memberId)

  return jsonResponse(result, 200, ctx.requestId)
}

export async function handleGetStaffBranches(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('staff_read')(ctx)

  const businessId = ctx.tenant!.business.id
  const memberId = ctx.params.id

  const service = new StaffService(ctx.env.DB)
  const branches = await service.getStaffBranches(businessId, memberId)

  return jsonResponse(branches, 200, ctx.requestId)
}

export async function handleGetInvitationInfo(ctx: RequestContext): Promise<Response> {
  await checkRateLimit(ctx, { keyPrefix: 'invite_info', maxRequests: 30, windowSeconds: 60 })
  const token = ctx.url.searchParams.get('token') || ctx.params.token
  if (!token) {
    throw HttpError.badRequest('Invitation token is required.')
  }
  const service = new StaffService(ctx.env.DB)
  const info = await service.getInvitationInfo(token)
  return jsonResponse(info, 200, ctx.requestId)
}

export async function handleAcceptInvitation(ctx: RequestContext): Promise<Response> {
  await checkRateLimit(ctx, { keyPrefix: 'invite_accept', maxRequests: 20, windowSeconds: 60 })

  const body = (await ctx.req.json().catch(() => ({}))) as Record<string, unknown>
  const token = typeof body.token === 'string' ? body.token : ctx.params.token
  if (!token || !token.trim()) {
    throw HttpError.badRequest('Invitation token is required.')
  }

  // Check if session exists or if we should register/onboard
  try {
    await requireAuth(ctx)
  } catch (authError) {
    if (typeof body.password === 'string' && typeof body.name === 'string') {
      const service = new StaffService(ctx.env.DB)
      const res = await service.registerAndAcceptInvitation(token, body.name, body.password)
      const isSecure = ctx.url.protocol === 'https:'
      const { token: sessionToken, cookie } = await createSession(
        ctx.env.DB,
        res.userId,
        ctx.req.headers.get('CF-Connecting-IP') || ctx.req.headers.get('X-Forwarded-For'),
        ctx.req.headers.get('User-Agent'),
        isSecure
      )
      return jsonResponse(
        { ...res, sessionToken },
        200,
        ctx.requestId,
        undefined,
        { 'Set-Cookie': cookie }
      )
    }
    throw authError
  }

  const userId = ctx.auth!.user.id
  const userEmail = ctx.auth!.user.email

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

