import type { RequestContext } from '../../router'
import { jsonResponse } from '../../lib/response'
import { HttpError } from '../../lib/errors'
import {
  requireAuth,
  requireBusinessContext,
  requirePermission,
} from '../../middleware/authMiddleware'
import { resolveAuthorizedBranchIds } from '../../auth/tenantContext'
import { ExpensesService } from './expenses.service'
import {
  validateCreateExpenseInput,
  validateUpdateExpenseInput,
  validateVoidExpenseInput,
  validateCreateCategoryInput,
  validateUpdateCategoryInput,
  parseExpenseFilterParams,
} from './expenses.validation'

export async function handleListExpenses(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('expenses_read')(ctx)

  const businessId = ctx.tenant!.business.id
  const filters = parseExpenseFilterParams(ctx.url)

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new ExpensesService(ctx.env.DB)
  const result = await service.listExpenses(businessId, filters, authorizedBranchIds)

  return jsonResponse(result, 200, ctx.requestId)
}

export async function handleGetExpenseSummary(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('expenses_read')(ctx)

  const businessId = ctx.tenant!.business.id

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new ExpensesService(ctx.env.DB)
  const summary = await service.getSummary(businessId, authorizedBranchIds)

  return jsonResponse(summary, 200, ctx.requestId)
}

export async function handleGetExpense(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('expenses_read')(ctx)

  const businessId = ctx.tenant!.business.id
  const expenseId = ctx.params.id

  const service = new ExpensesService(ctx.env.DB)
  const expense = await service.getExpenseById(businessId, expenseId)

  return jsonResponse(expense, 200, ctx.requestId)
}

export async function handleCreateExpense(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('expenses_write')(ctx)

  const businessId = ctx.tenant!.business.id
  const userId = ctx.auth!.user.id
  const body = await ctx.req.json().catch(() => ({}))
  const input = validateCreateExpenseInput(body)
  const idempotencyKey = ctx.req.headers.get('Idempotency-Key')

  const authorizedBranchIds = await resolveAuthorizedBranchIds(
    ctx.env.DB,
    businessId,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    ctx.req.headers.get('X-Branch-Id')
  )

  const service = new ExpensesService(ctx.env.DB)
  const created = await service.createExpense(businessId, userId, input, authorizedBranchIds, idempotencyKey)

  return jsonResponse(created, 201, ctx.requestId)
}

export async function handleUpdateExpense(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('expenses_write')(ctx)

  const businessId = ctx.tenant!.business.id
  const userId = ctx.auth!.user.id
  const expenseId = ctx.params.id
  const body = await ctx.req.json().catch(() => ({}))
  const input = validateUpdateExpenseInput(body)

  const service = new ExpensesService(ctx.env.DB)
  const updated = await service.updateExpense(businessId, userId, expenseId, input)

  return jsonResponse(updated, 200, ctx.requestId)
}

export async function handleVoidExpense(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('expenses_write')(ctx)

  const role = ctx.tenant!.membership.role
  if (!['owner', 'admin', 'manager'].includes(role)) {
    throw HttpError.forbidden('Only owners, admins, and managers can void posted expenses.')
  }

  const businessId = ctx.tenant!.business.id
  const userId = ctx.auth!.user.id
  const expenseId = ctx.params.id
  const body = await ctx.req.json().catch(() => ({}))
  const input = validateVoidExpenseInput(body)

  const service = new ExpensesService(ctx.env.DB)
  const voided = await service.voidExpense(businessId, userId, expenseId, input)

  return jsonResponse(voided, 200, ctx.requestId)
}

export async function handleListExpenseCategories(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('expenses_read')(ctx)

  const businessId = ctx.tenant!.business.id
  const service = new ExpensesService(ctx.env.DB)
  const categories = await service.listCategories(businessId)

  return jsonResponse(categories, 200, ctx.requestId)
}

export async function handleCreateExpenseCategory(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('expenses_write')(ctx)

  const businessId = ctx.tenant!.business.id
  const body = await ctx.req.json().catch(() => ({}))
  const input = validateCreateCategoryInput(body)

  const service = new ExpensesService(ctx.env.DB)
  const created = await service.createCategory(businessId, input)

  return jsonResponse(created, 201, ctx.requestId)
}

export async function handleUpdateExpenseCategory(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('expenses_write')(ctx)

  const businessId = ctx.tenant!.business.id
  const categoryId = ctx.params.id
  const body = await ctx.req.json().catch(() => ({}))
  const input = validateUpdateCategoryInput(body)

  const service = new ExpensesService(ctx.env.DB)
  const updated = await service.updateCategory(businessId, categoryId, input)

  return jsonResponse(updated, 200, ctx.requestId)
}

export async function handleDeleteExpenseCategory(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('expenses_write')(ctx)

  const businessId = ctx.tenant!.business.id
  const categoryId = ctx.params.id

  const service = new ExpensesService(ctx.env.DB)
  const result = await service.deleteCategory(businessId, categoryId)

  return jsonResponse(result, 200, ctx.requestId)
}
