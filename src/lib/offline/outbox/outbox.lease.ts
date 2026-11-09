import type { OutboxCommandRecord } from './outbox.types'

export const DEFAULT_LEASE_DURATION_MS = 30_000 // 30 seconds

export interface LeaseInfo {
  leaseToken: string
  leaseExpiresAt: string
}

/**
 * Generates a fresh unique lease token and expiration timestamp.
 */
export function createLease(durationMs = DEFAULT_LEASE_DURATION_MS): LeaseInfo {
  const leaseToken =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `lease_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

  const leaseExpiresAt = new Date(Date.now() + durationMs).toISOString()
  return { leaseToken, leaseExpiresAt }
}

/**
 * Checks whether an existing command record's lease has expired.
 */
export function isLeaseExpired(record: OutboxCommandRecord): boolean {
  if (!record.leaseExpiresAt) return true
  return new Date(record.leaseExpiresAt).getTime() <= Date.now()
}

/**
 * Checks whether the command has an active lease held by the expected token.
 */
export function isLeaseValid(record: OutboxCommandRecord, expectedToken: string): boolean {
  if (!record.leaseToken || record.leaseToken !== expectedToken) return false
  return !isLeaseExpired(record)
}

