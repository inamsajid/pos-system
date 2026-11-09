import type { RequestContext } from '../../router'
import { jsonResponse } from '../../lib/response'
import { parseJsonBody } from '../../lib/validation'
import {
  requireAuth,
  requireBusinessContext,
} from '../../middleware/authMiddleware'
import { CustomersService } from './customers.service'
import {
  validateCreateCustomer,
  validateUpdateCustomer,
  parseCustomerQueryParams,
} from './customers.validation'

export async function handleListCustomers(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const businessId = ctx.tenant!.business.id
  const filters = parseCustomerQueryParams(ctx.url)

  const service = new CustomersService(ctx.env.DB)
  const result = await service.listCustomers(businessId, filters)

  return jsonResponse(
    result.items,
    200,
    ctx.requestId,
    result.meta as unknown as Record<string, unknown>
  )
}

export async function handleGetCustomer(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const businessId = ctx.tenant!.business.id
  const customerId = ctx.params.id

  const service = new CustomersService(ctx.env.DB)
  const customer = await service.getCustomerById(businessId, customerId)

  return jsonResponse(customer, 200, ctx.requestId)
}

export async function handleCreateCustomer(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const businessId = ctx.tenant!.business.id
  const body = await parseJsonBody(ctx.req)
  const input = validateCreateCustomer(body)

  const service = new CustomersService(ctx.env.DB)
  const customer = await service.createCustomer(businessId, input)

  return jsonResponse(customer, 201, ctx.requestId)
}

export async function handleUpdateCustomer(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const businessId = ctx.tenant!.business.id
  const customerId = ctx.params.id
  const body = await parseJsonBody(ctx.req)
  const input = validateUpdateCustomer(body)

  const service = new CustomersService(ctx.env.DB)
  const customer = await service.updateCustomer(businessId, customerId, input)

  return jsonResponse(customer, 200, ctx.requestId)
}

export async function handleUpdateCustomerStatus(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const businessId = ctx.tenant!.business.id
  const customerId = ctx.params.id
  const body = await parseJsonBody<{ status: 'active' | 'inactive' | 'archived' }>(ctx.req)

  if (!body || !body.status || !['active', 'inactive', 'archived'].includes(body.status)) {
    return jsonResponse({ error: 'Valid status is required' }, 400, ctx.requestId)
  }

  const service = new CustomersService(ctx.env.DB)
  const customer = await service.updateCustomerStatus(businessId, customerId, body.status)

  return jsonResponse(customer, 200, ctx.requestId)
}

export async function handleArchiveCustomer(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)

  const businessId = ctx.tenant!.business.id
  const customerId = ctx.params.id

  const service = new CustomersService(ctx.env.DB)
  const customer = await service.archiveCustomer(businessId, customerId)

  return jsonResponse(customer, 200, ctx.requestId)
}

