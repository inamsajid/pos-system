import type { RequestContext } from '../../router'
import { jsonResponse } from '../../lib/response'
import { parseJsonBody } from '../../lib/validation'
import {
  requireAuth,
  requireBusinessContext,
  requirePermission,
} from '../../middleware/authMiddleware'
import { resolveAuthorizedBranchIds, resolveBranchContext } from '../../auth/tenantContext'
import { PurchasesService } from './purchases.service'
import {
  validateCreatePurchaseInput,
  validateUpdatePurchaseInput,
  parsePurchaseQueryParams,
} from './purchases.validation'

export async function handleListPurchases(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('purchase_read')(ctx)

  const businessId = ctx.tenant!.business.id
  const filters = parsePurchaseQueryParams(ctx.url)

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new PurchasesService(ctx.env.DB)
  const result = await service.listPurchases(businessId, filters, authorizedBranchIds)

  return jsonResponse(
    result.items,
    200,
    ctx.requestId,
    result.meta as unknown as Record<string, unknown>
  )
}

export async function handleGetPurchase(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('purchase_read')(ctx)

  const businessId = ctx.tenant!.business.id
  const purchaseId = ctx.params.id

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new PurchasesService(ctx.env.DB)
  const purchase = await service.getPurchaseById(businessId, purchaseId, authorizedBranchIds)

  return jsonResponse(purchase, 200, ctx.requestId)
}

export async function handleCreatePurchase(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('purchase_order')(ctx)

  const body = await parseJsonBody(ctx.req)
  const input = validateCreatePurchaseInput(body)

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
  const service = new PurchasesService(ctx.env.DB)

  const purchase = await service.createPurchase(
    businessId,
    branch.id,
    ctx.auth!.user.id,
    input,
    idempotencyKey
  )

  return jsonResponse(purchase, 201, ctx.requestId)
}

export async function handleUpdatePurchase(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('purchase_order')(ctx)

  const businessId = ctx.tenant!.business.id
  const purchaseId = ctx.params.id
  const body = await parseJsonBody(ctx.req)
  const input = validateUpdatePurchaseInput(body)

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new PurchasesService(ctx.env.DB)
  const purchase = await service.updatePurchase(
    businessId,
    purchaseId,
    ctx.auth!.user.id,
    input,
    authorizedBranchIds
  )

  return jsonResponse(purchase, 200, ctx.requestId)
}

export async function handleConfirmPurchase(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('purchase_order')(ctx)

  const businessId = ctx.tenant!.business.id
  const purchaseId = ctx.params.id

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new PurchasesService(ctx.env.DB)
  const purchase = await service.confirmPurchase(
    businessId,
    purchaseId,
    ctx.auth!.user.id,
    authorizedBranchIds
  )

  return jsonResponse(purchase, 200, ctx.requestId)
}

export async function handleCancelPurchase(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('purchase_order')(ctx)

  const businessId = ctx.tenant!.business.id
  const purchaseId = ctx.params.id
  let reason: string | undefined
  try {
    const body = (await parseJsonBody(ctx.req)) as { reason?: unknown }
    if (body && typeof body.reason === 'string') {
      reason = body.reason.trim()
    }
  } catch {
    // optional body
  }

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new PurchasesService(ctx.env.DB)
  const purchase = await service.cancelPurchase(
    businessId,
    purchaseId,
    ctx.auth!.user.id,
    reason,
    authorizedBranchIds
  )

  return jsonResponse(purchase, 200, ctx.requestId)
}

