import type { Env } from './types/environment'
import { resolveRequestId } from './middleware/requestId'
import { errorResponse } from './lib/response'
import { HttpError } from './lib/errors'
import type { AuthenticatedUser, SessionRecord } from './auth/sessionService'
import type { TenantContext, BranchSummary } from './auth/tenantContext'
import { getAllowedOrigins, isOriginAllowed } from './config/environment'

export interface RequestContext {
  req: Request
  url: URL
  env: Env
  ctx: ExecutionContext
  requestId: string
  params: Record<string, string>
  auth?: {
    user: AuthenticatedUser
    session: SessionRecord
  }
  tenant?: TenantContext
  branch?: BranchSummary
}

export type RouteHandler = (context: RequestContext) => Promise<Response> | Response

interface RouteEntry {
  method: string
  path: string
  pattern: RegExp
  paramNames: string[]
  handler: RouteHandler
}

export class Router {
  private routes: RouteEntry[] = []

  private add(method: string, path: string, handler: RouteHandler) {
    const paramNames: string[] = []
    const regexPath = path.replace(/:([a-zA-Z0-9_]+)/g, (_, paramName) => {
      paramNames.push(paramName)
      return '([^/]+)'
    })
    const pattern = new RegExp(`^${regexPath}$`)

    this.routes.push({
      method: method.toUpperCase(),
      path,
      pattern,
      paramNames,
      handler,
    })
  }

  get(path: string, handler: RouteHandler): this {
    this.add('GET', path, handler)
    return this
  }

  post(path: string, handler: RouteHandler): this {
    this.add('POST', path, handler)
    return this
  }

  put(path: string, handler: RouteHandler): this {
    this.add('PUT', path, handler)
    return this
  }

  patch(path: string, handler: RouteHandler): this {
    this.add('PATCH', path, handler)
    return this
  }

  delete(path: string, handler: RouteHandler): this {
    this.add('DELETE', path, handler)
    return this
  }

  async handle(req: Request, env: Env, executionCtx: ExecutionContext): Promise<Response> {
    const requestId = resolveRequestId(req)
    const url = new URL(req.url)
    const pathname = url.pathname.replace(/\/+$/, '') || '/'
    const method = req.method.toUpperCase()
    const origin = req.headers.get('Origin')
    const allowedOrigins = getAllowedOrigins(env)
    const originIsAllowed = isOriginAllowed(origin, allowedOrigins)

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      if (origin) {
        if (!originIsAllowed) {
          return errorResponse(
            HttpError.forbidden('CORS policy: Origin not allowed.'),
            requestId
          )
        }

        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Credentials': 'true',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'Access-Control-Allow-Headers':
              'Content-Type, Authorization, X-Business-Id, X-Branch-Id, Idempotency-Key, X-Request-Id, Cookie',
            'Access-Control-Max-Age': '86400',
            Vary: 'Origin',
          },
        })
      }

      // Preflight without Origin header
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers':
            'Content-Type, Authorization, X-Business-Id, X-Branch-Id, Idempotency-Key, X-Request-Id, Cookie',
          'Access-Control-Max-Age': '86400',
        },
      })
    }

    try {
      // CSRF & Origin Validation on state-mutating requests
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        if (origin) {
          if (!originIsAllowed) {
            throw HttpError.forbidden('CORS / CSRF policy: Unapproved origin rejected.')
          }
        } else {
          // If Origin is missing, check Referer
          const referer = req.headers.get('Referer')
          if (referer) {
            let refererOrigin: string | null = null
            try {
              refererOrigin = new URL(referer).origin
            } catch {
              throw HttpError.forbidden('CSRF policy: Malformed referer header rejected.')
            }
            if (!isOriginAllowed(refererOrigin, allowedOrigins)) {
              throw HttpError.forbidden('CSRF policy: Unapproved referer origin rejected.')
            }
          } else {
            // Both Origin and Referer are absent. If request carries a browser session cookie,
            // require custom headers or application/json to defend against cross-origin HTML form POSTs.
            const cookie = req.headers.get('Cookie') || ''
            if (cookie.includes('__session=')) {
              const contentType = req.headers.get('Content-Type') || ''
              const hasCustomHeader =
                req.headers.has('X-Request-Id') ||
                req.headers.has('X-Business-Id') ||
                req.headers.has('Idempotency-Key')
              if (!hasCustomHeader && !contentType.includes('application/json')) {
                throw HttpError.forbidden('CSRF policy: Missing origin verification on authenticated mutation.')
              }
            }
          }
        }
      }

      let matchedRoute: RouteEntry | null = null
      let routeParams: Record<string, string> = {}
      let pathMatchedDifferentMethod = false

      for (const route of this.routes) {
        const match = pathname.match(route.pattern)
        if (match) {
          if (route.method === method) {
            matchedRoute = route
            routeParams = {}
            for (let i = 0; i < route.paramNames.length; i++) {
              routeParams[route.paramNames[i]] = decodeURIComponent(match[i + 1])
            }
            break
          } else {
            pathMatchedDifferentMethod = true
          }
        }
      }

      if (!matchedRoute) {
        if (pathMatchedDifferentMethod) {
          throw new HttpError(405, 'NOT_FOUND', `Method ${method} not allowed for ${pathname}`)
        }
        throw HttpError.notFound(`Route ${method} ${pathname} not found.`)
      }

      const context: RequestContext = {
        req,
        url,
        env,
        ctx: executionCtx,
        requestId,
        params: routeParams,
      }

      const response = await matchedRoute.handler(context)

      // Ensure standard headers are present
      const headers = new Headers(response.headers)
      if (!headers.has('X-Request-Id')) {
        headers.set('X-Request-Id', requestId)
      }
      if (origin && originIsAllowed) {
        headers.set('Access-Control-Allow-Origin', origin)
        headers.set('Access-Control-Allow-Credentials', 'true')
        headers.set('Vary', 'Origin')
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    } catch (err) {
      const resp = errorResponse(err, requestId)
      const headers = new Headers(resp.headers)
      if (origin && originIsAllowed) {
        headers.set('Access-Control-Allow-Origin', origin)
        headers.set('Access-Control-Allow-Credentials', 'true')
        headers.set('Vary', 'Origin')
      }
      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers,
      })
    }
  }
}
