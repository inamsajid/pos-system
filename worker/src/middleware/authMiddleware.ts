import type { RequestContext } from '../router'
import { HttpError } from '../lib/errors'
import { extractTokenFromRequest, validateSession } from '../auth/sessionService'
import {
  resolveBusinessContext,
  resolveBranchContext,
  hasPermission,
  type Permission,
} from '../auth/tenantContext'

/**
 * Asserts that the request carries a valid, non-expired session cookie or Bearer token.
 * Populates `ctx.auth` with `{ user, session }`.
 */
export async function requireAuth(ctx: RequestContext): Promise<void> {
  const token = extractTokenFromRequest(ctx.req)
  if (!token) {
    throw HttpError.unauthorized('Authentication required: Missing session token.')
  }

  const result = await validateSession(ctx.env.DB, token)
  if (!result) {
    throw HttpError.unauthorized('Authentication required: Session expired or invalid.')
  }

  ctx.auth = result
}

/**
 * Asserts that the request is authenticated and resolves the business context.
 * Populates `ctx.tenant` with `{ business, membership }`.
 */
export async function requireBusinessContext(ctx: RequestContext): Promise<void> {
  if (!ctx.auth) {
    await requireAuth(ctx)
  }

  const requestedBusinessId = ctx.req.headers.get('X-Business-Id')
  const { business, membership } = await resolveBusinessContext(
    ctx.env.DB,
    ctx.auth!.user.id,
    requestedBusinessId
  )

  ctx.tenant = {
    business,
    membership,
  }
}

/**
 * Asserts that the request has business context and resolves the branch context.
 * Populates `ctx.branch` with the active branch record.
 */
export async function requireBranchContext(ctx: RequestContext): Promise<void> {
  if (!ctx.tenant) {
    await requireBusinessContext(ctx)
  }

  const requestedBranchId = ctx.req.headers.get('X-Branch-Id')
  const branch = await resolveBranchContext(
    ctx.env.DB,
    ctx.tenant!.business.id,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role,
    requestedBranchId
  )

  ctx.branch = branch
  ctx.tenant!.branch = branch
}

/**
 * Asserts that the authenticated member has the specified permission in the active business.
 */
export function requirePermission(permission: Permission) {
  return async (ctx: RequestContext): Promise<void> => {
    if (!ctx.tenant) {
      await requireBusinessContext(ctx)
    }

    const role = ctx.tenant!.membership.role
    if (!hasPermission(role, permission)) {
      throw HttpError.forbidden(`Action forbidden: Role '${role}' lacks '${permission}' permission.`)
    }
  }
}

/**
 * Asserts that the authenticated member holds at least one of the listed permissions.
 */
export function requireAnyPermission(...permissions: Permission[]) {
  return async (ctx: RequestContext): Promise<void> => {
    if (!ctx.tenant) {
      await requireBusinessContext(ctx)
    }

    const role = ctx.tenant!.membership.role
    if (!permissions.some((permission) => hasPermission(role, permission))) {
      throw HttpError.forbidden(
        `Action forbidden: Role '${role}' lacks required permissions (${permissions.join(', ')}).`
      )
    }
  }
}

