import { generateId, generateSessionToken, sha256Hex } from './crypto'

export const SESSION_COOKIE_NAME = '__session'
export const DEFAULT_SESSION_MAX_AGE_SECONDS = 86400 * 7 // 7 days rolling session

export interface SessionRecord {
  id: string
  user_id: string
  token_hash: string
  expires_at: string
  ip_address: string | null
  user_agent: string | null
  created_at: string
  updated_at: string
}

export interface AuthenticatedUser {
  id: string
  email: string
  name: string
  phone: string | null
  email_verified: number
  status: 'active' | 'inactive' | 'banned'
  created_at: string
  updated_at: string
}

/**
 * Extracts session token from either `Cookie` header (__session) or `Authorization: Bearer <token>`.
 */
export function extractTokenFromRequest(req: Request): string | null {
  // 1. Check Authorization header
  const authHeader = req.headers.get('Authorization')
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearerToken = authHeader.slice(7).trim()
    if (bearerToken) return bearerToken
  }

  // 2. Check Cookie header
  const cookieHeader = req.headers.get('Cookie')
  if (cookieHeader) {
    const cookies = cookieHeader.split(';')
    for (const cookie of cookies) {
      const [rawName, ...rawValueParts] = cookie.trim().split('=')
      if (rawName === SESSION_COOKIE_NAME) {
        const val = rawValueParts.join('=').trim()
        if (val) return decodeURIComponent(val)
      }
    }
  }

  return null
}

/**
 * Creates a Set-Cookie header value.
 */
export function createSessionCookie(token: string, maxAgeSeconds: number = DEFAULT_SESSION_MAX_AGE_SECONDS, isSecure: boolean = false): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (isSecure) {
    parts.push('Secure')
  }
  return parts.join('; ')
}

/**
 * Creates an expired Set-Cookie header to clear the cookie.
 */
export function clearSessionCookie(isSecure: boolean = false): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=0',
  ]
  if (isSecure) {
    parts.push('Secure')
  }
  return parts.join('; ')
}

/**
 * Creates a new active session in D1 storing only the SHA-256 digest of the token.
 */
export async function createSession(
  db: D1Database,
  userId: string,
  ipAddress?: string | null,
  userAgent?: string | null,
  isSecure: boolean = false
): Promise<{ token: string; session: SessionRecord; cookie: string }> {
  const id = generateId()
  const token = generateSessionToken()
  const tokenHash = await sha256Hex(token)
  const tokenPlaceholder = `sha256:${id}`
  const now = new Date()
  const expiresAt = new Date(now.getTime() + DEFAULT_SESSION_MAX_AGE_SECONDS * 1000).toISOString()
  const createdAt = now.toISOString()

  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, token, token_hash, expires_at, ip_address, user_agent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      userId,
      tokenPlaceholder,
      tokenHash,
      expiresAt,
      ipAddress || null,
      userAgent || null,
      createdAt,
      createdAt
    )
    .run()

  const session: SessionRecord = {
    id,
    user_id: userId,
    token_hash: tokenHash,
    expires_at: expiresAt,
    ip_address: ipAddress || null,
    user_agent: userAgent || null,
    created_at: createdAt,
    updated_at: createdAt,
  }

  const cookie = createSessionCookie(token, DEFAULT_SESSION_MAX_AGE_SECONDS, isSecure)

  return { token, session, cookie }
}

/**
 * Validates a session token against D1 by comparing its SHA-256 digest and verifies the user is active.
 * Rejects expired sessions, invalidated legacy rows without a digest, and inactive/banned users.
 */
export async function validateSession(
  db: D1Database,
  token: string
): Promise<{ session: SessionRecord; user: AuthenticatedUser } | null> {
  if (!token) {
    return null
  }

  const tokenHash = await sha256Hex(token)

  const row = await db
    .prepare(
      `SELECT
         s.id AS session_id,
         s.user_id,
         s.token_hash,
         s.expires_at,
         s.ip_address,
         s.user_agent,
         s.created_at AS session_created_at,
         s.updated_at AS session_updated_at,
         u.id AS u_id,
         u.email,
         u.name,
         u.phone,
         u.email_verified,
         u.status,
         u.created_at AS user_created_at,
         u.updated_at AS user_updated_at
       FROM sessions s
       INNER JOIN users u ON s.user_id = u.id
       WHERE s.token_hash = ?`
    )
    .bind(tokenHash)
    .first<Record<string, unknown>>()

  if (!row) {
    return null
  }

  // Check expiration
  const expiresAt = new Date(row.expires_at as string)
  if (expiresAt.getTime() < Date.now()) {
    // Delete expired session asynchronously or in-place
    await db.prepare('DELETE FROM sessions WHERE id = ?').bind(row.session_id).run()
    return null
  }

  // Check user status
  if (row.status !== 'active') {
    return null
  }

  const session: SessionRecord = {
    id: row.session_id as string,
    user_id: row.user_id as string,
    token_hash: row.token_hash as string,
    expires_at: row.expires_at as string,
    ip_address: (row.ip_address as string) || null,
    user_agent: (row.user_agent as string) || null,
    created_at: row.session_created_at as string,
    updated_at: row.session_updated_at as string,
  }

  const user: AuthenticatedUser = {
    id: row.u_id as string,
    email: row.email as string,
    name: row.name as string,
    phone: (row.phone as string) || null,
    email_verified: Number(row.email_verified),
    status: row.status as 'active',
    created_at: row.user_created_at as string,
    updated_at: row.user_updated_at as string,
  }

  return { session, user }
}

/**
 * Revokes a session by deleting its digest record from D1.
 */
export async function revokeSession(db: D1Database, token: string): Promise<void> {
  if (!token) {
    return
  }
  const tokenHash = await sha256Hex(token)
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run()
}

/**
 * Revokes all sessions for a specific user (e.g. on password change).
 */
export async function revokeAllUserSessions(db: D1Database, userId: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run()
}

