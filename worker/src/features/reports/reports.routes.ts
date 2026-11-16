import type { RequestContext } from '../../router'
import {
  requireAuth,
  requireBusinessContext,
  requirePermission,
} from '../../middleware/authMiddleware'
import { resolveAuthorizedBranchIds } from '../../auth/tenantContext'
import { jsonResponse } from '../../lib/response'
import { ReportsService } from './reports.service'

const reportsService = new ReportsService()

function extractQueryParam(ctx: RequestContext, name: string): string | null {
  return ctx.url.searchParams.get(name)
}

/**
 * GET /api/v1/reports/dashboard
 */
export async function handleGetDashboard(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('reports_view')(ctx)

  const businessId = ctx.tenant!.business.id
  const role = ctx.tenant!.membership.role
  const fromDate = extractQueryParam(ctx, 'fromDate')
  const toDate = extractQueryParam(ctx, 'toDate')
  const branchId = extractQueryParam(ctx, 'branchId') || ctx.req.headers.get('X-Branch-Id')

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    role,
    branchId
  )

  const result = await reportsService.getDashboardReport(
    ctx.env,
    businessId,
    role,
    authorizedBranchIds,
    fromDate,
    toDate,
    branchId
  )

  return jsonResponse(result, 200, ctx.requestId)
}

/**
 * GET /api/v1/reports/sales/summary
 */
export async function handleGetSalesSummary(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('reports_view')(ctx)

  const businessId = ctx.tenant!.business.id
  const role = ctx.tenant!.membership.role
  const fromDate = extractQueryParam(ctx, 'fromDate')
  const toDate = extractQueryParam(ctx, 'toDate')
  const branchId = extractQueryParam(ctx, 'branchId') || ctx.req.headers.get('X-Branch-Id')

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    role,
    branchId
  )

  const result = await reportsService.getSalesSummary(
    ctx.env,
    businessId,
    role,
    authorizedBranchIds,
    fromDate,
    toDate,
    branchId
  )

  return jsonResponse(result, 200, ctx.requestId)
}

/**
 * GET /api/v1/reports/sales/trends
 */
export async function handleGetSalesTrends(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('reports_view')(ctx)

  const businessId = ctx.tenant!.business.id
  const role = ctx.tenant!.membership.role
  const fromDate = extractQueryParam(ctx, 'fromDate')
  const toDate = extractQueryParam(ctx, 'toDate')
  const branchId = extractQueryParam(ctx, 'branchId') || ctx.req.headers.get('X-Branch-Id')
  const interval = (extractQueryParam(ctx, 'interval') || 'daily') as 'daily' | 'monthly'

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    role,
    branchId
  )

  const result = await reportsService.getSalesTrends(
    ctx.env,
    businessId,
    role,
    authorizedBranchIds,
    fromDate,
    toDate,
    branchId,
    interval
  )

  return jsonResponse(result, 200, ctx.requestId)
}

/**
 * GET /api/v1/reports/sales/by-product
 */
export async function handleGetSalesByProduct(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('reports_view')(ctx)

  const businessId = ctx.tenant!.business.id
  const role = ctx.tenant!.membership.role
  const fromDate = extractQueryParam(ctx, 'fromDate')
  const toDate = extractQueryParam(ctx, 'toDate')
  const branchId = extractQueryParam(ctx, 'branchId') || ctx.req.headers.get('X-Branch-Id')
  const categoryId = extractQueryParam(ctx, 'categoryId') || undefined
  const limit = extractQueryParam(ctx, 'limit') ? Number(extractQueryParam(ctx, 'limit')) : 50

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    role,
    branchId
  )

  const result = await reportsService.getSalesByProduct(
    ctx.env,
    businessId,
    role,
    authorizedBranchIds,
    fromDate,
    toDate,
    branchId,
    limit,
    categoryId
  )

  return jsonResponse(result, 200, ctx.requestId)
}

/**
 * GET /api/v1/reports/sales/by-category
 */
export async function handleGetSalesByCategory(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('reports_view')(ctx)

  const businessId = ctx.tenant!.business.id
  const role = ctx.tenant!.membership.role
  const fromDate = extractQueryParam(ctx, 'fromDate')
  const toDate = extractQueryParam(ctx, 'toDate')
  const branchId = extractQueryParam(ctx, 'branchId') || ctx.req.headers.get('X-Branch-Id')

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    role,
    branchId
  )

  const result = await reportsService.getSalesByCategory(
    ctx.env,
    businessId,
    role,
    authorizedBranchIds,
    fromDate,
    toDate,
    branchId
  )

  return jsonResponse(result, 200, ctx.requestId)
}

