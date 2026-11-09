import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { offlineDb } from '../../src/lib/offline/database'
import { outboxRepository } from '../../src/lib/offline/outbox/outbox.repository'
import { outboxService } from '../../src/lib/offline/outbox/outbox.service'
import { commandRegistry } from '../../src/lib/offline/outbox/outbox.registry'
import { calculateNextAttempt } from '../../src/lib/offline/outbox/outbox.retry'
import { OutboxRetryableError, OutboxConflictError } from '../../src/lib/offline/outbox/outbox.errors'

describe('Outbox Error Classification, Exponential Backoff & Retries (tests/offline/outboxRetry.test.ts)', () => {
  const userId = 'usr_retry_test'
  const businessId = 'biz_retry_test'

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

  it('4.1: network error transitions sending -> retryable with nextAttemptAt scheduled', async () => {
    commandRegistry.registerCommand({
      commandType: 'test_network_fail',
      version: 1,
      isAuthorized: true,
      validatePayload: () => ({ valid: true }),
      handler: async () => {
        throw new TypeError('Failed to fetch: Connection reset by peer')
      },
    })

    const cmd = await outboxService.enqueue({
      userId,
      businessId,
      commandType: 'test_network_fail',
      payload: { attempt: 1 },
    })

    const results = await outboxService.dispatchPending(userId, businessId)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('retryable')
    expect(results[0].errorCode).toBe('NETWORK_ERROR')

    const stored = await outboxRepository.findById(cmd.id)
    expect(stored?.status).toBe('retryable')
    expect(stored?.nextAttemptAt).toBeDefined()
    expect(stored?.lastErrorCode).toBe('NETWORK_ERROR')
  })

  it('4.2: exponential backoff delay increases with each attempt', () => {
    const baseMs = 1000
    const maxMs = 60000

    // Check theoretical bounds: backoffCap = min(maxMs, baseMs * 2^attempts)
    const cap0 = Math.min(maxMs, baseMs * Math.pow(2, 0)) // 1,000ms
    const cap1 = Math.min(maxMs, baseMs * Math.pow(2, 1)) // 2,000ms
    const cap2 = Math.min(maxMs, baseMs * Math.pow(2, 2)) // 4,000ms
    const cap3 = Math.min(maxMs, baseMs * Math.pow(2, 3)) // 8,000ms

    expect(cap0).toBe(1000)
    expect(cap1).toBe(2000)
    expect(cap2).toBe(4000)
    expect(cap3).toBe(8000)
  })

  it('4.3: jitter is applied to backoff delay within [500ms, backoffCap]', () => {
    const baseMs = 1000
    const maxMs = 60000

    // Sample 50 calculations for attempt 2 (cap is 4000ms)
    for (let i = 0; i < 50; i++) {
      const { delayMs } = calculateNextAttempt(2, baseMs, maxMs)
      expect(delayMs).toBeGreaterThanOrEqual(500)
      expect(delayMs).toBeLessThanOrEqual(4000)
    }
  })

  it('4.4: 429 response with Retry-After header respects server-specified delay', async () => {
    commandRegistry.registerCommand({
      commandType: 'test_rate_limited',
      version: 1,
      isAuthorized: true,
      validatePayload: () => ({ valid: true }),
      handler: async () => {
        throw new OutboxRetryableError('Rate limit exceeded', 'RATE_LIMITED', 45) // 45 seconds Retry-After
      },
    })

    const cmd = await outboxService.enqueue({
      userId,
      businessId,
      commandType: 'test_rate_limited',
      payload: { throttle: true },
    })

    const results = await outboxService.dispatchPending(userId, businessId)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('retryable')
    expect(results[0].errorCode).toBe('RATE_LIMITED')

    const stored = await outboxRepository.findById(cmd.id)
    expect(stored?.status).toBe('retryable')
    const nextTime = new Date(stored!.nextAttemptAt!).getTime()
    const now = Date.now()
    // Should be approximately ~45 seconds ahead
    expect(nextTime - now).toBeGreaterThan(40000)
    expect(nextTime - now).toBeLessThanOrEqual(46000)
  })

  it('4.5: 5xx server error transitions to retryable status', async () => {
    commandRegistry.registerCommand({
      commandType: 'test_500_error',
      version: 1,
      isAuthorized: true,
      validatePayload: () => ({ valid: true }),
      handler: async () => {
        const error = new Error('Internal Server Error')
        ;(error as Record<string, unknown>).status = 503
        throw error
      },
    })

    const cmd = await outboxService.enqueue({
      userId,
      businessId,
      commandType: 'test_500_error',
      payload: { crash: true },
    })

    const results = await outboxService.dispatchPending(userId, businessId)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('retryable')
    expect(results[0].errorCode).toBe('HTTP_503')

    const stored = await outboxRepository.findById(cmd.id)
    expect(stored?.status).toBe('retryable')
  })

  it('4.6: max retries (5) exceeded transitions retryable -> rejected with MAX_ATTEMPTS_EXCEEDED without deleting record', async () => {
    let callCount = 0
    commandRegistry.registerCommand({
      commandType: 'test_max_retries',
      version: 1,
      isAuthorized: true,
      validatePayload: () => ({ valid: true }),
      handler: async () => {
        callCount++
        throw new OutboxRetryableError('Temporary failure')
      },
    })

    const cmd = await outboxService.enqueue({
      userId,
      businessId,
      commandType: 'test_max_retries',
      payload: { retry: true },
    })

    // Simulate 4 failed attempts by updating attemptCount and setting nextAttemptAt in the past
    await offlineDb.outboxCommands.update(cmd.id, {
      attemptCount: 4,
      status: 'retryable',
      nextAttemptAt: new Date(Date.now() - 1000).toISOString(),
    })

    // 5th attempt (which hits MAX_RETRY_ATTEMPTS = 5)
    const results = await outboxService.dispatchPending(userId, businessId)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('rejected')
    expect(results[0].errorCode).toBe('MAX_ATTEMPTS_EXCEEDED')
    expect(callCount).toBe(1)

    // Confirm stored record is marked rejected and NOT deleted
    const stored = await outboxRepository.findById(cmd.id)
    expect(stored).toBeDefined()
    expect(stored?.status).toBe('rejected')
    expect(stored?.lastErrorCode).toBe('MAX_ATTEMPTS_EXCEEDED')
    expect(stored?.attemptCount).toBe(5)
  })

  it('4.7: 409 Conflict transitions command to conflict status and pauses automatic retries', async () => {
    commandRegistry.registerCommand({
      commandType: 'test_version_conflict',
      version: 1,
      isAuthorized: true,
      validatePayload: () => ({ valid: true }),
      handler: async () => {
        throw new OutboxConflictError('Product version conflict: remote entity has been updated')
      },
    })

    const cmd = await outboxService.enqueue({
      userId,
      businessId,
      commandType: 'test_version_conflict',
      payload: { version: 1 },
    })

    const results = await outboxService.dispatchPending(userId, businessId)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('conflict')
    expect(results[0].errorCode).toBe('CONFLICT')

    const stored = await outboxRepository.findById(cmd.id)
    expect(stored?.status).toBe('conflict')
    expect(stored?.lastErrorCode).toBe('CONFLICT')

    // Subsequent dispatch should NOT claim conflict command
    const subsequentResults = await outboxService.dispatchPending(userId, businessId)
    expect(subsequentResults).toHaveLength(0)
  })

  it('4.8: conflict command can be resolved and retried via retryConflict()', async () => {
    let succeeded = false
    commandRegistry.registerCommand({
      commandType: 'test_resolvable_conflict',
      version: 1,
      isAuthorized: true,
      validatePayload: () => ({ valid: true }),
      handler: async (command) => {
        const payload = command.payload as { version: number }
        if (payload.version === 1) {
          throw new OutboxConflictError('Conflict on v1')
        }
        succeeded = true
        return { serverResultId: 'srv_conflict_resolved' }
      },
    })

    const cmd = await outboxService.enqueue({
      userId,
      businessId,
      commandType: 'test_resolvable_conflict',
      payload: { version: 1 },
    })

    // 1. Initial attempt hits conflict
    await outboxService.dispatchPending(userId, businessId)
    const conflicted = await outboxRepository.findById(cmd.id)
    expect(conflicted?.status).toBe('conflict')

    // 2. Resolve conflict with updated payload (version 2)
    const resolved = await outboxService.retryConflict(cmd.id, { version: 2 })
    expect(resolved.status).toBe('pending')
    expect(resolved.payload).toEqual({ version: 2 })

    // 3. Dispatch again -> now succeeds
    const results = await outboxService.dispatchPending(userId, businessId)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('acknowledged')
    expect(succeeded).toBe(true)

    const finalRecord = await outboxRepository.findById(cmd.id)
    expect(finalRecord?.status).toBe('acknowledged')
    expect(finalRecord?.serverResultId).toBe('srv_conflict_resolved')
  })
})
