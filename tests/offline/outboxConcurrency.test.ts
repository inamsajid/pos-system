import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { offlineDb } from '../../src/lib/offline/database'
import { outboxRepository } from '../../src/lib/offline/outbox/outbox.repository'
import { outboxService } from '../../src/lib/offline/outbox/outbox.service'
import { OutboxLeaseExpiredError } from '../../src/lib/offline/outbox/outbox.errors'

describe('Outbox Concurrency, Leases & Multi-Worker Coordination (tests/offline/outboxConcurrency.test.ts)', () => {
  const userId = 'usr_concurrency_test'
  const businessId = 'biz_concurrency_test'

  beforeEach(async () => {
    vi.restoreAllMocks()
    await offlineDb.clearAllOfflineData()
  })

  afterEach(async () => {
    await offlineDb.clearAllOfflineData()
  })

  it('3.1: claiming a batch sets leased status, leaseToken, and future leaseExpiresAt', async () => {
    const cmd = await outboxService.enqueue({
      userId,
      businessId,
      commandType: 'sample_future_command',
      payload: { test: 'lease-check' },
    })
    expect(cmd.status).toBe('pending')
    expect(cmd.leaseToken).toBeNull()
    expect(cmd.leaseExpiresAt).toBeNull()

    const claimed = await outboxRepository.claimEligibleBatch({
      userId,
      businessId,
      limit: 10,
      leaseDurationMs: 30000,
    })

    expect(claimed).toHaveLength(1)
    expect(claimed[0].id).toBe(cmd.id)
    expect(claimed[0].status).toBe('leased')
    expect(claimed[0].leaseToken).toBeDefined()
    expect(claimed[0].leaseToken?.length).toBeGreaterThan(10)
    expect(claimed[0].leaseExpiresAt).toBeDefined()
    expect(claimed[0].attemptCount).toBe(1)

    const leaseExpires = new Date(claimed[0].leaseExpiresAt!).getTime()
    expect(leaseExpires).toBeGreaterThan(Date.now() + 25000)
  })

  it('3.2: concurrent workers cannot claim the same command (second worker receives 0 claimed)', async () => {
    await outboxService.enqueue({
      userId,
      businessId,
      commandType: 'sample_future_command',
      payload: { single: 'item' },
    })

    // Worker A claims the batch
    const workerAClaims = await outboxRepository.claimEligibleBatch({
      userId,
      businessId,
      limit: 5,
      leaseDurationMs: 30000,
    })
    expect(workerAClaims).toHaveLength(1)
    expect(workerAClaims[0].status).toBe('leased')

    // Worker B immediately attempts to claim eligible commands
    const workerBClaims = await outboxRepository.claimEligibleBatch({
      userId,
      businessId,
      limit: 5,
      leaseDurationMs: 30000,
    })

    // Worker B should get 0 commands because Worker A holds an active unexpired lease
    expect(workerBClaims).toHaveLength(0)
  })

  it('3.3: expired lease is reclaimed by next worker after lease duration elapses', async () => {
    const cmd = await outboxService.enqueue({
      userId,
      businessId,
      commandType: 'sample_future_command',
      payload: { crash: 'recovery' },
    })

    // Worker 1 claims with very short lease (100ms) and then "crashes" (disappears)
    const worker1Claims = await outboxRepository.claimEligibleBatch({
      userId,
      businessId,
      limit: 1,
      leaseDurationMs: 100, // 100ms lease
    })
    expect(worker1Claims).toHaveLength(1)
    const originalLeaseToken = worker1Claims[0].leaseToken

    // Worker 2 attempts immediate claim -> fails because lease is active
    const immediateClaims = await outboxRepository.claimEligibleBatch({
      userId,
      businessId,
      limit: 1,
    })
    expect(immediateClaims).toHaveLength(0)

    // Wait 150ms for Worker 1 lease to expire
    await new Promise((resolve) => setTimeout(resolve, 150))

    // Worker 2 attempts claim -> safely reclaims abandoned lease
    const recoveredClaims = await outboxRepository.claimEligibleBatch({
      userId,
      businessId,
      limit: 1,
      leaseDurationMs: 30000,
    })
    expect(recoveredClaims).toHaveLength(1)
    expect(recoveredClaims[0].id).toBe(cmd.id)
    expect(recoveredClaims[0].leaseToken).not.toBe(originalLeaseToken)
    expect(recoveredClaims[0].attemptCount).toBe(2) // Incremented attempt count
  })

  it('3.4: active unexpired lease prevents other workers from claiming', async () => {
    await outboxService.enqueue({
      userId,
      businessId,
      commandType: 'sample_future_command',
      payload: { active: true },
    })

    const claims = await outboxRepository.claimEligibleBatch({
      userId,
      businessId,
      limit: 5,
      leaseDurationMs: 60000, // 1 minute lease
    })
    expect(claims).toHaveLength(1)

    // Other worker tries claiming repeatedly while lease is active
    for (let i = 0; i < 3; i++) {
      const otherClaims = await outboxRepository.claimEligibleBatch({
        userId,
        businessId,
      })
      expect(otherClaims).toHaveLength(0)
    }
  })

  it('3.5: worker cannot update command with mismatched lease token', async () => {
    await outboxService.enqueue({
      userId,
      businessId,
      commandType: 'sample_future_command',
      payload: { tokenMismatch: true },
    })

    const claims = await outboxRepository.claimEligibleBatch({
      userId,
      businessId,
    })
    const claimedCmd = claims[0]

    // Another worker with a forged/stale token tries to update command
    await expect(
      outboxRepository.updateWithLeaseCheck(claimedCmd.id, 'stale_or_wrong_token_xyz', {
        status: 'acknowledged',
      })
    ).rejects.toThrow(OutboxLeaseExpiredError)

    // Verify command is still leased and unchanged
    const stored = await outboxRepository.findById(claimedCmd.id)
    expect(stored?.status).toBe('leased')
  })

  it('3.6: worker cannot update command with expired lease token', async () => {
    await outboxService.enqueue({
      userId,
      businessId,
      commandType: 'sample_future_command',
      payload: { expiredUpdate: true },
    })

    // Claim with 50ms lease
    const claims = await outboxRepository.claimEligibleBatch({
      userId,
      businessId,
      leaseDurationMs: 50,
    })
    const claimedCmd = claims[0]
    const validToken = claimedCmd.leaseToken!

    // Wait 100ms for lease to expire
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Attempting update after lease expiry throws OutboxLeaseExpiredError
    await expect(
      outboxRepository.updateWithLeaseCheck(claimedCmd.id, validToken, {
        status: 'acknowledged',
      })
    ).rejects.toThrow(OutboxLeaseExpiredError)
  })
})

