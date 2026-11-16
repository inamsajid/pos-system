import type { RequestContext } from '../../router'
import { jsonResponse } from '../../lib/response'
import { parseJsonBody } from '../../lib/validation'
import {
  requireAuth,
  requireBusinessContext,
  requirePermission,
} from '../../middleware/authMiddleware'
import { SettingsService } from './settings.service'
import type { UpdateBusinessSettingsInput } from './settings.types'

export async function handleGetSettings(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('settings_read')(ctx)

  const businessId = ctx.tenant!.business.id
  const service = new SettingsService(ctx.env.DB)
  const settings = await service.getSettings(businessId)

  return jsonResponse(settings, 200, ctx.requestId)
}

export async function handleUpdateSettings(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  await requireBusinessContext(ctx)
  await requirePermission('manage_settings')(ctx)

  const businessId = ctx.tenant!.business.id
  const body = await parseJsonBody<UpdateBusinessSettingsInput>(ctx.req)

  const service = new SettingsService(ctx.env.DB)
  const updated = await service.updateSettings(businessId, body)

  return jsonResponse(updated, 200, ctx.requestId)
}

