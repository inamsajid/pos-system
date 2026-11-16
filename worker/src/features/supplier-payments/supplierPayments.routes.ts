import type { RequestContext } from '../../router'
import { jsonResponse } from '../../lib/response'
import { parseJsonBody } from '../../lib/validation'
import {
  requireAuth,
  requireBusinessContext,
  requirePermission,
  requireAnyPermission,
} from '../../middleware/authMiddleware'
import { resolveAuthorizedBranchIds, resolveBranchContext } from '../../auth/tenantContext'
import { SupplierPaymentsService } from './supplierPayments.service'
import {
  validateCreateSupplierPaymentInput,
  validateAllocateSupplierAdvanceInput,
  parseSupplierPaymentQueryParams,
} from './supplierPayments.validation'

export async function handleListSupplierPayments(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requireAnyPermission('disburse_payments', 'reports_view')(ctx)

  const businessId = ctx.tenant!.business.id
  const filters = parseSupplierPaymentQueryParams(ctx.url)

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new SupplierPaymentsService(ctx.env.DB)
  const result = await service.listPayments(businessId, filters, authorizedBranchIds)

  return jsonResponse(result.payments, 200, ctx.requestId, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  })
}

export async function handleGetSupplierPayment(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requireAnyPermission('disburse_payments', 'reports_view')(ctx)

  const businessId = ctx.tenant!.business.id
  const paymentId = ctx.params.id

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new SupplierPaymentsService(ctx.env.DB)
  const payment = await service.getPaymentById(businessId, paymentId, authorizedBranchIds)

  return jsonResponse(payment, 200, ctx.requestId)
}

export async function handleCreateSupplierPayment(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('disburse_payments')(ctx)

  const body = await parseJsonBody(ctx.req)
  const input = validateCreateSupplierPaymentInput(body)

  const businessId = ctx.tenant!.business.id
  const requestedBranchId = ctx.req.headers.get('X-Branch-Id') || input.branchId

  const branch = await resolveBranchContext(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    requestedBranchId
  )

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    requestedBranchId
  )

  const idempotencyKey = ctx.req.headers.get('Idempotency-Key')
  const service = new SupplierPaymentsService(ctx.env.DB)

  const payment = await service.createPayment(
    businessId,
    branch.id,
    ctx.auth!.user.id,
    input,
    idempotencyKey,
    authorizedBranchIds
  )

  return jsonResponse(payment, 201, ctx.requestId)
}

export async function handleGetSupplierPaymentAllocations(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requireAnyPermission('disburse_payments', 'reports_view')(ctx)

  const businessId = ctx.tenant!.business.id
  const paymentId = ctx.params.id

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new SupplierPaymentsService(ctx.env.DB)
  const payment = await service.getPaymentById(businessId, paymentId, authorizedBranchIds)

  return jsonResponse(payment.allocations || [], 200, ctx.requestId)
}

export async function handleAllocateSupplierAdvance(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('disburse_payments')(ctx)

  const businessId = ctx.tenant!.business.id
  const paymentId = ctx.params.id
  const body = await parseJsonBody(ctx.req)
  const input = validateAllocateSupplierAdvanceInput(body)

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const idempotencyKey = ctx.req.headers.get('Idempotency-Key')
  const service = new SupplierPaymentsService(ctx.env.DB)

  const payment = await service.allocateAdvance(
    businessId,
    paymentId,
    ctx.auth!.user.id,
    input,
    idempotencyKey,
    authorizedBranchIds
  )

  return jsonResponse(payment, 200, ctx.requestId)
}

