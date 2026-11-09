export type StandardErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INSUFFICIENT_STOCK'
  | 'ALLOCATION_EXCEEDS_BALANCE'
  | 'DATABASE_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'INTERNAL_SERVER_ERROR'

export class HttpError extends Error {
  readonly status: number
  readonly code: StandardErrorCode
  readonly details?: Record<string, unknown>

  constructor(status: number, code: StandardErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.details = details
  }

  static badRequest(message: string, details?: Record<string, unknown>): HttpError {
    return new HttpError(400, 'VALIDATION_ERROR', message, details)
  }

  static unauthorized(message: string = 'Authentication required.'): HttpError {
    return new HttpError(401, 'AUTHENTICATION_REQUIRED', message)
  }

  static forbidden(message: string = 'Access denied.'): HttpError {
    return new HttpError(403, 'FORBIDDEN', message)
  }

  static notFound(message: string = 'Resource not found.'): HttpError {
    return new HttpError(404, 'NOT_FOUND', message)
  }

  static conflict(message: string, details?: Record<string, unknown>): HttpError {
    return new HttpError(409, 'CONFLICT', message, details)
  }

  static tooManyRequests(message: string = 'Too many requests. Please try again later.', retryAfter: number = 60, details?: Record<string, unknown>): HttpError {
    return new HttpError(429, 'RATE_LIMITED', message, { retryAfter, ...details })
  }

  static serviceUnavailable(message: string = 'Service temporarily unavailable.'): HttpError {
    return new HttpError(503, 'DATABASE_UNAVAILABLE', message)
  }

  static internal(message: string = 'An unexpected error occurred.'): HttpError {
    return new HttpError(500, 'INTERNAL_SERVER_ERROR', message)
  }
}

