import type { RequestContext } from '../../router'
import { jsonResponse } from '../../lib/response'
import { parseJsonBody } from '../../lib/validation'
import {
  requireAuth,
  requireBusinessContext,
  requirePermission,
} from '../../middleware/authMiddleware'
import { resolveAuthorizedBranchIds, resolveBranchContext } from '../../auth/tenantContext'
import { InventoryService } from './inventory.service'
import {
  validateStockAdjustmentInput,
  validateCreateStockCountInput,
  parseInventoryQueryParams,
  parseStockMovementQueryParams,
  parseStockCountQueryParams,
} from './inventory.validation'

export async function handleListBalances(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const businessId = ctx.tenant!.business.id
  const filters = parseInventoryQueryParams(ctx.url)

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new InventoryService(ctx.env.DB)
  const result = await service.listBalances(businessId, filters, authorizedBranchIds)

  return jsonResponse(
    result.items,
    200,
    ctx.requestId,
    result.meta as unknown as Record<string, unknown>
  )
}

export async function handleGetProductBalances(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const businessId = ctx.tenant!.business.id
  const productId = ctx.params.productId

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new InventoryService(ctx.env.DB)
  const balances = await service.getProductBalances(businessId, productId, authorizedBranchIds)

  return jsonResponse(balances, 200, ctx.requestId)
}

export async function handleListMovements(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const businessId = ctx.tenant!.business.id
  const filters = parseStockMovementQueryParams(ctx.url)

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new InventoryService(ctx.env.DB)
  const result = await service.listMovements(businessId, filters, authorizedBranchIds)

  return jsonResponse(
    result.items,
    200,
    ctx.requestId,
    result.meta as unknown as Record<string, unknown>
  )
}

export async function handleRecordAdjustment(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('stock_adjustment')(ctx)

  const body = await parseJsonBody(ctx.req)
  const input = validateStockAdjustmentInput(body)

  const businessId = ctx.tenant!.business.id
  const requestedBranchId = ctx.req.headers.get('X-Branch-Id') || input.branchId

  const branch = await resolveBranchContext(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    requestedBranchId
  )

  const idempotencyKey = ctx.req.headers.get('Idempotency-Key')
  const service = new InventoryService(ctx.env.DB)

  const movement = await service.recordAdjustment(
    businessId,
    branch.id,
    ctx.auth!.user.id,
    input,
    idempotencyKey
  )

  return jsonResponse(movement, 201, ctx.requestId)
}

export async function handleListCounts(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const businessId = ctx.tenant!.business.id
  const filters = parseStockCountQueryParams(ctx.url)

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new InventoryService(ctx.env.DB)
  const result = await service.listCounts(businessId, filters, authorizedBranchIds)

  return jsonResponse(
    result.items,
    200,
    ctx.requestId,
    result.meta as unknown as Record<string, unknown>
  )
}

export async function handleCreateCount(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('stock_adjustment')(ctx)

  const body = await parseJsonBody(ctx.req)
  const input = validateCreateStockCountInput(body)

  const businessId = ctx.tenant!.business.id
  const requestedBranchId = ctx.req.headers.get('X-Branch-Id') || input.branchId

  const branch = await resolveBranchContext(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    requestedBranchId
  )

  const service = new InventoryService(ctx.env.DB)
  const count = await service.createCountDraft(businessId, branch.id, ctx.auth!.user.id, input)

  return jsonResponse(count, 201, ctx.requestId)
}

export async function handleGetCount(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const businessId = ctx.tenant!.business.id
  const countId = ctx.params.id

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new InventoryService(ctx.env.DB)
  const count = await service.getCountById(businessId, countId, authorizedBranchIds)

  return jsonResponse(count, 200, ctx.requestId)
}

export async function handleCompleteCount(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('stocktake_confirm')(ctx)

  const businessId = ctx.tenant!.business.id
  const countId = ctx.params.id
  const idempotencyKey = ctx.req.headers.get('Idempotency-Key')

  const service = new InventoryService(ctx.env.DB)
  const count = await service.completeCount(
    businessId,
    countId,
    ctx.auth!.user.id,
    idempotencyKey
  )

  return jsonResponse(count, 200, ctx.requestId)
}

