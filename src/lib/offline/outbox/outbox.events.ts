import type { OutboxEvent, OutboxEventListener } from './outbox.types'

class OutboxEventBus {
  private listeners = new Set<OutboxEventListener>()
  private broadcastChannel: BroadcastChannel | null = null

  constructor() {
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.broadcastChannel = new BroadcastChannel('pos_outbox_events')
        this.broadcastChannel.onmessage = (event) => {
          if (event.data && typeof event.data === 'object') {
            this.notifyLocal(event.data as OutboxEvent)
          }
        }
      } catch {
        // BroadcastChannel unsupported in test/isolated environments
      }
    }
  }

  subscribe(listener: OutboxEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(event: OutboxEvent): void {
    this.notifyLocal(event)
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(event)
      } catch {
        // Safe channel post failure
      }
    }
  }

  private notifyLocal(event: OutboxEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Safe execution of listener
      }
    }
  }

  destroy(): void {
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close()
      } catch {
        // Safe close
      }
      this.broadcastChannel = null
    }
    this.listeners.clear()
  }
}

export const outboxEventBus = new OutboxEventBus()

