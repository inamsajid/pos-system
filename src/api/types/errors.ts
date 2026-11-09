/**
 * Standard API Error Codes & Error Envelope for Cloudflare Workers API.
 */

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INSUFFICIENT_STOCK'
  | 'ALLOCATION_EXCEEDS_BALANCE'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'INTERNAL_SERVER_ERROR'

export interface ApiErrorDetail {
  code: ApiErrorCode
  message: string
  details?: Record<string, unknown>
}

export interface ApiErrorEnvelope {
  success: false
  error: ApiErrorDetail
  requestId: string
}

export interface ApiSuccessEnvelope<T> {
  success: true
  data: T
  meta?: {
    page?: number
    limit?: number
    totalCount?: number
    totalPages?: number
    hasNextPage?: boolean
  }
  requestId: string
}

export type ApiResponse<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope

export class ApiClientError extends Error {
  public readonly code: ApiErrorCode
  public readonly details?: Record<string, unknown>
  public readonly requestId?: string
  public readonly status: number

  constructor(detail: ApiErrorDetail, status: number, requestId?: string) {
    super(detail.message)
    this.name = 'ApiClientError'
    this.code = detail.code
    this.details = detail.details
    this.status = status
    this.requestId = requestId
  }
}

