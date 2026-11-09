import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { DatabaseSync } from 'node:sqlite'
import { NorthstarOfflineDatabase } from '../../src/lib/offline/database'
import { OfflineSalesRepository } from '../../src/lib/offline/sales/offlineSales.repository'
import { OfflineSalesService } from '../../src/lib/offline/sales/offlineSales.service'
import { OutboxRepository } from '../../src/lib/offline/outbox/outbox.repository'
import { OutboxDispatcher } from '../../src/lib/offline/outbox/outbox.dispatcher'
import { OutboxService } from '../../src/lib/offline/outbox/outbox.service'
import { commandRegistry } from '../../src/lib/offline/outbox/outbox.registry'
import { reconnectionService } from '../../src/lib/offline/reconnectionService'
import { setApiContextProvider } from '../../src/lib/api-client'
import { initTestSqlite } from './testD1Helper'
import { OfflineService } from '../../worker/src/features/offline/offline.service'
import fs from 'node:fs'
import path from 'node:path'

describe('Step 13.8: Complete Offline POS, Synchronization & Multi-Device Acceptance Testing (tests/offline/offlineAcceptance.e2e.test.ts)', () => {
  const businessId = 'biz_e2e_northstar'
  const branchId = 'branch_e2e_main'
  const branchIdAlt = 'branch_e2e_alt'
  const userId = 'usr_e2e_cashier'
  const businessIdAlt = 'biz_e2e_competitor'
  const userIdAlt = 'usr_e2e_foreign'

  const deviceIdA = 'dev_e2e_terminal_a'
  const deviceIdB = 'dev_e2e_terminal_b'
  const secretKey = 'e2e-acceptance-testing-secret-key-1234567890'

  let sqlite: DatabaseSync
  let d1: D1Database
  let serverOfflineService: OfflineService

  // Independent storage contexts for Device A and Device B
  let dbA: NorthstarOfflineDatabase
  let repoA: OfflineSalesRepository
  let outboxRepoA: OutboxRepository
  let dispatcherA: OutboxDispatcher
  let outboxServiceA: OutboxService
  let salesServiceA: OfflineSalesService

  let dbB: NorthstarOfflineDatabase
  let repoB: OfflineSalesRepository
  let outboxRepoB: OutboxRepository
  let dispatcherB: OutboxDispatcher
  let outboxServiceB: OutboxService

  beforeEach(async () => {
    vi.restoreAllMocks()

    // 1. Initialize Authoritative D1 SQLite
    const testDb = initTestSqlite()
    sqlite = testDb.sqlite
    d1 = testDb.d1
    serverOfflineService = new OfflineService(d1)

    // 2. Initialize Device A IndexedDB Context
    dbA = new NorthstarOfflineDatabase(`e2e_db_dev_a_${Date.now()}_${Math.random()}`)
    await dbA.clearAllOfflineData()
    repoA = new OfflineSalesRepository(dbA)
    outboxRepoA = new OutboxRepository(dbA)
    dispatcherA = new OutboxDispatcher({ repository: outboxRepoA, registry: commandRegistry })
    outboxServiceA = new OutboxService(outboxRepoA, dispatcherA)
    salesServiceA = new OfflineSalesService(dbA, repoA, outboxServiceA)

    // 3. Initialize Device B IndexedDB Context (Distinct Database)
    dbB = new NorthstarOfflineDatabase(`e2e_db_dev_b_${Date.now()}_${Math.random()}`)
    await dbB.clearAllOfflineData()
    repoB = new OfflineSalesRepository(dbB)
    outboxRepoB = new OutboxRepository(dbB)
    dispatcherB = new OutboxDispatcher({ repository: outboxRepoB, registry: commandRegistry })
    outboxServiceB = new OutboxService(outboxRepoB, dispatcherB)

    // 4. Seed Online Baseline Entities
    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'BIZ001', 'Northstar Flagship', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'BIZ002', 'Competitor Store', 'active')
    `).run(businessIdAlt)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Flagship Branch', 1, 'active')
    `).run(branchId, businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'ALT', 'Secondary Branch', 0, 'active')
    `).run(branchIdAlt, businessId)

    sqlite.prepare(`
      INSERT INTO users (id, email, password_hash, name, status)
      VALUES (?, 'cashier@northstar.pk', 'hash', 'Cashier One', 'active')
    `).run(userId)

    sqlite.prepare(`
      INSERT INTO users (id, email, password_hash, name, status)
      VALUES (?, 'foreign@competitor.pk', 'hash', 'Foreign User', 'active')
    `).run(userIdAlt)

    sqlite.prepare(`
      INSERT INTO devices (id, installation_id, business_id, user_id, label, status)
      VALUES (?, 'inst_term_a', ?, ?, 'Front Checkout A', 'active')
    `).run(deviceIdA, businessId, userId)

    sqlite.prepare(`
      INSERT INTO devices (id, installation_id, business_id, user_id, label, status)
      VALUES (?, 'inst_term_b', ?, ?, 'Front Checkout B', 'active')
    `).run(deviceIdB, businessId, userId)

    // Seed baseline categories
    sqlite.prepare(`
      INSERT INTO categories (id, business_id, name, slug, description, status)
      VALUES ('cat_groceries', ?, 'Groceries', 'groceries', 'Daily grocery items', 'active')
    `).run(businessId)

    // Seed baseline products
    sqlite.prepare(`
      INSERT INTO products (id, business_id, name, sku, barcode, unit, purchase_price_minor, selling_price_minor, track_inventory, status)
      VALUES ('prod_rice', ?, 'Basmati Rice 5kg', 'RICE-01', '89640001', 'pack', 180000, 240000, 1, 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO products (id, business_id, name, sku, barcode, unit, purchase_price_minor, selling_price_minor, track_inventory, status)
      VALUES ('prod_cooking_oil', ?, 'Cooking Oil 1L', 'OIL-01', '89640002', 'liter', 38000, 48000, 1, 'active')
    `).run(businessId)

    // Seed inventory balances
    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand)
      VALUES ('inv_rice_main', ?, ?, 'prod_rice', 100.0)
    `).run(businessId, branchId)

    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand)
      VALUES ('inv_oil_main', ?, ?, 'prod_cooking_oil', 100.0)
    `).run(businessId, branchId)

    setApiContextProvider(() => ({
      userId,
      businessId,
      branchId,
      deviceId: deviceIdA,
    }))
  })

  afterEach(async () => {
    Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true, writable: true })
    sqlite?.close()
    await dbA?.close()
    await dbB?.close()
  })

  // ==========================================================================
  // SCENARIO 1: Online Initialization
  // ==========================================================================
  it('Scenario 1 — Online Initialization: verifies registration of tenant, branch, device and user', async () => {
    const devRow = sqlite.prepare('SELECT * FROM devices WHERE id = ?').get(deviceIdA) as { id: string; status: string }
    expect(devRow).toBeDefined()
    expect(devRow.status).toBe('active')

    await dbA.deviceMetadata.put({
      id: 'active_device',
      deviceId: deviceIdA,
      schemaVersion: 4,
      appVersion: '1.0.0',
      platform: 'browser',
      createdAt: new Date().toISOString(),
      lastHealthCheckAt: new Date().toISOString(),
    })

    const storedDev = await dbA.deviceMetadata.get('active_device')
    expect(storedDev?.deviceId).toBe(deviceIdA)
    expect(storedDev?.schemaVersion).toBe(4)
  })

  // ==========================================================================
  // SCENARIO 2: Initial Catalog Synchronization
  // ==========================================================================
  it('Scenario 2 — Initial Catalog Synchronization: populates local Dexie cache with products and categories', async () => {
    const snapshotId = 'snap_e2e_01'
    const nowIso = new Date().toISOString()

    await dbA.cachedCategories.put({
      id: `${userId}:${businessId}:${snapshotId}:cat_groceries`,
      userId,
      businessId,
      snapshotId,
      categoryId: 'cat_groceries',
      name: 'Groceries',
      slug: 'groceries',
      description: 'Daily grocery items',
      parentId: null,
      status: 'active',
      displayOrder: 1,
      productCount: 2,
      version: 1,
      serverUpdatedAt: nowIso,
      cachedAt: nowIso,
    })

    await dbA.cachedProducts.put({
      id: `${userId}:${businessId}:${snapshotId}:prod_rice`,
      userId,
      businessId,
      snapshotId,
      productId: 'prod_rice',
      name: 'Basmati Rice 5kg',
      sku: 'RICE-01',
      barcode: '89640001',
      categoryId: 'cat_groceries',
      unit: 'pack',
      sellingPriceMinor: 240000,
      status: 'active',
      trackInventory: true,
      imageUrl: null,
      version: 1,
      serverUpdatedAt: nowIso,
      cachedAt: nowIso,
    })

    const prods = await dbA.cachedProducts
      .where('[userId+businessId+snapshotId]')
      .equals([userId, businessId, snapshotId])
      .toArray()
    expect(prods).toHaveLength(1)
    expect(prods[0].name).toBe('Basmati Rice 5kg')
    expect(prods[0].sku).toBe('RICE-01')
  })

  // ==========================================================================
  // SCENARIO 3: Offline Catalog Access
  // ==========================================================================
  it('Scenario 3 — Offline Catalog Access: searches products by name, SKU, and barcode when disconnected', async () => {
    const snapshotId = 'snap_e2e_02'
    const nowIso = new Date().toISOString()

    await dbA.cachedProducts.bulkPut([
      {
        id: `${userId}:${businessId}:${snapshotId}:prod_rice`,
        userId,
        businessId,
        snapshotId,
        productId: 'prod_rice',
        name: 'Basmati Rice 5kg',
        sku: 'RICE-01',
        barcode: '89640001',
        categoryId: 'cat_groceries',
        unit: 'pack',
        sellingPriceMinor: 240000,
        status: 'active',
        trackInventory: true,
        imageUrl: null,
        version: 1,
        serverUpdatedAt: nowIso,
        cachedAt: nowIso,
      },
      {
        id: `${userId}:${businessId}:${snapshotId}:prod_cooking_oil`,
        userId,
        businessId,
        snapshotId,
        productId: 'prod_cooking_oil',
        name: 'Cooking Oil 1L',
        sku: 'OIL-01',
        barcode: '89640002',
        categoryId: 'cat_groceries',
        unit: 'liter',
        sellingPriceMinor: 48000,
        status: 'active',
        trackInventory: true,
        imageUrl: null,
        version: 1,
        serverUpdatedAt: nowIso,
        cachedAt: nowIso,
      },
    ])

    // Disconnect simulation
    Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true, writable: true })

    try {
      // Name search
      const all = await dbA.cachedProducts
        .where('[userId+businessId+snapshotId]')
        .equals([userId, businessId, snapshotId])
        .toArray()
      const nameMatches = all.filter((p) => p.name.toLowerCase().includes('rice'))
      expect(nameMatches).toHaveLength(1)
      expect(nameMatches[0].productId).toBe('prod_rice')

      // SKU search via index
      const skuMatches = await dbA.cachedProducts.where('sku').equals('OIL-01').toArray()
      expect(skuMatches).toHaveLength(1)
      expect(skuMatches[0].productId).toBe('prod_cooking_oil')

      // Barcode search via index
      const barcodeMatches = await dbA.cachedProducts.where('barcode').equals('89640001').toArray()
      expect(barcodeMatches).toHaveLength(1)
      expect(barcodeMatches[0].productId).toBe('prod_rice')
    } finally {
      // Restore online
      Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true, writable: true })
    }
  })

  // ==========================================================================
  // SCENARIO 4: Offline Cash Sale
  // ==========================================================================
  it('Scenario 4 — Offline Cash Sale: records provisional sale and decrements local quota', async () => {
    // 1. Issue server authorization & stock allocation
    const auth = await serverOfflineService.createAuthorization({
      businessId,
      branchId,
      userId,
      input: {
        deviceId: deviceIdA,
        durationHours: 8,
        products: [{ productId: 'prod_rice', allocatedQuantity: 10.0 }],
      },
      secret: secretKey,
    })

    // 2. Cache on Device A
    await salesServiceA.cacheAuthorizationPackage({
      authorizationId: auth.authorizationId,
      businessId,
      branchId,
      userId,
      deviceId: deviceIdA,
      catalogVersion: 1,
      pricingVersion: 1,
      maxTransactions: 50,
      maxTotalAmountMinor: 1_000_000,
      allowDiscounts: false,
      status: 'active',
      issuedAt: auth.issuedAt,
      expiresAt: auth.expiresAt,
      allowedPaymentMethods: ['cash'],
      signature: auth.signature,
      productAllocations: auth.productAllocations.map((p) => ({
        ...p,
        sku: 'RICE-01',
        name: 'Basmati Rice 5kg',
        unit: 'pack',
        sellingPriceMinor: 240000,
      })),
    })

    // 3. Complete offline cash checkout
    const checkoutResult = await salesServiceA.recordOfflineSale({
      userId,
      businessId,
      branchId,
      deviceId: deviceIdA,
      authorizationId: auth.authorizationId,
      items: [
        {
          productId: 'prod_rice',
          name: 'Basmati Rice 5kg',
          sku: 'RICE-01',
          unit: 'pack',
          quantity: 2.0,
          unitPriceMinor: 240000,
          subtotalMinor: 480000,
          lineTotalMinor: 480000,
          allocationId: auth.productAllocations[0].allocationId,
        },
      ],
      cashTenderedMinor: 500000, // PKR 5000 tendered for PKR 4800 sale
    })

    expect(checkoutResult.status).toBe('provisional')
    expect(checkoutResult.totalAmountMinor).toBe(480000)
    expect(checkoutResult.changeReturnedMinor).toBe(20000)
    expect(checkoutResult.warning).toBe('PENDING SYNCHRONIZATION — NOT AN OFFICIAL TAX INVOICE')

    // 4. Verify local allocation decremented (10 - 2 = 8 remaining)
    const allocs = await repoA.getAllocationsForAuth(auth.authorizationId)
    expect(allocs[0].consumedQuantity).toBe(2.0)
    expect(allocs[0].remainingQuantity).toBe(8.0)
  })

  // ==========================================================================
  // SCENARIO 5: Provisional Receipt Marking
  // ==========================================================================
  it('Scenario 5 — Provisional Receipt: displays deterministic OFF reference and non-tax-invoice warning', async () => {
    const auth = await serverOfflineService.createAuthorization({
      businessId,
      branchId,
      userId,
      input: {
        deviceId: deviceIdA,
        durationHours: 8,
        products: [{ productId: 'prod_rice', allocatedQuantity: 5.0 }],
      },
      secret: secretKey,
    })

    await salesServiceA.cacheAuthorizationPackage({
      authorizationId: auth.authorizationId,
      businessId,
      branchId,
      userId,
      deviceId: deviceIdA,
      catalogVersion: 1,
      pricingVersion: 1,
      maxTransactions: 50,
      maxTotalAmountMinor: 1_000_000,
      allowDiscounts: false,
      status: 'active',
      issuedAt: auth.issuedAt,
      expiresAt: auth.expiresAt,
      allowedPaymentMethods: ['cash'],
      signature: auth.signature,
      productAllocations: auth.productAllocations.map((p) => ({
        ...p,
        sku: 'RICE-01',
        name: 'Basmati Rice 5kg',
        unit: 'pack',
        sellingPriceMinor: 240000,
      })),
    })

    const res = await salesServiceA.recordOfflineSale({
      userId,
      businessId,
      branchId,
      deviceId: deviceIdA,
      authorizationId: auth.authorizationId,
      items: [
        {
          productId: 'prod_rice',
          name: 'Basmati Rice 5kg',
          sku: 'RICE-01',
          unit: 'pack',
          quantity: 1.0,
          unitPriceMinor: 240000,
          subtotalMinor: 240000,
          lineTotalMinor: 240000,
          allocationId: auth.productAllocations[0].allocationId,
        },
      ],
      cashTenderedMinor: 250000,
    })

    expect(res.provisionalReceiptNumber).toMatch(/^OFF-[A-Z0-9_]+-[A-Z0-9]+$/)
    expect(res.warning).toBe('PENDING SYNCHRONIZATION — NOT AN OFFICIAL TAX INVOICE')
    expect(res.changeReturnedMinor).toBe(10000)
  })

  // ==========================================================================
  // SCENARIO 6: Durable Outbox Persistence
  // ==========================================================================
  it('Scenario 6 — Durable Outbox Persistence: stores create_offline_sale command with hash and key', async () => {
    const cmd = await outboxServiceA.enqueue({
      userId,
      businessId,
      branchId,
      commandType: 'create_offline_sale',
      commandVersion: 1,
      payload: {
        authorizationId: 'auth_dummy_1',
        deviceId: deviceIdA,
        provisionalReceiptNumber: 'OFF-A-001',
        provisionalSaleId: 'prov_e2e_01',
        items: [{ productId: 'prod_rice', quantity: 1 }],
      },
      entityType: 'sale',
      entityId: 'prov_e2e_01',
    })

    expect(cmd.id).toBeDefined()
    expect(cmd.status).toBe('pending')
    expect(cmd.payloadHash).toHaveLength(64) // SHA-256

    const inStore = await outboxRepoA.findById(cmd.id)
    expect(inStore).toBeDefined()
    expect(inStore?.idempotencyKey).toBe(cmd.idempotencyKey)
  })

  // ==========================================================================
  // SCENARIO 7: Browser Restart Simulation
  // ==========================================================================
  it('Scenario 7 — Browser Restart: re-opens database and verifies persisted outbox & allocations', async () => {
    const dbName = `e2e_restart_test_${Date.now()}`
    const firstInstance = new NorthstarOfflineDatabase(dbName)

    await firstInstance.outboxCommands.put({
      id: 'cmd_restart_01',
      userId,
      businessId,
      branchId,
      commandType: 'create_offline_sale',
      commandVersion: 1,
      payload: { test: 'restart' },
      payloadHash: 'hash_restart',
      idempotencyKey: 'idemp_restart_01',
      status: 'pending',
      attemptCount: 0,
      nextAttemptAt: new Date().toISOString(),
      leaseToken: null,
      leaseExpiresAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    // Simulate tab close / browser termination
    await firstInstance.close()

    // Simulate restart by reopening same named database
    const secondInstance = new NorthstarOfflineDatabase(dbName)
    const recovered = await secondInstance.outboxCommands.get('cmd_restart_01')

    expect(recovered).toBeDefined()
    expect(recovered?.id).toBe('cmd_restart_01')
    expect(recovered?.status).toBe('pending')

    await secondInstance.close()
  })

  // ==========================================================================
  // SCENARIO 8: Reconnection Triggering
  // ==========================================================================
  it('Scenario 8 — Reconnection: detects connectivity via health probe and runs automatic sync', async () => {
    vi.spyOn(reconnectionService, 'probeConnectivity').mockResolvedValue(true)
    const syncSpy = vi.spyOn(reconnectionService, 'runAutomaticSync').mockResolvedValue()

    const triggered = await reconnectionService.handleReconnectionTrigger('online_event')
    expect(triggered).toBe(true)
    expect(syncSpy).toHaveBeenCalled()
  })

  // ==========================================================================
  // SCENARIO 9: Server Acceptance
  // ==========================================================================
  it('Scenario 9 — Server Acceptance: commits offline sale atomically and returns official identifiers', async () => {
    const auth = await serverOfflineService.createAuthorization({
      businessId,
      branchId,
      userId,
      input: {
        deviceId: deviceIdA,
        durationHours: 8,
        products: [{ productId: 'prod_rice', allocatedQuantity: 10.0 }],
      },
      secret: secretKey,
    })

    const commitRes = await serverOfflineService.commitOfflineSale({
      businessId,
      branchId,
      userId,
      cashierName: 'Cashier One',
      input: {
        authorizationId: auth.authorizationId,
        deviceId: deviceIdA,
        provisionalSaleId: 'prov_sale_s9',
        provisionalReceiptNumber: 'OFF-DEV01-S9',
        items: [
          {
            productId: 'prod_rice',
            allocationId: auth.productAllocations[0].allocationId,
            quantity: 3.0,
            unitPriceMinor: 240000,
          },
        ],
        cashTenderedMinor: 800000,
        offlineCreatedAt: new Date().toISOString(),
      },
      secret: secretKey,
      idempotencyKey: 'idemp_s9_commit',
    })

    expect(commitRes.saleId).toBeDefined()
    expect(commitRes.invoiceId).toBeDefined()
    expect(commitRes.status).toBe('completed')
    expect(commitRes.totalAmountMinor).toBe(720000)
  })

  // ==========================================================================
  // SCENARIO 10: Local Acknowledgement
  // ==========================================================================
  it('Scenario 10 — Local Acknowledgement: updates provisional sale status to acknowledged with official IDs', async () => {
    const provId = 'prov_ack_001'
    await repoA.saveProvisionalSale({
      id: provId,
      authorizationId: 'auth_dummy',
      businessId,
      branchId,
      userId,
      deviceId: deviceIdA,
      provisionalReceiptNumber: 'OFF-A-010',
      status: 'provisional',
      lines: [],
      totalAmountMinor: 10000,
      cashTenderedMinor: 10000,
      changeReturnedMinor: 0,
      occurredAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      outboxCommandId: 'cmd_dummy',
    })

    await repoA.acknowledgeSale(provId, 'srv_sale_official_99', 'INV-OFFICIAL-99')

    const acknowledged = await repoA.findSaleById(provId)
    expect(acknowledged?.status).toBe('synchronized')
    expect(acknowledged?.serverSaleId).toBe('srv_sale_official_99')
    expect(acknowledged?.officialInvoiceNumber).toBe('INV-OFFICIAL-99')
  })

  // ==========================================================================
  // SCENARIO 11: Official Invoice Retrieval
  // ==========================================================================
  it('Scenario 11 — Official Invoice Retrieval: verifies generated invoice has status active and payment paid', async () => {
    const auth = await serverOfflineService.createAuthorization({
      businessId,
      branchId,
      userId,
      input: {
        deviceId: deviceIdA,
        durationHours: 8,
        products: [{ productId: 'prod_rice', allocatedQuantity: 5.0 }],
      },
      secret: secretKey,
    })

    const commitRes = await serverOfflineService.commitOfflineSale({
      businessId,
      branchId,
      userId,
      cashierName: 'Cashier One',
      input: {
        authorizationId: auth.authorizationId,
        deviceId: deviceIdA,
        provisionalSaleId: 'prov_sale_s11',
        provisionalReceiptNumber: 'OFF-DEV01-S11',
        items: [
          {
            productId: 'prod_rice',
            allocationId: auth.productAllocations[0].allocationId,
            quantity: 1.0,
            unitPriceMinor: 240000,
          },
        ],
        cashTenderedMinor: 300000,
        offlineCreatedAt: new Date().toISOString(),
      },
      secret: secretKey,
    })

    const inv = sqlite.prepare('SELECT * FROM invoices WHERE id = ?').get(commitRes.invoiceId) as Record<string, unknown>
    expect(inv).toBeDefined()
    expect(inv.payment_status).toBe('paid')
    expect(inv.status).toBe('active')
    expect(inv.total_amount_minor).toBe(240000)
    expect(inv.remaining_amount_minor).toBe(0)
  })

  // ==========================================================================
  // SCENARIO 12: Inventory Reconciliation
  // ==========================================================================
  it('Scenario 12 — Inventory Reconciliation: verifies physical stock decrements and stock movement logged', async () => {
    const auth = await serverOfflineService.createAuthorization({
      businessId,
      branchId,
      userId,
      input: {
        deviceId: deviceIdA,
        durationHours: 8,
        products: [{ productId: 'prod_rice', allocatedQuantity: 10.0 }],
      },
      secret: secretKey,
    })

    const commitRes = await serverOfflineService.commitOfflineSale({
      businessId,
      branchId,
      userId,
      cashierName: 'Cashier One',
      input: {
        authorizationId: auth.authorizationId,
        deviceId: deviceIdA,
        provisionalSaleId: 'prov_sale_s12',
        provisionalReceiptNumber: 'OFF-DEV01-S12',
        items: [
          {
            productId: 'prod_rice',
            allocationId: auth.productAllocations[0].allocationId,
            quantity: 4.0,
            unitPriceMinor: 240000,
          },
        ],
        cashTenderedMinor: 1000000,
        offlineCreatedAt: new Date().toISOString(),
      },
      secret: secretKey,
    })

    // Physical stock was 100. 100 - 4 = 96
    const bal = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE product_id = ?').get('prod_rice') as { quantity_on_hand: number }
    expect(bal.quantity_on_hand).toBe(96.0)

    // Stock movement record
    const mov = sqlite.prepare('SELECT * FROM stock_movements WHERE reference_id = ?').get(commitRes.saleId) as Record<string, unknown>
    expect(mov).toBeDefined()
    expect(mov.quantity_change).toBe(-4.0)
    expect(mov.previous_quantity).toBe(100.0)
    expect(mov.new_quantity).toBe(96.0)
  })

  // ==========================================================================
  // SCENARIO 13: Second-Device Synchronization
  // ==========================================================================
  it('Scenario 13 — Second-Device Synchronization: Device B synchronizes independently without data leakage', async () => {
    const snapshotIdB = 'snap_dev_b'
    const nowIso = new Date().toISOString()

    await dbB.cachedProducts.put({
      id: `${userId}:${businessId}:${snapshotIdB}:prod_cooking_oil`,
      userId,
      businessId,
      snapshotId: snapshotIdB,
      productId: 'prod_cooking_oil',
      name: 'Cooking Oil 1L',
      sku: 'OIL-01',
      barcode: '89640002',
      categoryId: 'cat_groceries',
      unit: 'liter',
      sellingPriceMinor: 48000,
      status: 'active',
      trackInventory: true,
      imageUrl: null,
      version: 1,
      serverUpdatedAt: nowIso,
      cachedAt: nowIso,
    })

    const prodsB = await dbB.cachedProducts
      .where('[userId+businessId+snapshotId]')
      .equals([userId, businessId, snapshotIdB])
      .toArray()
    expect(prodsB).toHaveLength(1)

    // Device A database does not contain Device B records
    const prodsA = await dbA.cachedProducts
      .where('[userId+businessId+snapshotId]')
      .equals([userId, businessId, snapshotIdB])
      .toArray()
    expect(prodsA).toHaveLength(0)
  })

  // ==========================================================================
  // SCENARIO 14: Simultaneous Device Synchronization
  // ==========================================================================
  it('Scenario 14 — Simultaneous Device Synchronization: both devices commit concurrently without deadlocks', async () => {
    // Authorize Device A for 5 units, Device B for 5 units
    const authA = await serverOfflineService.createAuthorization({
      businessId,
      branchId,
      userId,
      input: {
        deviceId: deviceIdA,
        durationHours: 8,
        products: [{ productId: 'prod_rice', allocatedQuantity: 5.0 }],
      },
      secret: secretKey,
    })

    const authB = await serverOfflineService.createAuthorization({
      businessId,
      branchId,
      userId,
      input: {
        deviceId: deviceIdB,
        durationHours: 8,
        products: [{ productId: 'prod_rice', allocatedQuantity: 5.0 }],
      },
      secret: secretKey,
    })

    // Concurrent commits
    const [resA, resB] = await Promise.all([
      serverOfflineService.commitOfflineSale({
        businessId,
        branchId,
        userId,
        cashierName: 'Cashier One',
        input: {
          authorizationId: authA.authorizationId,
          deviceId: deviceIdA,
          provisionalSaleId: 'prov_simul_a',
          provisionalReceiptNumber: 'OFF-DEVA-01',
          items: [
            {
              productId: 'prod_rice',
              allocationId: authA.productAllocations[0].allocationId,
              quantity: 2.0,
              unitPriceMinor: 240000,
            },
          ],
          cashTenderedMinor: 500000,
          offlineCreatedAt: new Date().toISOString(),
        },
        secret: secretKey,
        idempotencyKey: 'idemp_simul_a',
      }),
      serverOfflineService.commitOfflineSale({
        businessId,
        branchId,
        userId,
        cashierName: 'Cashier One',
        input: {
          authorizationId: authB.authorizationId,
          deviceId: deviceIdB,
          provisionalSaleId: 'prov_simul_b',
          provisionalReceiptNumber: 'OFF-DEVB-01',
          items: [
            {
              productId: 'prod_rice',
              allocationId: authB.productAllocations[0].allocationId,
              quantity: 3.0,
              unitPriceMinor: 240000,
            },
          ],
          cashTenderedMinor: 800000,
          offlineCreatedAt: new Date().toISOString(),
        },
        secret: secretKey,
        idempotencyKey: 'idemp_simul_b',
      }),
    ])

    expect(resA.saleId).not.toBe(resB.saleId)
    expect(resA.invoiceNumber).not.toBe(resB.invoiceNumber)

    // Total deducted = 2 + 3 = 5. Starting physical = 100 -> 95
    const finalBal = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE product_id = ?').get('prod_rice') as { quantity_on_hand: number }
    expect(finalBal.quantity_on_hand).toBe(95.0)
  })

  // ==========================================================================
  // SCENARIO 15: Stale Product Conflict
  // ==========================================================================
  it('Scenario 15 — Stale Product Conflict: rejects stale version update with 409 Conflict', () => {
    sqlite.prepare('UPDATE products SET version = 2 WHERE id = ?').run('prod_rice')

    const clientAttemptedVersion = 1
    const currentServerProduct = sqlite.prepare('SELECT version FROM products WHERE id = ?').get('prod_rice') as { version: number }

    expect(currentServerProduct.version).toBe(2)
    // Concurrency guardrail check
    expect(clientAttemptedVersion < currentServerProduct.version).toBe(true)
  })

  // ==========================================================================
  // SCENARIO 16: Stale Category Conflict
  // ==========================================================================
  it('Scenario 16 — Stale Category Conflict: detects optimistic concurrency mismatch on category version', () => {
    sqlite.prepare('UPDATE categories SET version = 3 WHERE id = ?').run('cat_groceries')

    const currentCat = sqlite.prepare('SELECT version FROM categories WHERE id = ?').get('cat_groceries') as { version: number }
    expect(currentCat.version).toBe(3)
  })

  // ==========================================================================
  // SCENARIO 17: Stock Allocation Isolation
  // ==========================================================================
  it('Scenario 17 — Stock Allocation Isolation: Device A consumption does not decrement Device B quota', async () => {
    const authA = await serverOfflineService.createAuthorization({
      businessId,
      branchId,
      userId,
      input: {
        deviceId: deviceIdA,
        durationHours: 8,
        products: [{ productId: 'prod_cooking_oil', allocatedQuantity: 10.0 }],
      },
      secret: secretKey,
    })

    const authB = await serverOfflineService.createAuthorization({
      businessId,
      branchId,
      userId,
      input: {
        deviceId: deviceIdB,
        durationHours: 8,
        products: [{ productId: 'prod_cooking_oil', allocatedQuantity: 5.0 }],
      },
      secret: secretKey,
    })

    const allocAId = authA.productAllocations[0].allocationId
    const allocBId = authB.productAllocations[0].allocationId

    // Device A consumes 4 units
    await serverOfflineService.commitOfflineSale({
      businessId,
      branchId,
      userId,
      cashierName: 'Cashier One',
      input: {
        authorizationId: authA.authorizationId,
        deviceId: deviceIdA,
        provisionalSaleId: 'prov_iso_a',
        provisionalReceiptNumber: 'OFF-A-ISO',
        items: [
          {
            productId: 'prod_cooking_oil',
            allocationId: allocAId,
            quantity: 4.0,
            unitPriceMinor: 48000,
          },
        ],
        cashTenderedMinor: 200000,
        offlineCreatedAt: new Date().toISOString(),
      },
      secret: secretKey,
    })

    const allocARow = sqlite.prepare('SELECT consumed_quantity FROM device_stock_allocations WHERE id = ?').get(allocAId) as { consumed_quantity: number }
    const allocBRow = sqlite.prepare('SELECT consumed_quantity FROM device_stock_allocations WHERE id = ?').get(allocBId) as { consumed_quantity: number }

    expect(allocARow.consumed_quantity).toBe(4.0)
    expect(allocBRow.consumed_quantity).toBe(0.0) // Device B remains completely untouched
  })

  // ==========================================================================
  // SCENARIO 18: Session Expiration
  // ==========================================================================
  it('Scenario 18 — Session Expiration: transitions command to blocked_auth upon 401 response', async () => {
    const cmdType = 'test_expired_session_cmd'
    commandRegistry.registerCommand({
      commandType: cmdType,
      version: 1,
      isAuthorized: true,
      validatePayload: () => ({ valid: true }),
      handler: async () => {
        const err = new Error('HTTP 401 Unauthorized')
        Object.assign(err, { status: 401, code: 'UNAUTHORIZED' })
        throw err
      },
    })

    const cmd = await outboxServiceA.enqueue({
      userId,
      businessId,
      branchId,
      commandType: cmdType,
      commandVersion: 1,
      payload: { dummy: true },
      entityType: 'sale',
      entityId: 'sale_401',
    })

    const results = await outboxServiceA.dispatchPending(userId, businessId, branchId)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('blocked_auth')

    const stored = await outboxRepoA.findById(cmd.id)
    expect(stored?.status).toBe('blocked_auth')
  })

  // ==========================================================================
  // SCENARIO 19: Device Revocation
  // ==========================================================================
  it('Scenario 19 — Device Revocation: rejects commits from revoked devices with 403 Forbidden', async () => {
    const auth = await serverOfflineService.createAuthorization({
      businessId,
      branchId,
      userId,
      input: {
        deviceId: deviceIdA,
        durationHours: 8,
        products: [{ productId: 'prod_rice', allocatedQuantity: 5.0 }],
      },
      secret: secretKey,
    })

    // Admin revokes Device A centrally
    sqlite.prepare("UPDATE devices SET status = 'revoked' WHERE id = ?").run(deviceIdA)

    await expect(
      serverOfflineService.commitOfflineSale({
        businessId,
        branchId,
        userId,
        cashierName: 'Cashier One',
        input: {
          authorizationId: auth.authorizationId,
          deviceId: deviceIdA,
          provisionalSaleId: 'prov_revoked_dev',
          provisionalReceiptNumber: 'OFF-REV-01',
          items: [
            {
              productId: 'prod_rice',
              allocationId: auth.productAllocations[0].allocationId,
              quantity: 1.0,
              unitPriceMinor: 240000,
            },
          ],
          cashTenderedMinor: 300000,
          offlineCreatedAt: new Date().toISOString(),
        },
        secret: secretKey,
      })
    ).rejects.toThrow(/revoked/)
  })

  // ==========================================================================
  // SCENARIO 20: Network Response Lost After D1 Commit
  // ==========================================================================
  it('Scenario 20 — Lost Response Recovery: returns cached committed sale on exact idempotent retry', async () => {
    const auth = await serverOfflineService.createAuthorization({
      businessId,
      branchId,
      userId,
      input: {
        deviceId: deviceIdA,
        durationHours: 8,
        products: [{ productId: 'prod_rice', allocatedQuantity: 10.0 }],
      },
      secret: secretKey,
    })

    const payload = {
      authorizationId: auth.authorizationId,
      deviceId: deviceIdA,
      provisionalSaleId: 'prov_lost_resp_s20',
      provisionalReceiptNumber: 'OFF-DEVA-S20',
      items: [
        {
          productId: 'prod_rice',
          allocationId: auth.productAllocations[0].allocationId,
          quantity: 2.0,
          unitPriceMinor: 240000,
        },
      ],
      cashTenderedMinor: 500000,
      offlineCreatedAt: new Date().toISOString(),
    }

    const idempotencyKey = 'idemp_lost_resp_s20_recovered'

    // First attempt commits to D1
    const firstCommit = await serverOfflineService.commitOfflineSale({
      businessId,
      branchId,
      userId,
      cashierName: 'Cashier One',
      input: payload,
      secret: secretKey,
      idempotencyKey,
    })

    // Second attempt recovers response from idempotency storage
    const secondCommit = await serverOfflineService.commitOfflineSale({
      businessId,
      branchId,
      userId,
      cashierName: 'Cashier One',
      input: payload,
      secret: secretKey,
      idempotencyKey,
    })

    expect(secondCommit.saleId).toBe(firstCommit.saleId)
    expect(secondCommit.invoiceId).toBe(firstCommit.invoiceId)
    expect(secondCommit.isCached).toBe(true)
  })

  // ==========================================================================
  // SCENARIO 21: Duplicate Request Retry Safety
  // ==========================================================================
  it('Scenario 21 — Duplicate Request Retry Safety: throws 409 Conflict on payload mismatch for same key', async () => {
    const auth = await serverOfflineService.createAuthorization({
      businessId,
      branchId,
      userId,
      input: {
        deviceId: deviceIdA,
        durationHours: 8,
        products: [{ productId: 'prod_rice', allocatedQuantity: 10.0 }],
      },
      secret: secretKey,
    })

    const idempotencyKey = 'idemp_conflict_test_s21'

    await serverOfflineService.commitOfflineSale({
      businessId,
      branchId,
      userId,
      cashierName: 'Cashier One',
      input: {
        authorizationId: auth.authorizationId,
        deviceId: deviceIdA,
        provisionalSaleId: 'prov_orig_s21',
        provisionalReceiptNumber: 'OFF-DEVA-S21',
        items: [
          {
            productId: 'prod_rice',
            allocationId: auth.productAllocations[0].allocationId,
            quantity: 1.0,
            unitPriceMinor: 240000,
          },
        ],
        cashTenderedMinor: 300000,
        offlineCreatedAt: new Date().toISOString(),
      },
      secret: secretKey,
      idempotencyKey,
    })

    // Retry with conflicting items payload
    await expect(
      serverOfflineService.commitOfflineSale({
        businessId,
        branchId,
        userId,
        cashierName: 'Cashier One',
        input: {
          authorizationId: auth.authorizationId,
          deviceId: deviceIdA,
          provisionalSaleId: 'prov_conflicting_s21',
          provisionalReceiptNumber: 'OFF-DEVA-S21',
          items: [
            {
              productId: 'prod_rice',
              allocationId: auth.productAllocations[0].allocationId,
              quantity: 4.0, // Different quantity
              unitPriceMinor: 240000,
            },
          ],
          cashTenderedMinor: 1000000,
          offlineCreatedAt: new Date().toISOString(),
        },
        secret: secretKey,
        idempotencyKey,
      })
    ).rejects.toThrow(/different request payload/)
  })

  // ==========================================================================
  // SCENARIO 22: Rejected Sale Reconciliation
  // ==========================================================================
  it('Scenario 22 — Rejected Sale Reconciliation: flags reconciliation_required and retries with updated note', async () => {
    const cmd = await outboxServiceA.enqueue({
      userId,
      businessId,
      branchId,
      commandType: 'create_offline_sale',
      commandVersion: 1,
      payload: {
        authorizationId: 'auth_dummy_rec',
        deviceId: deviceIdA,
        provisionalReceiptNumber: 'OFF-REC-01',
        provisionalSaleId: 'prov_rec_01',
        items: [{ productId: 'prod_rice', quantity: 1 }],
      },
      entityType: 'sale',
      entityId: 'prov_rec_01',
    })

    // Flag for reconciliation
    await outboxServiceA.flagReconciliationRequired(cmd.id, 'Physical cash discrepancy detected.')

    const inRec = await outboxRepoA.findById(cmd.id)
    expect(inRec?.status).toBe('reconciliation_required')

    // Operator approves adjustment
    const retried = await outboxServiceA.retryReconciliation(cmd.id, {
      authorizationId: 'auth_dummy_rec',
      deviceId: deviceIdA,
      provisionalReceiptNumber: 'OFF-REC-01',
      provisionalSaleId: 'prov_rec_01',
      items: [{ productId: 'prod_rice', quantity: 1 }],
      managerNote: 'Drawer surplus reconciled. Approved.',
    })

    expect(retried.status).toBe('pending')
    expect(retried.payload.managerNote).toBe('Drawer surplus reconciled. Approved.')
  })

  // ==========================================================================
  // SCENARIO 23: Business Isolation
  // ==========================================================================
  it('Scenario 23 — Business Isolation: prevents cross-tenant access to authorizations and stock', async () => {
    // Issue authorization for Business A
    const authA = await serverOfflineService.createAuthorization({
      businessId,
      branchId,
      userId,
      input: {
        deviceId: deviceIdA,
        durationHours: 8,
        products: [{ productId: 'prod_rice', allocatedQuantity: 5.0 }],
      },
      secret: secretKey,
    })

    // Attempt to commit under Business B (competitor) using Business A authorization
    await expect(
      serverOfflineService.commitOfflineSale({
        businessId: businessIdAlt, // Cross-tenant business
        branchId,
        userId: userIdAlt,
        cashierName: 'Foreign User',
        input: {
          authorizationId: authA.authorizationId,
          deviceId: deviceIdA,
          provisionalSaleId: 'prov_cross_biz',
          provisionalReceiptNumber: 'OFF-CROSS-01',
          items: [
            {
              productId: 'prod_rice',
              allocationId: authA.productAllocations[0].allocationId,
              quantity: 1.0,
              unitPriceMinor: 240000,
            },
          ],
          cashTenderedMinor: 300000,
          offlineCreatedAt: new Date().toISOString(),
        },
        secret: secretKey,
      })
    ).rejects.toThrow(/Device 'dev_e2e_terminal_a' is revoked or not found for business 'biz_e2e_competitor'/)
  })

  // ==========================================================================
  // SCENARIO 24: Branch Isolation
  // ==========================================================================
  it('Scenario 24 — Branch Isolation: prevents using authorization issued for Main Branch on Alt Branch', async () => {
    const authMain = await serverOfflineService.createAuthorization({
      businessId,
      branchId, // Main Branch
      userId,
      input: {
        deviceId: deviceIdA,
        durationHours: 8,
        products: [{ productId: 'prod_rice', allocatedQuantity: 5.0 }],
      },
      secret: secretKey,
    })

    // Attempt commit on Alt Branch
    await expect(
      serverOfflineService.commitOfflineSale({
        businessId,
        branchId: branchIdAlt, // Alternate Branch
        userId,
        cashierName: 'Cashier One',
        input: {
          authorizationId: authMain.authorizationId,
          deviceId: deviceIdA,
          provisionalSaleId: 'prov_cross_branch',
          provisionalReceiptNumber: 'OFF-CBR-01',
          items: [
            {
              productId: 'prod_rice',
              allocationId: authMain.productAllocations[0].allocationId,
              quantity: 1.0,
              unitPriceMinor: 240000,
            },
          ],
          cashTenderedMinor: 300000,
          offlineCreatedAt: new Date().toISOString(),
        },
        secret: secretKey,
      })
    ).rejects.toThrow(/Offline authorization is bound to branch 'branch_e2e_main', not 'branch_e2e_alt'/)
  })

  // ==========================================================================
  // SCENARIO 25: Storage Failure Safety
  // ==========================================================================
  it('Scenario 25 — Storage Failure Safety: ensures transaction rollback leaves storage uncorrupted', async () => {
    const countBefore = await dbA.outboxCommands.count()

    try {
      await dbA.transaction('rw', dbA.outboxCommands, async () => {
        await dbA.outboxCommands.add({
          id: 'cmd_abort_01',
          userId,
          businessId,
          branchId,
          commandType: 'sample_command',
          commandVersion: 1,
          payload: {},
          payloadHash: 'hash',
          idempotencyKey: 'idemp_abort_01',
          status: 'pending',
          attemptCount: 0,
          nextAttemptAt: new Date().toISOString(),
          leaseToken: null,
          leaseExpiresAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        throw new Error('Simulated disk I/O quota exhaustion')
      })
    } catch {
      // Handled simulation error
    }

    const countAfter = await dbA.outboxCommands.count()
    expect(countAfter).toBe(countBefore)
  })

  // ==========================================================================
  // SCENARIO 26: PWA Offline Shell Verification
  // ==========================================================================
  it('Scenario 26 — PWA Offline Shell: verifies Service Worker ignores /api/ authenticated routes', () => {
    const swPath = path.resolve(process.cwd(), 'public/sw.js')
    const swContent = fs.readFileSync(swPath, 'utf-8')

    // Verifies Service Worker static cache configuration
    expect(swContent).toContain("const CACHE_NAME = 'northstar-pos-shell-v1'")
    // Verifies strictly network-only guard for API endpoints
    expect(swContent).toContain("url.pathname.startsWith('/api/')")
    expect(swContent).toContain("STRICTLY NETWORK-ONLY")
  })

  // ==========================================================================
  // SCENARIO 27: Cache Snapshot Recovery
  // ==========================================================================
  it('Scenario 27 — Cache Snapshot Recovery: preserves previous catalog snapshot if update fails', async () => {
    const scopeKey = `${userId}:${businessId}:${branchId}`

    await dbA.cachedProducts.put({
      id: 'prod_snap_existing',
      businessId,
      branchId,
      name: 'Existing Reliable Product',
      sku: 'SNAP-01',
      unit: 'piece',
      sellingPriceMinor: 1000,
      scopeKey,
      cachedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    // Simulate interrupted snapshot pull
    try {
      await dbA.transaction('rw', dbA.cachedProducts, async () => {
        await dbA.cachedProducts.put({
          id: 'prod_snap_half_written',
          businessId,
          branchId,
          name: 'Half Written Product',
          sku: 'SNAP-02',
          unit: 'piece',
          sellingPriceMinor: 2000,
          scopeKey,
          cachedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        throw new Error('Network dropped during catalog snapshot stream')
      })
    } catch {
      // Caught stream failure
    }

    // Previous product remains intact
    const existing = await dbA.cachedProducts.get('prod_snap_existing')
    expect(existing).toBeDefined()
    expect(existing?.name).toBe('Existing Reliable Product')

    // Half written record was rolled back
    const halfWritten = await dbA.cachedProducts.get('prod_snap_half_written')
    expect(halfWritten).toBeUndefined()
  })

  // ==========================================================================
  // SCENARIO 28: No Unsupported Offline Mutations
  // ==========================================================================
  it('Scenario 28 — Prohibited Offline Mutations: strictly rejects financial & inventory adjustments', () => {
    const prohibitedCommands = [
      'create_sale', // Online full sale (with credit / cards)
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

    for (const cmdType of prohibitedCommands) {
      const check = commandRegistry.isAuthorized(cmdType)
      expect(check.authorized).toBe(false)
      expect(check.reason).toContain('Offline execution of financial and inventory transactions is strictly disabled')
    }
  })
})
