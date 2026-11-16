import type { RequestContext } from '../../router'
import { jsonResponse } from '../../lib/response'
import { parseJsonBody } from '../../lib/validation'
import { HttpError } from '../../lib/errors'
import {
  requireAuth,
  requireBusinessContext,
  requirePermission,
} from '../../middleware/authMiddleware'
import { resolveAuthorizedBranchIds, resolveBranchContext } from '../../auth/tenantContext'
import { OfflineService } from './offline.service'
import type {
  CreateOfflineAuthorizationInput,
  CommitOfflineSaleInput,
} from './offline.types'

function getSigningSecret(ctx: RequestContext): string {
  const secret = ctx.env.AUTH_SECRET?.trim()
  if (!secret || secret.length < 16) {
    throw new HttpError(
      500,
      'CONFIGURATION_ERROR',
      'Server offline signing secret (AUTH_SECRET) is missing or insufficiently configured.'
    )
  }
  return secret
}

export async function handleCreateOfflineAuthorization(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('pos_sale')(ctx)

  const businessId = ctx.tenant!.business.id
  const requestedBranchId = ctx.req.headers.get('X-Branch-Id') || undefined
  const branch = await resolveBranchContext(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    requestedBranchId
  )

  const userId = ctx.auth!.user.id

  const body = await parseJsonBody<CreateOfflineAuthorizationInput>(ctx.req)
  if (!body.deviceId) {
    throw HttpError.badRequest('deviceId is required to issue offline authorization.')
  }

  const service = new OfflineService(ctx.env.DB)
  const result = await service.createAuthorization({
    businessId,
    branchId: branch.id,
    userId,
    actorRole: ctx.tenant!.membership.role,
    input: body,
    secret: getSigningSecret(ctx),
  })

  return jsonResponse(result, 201, ctx.requestId)
}

export async function handleCommitOfflineSale(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('pos_sale')(ctx)

  const businessId = ctx.tenant!.business.id
  const requestedBranchId = ctx.req.headers.get('X-Branch-Id') || undefined
  const branch = await resolveBranchContext(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    requestedBranchId
  )

  const userId = ctx.auth!.user.id
  const cashierName = ctx.auth!.user.name || ctx.auth!.user.email

  const idempotencyKey = ctx.req.headers.get('Idempotency-Key') || undefined
  const body = await parseJsonBody<CommitOfflineSaleInput>(ctx.req)

  if (!body.authorizationId) {
    throw HttpError.badRequest('authorizationId is required.')
  }
  if (!body.deviceId) {
    throw HttpError.badRequest('deviceId is required.')
  }
  if (!body.provisionalReceiptNumber) {
    throw HttpError.badRequest('provisionalReceiptNumber is required.')
  }
  if (!body.items || body.items.length === 0) {
    throw HttpError.badRequest('items array must not be empty.')
  }

  const service = new OfflineService(ctx.env.DB)
  const result = await service.commitOfflineSale({
    businessId,
    branchId: branch.id,
    userId,
    cashierName,
    input: body,
    idempotencyKey,
    secret: getSigningSecret(ctx),
    actorRole: ctx.tenant!.membership.role,
  })

  return jsonResponse(result, result.isCached ? 200 : 201, ctx.requestId)
}

export async function handleReconcileAllocation(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('stock_adjustment')(ctx)

  const businessId = ctx.tenant!.business.id
  const allocationId = ctx.params.id

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new OfflineService(ctx.env.DB)
  const result = await service.reconcileAllocation(
    businessId,
    allocationId,
    authorizedBranchIds
  )

  return jsonResponse(result, 200, ctx.requestId)
}

export async function handleReconcileLostDevice(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('manage_settings')(ctx)

  const businessId = ctx.tenant!.business.id
  const deviceId = ctx.params.id

  const service = new OfflineService(ctx.env.DB)
  const result = await service.reconcileLostDevice(businessId, deviceId)

  return jsonResponse(result, 200, ctx.requestId)
}
