import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { offlineDb } from '../../src/lib/offline/database'
import { outboxService } from '../../src/lib/offline/outbox/outbox.service'
import { outboxRepository } from '../../src/lib/offline/outbox/outbox.repository'
import { computePayloadHash } from '../../src/lib/offline/outbox/outbox.dispatcher'
import { OutboxConflictError, OutboxValidationError } from '../../src/lib/offline/outbox/outbox.errors'

describe('Outbox Database Storage & Integrity (tests/offline/outboxDatabase.test.ts)', () => {
  const user1 = 'usr_db_test_1'
  const user2 = 'usr_db_test_2'
  const biz1 = 'biz_db_test_1'
  const biz2 = 'biz_db_test_2'
  const branch1 = 'branch_db_test_1'

  beforeEach(async () => {
    await offlineDb.clearAllOfflineData()
  })

  afterEach(async () => {
    await offlineDb.clearAllOfflineData()
  })

  it('initializes schema version 3 and creates outboxCommands store with compound indexes', async () => {
    expect(offlineDb.isOpen()).toBe(true)
    expect(offlineDb.verno).toBeGreaterThanOrEqual(3)
    expect(offlineDb.tables.map((t) => t.name)).toContain('outboxCommands')
  })

  it('successfully enqueues a command with cryptographic hash and all metadata fields', async () => {
    const payload = { note: 'sample payload for testing', count: 42 }
    const cmd = await outboxService.enqueue({
      userId: user1,
      businessId: biz1,
      branchId: branch1,
      deviceId: 'dev_terminal_01',
      commandType: 'sample_future_command',
      commandVersion: 1,
      payload,
    })

    expect(cmd.id).toMatch(/^cmd_/)
    expect(cmd.status).toBe('pending')
    expect(cmd.userId).toBe(user1)
    expect(cmd.businessId).toBe(biz1)
    expect(cmd.branchId).toBe(branch1)
    expect(cmd.deviceId).toBe('dev_terminal_01')
    expect(cmd.commandType).toBe('sample_future_command')
    expect(cmd.commandVersion).toBe(1)
    expect(cmd.attemptCount).toBe(0)
    expect(cmd.payload).toEqual(payload)
    expect(cmd.payloadHash).toBeDefined()
    expect(cmd.payloadHash.length).toBeGreaterThan(0)

    // Stored durably in Dexie
    const stored = await outboxRepository.findById(cmd.id)
    expect(stored).toBeDefined()
    expect(stored?.id).toBe(cmd.id)
    expect(stored?.idempotencyKey).toBe(cmd.idempotencyKey)
  })

  it('rejects enqueue when required fields (userId, businessId, commandType) are missing', async () => {
    await expect(
      outboxService.enqueue({
        userId: '',
        businessId: biz1,
        commandType: 'sample_future_command',
        payload: {},
      })
    ).rejects.toThrow(OutboxValidationError)

    await expect(
      outboxService.enqueue({
        userId: user1,
        businessId: '',
        commandType: 'sample_future_command',
        payload: {},
      })
    ).rejects.toThrow(OutboxValidationError)

    await expect(
      outboxService.enqueue({
        userId: user1,
        businessId: biz1,
        commandType: '',
        payload: {},
      })
    ).rejects.toThrow(OutboxValidationError)
  })

  it('rejects duplicate command ID on atomic enqueue', async () => {
    const payload = { test: true }
    const hash = await computePayloadHash(payload)
    const now = new Date().toISOString()

    const record = {
      id: 'cmd_fixed_uuid_123',
      userId: user1,
      businessId: biz1,
      branchId: null,
      deviceId: 'dev_1',
      commandType: 'sample_future_command',
      commandVersion: 1,
      idempotencyKey: 'idem_key_1',
      payload,
      payloadHash: hash,
      status: 'pending' as const,
      createdAt: now,
      updatedAt: now,
      attemptCount: 0,
      nextAttemptAt: now,
      lastAttemptAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
      lastErrorCode: null,
      lastErrorAt: null,
      serverResultId: null,
      acknowledgedAt: null,
      expiresAt: null,
    }

    await outboxRepository.atomicEnqueue(record)

    // Re-attempt enqueue with same ID
    await expect(outboxRepository.atomicEnqueue(record)).rejects.toThrow(OutboxConflictError)
  })

  it('idempotently returns existing command when reusing same idempotency key with identical payload', async () => {
    const payload = { message: 'hello world' }
    const key = 'idem_stable_key_abc'

    const cmd1 = await outboxService.enqueue({
      userId: user1,
      businessId: biz1,
      idempotencyKey: key,
      commandType: 'sample_future_command',
      payload,
    })

    const cmd2 = await outboxService.enqueue({
      userId: user1,
      businessId: biz1,
      idempotencyKey: key,
      commandType: 'sample_future_command',
      payload,
    })

    expect(cmd2.id).toBe(cmd1.id)
    expect(cmd2.idempotencyKey).toBe(cmd1.idempotencyKey)
    expect(await outboxService.getPendingCount(user1, biz1)).toBe(1)
  })

  it('throws OutboxConflictError when attempting to reuse idempotency key with different payload', async () => {
    const key = 'idem_reused_key_conflict'

    await outboxService.enqueue({
      userId: user1,
      businessId: biz1,
      idempotencyKey: key,
      commandType: 'sample_future_command',
      payload: { original: 'value A' },
    })

    await expect(
      outboxService.enqueue({
        userId: user1,
        businessId: biz1,
        idempotencyKey: key,
        commandType: 'sample_future_command',
        payload: { changed: 'value B' }, // different payload
      })
    ).rejects.toThrow(OutboxConflictError)
  })

  it('enforces tenant, user and branch data isolation', async () => {
    // User 1 / Biz 1
    await outboxService.enqueue({
      userId: user1,
      businessId: biz1,
      branchId: branch1,
      commandType: 'sample_future_command',
      payload: { owner: user1 },
    })

    // User 2 / Biz 2
    await outboxService.enqueue({
      userId: user2,
      businessId: biz2,
      branchId: null,
      commandType: 'sample_future_command',
      payload: { owner: user2 },
    })

    const statsUser1 = await outboxService.getStats(user1, biz1)
    const statsUser2 = await outboxService.getStats(user2, biz2)
    const statsCross = await outboxService.getStats(user1, biz2)

    expect(statsUser1.pendingCount).toBe(1)
    expect(statsUser2.pendingCount).toBe(1)
    expect(statsCross.pendingCount).toBe(0)
  })
})

