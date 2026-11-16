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
import { CustomerPaymentsService } from './customerPayments.service'
import {
  validateCreateCustomerPaymentInput,
  validateAllocateAdvanceInput,
  parseCustomerPaymentQueryParams,
} from './customerPayments.validation'

export async function handleListPayments(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requireAnyPermission('collect_payments', 'reports_view')(ctx)

  const businessId = ctx.tenant!.business.id
  const filters = parseCustomerPaymentQueryParams(ctx.url)

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new CustomerPaymentsService(ctx.env.DB)
  const result = await service.listPayments(businessId, filters, authorizedBranchIds)

  return jsonResponse(
    result.items,
    200,
    ctx.requestId,
    result.meta as unknown as Record<string, unknown>
  )
}

export async function handleGetPayment(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requireAnyPermission('collect_payments', 'reports_view')(ctx)

  const businessId = ctx.tenant!.business.id
  const paymentId = ctx.params.id

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new CustomerPaymentsService(ctx.env.DB)
  const payment = await service.getPaymentById(businessId, paymentId, authorizedBranchIds)

  return jsonResponse(payment, 200, ctx.requestId)
}

export async function handleCreatePayment(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('collect_payments')(ctx)

  const body = await parseJsonBody(ctx.req)
  const input = validateCreateCustomerPaymentInput(body)

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
  const service = new CustomerPaymentsService(ctx.env.DB)

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

export async function handleGetPaymentAllocations(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requireAnyPermission('collect_payments', 'reports_view')(ctx)

  const businessId = ctx.tenant!.business.id
  const paymentId = ctx.params.id

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new CustomerPaymentsService(ctx.env.DB)
  const allocations = await service.getPaymentAllocations(businessId, paymentId, authorizedBranchIds)

  return jsonResponse(allocations, 200, ctx.requestId)
}

export async function handleAllocateAdvance(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('collect_payments')(ctx)

  const businessId = ctx.tenant!.business.id
  const paymentId = ctx.params.id
  const body = await parseJsonBody(ctx.req)
  const input = validateAllocateAdvanceInput(body)

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new CustomerPaymentsService(ctx.env.DB)
  const payment = await service.allocateAdvance(
    businessId,
    paymentId,
    ctx.auth!.user.id,
    input,
    authorizedBranchIds
  )

  return jsonResponse(payment, 200, ctx.requestId)
}

