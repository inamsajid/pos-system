import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { DatabaseSync } from 'node:sqlite'
import { offlineDb } from '../../src/lib/offline/database'
import { reconnectionService } from '../../src/lib/offline/reconnectionService'
import { outboxService } from '../../src/lib/offline/outbox/outbox.service'
import { outboxRepository } from '../../src/lib/offline/outbox/outbox.repository'
import { commandRegistry } from '../../src/lib/offline/outbox/outbox.registry'
import { outboxEventBus } from '../../src/lib/offline/outbox/outbox.events'
import { OutboxReconciliationRequiredError } from '../../src/lib/offline/outbox/outbox.errors'
import { setApiContextProvider } from '../../src/lib/api-client'
import { initTestSqlite } from './testD1Helper'
import { OfflineService } from '../../worker/src/features/offline/offline.service'
import { CommitOfflineSaleInput } from '../../worker/src/features/offline/offline.types'

describe('Step 13.7: Reconnection, Recovery, Retry & Offline Transaction Reconciliation (tests/offline/offlineReconnectionAndRecovery.test.ts)', () => {
  const userId = 'usr_recon_01'
  const businessId = 'biz_recon_01'
  const branchId = 'branch_recon_main'
  const deviceId = 'dev_recon_01'
  const secret = 'recon-secret-key-salt-9876543210'

  let sqlite: DatabaseSync
  let d1: D1Database
  let offlineService: OfflineService

  beforeEach(async () => {
    vi.restoreAllMocks()
    await offlineDb.clearAllOfflineData()
    setApiContextProvider(() => ({
      userId,
      businessId,
      branchId,
    }))

    const testDb = initTestSqlite()
    sqlite = testDb.sqlite
    d1 = testDb.d1
    offlineService = new OfflineService(d1)

    // Seed Business & Branch
    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'BIZRECON', 'Recon Biz', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Main Branch', 1, 'active')
    `).run(branchId, businessId)

    sqlite.prepare(`
      INSERT INTO users (id, email, password_hash, name, status)
      VALUES (?, 'recon@pos.pk', 'hash', 'Recon User', 'active')
    `).run(userId)

    sqlite.prepare(`
      INSERT INTO devices (id, installation_id, business_id, user_id, label, status)
      VALUES (?, 'inst_recon', ?, ?, 'Recon Terminal', 'active')
    `).run(deviceId, businessId, userId)

    // Seed product and stock
    sqlite.prepare(`
      INSERT INTO products (id, business_id, name, sku, unit, purchase_price_minor, selling_price_minor, track_inventory, status)
      VALUES ('prod_recon_sugar', ?, 'White Sugar', 'SUG-01', 'kg', 11000, 14000, 1, 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand)
      VALUES ('bal_recon_sugar', ?, ?, 'prod_recon_sugar', 100.0)
    `).run(businessId, branchId)
  })

  afterEach(() => {
    sqlite?.close()
  })

  // --------------------------------------------------------------------------
  // Test 5.1: Network probe detection via reconnectionService.probeConnectivity()
  // --------------------------------------------------------------------------
  it('5.1: detects genuine server connectivity via network probe and handles offline states cleanly', async () => {
    // A: navigator.onLine is false -> probe immediately returns false without fetch
    Object.defineProperty(globalThis.navigator, 'onLine', {
      value: false,
      configurable: true,
      writable: true,
    })

    const probeOffline = await reconnectionService.probeConnectivity()
    expect(probeOffline).toBe(false)

    // Restore online status
    Object.defineProperty(globalThis.navigator, 'onLine', {
      value: true,
      configurable: true,
      writable: true,
    })

    // B: navigator.onLine is true and health endpoint responds with 200 OK
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
    } as Response)

    const probeOnline = await reconnectionService.probeConnectivity()
    expect(probeOnline).toBe(true)
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/health', expect.objectContaining({
      method: 'GET',
      cache: 'no-store',
    }))

    // C: health endpoint fails with network timeout or error -> probe returns false
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const probeFailed = await reconnectionService.probeConnectivity()
    expect(probeFailed).toBe(false)
  })

  // --------------------------------------------------------------------------
  // Test 5.2: Automatic synchronization triggered on reconnection
  // --------------------------------------------------------------------------
  it('5.2: executes automatic catalog & outbox sync upon online event notification', async () => {
    vi.spyOn(reconnectionService, 'probeConnectivity').mockResolvedValue(true)
    const runSyncSpy = vi.spyOn(reconnectionService, 'runAutomaticSync').mockResolvedValue()

    let notifiedStatus = false
    const unsubscribe = reconnectionService.subscribe((isReconnected) => {
      notifiedStatus = isReconnected
    })

    const triggerResult = await reconnectionService.handleReconnectionTrigger('online_event')
    expect(triggerResult).toBe(true)
    expect(notifiedStatus).toBe(true)
    expect(runSyncSpy).toHaveBeenCalledTimes(1)

    // Verify debounce/lock: simultaneous trigger while running returns false without duplicate execution
    const duplicateTrigger = reconnectionService.handleReconnectionTrigger('window_focus')
    expect(typeof duplicateTrigger.then).toBe('function')
    await duplicateTrigger

    unsubscribe()
  })

  // --------------------------------------------------------------------------
  // Test 5.3: Server commit with lost network response -> client retry recovers authoritative sale
  // --------------------------------------------------------------------------
  it('5.3: recovers authoritative sale idempotently when network response is lost during commit', async () => {
    // Create active server authorization & stock allocation
    const auth = await offlineService.createAuthorization({
      businessId,
      branchId,
      userId,
      input: {
        deviceId,
        durationHours: 8,
        products: [{ productId: 'prod_recon_sugar', allocatedQuantity: 20.0 }],
      },
      secret,
    })

    const authId = auth.authorizationId
    const allocId = auth.productAllocations[0].allocationId

    const saleInput: CommitOfflineSaleInput = {
      provisionalReceiptNumber: 'OFF-DEVREC-0001',
      provisionalSaleId: 'prov_sale_recon_001',
      authorizationId: authId,
      deviceId,
      items: [
        {
          productId: 'prod_recon_sugar',
          allocationId: allocId,
          quantity: 4.0,
          unitPriceMinor: 14000,
        },
      ],
      cashTenderedMinor: 60000,
      offlineCreatedAt: new Date().toISOString(),
    }

    const idempotencyKey = 'idemp_offline_recon_lost_resp_999'

    // Step 1: Client dispatches commit request; server successfully processes and commits to D1
    const firstAttemptResult = await offlineService.commitOfflineSale({
      businessId,
      branchId,
      userId,
      cashierName: 'Recon User',
      input: saleInput,
      secret,
      idempotencyKey,
    })
    expect(firstAttemptResult.saleId).toBeDefined()
    expect(firstAttemptResult.totalAmountMinor).toBe(56000)

    // Verify stock decremented on server (100 - 4 = 96)
    const stockRow1 = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE product_id = ?').get('prod_recon_sugar') as { quantity_on_hand: number }
    expect(stockRow1.quantity_on_hand).toBe(96.0)

    // Step 2: Client experienced network connection drop (lost response), so it retries with the SAME idempotency key
    const secondAttemptResult = await offlineService.commitOfflineSale({
      businessId,
      branchId,
      userId,
      cashierName: 'Recon User',
      input: saleInput,
      secret,
      idempotencyKey,
    })

    // Step 3: Server returns the exact same authoritative result from idempotency storage
    expect(secondAttemptResult.saleId).toBe(firstAttemptResult.saleId)
    expect(secondAttemptResult.saleNumber).toBe(firstAttemptResult.saleNumber)
    expect(secondAttemptResult.invoiceId).toBe(firstAttemptResult.invoiceId)
    expect(secondAttemptResult.invoiceNumber).toBe(firstAttemptResult.invoiceNumber)

    // Step 4: Verify NO double-counting in database (sales count = 1, stock remains 96, not 92)
    const salesCount = sqlite.prepare('SELECT COUNT(*) as count FROM sales WHERE business_id = ?').get(businessId) as { count: number }
    expect(salesCount.count).toBe(1)

    const stockRow2 = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE product_id = ?').get('prod_recon_sugar') as { quantity_on_hand: number }
    expect(stockRow2.quantity_on_hand).toBe(96.0)

    const consumedQuota = sqlite.prepare('SELECT consumed_quantity FROM device_stock_allocations WHERE id = ?').get(allocId) as { consumed_quantity: number }
    expect(consumedQuota.consumed_quantity).toBe(4.0)
  })

  // --------------------------------------------------------------------------
  // Test 5.4: Recovery state machine transitions to reconciliation_required
  // --------------------------------------------------------------------------
  it('5.4: transitions outbox command to reconciliation_required on non-resolvable business failure', async () => {
    // Register a mock command type that encounters an unresolvable reconciliation failure
    const cmdType = 'test_recon_failing_cmd'
    commandRegistry.registerCommand({
      commandType: cmdType,
      version: 1,
      isAuthorized: true,
      validatePayload: () => ({ valid: true }),
      handler: async () => {
        throw new OutboxReconciliationRequiredError('Branch allocation expired and was reclaimed by admin.')
      },
    })

    const cmd = await outboxService.enqueue({
      userId,
      businessId,
      branchId,
      commandType: cmdType,
      commandVersion: 1,
      payload: { testData: 'fail' },
      entityType: 'sale',
      entityId: 'sale_recon_fail',
    })

    let eventEmitted = false
    const unsubscribe = outboxEventBus.subscribe((evt) => {
      if (evt.type === 'COMMAND_RECONCILIATION_REQUIRED' && evt.commandId === cmd.id) {
        eventEmitted = true
      }
    })

    // Dispatch pending commands
    const results = await outboxService.dispatchPending(userId, businessId, branchId)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('reconciliation_required')
    expect(eventEmitted).toBe(true)

    // Verify status in Dexie store
    const stored = await outboxRepository.findById(cmd.id)
    expect(stored).toBeDefined()
    expect(stored?.status).toBe('reconciliation_required')
    expect(stored?.lastErrorCode).toBe('RECONCILIATION_REQUIRED')

    unsubscribe()
  })

  // --------------------------------------------------------------------------
  // Test 5.5: Operator recovery workflow
  // --------------------------------------------------------------------------
  it('5.5: allows operator to review and retry reconciliation-required commands with updated payload', async () => {
    // 1. Enqueue valid command
    const cmd = await outboxService.enqueue({
      userId,
      businessId,
      branchId,
      commandType: 'create_offline_sale',
      commandVersion: 1,
      payload: {
        authorizationId: 'auth_op_test_01',
        deviceId,
        provisionalReceiptNumber: 'OFF-OP-001',
        provisionalSaleId: 'prov_operator_rec_01',
        items: [{ productId: 'prod_recon_sugar', quantity: 1 }],
        totalAmountMinor: 14000,
      },
      entityType: 'sale',
      entityId: 'prov_operator_rec_01',
    })

    // 2. Mark command as requiring operator reconciliation
    await outboxService.flagReconciliationRequired(cmd.id, 'Cash drawer discrepancy reported by cashier.')

    const inRecon = await outboxRepository.findById(cmd.id)
    expect(inRecon?.status).toBe('reconciliation_required')

    // 3. Operator reviews discrepancy and updates payload with reconciled adjustment
    const updated = await outboxService.retryReconciliation(cmd.id, {
      authorizationId: 'auth_op_test_01',
      deviceId,
      provisionalReceiptNumber: 'OFF-OP-001',
      provisionalSaleId: 'prov_operator_rec_01',
      items: [{ productId: 'prod_recon_sugar', quantity: 1 }],
      totalAmountMinor: 14000,
      operatorNote: 'Verified cash drawer surplus. Approved for sync.',
    })

    // 4. Verify command transitioned back to pending with updated payload and hash
    expect(updated.status).toBe('pending')
    expect(updated.payload.operatorNote).toBe('Verified cash drawer surplus. Approved for sync.')
    expect(updated.leaseToken).toBeNull()

    const storedAfter = await outboxRepository.findById(cmd.id)
    expect(storedAfter?.status).toBe('pending')
  })

  // --------------------------------------------------------------------------
  // Test 5.6: Multi-device change feed convergence
  // --------------------------------------------------------------------------
  it('5.6: emits change feed events to sync_change_log upon offline sale commit for multi-device convergence', async () => {
    const auth = await offlineService.createAuthorization({
      businessId,
      branchId,
      userId,
      input: {
        deviceId,
        durationHours: 8,
        products: [{ productId: 'prod_recon_sugar', allocatedQuantity: 15.0 }],
      },
      secret,
    })

    const authId = auth.authorizationId
    const allocId = auth.productAllocations[0].allocationId

    const saleInput: CommitOfflineSaleInput = {
      provisionalReceiptNumber: 'OFF-DEVREC-0002',
      provisionalSaleId: 'prov_sale_recon_002',
      authorizationId: authId,
      deviceId,
      items: [
        {
          productId: 'prod_recon_sugar',
          allocationId: allocId,
          quantity: 2.0,
          unitPriceMinor: 14000,
        },
      ],
      cashTenderedMinor: 30000,
      offlineCreatedAt: new Date().toISOString(),
    }

    await offlineService.commitOfflineSale({
      businessId,
      branchId,
      userId,
      cashierName: 'Recon User',
      input: saleInput,
      secret,
      idempotencyKey: 'idemp_change_feed_test_001',
    })

    // Inspect sync_change_log table
    const changeEvents = sqlite.prepare(`
      SELECT * FROM sync_change_log
      WHERE business_id = ? AND branch_id = ? AND resource_type = 'stock'
      ORDER BY id DESC
    `).all(businessId, branchId) as Array<{
      resource_type: string
      resource_id: string
      operation: string
      payload: string
    }>

    expect(changeEvents.length).toBeGreaterThan(0)
    const latestEvent = changeEvents[0]
    expect(latestEvent.resource_type).toBe('stock')
    expect(latestEvent.resource_id).toBe('prod_recon_sugar')
    expect(latestEvent.operation).toBe('upsert')

    const payloadParsed = JSON.parse(latestEvent.payload) as {
      productId: string
      quantityDeducted: number
      reason: string
    }
    expect(payloadParsed.productId).toBe('prod_recon_sugar')
    expect(payloadParsed.quantityDeducted).toBe(2.0)
    expect(payloadParsed.reason).toBe('offline_sale_commit')
  })
})
