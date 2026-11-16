// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import worker from '../../worker/src/index'
import type { Env } from '../../worker/src/types/environment'
import { createSession } from '../../worker/src/auth/sessionService'
import { signAuthorizationPayload } from '../../worker/src/features/offline/offlineCrypto'
import { offlineDb } from '../../src/lib/offline/database'
import { queryClient } from '../../src/app/queryClient'
import { offlineSalesService } from '../../src/lib/offline/sales/offlineSales.service'
import { offlineSalesRepository } from '../../src/lib/offline/sales/offlineSales.repository'
import { outboxService, computePayloadHash } from '../../src/lib/offline/outbox/outbox.service'
import { outboxRepository } from '../../src/lib/offline/outbox/outbox.repository'
import { OutboxDispatcher } from '../../src/lib/offline/outbox/outbox.dispatcher'
import { commandRegistry } from '../../src/lib/offline/outbox/outbox.registry'
import {
  getPendingOfflineSummary,
  performLogoutCleanup,
} from '../../src/lib/offline/sessionCleanup'
import { AuthProvider } from '../../src/features/auth/context/AuthContext'
import { Header } from '../../src/layouts/components/Header'
import { PosPage } from '../../src/features/pos/pages/PosPage'
import { setApiContextProvider } from '../../src/lib/api-client'
import { createTestD1Database } from './testD1Helper'

const executionCtx: ExecutionContext = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
}

