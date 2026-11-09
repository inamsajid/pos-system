import { HttpError } from './errors'

export interface SuccessEnvelope<T> {
  success: true
  data: T
  meta?: Record<string, unknown>
  requestId?: string
}

export interface ErrorEnvelope {
  success: false
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
  requestId: string
}

export function jsonResponse<T>(
  data: T,
  status: number = 200,
  requestId?: string,
  meta?: Record<string, unknown>,
  extraHeaders?: Record<string, string>
): Response {
  const envelope: SuccessEnvelope<T> = {
    success: true,
    data,
  }

  if (meta) {
    envelope.meta = meta
  }

  if (requestId) {
    envelope.requestId = requestId
  }

  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, private',
    ...extraHeaders,
  })

  if (requestId) {
    headers.set('X-Request-Id', requestId)
  }

  return new Response(JSON.stringify(envelope), {
    status,
    headers,
  })
}

export function errorResponse(error: unknown, requestId: string): Response {
  let status = 500
  let code = 'INTERNAL_SERVER_ERROR'
  let message = 'An unexpected error occurred.'
  let details: Record<string, unknown> | undefined

  if (error instanceof HttpError) {
    status = error.status
    code = error.code
    message = error.message
    details = error.details
  } else if (error instanceof Error) {
    // For standard unhandled errors, log to server console but do not leak internals
    console.error(`[Unhandled Worker Error] [RequestId: ${requestId}]:`, error)
  }

  const envelope: ErrorEnvelope = {
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
    requestId,
  }

  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, private',
    'X-Request-Id': requestId,
  })

  if (status === 429 && details?.retryAfter !== undefined) {
    headers.set('Retry-After', String(details.retryAfter))
  }

  return new Response(JSON.stringify(envelope), {
    status,
    headers,
  })
}

