import type { RequestContext } from '../../router'
import { jsonResponse } from '../../lib/response'
import {
  requireAuth,
  requireBusinessContext,
} from '../../middleware/authMiddleware'
import { resolveAuthorizedBranchIds } from '../../auth/tenantContext'
import { SupplierLedgerService } from './supplierLedger.service'
import { parseSupplierLedgerQueryParams } from './supplierLedger.validation'

export async function handleGetSupplierLedger(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const businessId = ctx.tenant!.business.id
  const supplierId = ctx.params.supplierId
  const filters = parseSupplierLedgerQueryParams(ctx.url)

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new SupplierLedgerService(ctx.env.DB)
  const statement = await service.getSupplierLedgerStatement(
    businessId,
    supplierId,
    filters,
    authorizedBranchIds
  )

  return jsonResponse(statement, 200, ctx.requestId)
}

export async function handleGetSupplierLedgerSummary(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const businessId = ctx.tenant!.business.id
  const supplierId = ctx.params.supplierId

  const service = new SupplierLedgerService(ctx.env.DB)
  const summary = await service.getSupplierFinancialSummary(businessId, supplierId)

  return jsonResponse(summary, 200, ctx.requestId)
}

