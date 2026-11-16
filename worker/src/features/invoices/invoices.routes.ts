import type { RequestContext } from '../../router'
import { jsonResponse } from '../../lib/response'
import {
  requireAuth,
  requireBusinessContext,
  requirePermission,
} from '../../middleware/authMiddleware'
import { resolveAuthorizedBranchIds } from '../../auth/tenantContext'
import { InvoicesService } from './invoices.service'
import { parseInvoiceQueryParams } from './invoices.validation'

export async function handleListInvoices(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('sales_read')(ctx)

  const businessId = ctx.tenant!.business.id
  const filters = parseInvoiceQueryParams(ctx.url)

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new InvoicesService(ctx.env.DB)
  const result = await service.listInvoices(businessId, filters, authorizedBranchIds)

  return jsonResponse(
    result.items,
    200,
    ctx.requestId,
    result.meta as unknown as Record<string, unknown>
  )
}

export async function handleGetInvoice(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('sales_read')(ctx)

  const businessId = ctx.tenant!.business.id
  const invoiceId = ctx.params.id

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new InvoicesService(ctx.env.DB)
  const invoice = await service.getInvoiceById(businessId, invoiceId, authorizedBranchIds)

  return jsonResponse(invoice, 200, ctx.requestId)
}

export async function handleGetInvoiceSale(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('sales_read')(ctx)

  const businessId = ctx.tenant!.business.id
  const invoiceId = ctx.params.id

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new InvoicesService(ctx.env.DB)
  const sale = await service.getSaleForInvoice(businessId, invoiceId, authorizedBranchIds)

  return jsonResponse(sale, 200, ctx.requestId)
}

