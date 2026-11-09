import type { RequestContext } from '../router'
import { HttpError } from '../lib/errors'

export interface RateLimitOptions {
  keyPrefix: string
  maxRequests: number
  windowSeconds: number
}

export async function checkRateLimit(
  ctx: RequestContext,
  options: RateLimitOptions
): Promise<void> {
  const db = ctx.env.DB
  if (!db) return

  // Extract client IP address from standard headers
  const rawIp =
    ctx.req.headers.get('CF-Connecting-IP') ||
    ctx.req.headers.get('X-Forwarded-For') ||
    '127.0.0.1'
  const ip = rawIp.split(',')[0].trim()

  const key = `${options.keyPrefix}:${ip}`
  const now = Math.floor(Date.now() / 1000)
  const windowStart = Math.floor(now / options.windowSeconds) * options.windowSeconds
  const expiresAt = windowStart + options.windowSeconds

  try {
    const row = await db
      .prepare(
        `INSERT INTO api_rate_limits (key, window_start, request_count, expires_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(key, window_start) DO UPDATE SET request_count = request_count + 1
         RETURNING request_count`
      )
      .bind(key, windowStart, expiresAt)
      .first<{ request_count: number }>()

    const count = row?.request_count ?? 1
    if (count > options.maxRequests) {
      const retryAfter = Math.max(1, expiresAt - now)
      throw HttpError.tooManyRequests(
        `Too many requests. Limit is ${options.maxRequests} per ${options.windowSeconds}s. Please retry in ${retryAfter}s.`,
        retryAfter,
        { limit: options.maxRequests, windowSeconds: options.windowSeconds }
      )
    }

    // Opportunistically prune old records (~1% of requests)
    if (Math.random() < 0.01 && ctx.ctx?.waitUntil) {
      ctx.ctx.waitUntil(
        db.prepare('DELETE FROM api_rate_limits WHERE expires_at < ?').bind(now - 3600).run()
      )
    }
  } catch (err) {
    if (err instanceof HttpError) throw err
    // If rate limit table is not created yet or D1 is in transitional state, log warning and let request through
    console.warn('[RateLimiter] Check skipped due to error:', err)
  }
}

