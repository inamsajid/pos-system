import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import worker from '../worker/src/index'
import type { Env } from '../worker/src/types/environment'
import { createSession } from '../worker/src/auth/sessionService'
import { offlineDb } from '../src/lib/offline/database'
import { buildStockKey } from '../src/lib/offline/cacheScopes'
import { SyncClient } from '../src/lib/offline/sync/sync.client'
import { apiClient, setApiContextProvider } from '../src/lib/api-client'
import { createTestD1Database } from './offline/testD1Helper'

const executionCtx: ExecutionContext = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
}

describe('Phase 3 — Inventory Integrity, Concurrent Checkout Protection & Multi-Device Sync (INV-001, INV-002)', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const businessId = 'biz_phase3_inv'
  const branchId = 'branch_phase3_main'
  const branchOther = 'branch_phase3_other'
  const ownerId = 'usr_p3_owner'
  const cashierId = 'usr_p3_cashier'
  const secret = 'test-offline-signing-secret-key-1234567890'
  let ownerToken: string
  let cashierToken: string

  const catId = 'cat_p3_1'
  const prodTrackedMissingRow = 'prod_p3_missing_bal'
  const prodTrackedLastUnit = 'prod_p3_last_unit'
  const prodTrackedMulti = 'prod_p3_multi'
  const prodNonTracked = 'prod_p3_service'
  const supplierId = 'sup_p3_1'

  beforeEach(async () => {
    vi.restoreAllMocks()
    await offlineDb.clearAllOfflineData()

    sqlite = new DatabaseSync(':memory:')
    sqlite.exec('PRAGMA foreign_keys = ON;')

    const migrationsDir = path.resolve(process.cwd(), 'worker/migrations')
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
    for (const file of files) {
      sqlite.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf-8'))
    }

    d1 = createTestD1Database(sqlite)
    env = {
      DB: d1,
      FILES: {} as unknown as R2Bucket,
      ENVIRONMENT: 'local',
      SERVICE_NAME: 'pos-system-api',
      API_VERSION: 'v1',
      AUTH_SECRET: secret,
    }

    sqlite
      .prepare(`INSERT INTO businesses (id, business_code, name, status) VALUES (?, 'P3INV', 'Phase 3 Inventory Mart', 'active')`)
      .run(businessId)

    sqlite
      .prepare(
        `INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
         VALUES (?, ?, 'MAIN', 'Main Branch', 1, 'active'),
                (?, ?, 'SEC', 'Second Branch', 0, 'active')`
      )
      .run(branchId, businessId, branchOther, businessId)

    sqlite
      .prepare(`INSERT INTO business_settings (business_id, allow_negative_stock, default_tax_rate) VALUES (?, 0, 0)`)
      .run(businessId)

    sqlite
      .prepare(
        `INSERT INTO users (id, email, name, password_hash, status)
         VALUES (?, 'owner@p3.pk', 'Owner P3', 'hash', 'active'),
                (?, 'cashier@p3.pk', 'Cashier P3', 'hash', 'active')`
      )
      .run(ownerId, cashierId)

    sqlite
      .prepare(
        `INSERT INTO business_members (id, business_id, user_id, role, is_active)
         VALUES ('mem_p3_owner', ?, ?, 'owner', 1),
                ('mem_p3_cashier', ?, ?, 'cashier', 1)`
      )
      .run(businessId, ownerId, businessId, cashierId)

    sqlite
      .prepare(`INSERT INTO member_branches (id, member_id, branch_id) VALUES ('mb_p3_cashier', 'mem_p3_cashier', ?)`)
      .run(branchId)

    sqlite
      .prepare(`INSERT INTO categories (id, business_id, name, slug) VALUES (?, ?, 'General', 'general')`)
      .run(catId, businessId)

    sqlite
      .prepare(
        `INSERT INTO products (id, business_id, category_id, name, sku, unit, purchase_price_minor, selling_price_minor, track_inventory, status)
         VALUES (?, ?, ?, 'Missing Row Item', 'SKU-MISS-1', 'piece', 10000, 20000, 1, 'active'),
                (?, ?, ?, 'Last Unit Flagship', 'SKU-LAST-1', 'piece', 30000, 50000, 1, 'active'),
                (?, ?, ?, 'Bulk Rice Sack', 'SKU-BULK-1', 'kg', 15000, 25000, 1, 'active'),
                (?, ?, ?, 'Gift Wrapping Service', 'SKU-SRV-1', 'piece', 0, 5000, 0, 'active')`
      )
      .run(
        prodTrackedMissingRow,
        businessId,
        catId,
        prodTrackedLastUnit,
        businessId,
        catId,
        prodTrackedMulti,
        businessId,
        catId,
        prodNonTracked,
        businessId,
        catId
      )

    // Seed balances for prodTrackedLastUnit (1) and prodTrackedMulti (10) ONLY — prodTrackedMissingRow intentionally has NO row!
    sqlite
      .prepare(
        `INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand, updated_at)
         VALUES ('bal_last_1', ?, ?, ?, 1.0, datetime('now')),
                ('bal_multi_1', ?, ?, ?, 10.0, datetime('now'))`
      )
      .run(businessId, branchId, prodTrackedLastUnit, businessId, branchId, prodTrackedMulti)

    sqlite
      .prepare(
        `INSERT INTO suppliers (id, business_id, supplier_code, name, phone, opening_payable_minor, status)
         VALUES (?, ?, 'SUP-P3', 'Wholesale Depot', '03001234567', 0, 'active')`
      )
      .run(supplierId, businessId)

    ownerToken = (await createSession(d1, ownerId)).token
    cashierToken = (await createSession(d1, cashierId)).token
  })

  afterEach(async () => {
    setApiContextProvider(null)
    vi.unstubAllGlobals()
    await offlineDb.clearAllOfflineData()
  })

  function createSaleRequest(
    body: Record<string, unknown>,
    token = cashierToken,
    idempotencyKey?: string
  ): Request {
    return new Request('http://localhost/api/v1/sales', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Business-Id': businessId,
        'X-Branch-Id': branchId,
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    })
  }

  it('1. INV-001: first sale on product with NO inventory_balances row creates -qty (never phantom +qty) when negative stock permitted', async () => {
    sqlite.prepare(`UPDATE business_settings SET allow_negative_stock = 1 WHERE business_id = ?`).run(businessId)

    const preBal = sqlite
      .prepare('SELECT * FROM inventory_balances WHERE branch_id = ? AND product_id = ?')
      .get(branchId, prodTrackedMissingRow)
    expect(preBal).toBeUndefined()

    const res = await worker.fetch(
      createSaleRequest({
        items: [{ productId: prodTrackedMissingRow, quantity: 3 }],
        payments: [{ method: 'cash', amountMinor: 60000 }],
      }),
      env,
      executionCtx
    )
    expect(res.status).toBe(201)

    const bal = sqlite
      .prepare('SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?')
      .get(businessId, branchId, prodTrackedMissingRow) as { quantity_on_hand: number }
    expect(bal.quantity_on_hand).toBe(-3)

    const mov = sqlite
      .prepare('SELECT previous_quantity, quantity_change, new_quantity FROM stock_movements WHERE product_id = ?')
      .get(prodTrackedMissingRow) as { previous_quantity: number; quantity_change: number; new_quantity: number }
    expect(mov.previous_quantity).toBe(0)
    expect(mov.quantity_change).toBe(-3)
    expect(mov.new_quantity).toBe(-3)

    const evt = sqlite
      .prepare(`SELECT payload FROM sync_change_log WHERE resource_type = 'stock' AND resource_id = ?`)
      .get(`${branchId}:${prodTrackedMissingRow}`) as { payload: string }
    const payload = JSON.parse(evt.payload) as { quantityOnHand: number }
    expect(payload.quantityOnHand).toBe(-3)
  })

  it('2. Sale when balance already exists deducts cleanly and balances match stock_movements history', async () => {
    const res = await worker.fetch(
      createSaleRequest({
        items: [{ productId: prodTrackedMulti, quantity: 2.5 }],
        payments: [{ method: 'cash', amountMinor: 62500 }],
      }),
      env,
      executionCtx
    )
    expect(res.status).toBe(201)

    const bal = sqlite
      .prepare('SELECT quantity_on_hand FROM inventory_balances WHERE branch_id = ? AND product_id = ?')
      .get(branchId, prodTrackedMulti) as { quantity_on_hand: number }
    expect(bal.quantity_on_hand).toBe(7.5)

    const mov = sqlite
      .prepare('SELECT previous_quantity, quantity_change, new_quantity FROM stock_movements WHERE product_id = ?')
      .get(prodTrackedMulti) as { previous_quantity: number; quantity_change: number; new_quantity: number }
    expect(mov.previous_quantity).toBe(10)
    expect(mov.quantity_change).toBe(-2.5)
    expect(mov.new_quantity).toBe(7.5)
  })

  it('3. Sale with insufficient stock when allow_negative_stock = 0 returns 422 with zero state mutation', async () => {
    const res = await worker.fetch(
      createSaleRequest({
        items: [{ productId: prodTrackedLastUnit, quantity: 2 }],
        payments: [{ method: 'cash', amountMinor: 100000 }],
      }),
      env,
      executionCtx
    )
    expect(res.status).toBe(422)
    const errJson = (await res.json()) as { error: { code: string } }
    expect(errJson.error.code).toBe('INSUFFICIENT_STOCK')

    const bal = sqlite
      .prepare('SELECT quantity_on_hand FROM inventory_balances WHERE branch_id = ? AND product_id = ?')
      .get(branchId, prodTrackedLastUnit) as { quantity_on_hand: number }
    expect(bal.quantity_on_hand).toBe(1)

    const movCnt = (sqlite.prepare('SELECT COUNT(*) as cnt FROM stock_movements').get() as { cnt: number }).cnt
    expect(movCnt).toBe(0)
  })

  it('4. Multiple product lines including duplicate product lines in same cart enforce combined stock check and sequential live movements', async () => {
    // 10kg available on prodTrackedMulti; buying 6kg + 5kg = 11kg must reject cleanly
    const overRes = await worker.fetch(
      createSaleRequest({
        items: [
          { productId: prodTrackedMulti, quantity: 6 },
          { productId: prodTrackedMulti, quantity: 5 },
        ],
        payments: [{ method: 'cash', amountMinor: 275000 }],
      }),
      env,
      executionCtx
    )
    expect(overRes.status).toBe(422)

    // Buying 1 unit of last_unit + (3kg + 4kg) of bulk + non-tracked service succeeds
    const validRes = await worker.fetch(
      createSaleRequest({
        items: [
          { productId: prodTrackedLastUnit, quantity: 1 },
          { productId: prodTrackedMulti, quantity: 3 },
          { productId: prodTrackedMulti, quantity: 4 },
          { productId: prodNonTracked, quantity: 1 },
        ],
        payments: [{ method: 'cash', amountMinor: 230000 }],
      }),
      env,
      executionCtx
    )
    expect(validRes.status).toBe(201)

    const balLast = sqlite
      .prepare('SELECT quantity_on_hand FROM inventory_balances WHERE branch_id = ? AND product_id = ?')
      .get(branchId, prodTrackedLastUnit) as { quantity_on_hand: number }
    expect(balLast.quantity_on_hand).toBe(0)

    const balMulti = sqlite
      .prepare('SELECT quantity_on_hand FROM inventory_balances WHERE branch_id = ? AND product_id = ?')
      .get(branchId, prodTrackedMulti) as { quantity_on_hand: number }
    expect(balMulti.quantity_on_hand).toBe(3)

    // Non-tracked product must NOT create balance or movement rows
    const nonTrackedBal = sqlite
      .prepare('SELECT * FROM inventory_balances WHERE branch_id = ? AND product_id = ?')
      .get(branchId, prodNonTracked)
    expect(nonTrackedBal).toBeUndefined()

    // Movements for bulk product chain cleanly 10 -> 7 -> 3
    const multiMovs = sqlite
      .prepare(
        'SELECT previous_quantity, quantity_change, new_quantity FROM stock_movements WHERE product_id = ? ORDER BY rowid ASC'
      )
      .all(prodTrackedMulti) as Array<{ previous_quantity: number; quantity_change: number; new_quantity: number }>
    expect(multiMovs).toHaveLength(2)
    expect(multiMovs[0]).toEqual({ previous_quantity: 10, quantity_change: -3, new_quantity: 7 })
    expect(multiMovs[1]).toEqual({ previous_quantity: 7, quantity_change: -4, new_quantity: 3 })
  })

  it('5. Concurrent checkout race (Promise.all) on last available unit: strictly 1 succeeds, 1 rejects, balance remains 0 (never -1)', async () => {
    const reqA = worker.fetch(
      createSaleRequest(
        {
          items: [{ productId: prodTrackedLastUnit, quantity: 1 }],
          payments: [{ method: 'cash', amountMinor: 50000 }],
        },
        cashierToken,
        'idem_race_A'
      ),
      env,
      executionCtx
    )

    const reqB = worker.fetch(
      createSaleRequest(
        {
          items: [{ productId: prodTrackedLastUnit, quantity: 1 }],
          payments: [{ method: 'cash', amountMinor: 50000 }],
        },
        cashierToken,
        'idem_race_B'
      ),
      env,
      executionCtx
    )

    const [resA, resB] = await Promise.all([reqA, reqB])
    const statuses = [resA.status, resB.status].sort((a, b) => a - b)
    expect(statuses).toEqual([201, 422])

    const failedRes = resA.status === 422 ? resA : resB
    const errJson = (await failedRes.json()) as { error: { code: string } }
    expect(errJson.error.code).toBe('INSUFFICIENT_STOCK')

    // Physical balance MUST be 0 (never -1!)
    const bal = sqlite
      .prepare('SELECT quantity_on_hand FROM inventory_balances WHERE branch_id = ? AND product_id = ?')
      .get(branchId, prodTrackedLastUnit) as { quantity_on_hand: number }
    expect(bal.quantity_on_hand).toBe(0)

    // Strictly 1 sale, 1 invoice, 1 payment, 1 movement, 1 idempotency key!
    expect((sqlite.prepare('SELECT COUNT(*) as cnt FROM sales').get() as { cnt: number }).cnt).toBe(1)
    expect((sqlite.prepare('SELECT COUNT(*) as cnt FROM invoices').get() as { cnt: number }).cnt).toBe(1)
    expect((sqlite.prepare('SELECT COUNT(*) as cnt FROM payments').get() as { cnt: number }).cnt).toBe(1)
    expect((sqlite.prepare('SELECT COUNT(*) as cnt FROM stock_movements').get() as { cnt: number }).cnt).toBe(1)
    expect((sqlite.prepare('SELECT COUNT(*) as cnt FROM idempotency_keys').get() as { cnt: number }).cnt).toBe(1)
  })

  it('6. Failed multi-item batch under concurrency rolls back ALL lines including earlier sufficient item', async () => {
    // Request 1 buys ONLY last unit (1). Request 2 tries to buy Bulk (5, plenty in stock) + Last Unit (1).
    // Both pass pre-checks concurrently; Request 1 commits first leaving Last Unit = 0;
    // Request 2 fails inside batch on Last Unit -> Bulk item's deduction (5) MUST roll back completely to 10!
    const reqSoloLast = worker.fetch(
      createSaleRequest({
        items: [{ productId: prodTrackedLastUnit, quantity: 1 }],
        payments: [{ method: 'cash', amountMinor: 50000 }],
      }),
      env,
      executionCtx
    )

    const reqMulti = worker.fetch(
      createSaleRequest({
        items: [
          { productId: prodTrackedMulti, quantity: 5 },
          { productId: prodTrackedLastUnit, quantity: 1 },
        ],
        payments: [{ method: 'cash', amountMinor: 175000 }],
      }),
      env,
      executionCtx
    )

    const [resSolo, resMulti] = await Promise.all([reqSoloLast, reqMulti])
    expect(resSolo.status).toBe(201)
    expect(resMulti.status).toBe(422)

    // Bulk item MUST remain completely untouched at 10.0!
    const balMulti = sqlite
      .prepare('SELECT quantity_on_hand FROM inventory_balances WHERE branch_id = ? AND product_id = ?')
      .get(branchId, prodTrackedMulti) as { quantity_on_hand: number }
    expect(balMulti.quantity_on_hand).toBe(10)

    const multiMovs = (sqlite.prepare('SELECT COUNT(*) as cnt FROM stock_movements WHERE product_id = ?').get(prodTrackedMulti) as { cnt: number }).cnt
    expect(multiMovs).toBe(0)

    // Total sales = 1 (only solo sale), change log for bulk = 0
    expect((sqlite.prepare('SELECT COUNT(*) as cnt FROM sales').get() as { cnt: number }).cnt).toBe(1)
    expect(
      (sqlite
        .prepare(`SELECT COUNT(*) as cnt FROM sync_change_log WHERE resource_id = ?`)
        .get(`${branchId}:${prodTrackedMulti}`) as { cnt: number }).cnt
    ).toBe(0)
  })

  it('7. Repeated identical sale request with Idempotency-Key deducts stock strictly once', async () => {
    const payload = {
      items: [{ productId: prodTrackedMulti, quantity: 4 }],
      payments: [{ method: 'cash', amountMinor: 100000 }],
    }

    const r1 = await worker.fetch(createSaleRequest(payload, cashierToken, 'idem_repeat_sale_01'), env, executionCtx)
    const r2 = await worker.fetch(createSaleRequest(payload, cashierToken, 'idem_repeat_sale_01'), env, executionCtx)

    expect(r1.status).toBe(201)
    expect(r2.status).toBe(201)
    const d1Json = (await r1.json()) as { data: { id: string } }
    const d2Json = (await r2.json()) as { data: { id: string } }
    expect(d2Json.data.id).toBe(d1Json.data.id)

    const bal = sqlite
      .prepare('SELECT quantity_on_hand FROM inventory_balances WHERE branch_id = ? AND product_id = ?')
      .get(branchId, prodTrackedMulti) as { quantity_on_hand: number }
    expect(bal.quantity_on_hand).toBe(6)
    expect((sqlite.prepare('SELECT COUNT(*) as cnt FROM stock_movements').get() as { cnt: number }).cnt).toBe(1)
  })

  it('8 & 9. INV-002: Offline commit emits authoritative quantityOnHand, skips untracked products, syncs accurately to peer Dexie without zeroing stock', async () => {
    // Register Device A (selling offline) & Device B (peer terminal)
    const devAId = 'dev_p3_a'
    const devBId = 'dev_p3_b'
    sqlite
      .prepare(
        `INSERT INTO devices (id, installation_id, business_id, user_id, label, status)
         VALUES (?, 'inst_p3_a', ?, ?, 'Terminal A', 'active'),
                (?, 'inst_p3_b', ?, ?, 'Terminal B', 'active')`
      )
      .run(devAId, businessId, cashierId, devBId, businessId, cashierId)

    const authRes = await worker.fetch(
      new Request('http://localhost/api/v1/offline/authorizations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          deviceId: devAId,
          products: [
            { productId: prodTrackedMulti, allocatedQuantity: 5 },
            { productId: prodNonTracked, allocatedQuantity: 5 },
          ],
        }),
      }),
      env,
      executionCtx
    )
    expect(authRes.status).toBe(201)
    const authData = ((await authRes.json()) as {
      data: {
        authorizationId: string
        productAllocations: Array<{ allocationId: string; productId: string }>
      }
    }).data

    const bulkAllocId = authData.productAllocations.find((a) => a.productId === prodTrackedMulti)!.allocationId
    const srvAllocId = authData.productAllocations.find((a) => a.productId === prodNonTracked)!.allocationId

    const commitRes = await worker.fetch(
      new Request('http://localhost/api/v1/offline/sales/commit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
          'Idempotency-Key': 'idem_off_p3_01',
        },
        body: JSON.stringify({
          authorizationId: authData.authorizationId,
          deviceId: devAId,
          provisionalSaleId: 'prov_p3_01',
          provisionalReceiptNumber: 'OFF-P3-01',
          items: [
            { productId: prodTrackedMulti, allocationId: bulkAllocId, quantity: 3, unitPriceMinor: 25000 },
            { productId: prodNonTracked, allocationId: srvAllocId, quantity: 2, unitPriceMinor: 5000 },
          ],
          cashTenderedMinor: 90000,
          offlineCreatedAt: new Date().toISOString(),
        }),
      }),
      env,
      executionCtx
    )
    expect(commitRes.status).toBe(201)

    // Verify tracked inventory balance became 10 - 3 = 7, non-tracked created ZERO stock_movements/balances
    const dbBal = sqlite
      .prepare('SELECT quantity_on_hand FROM inventory_balances WHERE branch_id = ? AND product_id = ?')
      .get(branchId, prodTrackedMulti) as { quantity_on_hand: number }
    expect(dbBal.quantity_on_hand).toBe(7)
    expect(
      (sqlite.prepare('SELECT COUNT(*) as cnt FROM stock_movements WHERE product_id = ?').get(prodNonTracked) as { cnt: number }).cnt
    ).toBe(0)

    // Verify sync_change_log contains authoritative quantityOnHand = 7
    const changeRow = sqlite
      .prepare(`SELECT payload FROM sync_change_log WHERE resource_type = 'stock' AND resource_id = ?`)
      .get(prodTrackedMulti) as { payload: string }
    const changePayload = JSON.parse(changeRow.payload) as { quantityOnHand: number; quantityDeducted: number; unit: string }
    expect(changePayload.quantityOnHand).toBe(7)
    expect(changePayload.quantityDeducted).toBe(3)
    expect(changePayload.unit).toBe('kg')

    // Peer Device B pulls changes via real SyncClient + Worker /sync/changes
    setApiContextProvider(() => ({
      userId: cashierId,
      businessId,
      branchId,
    }))
    const peerInstBId = await offlineDb.getDeviceId()
    sqlite
      .prepare('UPDATE devices SET installation_id = ? WHERE id = ?')
      .run(peerInstBId, devBId)

    const customApi = {
      ...apiClient,
      async get<T>(urlPath: string, options: { params?: Record<string, string | number>; headers?: Record<string, string> } = {}): Promise<T> {
        const url = new URL(`http://localhost/api/v1${urlPath}`)
        if (options.params) {
          for (const [k, v] of Object.entries(options.params)) {
            url.searchParams.set(k, String(v))
          }
        }
        const res = await worker.fetch(
          new Request(url.toString(), {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${cashierToken}`,
              'X-Business-Id': businessId,
              ...(options.headers || {}),
            },
          }),
          env,
          executionCtx
        )
        const json = (await res.json()) as { data?: T }
        return (json.data ?? json) as T
      },
      async post<T>(urlPath: string, body?: unknown): Promise<T> {
        const res = await worker.fetch(
          new Request(`http://localhost/api/v1${urlPath}`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${cashierToken}`,
              'X-Business-Id': businessId,
              'Content-Type': 'application/json',
            },
            body: body ? JSON.stringify(body) : undefined,
          }),
          env,
          executionCtx
        )
        const json = (await res.json()) as { data?: T }
        return (json.data ?? json) as T
      },
    }

    const syncClient = new SyncClient({ db: offlineDb, api: customApi as typeof apiClient })
    await syncClient.pullAndApplyChanges({ userId: cashierId, businessId, branchId })

    const stockKey = buildStockKey(cashierId, businessId, branchId, 'snap_active', prodTrackedMulti)
    const syncedStock = await offlineDb.cachedBranchStock.get(stockKey)
    expect(syncedStock).toBeDefined()
    expect(syncedStock?.quantityOnHand).toBe(7)
    expect(syncedStock?.unit).toBe('kg')

    // Inject malformed change event omitting quantityOnHand -> SyncClient MUST NOT zero out cached balance 7 -> 0!
    sqlite
      .prepare(
        `INSERT INTO sync_change_log (business_id, branch_id, resource_type, resource_id, resource_version, operation, payload, event_id, created_at)
         VALUES (?, ?, 'stock', ?, 1, 'upsert', ?, 'evt_malformed_stock', datetime('now'))`
      )
      .run(
        businessId,
        branchId,
        prodTrackedMulti,
        JSON.stringify({ productId: prodTrackedMulti, branchId, quantityDeducted: 1, reason: 'legacy_event' })
      )

    await syncClient.pullAndApplyChanges({ userId: cashierId, businessId, branchId })
    const stockAfterMalformed = await offlineDb.cachedBranchStock.get(stockKey)
    expect(stockAfterMalformed?.quantityOnHand).toBe(7)
  })

  it('10. Stock adjustment updates balance, records movement, emits authoritative quantityOnHand, and blocks concurrent underflow', async () => {
    const adjInRes = await worker.fetch(
      new Request('http://localhost/api/v1/inventory/adjustments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          productId: prodTrackedMissingRow,
          type: 'adjustment_in',
          quantityChange: 12,
          reason: 'Opening count Intake',
        }),
      }),
      env,
      executionCtx
    )
    expect(adjInRes.status).toBe(201)
    const adjDto = ((await adjInRes.json()) as { data: { previousQuantity: number; newQuantity: number } }).data
    expect(adjDto.previousQuantity).toBe(0)
    expect(adjDto.newQuantity).toBe(12)

    const evt = sqlite
      .prepare(`SELECT payload FROM sync_change_log WHERE resource_id = ? ORDER BY id DESC LIMIT 1`)
      .get(`${branchId}:${prodTrackedMissingRow}`) as { payload: string }
    expect(JSON.parse(evt.payload).quantityOnHand).toBe(12)

    // Concurrent adjustment_out (8) vs adjustment_out (7) from 12 -> one wins (4), other fails cleanly with 422!
    const [outA, outB] = await Promise.all([
      worker.fetch(
        new Request('http://localhost/api/v1/inventory/adjustments', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ownerToken}`,
            'X-Business-Id': businessId,
            'X-Branch-Id': branchId,
          },
          body: JSON.stringify({
            productId: prodTrackedMissingRow,
            type: 'adjustment_out',
            quantityChange: 8,
            reason: 'Damaged batch A',
          }),
        }),
        env,
        executionCtx
      ),
      worker.fetch(
        new Request('http://localhost/api/v1/inventory/adjustments', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ownerToken}`,
            'X-Business-Id': businessId,
            'X-Branch-Id': branchId,
          },
          body: JSON.stringify({
            productId: prodTrackedMissingRow,
            type: 'adjustment_out',
            quantityChange: 7,
            reason: 'Damaged batch B',
          }),
        }),
        env,
        executionCtx
      ),
    ])

    const adjStatuses = [outA.status, outB.status].sort((a, b) => a - b)
    expect(adjStatuses).toEqual([201, 422])

    const balAfter = sqlite
      .prepare('SELECT quantity_on_hand FROM inventory_balances WHERE branch_id = ? AND product_id = ?')
      .get(branchId, prodTrackedMissingRow) as { quantity_on_hand: number }
    expect(balAfter.quantity_on_hand).toBeGreaterThanOrEqual(4)
    expect(balAfter.quantity_on_hand).toBeLessThanOrEqual(5)
  })

  it('11. Purchase goods receipt increments missing or existing balance accurately and emits authoritative quantityOnHand', async () => {
    const poRes = await worker.fetch(
      new Request('http://localhost/api/v1/purchases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          supplierId,
          items: [{ productId: prodTrackedMissingRow, orderedQuantity: 25, unitCostMinor: 11000 }],
        }),
      }),
      env,
      executionCtx
    )
    expect(poRes.status).toBe(201)
    const po = ((await poRes.json()) as { data: { id: string; items: Array<{ id: string }> } }).data

    await worker.fetch(
      new Request(`http://localhost/api/v1/purchases/${po.id}/confirm`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'X-Business-Id': businessId,
        },
      }),
      env,
      executionCtx
    )

    const grRes = await worker.fetch(
      new Request(`http://localhost/api/v1/purchases/${po.id}/receipts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          items: [{ purchaseItemId: po.items[0].id, quantityReceived: 25 }],
        }),
      }),
      env,
      executionCtx
    )
    expect(grRes.status).toBe(201)

    const bal = sqlite
      .prepare('SELECT quantity_on_hand FROM inventory_balances WHERE branch_id = ? AND product_id = ?')
      .get(branchId, prodTrackedMissingRow) as { quantity_on_hand: number }
    expect(bal.quantity_on_hand).toBe(25)

    const mov = sqlite
      .prepare(`SELECT type, previous_quantity, quantity_change, new_quantity FROM stock_movements WHERE product_id = ?`)
      .get(prodTrackedMissingRow) as { type: string; previous_quantity: number; quantity_change: number; new_quantity: number }
    expect(mov).toEqual({
      type: 'purchase_receipt',
      previous_quantity: 0,
      quantity_change: 25,
      new_quantity: 25,
    })

    const evt = sqlite
      .prepare(`SELECT payload FROM sync_change_log WHERE resource_id = ? ORDER BY id DESC LIMIT 1`)
      .get(`${branchId}:${prodTrackedMissingRow}`) as { payload: string }
    expect(JSON.parse(evt.payload).quantityOnHand).toBe(25)
  })
})
