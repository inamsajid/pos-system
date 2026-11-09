import type { ApiSuccessEnvelope, ApiErrorEnvelope } from './types/errors'
import { ApiClientError } from './types/errors'

export interface ApiClientConfig {
  baseUrl: string
  businessId?: string
  branchId?: string
  getAuthToken?: () => string | null
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  idempotencyKey?: string
  businessId?: string
  branchId?: string
  params?: Record<string, string | number | boolean | undefined>
}

/**
 * Interface contract for the Cloudflare Workers API client.
 */
export interface IApiClient {
  get<T>(path: string, options?: RequestOptions): Promise<T>
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>
  delete<T>(path: string, options?: RequestOptions): Promise<T>
}

/**
 * Pure helper to build query string from param record.
 */
export function buildQueryString(params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return ''
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(key, String(value))
    }
  }
  const qs = searchParams.toString()
  return qs ? `?${qs}` : ''
}

/**
 * Factory to create standard request headers.
 */
export function createStandardHeaders(
  config: ApiClientConfig,
  options?: RequestOptions
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  const businessId = options?.businessId ?? config.businessId
  if (businessId) {
    headers['X-Business-Id'] = businessId
  }

  const branchId = options?.branchId ?? config.branchId
  if (branchId) {
    headers['X-Branch-Id'] = branchId
  }

  if (options?.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey
  }

  const token = config.getAuthToken ? config.getAuthToken() : null
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  return headers
}

/**
 * Pure response parser enforcing the standard API envelope.
 */
export function parseApiResponse<T>(json: unknown, status: number): T {
  const payload = json as ApiSuccessEnvelope<T> | ApiErrorEnvelope

  if (!payload || typeof payload !== 'object' || !('success' in payload)) {
    throw new ApiClientError(
      { code: 'INTERNAL_SERVER_ERROR', message: 'Malformed response received from server.' },
      status
    )
  }

  if (payload.success) {
    return payload.data
  }

  throw new ApiClientError(payload.error, status, payload.requestId)
}

