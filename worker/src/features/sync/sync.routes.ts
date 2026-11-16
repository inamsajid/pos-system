import type { RequestContext } from '../../router'
import { jsonResponse } from '../../lib/response'
import { parseJsonBody } from '../../lib/validation'
import {
  requireAuth,
  requireBusinessContext,
  requirePermission,
} from '../../middleware/authMiddleware'
import { resolveAuthorizedBranchIds } from '../../auth/tenantContext'
import { SyncService } from './sync.service'
import type { RegisterDeviceInput, DeviceHeartbeatInput, AckChangesInput } from './sync.types'

export async function handleRegisterDevice(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('sync_use')(ctx)

  const body = await parseJsonBody<RegisterDeviceInput>(ctx.req)
  const service = new SyncService(ctx.env.DB)
  const device = await service.registerDevice(
    ctx.tenant!.business.id,
    ctx.auth!.user.id,
    body
  )

  return jsonResponse(device, 201, ctx.requestId)
}

export async function handleListDevices(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('sync_use')(ctx)

  const service = new SyncService(ctx.env.DB)
  const devices = await service.listDevices(
    ctx.tenant!.business.id,
    ctx.auth!.user.id,
    ctx.tenant!.membership.role
  )

  return jsonResponse(devices, 200, ctx.requestId)
}

export async function handleDeviceHeartbeat(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('sync_use')(ctx)

  const body = await parseJsonBody<DeviceHeartbeatInput>(ctx.req)
  const service = new SyncService(ctx.env.DB)
  const result = await service.heartbeat(
    ctx.tenant!.business.id,
    body.installationId,
    ctx.auth!.user.id,
    ctx.tenant!.membership.role
  )

  return jsonResponse(result, 200, ctx.requestId)
}

export async function handleRevokeDevice(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('sync_use')(ctx)

  const deviceId = ctx.params.id
  const service = new SyncService(ctx.env.DB)
  const revoked = await service.revokeDevice(
    ctx.tenant!.business.id,
    ctx.auth!.user.id,
    ctx.tenant!.membership.role,
    deviceId
  )

  return jsonResponse(revoked, 200, ctx.requestId)
}

export async function handleGetChanges(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('sync_use')(ctx)

  const businessId = ctx.tenant!.business.id
  const installationId =
    ctx.req.headers.get('X-Device-Id') || ctx.url.searchParams.get('deviceId') || ''
  const cursor = ctx.url.searchParams.get('cursor')
  const limitParam = ctx.url.searchParams.get('limit')
  const limit = limitParam ? parseInt(limitParam, 10) : 50
  const branchId = ctx.url.searchParams.get('branchId') || ctx.req.headers.get('X-Branch-Id')

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    branchId
  )

  const service = new SyncService(ctx.env.DB)
  const result = await service.pullChanges({
    businessId,
    userId: ctx.auth!.user.id,
    userRole: ctx.tenant!.membership.role,
    installationId,
    cursor,
    limit,
    branchId: branchId || null,
    authorizedBranchIds,
  })

  return jsonResponse(result, 200, ctx.requestId)
}

export async function handleAckChanges(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('sync_use')(ctx)

  const body = await parseJsonBody<AckChangesInput>(ctx.req)
  const installationId =
    body.installationId || ctx.req.headers.get('X-Device-Id') || ''
  const service = new SyncService(ctx.env.DB)
  const result = await service.ackChanges(
    ctx.tenant!.business.id,
    installationId,
    body.cursor,
    ctx.auth!.user.id,
    ctx.tenant!.membership.role
  )

  return jsonResponse(result, 200, ctx.requestId)
}
