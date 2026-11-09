import type { RequestContext } from '../../router'
import { jsonResponse } from '../../lib/response'
import { parseJsonBody } from '../../lib/validation'
import {
  requireAuth,
  requireBusinessContext,
} from '../../middleware/authMiddleware'
import { SuppliersService } from './suppliers.service'
import {
  parseSupplierQueryParams,
  validateCreateSupplier,
  validateUpdateSupplier,
  validateAddSupplierProduct,
} from './suppliers.validation'

export async function handleListSuppliers(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const businessId = ctx.tenant!.business.id
  const filters = parseSupplierQueryParams(ctx.url)

  const service = new SuppliersService(ctx.env.DB)
  const result = await service.listSuppliers(businessId, filters)

  return jsonResponse(
    result.items,
    200,
    ctx.requestId,
    result.meta as unknown as Record<string, unknown>
  )
}

export async function handleGetSupplier(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const businessId = ctx.tenant!.business.id
  const supplierId = ctx.params.id

  const service = new SuppliersService(ctx.env.DB)
  const supplier = await service.getSupplierById(businessId, supplierId)

  return jsonResponse(supplier, 200, ctx.requestId)
}

export async function handleCreateSupplier(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const businessId = ctx.tenant!.business.id
  const body = await parseJsonBody(ctx.req)
  const input = validateCreateSupplier(body)

  const service = new SuppliersService(ctx.env.DB)
  const supplier = await service.createSupplier(businessId, input)

  return jsonResponse(supplier, 201, ctx.requestId)
}

export async function handleUpdateSupplier(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const businessId = ctx.tenant!.business.id
  const supplierId = ctx.params.id
  const body = await parseJsonBody(ctx.req)
  const input = validateUpdateSupplier(body)

  const service = new SuppliersService(ctx.env.DB)
  const supplier = await service.updateSupplier(businessId, supplierId, input)

  return jsonResponse(supplier, 200, ctx.requestId)
}

export async function handleUpdateSupplierStatus(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const businessId = ctx.tenant!.business.id
  const supplierId = ctx.params.id
  const body = await parseJsonBody<{ status: 'active' | 'inactive' | 'archived' }>(ctx.req)

  if (!body || !body.status || !['active', 'inactive', 'archived'].includes(body.status)) {
    return jsonResponse({ error: 'Valid status is required' }, 400, ctx.requestId)
  }

  const service = new SuppliersService(ctx.env.DB)
  const supplier = await service.updateSupplierStatus(businessId, supplierId, body.status)

  return jsonResponse(supplier, 200, ctx.requestId)
}

export async function handleArchiveSupplier(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const businessId = ctx.tenant!.business.id
  const supplierId = ctx.params.id

  const service = new SuppliersService(ctx.env.DB)
  const supplier = await service.archiveSupplier(businessId, supplierId)

  return jsonResponse(supplier, 200, ctx.requestId)
}

export async function handleListSupplierProducts(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const businessId = ctx.tenant!.business.id
  const supplierId = ctx.params.id

  const service = new SuppliersService(ctx.env.DB)
  const products = await service.listSupplierProducts(businessId, supplierId)

  return jsonResponse(products, 200, ctx.requestId)
}

export async function handleAddSupplierProduct(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const businessId = ctx.tenant!.business.id
  const supplierId = ctx.params.id
  const body = await parseJsonBody(ctx.req)
  const input = validateAddSupplierProduct(body)

  const service = new SuppliersService(ctx.env.DB)
  const association = await service.addSupplierProduct(businessId, supplierId, input)

  return jsonResponse(association, 201, ctx.requestId)
}