/**
 * GET /api/v1/reports/payments/summary
 */
export async function handleGetPaymentsSummary(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('reports_view')(ctx)

  const businessId = ctx.tenant!.business.id
  const role = ctx.tenant!.membership.role
  const fromDate = extractQueryParam(ctx, 'fromDate')
  const toDate = extractQueryParam(ctx, 'toDate')
  const branchId = extractQueryParam(ctx, 'branchId') || ctx.req.headers.get('X-Branch-Id')

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    role,
    branchId
  )

  const result = await reportsService.getPaymentsSummary(
    ctx.env,
    businessId,
    role,
    authorizedBranchIds,
    fromDate,
    toDate,
    branchId
  )

  return jsonResponse(result, 200, ctx.requestId)
}

/**
 * GET /api/v1/reports/payments/by-method
 */
export async function handleGetPaymentsByMethod(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('reports_view')(ctx)

  const businessId = ctx.tenant!.business.id
  const role = ctx.tenant!.membership.role
  const fromDate = extractQueryParam(ctx, 'fromDate')
  const toDate = extractQueryParam(ctx, 'toDate')
  const branchId = extractQueryParam(ctx, 'branchId') || ctx.req.headers.get('X-Branch-Id')

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    role,
    branchId
  )

  const result = await reportsService.getPaymentsByMethod(
    ctx.env,
    businessId,
    role,
    authorizedBranchIds,
    fromDate,
    toDate,
    branchId
  )

  return jsonResponse(result, 200, ctx.requestId)
}

/**
 * GET /api/v1/reports/purchases/summary
 */
export async function handleGetPurchasesSummary(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('reports_view')(ctx)

  const businessId = ctx.tenant!.business.id
  const role = ctx.tenant!.membership.role
  const fromDate = extractQueryParam(ctx, 'fromDate')
  const toDate = extractQueryParam(ctx, 'toDate')
  const branchId = extractQueryParam(ctx, 'branchId') || ctx.req.headers.get('X-Branch-Id')

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    role,
    branchId
  )

  const result = await reportsService.getPurchasesSummary(
    ctx.env,
    businessId,
    role,
    authorizedBranchIds,
    fromDate,
    toDate,
    branchId
  )

  return jsonResponse(result, 200, ctx.requestId)
}

/**
 * GET /api/v1/reports/purchases/trends
 */
export async function handleGetPurchasesTrends(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('reports_view')(ctx)

  const businessId = ctx.tenant!.business.id
  const role = ctx.tenant!.membership.role
  const fromDate = extractQueryParam(ctx, 'fromDate')
  const toDate = extractQueryParam(ctx, 'toDate')
  const branchId = extractQueryParam(ctx, 'branchId') || ctx.req.headers.get('X-Branch-Id')
  const interval = (extractQueryParam(ctx, 'interval') || 'daily') as 'daily' | 'monthly'

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    role,
    branchId
  )

  const result = await reportsService.getPurchasesTrends(
    ctx.env,
    businessId,
    role,
    authorizedBranchIds,
    fromDate,
    toDate,
    branchId,
    interval
  )

  return jsonResponse(result, 200, ctx.requestId)
}

/**
 * GET /api/v1/reports/suppliers/payables
 */
export async function handleGetSupplierPayables(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('reports_view')(ctx)

  const businessId = ctx.tenant!.business.id
  const role = ctx.tenant!.membership.role
  const branchId = extractQueryParam(ctx, 'branchId') || ctx.req.headers.get('X-Branch-Id')

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    role,
    branchId
  )

  const result = await reportsService.getSupplierPayables(
    ctx.env,
    businessId,
    role,
    authorizedBranchIds,
    branchId
  )
  return jsonResponse(result, 200, ctx.requestId)
}

/**
 * GET /api/v1/reports/inventory/summary
 */
export async function handleGetInventorySummary(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('reports_view')(ctx)

  const businessId = ctx.tenant!.business.id
  const role = ctx.tenant!.membership.role
  const branchId = extractQueryParam(ctx, 'branchId') || ctx.req.headers.get('X-Branch-Id')

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    role,
    branchId
  )

  const result = await reportsService.getInventorySummary(
    ctx.env,
    businessId,
    role,
    authorizedBranchIds,
    branchId
  )

  return jsonResponse(result, 200, ctx.requestId)
}

