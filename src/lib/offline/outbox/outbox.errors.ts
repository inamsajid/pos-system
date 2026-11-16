/**
 * Outbox Errors and Categorization.
 */

export type OutboxErrorCategory = 'retryable' | 'blocked_auth' | 'conflict' | 'rejected' | 'reconciliation_required'

export class OutboxError extends Error {
  readonly code: string
  readonly category: OutboxErrorCategory
  readonly details?: Record<string, unknown>

  constructor(message: string, code: string, category: OutboxErrorCategory, details?: Record<string, unknown>) {
    super(message)
    this.name = 'OutboxError'
    this.code = code
    this.category = category
    this.details = details
  }
}

export class OutboxValidationError extends OutboxError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 'rejected', details)
    this.name = 'OutboxValidationError'
  }
}

export class OutboxConflictError extends OutboxError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFLICT', 'conflict', details)
    this.name = 'OutboxConflictError'
  }
}

export class OutboxAuthBlockedError extends OutboxError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'AUTHENTICATION_REQUIRED', 'blocked_auth', details)
    this.name = 'OutboxAuthBlockedError'
  }
}

export class OutboxReconciliationRequiredError extends OutboxError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'RECONCILIATION_REQUIRED', 'reconciliation_required', details)
    this.name = 'OutboxReconciliationRequiredError'
  }
}

export class OutboxRetryableError extends OutboxError {
  readonly retryAfterSeconds?: number

  constructor(message: string, code = 'RETRYABLE_ERROR', retryAfterSeconds?: number, details?: Record<string, unknown>) {
    super(message, code, 'retryable', details)
    this.name = 'OutboxRetryableError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export class OutboxPayloadTamperedError extends OutboxError {
  constructor(message: string = 'Command payload hash does not match stored hash.') {
    super(message, 'PAYLOAD_TAMPERED', 'rejected')
    this.name = 'OutboxPayloadTamperedError'
  }
}

export class OutboxLeaseExpiredError extends OutboxError {
  constructor(message: string = 'Command lease has expired or was claimed by another worker.') {
    super(message, 'LEASE_EXPIRED', 'retryable')
    this.name = 'OutboxLeaseExpiredError'
  }
}

/**
 * Classifies an unknown error into the appropriate outbox category.
 */
export function categorizeError(error: unknown): {
  category: OutboxErrorCategory
  code: string
  message: string
  retryAfterSeconds?: number
  httpStatus?: number
} {
  if (error instanceof OutboxError) {
    return {
      category: error.category,
      code: error.code,
      message: error.message,
      retryAfterSeconds: error instanceof OutboxRetryableError ? error.retryAfterSeconds : undefined,
    }
  }

  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>
    const status = typeof err.status === 'number' ? err.status : undefined
    const message = typeof err.message === 'string' ? err.message : 'Unknown error'
    const code = typeof err.code === 'string' ? err.code : 'UNKNOWN'

    // HTTP 401: Auth Blocked
    if (status === 401 || code === 'AUTHENTICATION_REQUIRED') {
      return { category: 'blocked_auth', code: 'AUTHENTICATION_REQUIRED', message, httpStatus: status }
    }

    // HTTP 409: Conflict
    if (status === 409 || code === 'CONFLICT' || message.includes('VERSION_CONFLICT')) {
      return { category: 'conflict', code: 'CONFLICT', message, httpStatus: status }
    }

    // HTTP 403 or Explicit Reconciliation Flag
    if (status === 403 || code === 'RECONCILIATION_REQUIRED' || code === 'DEVICE_REVOKED') {
      return { category: 'reconciliation_required', code: code || 'FORBIDDEN_RECONCILIATION', message, httpStatus: status }
    }

    // HTTP 400 or 404: Permanent Validation Rejection
    if (status === 400 || status === 404 || code === 'VALIDATION_ERROR') {
      return {
        category: 'rejected',
        code: code !== 'UNKNOWN' ? code : status === 400 ? 'BAD_REQUEST' : 'VALIDATION_ERROR',
        message,
        httpStatus: status,
      }
    }

    // HTTP 429: Rate Limited (Retryable)
    if (status === 429) {
      const retryAfter = typeof err.retryAfter === 'number' ? err.retryAfter : undefined
      return { category: 'retryable', code: 'RATE_LIMITED', message, retryAfterSeconds: retryAfter, httpStatus: status }
    }

    // HTTP 408 / 5xx: Retryable
    if (status === 408 || (status && status >= 500 && status <= 599)) {
      return { category: 'retryable', code: `HTTP_${status}`, message, httpStatus: status }
    }

    // Network / Fetch errors
    const lowerMsg = message.toLowerCase()
    if (
      lowerMsg.includes('failed to fetch') ||
      lowerMsg.includes('networkerror') ||
      lowerMsg.includes('network request failed') ||
      lowerMsg.includes('timeout') ||
      lowerMsg.includes('abort') ||
      lowerMsg.includes('connection refused')
    ) {
      return { category: 'retryable', code: 'NETWORK_ERROR', message, httpStatus: status }
    }
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { category: 'retryable', code: 'OFFLINE', message: 'Terminal is currently offline.' }
  }

  return { category: 'rejected', code: 'UNHANDLED_ERROR', message: String(error) }
}

