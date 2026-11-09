import { SyncClient } from './sync.client'

export interface SyncSchedulerOptions {
  client?: SyncClient
  pollIntervalMs?: number
  heartbeatIntervalMs?: number
}

export class SyncScheduler {
  private readonly client: SyncClient
  private readonly pollIntervalMs: number
  private readonly heartbeatIntervalMs: number
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private isRunning = false

  constructor(options: SyncSchedulerOptions = {}) {
    this.client = options.client || new SyncClient()
    this.pollIntervalMs = options.pollIntervalMs || 15_000 // 15 seconds
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || 60_000 // 1 minute
  }

  /**
   * Starts background synchronization polling and event listeners.
   */
  start(): void {
    if (this.isRunning) return
    this.isRunning = true

    // Initial sync and registration
    this.safeSync()
    this.safeHeartbeat()

    // Polling timer
    this.pollTimer = setInterval(() => {
      if (this.canSync()) {
        this.safeSync()
      }
    }, this.pollIntervalMs)

    // Heartbeat timer
    this.heartbeatTimer = setInterval(() => {
      if (this.canSync()) {
        this.safeHeartbeat()
      }
    }, this.heartbeatIntervalMs)

    // Event listeners for window focus and network reconnect
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline)
      window.addEventListener('focus', this.handleFocus)
      document.addEventListener('visibilitychange', this.handleVisibilityChange)
    }
  }

  /**
   * Stops background synchronization polling.
   */
  stop(): void {
    if (!this.isRunning) return
    this.isRunning = false

    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }

    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline)
      window.removeEventListener('focus', this.handleFocus)
      document.removeEventListener('visibilitychange', this.handleVisibilityChange)
    }
  }

  private canSync(): boolean {
    if (!this.isRunning) return false
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false
    return true
  }

  private handleOnline = () => {
    if (this.canSync()) {
      this.safeSync()
    }
  }

  private handleFocus = () => {
    if (this.canSync()) {
      this.safeSync()
    }
  }

  private handleVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      this.safeSync()
    }
  }

  private async safeSync(): Promise<void> {
    try {
      await this.client.pullAndApplyChanges()
    } catch {
      // Safe background polling failure — will retry on next cycle
    }
  }

  private async safeHeartbeat(): Promise<void> {
    try {
      await this.client.heartbeat()
    } catch {
      // Safe heartbeat failure
    }
  }

  getClient(): SyncClient {
    return this.client
  }
}

