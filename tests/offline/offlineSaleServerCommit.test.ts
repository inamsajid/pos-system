import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { initTestSqlite } from './testD1Helper'
import { OfflineService } from '../../worker/src/features/offline/offline.service'
import { HttpError } from '../../worker/src/lib/errors'

describe('Step 13.6 & 13.7: Atomic Server Offline Sale Commit & Server Idempotency (tests/offline/offlineSaleServerCommit.test.ts)', () => {
  const businessId = 'biz_commit_test'
  const branchId = 'branch_commit_main'
  const userId = 'usr_commit_user'
  const deviceId = 'dev_commit_terminal'
  const secret = 'test-offline-signing-secret-key-1234567890'

  let sqlite: DatabaseSync
  let offlineService: OfflineService
  let validAuthId: string
  let validAllocId: string

  beforeEach(async () => {
    const initialized = initTestSqlite()
    sqlite = initialized.sqlite
    offlineService = new OfflineService(initialized.d1)

    // Seed Business & Branch
    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'BIZCOMMIT', 'Commit Supermarket', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Main Store Branch', 1, 'active')
    `).run(branchId, businessId)

    sqlite.prepare(`
      INSERT INTO users (id, email, password_hash, name, status)
      VALUES (?, 'commit@test.com', 'hash', 'Cashier Commit', 'active')
    `).run(userId)

    sqlite.prepare(`
      INSERT INTO devices (id, installation_id, business_id, user_id, label, status)
      VALUES (?, 'inst_commit', ?, ?, 'Front Terminal', 'active')
    `).run(deviceId, businessId, userId)

    sqlite.prepare(`
      INSERT INTO products (id, business_id, name, sku, unit, purchase_price_minor, selling_price_minor, track_inventory, status)
      VALUES ('prod_oil', ?, 'Cooking Oil', 'OIL-01', 'liter', 32000, 42000, 1, 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand)
      VALUES ('inv_oil', ?, ?, 'prod_oil', 50.0)
    `).run(businessId, branchId)

    // Issue authorization with 10 liters allocated to device
    const auth = await offlineService.createAuthorization({
      businessId,
      branchId,
      userId,
      input: {
        deviceId,
        products: [{ productId: 'prod_oil', allocatedQuantity: 10.0 }],
      },
      secret,
    })

    validAuthId = auth.authorizationId
    validAllocId = auth.productAllocations[0].allocationId
  })

  it('4.1: commits offline sale atomically across all financial, inventory, quota, and change-log tables', async () => {
    const result = await offlineService.commitOfflineSale({
      businessId,
      branchId,
      userId,
      cashierName: 'Cashier Commit',
      input: {
        authorizationId: validAuthId,
        deviceId,
        provisionalSaleId: 'prov_sale_123',
        provisionalReceiptNumber: 'OFF-DEV01-SEQ1',
        items: [
          {
            productId: 'prod_oil',
            allocationId: validAllocId,
            quantity: 3.0,
            unitPriceMinor: 42000,
          },
        ],
        cashTenderedMinor: 150000, // PKR 1500 tendered for PKR 1260 sale (3 * 420 = 1260)
        offlineCreatedAt: new Date().toISOString(),
      },
      secret,
    })

    expect(result.status).toBe('completed')
    expect(result.totalAmountMinor).toBe(126000)
    expect(result.changeReturnedMinor).toBe(24000)
    expect(result.invoiceNumber).toMatch(/^INV-/)
    expect(result.saleNumber).toMatch(/^SALE-/)

    // 1. Verify sale header
    const saleRow = sqlite.prepare('SELECT * FROM sales WHERE id = ?').get(result.saleId) as Record<string, unknown>
    expect(saleRow).toBeDefined()
    expect(saleRow.total_amount_minor).toBe(126000)

    // 2. Verify invoice
    const invRow = sqlite.prepare('SELECT * FROM invoices WHERE id = ?').get(result.invoiceId) as Record<string, unknown>
    expect(invRow).toBeDefined()
    expect(invRow.payment_status).toBe('paid')
    expect(invRow.status).toBe('active')

    // 3. Verify cash payment
    const allocPayment = sqlite.prepare('SELECT * FROM payment_allocations WHERE sale_id = ?').get(result.saleId) as Record<string, unknown>
    expect(allocPayment).toBeDefined()
    const payMethod = sqlite.prepare('SELECT * FROM payment_methods WHERE payment_id = ?').get(allocPayment.payment_id) as Record<string, unknown>
    expect(payMethod).toBeDefined()
    expect(payMethod.method).toBe('cash')

    // 4. Verify stock movement and balance decrement (50 - 3 = 47)
    const movRow = sqlite.prepare('SELECT * FROM stock_movements WHERE reference_id = ?').get(result.saleId) as Record<string, unknown>
    expect(movRow).toBeDefined()
    expect(movRow.quantity_change).toBe(-3.0)

    const balRow = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE product_id = ?').get('prod_oil') as Record<string, unknown>
    expect(balRow.quantity_on_hand).toBe(47.0)

    // 5. Verify device allocation consumption (0 + 3 = 3 consumed, 7 remaining)
    const allocRow = sqlite.prepare('SELECT consumed_quantity FROM device_stock_allocations WHERE id = ?').get(validAllocId) as Record<string, unknown>
    expect(allocRow.consumed_quantity).toBe(3.0)

    // 6. Verify sync change log
    const changeRow = sqlite.prepare('SELECT * FROM sync_change_log WHERE resource_id = ?').get('prod_oil') as Record<string, unknown>
    expect(changeRow).toBeDefined()
    expect(changeRow.resource_type).toBe('stock')
  })

  it('4.2: exact idempotent retry returns original accepted result without duplicate sales or stock deduction', async () => {
    const saleInput = {
      authorizationId: validAuthId,
      deviceId,
      provisionalSaleId: 'prov_sale_idem_test',
      provisionalReceiptNumber: 'OFF-DEV01-IDEM',
      items: [
        {
          productId: 'prod_oil',
          allocationId: validAllocId,
          quantity: 2.0,
          unitPriceMinor: 42000,
        },
      ],
      cashTenderedMinor: 100000,
      offlineCreatedAt: new Date().toISOString(),
    }

    const idempotencyKey = 'idem_offline_sale_unique_999'

    // First submission
    const res1 = await offlineService.commitOfflineSale({
      businessId,
      branchId,
      userId,
      cashierName: 'Cashier Commit',
      input: saleInput,
      idempotencyKey,
      secret,
    })
    expect(res1.isCached).toBeFalsy()

    // Second submission with exact same key and payload (e.g. simulated network response drop & retry)
    const res2 = await offlineService.commitOfflineSale({
      businessId,
      branchId,
      userId,
      cashierName: 'Cashier Commit',
      input: saleInput,
      idempotencyKey,
      secret,
    })

    expect(res2.isCached).toBe(true)
    expect(res2.saleId).toBe(res1.saleId)
    expect(res2.invoiceNumber).toBe(res1.invoiceNumber)

    // Ensure only 1 sale row exists
    const salesCount = sqlite.prepare('SELECT count(*) as count FROM sales WHERE business_id = ?').get(businessId) as Record<string, unknown>
    expect(salesCount.count).toBe(1)

    // Ensure stock was deducted exactly once (50 - 2 = 48)
    const balRow = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE product_id = ?').get('prod_oil') as Record<string, unknown>
    expect(balRow.quantity_on_hand).toBe(48.0)
  })

  it('4.3: same idempotency key with conflicting payload throws 409 Conflict', async () => {
    const idempotencyKey = 'idem_offline_conflict_test'

    await offlineService.commitOfflineSale({
      businessId,
      branchId,
      userId,
      cashierName: 'Cashier Commit',
      input: {
        authorizationId: validAuthId,
        deviceId,
        provisionalSaleId: 'prov_sale_conf_1',
        provisionalReceiptNumber: 'OFF-DEV01-CONF1',
        items: [{ productId: 'prod_oil', allocationId: validAllocId, quantity: 1.0, unitPriceMinor: 42000 }],
        cashTenderedMinor: 50000,
        offlineCreatedAt: new Date().toISOString(),
      },
      idempotencyKey,
      secret,
    })

    // Attempting same key with different quantity (2.0 instead of 1.0)
    await expect(
      offlineService.commitOfflineSale({
        businessId,
        branchId,
        userId,
        cashierName: 'Cashier Commit',
        input: {
          authorizationId: validAuthId,
          deviceId,
          provisionalSaleId: 'prov_sale_conf_2',
          provisionalReceiptNumber: 'OFF-DEV01-CONF2',
          items: [{ productId: 'prod_oil', allocationId: validAllocId, quantity: 2.0, unitPriceMinor: 42000 }],
          cashTenderedMinor: 100000,
          offlineCreatedAt: new Date().toISOString(),
        },
        idempotencyKey,
        secret,
      })
    ).rejects.toThrow(HttpError)
  })

  it('4.4: quota overconsumption triggers SQL check constraint and rolls back entire batch', async () => {
    // Total allocation was 10. Attempting to commit 12 liters
    await expect(
      offlineService.commitOfflineSale({
        businessId,
        branchId,
        userId,
        cashierName: 'Cashier Commit',
        input: {
          authorizationId: validAuthId,
          deviceId,
          provisionalSaleId: 'prov_sale_overquota',
          provisionalReceiptNumber: 'OFF-DEV01-OVER',
          items: [{ productId: 'prod_oil', allocationId: validAllocId, quantity: 12.0, unitPriceMinor: 42000 }],
          cashTenderedMinor: 600000,
          offlineCreatedAt: new Date().toISOString(),
        },
        secret,
      })
    ).rejects.toThrow(HttpError)

    // Verify complete rollback: zero sales, zero movements, zero stock changes
    const salesCount = sqlite.prepare('SELECT count(*) as count FROM sales WHERE business_id = ?').get(businessId) as Record<string, unknown>
    expect(salesCount.count).toBe(0)

    const balRow = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE product_id = ?').get('prod_oil') as Record<string, unknown>
    expect(balRow.quantity_on_hand).toBe(50.0)
  })

  it('4.5: tampered authorization signature is rejected with 403 Forbidden', async () => {
    // Tamper with authorization signature in database
    sqlite.prepare('UPDATE offline_authorizations SET signature = ? WHERE id = ?').run('malicious_tampered_sig_hex_xyz', validAuthId)

    await expect(
      offlineService.commitOfflineSale({
        businessId,
        branchId,
        userId,
        cashierName: 'Cashier Commit',
        input: {
          authorizationId: validAuthId,
          deviceId,
          provisionalSaleId: 'prov_sale_tamper',
          provisionalReceiptNumber: 'OFF-DEV01-TAMP',
          items: [{ productId: 'prod_oil', allocationId: validAllocId, quantity: 1.0, unitPriceMinor: 42000 }],
          cashTenderedMinor: 50000,
          offlineCreatedAt: new Date().toISOString(),
        },
        secret,
      })
    ).rejects.toThrow(/tampered/)
  })
})
