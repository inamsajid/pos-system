import type { RequestContext } from '../../router'
import { jsonResponse } from '../../lib/response'
import {
  requireAuth,
  requireBusinessContext,
  requirePermission,
  requireAnyPermission,
} from '../../middleware/authMiddleware'
import { resolveAuthorizedBranchIds } from '../../auth/tenantContext'
import { CustomerLedgerService } from './customerLedger.service'
import { parseCustomerLedgerQueryParams } from './customerLedger.validation'

export async function handleGetCustomerLedger(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('reports_view')(ctx)

  const businessId = ctx.tenant!.business.id
  const customerId = ctx.params.customerId
  const filters = parseCustomerLedgerQueryParams(ctx.url)

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new CustomerLedgerService(ctx.env.DB)
  const statement = await service.getCustomerLedgerStatement(
    businessId,
    customerId,
    filters,
    authorizedBranchIds
  )

  return jsonResponse(statement, 200, ctx.requestId)
}

export async function handleGetCustomerLedgerSummary(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requireAnyPermission('reports_view', 'collect_payments')(ctx)

  const businessId = ctx.tenant!.business.id
  const customerId = ctx.params.customerId

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new CustomerLedgerService(ctx.env.DB)
  const summary = await service.getCustomerFinancialSummary(
    businessId,
    customerId,
    authorizedBranchIds
  )

  return jsonResponse(summary, 200, ctx.requestId)
}