/**
 * GET /api/v1/reports/inventory/movements
 */
export async function handleGetInventoryMovements(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('reports_view')(ctx)

  const businessId = ctx.tenant!.business.id
  const role = ctx.tenant!.membership.role
  const fromDate = extractQueryParam(ctx, 'fromDate')
  const toDate = extractQueryParam(ctx, 'toDate')
  const branchId = extractQueryParam(ctx, 'branchId') || ctx.req.headers.get('X-Branch-Id')
  const productId = extractQueryParam(ctx, 'productId') || undefined
  const type = extractQueryParam(ctx, 'type') || undefined
  const limit = extractQueryParam(ctx, 'limit') ? Number(extractQueryParam(ctx, 'limit')) : 50
  const offset = extractQueryParam(ctx, 'offset') ? Number(extractQueryParam(ctx, 'offset')) : 0

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    role,
    branchId
  )

  const result = await reportsService.getInventoryMovements(
    ctx.env,
    businessId,
    role,
    authorizedBranchIds,
    fromDate,
    toDate,
    branchId,
    productId,
    type,
    limit,
    offset
  )

  return jsonResponse(result.items, 200, ctx.requestId, {
    total: result.total,
    limit,
    offset,
  })
}

/**
 * GET /api/v1/reports/inventory/low-stock
 */
export async function handleGetLowStock(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('reports_view')(ctx)

  const businessId = ctx.tenant!.business.id
  const role = ctx.tenant!.membership.role
  const branchId = extractQueryParam(ctx, 'branchId') || ctx.req.headers.get('X-Branch-Id')
  const limit = extractQueryParam(ctx, 'limit') ? Number(extractQueryParam(ctx, 'limit')) : 50
  const offset = extractQueryParam(ctx, 'offset') ? Number(extractQueryParam(ctx, 'offset')) : 0

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    role,
    branchId
  )

  const result = await reportsService.getLowStockReport(
    ctx.env,
    businessId,
    role,
    authorizedBranchIds,
    branchId,
    limit,
    offset
  )

  return jsonResponse(result.items, 200, ctx.requestId, {
    total: result.total,
    limit,
    offset,
  })
}

/**
 * GET /api/v1/reports/inventory/valuation
 */
export async function handleGetInventoryValuation(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('reports_view')(ctx)

  const businessId = ctx.tenant!.business.id
  const role = ctx.tenant!.membership.role
  const branchId = extractQueryParam(ctx, 'branchId') || ctx.req.headers.get('X-Branch-Id')

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    role,
    branchId
  )

  const result = await reportsService.getInventoryValuation(
    ctx.env,
    businessId,
    role,
    authorizedBranchIds,
    branchId
  )

  return jsonResponse(result, 200, ctx.requestId)
}

/**
 * GET /api/v1/reports/customers/receivables
 */
export async function handleGetCustomerReceivables(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('reports_view')(ctx)

  const businessId = ctx.tenant!.business.id
  const role = ctx.tenant!.membership.role
  const branchId = extractQueryParam(ctx, 'branchId') || ctx.req.headers.get('X-Branch-Id')

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    role,
    branchId
  )

  const result = await reportsService.getCustomerReceivables(
    ctx.env,
    businessId,
    role,
    authorizedBranchIds,
    branchId
  )
  return jsonResponse(result, 200, ctx.requestId)
}

/**
 * GET /api/v1/reports/export
 * Downloads or exports report to CSV.
 */
export async function handleExportCsv(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('reports_view')(ctx)

  const businessId = ctx.tenant!.business.id
  const role = ctx.tenant!.membership.role
  const reportType = extractQueryParam(ctx, 'reportType') || 'sales'
  const fromDate = extractQueryParam(ctx, 'fromDate')
  const toDate = extractQueryParam(ctx, 'toDate')
  const branchId = extractQueryParam(ctx, 'branchId') || ctx.req.headers.get('X-Branch-Id')

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    role,
    branchId
  )

  const { csvContent, filename, rowCount } = await reportsService.exportReportCsv(
    ctx.env,
    businessId,
    role,
    authorizedBranchIds,
    reportType,
    fromDate,
    toDate,
    branchId
  )

  const headers = new Headers({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-cache, no-store, must-revalidate',
    'X-Row-Count': rowCount.toString(),
  })

  if (ctx.requestId) {
    headers.set('X-Request-Id', ctx.requestId)
  }

  return new Response(csvContent, {
    status: 200,
    headers,
  })
}
