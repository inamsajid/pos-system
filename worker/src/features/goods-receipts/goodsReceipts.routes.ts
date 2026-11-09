import type { RequestContext } from '../../router'
import { jsonResponse } from '../../lib/response'
import { parseJsonBody } from '../../lib/validation'
import {
  requireAuth,
  requireBusinessContext,
  requirePermission,
} from '../../middleware/authMiddleware'
import { resolveAuthorizedBranchIds } from '../../auth/tenantContext'
import { GoodsReceiptsService } from './goodsReceipts.service'
import {
  validateCreateGoodsReceiptInput,
  parseGoodsReceiptQueryParams,
} from './goodsReceipts.validation'

export async function handleListGoodsReceipts(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const businessId = ctx.tenant!.business.id
  const filters = parseGoodsReceiptQueryParams(ctx.url)

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new GoodsReceiptsService(ctx.env.DB)
  const result = await service.listGoodsReceipts(businessId, filters, authorizedBranchIds)

  return jsonResponse(
    result.items,
    200,
    ctx.requestId,
    result.meta as unknown as Record<string, unknown>
  )
}

export async function handleGetGoodsReceipt(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const businessId = ctx.tenant!.business.id
  const receiptId = ctx.params.id

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new GoodsReceiptsService(ctx.env.DB)
  const receipt = await service.getGoodsReceiptById(businessId, receiptId, authorizedBranchIds)

  return jsonResponse(receipt, 200, ctx.requestId)
}

export async function handleReceiveGoods(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('receive_goods')(ctx)

  const purchaseId = ctx.params.id
  const body = await parseJsonBody(ctx.req)
  const input = validateCreateGoodsReceiptInput(body)

  const idempotencyKey = ctx.req.headers.get('Idempotency-Key')
  const service = new GoodsReceiptsService(ctx.env.DB)

  const receipt = await service.receiveGoods(
    ctx.tenant!.business.id,
    purchaseId,
    ctx.auth!.user.id,
    input,
    idempotencyKey
  )

  return jsonResponse(receipt, 201, ctx.requestId)
}

