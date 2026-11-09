import { OutboxRepository, outboxRepository } from './outbox.repository'
import { CommandRegistry, commandRegistry } from './outbox.registry'
import { categorizeError, OutboxPayloadTamperedError } from './outbox.errors'
import { calculateNextAttempt, hasExceededMaxAttempts } from './outbox.retry'
import { outboxEventBus } from './outbox.events'
import type { CommandDispatchResult, OutboxCommandRecord } from './outbox.types'

/**
 * Computes deterministic SHA-256 hash of a payload object.
 */
export async function computePayloadHash(payload: unknown): Promise<string> {
  const canonicalJson = JSON.stringify(payload, Object.keys(payload as object).sort())
  const encoder = new TextEncoder()
  const data = encoder.encode(canonicalJson)

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  // Fallback simple numeric hash for non-crypto/Node environments
  let hash = 0
  for (let i = 0; i < canonicalJson.length; i++) {
    hash = (hash * 31 + canonicalJson.charCodeAt(i)) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export interface DispatcherOptions {
  repository?: OutboxRepository
  registry?: CommandRegistry
}

export class OutboxDispatcher {
  private readonly repo: OutboxRepository
  private readonly registry: CommandRegistry
  private isProcessing = false

  constructor(options: DispatcherOptions = {}) {
    this.repo = options.repository || outboxRepository
    this.registry = options.registry || commandRegistry
  }

  /**
   * Main dispatch loop: claims eligible commands and dispatches them sequentially.
   * Emits outbox events on each state transition.
   */
  async dispatchBatch(params: {
    userId: string
    businessId: string
    branchId?: string | null
    limit?: number
  }): Promise<CommandDispatchResult[]> {
    const { userId, businessId, branchId = null, limit = 10 } = params

    // 1. Guard online status
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return []
    }

    if (this.isProcessing) {
      return []
    }

    this.isProcessing = true
    try {
      // 2. Claim eligible batch using lease fencing
      const claimedCommands = await this.repo.claimEligibleBatch({
        userId,
        businessId,
        branchId,
        limit,
      })

      if (claimedCommands.length === 0) {
        return []
      }

      const results: CommandDispatchResult[] = []

      for (const cmd of claimedCommands) {
        const result = await this.dispatchSingle(cmd)
        results.push(result)
      }

      // Notify stats update
      const stats = await this.repo.getStats(userId, businessId)
      outboxEventBus.emit({
        type: 'OUTBOX_STATS_UPDATED',
        stats,
        timestamp: new Date().toISOString(),
      })

      return results
    } finally {
      this.isProcessing = false
    }
  }

  /**
   * Dispatches a single claimed command.
   */
  private async dispatchSingle(cmd: OutboxCommandRecord): Promise<CommandDispatchResult> {
    const leaseToken = cmd.leaseToken
    if (!leaseToken) {
      return {
        commandId: cmd.id,
        commandType: cmd.commandType,
        status: cmd.status,
        error: 'Command does not have an active lease token.',
      }
    }

    try {
      // 1. Verify Payload Integrity (SHA-256)
      const currentHash = await computePayloadHash(cmd.payload)
      if (currentHash !== cmd.payloadHash) {
        throw new OutboxPayloadTamperedError(
          `Payload hash mismatch for command '${cmd.id}'. Expected ${cmd.payloadHash}, computed ${currentHash}.`
        )
      }

      // 2. Verify Command Authorization in Registry
      const authCheck = this.registry.isAuthorized(cmd.commandType)
      if (!authCheck.authorized) {
        const reason = authCheck.reason || 'Command type is unauthorized for offline execution.'
        await this.repo.updateWithLeaseCheck(cmd.id, leaseToken, {
          status: 'rejected',
          lastErrorCode: 'UNAUTHORIZED_COMMAND',
          lastErrorAt: new Date().toISOString(),
        })

        outboxEventBus.emit({
          type: 'COMMAND_REJECTED',
          commandId: cmd.id,
          commandType: cmd.commandType,
          status: 'rejected',
          timestamp: new Date().toISOString(),
          details: { reason },
        })

        return {
          commandId: cmd.id,
          commandType: cmd.commandType,
          status: 'rejected',
          error: reason,
          errorCode: 'UNAUTHORIZED_COMMAND',
        }
      }

      // 3. Validate Schema Version and Payload
      const def = this.registry.getDefinition(cmd.commandType)
      if (!def) {
        throw new Error(`Handler for command type '${cmd.commandType}' is not registered.`)
      }

      this.registry.validatePayload(cmd.commandType, cmd.commandVersion, cmd.payload)

      // 4. Transition to 'sending'
      await this.repo.updateWithLeaseCheck(cmd.id, leaseToken, {
        status: 'sending',
      })

      // 5. Execute Registered Handler
      if (!def.handler) {
        throw new Error(`Command definition for '${cmd.commandType}' has no execution handler.`)
      }

      const sendingCmd = { ...cmd, status: 'sending' as const }
      const handlerResult = await def.handler(sendingCmd)
      const nowIso = new Date().toISOString()

      // 6. Transition to 'acknowledged'
      await this.repo.updateWithLeaseCheck(cmd.id, leaseToken, {
        status: 'acknowledged',
        serverResultId: handlerResult?.serverResultId || null,
        acknowledgedAt: nowIso,
        lastErrorCode: null,
      })

      outboxEventBus.emit({
        type: 'COMMAND_ACKNOWLEDGED',
        commandId: cmd.id,
        commandType: cmd.commandType,
        status: 'acknowledged',
        timestamp: nowIso,
      })

      return {
        commandId: cmd.id,
        commandType: cmd.commandType,
        status: 'acknowledged',
        response: handlerResult?.data,
      }
    } catch (err: unknown) {
      const nowIso = new Date().toISOString()
      const classified = categorizeError(err)

      if (classified.category === 'retryable') {
        if (hasExceededMaxAttempts(cmd.attemptCount)) {
          // Exceeded max retries -> transition to rejected
          await this.repo.updateWithLeaseCheck(cmd.id, leaseToken, {
            status: 'rejected',
            lastErrorCode: 'MAX_ATTEMPTS_EXCEEDED',
            lastErrorAt: nowIso,
          })

          outboxEventBus.emit({
            type: 'COMMAND_REJECTED',
            commandId: cmd.id,
            commandType: cmd.commandType,
            status: 'rejected',
            timestamp: nowIso,
            details: { reason: 'Maximum retry attempts exceeded.' },
          })

          return {
            commandId: cmd.id,
            commandType: cmd.commandType,
            status: 'rejected',
            error: 'Maximum retry attempts exceeded.',
            errorCode: 'MAX_ATTEMPTS_EXCEEDED',
          }
        }

        // Compute exponential backoff with jitter
        const { nextAttemptAt } = calculateNextAttempt(
          cmd.attemptCount,
          undefined,
          undefined,
          classified.retryAfterSeconds
        )

        await this.repo.updateWithLeaseCheck(cmd.id, leaseToken, {
          status: 'retryable',
          nextAttemptAt,
          lastErrorCode: classified.code,
          lastErrorAt: nowIso,
        })

        outboxEventBus.emit({
          type: 'COMMAND_RETRYABLE',
          commandId: cmd.id,
          commandType: cmd.commandType,
          status: 'retryable',
          timestamp: nowIso,
          details: { nextAttemptAt, error: classified.message },
        })

        return {
          commandId: cmd.id,
          commandType: cmd.commandType,
          status: 'retryable',
          error: classified.message,
          errorCode: classified.code,
        }
      }

      if (classified.category === 'blocked_auth') {
        await this.repo.updateWithLeaseCheck(cmd.id, leaseToken, {
          status: 'blocked_auth',
          lastErrorCode: classified.code,
          lastErrorAt: nowIso,
        })

        outboxEventBus.emit({
          type: 'COMMAND_BLOCKED_AUTH',
          commandId: cmd.id,
          commandType: cmd.commandType,
          status: 'blocked_auth',
          timestamp: nowIso,
          details: { error: classified.message },
        })

        return {
          commandId: cmd.id,
          commandType: cmd.commandType,
          status: 'blocked_auth',
          error: classified.message,
          errorCode: classified.code,
        }
      }

      if (classified.category === 'conflict') {
        await this.repo.updateWithLeaseCheck(cmd.id, leaseToken, {
          status: 'conflict',
          lastErrorCode: classified.code,
          lastErrorAt: nowIso,
        })

        outboxEventBus.emit({
          type: 'COMMAND_CONFLICT',
          commandId: cmd.id,
          commandType: cmd.commandType,
          status: 'conflict',
          timestamp: nowIso,
          details: { error: classified.message },
        })

        return {
          commandId: cmd.id,
          commandType: cmd.commandType,
          status: 'conflict',
          error: classified.message,
          errorCode: classified.code,
        }
      }

      if (classified.category === 'reconciliation_required') {
        await this.repo.updateWithLeaseCheck(cmd.id, leaseToken, {
          status: 'reconciliation_required',
          lastErrorCode: classified.code,
          lastErrorAt: nowIso,
        })

        outboxEventBus.emit({
          type: 'COMMAND_RECONCILIATION_REQUIRED',
          commandId: cmd.id,
          commandType: cmd.commandType,
          status: 'reconciliation_required',
          timestamp: nowIso,
          details: { error: classified.message },
        })

        return {
          commandId: cmd.id,
          commandType: cmd.commandType,
          status: 'reconciliation_required',
          error: classified.message,
          errorCode: classified.code,
        }
      }

      // Default: 'rejected'
      await this.repo.updateWithLeaseCheck(cmd.id, leaseToken, {
        status: 'rejected',
        lastErrorCode: classified.code,
        lastErrorAt: nowIso,
      })

      outboxEventBus.emit({
        type: 'COMMAND_REJECTED',
        commandId: cmd.id,
        commandType: cmd.commandType,
        status: 'rejected',
        timestamp: nowIso,
        details: { error: classified.message },
      })

      return {
        commandId: cmd.id,
        commandType: cmd.commandType,
        status: 'rejected',
        error: classified.message,
        errorCode: classified.code,
      }
    }
  }
}

export const outboxDispatcher = new OutboxDispatcher()
