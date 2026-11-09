import type { StorageEstimateResult } from './database.types'

/**
 * Utility to inspect and request persistent browser storage for IndexedDB.
 * Handles headless / test environments gracefully where navigator.storage may be absent.
 */
export async function getStorageEstimate(): Promise<StorageEstimateResult> {
  if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.estimate) {
    return {
      quotaBytes: null,
      usageBytes: null,
      percentUsed: null,
      isPersisted: false,
      warning: null,
    }
  }

  try {
    const estimate = await navigator.storage.estimate()
    const quotaBytes = estimate.quota ?? null
    const usageBytes = estimate.usage ?? null
    let percentUsed: number | null = null

    if (quotaBytes && usageBytes !== null && quotaBytes > 0) {
      percentUsed = Math.round((usageBytes / quotaBytes) * 10000) / 100 // 2 decimal places %
    }

    let isPersisted = false
    if (navigator.storage.persisted) {
      isPersisted = await navigator.storage.persisted()
    }

    let warning: string | null = null
    if (percentUsed !== null && percentUsed >= 90) {
      warning = `Storage critically low: ${percentUsed}% used. Consider cleaning up old data.`
    } else if (percentUsed !== null && percentUsed >= 75) {
      warning = `Storage warning: ${percentUsed}% used.`
    }

    return {
      quotaBytes,
      usageBytes,
      percentUsed,
      isPersisted,
      warning,
    }
  } catch (err) {
    return {
      quotaBytes: null,
      usageBytes: null,
      percentUsed: null,
      isPersisted: false,
      warning: (err as Error).message || 'Failed to query storage estimate',
    }
  }
}

/**
 * Requests that the browser preserve IndexedDB data without eviction under storage pressure.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.persist) {
    return false
  }

  try {
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

/**
 * Checks whether an error indicates a storage quota limit was reached.
 */
export function isStorageQuotaExceeded(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object' && 'name' in error) {
    const name = (error as { name?: string }).name
    return (
      name === 'QuotaExceededError' ||
      name === 'NS_ERROR_DOM_QUOTA_REACHED'
    )
  }
  if (error instanceof Error) {
    return (
      error.name === 'QuotaExceededError' ||
      error.message.toLowerCase().includes('quota') ||
      error.message.toLowerCase().includes('storage full')
    )
  }
  return false
}

