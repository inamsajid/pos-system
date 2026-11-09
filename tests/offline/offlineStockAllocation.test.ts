import { describe, it, expect, beforeEach } from 'vitest'
import { initTestSqlite } from './testD1Helper'
import { OfflineService } from '../../worker/src/features/offline/offline.service'
import { SalesService } from '../../worker/src/features/sales/sales.service'
import { HttpError } from '../../worker/src/lib/errors'

describe('Step 13.6: Device-Scoped Stock Allocations & Anti-Overselling (tests/offline/offlineStockAllocation.test.ts)', () => {
  const businessId = 'biz_alloc_test'
  const branchId = 'branch_alloc_main'
  const userId = 'usr_alloc_user'
  const deviceA = 'dev_counter_a'
  const deviceB = 'dev_counter_b'
  const secret = 'test-offline-signing-secret-key-1234567890'

  let offlineService: OfflineService
  let salesService: SalesService

  beforeEach(() => {
    const { sqlite, d1 } = initTestSqlite()
    offlineService = new OfflineService(d1)
    salesService = new SalesService(d1)

    // Seed Business
    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'BIZALLOC', 'Allocation Supermarket', 'active')
    `).run(businessId)

    // Seed Branch
    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Main Branch', 1, 'active')
    `).run(branchId, businessId)

    // Seed Business Settings (allow_negative_stock = 0: strictly forbidden)
    sqlite.prepare(`
      INSERT INTO business_settings (business_id, allow_negative_stock)
      VALUES (?, 0)
    `).run(businessId)

    // Seed User
    sqlite.prepare(`
      INSERT INTO users (id, email, password_hash, name, status)
      VALUES (?, 'cashier@alloc.test', 'hash', 'Cashier Alloc', 'active')
    `).run(userId)

    // Seed Devices A and B
    sqlite.prepare(`
      INSERT INTO devices (id, installation_id, business_id, user_id, label, status)
      VALUES (?, 'inst_a', ?, ?, 'Terminal A', 'active'),
             (?, 'inst_b', ?, ?, 'Terminal B', 'active')
    `).run(deviceA, businessId, userId, deviceB, businessId, userId)

    // Seed Tracked Product (Sugar: 20 kg in physical stock)
    sqlite.prepare(`
      INSERT INTO products (id, business_id, name, sku, unit, purchase_price_minor, selling_price_minor, track_inventory, status)
      VALUES ('prod_sugar', ?, 'White Sugar', 'SUGAR-01', 'kg', 12000, 16000, 1, 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand)
      VALUES ('inv_sugar', ?, ?, 'prod_sugar', 20.0)
    `).run(businessId, branchId)
  })

  it('2.1: successfully allocates stock within available physical balance', async () => {
    const auth = await offlineService.createAuthorization({
      businessId,
      branchId,
      userId,
      input: {
        deviceId: deviceA,
        products: [{ productId: 'prod_sugar', allocatedQuantity: 8.5 }],
      },
      secret,
    })

    expect(auth.productAllocations).toHaveLength(1)
    expect(auth.productAllocations[0].allocatedQuantity).toBe(8.5)
    expect(auth.productAllocations[0].remainingQuantity).toBe(8.5)
  })

  it('2.2: rejects allocation request that exceeds available physical stock', async () => {
    // Sugar physical stock is 20 kg; requesting 25 kg must be rejected with INSUFFICIENT_STOCK
    await expect(
      offlineService.createAuthorization({
        businessId,
        branchId,
        userId,
        input: {
          deviceId: deviceA,
          products: [{ productId: 'prod_sugar', allocatedQuantity: 25.0 }],
        },
        secret,
      })
    ).rejects.toThrow(HttpError)
  })

  it('2.3: multiple devices receive non-overlapping quotas', async () => {
    // Device A allocates 12 kg (leaving 8 kg available out of 20 kg)
    const authA = await offlineService.createAuthorization({
      businessId,
      branchId,
      userId,
      input: {
        deviceId: deviceA,
        products: [{ productId: 'prod_sugar', allocatedQuantity: 12.0 }],
      },
      secret,
    })
    expect(authA.productAllocations[0].allocatedQuantity).toBe(12.0)

    // Device B attempts to allocate 10 kg -> should be rejected because only 8 kg is available
    await expect(
      offlineService.createAuthorization({
        businessId,
        branchId,
        userId,
        input: {
          deviceId: deviceB,
          products: [{ productId: 'prod_sugar', allocatedQuantity: 10.0 }],
        },
        secret,
      })
    ).rejects.toThrow(/Insufficient available stock/)

    // Device B allocates 8 kg -> succeeds
    const authB = await offlineService.createAuthorization({
      businessId,
      branchId,
      userId,
      input: {
        deviceId: deviceB,
        products: [{ productId: 'prod_sugar', allocatedQuantity: 8.0 }],
      },
      secret,
    })
    expect(authB.productAllocations[0].allocatedQuantity).toBe(8.0)
  })

  it('2.4: online sales respect reserved offline quota (cannot consume allocated stock)', async () => {
    // Physical stock = 20 kg. Device A reserves 15 kg for offline operations.
    await offlineService.createAuthorization({
      businessId,
      branchId,
      userId,
      input: {
        deviceId: deviceA,
        products: [{ productId: 'prod_sugar', allocatedQuantity: 15.0 }],
      },
      secret,
    })

    // Online customer attempts to purchase 10 kg (only 5 kg available to sell online)
    await expect(
      salesService.completeSale(
        businessId,
        branchId,
        userId,
        'Cashier Online',
        {
          items: [{ productId: 'prod_sugar', quantity: 10.0 }],
          payments: [{ method: 'cash', amountMinor: 160000 }],
        }
      )
    ).rejects.toThrow(HttpError)

    // Online customer purchases 4 kg -> succeeds because 5 kg is unreserved
    const onlineSale = await salesService.completeSale(
      businessId,
      branchId,
      userId,
      'Cashier Online',
      {
        items: [{ productId: 'prod_sugar', quantity: 4.0 }],
        payments: [{ method: 'cash', amountMinor: 64000 }],
      }
    )
    expect(onlineSale.status).toBe('completed')
    expect(onlineSale.totalAmountMinor).toBe(64000)
  })

  it('2.5: reconciling an allocation releases unconsumed quota back into available pool', async () => {
    // Device A allocates 10 kg
    const auth = await offlineService.createAuthorization({
      businessId,
      branchId,
      userId,
      input: {
        deviceId: deviceA,
        products: [{ productId: 'prod_sugar', allocatedQuantity: 10.0 }],
      },
      secret,
    })
    const allocationId = auth.productAllocations[0].allocationId

    // Reconcile allocation
    const result = await offlineService.reconcileAllocation(businessId, allocationId)
    expect(result.status).toBe('reconciled')
    expect(result.releasedQuantity).toBe(10.0)

    // Now all 20 kg is available again for online sales
    const onlineSale = await salesService.completeSale(
      businessId,
      branchId,
      userId,
      'Cashier Online',
      {
        items: [{ productId: 'prod_sugar', quantity: 18.0 }],
        payments: [{ method: 'cash', amountMinor: 288000 }],
      }
    )
    expect(onlineSale.status).toBe('completed')
  })

  it('2.6: admin reconciliation for a lost device revokes device and releases all its active allocations', async () => {
    // Device A allocates 15 kg
    await offlineService.createAuthorization({
      businessId,
      branchId,
      userId,
      input: {
        deviceId: deviceA,
        products: [{ productId: 'prod_sugar', allocatedQuantity: 15.0 }],
      },
      secret,
    })

    // Terminal A is reported lost -> admin reconciles lost device
    const adminResult = await offlineService.reconcileLostDevice(businessId, deviceA)
    expect(adminResult.status).toBe('revoked')
    expect(adminResult.reconciledAllocationsCount).toBe(1)

    // Subsequent allocation attempt by revoked device fails
    await expect(
      offlineService.createAuthorization({
        businessId,
        branchId,
        userId,
        input: {
          deviceId: deviceA,
          products: [{ productId: 'prod_sugar', allocatedQuantity: 2.0 }],
        },
        secret,
      })
    ).rejects.toThrow(/revoked/)
  })
})

