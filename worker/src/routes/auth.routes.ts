import type { RequestContext } from '../router'
import { HttpError } from '../lib/errors'
import { jsonResponse } from '../lib/response'
import { parseJsonBody } from '../lib/validation'
import {
  hashPassword,
  verifyPassword,
  generateId,
  needsRehash,
} from '../auth/crypto'
import {
  createSession,
  revokeSession,
  clearSessionCookie,
  extractTokenFromRequest,
} from '../auth/sessionService'
import {
  getUserBusinesses,
  resolveBusinessContext,
  resolveBranchContext,
  type BranchSummary,
} from '../auth/tenantContext'
import { requireAuth } from '../middleware/authMiddleware'
import { checkRateLimit } from '../middleware/rateLimiter'

interface BootstrapPayload {
  email: string
  password: string
  name: string
  phone?: string
  businessName: string
  businessCode?: string
  currency?: string
  branchName?: string
  branchCode?: string
}

interface SignInPayload {
  email: string
  password: string
}

/**
 * One-time initial system bootstrap.
 * Creates the root Owner, default Business, and primary Branch.
 * Fails with 409 Conflict if any user already exists in the system.
 */
export async function handleBootstrap(ctx: RequestContext): Promise<Response> {
  const envVars = ctx.env as unknown as Record<string, string>
  await checkRateLimit(ctx, {
    keyPrefix: 'bootstrap',
    maxRequests: envVars.BOOTSTRAP_RATE_LIMIT ? parseInt(envVars.BOOTSTRAP_RATE_LIMIT, 10) : 5,
    windowSeconds: 300,
  })

  const db = ctx.env.DB

  // 1. Check if bootstrap already executed
  const userCountResult = await db
    .prepare('SELECT COUNT(*) AS count FROM users')
    .first<{ count: number }>()

  if (userCountResult && Number(userCountResult.count) > 0) {
    throw HttpError.conflict('Bootstrap already completed. System has already been initialized.')
  }

  // 2. Validate payload
  const body = await parseJsonBody<BootstrapPayload>(ctx.req)
  if (!body.email || typeof body.email !== 'string' || !body.email.includes('@')) {
    throw HttpError.badRequest('A valid email address is required.')
  }
  if (!body.password || typeof body.password !== 'string' || body.password.length < 8) {
    throw HttpError.badRequest('Password must be at least 8 characters.')
  }
  if (!body.name || typeof body.name !== 'string' || body.name.trim().length < 2) {
    throw HttpError.badRequest('Full name is required.')
  }
  if (!body.businessName || typeof body.businessName !== 'string' || body.businessName.trim().length < 2) {
    throw HttpError.badRequest('Business name is required.')
  }

  const userId = generateId()
  const businessId = generateId()
  const branchId = generateId()
  const memberId = generateId()
  const memberBranchId = generateId()

  const normalizedEmail = body.email.trim().toLowerCase()
  const passwordHash = await hashPassword(body.password)

  const businessCode = (
    body.businessCode ||
    body.businessName.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase() ||
    'BIZ01'
  ).toUpperCase()

  const branchCode = (body.branchCode || 'MAIN').toUpperCase()
  const currency = body.currency || 'PKR'
  const branchName = body.branchName || 'Main Branch'
  const now = new Date().toISOString()

  // 3. Atomically create User, Business, Branch, Membership, MemberBranch, and Settings
  await db.batch([
    // Create Root Owner User
    db.prepare(`
      INSERT INTO users (id, email, phone, name, password_hash, email_verified, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, 'active', ?, ?)
    `).bind(userId, normalizedEmail, body.phone || null, body.name.trim(), passwordHash, now, now),

    // Create Business
    db.prepare(`
      INSERT INTO businesses (id, business_code, name, currency, country, timezone, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'Pakistan', 'Asia/Karachi', 'active', ?, ?)
    `).bind(businessId, businessCode, body.businessName.trim(), currency, now, now),

    // Create Main Branch
    db.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 'active', ?, ?)
    `).bind(branchId, businessId, branchCode, branchName.trim(), now, now),

    // Create Business Member (Owner)
    db.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, 'owner', 1, ?, ?)
    `).bind(memberId, businessId, userId, now, now),

    // Assign Member to Branch
    db.prepare(`
      INSERT INTO member_branches (id, member_id, branch_id, created_at)
      VALUES (?, ?, ?, ?)
    `).bind(memberBranchId, memberId, branchId, now),

    // Create Business Settings
    db.prepare(`
      INSERT INTO business_settings (business_id, receipt_header, receipt_footer, default_tax_rate, allow_negative_stock, updated_at)
      VALUES (?, ?, ?, 0.0, 1, ?)
    `).bind(businessId, body.businessName.trim(), 'Thank you for your business!', now),
  ])

  // 4. Create Session & Cookie
  const isSecure = ctx.url.protocol === 'https:'
  const { session, cookie } = await createSession(
    db,
    userId,
    ctx.req.headers.get('CF-Connecting-IP') || ctx.req.headers.get('X-Forwarded-For'),
    ctx.req.headers.get('User-Agent'),
    isSecure
  )

  const responseData = {
    message: 'Bootstrap completed successfully.',
    user: {
      id: userId,
      email: normalizedEmail,
      name: body.name.trim(),
      phone: body.phone || null,
      status: 'active',
    },
    business: {
      id: businessId,
      code: businessCode,
      name: body.businessName.trim(),
      currency,
    },
    branch: {
      id: branchId,
      code: branchCode,
      name: branchName.trim(),
    },
    session: {
      id: session.id,
      expiresAt: session.expires_at,
    },
  }

  return jsonResponse(responseData, 201, ctx.requestId, undefined, {
    'Set-Cookie': cookie,
  })
}

