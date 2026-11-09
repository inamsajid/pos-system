import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { offlineDb } from '../src/lib/offline/database'
import { outboxManager } from '../src/lib/offline/outbox/outboxManager'
import { isCommandAuthorizedForOfflineExecution } from '../src/lib/offline/outbox/commandRegistry'

describe('Step 13.4 Prerequisite Audit: Durable Outbox Foundation', () => {
  const userId = 'usr_outbox_test'
  const businessId = 'biz_outbox_test'

  beforeEach(async () => {
    await offlineDb.clearAllOfflineData()
  })

  afterEach(async () => {
    await offlineDb.clearAllOfflineData()
  })

  it('enqueues commands into durable Dexie outbox storage', async () => {
    const cmd = await outboxManager.enqueue({
      userId,
      businessId,
      branchId: 'branch_1',
      commandType: 'sample_future_command',
      payload: { note: 'test command' },
    })

    expect(cmd.id).toBeDefined()
    expect(cmd.status).toBe('pending')
    expect(cmd.userId).toBe(userId)
    expect(cmd.businessId).toBe(businessId)

    const stored = await offlineDb.outboxCommands.get(cmd.id)
    expect(stored).toBeDefined()
    expect(stored?.commandType).toBe('sample_future_command')
    expect(await outboxManager.getPendingCount(userId, businessId)).toBe(1)
  })

  it('deduplicates command enqueuing via idempotency key', async () => {
    const customKey = 'idem_key_unique_123'

    const cmd1 = await outboxManager.enqueue({
      userId,
      businessId,
      idempotencyKey: customKey,
      commandType: 'sample_command',
      payload: { value: 100 },
    })

    const cmd2 = await outboxManager.enqueue({
      userId,
      businessId,
      idempotencyKey: customKey,
      commandType: 'sample_command',
      payload: { value: 100 }, // same key, identical payload -> deduplicated
    })

    expect(cmd2.id).toBe(cmd1.id)
    expect(await outboxManager.getPendingCount(userId, businessId)).toBe(1)
  })

  it('strictly rejects execution of financial and inventory commands', async () => {
    const financialCommands = [
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

    for (const type of financialCommands) {
      const check = isCommandAuthorizedForOfflineExecution(type)
      expect(check.authorized).toBe(false)
      expect(check.reason).toContain('Offline execution of financial and inventory transactions is strictly disabled')
    }

    // When dispatched, outbox manager marks them as rejected and never executes them
    await outboxManager.enqueue({
      userId,
      businessId,
      commandType: 'create_sale',
      payload: { items: [{ productId: 'p1', quantity: 2 }] },
    })

    const results = await outboxManager.dispatchPending(userId, businessId)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('rejected')
    expect(results[0].error).toContain('strictly disabled until Step 13.6')

    const inDb = await offlineDb.outboxCommands.get(results[0].commandId)
    expect(inDb?.status).toBe('rejected')
  })
})

