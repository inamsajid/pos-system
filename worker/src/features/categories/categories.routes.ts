import type { RequestContext } from '../../router'
import { jsonResponse } from '../../lib/response'
import { parseJsonBody } from '../../lib/validation'
import {
  requireAuth,
  requireBusinessContext,
  requirePermission,
} from '../../middleware/authMiddleware'
import { resolveAuthorizedBranchIds } from '../../auth/tenantContext'
import { CategoriesService } from './categories.service'
import {
  validateCreateCategoryInput,
  validateUpdateCategoryInput,
  validateReplaceCategoryInput,
} from './categories.validation'
import type { CategoryStatus } from './categories.types'

export async function handleListCategories(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('catalog_read')(ctx)

  const businessId = ctx.tenant!.business.id
  const statusParam = ctx.url.searchParams.get('status')
  const parentIdParam = ctx.url.searchParams.get('parentId')

  let status: CategoryStatus | 'all' = 'all'
  if (statusParam === 'active' || statusParam === 'archived') {
    status = statusParam
  }

  const parentId = parentIdParam !== null ? parentIdParam : undefined

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new CategoriesService(ctx.env.DB)
  const categories = await service.listCategories(
    businessId,
    { status, parentId },
    authorizedBranchIds
  )

  return jsonResponse(categories, 200, ctx.requestId)
}

export async function handleGetCategory(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('catalog_read')(ctx)

  const businessId = ctx.tenant!.business.id
  const categoryId = ctx.params.id

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new CategoriesService(ctx.env.DB)
  const category = await service.getCategoryById(businessId, categoryId, authorizedBranchIds)

  return jsonResponse(category, 200, ctx.requestId)
}

export async function handleCreateCategory(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('catalog_write')(ctx)

  const businessId = ctx.tenant!.business.id
  const body = await parseJsonBody(ctx.req)
  const input = validateCreateCategoryInput(body)

  const service = new CategoriesService(ctx.env.DB)
  const created = await service.createCategory(businessId, input)

  return jsonResponse(created, 201, ctx.requestId)
}

export async function handleReplaceCategory(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('catalog_write')(ctx)

  const businessId = ctx.tenant!.business.id
  const categoryId = ctx.params.id
  const body = await parseJsonBody(ctx.req)
  const input = validateReplaceCategoryInput(body)

  const service = new CategoriesService(ctx.env.DB)
  const replaced = await service.replaceCategory(businessId, categoryId, input)

  return jsonResponse(replaced, 200, ctx.requestId)
}

export async function handleUpdateCategory(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('catalog_write')(ctx)

  const businessId = ctx.tenant!.business.id
  const categoryId = ctx.params.id
  const body = await parseJsonBody(ctx.req)
  const input = validateUpdateCategoryInput(body)

  const service = new CategoriesService(ctx.env.DB)
  const updated = await service.updateCategory(businessId, categoryId, input)

  return jsonResponse(updated, 200, ctx.requestId)
}

export async function handleArchiveCategory(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('catalog_write')(ctx)

  const businessId = ctx.tenant!.business.id
  const categoryId = ctx.params.id

  const service = new CategoriesService(ctx.env.DB)
  const result = await service.archiveCategory(businessId, categoryId)

  return jsonResponse(result, 200, ctx.requestId)
}

