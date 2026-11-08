import type { ApiErrorResponse } from '../services/api/types'

const baseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? ''

export class ApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
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

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!baseUrl) throw new Error('VITE_API_BASE_URL is not configured.')

  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  headers.set('Accept', 'application/json')

  const response = await fetch(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
    ...init,
    headers,
  })
  const body = await readResponseBody(response)

  if (!response.ok) {
    const errorBody = body as Partial<ApiErrorResponse> | undefined
    const message = typeof errorBody?.message === 'string'
      ? errorBody.message
      : typeof body === 'string' && body
        ? body
        : `Request failed with status ${response.status}`
    throw new ApiError(message, response.status, errorBody?.code)
  }

  return body as T
}
