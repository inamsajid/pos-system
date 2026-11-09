import { useState, useEffect, useCallback } from 'react'
import {
  subscribeToCatalogSync,
  syncCatalog,
  offlineDb,
  type CacheSyncStateRecord,
} from '../../lib/offline'
import { getApiContext } from '../../lib/api-client'

export function useOfflineStatus() {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  )
  const [isSyncing, setIsSyncing] = useState<boolean>(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncState, setSyncState] = useState<CacheSyncStateRecord | null>(null)

  const reloadSyncState = useCallback(async () => {
    const ctx = getApiContext()
    if (ctx.userId && ctx.businessId) {
      const state = await offlineDb.getSyncState(
        ctx.userId,
        ctx.businessId,
        ctx.branchId || 'default',
        'catalog'
      )
      setSyncState(state || null)
    }
  }, [])

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      // Attempt auto-sync when network reconnects
      syncCatalog().catch(() => {})
    }
    const handleOffline = () => {
      setIsOnline(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    const unsubscribe = subscribeToCatalogSync((update) => {
      setIsSyncing(update.isSyncing)
      setSyncError(update.error)
      void reloadSyncState()
    })

    const timer = setTimeout(() => {
      void reloadSyncState()
    }, 0)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      unsubscribe()
    }
  }, [reloadSyncState])

  const triggerManualSync = async () => {
    if (!isOnline || isSyncing) return
    try {
      await syncCatalog({ force: true })
      await reloadSyncState()
    } catch (err) {
      setSyncError((err as Error).message)
    }
  }

  return {
    isOnline,
    isSyncing,
    syncError,
    syncState,
    triggerManualSync,
  }
}
