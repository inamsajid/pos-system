import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import worker from '../worker/src/index'
import type { Env } from '../worker/src/types/environment'
import { createSession } from '../worker/src/auth/sessionService'
import { createTestD1Database } from './offline/testD1Helper'

const executionCtx: ExecutionContext = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
}

describe('Phase 2 Regression (FIN-001): Server-Authoritative Pricing, Overrides, Discounts, Tax & Offline Price Policy', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const businessId = 'biz_fin001'
  const branchId = 'branch_fin001'
  const managerUserId = 'usr_mgr_fin001'
  const cashierUserId = 'usr_cashier_fin001'
  const customerId = 'cust_fin001'
  const teaId = 'prod_fin001_tea'
  const sugarId = 'prod_fin001_sugar'
  const deviceId = 'dev_fin001'

  let managerToken: string
  let cashierToken: string

  beforeEach(async () => {
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
      AUTH_SECRET: 'test-fin001-signing-secret-key-32-chars',
    }

    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'FIN001', 'Northstar Authority Test', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Main Branch', 1, 'active')
    `).run(branchId, businessId)

    sqlite.prepare(`
      INSERT INTO business_settings (business_id, allow_negative_stock, default_tax_rate, settings_json)
      VALUES (?, 0, 0.0, '{"taxInclusive":false,"maxCashierDiscountPercent":10}')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'mgr@fin001.pk', 'Manager', 'hash', 'active'),
             (?, 'cashier@fin001.pk', 'Cashier', 'hash', 'active')
    `).run(managerUserId, cashierUserId)

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_mgr', ?, ?, 'manager', 1),
             ('mem_cash', ?, ?, 'cashier', 1)
    `).run(businessId, managerUserId, businessId, cashierUserId)

    sqlite.prepare(`
      INSERT INTO member_branches (id, member_id, branch_id)
      VALUES ('mb_mgr', 'mem_mgr', ?),
             ('mb_cash', 'mem_cash', ?)
    `).run(branchId, branchId)

    sqlite.prepare(`
      INSERT INTO devices (id, installation_id, business_id, user_id, label, status)
      VALUES (?, 'inst_fin001', ?, ?, 'POS Terminal 1', 'active')
    `).run(deviceId, businessId, cashierUserId)

    sqlite.prepare(`
      INSERT INTO products (id, business_id, name, sku, barcode, unit, purchase_price_minor, selling_price_minor, track_inventory, status)
      VALUES (?, ?, 'Danedar Tea', 'TEA-01', '111001', 'piece', 40000, 55000, 1, 'active'),
             (?, ?, 'White Sugar', 'SUG-01', '111002', 'kg', 12000, 15000, 1, 'active')
    `).run(teaId, businessId, sugarId, businessId)

    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand)
      VALUES ('bal_tea', ?, ?, ?, 100),
             ('bal_sug', ?, ?, ?, 100)
    `).run(businessId, branchId, teaId, businessId, branchId, sugarId)

    sqlite.prepare(`
      INSERT INTO customers (id, business_id, customer_code, name, type, opening_balance_minor, credit_limit_minor, is_walk_in, status)
      VALUES (?, ?, 'CUST-FIN', 'Account Customer', 'business', 0, 5000000, 0, 'active')
    `).run(customerId, businessId)

    managerToken = (await createSession(d1, managerUserId)).token
    cashierToken = (await createSession(d1, cashierUserId)).token
  })

  it('rejects tampered item unitPriceMinor submitted by cashier with 403', async () => {
    const res = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          items: [{ productId: teaId, quantity: 2, unitPriceMinor: 100, overrideReason: 'Self discount' }],
          payments: [{ method: 'cash', amountMinor: 200 }],
        }),
      }),
      env,
      executionCtx
    )

    expect(res.status).toBe(403)
    const count = sqlite.prepare('SELECT COUNT(*) as cnt FROM sales WHERE business_id = ?').get(businessId) as { cnt: number }
    expect(count.cnt).toBe(0)
  })

  it('rejects line-item discountMinor and excessive order discounts from cashier with 403', async () => {
    // Line-item discount requires discount_override
    const lineRes = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          items: [{ productId: teaId, quantity: 1, discountMinor: 500, overrideReason: 'Promo' }],
          payments: [{ method: 'cash', amountMinor: 54500 }],
        }),
      }),
      env,
      executionCtx
    )
    expect(lineRes.status).toBe(403)

    // Order discount 25% > 10% cashier cap -> 403
    const orderRes = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          items: [{ productId: teaId, quantity: 2 }], // 110000
          discountType: 'percent',
          discountValue: 25,
          payments: [{ method: 'cash', amountMinor: 82500 }],
        }),
      }),
      env,
      executionCtx
    )
    expect(orderRes.status).toBe(403)
  })

  it('allows cashier discount within policy threshold and enforces proportional distribution + ledger parity', async () => {
    const res = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          customerId,
          items: [
            { productId: teaId, quantity: 1 }, // 55000
            { productId: sugarId, quantity: 3 }, // 45000 -> total 100000
          ],
          discountType: 'percent',
          discountValue: 10, // 10000 minor
          payments: [{ method: 'cash', amountMinor: 90000 }],
        }),
      }),
      env,
      executionCtx
    )

    expect(res.status).toBe(201)
    const sale = ((await res.json()) as { data: Record<string, unknown> }).data
    expect(sale.subtotalMinor).toBe(100000)
    expect(sale.discountMinor).toBe(10000)
    expect(sale.totalAmountMinor).toBe(90000)

    const items = sale.items as Array<{ discountMinor: number; lineTotalMinor: number }>
    expect(items.reduce((s, i) => s + i.discountMinor, 0)).toBe(10000)
    expect(items.reduce((s, i) => s + i.lineTotalMinor, 0)).toBe(90000)

    const inv = sqlite.prepare('SELECT total_amount_minor, paid_amount_minor FROM invoices WHERE sale_id = ?').get(sale.id as string) as { total_amount_minor: number; paid_amount_minor: number }
    expect(inv.total_amount_minor).toBe(90000)
    expect(inv.paid_amount_minor).toBe(90000)

    const pay = sqlite.prepare('SELECT amount_minor FROM payments WHERE business_id = ?').get(businessId) as { amount_minor: number }
    expect(pay.amount_minor).toBe(90000)
  })

  it('computes authoritative business tax (exclusive & inclusive) and blocks cashier taxMinor tampering', async () => {
    // Enable 17% exclusive GST
    sqlite.prepare(`UPDATE business_settings SET default_tax_rate = 17.0, settings_json = '{"taxInclusive":false}' WHERE business_id = ?`).run(businessId)

    // 1. Cashier tampers taxMinor: 0 -> 403 FORBIDDEN
    const tamperRes = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          items: [{ productId: teaId, quantity: 2, taxMinor: 0 }],
          payments: [{ method: 'cash', amountMinor: 110000 }],
        }),
      }),
      env,
      executionCtx
    )
    expect(tamperRes.status).toBe(403)

    // 2. Cashier omits taxMinor -> server computes 17% on 110000 = 18700 -> total 128700
    const underpayRes = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          items: [{ productId: teaId, quantity: 2 }],
          payments: [{ method: 'cash', amountMinor: 110000 }], // Pre-tax cash insufficient for walk-in
        }),
      }),
      env,
      executionCtx
    )
    expect(underpayRes.status).toBe(400)

    const okRes = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          items: [{ productId: teaId, quantity: 2 }],
          payments: [{ method: 'cash', amountMinor: 128700 }],
        }),
      }),
      env,
      executionCtx
    )
    expect(okRes.status).toBe(201)
    const exclSale = ((await okRes.json()) as { data: Record<string, unknown> }).data
    expect(exclSale.taxMinor).toBe(18700)
    expect(exclSale.totalAmountMinor).toBe(128700)

    // 3. Tax-inclusive 16%: price 116000 includes 16000 extracted tax
    sqlite.prepare(`UPDATE business_settings SET default_tax_rate = 16.0, settings_json = '{"taxInclusive":true}' WHERE business_id = ?`).run(businessId)
    sqlite.prepare(`UPDATE products SET selling_price_minor = 58000 WHERE id = ?`).run(teaId)
    const inclRes = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          items: [{ productId: teaId, quantity: 2 }], // 116000 gross
          payments: [{ method: 'cash', amountMinor: 116000 }],
        }),
      }),
      env,
      executionCtx
    )
    expect(inclRes.status).toBe(201)
    const inclSale = ((await inclRes.json()) as { data: Record<string, unknown> }).data
    expect(inclSale.taxMinor).toBe(16000)
    expect(inclSale.totalAmountMinor).toBe(116000)
  })

  it('allows authorized manager price & tax overrides with required reason and audit log entries', async () => {
    sqlite.prepare(`UPDATE business_settings SET default_tax_rate = 17.0 WHERE business_id = ?`).run(businessId)

    // Manager override without reason -> 400
    const noReasonRes = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${managerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          items: [{ productId: teaId, quantity: 1, unitPriceMinor: 45000 }],
          payments: [{ method: 'cash', amountMinor: 52650 }],
        }),
      }),
      env,
      executionCtx
    )
    expect(noReasonRes.status).toBe(400)

    // Valid manager price + tax override
    const validRes = await worker.fetch(
      new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${managerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          items: [
            {
              productId: teaId,
              quantity: 1,
              unitPriceMinor: 45000,
              taxMinor: 0,
              taxOverride: true,
              overrideReason: 'Damaged box & tax-exempt charity order',
            },
          ],
          payments: [{ method: 'cash', amountMinor: 45000 }],
        }),
      }),
      env,
      executionCtx
    )
    expect(validRes.status).toBe(201)
    const sale = ((await validRes.json()) as { data: Record<string, unknown> }).data
    expect(sale.totalAmountMinor).toBe(45000)

    const items = sale.items as Array<Record<string, unknown>>
    expect(items[0].originalUnitPriceMinor).toBe(55000)
    expect(items[0].unitPriceMinor).toBe(45000)
    expect(items[0].priceOverrideReason).toBe('Damaged box & tax-exempt charity order')
    expect(items[0].priceOverrideBy).toBe(managerUserId)

    const audits = sqlite
      .prepare('SELECT action, diff_json FROM audit_logs WHERE entity_id = ? ORDER BY rowid ASC')
      .all(sale.id as string) as Array<{ action: string; diff_json: string }>
    expect(audits.map((a) => a.action)).toEqual(['SALE_PRICE_OVERRIDE', 'SALE_TAX_OVERRIDE'])
  })

  it('supports offline subset carts, rejects tampered offline prices (403), and detects catalog price drift (409 OFFLINE_PRICE_CONFLICT)', async () => {
    // 1. Issue offline authorization covering BOTH tea and sugar
    const authRes = await worker.fetch(
      new Request('http://localhost/api/v1/offline/authorizations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          deviceId,
          products: [
            { productId: teaId, allocatedQuantity: 5 },
            { productId: sugarId, allocatedQuantity: 5 },
          ],
        }),
      }),
      env,
      executionCtx
    )
    expect(authRes.status).toBe(201)
    const auth = ((await authRes.json()) as { data: {
      authorizationId: string
      productAllocations: Array<{ allocationId: string; productId: string }>
    } }).data
    const teaAlloc = auth.productAllocations.find((a) => a.productId === teaId)!

    // 2. Tampered offline unitPriceMinor -> 403
    const tamperRes = await worker.fetch(
      new Request('http://localhost/api/v1/offline/sales/commit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          authorizationId: auth.authorizationId,
          deviceId,
          provisionalSaleId: 'prov_tamp_1',
          provisionalReceiptNumber: 'OFF-TAMP-01',
          items: [{ productId: teaId, allocationId: teaAlloc.allocationId, quantity: 1, unitPriceMinor: 100 }],
          cashTenderedMinor: 100,
          offlineCreatedAt: new Date().toISOString(),
        }),
      }),
      env,
      executionCtx
    )
    expect(tamperRes.status).toBe(403)

    // 3. Subset cart (ONLY tea out of {tea, sugar}) succeeds cleanly!
    const subsetRes = await worker.fetch(
      new Request('http://localhost/api/v1/offline/sales/commit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          authorizationId: auth.authorizationId,
          deviceId,
          provisionalSaleId: 'prov_sub_1',
          provisionalReceiptNumber: 'OFF-SUB-01',
          items: [{ productId: teaId, allocationId: teaAlloc.allocationId, quantity: 2, unitPriceMinor: 55000 }],
          cashTenderedMinor: 120000,
          offlineCreatedAt: new Date().toISOString(),
        }),
      }),
      env,
      executionCtx
    )
    expect(subsetRes.status).toBe(201)
    const subsetData = ((await subsetRes.json()) as { data: { totalAmountMinor: number } }).data
    expect(subsetData.totalAmountMinor).toBe(110000)

    // 4. Server catalog price changes while offline -> 409 OFFLINE_PRICE_CONFLICT for cashier
    sqlite.prepare('UPDATE products SET selling_price_minor = 60000 WHERE id = ?').run(teaId)
    const conflictRes = await worker.fetch(
      new Request('http://localhost/api/v1/offline/sales/commit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          authorizationId: auth.authorizationId,
          deviceId,
          provisionalSaleId: 'prov_conf_1',
          provisionalReceiptNumber: 'OFF-CONF-01',
          items: [{ productId: teaId, allocationId: teaAlloc.allocationId, quantity: 1, unitPriceMinor: 55000 }],
          cashTenderedMinor: 60000,
          offlineCreatedAt: new Date().toISOString(),
        }),
      }),
      env,
      executionCtx
    )
    expect(conflictRes.status).toBe(409)
    const conflictBody = (await conflictRes.json()) as { error: { code: string } }
    expect(conflictBody.error.code).toBe('OFFLINE_PRICE_CONFLICT')

    // 5. Authorized manager resolves conflict honoring offline snapshot price with audit trail
    const resolvedRes = await worker.fetch(
      new Request('http://localhost/api/v1/offline/sales/commit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${managerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          authorizationId: auth.authorizationId,
          deviceId,
          provisionalSaleId: 'prov_res_1',
          provisionalReceiptNumber: 'OFF-RES-01',
          items: [{ productId: teaId, allocationId: teaAlloc.allocationId, quantity: 1, unitPriceMinor: 55000 }],
          cashTenderedMinor: 55000,
          offlineCreatedAt: new Date().toISOString(),
          priceConflictResolution: {
            mode: 'accept_offline_price',
            reason: 'Honored offline price printed before central price hike',
          },
        }),
      }),
      env,
      executionCtx
    )
    expect(resolvedRes.status).toBe(201)
    const resolvedData = ((await resolvedRes.json()) as { data: { saleId: string; totalAmountMinor: number } }).data
    expect(resolvedData.totalAmountMinor).toBe(55000)

    const saleItemRow = sqlite
      .prepare('SELECT unit_price_minor, original_unit_price_minor, price_override_reason FROM sale_items WHERE sale_id = ?')
      .get(resolvedData.saleId) as { unit_price_minor: number; original_unit_price_minor: number; price_override_reason: string }
    expect(saleItemRow.unit_price_minor).toBe(55000)
    expect(saleItemRow.original_unit_price_minor).toBe(60000)
    expect(saleItemRow.price_override_reason).toBe('Honored offline price printed before central price hike')
  })
})
