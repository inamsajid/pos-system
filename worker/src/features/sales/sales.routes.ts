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
import { SalesService } from './sales.service'
import { validateCreateSaleInput, parseSaleQueryParams } from './sales.validation'

export async function handleListSales(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('sales_read')(ctx)

  const businessId = ctx.tenant!.business.id
  const filters = parseSaleQueryParams(ctx.url)

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new SalesService(ctx.env.DB)
  const result = await service.listSales(businessId, filters, authorizedBranchIds)

  return jsonResponse(
    result.items,
    200,
    ctx.requestId,
    result.meta as unknown as Record<string, unknown>
  )
}

export async function handleGetSale(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('sales_read')(ctx)

  const businessId = ctx.tenant!.business.id
  const saleId = ctx.params.id

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new SalesService(ctx.env.DB)
  const sale = await service.getSaleById(businessId, saleId, authorizedBranchIds)

  return jsonResponse(sale, 200, ctx.requestId)
}

export async function handleCreateSale(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('pos_sale')(ctx)

  const body = await parseJsonBody(ctx.req)
  const input = validateCreateSaleInput(body)

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
  const service = new SalesService(ctx.env.DB)

  const sale = await service.completeSale(
    businessId,
    branch.id,
    ctx.auth!.user.id,
    ctx.auth!.user.name || 'Cashier',
    input,
    idempotencyKey,
    ctx.tenant!.membership.role
  )

  return jsonResponse(sale, 201, ctx.requestId)
}

export async function handleVoidSale(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('void_sale')(ctx)

  const businessId = ctx.tenant!.business.id
  const saleId = ctx.params.id

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  let reason = 'Sale voided by supervisor'
  try {
    const body = (await parseJsonBody(ctx.req)) as { reason?: unknown }
    if (body && typeof body.reason === 'string' && body.reason.trim().length > 0) {
      reason = body.reason.trim()
    }
  } catch {
    // optional body
  }

  const service = new SalesService(ctx.env.DB)
  const voided = await service.voidSale(
    businessId,
    saleId,
    ctx.auth!.user.id,
    ctx.tenant!.membership.role,
    reason,
    authorizedBranchIds
  )

  return jsonResponse(voided, 200, ctx.requestId)
}

export async function handleGetSaleInvoice(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('sales_read')(ctx)

  const businessId = ctx.tenant!.business.id
  const saleId = ctx.params.id

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  // Verify access to sale first
  const service = new SalesService(ctx.env.DB)
  await service.getSaleById(businessId, saleId, authorizedBranchIds)

  // Fetch invoice row
  const invoice = await ctx.env.DB
    .prepare(
      `SELECT * FROM invoices WHERE business_id = ? AND sale_id = ? LIMIT 1`
    )
    .bind(businessId, saleId)
    .first()

  if (!invoice) {
    throw HttpError.notFound('Invoice for this sale not found.')
  }

  return jsonResponse(invoice, 200, ctx.requestId)
}

