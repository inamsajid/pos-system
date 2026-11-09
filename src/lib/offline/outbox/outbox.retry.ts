export const DEFAULT_BASE_DELAY_MS = 1_000 // 1s
export const DEFAULT_MAX_DELAY_MS = 60_000 // 60s
export const MAX_RETRY_ATTEMPTS = 5

export interface NextAttemptResult {
  nextAttemptAt: string
  delayMs: number
}

/**
 * Calculates next attempt timestamp using bounded exponential backoff with full jitter.
 */
export function calculateNextAttempt(
  attemptCount: number,
  baseMs = DEFAULT_BASE_DELAY_MS,
  maxMs = DEFAULT_MAX_DELAY_MS,
  retryAfterSeconds?: number
): NextAttemptResult {
  let delayMs: number

  if (retryAfterSeconds !== undefined && retryAfterSeconds > 0) {
    // Respect server-provided Retry-After
    delayMs = Math.min(retryAfterSeconds * 1000, maxMs)
  } else {
    // Bounded exponential backoff: base * 2^attempts, capped at maxMs
    const backoffCap = Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attemptCount)))
    // Full jitter: random between 0 and backoffCap
    delayMs = Math.floor(Math.random() * backoffCap)
    // Minimum floor of 500ms
    delayMs = Math.max(500, delayMs)
  }

  const nextAttemptAt = new Date(Date.now() + delayMs).toISOString()
  return { nextAttemptAt, delayMs }
}

/**
 * Checks whether the command has exhausted its maximum authorized attempts.
 */
export function hasExceededMaxAttempts(attemptCount: number, maxAttempts = MAX_RETRY_ATTEMPTS): boolean {
  return attemptCount >= maxAttempts
}

