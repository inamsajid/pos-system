import type { RequestContext } from '../router'
import { jsonResponse } from '../lib/response'
import { requireAuth, requireBusinessContext } from '../middleware/authMiddleware'
import { getUserBusinesses, getUserBranches } from '../auth/tenantContext'

/**
 * GET /api/v1/businesses
 * Lists all active businesses accessible to the authenticated user.
 */
export async function handleListBusinesses(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  const businesses = await getUserBusinesses(ctx.env.DB, ctx.auth!.user.id)

  return jsonResponse(businesses, 200, ctx.requestId, {
    totalCount: businesses.length,
  })
}

/**
 * GET /api/v1/branches
 * Lists all branches accessible to the authenticated user under the active business.
 */
export async function handleListBranches(ctx: RequestContext): Promise<Response> {
  await requireBusinessContext(ctx)

  const branches = await getUserBranches(
    ctx.env.DB,
    ctx.tenant!.business.id,
    ctx.tenant!.membership.id,
    ctx.tenant!.membership.role
  )

  return jsonResponse(branches, 200, ctx.requestId, {
    totalCount: branches.length,
    businessId: ctx.tenant!.business.id,
  })
}

