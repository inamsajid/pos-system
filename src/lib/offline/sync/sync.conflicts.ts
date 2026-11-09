import type { ConflictDetails } from './sync.types'

/**
 * Checks whether an error is an optimistic concurrency version conflict (HTTP 409).
 */
export function isVersionConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const err = error as Record<string, unknown>
  if (err.status === 409 || err.code === 'CONFLICT') return true
  if (typeof err.message === 'string' && (err.message.includes('409') || err.message.includes('VERSION_CONFLICT') || err.message.includes('modified by another device'))) {
    return true
  }

  // Check axios or custom API client response
  const response = err.response as Record<string, unknown> | undefined
  if (response && response.status === 409) return true

  return false
}

/**
 * Extracts structured conflict details from a 409 Conflict error.
 */
export function extractConflictDetails(
  error: unknown,
  fallbackResourceType: 'product' | 'category',
  fallbackResourceId: string
): ConflictDetails {
  const err = error as Record<string, unknown>
  let serverVersion: number | undefined
  let expectedVersion: number | undefined
  let message = 'Record was modified by another device.'
  let resourceId = fallbackResourceId

  if (typeof err?.message === 'string') {
    message = err.message
  }

  // Look for details attached directly or in response.data
  const details = (err?.details || (err?.response as Record<string, unknown>)?.data) as Record<string, unknown> | undefined

  if (details) {
    if (typeof details.serverVersion === 'number') serverVersion = details.serverVersion
    if (typeof details.expectedVersion === 'number') expectedVersion = details.expectedVersion
    if (typeof details.resourceId === 'string') resourceId = details.resourceId
    if (typeof details.message === 'string') message = details.message
  }

  return {
    resourceType: fallbackResourceType,
    resourceId,
    expectedVersion,
    serverVersion,
    message,
  }
}

