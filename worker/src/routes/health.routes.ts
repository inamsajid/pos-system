import type { RouteHandler } from '../router'
import { jsonResponse } from '../lib/response'
import { HttpError } from '../lib/errors'
import { checkDatabaseConnectivity } from '../db/client'
import { getConfig } from '../config/environment'

export const handleHealth: RouteHandler = async (ctx) => {
  const config = getConfig(ctx.env)
  return jsonResponse(
    {
      status: 'healthy',
      service: config.serviceName,
      version: config.apiVersion,
    },
    200,
    ctx.requestId
  )
}

export const handleReadiness: RouteHandler = async (ctx) => {
  const health = await checkDatabaseConnectivity(ctx.env.DB)

  if (!health.connected) {
    throw HttpError.serviceUnavailable('Database connectivity check failed.')
  }

  return jsonResponse(
    {
      status: 'ready',
      database: 'connected',
    },
    200,
    ctx.requestId
  )
}

