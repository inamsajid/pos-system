import { useState, useEffect, useCallback } from 'react'
import { outboxService, type OutboxStats } from '../../lib/offline/outbox'
import { getApiContext } from '../../lib/api-client'

const initialStats: OutboxStats = {
  pendingCount: 0,
  processingCount: 0,
  retryableCount: 0,
  conflictCount: 0,
  rejectedCount: 0,
  blockedAuthCount: 0,
  acknowledgedCount: 0,
  lastSyncAt: null,
}

export function useOutboxStatus() {
  const [stats, setStats] = useState<OutboxStats>(initialStats)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const refreshStats = useCallback(async () => {
    const ctx = getApiContext()
    if (!ctx.userId || !ctx.businessId) return

    try {
      const freshStats = await outboxService.getStats(ctx.userId, ctx.businessId)
      setStats(freshStats)
    } catch {
      // Safe metrics fetch failure
    }
  }, [])

  useEffect(() => {
    let mounted = true

    const loadInitialStats = async () => {
      const ctx = getApiContext()
      if (!ctx.userId || !ctx.businessId) return

      try {
        const freshStats = await outboxService.getStats(ctx.userId, ctx.businessId)
        if (mounted) {
          setStats(freshStats)
        }
      } catch {
        // Safe metrics fetch failure
      }
    }

    void loadInitialStats()

    const unsubscribe = outboxService.subscribe(() => {
      if (mounted) {
        void refreshStats()
      }
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [refreshStats])

  const triggerDispatch = useCallback(async () => {
    const ctx = getApiContext()
    if (!ctx.userId || !ctx.businessId) return []

    setIsRefreshing(true)
    try {
      const results = await outboxService.dispatchPending(
        ctx.userId,
        ctx.businessId,
        ctx.branchId
      )
      await refreshStats()
      return results
    } finally {
      setIsRefreshing(false)
    }
  }, [refreshStats])

  return {
    stats,
    isRefreshing,
    refreshStats,
    triggerDispatch,
  }
}
