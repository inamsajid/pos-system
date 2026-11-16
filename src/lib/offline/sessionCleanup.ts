import { offlineDb } from './database'
import { outboxService } from './outbox/outbox.service'
import { queryClient } from '../../app/queryClient'
import { resetCheckoutSessionCache } from '../../features/pos/services/checkoutService'

export interface PendingOfflineSummary {
  pendingOutboxCount: number
  blockedOrConflictCount: number
  provisionalSalesCount: number
  totalUnsyncedCount: number
  hasUnsynced: boolean
  businessIds: string[]
}

const APP_SHELL_CACHE_PREFIX = 'northstar-pos-shell-'
const SESSION_CLEARED_EVENT = 'northstar:session-cleared'

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined'
}

/**
 * Computes pending/unsynchronized offline transactions strictly owned by userId.
 * Safe in JSDOM environments where indexedDB may not be shimmed.
 */
export async function getPendingOfflineSummary(
  userId?: string | null,
  businessId?: string | null
): Promise<PendingOfflineSummary> {
  if (!userId || !hasIndexedDb()) {
    return {
      pendingOutboxCount: 0,
      blockedOrConflictCount: 0,
      provisionalSalesCount: 0,
      totalUnsyncedCount: 0,
      hasUnsynced: false,
      businessIds: [],
    }
  }

  try {
    if (!offlineDb.isOpen()) {
      await offlineDb.open()
    }

    const activeOutboxStatuses = new Set([
      'pending',
      'leased',
      'sending',
      'retryable',
    ])
    const blockedStatuses = new Set([
      'blocked_auth',
      'conflict',
      'reconciliation_required',
    ])
    const unsyncedSaleStatuses = new Set([
      'provisional',
      'conflict',
      'reconciliation_required',
    ])

    const [commands, sales] = await Promise.all([
      offlineDb.outboxCommands
        .filter((c) => c.userId === userId && (!businessId || c.businessId === businessId))
        .toArray(),
      offlineDb.offlineSales
        .filter(
          (s) =>
            s.userId === userId &&
            unsyncedSaleStatuses.has(s.status) &&
            (!businessId || s.businessId === businessId)
        )
        .toArray(),
    ])

    let pendingOutboxCount = 0
    let blockedOrConflictCount = 0
    const bizSet = new Set<string>()

    for (const c of commands) {
      if (activeOutboxStatuses.has(c.status)) {
        pendingOutboxCount++
        if (c.businessId) bizSet.add(c.businessId)
      } else if (blockedStatuses.has(c.status)) {
        blockedOrConflictCount++
        if (c.businessId) bizSet.add(c.businessId)
      }
    }

    for (const s of sales) {
      if (s.businessId) bizSet.add(s.businessId)
    }

    const provisionalSalesCount = sales.length
    const totalUnsyncedCount = Math.max(
      pendingOutboxCount + blockedOrConflictCount,
      provisionalSalesCount
    )

    return {
      pendingOutboxCount,
      blockedOrConflictCount,
      provisionalSalesCount,
      totalUnsyncedCount,
      hasUnsynced: totalUnsyncedCount > 0,
      businessIds: Array.from(bizSet),
    }
  } catch {
    return {
      pendingOutboxCount: 0,
      blockedOrConflictCount: 0,
      provisionalSalesCount: 0,
      totalUnsyncedCount: 0,
      hasUnsynced: false,
      businessIds: [],
    }
  }
}

/**
 * Attempts to flush any dispatchable outbox commands for the user before logging out
 * when connectivity is available.
 */
export async function attemptPreLogoutSync(
  userId?: string | null,
  knownBusinessIds: string[] = []
): Promise<PendingOfflineSummary> {
  if (!userId || !hasIndexedDb()) {
    return getPendingOfflineSummary(userId)
  }

  const initial = await getPendingOfflineSummary(userId)
  const targetBusinesses = Array.from(new Set([...initial.businessIds, ...knownBusinessIds].filter(Boolean)))

  const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false
  if (isOnline && targetBusinesses.length > 0) {
    for (const bizId of targetBusinesses) {
      try {
        await outboxService.dispatchPending(userId, bizId)
      } catch {
        // Leave unsynced items intact for operator handling/confirmation
      }
    }
  }

  return getPendingOfflineSummary(userId)
}

/**
 * Clears all transient browser storage containing tenant/customer/transaction data,
 * TanStack queries, in-memory caches, and sensitive dynamic CacheStorage entries,
 * while preserving the static app-shell cache (`northstar-pos-shell-*`).
 */
export async function clearTransientBrowserStores(): Promise<void> {
  // 1. Cancel & clear in-flight TanStack React Query caches
  try {
    await queryClient.cancelQueries()
  } catch {
    // Ignore cancellation failures
  }
  queryClient.clear()

  // 2. Clear in-memory POS checkout cache
  resetCheckoutSessionCache()

  // 3. Clear sensitive sessionStorage cart / transient UI drafts
  if (typeof sessionStorage !== 'undefined') {
    const keysToRemove: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      if (key && (key === 'pos-cart' || key.startsWith('pos-cart:') || key.startsWith('northstar.'))) {
        keysToRemove.push(key)
      }
    }
    for (const key of keysToRemove) {
      sessionStorage.removeItem(key)
    }
  }

  // 4. Clear sensitive domain stores in localStorage
  if (typeof localStorage !== 'undefined') {
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && (key.startsWith('northstar.') || key === 'pos-cart' || key.startsWith('pos-cart:'))) {
        keysToRemove.push(key)
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key)
    }
  }

  // 5. Purge any dynamic API/asset CacheStorage buckets while preserving shell precache
  if (typeof caches !== 'undefined') {
    try {
      const cacheNames = await caches.keys()
      await Promise.all(
        cacheNames
          .filter((name) => !name.startsWith(APP_SHELL_CACHE_PREFIX))
          .map((name) => caches.delete(name))
      )
    } catch {
      // Safe fallback when CacheStorage is unavailable or restricted
    }
  }

  // 6. Broadcast cleanup signal to listeners/stores
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SESSION_CLEARED_EVENT))
  }
}

/**
 * Centralized shared-terminal logout and identity-switch cleanup procedure.
 * Clears all transient caches & cached catalog/financial tables for the outgoing user
 * while keeping unsynchronized offline outbox/provisional sales strictly locked to userId.
 */
export async function performLogoutCleanup(
  userId?: string | null,
  options: { purgePendingOffline?: boolean } = {}
): Promise<void> {
  await clearTransientBrowserStores()

  if (!userId || !hasIndexedDb()) {
    return
  }

  try {
    if (!offlineDb.isOpen()) {
      await offlineDb.open()
    }

    if (options.purgePendingOffline) {
      const summary = await getPendingOfflineSummary(userId)
      for (const bizId of summary.businessIds) {
        await offlineDb.clearScopedCache(userId, bizId, { preservePendingOffline: false })
      }
    } else {
      await offlineDb.clearUserNonPendingCache(userId)
    }
  } catch {
    // Do not block sign-out UI transition if IndexedDB cleanup encounters environment errors
  }
}

