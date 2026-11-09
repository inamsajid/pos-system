import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { offlineDb } from '../../src/lib/offline/database'
import { outboxRepository } from '../../src/lib/offline/outbox/outbox.repository'
import { outboxService } from '../../src/lib/offline/outbox/outbox.service'
import { commandRegistry, isCommandAuthorizedForOfflineExecution } from '../../src/lib/offline/outbox/outbox.registry'
import { OutboxValidationError } from '../../src/lib/offline/outbox/outbox.errors'

describe('Outbox Security, Tenant Isolation & Command Authorization (tests/offline/outboxSecurity.test.ts)', () => {
  const userA = 'usr_alice'
  const userB = 'usr_bob'
  const businessId = 'biz_security_test'

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

  it('5.1: 401 Unauthorized / expired session transitions command to blocked_auth and halts execution', async () => {
    commandRegistry.registerCommand({
      commandType: 'test_expired_session',
      version: 1,
      isAuthorized: true,
      validatePayload: () => ({ valid: true }),
      handler: async () => {
        const error = new Error('Session expired or unauthorized')
        ;(error as Record<string, unknown>).status = 401
        throw error
      },
    })

    const cmd = await outboxService.enqueue({
      userId: userA,
      businessId,
      commandType: 'test_expired_session',
      payload: { secured: true },
    })

    const results = await outboxService.dispatchPending(userA, businessId)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('blocked_auth')
    expect(results[0].errorCode).toBe('AUTHENTICATION_REQUIRED')

    const stored = await outboxRepository.findById(cmd.id)
    expect(stored?.status).toBe('blocked_auth')
    expect(stored?.lastErrorCode).toBe('AUTHENTICATION_REQUIRED')
  })

  it('5.2: user switch isolates pending commands so another user never dispatches them', async () => {
    commandRegistry.registerCommand({
      commandType: 'test_user_isolation',
      version: 1,
      isAuthorized: true,
      validatePayload: () => ({ valid: true }),
      handler: async (command) => {
        return { serverResultId: `ack_${command.userId}` }
      },
    })

    // User Alice queues a command
    const cmdAlice = await outboxService.enqueue({
      userId: userA,
      businessId,
      commandType: 'test_user_isolation',
      payload: { user: 'Alice Private Action' },
    })

    // User Alice logs out and User Bob logs in
    // Dispatching Bob's pending commands must find 0 commands and NEVER touch Alice's command
    const bobResults = await outboxService.dispatchPending(userB, businessId)
    expect(bobResults).toHaveLength(0)

    // Alice's command remains untouched in pending
    const aliceRecord = await outboxRepository.findById(cmdAlice.id)
    expect(aliceRecord?.status).toBe('pending')
    expect(aliceRecord?.userId).toBe(userA)
    expect(aliceRecord?.leaseToken).toBeNull()

    // Alice logs back in later and dispatches her own commands
    const aliceResults = await outboxService.dispatchPending(userA, businessId)
    expect(aliceResults).toHaveLength(1)
    expect(aliceResults[0].commandId).toBe(cmdAlice.id)
    expect(aliceResults[0].status).toBe('acknowledged')
  })

  it('5.3: disallowed financial and inventory commands are strictly prohibited in registry', () => {
    const prohibited = [
      'create_sale',
      'void_sale',
      'record_customer_payment',
      'allocate_advance',
      'record_stock_adjustment',
      'record_stock_count',
      'confirm_stock_count',
      'create_purchase_order',
      'receive_goods',
      'record_supplier_payment',
    ]

    for (const cmdType of prohibited) {
      const check = commandRegistry.isAuthorized(cmdType)
      expect(check.authorized).toBe(false)
      expect(check.reason).toContain('Offline execution of financial and inventory transactions is strictly disabled')

      const legacyCheck = isCommandAuthorizedForOfflineExecution(cmdType)
      expect(legacyCheck.authorized).toBe(false)

      // Attempting to register an authorized handler for a prohibited command throws an immediate security error
      expect(() => {
        commandRegistry.registerCommand({
          commandType: cmdType,
          version: 1,
          isAuthorized: true,
          validatePayload: () => ({ valid: true }),
        })
      }).toThrow(/Security Violation: Cannot authorize financial command/)
    }
  })

  it('5.4: disallowed commands are rejected by dispatcher if somehow enqueued', async () => {
    // Enqueue create_sale directly (prohibited definition exists but isAuthorized is false)
    const cmd = await outboxService.enqueue({
      userId: userA,
      businessId,
      commandType: 'create_sale',
      payload: { total: 500 },
    })

    const results = await outboxService.dispatchPending(userA, businessId)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('rejected')
    expect(results[0].errorCode).toBe('UNAUTHORIZED_COMMAND')
    expect(results[0].error).toContain('strictly disabled')

    const stored = await outboxRepository.findById(cmd.id)
    expect(stored?.status).toBe('rejected')
    expect(stored?.lastErrorCode).toBe('UNAUTHORIZED_COMMAND')
  })

  it('5.5: non-whitelisted and arbitrary command types are rejected at enqueue validation', async () => {
    await expect(
      outboxService.enqueue({
        userId: userA,
        businessId,
        commandType: 'arbitrary_unwhitelisted_operation',
        payload: { evil: true },
      })
    ).rejects.toThrow(OutboxValidationError)
  })

  it('5.6: offline dispatcher skips execution when navigator.onLine is false without modifying state', async () => {
    const cmd = await outboxService.enqueue({
      userId: userA,
      businessId,
      commandType: 'sample_future_command',
      payload: { networkCheck: true },
    })

    // Simulate device going offline
    vi.stubGlobal('navigator', {
      onLine: false,
    })

    const results = await outboxService.dispatchPending(userA, businessId)
    expect(results).toHaveLength(0)

    // Stored command remains pending and unleased
    const stored = await outboxRepository.findById(cmd.id)
    expect(stored?.status).toBe('pending')
    expect(stored?.leaseToken).toBeNull()
    expect(stored?.attemptCount).toBe(0)
  })
})
