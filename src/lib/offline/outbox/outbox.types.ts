/**
 * Outbox Command Types and Domain Contracts (Step 13.4).
 */

import type { OutboxCommandRecord, OutboxCommandStatus } from '../database.types'

export type { OutboxCommandRecord, OutboxCommandStatus }

export interface EnqueueCommandInput {
  userId: string
  businessId: string
  branchId?: string | null
  deviceId?: string
  commandType: string
  commandVersion?: number
  idempotencyKey?: string
  payload: Record<string, unknown>
  expiresAt?: string | null
}

export interface CommandDispatchResult {
  commandId: string
  commandType: string
  status: OutboxCommandStatus
  response?: unknown
  error?: string
  errorCode?: string
}

export interface OutboxStats {
  pendingCount: number
  processingCount: number
  retryableCount: number
  conflictCount: number
  rejectedCount: number
  blockedAuthCount: number
  acknowledgedCount: number
  reconciliationRequiredCount?: number
  lastSyncAt: string | null
}

export type OutboxEventType =
  | 'COMMAND_ENQUEUED'
  | 'COMMAND_CLAIMED'
  | 'COMMAND_DISPATCHED'
  | 'COMMAND_ACKNOWLEDGED'
  | 'COMMAND_RETRYABLE'
  | 'COMMAND_CONFLICT'
  | 'COMMAND_BLOCKED_AUTH'
  | 'COMMAND_REJECTED'
  | 'COMMAND_CANCELLED'
  | 'COMMAND_RECONCILIATION_REQUIRED'
  | 'OUTBOX_STATS_UPDATED'

export interface OutboxEvent {
  type: OutboxEventType
  commandId?: string
  commandType?: string
  status?: OutboxCommandStatus
  stats?: OutboxStats
  timestamp: string
  details?: Record<string, unknown>
}

export type OutboxEventListener = (event: OutboxEvent) => void
