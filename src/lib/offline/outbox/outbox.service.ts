import { OutboxRepository, outboxRepository } from './outbox.repository'
import { OutboxDispatcher, outboxDispatcher, computePayloadHash } from './outbox.dispatcher'
export { computePayloadHash }
import { CommandRegistry, commandRegistry } from './outbox.registry'
import { outboxEventBus } from './outbox.events'
import { OutboxValidationError, OutboxConflictError } from './outbox.errors'
import type {
  EnqueueCommandInput,
  OutboxCommandRecord,
  CommandDispatchResult,
  OutboxStats,
  OutboxEventListener,
} from './outbox.types'

export class OutboxService {
  private readonly repo: OutboxRepository
  private readonly dispatcher: OutboxDispatcher
  private readonly registry: CommandRegistry

  constructor(
    repo: OutboxRepository = outboxRepository,
    dispatcher: OutboxDispatcher = outboxDispatcher,
    registry: CommandRegistry = commandRegistry
  ) {
    this.repo = repo
    this.dispatcher = dispatcher
    this.registry = registry
  }

  /**
   * Durably enqueues a command for synchronization.
   * Performs pre-enqueue schema validation, cryptographic payload hashing, and atomic idempotency checking.
   */
  async enqueue(input: EnqueueCommandInput): Promise<OutboxCommandRecord> {
    const { userId, businessId, branchId = null, commandType, payload } = input

    if (!userId || !businessId) {
      throw new OutboxValidationError('userId and businessId are required to enqueue an outbox command.')
    }
    if (!commandType || typeof commandType !== 'string' || !commandType.trim()) {
      throw new OutboxValidationError('commandType is required.')
    }
    if (!payload || typeof payload !== 'object') {
      throw new OutboxValidationError('payload must be a non-null object.')
    }

    const commandVersion = input.commandVersion || 1

    // Pre-enqueue schema & whitelist validation
    this.registry.validatePayload(commandType, commandVersion, payload)

    // Compute cryptographic SHA-256 payload fingerprint
    const payloadHash = await computePayloadHash(payload)

    // Generate stable idempotency key if not supplied
    const idempotencyKey =
      input.idempotencyKey ||
      (typeof crypto !== 'undefined' && crypto.randomUUID
        ? `idem_${commandType}_${crypto.randomUUID()}`
        : `idem_${commandType}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`)

    const commandId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? `cmd_${crypto.randomUUID()}`
        : `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

    const nowIso = new Date().toISOString()

    const record: OutboxCommandRecord = {
      id: commandId,
      userId,
      businessId,
      branchId,
      deviceId: input.deviceId || 'terminal_default',
      commandType,
      commandVersion,
      idempotencyKey,
      payload,
      payloadHash,
      status: 'pending',
      createdAt: nowIso,
      updatedAt: nowIso,
      attemptCount: 0,
      nextAttemptAt: nowIso,
      lastAttemptAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
      lastErrorCode: null,
      lastErrorAt: null,
      serverResultId: null,
      acknowledgedAt: null,
      expiresAt: input.expiresAt || null,
    }

    const saved = await this.repo.atomicEnqueue(record)

    outboxEventBus.emit({
      type: 'COMMAND_ENQUEUED',
      commandId: saved.id,
      commandType: saved.commandType,
      status: saved.status,
      timestamp: nowIso,
    })

    return saved
  }

  /**
   * Dispatches eligible pending commands for the active session.
   */
  async dispatchPending(
    userId: string,
    businessId: string,
    branchId?: string | null
  ): Promise<CommandDispatchResult[]> {
    return this.dispatcher.dispatchBatch({
      userId,
      businessId,
      branchId,
    })
  }

  /**
   * Returns current outbox metrics and health stats.
   */
  async getStats(userId: string, businessId: string): Promise<OutboxStats> {
    return this.repo.getStats(userId, businessId)
  }

  /**
   * Backwards-compatible helper for pending command count.
   */
  async getPendingCount(userId: string, businessId: string): Promise<number> {
    const stats = await this.repo.getStats(userId, businessId)
    return stats.pendingCount
  }

  /**
   * Cancels a command, moving it to terminal 'cancelled' state.
   */
  async cancelCommand(commandId: string): Promise<OutboxCommandRecord> {
    const existing = await this.repo.findById(commandId)
    if (!existing) {
      throw new Error(`Command '${commandId}' not found.`)
    }
    if (['acknowledged', 'cancelled'].includes(existing.status)) {
      throw new OutboxConflictError(`Cannot cancel command in '${existing.status}' status.`)
    }

    const nowIso = new Date().toISOString()
    const updated: OutboxCommandRecord = {
      ...existing,
      status: 'cancelled',
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: nowIso,
    }

    await this.repo.save(updated)

    outboxEventBus.emit({
      type: 'COMMAND_CANCELLED',
      commandId: existing.id,
      commandType: existing.commandType,
      status: 'cancelled',
      timestamp: nowIso,
    })

    return updated
  }

  /**
   * Resolves a conflict by re-enqueueing with updated parameters.
   */
  async retryConflict(
    commandId: string,
    updatedPayload?: Record<string, unknown>
  ): Promise<OutboxCommandRecord> {
    const existing = await this.repo.findById(commandId)
    if (!existing) {
      throw new Error(`Command '${commandId}' not found.`)
    }
    if (existing.status !== 'conflict') {
      throw new OutboxConflictError(`Command '${commandId}' is not in conflict status.`)
    }

    const nowIso = new Date().toISOString()
    const payload = updatedPayload || existing.payload
    const payloadHash = await computePayloadHash(payload)

    const updated: OutboxCommandRecord = {
      ...existing,
      payload,
      payloadHash,
      status: 'pending',
      nextAttemptAt: nowIso,
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: nowIso,
    }

    await this.repo.save(updated)
    return updated
  }

  /**
   * Flags a command as requiring manual operator reconciliation.
   */
  async flagReconciliationRequired(
    commandId: string,
    reason: string
  ): Promise<OutboxCommandRecord> {
    const existing = await this.repo.findById(commandId)
    if (!existing) {
      throw new Error(`Command '${commandId}' not found.`)
    }

    const nowIso = new Date().toISOString()
    const updated: OutboxCommandRecord = {
      ...existing,
      status: 'reconciliation_required',
      lastErrorCode: 'RECONCILIATION_REQUIRED',
      lastErrorAt: nowIso,
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: nowIso,
    }

    await this.repo.save(updated)

    outboxEventBus.emit({
      type: 'COMMAND_RECONCILIATION_REQUIRED',
      commandId: existing.id,
      commandType: existing.commandType,
      status: 'reconciliation_required',
      timestamp: nowIso,
      details: { reason },
    })

    return updated
  }

  /**
   * Resolves a reconciliation-required command and re-enqueues it for dispatch.
   */
  async retryReconciliation(
    commandId: string,
    updatedPayload?: Record<string, unknown>
  ): Promise<OutboxCommandRecord> {
    const existing = await this.repo.findById(commandId)
    if (!existing) {
      throw new Error(`Command '${commandId}' not found.`)
    }
    if (existing.status !== 'reconciliation_required') {
      throw new OutboxConflictError(`Command '${commandId}' is not in reconciliation_required status.`)
    }

    const nowIso = new Date().toISOString()
    const payload = updatedPayload || existing.payload
    const payloadHash = await computePayloadHash(payload)

    const updated: OutboxCommandRecord = {
      ...existing,
      payload,
      payloadHash,
      status: 'pending',
      nextAttemptAt: nowIso,
      attemptCount: 0,
      leaseToken: null,
      leaseExpiresAt: null,
      lastErrorCode: null,
      updatedAt: nowIso,
    }

    await this.repo.save(updated)
    return updated
  }

  /**
   * Subscribes to outbox events.
   */
  subscribe(listener: OutboxEventListener): () => void {
    return outboxEventBus.subscribe(listener)
  }
}

export const outboxService = new OutboxService()
export const outboxManager = outboxService // Alias for backwards compatibility
