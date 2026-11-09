import { describe, it, expect, beforeEach } from 'vitest'
import { initTestSqlite } from './testD1Helper'
import { OfflineService } from '../../worker/src/features/offline/offline.service'
import { verifyAuthorizationPayload } from '../../worker/src/features/offline/offlineCrypto'

describe('Step 13.6: Offline POS Cryptographic Authorization (tests/offline/offlinePosAuthorization.test.ts)', () => {
  const businessId = 'biz_auth_test'
  const branchId = 'branch_auth_main'
  const userId = 'usr_cashier_auth'
  const deviceId = 'dev_terminal_01'
  const secret = 'test-offline-signing-secret-key-1234567890'

  let offlineService: OfflineService

  beforeEach(() => {
    const { sqlite, d1 } = initTestSqlite()
    offlineService = new OfflineService(d1)

    // Seed Business
    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'BIZAUTH', 'Auth Supermarket', 'active')
    `).run(businessId)

    // Seed Branch
    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Main Store Branch', 1, 'active')
    `).run(branchId, businessId)

    // Seed User
    sqlite.prepare(`
      INSERT INTO users (id, email, password_hash, name, status)
      VALUES (?, 'cashier@auth.test', 'hash', 'Cashier User', 'active')
    `).run(userId)

    // Seed Registered Device
    sqlite.prepare(`
      INSERT INTO devices (id, installation_id, business_id, user_id, label, status)
      VALUES (?, 'inst_uuid_01', ?, ?, 'Front Counter POS', 'active')
    `).run(deviceId, businessId, userId)

    // Seed Tracked Products with Inventory
    sqlite.prepare(`
      INSERT INTO products (id, business_id, name, sku, unit, purchase_price_minor, selling_price_minor, track_inventory, status)
      VALUES ('prod_rice', ?, 'Basmati Rice', 'RICE-01', 'kg', 18000, 25000, 1, 'active'),
             ('prod_milk', ?, 'Fresh Milk', 'MILK-01', 'liter', 15000, 20000, 1, 'active')
    `).run(businessId, businessId)

    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand)
      VALUES ('inv_1', ?, ?, 'prod_rice', 50.0),
             ('inv_2', ?, ?, 'prod_milk', 30.0)
    `).run(businessId, branchId, businessId, branchId)
  })

  it('1.1: issues valid cryptographic authorization package bound to user, business, branch, and device', async () => {
    const auth = await offlineService.createAuthorization({
      businessId,
      branchId,
      userId,
      input: {
        deviceId,
        durationHours: 8,
        products: [
          { productId: 'prod_rice', allocatedQuantity: 10 },
          { productId: 'prod_milk', allocatedQuantity: 5 },
        ],
      },
      secret,
    })

    expect(auth.authorizationId).toMatch(/^auth_/)
    expect(auth.businessId).toBe(businessId)
    expect(auth.branchId).toBe(branchId)
    expect(auth.userId).toBe(userId)
    expect(auth.deviceId).toBe(deviceId)
    expect(auth.status).toBe('active')
    expect(auth.allowedPaymentMethods).toEqual(['cash'])
    expect(auth.productAllocations).toHaveLength(2)
    expect(auth.signature).toBeDefined()
    expect(auth.signature.length).toBe(64) // HMAC-SHA256 hex string

    // Allocations carry quota
    const riceAlloc = auth.productAllocations.find((p) => p.productId === 'prod_rice')
    expect(riceAlloc?.allocatedQuantity).toBe(10)
    expect(riceAlloc?.remainingQuantity).toBe(10)
    expect(riceAlloc?.consumedQuantity).toBe(0)
  })

  it('1.2: signature verification succeeds for authentic authorization payload', async () => {
    const auth = await offlineService.createAuthorization({
      businessId,
      branchId,
      userId,
      input: {
        deviceId,
        products: [{ productId: 'prod_rice', allocatedQuantity: 4 }],
      },
      secret,
    })

    const isValid = await verifyAuthorizationPayload(
      secret,
      {
        authorizationId: auth.authorizationId,
        businessId,
        branchId,
        userId,
        deviceId,
        expiresAt: auth.expiresAt,
        productIds: ['prod_rice'],
      },
      auth.signature
    )

    expect(isValid).toBe(true)
  })

  it('1.3: tampered payload or modified fields fail cryptographic signature verification', async () => {
    const auth = await offlineService.createAuthorization({
      businessId,
      branchId,
      userId,
      input: {
        deviceId,
        products: [{ productId: 'prod_rice', allocatedQuantity: 4 }],
      },
      secret,
    })

    // Attacker modifies productIds or deviceId
    const isTamperedProduct = await verifyAuthorizationPayload(
      secret,
      {
        authorizationId: auth.authorizationId,
        businessId,
        branchId,
        userId,
        deviceId,
        expiresAt: auth.expiresAt,
        productIds: ['prod_milk'], // Tampered product
      },
      auth.signature
    )
    expect(isTamperedProduct).toBe(false)

    // Attacker modifies deviceId
    const isTamperedDevice = await verifyAuthorizationPayload(
      secret,
      {
        authorizationId: auth.authorizationId,
        businessId,
        branchId,
        userId,
        deviceId: 'dev_malicious_hacker',
        expiresAt: auth.expiresAt,
        productIds: ['prod_rice'],
      },
      auth.signature
    )
    expect(isTamperedDevice).toBe(false)
  })

  it('1.4: rejects authorization for a revoked device', async () => {
    const { sqlite, d1 } = initTestSqlite()
    const revokedDeviceId = 'dev_revoked_99'
    sqlite.exec(`
      INSERT INTO businesses (id, business_code, name, status) VALUES ('biz_r', 'BR', 'Revoke Biz', 'active');
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status) VALUES ('br_r', 'biz_r', 'M', 'Main', 1, 'active');
      INSERT INTO users (id, email, password_hash, name, status) VALUES ('u_r', 'r@b.com', 'h', 'User R', 'active');
      INSERT INTO devices (id, installation_id, business_id, user_id, label, status) VALUES ('${revokedDeviceId}', 'inst_r', 'biz_r', 'u_r', 'Stolen Device', 'revoked');
    `)

    const svc = new OfflineService(d1)
    await expect(
      svc.createAuthorization({
        businessId: 'biz_r',
        branchId: 'br_r',
        userId: 'u_r',
        input: {
          deviceId: revokedDeviceId,
          products: [{ productId: 'prod_rice', allocatedQuantity: 2 }],
        },
        secret,
      })
    ).rejects.toThrow(/revoked/)
  })
})
