import type { ApiErrorResponse } from '../services/api/types'

function appendQueryParams(
  url: string,
  params?: Record<string, string | number | boolean | undefined>
): string {
  if (!params) return url
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(key, String(value))
    }
  }
  const qs = searchParams.toString()
  if (!qs) return url
  return `${url}${url.includes('?') ? '&' : '?'}${qs}`
}

export function getApiBaseUrl(envBaseUrl?: string): string {
  const rawEnvUrl = (envBaseUrl ?? (import.meta.env?.VITE_API_BASE_URL as string | undefined))
    ?.trim()
    .replace(/\/+$/, '')

  if (rawEnvUrl && (rawEnvUrl.startsWith('http://') || rawEnvUrl.startsWith('https://'))) {
    try {
      const parsed = new URL(rawEnvUrl)
      const pathname = parsed.pathname.replace(/\/+$/, '')
      if (!pathname) {
        return `${parsed.origin}/api/v1`
      }
      return `${parsed.origin}${pathname}`
    } catch {
      return rawEnvUrl
    }
  }

  if (!rawEnvUrl) {
    return '/api/v1'
  }

  return rawEnvUrl.startsWith('/') ? rawEnvUrl : `/${rawEnvUrl}`
}

export function resolveApiUrl(
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
  envBaseUrl?: string
): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return appendQueryParams(path, params)
  }

  const baseUrl = getApiBaseUrl(envBaseUrl)
  let normalizedPath = path.startsWith('/') ? path : `/${path}`

  let basePathOnly = baseUrl
  if (baseUrl.startsWith('http://') || baseUrl.startsWith('https://')) {
    try {
      basePathOnly = new URL(baseUrl).pathname.replace(/\/+$/, '')
    } catch {
      basePathOnly = ''
    }
  }

  const prefixesToCheck: string[] = []
  if (basePathOnly) prefixesToCheck.push(basePathOnly)
  const versionSuffixMatch = basePathOnly.match(/(\/api\/v\d+)$/i)
  if (versionSuffixMatch && versionSuffixMatch[1] !== basePathOnly) {
    prefixesToCheck.push(versionSuffixMatch[1])
  }

  const lowerPath = normalizedPath.toLowerCase()
  for (const prefix of prefixesToCheck) {
    const lowerPrefix = prefix.toLowerCase()
    if (
      lowerPath === lowerPrefix ||
      lowerPath.startsWith(`${lowerPrefix}/`) ||
      lowerPath.startsWith(`${lowerPrefix}?`)
    ) {
      normalizedPath = normalizedPath.slice(prefix.length) || '/'
      break
    }
  }

  const joined = normalizedPath === '/' ? baseUrl : `${baseUrl}${normalizedPath}`
  return appendQueryParams(joined, params)
}

export interface StructuredApiErrorPayload {
  code?: string
  message?: string
  details?: Record<string, unknown>
}

export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly details?: Record<string, unknown>
  readonly requestId?: string

  constructor(message: string, status: number, code?: string, details?: Record<string, unknown>, requestId?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.requestId = requestId
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.headers.get('content-length') === '0') return undefined

  const body = await response.text()
  if (!body) return undefined

  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json') || contentType.includes('+json')) {
    try {
      return JSON.parse(body) as unknown
    } catch {
      return body
    }
  }

  return body
}

export interface ApiRequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>
  requestId?: string
  responseType?: 'json' | 'blob' | 'text'
}

export type ContextProvider = () => {
  userId?: string | null
  businessId?: string | null
  branchId?: string | null
}
let activeContextProvider: ContextProvider | null = null

export function setApiContextProvider(provider: ContextProvider | null) {
  activeContextProvider = provider
}

export function getApiContext(): {
  userId?: string | null
  businessId?: string | null
  branchId?: string | null
} {
  if (activeContextProvider) {
    try {
      return activeContextProvider()
    } catch {
      // safe fallback
    }
  }
  return { userId: null, businessId: null, branchId: null }
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { params, requestId, responseType = 'json', ...init } = options
  const headers = new Headers(init.headers)

  if (activeContextProvider) {
    try {
      const activeCtx = activeContextProvider()
      if (activeCtx.businessId && !headers.has('X-Business-Id')) {
        headers.set('X-Business-Id', activeCtx.businessId)
      }
      if (activeCtx.branchId && !headers.has('X-Branch-Id')) {
        headers.set('X-Branch-Id', activeCtx.branchId)
      }
    } catch {
      // Safe fallback if provider fails
    }
  }

  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (!headers.has('Accept')) {
    headers.set('Accept', responseType === 'blob' ? '*/*' : 'application/json')
  }

  const resolvedRequestId = requestId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : undefined)
  if (resolvedRequestId && !headers.has('X-Request-Id')) {
    headers.set('X-Request-Id', resolvedRequestId)
  }

  const url = resolveApiUrl(path, params)
  const response = await fetch(url, {
    credentials: init.credentials ?? 'include',
    ...init,
    headers,
  })

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`
    let code: string | undefined
    let details: Record<string, unknown> | undefined

    const body = await readResponseBody(response)
    if (body && typeof body === 'object') {
      const envelope = body as { success?: boolean; error?: StructuredApiErrorPayload; message?: string; code?: string }
      if (envelope.error && typeof envelope.error === 'object') {
        message = envelope.error.message || message
        code = envelope.error.code
        details = envelope.error.details
      } else if (typeof envelope.message === 'string') {
        const legacy = body as Partial<ApiErrorResponse>
        message = legacy.message || message
        code = legacy.code
      }
    } else if (typeof body === 'string' && body) {
      message = body
    }

    const responseRequestId = response.headers.get('x-request-id') || resolvedRequestId
    throw new ApiError(message, response.status, code, details, responseRequestId)
  }

  if (responseType === 'blob') {
    return (await response.blob()) as unknown as T
  }

  if (responseType === 'text') {
    return (await response.text()) as unknown as T
  }

  const body = await readResponseBody(response)

  // If response matches our standard envelope { success: true, data: T }, unwrap it
  if (body && typeof body === 'object' && 'success' in body && 'data' in body) {
    const envelope = body as { success: boolean; data: T }
    if (envelope.success) {
      return envelope.data
    }
  }

  return body as T
}

export const apiClient = {
  get<T>(path: string, options?: ApiRequestOptions): Promise<T> {
    return apiRequest<T>(path, { ...options, method: 'GET' })
  },

  getBlob(path: string, options?: ApiRequestOptions): Promise<Blob> {
    return apiRequest<Blob>(path, { ...options, method: 'GET', responseType: 'blob' })
  },

  post<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return apiRequest<T>(path, {
      ...options,
      method: 'POST',
      body: body !== undefined ? (body instanceof FormData ? body : typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    })
  },

  put<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return apiRequest<T>(path, {
      ...options,
      method: 'PUT',
      body: body !== undefined ? (body instanceof FormData ? body : typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    })
  },

  patch<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return apiRequest<T>(path, {
      ...options,
      method: 'PATCH',
      body: body !== undefined ? (body instanceof FormData ? body : typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    })
  },

  delete<T>(path: string, options?: ApiRequestOptions): Promise<T> {
    return apiRequest<T>(path, { ...options, method: 'DELETE' })
  },
}
