/**
 * Step 13.7 Reconnection Detection & Sync Orchestrator
 * Detects online transitions, window focus, visibility change, and active network probe.
 */

import { outboxService } from './outbox/outbox.service'
import { syncCatalog } from './catalogSync'
import { getApiContext } from '../api-client'

export type NetworkStatusListener = (isReconnected: boolean) => void

export class ReconnectionService {
  private isChecking = false
  private isSyncing = false
  private listeners = new Set<NetworkStatusListener>()
  private checkUrl = '/api/v1/health'

  constructor() {
    this.setupListeners()
  }

  private setupListeners() {
    if (typeof window === 'undefined') return

    window.addEventListener('online', () => {
      void this.handleReconnectionTrigger('online_event')
    })

    window.addEventListener('focus', () => {
      void this.handleReconnectionTrigger('window_focus')
    })

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          void this.handleReconnectionTrigger('visibility_change')
        }
      })
    }
  }

  /**
   * Probes the server health endpoint to confirm genuine HTTP connectivity.
   */
  async probeConnectivity(): Promise<boolean> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return false
    }

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 4000)

      const resp = await fetch(this.checkUrl, {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
      })
      clearTimeout(timeoutId)

      return resp.ok
    } catch {
      return false
    }
  }

  /**
   * Handles reconnection triggers safely without overlapping execution.
   */
  async handleReconnectionTrigger(_trigger?: string): Promise<boolean> {
    if (this.isChecking || this.isSyncing) return false
    this.isChecking = true

    try {
      const isConnected = await this.probeConnectivity()
      if (!isConnected) {
        return false
      }

      // Notify listeners
      for (const listener of this.listeners) {
        try {
          listener(true)
        } catch {
          // Ignore listener errors
        }
      }

      await this.runAutomaticSync()
      return true
    } finally {
      this.isChecking = false
    }
  }

  /**
   * Synchronizes both catalog cache and pending outbox commands.
   */
  async runAutomaticSync(): Promise<void> {
    if (this.isSyncing) return
    this.isSyncing = true

    try {
      const ctx = getApiContext()
      if (!ctx.userId || !ctx.businessId) return

      // 1. Pull latest catalog changes
      try {
        await syncCatalog()
      } catch {
        // Safe catalog sync failure
      }

      // 2. Dispatch pending outbox commands in creation order
      try {
        await outboxService.dispatchPending(ctx.userId, ctx.businessId, ctx.branchId || undefined)
      } catch {
        // Safe outbox dispatch failure (retries scheduled)
      }
    } finally {
      this.isSyncing = false
    }
  }

  /**
   * Manual user-initiated sync.
   */
  async manualSync(): Promise<boolean> {
    return this.handleReconnectionTrigger('manual_button')
  }

  subscribe(listener: NetworkStatusListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

export const reconnectionService = new ReconnectionService()