describe('Phase 5 — Shared-Terminal Isolation, Offline Crypto, Outbox FIFO & Unified POS UI (OFF-001..005, DEP-002)', () => {
  const originalOnLine = Object.getOwnPropertyDescriptor(window.navigator, 'onLine')

  beforeEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await offlineDb.clearAllOfflineData()
    queryClient.clear()
    localStorage.clear()
    sessionStorage.clear()
    setApiContextProvider(null)
  })

  afterEach(async () => {
    cleanup()
    if (originalOnLine) {
      Object.defineProperty(window.navigator, 'onLine', originalOnLine)
    } else {
      delete (window.navigator as unknown as { onLine?: boolean }).onLine
    }
    vi.unstubAllEnvs()
    queryClient.clear()
    localStorage.clear()
    sessionStorage.clear()
    await offlineDb.clearAllOfflineData()
    setApiContextProvider(null)
  })

  function setOnlineStatus(online: boolean) {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => online,
    })
  }

  // --------------------------------------------------------------------------
  // 1. OFF-001: Centralized Logout Cleanup & Shared-Terminal User Isolation
  // --------------------------------------------------------------------------
  it('OFF-001: Logout wipes transient caches & cached catalog while keeping User A pending offline sales locked from User B', async () => {
    const userA = 'usr_terminal_a'
    const userB = 'usr_terminal_b'
    const bizId = 'biz_shared_1'
    const branchId = 'br_shared_1'
    const deviceId = 'dev_shared_terminal'

    // Seed transient caches from User A session
    queryClient.setQueryData(['customers', bizId, branchId], [{ id: 'cust_secret_a', name: 'VIP Client A' }])
    sessionStorage.setItem(`pos-cart:${userA}:${bizId}:${branchId}`, JSON.stringify({ prod_1: 2 }))
    sessionStorage.setItem('pos-cart', JSON.stringify({ prod_1: 2 }))
    localStorage.setItem('northstar.customers.v1', JSON.stringify([{ id: 'cust_secret_a' }]))

    // Mock CacheStorage showing shell preservation + dynamic cache deletion
    const deletedCaches: string[] = []
    vi.stubGlobal('caches', {
      keys: vi.fn(async () => ['northstar-pos-shell-v1', 'northstar-dynamic-api-v1']),
      delete: vi.fn(async (name: string) => {
        deletedCaches.push(name)
        return true
      }),
    })

    // Seed Dexie cached catalog & stock
    await offlineDb.cachedProducts.put({
      id: `${userA}:${bizId}:snap1:prod_tea`,
      userId: userA,
      businessId: bizId,
      snapshotId: 'snap1',
      productId: 'prod_tea',
      name: 'Green Tea',
      sku: 'TEA-01',
      barcode: null,
      categoryId: 'cat_1',
      unit: 'box',
      sellingPriceMinor: 50000,
      status: 'active',
      trackInventory: true,
      imageUrl: null,
      version: 1,
      serverUpdatedAt: new Date().toISOString(),
      cachedAt: new Date().toISOString(),
    })
    await offlineDb.cacheSyncState.put({
      id: `${userA}:${bizId}:${branchId}:products`,
      userId: userA,
      businessId: bizId,
      branchId,
      resource: 'products',
      activeSnapshotId: 'snap1',
      lastSuccessAt: new Date().toISOString(),
      status: 'success',
      errorMessage: null,
      recordCount: 1,
      updatedAt: new Date().toISOString(),
    })

    // Authorize & record 1 provisional offline sale for User A
    await offlineSalesService.cacheAuthorizationPackage({
      authorizationId: 'auth_a_1',
      businessId: bizId,
      branchId,
      userId: userA,
      deviceId,
      catalogVersion: 1,
      pricingVersion: 1,
      maxTransactions: 10,
      maxTotalAmountMinor: 500_000,
      allowDiscounts: false,
      status: 'active',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      allowedPaymentMethods: ['cash'],
      signature: 'sig_a',
      productAllocations: [
        {
          allocationId: 'alloc_a_tea',
          productId: 'prod_tea',
          sku: 'TEA-01',
          name: 'Green Tea',
          unit: 'box',
          sellingPriceMinor: 50000,
          allocatedQuantity: 5,
          consumedQuantity: 0,
          remainingQuantity: 5,
        },
      ],
    })

    const offResult = await offlineSalesService.recordOfflineSale({
      userId: userA,
      businessId: bizId,
      branchId,
      deviceId,
      authorizationId: 'auth_a_1',
      items: [
        {
          productId: 'prod_tea',
          name: 'Green Tea',
          sku: 'TEA-01',
          unit: 'box',
          quantity: 1,
          unitPriceMinor: 50000,
          subtotalMinor: 50000,
          lineTotalMinor: 50000,
          allocationId: 'alloc_a_tea',
        },
      ],
      cashTenderedMinor: 50000,
    })

    // Simulate User A command paused for auth
    await offlineDb.outboxCommands.update(offResult.outboxCommandId, {
      status: 'blocked_auth',
      lastErrorCode: 'AUTHENTICATION_REQUIRED',
    })

    // User A signs out
    await performLogoutCleanup(userA)

    // Assert transient caches wiped & shell cache preserved
    expect(queryClient.getQueryData(['customers', bizId, branchId])).toBeUndefined()
    expect(sessionStorage.getItem(`pos-cart:${userA}:${bizId}:${branchId}`)).toBeNull()
    expect(sessionStorage.getItem('pos-cart')).toBeNull()
    expect(localStorage.getItem('northstar.customers.v1')).toBeNull()
    expect(deletedCaches).toEqual(['northstar-dynamic-api-v1'])
    expect(await offlineDb.cachedProducts.count()).toBe(0)
    expect(await offlineDb.cacheSyncState.count()).toBe(0)

    // Assert User A pending offline transaction was NOT destroyed
    expect(await offlineSalesRepository.findSaleById(offResult.provisionalSaleId)).toBeDefined()
    expect(await outboxRepository.findById(offResult.outboxCommandId)).toBeDefined()

    // User B signs in on the exact same terminal & business/branch
    const summaryForB = await getPendingOfflineSummary(userB, bizId)
    expect(summaryForB.hasUnsynced).toBe(false)
    expect(summaryForB.totalUnsyncedCount).toBe(0)

    const salesForB = await offlineSalesRepository.listSalesByTenant(userB, bizId, branchId)
    expect(salesForB).toEqual([])
    const cmdsForB = await outboxService.listCommands(userB, bizId)
    expect(cmdsForB).toEqual([])
    const authForB = await offlineSalesRepository.getActiveAuthorization(userB, bizId, branchId, deviceId)
    expect(authForB).toBeNull()

    // User A signs back in -> blocked_auth command resumes cleanly to 'pending'
    const resumed = await outboxService.resumeAuthBlocked(userA)
    expect(resumed).toBe(1)
    const cmdAfterResume = await outboxRepository.findById(offResult.outboxCommandId)
    expect(cmdAfterResume?.status).toBe('pending')
  })

  // --------------------------------------------------------------------------
  // 2. OFF-001 UI: Header Sign-Out Warns When Unsynced Offline Sales Remain
  // --------------------------------------------------------------------------
  it('OFF-001 UI: Header blocks silent sign-out when unsynchronized offline sales exist and keeps them locked on confirmation', async () => {
    setOnlineStatus(false)
    const userA = 'usr_header_cashier'
    const bizId = 'biz_header_1'
    const branchId = 'br_header_1'

    await offlineSalesService.cacheAuthorizationPackage({
      authorizationId: 'auth_header_1',
      businessId: bizId,
      branchId,
      userId: userA,
      deviceId: 'dev_hdr',
      catalogVersion: 1,
      pricingVersion: 1,
      maxTransactions: 5,
      maxTotalAmountMinor: 100_000,
      allowDiscounts: false,
      status: 'active',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      allowedPaymentMethods: ['cash'],
      signature: 'sig_hdr',
      productAllocations: [
        {
          allocationId: 'alloc_hdr',
          productId: 'prod_hdr',
          sku: 'HDR-1',
          name: 'Header Item',
          unit: 'pcs',
          sellingPriceMinor: 20000,
          allocatedQuantity: 4,
          consumedQuantity: 0,
          remainingQuantity: 4,
        },
      ],
    })

    const offSale = await offlineSalesService.recordOfflineSale({
      userId: userA,
      businessId: bizId,
      branchId,
      deviceId: 'dev_hdr',
      authorizationId: 'auth_header_1',
      items: [
        {
          productId: 'prod_hdr',
          name: 'Header Item',
          sku: 'HDR-1',
          unit: 'pcs',
          quantity: 1,
          unitPriceMinor: 20000,
          subtotalMinor: 20000,
          lineTotalMinor: 20000,
          allocationId: 'alloc_hdr',
        },
      ],
      cashTenderedMinor: 20000,
    })

    let signOutCalled = 0
    global.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/v1/auth/me')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              user: { id: userA, email: 'cashier.a@northstar.pk', name: 'Sara Cashier', status: 'active' },
              businesses: [{ id: bizId, business_code: 'NS', name: 'Northstar', currency: 'PKR', status: 'active', role: 'cashier' }],
              activeBusiness: { id: bizId, business_code: 'NS', name: 'Northstar', currency: 'PKR', status: 'active', role: 'cashier' },
              activeBranch: { id: branchId, branch_code: 'MAIN', name: 'Main Branch', is_main_branch: 1, status: 'active' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      if (url.includes('/api/v1/auth/sign-out')) {
        signOutCalled++
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      }
      return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })
    }) as typeof fetch

    render(
      <MemoryRouter>
        <AuthProvider>
          <Header onMenu={() => {}} />
        </AuthProvider>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Sara Cashier')).toBeDefined()
    })

    // Open profile menu and click Sign out
    fireEvent.click(screen.getByText('Sara Cashier'))
    fireEvent.click(screen.getByText('Sign out'))

    // Should prompt warning modal rather than signing out silently
    await waitFor(() => {
      expect(screen.getByText('Unsynchronized Offline Transactions')).toBeDefined()
    })
    expect(screen.getByText(/1 unsynchronized offline transaction\(s\) remain/i)).toBeDefined()
    expect(signOutCalled).toBe(0)

    // Confirm deliberate sign-out keeping pending locked to Sara
    fireEvent.click(screen.getByText('Sign Out (Keep Pending Locked)'))

    await waitFor(() => {
      expect(signOutCalled).toBe(1)
    })

    expect(await offlineSalesRepository.findSaleById(offSale.provisionalSaleId)).toBeDefined()
  })

  // --------------------------------------------------------------------------
  // 3. OFF-003 & DEP-002: Worker Crypto Fail-Closed, Subset Carts, Limits & Revocation
  // --------------------------------------------------------------------------
  it('OFF-003 & DEP-002: Worker fails closed on missing AUTH_SECRET, supports subset carts, enforces caps/timestamps & blocks revoked device reactivation', async () => {
    const sqlite = new DatabaseSync(':memory:')
    sqlite.exec('PRAGMA foreign_keys = ON;')
    const migrationsDir = path.resolve(process.cwd(), 'worker/migrations')
    for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
      sqlite.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf-8'))
    }
    const d1 = createTestD1Database(sqlite)

    const businessId = 'biz_crypto_1'
    const branchId = 'br_crypto_1'
    const ownerId = 'usr_cry_owner'
    const cashierId = 'usr_cry_cashier'

    sqlite.prepare(`INSERT INTO businesses (id, business_code, name, status) VALUES (?, 'CRY', 'Crypto Mart', 'active')`).run(businessId)
    sqlite.prepare(`INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status) VALUES (?, ?, 'MAIN', 'Main', 1, 'active')`).run(branchId, businessId)
    sqlite.prepare(`INSERT INTO business_settings (business_id, allow_negative_stock, default_tax_rate) VALUES (?, 0, 0)`).run(businessId)
    sqlite.prepare(`INSERT INTO users (id, email, name, password_hash, status) VALUES (?, 'o@cry.pk', 'Owner', 'h', 'active'), (?, 'c@cry.pk', 'Cashier', 'h', 'active')`).run(ownerId, cashierId)
    sqlite.prepare(`INSERT INTO business_members (id, business_id, user_id, role, is_active) VALUES ('m_o', ?, ?, 'owner', 1), ('m_c', ?, ?, 'cashier', 1)`).run(businessId, ownerId, businessId, cashierId)
    sqlite.prepare(`INSERT INTO member_branches (id, member_id, branch_id) VALUES ('mb_c', 'm_c', ?)`).run(branchId)
    sqlite.prepare(`INSERT INTO categories (id, business_id, name, slug, status) VALUES ('cat_c', ?, 'Drinks', 'drinks', 'active')`).run(businessId)
    sqlite.prepare(
      `INSERT INTO products (id, business_id, category_id, name, sku, unit, selling_price_minor, purchase_price_minor, track_inventory, status)
       VALUES ('prod_c1', ?, 'cat_c', 'Chai', 'CH-1', 'piece', 20000, 10000, 1, 'active'),
              ('prod_c2', ?, 'cat_c', 'Coffee', 'CF-1', 'piece', 40000, 20000, 1, 'active')`
    ).run(businessId, businessId)
    sqlite.prepare(
      `INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand)
       VALUES ('bal_c1', ?, ?, 'prod_c1', 20), ('bal_c2', ?, ?, 'prod_c2', 20)`
    ).run(businessId, branchId, businessId, branchId)

    const { token: ownerToken } = await createSession(d1, ownerId)
    const { token: cashierToken } = await createSession(d1, cashierId)

    // 3a. Fail-closed when AUTH_SECRET is missing or < 16 chars
    const noSecretEnv: Env = {
      DB: d1,
      FILES: {} as unknown as R2Bucket,
      ENVIRONMENT: 'local',
      SERVICE_NAME: 'pos',
      API_VERSION: 'v1',
    }
    const devRegRes = await worker.fetch(
      new Request('http://localhost/api/v1/sync/devices/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
        },
        body: JSON.stringify({ installationId: 'inst_cry_1', label: 'POS Counter 1' }),
      }),
      noSecretEnv,
      executionCtx
    )
    expect(devRegRes.status).toBe(201)
    const registeredDevice = ((await devRegRes.json()) as { data: { id: string } }).data

    const missingSecretAuthRes = await worker.fetch(
      new Request('http://localhost/api/v1/offline/authorizations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          deviceId: registeredDevice.id,
          products: [{ productId: 'prod_c1', allocatedQuantity: 5 }],
        }),
      }),
      noSecretEnv,
      executionCtx
    )
    expect(missingSecretAuthRes.status).toBe(500)
    const missingBody = (await missingSecretAuthRes.json()) as { error: { code: string } }
    expect(missingBody.error.code).toBe('CONFIGURATION_ERROR')

    // 3b. Valid AUTH_SECRET creates signed grant for 2 products, commits subset cart (1 product), enforces transaction cap = 1
    const env: Env = { ...noSecretEnv, AUTH_SECRET: 'production-grade-secret-key-min-32-chars!!' }
    const grantRes = await worker.fetch(
      new Request('http://localhost/api/v1/offline/authorizations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          deviceId: registeredDevice.id,
          maxTransactions: 1,
          maxTotalAmountMinor: 100_000,
          products: [
            { productId: 'prod_c1', allocatedQuantity: 5 },
            { productId: 'prod_c2', allocatedQuantity: 5 },
          ],
        }),
      }),
      env,
      executionCtx
    )
    expect(grantRes.status).toBe(201)
    const authPkg = ((await grantRes.json()) as {
      data: {
        authorizationId: string
        signature: string
        productAllocations: Array<{ allocationId: string; productId: string }>
      }
    }).data
    const alloc1 = authPkg.productAllocations.find((a) => a.productId === 'prod_c1')!.allocationId
    const alloc2 = authPkg.productAllocations.find((a) => a.productId === 'prod_c2')!.allocationId

    // Subset cart (ONLY prod_c1 out of [prod_c1, prod_c2]) using installationId inst_cry_1 succeeds!
    const subsetRes = await worker.fetch(
      new Request('http://localhost/api/v1/offline/sales/commit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
          'Idempotency-Key': 'idem-subset-1',
        },
        body: JSON.stringify({
          authorizationId: authPkg.authorizationId,
          deviceId: 'inst_cry_1',
          provisionalSaleId: 'prov_sub_1',
          provisionalReceiptNumber: 'OFF-SUB-1',
          offlineCreatedAt: new Date().toISOString(),
          authorizationSignature: authPkg.signature,
          items: [{ productId: 'prod_c1', allocationId: alloc1, quantity: 1 }],
          cashTenderedMinor: 20000,
        }),
      }),
      env,
      executionCtx
    )
    expect(subsetRes.status).toBe(201)

    // 3c. Post-cap 2nd sale rejects atomically with 422 OFFLINE_LIMIT_EXCEEDED and zero extra rows
    const overCapRes = await worker.fetch(
      new Request('http://localhost/api/v1/offline/sales/commit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
          'Idempotency-Key': 'idem-overcap-2',
        },
        body: JSON.stringify({
          authorizationId: authPkg.authorizationId,
          deviceId: 'inst_cry_1',
          provisionalSaleId: 'prov_over_2',
          provisionalReceiptNumber: 'OFF-OVER-2',
          offlineCreatedAt: new Date().toISOString(),
          authorizationSignature: authPkg.signature,
          items: [{ productId: 'prod_c2', allocationId: alloc2, quantity: 1 }],
          cashTenderedMinor: 40000,
        }),
      }),
      env,
      executionCtx
    )
    expect(overCapRes.status).toBe(422)
    const overCapBody = (await overCapRes.json()) as { error: { code: string } }
    expect(overCapBody.error.code).toBe('OFFLINE_LIMIT_EXCEEDED')
    expect((sqlite.prepare('SELECT COUNT(*) as c FROM sales').get() as { c: number }).c).toBe(1)

    // 3d. Expired offlineCreatedAt fails, while offlineCreatedAt within [issued_at, expires_at] succeeds up to +7d sync window
    const grant2Res = await worker.fetch(
      new Request('http://localhost/api/v1/offline/authorizations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          deviceId: registeredDevice.id,
          durationHours: 1,
          products: [{ productId: 'prod_c2', allocatedQuantity: 2 }],
        }),
      }),
      env,
      executionCtx
    )
    const grant2 = ((await grant2Res.json()) as {
      data: {
        authorizationId: string
        signature: string
        issuedAt: string
        expiresAt: string
        productAllocations: Array<{ allocationId: string }>
      }
    }).data

    // Future offlineCreatedAt rejects 400
    const futureCreatedRes = await worker.fetch(
      new Request('http://localhost/api/v1/offline/sales/commit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
          'Idempotency-Key': 'idem-future-1',
        },
        body: JSON.stringify({
          authorizationId: grant2.authorizationId,
          deviceId: registeredDevice.id,
          provisionalSaleId: 'prov_fut_1',
          provisionalReceiptNumber: 'OFF-FUT-1',
          offlineCreatedAt: new Date(Date.now() + 60 * 60_000).toISOString(),
          authorizationSignature: grant2.signature,
          items: [{ productId: 'prod_c2', allocationId: grant2.productAllocations[0].allocationId, quantity: 1 }],
          cashTenderedMinor: 40000,
        }),
      }),
      env,
      executionCtx
    )
    expect(futureCreatedRes.status).toBe(400)

    // Backdate grant2 window to [2h ago, 1h ago] (within +7d post-expiry sync window)
    const pastIssuedAt = new Date(Date.now() - 2 * 3600_000).toISOString()
    const pastExpiresAt = new Date(Date.now() - 1 * 3600_000).toISOString()
    const pastSig = await signAuthorizationPayload(env.AUTH_SECRET!, {
      authorizationId: grant2.authorizationId,
      businessId,
      branchId,
      userId: cashierId,
      deviceId: registeredDevice.id,
      expiresAt: pastExpiresAt,
      productIds: ['prod_c2'],
    })
    sqlite
      .prepare('UPDATE offline_authorizations SET issued_at = ?, expires_at = ?, signature = ? WHERE id = ?')
      .run(pastIssuedAt, pastExpiresAt, pastSig, grant2.authorizationId)

    // Created INSIDE window (90m ago, before expiresAt) syncs cleanly even though expiresAt has now passed
    const validDelayedSyncRes = await worker.fetch(
      new Request('http://localhost/api/v1/offline/sales/commit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
          'Idempotency-Key': 'idem-delayed-ok-1',
        },
        body: JSON.stringify({
          authorizationId: grant2.authorizationId,
          deviceId: registeredDevice.id,
          provisionalSaleId: 'prov_delay_ok_1',
          provisionalReceiptNumber: 'OFF-DEL-1',
          offlineCreatedAt: new Date(Date.now() - 90 * 60_000).toISOString(),
          authorizationSignature: pastSig,
          items: [{ productId: 'prod_c2', allocationId: grant2.productAllocations[0].allocationId, quantity: 1 }],
          cashTenderedMinor: 40000,
        }),
      }),
      env,
      executionCtx
    )
    expect(validDelayedSyncRes.status).toBe(201)

    // Created AFTER expiresAt (10s ago) is rejected 403
    const expiredCreatedRes = await worker.fetch(
      new Request('http://localhost/api/v1/offline/sales/commit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
          'Idempotency-Key': 'idem-expired-1',
        },
        body: JSON.stringify({
          authorizationId: grant2.authorizationId,
          deviceId: registeredDevice.id,
          provisionalSaleId: 'prov_exp_1',
          provisionalReceiptNumber: 'OFF-EXP-1',
          offlineCreatedAt: new Date(Date.now() - 10_000).toISOString(),
          authorizationSignature: pastSig,
          items: [{ productId: 'prod_c2', allocationId: grant2.productAllocations[0].allocationId, quantity: 1 }],
          cashTenderedMinor: 40000,
        }),
      }),
      env,
      executionCtx
    )
    expect(expiredCreatedRes.status).toBe(403)

    // DEP-002: Revoking device atomically revokes active authorizations & allocations and prevents self-reactivation
    const revokeRes = await worker.fetch(
      new Request(`http://localhost/api/v1/sync/devices/${registeredDevice.id}/revoke`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'X-Business-Id': businessId,
        },
      }),
      env,
      executionCtx
    )
    expect(revokeRes.status).toBe(200)

    const authStatusRow = sqlite
      .prepare('SELECT status FROM offline_authorizations WHERE id = ?')
      .get(grant2.authorizationId) as { status: string }
    expect(authStatusRow.status).toBe('revoked')

    const allocStatusRow = sqlite
      .prepare('SELECT status FROM device_stock_allocations WHERE authorization_id = ?')
      .get(grant2.authorizationId) as { status: string }
    expect(allocStatusRow.status).toBe('revoked')

    const reregisterRes = await worker.fetch(
      new Request('http://localhost/api/v1/sync/devices/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
        },
        body: JSON.stringify({ installationId: 'inst_cry_1', label: 'Attempt Reactivate' }),
      }),
      env,
      executionCtx
    )
    expect(reregisterRes.status).toBe(403)
  })

  // --------------------------------------------------------------------------
  // 4. OFF-004 / OFF-005: Canonical Nested Hash, FIFO Blocker & Safe Rollback
  // --------------------------------------------------------------------------
  it('OFF-004/005: Enforces recursive canonical payload hash, FIFO head-of-line blocking, and deterministic vs MAX_ATTEMPTS rollback', async () => {
    const userId = 'usr_fifo_1'
    const businessId = 'biz_fifo_1'
    const branchId = 'br_fifo_1'
    const deviceId = 'dev_fifo_1'

    const h1 = await computePayloadHash({ items: [{ productId: 'p1', quantity: 1 }], nested: { b: 2, a: 1 } })
    const h2 = await computePayloadHash({ nested: { a: 1, b: 2 }, items: [{ quantity: 1, productId: 'p1' }] })
    const h3 = await computePayloadHash({ nested: { a: 1, b: 2 }, items: [{ quantity: 2, productId: 'p1' }] })
    expect(h1).toBe(h2)
    expect(h1).not.toBe(h3)

    await offlineSalesService.cacheAuthorizationPackage({
      authorizationId: 'auth_fifo_1',
      businessId,
      branchId,
      userId,
      deviceId,
      catalogVersion: 1,
      pricingVersion: 1,
      maxTransactions: 10,
      maxTotalAmountMinor: 500_000,
      allowDiscounts: false,
      status: 'active',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      allowedPaymentMethods: ['cash'],
      signature: 'sig_fifo',
      productAllocations: [
        {
          allocationId: 'alloc_fifo',
          productId: 'prod_f',
          sku: 'F-1',
          name: 'Sugar',
          unit: 'kg',
          sellingPriceMinor: 15000,
          allocatedQuantity: 10,
          consumedQuantity: 0,
          remainingQuantity: 10,
        },
      ],
    })

    const sale1 = await offlineSalesService.recordOfflineSale({
      userId,
      businessId,
      branchId,
      deviceId,
      authorizationId: 'auth_fifo_1',
      items: [
        {
          productId: 'prod_f',
          name: 'Sugar',
          sku: 'F-1',
          unit: 'kg',
          quantity: 2,
          unitPriceMinor: 15000,
          subtotalMinor: 30000,
          lineTotalMinor: 30000,
          allocationId: 'alloc_fifo',
        },
      ],
      cashTenderedMinor: 30000,
    })

    const sale2 = await offlineSalesService.recordOfflineSale({
      userId,
      businessId,
      branchId,
      deviceId,
      authorizationId: 'auth_fifo_1',
      items: [
        {
          productId: 'prod_f',
          name: 'Sugar',
          sku: 'F-1',
          unit: 'kg',
          quantity: 1,
          unitPriceMinor: 15000,
          subtotalMinor: 15000,
          lineTotalMinor: 15000,
          allocationId: 'alloc_fifo',
        },
      ],
      cashTenderedMinor: 15000,
    })

    // Ensure strict chronological ordering so sale1 is ahead of sale2
    await offlineDb.outboxCommands.update(sale1.outboxCommandId, {
      createdAt: '2026-01-01T10:00:00.000Z',
    })
    await offlineDb.outboxCommands.update(sale2.outboxCommandId, {
      createdAt: '2026-01-01T10:01:00.000Z',
    })

    // First command fails 401 -> blocked_auth, which must block trailing sale2 cleanly without burning its attempts!
    setOnlineStatus(true)
    const dispatcher = new OutboxDispatcher()
    const origDef = commandRegistry.getDefinition('create_offline_sale')!
    const origHandler = origDef.handler!
    let handlerCalls = 0
    origDef.handler = async () => {
      handlerCalls++
      throw Object.assign(new Error('Session expired'), { status: 401, code: 'AUTHENTICATION_REQUIRED' })
    }

    try {
      const results = await dispatcher.dispatchBatch({ userId, businessId, limit: 10 })
      expect(handlerCalls).toBe(1)
      expect(results[0]?.status).toBe('blocked_auth')

      const c1 = await outboxRepository.findById(sale1.outboxCommandId)
      const c2 = await outboxRepository.findById(sale2.outboxCommandId)
      expect(c1?.status).toBe('blocked_auth')
      expect(c2?.status).toBe('pending')
      expect(c2?.attemptCount).toBe(0)
      expect(c2?.leaseToken).toBeNull()

      // Clear queue and test 400 validation rollback vs 503 MAX_ATTEMPTS reconciliation_required
      await offlineDb.outboxCommands.update(sale1.outboxCommandId, {
        status: 'rejected',
        lastErrorCode: 'BAD_REQUEST',
      })
      // Directly simulate sale2 deterministic 400 validation failure
      handlerCalls = 0
      origDef.handler = async () => {
        handlerCalls++
        throw Object.assign(new Error('Invalid sale item'), { status: 400, code: 'VALIDATION_ERROR' })
      }
      await dispatcher.dispatchBatch({ userId, businessId, limit: 10 })
      const sale2Record = await offlineSalesRepository.findSaleById(sale2.provisionalSaleId)
      expect(sale2Record?.status).toBe('rejected')
      const allocAfter400 = await offlineSalesRepository.getAllocationForProduct(businessId, branchId, deviceId, 'prod_f')
      // Allocated 10, consumed 2 by sale1 + 1 by sale2 -> sale2's 1 restored -> 8 remaining!
      expect(allocAfter400?.remainingQuantity).toBe(8)

      // Now simulate MAX_ATTEMPTS_EXCEEDED on a fresh sale -> must NOT blindly restore quota!
      const sale3 = await offlineSalesService.recordOfflineSale({
        userId,
        businessId,
        branchId,
        deviceId,
        authorizationId: 'auth_fifo_1',
        items: [
          {
            productId: 'prod_f',
            name: 'Sugar',
            sku: 'F-1',
            unit: 'kg',
            quantity: 3,
            unitPriceMinor: 15000,
            subtotalMinor: 45000,
            lineTotalMinor: 45000,
            allocationId: 'alloc_fifo',
          },
        ],
        cashTenderedMinor: 45000,
      })
      await offlineDb.outboxCommands.update(sale3.outboxCommandId, { attemptCount: 5 })
      origDef.handler = async () => {
        throw Object.assign(new Error('Network down'), { status: 503, code: 'SERVICE_UNAVAILABLE' })
      }
      await dispatcher.dispatchBatch({ userId, businessId, limit: 10 })
      const sale3Record = await offlineSalesRepository.findSaleById(sale3.provisionalSaleId)
      expect(sale3Record?.status).toBe('reconciliation_required')
      const allocAfterMaxAttempts = await offlineSalesRepository.getAllocationForProduct(businessId, branchId, deviceId, 'prod_f')
      // 8 - 3 = 5 remaining (NOT restored back to 8!)
      expect(allocAfterMaxAttempts?.remainingQuantity).toBe(5)
    } finally {
      origDef.handler = origHandler
    }
  })

  // --------------------------------------------------------------------------
  // 5. OFF-002: PosPage Uses Live Auth, Enforces Offline Quota & Renders Queue Drawer
  // --------------------------------------------------------------------------
  it('OFF-002: PosPage displays real identity, switches cleanly to Provisional Offline Cash checkout, and renders 6-state Offline Queue', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'api')
    const userId = 'usr_pos_ui_1'
    const bizId = 'biz_pos_ui_1'
    const branchId = 'br_pos_ui_1'
    const deviceId = await offlineDb.getDeviceId()

    await offlineSalesService.cacheAuthorizationPackage({
      authorizationId: 'auth_pos_ui_1',
      businessId: bizId,
      branchId,
      userId,
      deviceId,
      installationId: deviceId,
      catalogVersion: 1,
      pricingVersion: 1,
      maxTransactions: 10,
      maxTotalAmountMinor: 500_000,
      allowDiscounts: false,
      taxRatePercent: 0,
      taxInclusive: false,
      status: 'active',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      allowedPaymentMethods: ['cash'],
      signature: 'sig_pos_ui',
      productAllocations: [
        {
          allocationId: 'alloc_pos_tea',
          productId: 'prod_pos_tea',
          sku: 'PT-01',
          name: 'Basmati Rice',
          unit: 'kg',
          sellingPriceMinor: 35000, // PKR 350.00
          allocatedQuantity: 8,
          consumedQuantity: 0,
          remainingQuantity: 8,
        },
      ],
    })

    setOnlineStatus(false)

    global.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/v1/auth/me')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              user: { id: userId, email: 'zara@northstar.pk', name: 'Zara POS', status: 'active' },
              businesses: [{ id: bizId, business_code: 'NS', name: 'Northstar Gulberg', currency: 'PKR', status: 'active', role: 'cashier' }],
              activeBusiness: { id: bizId, business_code: 'NS', name: 'Northstar Gulberg', currency: 'PKR', status: 'active', role: 'cashier' },
              activeBranch: { id: branchId, branch_code: 'MAIN', name: 'Gulberg Branch', is_main_branch: 1, status: 'active' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      if (url.includes('/api/v1/products')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: [
              {
                id: 'prod_pos_tea',
                name: 'Basmati Rice',
                sku: 'PT-01',
                unit: 'kg',
                sellingPriceMinor: 35000,
                purchasePriceMinor: 25000,
                trackInventory: true,
                stockQuantity: 25,
                lowStockThreshold: 5,
                status: 'active',
                categoryId: 'cat_grains',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      if (url.includes('/api/v1/categories')) {
        return new Response(JSON.stringify({ success: true, data: [{ id: 'cat_grains', name: 'Grains', status: 'active' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/api/v1/customers')) {
        return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })
      }
      if (url.includes('/api/v1/settings')) {
        return new Response(JSON.stringify({ success: true, data: { defaultTaxRate: 0 } }), { status: 200 })
      }
      return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })
    }) as typeof fetch

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AuthProvider>
            <PosPage />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    )

    // Verify real business/cashier text (NEVER hardcoded Demo mode or Ayesha Khan)
    await waitFor(() => {
      expect(screen.getByText(/Cashier: Zara POS/)).toBeDefined()
      expect(screen.getByText(/Offline POS \(10 tx left\)/)).toBeDefined()
      expect(screen.getByText(/Quota 8 kg/)).toBeDefined()
    })
    expect(screen.queryByText(/Ayesha Khan/)).toBeNull()
    expect(screen.queryByText(/Demo mode/)).toBeNull()
    expect(screen.getByText(/Basmati Rice/)).toBeDefined()

    // Add Basmati Rice to cart while offline
    fireEvent.click(screen.getByText('Basmati Rice'))

    const proceedBtn = await screen.findByText(/Provisional Offline Cash/)
    fireEvent.click(proceedBtn)

    // Enter tendered cash PKR 400 and review/save provisional offline sale
    const amountInput = await screen.findByLabelText(/Amount received/i)
    fireEvent.change(amountInput, { target: { value: '400' } })
    fireEvent.click(screen.getByText('Review sale'))
    fireEvent.click(screen.getByText('Save Provisional Sale'))

    // Must show provisional non-tax-invoice banner, NEVER "Synchronized · Server Confirmed"
    await waitFor(() => {
      expect(screen.getByText('Provisional Offline Receipt')).toBeDefined()
    })
    expect(screen.getByText('Pending offline sync')).toBeDefined()
    expect(screen.getAllByText(/NOT AN OFFICIAL TAX INVOICE/).length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText(/Synchronized · Server Confirmed/)).toBeNull()

    // Dismiss receipt and inspect 6-state Offline Queue drawer
    fireEvent.click(screen.getByText('Start new sale'))
    fireEvent.click(screen.getByText('Offline Queue'))

    await waitFor(() => {
      expect(screen.getByText('Offline Transactions & Sync Queue')).toBeDefined()
    })
    expect(screen.getByText('Draft')).toBeDefined()
    expect(screen.getByText('Pending sync')).toBeDefined()
    expect(screen.getByText('Syncing')).toBeDefined()
    expect(screen.getByText('Synchronized')).toBeDefined()
    expect(screen.getByText('Failed')).toBeDefined()
    expect(screen.getByText('Conflict / review')).toBeDefined()
    expect(screen.getByText('Pending offline sync')).toBeDefined()
  })
})
