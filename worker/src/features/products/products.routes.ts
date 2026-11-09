import type { RequestContext } from '../../router'
import { jsonResponse } from '../../lib/response'
import { parseJsonBody } from '../../lib/validation'
import {
  requireAuth,
  requireBusinessContext,
  requirePermission,
} from '../../middleware/authMiddleware'
import { resolveAuthorizedBranchIds } from '../../auth/tenantContext'
import { ProductsService } from './products.service'
import {
  validateCreateProductInput,
  validateUpdateProductInput,
  validateReplaceProductInput,
  parseProductQueryParams,
} from './products.validation'

export async function handleListProducts(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('catalog_read')(ctx)

  const businessId = ctx.tenant!.business.id
  const filters = parseProductQueryParams(ctx.url)

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new ProductsService(ctx.env.DB)
  const result = await service.listProducts(businessId, filters, authorizedBranchIds)

  return jsonResponse(
    result.items,
    200,
    ctx.requestId,
    result.meta as unknown as Record<string, unknown>
  )
}

export async function handleGetProduct(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('catalog_read')(ctx)

  const businessId = ctx.tenant!.business.id
  const productId = ctx.params.id

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new ProductsService(ctx.env.DB)
  const product = await service.getProductById(businessId, productId, authorizedBranchIds)

  return jsonResponse(product, 200, ctx.requestId)
}

export async function handleCreateProduct(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('catalog_write')(ctx)

  const businessId = ctx.tenant!.business.id
  const body = await parseJsonBody(ctx.req)
  const input = validateCreateProductInput(body)

  const service = new ProductsService(ctx.env.DB)
  const created = await service.createProduct(businessId, input)

  return jsonResponse(created, 201, ctx.requestId)
}

export async function handleReplaceProduct(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('catalog_write')(ctx)

  const businessId = ctx.tenant!.business.id
  const productId = ctx.params.id
  const body = await parseJsonBody(ctx.req)
  const input = validateReplaceProductInput(body)

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new ProductsService(ctx.env.DB)
  const replaced = await service.replaceProduct(businessId, productId, input, authorizedBranchIds)

  return jsonResponse(replaced, 200, ctx.requestId)
}

export async function handleUpdateProduct(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('catalog_write')(ctx)

  const businessId = ctx.tenant!.business.id
  const productId = ctx.params.id
  const body = await parseJsonBody(ctx.req)
  const input = validateUpdateProductInput(body)

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new ProductsService(ctx.env.DB)
  const updated = await service.updateProduct(businessId, productId, input, authorizedBranchIds)

  return jsonResponse(updated, 200, ctx.requestId)
}

export async function handleArchiveProduct(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('catalog_write')(ctx)

  const businessId = ctx.tenant!.business.id
  const productId = ctx.params.id

  const service = new ProductsService(ctx.env.DB)
  const result = await service.archiveProduct(businessId, productId)

  return jsonResponse(result, 200, ctx.requestId)
}