/**
 * Authenticates user credentials, creates a database session, and sets HttpOnly cookie.
 */
export async function handleSignIn(ctx: RequestContext): Promise<Response> {
  const envVars = ctx.env as unknown as Record<string, string>
  await checkRateLimit(ctx, {
    keyPrefix: 'signin',
    maxRequests: envVars.SIGNIN_RATE_LIMIT ? parseInt(envVars.SIGNIN_RATE_LIMIT, 10) : 25,
    windowSeconds: 60,
  })

  const db = ctx.env.DB
  const body = await parseJsonBody<SignInPayload>(ctx.req)

  if (!body || typeof body !== 'object' || !body.email || !body.password || typeof body.email !== 'string' || typeof body.password !== 'string') {
    throw HttpError.badRequest('Email and password are required.')
  }

  const normalizedEmail = body.email.trim().toLowerCase()

  // Retrieve user
  const userRow = await db
    .prepare(
      `SELECT id, email, name, phone, password_hash, email_verified, status
       FROM users WHERE email = ?`
    )
    .bind(normalizedEmail)
    .first<{
      id: string
      email: string
      name: string
      phone: string | null
      password_hash: string | null
      email_verified: number
      status: string
    }>()

  // Protect against timing/enumeration attacks by always running password verification
  const dummyHash = 'pbkdf2:100000:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000'
  const isMatch = await verifyPassword(body.password, userRow?.password_hash || dummyHash)

  if (!userRow || !isMatch || userRow.status !== 'active') {
    throw HttpError.unauthorized('Invalid email or password.')
  }

  // Opportunistic rehashing if stored hash uses fewer iterations than target work-factor
  const targetIterations = ctx.env.PBKDF2_ITERATIONS ? parseInt(ctx.env.PBKDF2_ITERATIONS, 10) : 100_000
  if (userRow.password_hash && needsRehash(userRow.password_hash, targetIterations)) {
    const upgradedHash = await hashPassword(body.password, targetIterations)
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(upgradedHash, userRow.id).run()
  }

  const isSecure = ctx.url.protocol === 'https:'
  const { session, cookie } = await createSession(
    db,
    userRow.id,
    ctx.req.headers.get('CF-Connecting-IP') || ctx.req.headers.get('X-Forwarded-For'),
    ctx.req.headers.get('User-Agent'),
    isSecure
  )

  const businesses = await getUserBusinesses(db, userRow.id)

  const responseData = {
    user: {
      id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      phone: userRow.phone,
      emailVerified: Boolean(userRow.email_verified),
    },
    businesses,
    session: {
      id: session.id,
      expiresAt: session.expires_at,
    },
  }

  return jsonResponse(responseData, 200, ctx.requestId, undefined, {
    'Set-Cookie': cookie,
  })
}

/**
 * Revokes current active session and clears the cookie.
 */
export async function handleSignOut(ctx: RequestContext): Promise<Response> {
  const token = extractTokenFromRequest(ctx.req)
  if (token) {
    await revokeSession(ctx.env.DB, token)
  }

  return jsonResponse(
    { message: 'Signed out successfully.' },
    200,
    ctx.requestId,
    undefined,
    {
      'Set-Cookie': clearSessionCookie(),
    }
  )
}

/**
 * Returns current authenticated user profile, accessible businesses, and active branch context.
 */
export async function handleMe(ctx: RequestContext): Promise<Response> {
  await requireAuth(ctx)
  const db = ctx.env.DB
  const user = ctx.auth!.user

  const businesses = await getUserBusinesses(db, user.id)

  let activeBusiness: Record<string, unknown> | null = null
  let activeBranch: BranchSummary | null = null

  if (businesses.length > 0) {
    try {
      const requestedBusinessId = ctx.req.headers.get('X-Business-Id')
      const resolvedTenant = await resolveBusinessContext(db, user.id, requestedBusinessId)
      const requestedBranchId = ctx.req.headers.get('X-Branch-Id')
      const branch = await resolveBranchContext(
        db,
        resolvedTenant.business.id,
        resolvedTenant.membership.id,
        resolvedTenant.membership.role,
        requestedBranchId
      )

      activeBusiness = {
        ...resolvedTenant.business,
        role: resolvedTenant.membership.role,
      }
      activeBranch = branch
    } catch {
      // If headers are missing when user has multiple businesses/branches, active context remains null.
    }
  }

  return jsonResponse(
    {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        emailVerified: Boolean(user.email_verified),
        status: user.status,
      },
      businesses,
      activeBusiness,
      activeBranch,
    },
    200,
    ctx.requestId
  )
}
