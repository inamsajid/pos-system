import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { offlineDb } from '../../src/lib/offline/database'
import { outboxService } from '../../src/lib/offline/outbox/outbox.service'
import { outboxRepository } from '../../src/lib/offline/outbox/outbox.repository'
import { commandRegistry } from '../../src/lib/offline/outbox/outbox.registry'
import { OutboxValidationError, OutboxConflictError } from '../../src/lib/offline/outbox/outbox.errors'

describe('Outbox Command Lifecycle & State Transitions (tests/offline/outboxLifecycle.test.ts)', () => {
  const userId = 'usr_life_test'
  const businessId = 'biz_life_test'

  beforeEach(async () => {
    vi.restoreAllMocks()
    await offlineDb.clearAllOfflineData()

    vi.stubGlobal('navigator', {
      onLine: true,
    })
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await offlineDb.clearAllOfflineData()
  })

  it('completes the full successful lifecycle: pending -> leased -> sending -> acknowledged', async () => {
    // Register custom test command with handler
    commandRegistry.registerCommand({
      commandType: 'test_lifecycle_action',
      version: 1,
      isAuthorized: true,
      validatePayload: () => ({ valid: true }),
      handler: async (cmd) => {
        expect(cmd.status).toBe('sending')
        expect(cmd.leaseToken).toBeDefined()
        return { serverResultId: 'srv_ack_999', data: { processed: true } }
      },
    })

    // 1. Enqueue -> status is pending
    const cmd = await outboxService.enqueue({
      userId,
      businessId,
      commandType: 'test_lifecycle_action',
      payload: { step: 'one' },
    })
    expect(cmd.status).toBe('pending')

    // 2. Dispatch -> transitions to leased -> sending -> acknowledged
    const results = await outboxService.dispatchPending(userId, businessId)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('acknowledged')
    expect(results[0].response).toEqual({ processed: true })

    // 3. Stored record is acknowledged with metadata
    const finalRecord = await outboxRepository.findById(cmd.id)
    expect(finalRecord?.status).toBe('acknowledged')
    expect(finalRecord?.serverResultId).toBe('srv_ack_999')
    expect(finalRecord?.acknowledgedAt).toBeDefined()
    expect(finalRecord?.leaseToken).toBeNull()
  })

  it('rejects command with unsupported version during validation', async () => {
    await expect(
      outboxService.enqueue({
        userId,
        businessId,
        commandType: 'sample_future_command',
        commandVersion: 99, // unsupported version (only v1 supported)
        payload: { test: true },
      })
    ).rejects.toThrow(OutboxValidationError)
  })

  it('detects payload tampering and marks command as rejected with OutboxPayloadTamperedError', async () => {
    const cmd = await outboxService.enqueue({
      userId,
      businessId,
      commandType: 'sample_future_command',
      payload: { originalValue: 100 },
    })

    // Malicious or corrupted modification of payload directly in IndexedDB table
    await offlineDb.outboxCommands.update(cmd.id, {
      payload: { originalValue: 999999 }, // Tampered without updating payloadHash!
    })

    const results = await outboxService.dispatchPending(userId, businessId)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('rejected')
    expect(results[0].errorCode).toBe('PAYLOAD_TAMPERED')

    const updated = await outboxRepository.findById(cmd.id)
    expect(updated?.status).toBe('rejected')
    expect(updated?.lastErrorCode).toBe('PAYLOAD_TAMPERED')
  })

  it('allows cancelling a pending command and forbids cancelling an acknowledged command', async () => {
    const cmd = await outboxService.enqueue({
      userId,
      businessId,
      commandType: 'sample_future_command',
      payload: { cancelMe: true },
    })

    // Cancel pending command
    const cancelled = await outboxService.cancelCommand(cmd.id)
    expect(cancelled.status).toBe('cancelled')

    // Discarded command is not dispatched
    const results = await outboxService.dispatchPending(userId, businessId)
    expect(results).toHaveLength(0)

    // Cannot cancel terminal acknowledged command
    const cmd2 = await outboxService.enqueue({
      userId,
      businessId,
      commandType: 'sample_future_command',
      payload: { ackMe: true },
    })
    await outboxService.dispatchPending(userId, businessId)

    await expect(outboxService.cancelCommand(cmd2.id)).rejects.toThrow(OutboxConflictError)
  })

  it('prevents terminal state commands (cancelled, rejected, acknowledged) from being claimed or dispatched', async () => {
    // 1. Enqueue and cancel
    const cmdCancelled = await outboxService.enqueue({
      userId,
      businessId,
      commandType: 'sample_future_command',
      payload: { cancelMe: true },
    })
    await outboxService.cancelCommand(cmdCancelled.id)

    // 2. Dispatch pending commands - cancelled command should not be claimed
    const results = await outboxService.dispatchPending(userId, businessId)
    expect(results).toHaveLength(0)

    const record = await outboxRepository.findById(cmdCancelled.id)
    expect(record?.status).toBe('cancelled')
    expect(record?.leaseToken).toBeNull()
  })
})
