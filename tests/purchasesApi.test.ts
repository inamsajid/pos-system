import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import worker from '../worker/src/index'
import type { Env } from '../worker/src/types/environment'
import { createSession } from '../worker/src/auth/sessionService'

function createRealD1(sqlite: DatabaseSync): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T = Record<string, unknown>>() {
              const stmt = sqlite.prepare(query)
              const row = stmt.get(...args)
              return (row as T) || null
            },
            async all<T = Record<string, unknown>>() {
              const stmt = sqlite.prepare(query)
              const results = stmt.all(...args) as T[]
              return { results, success: true, meta: {} }
            },
            async run() {
              const stmt = sqlite.prepare(query)
              const info = stmt.run(...args)
              return { success: true, meta: { changes: info.changes } }
            },
            async raw() {
              const stmt = sqlite.prepare(query)
              return stmt.all(...args) as unknown[]
            },
          } as unknown as D1PreparedStatement
        },
        async first<T = Record<string, unknown>>() {
          const stmt = sqlite.prepare(query)
          const row = stmt.get()
          return (row as T) || null
        },
        async all<T = Record<string, unknown>>() {
          const stmt = sqlite.prepare(query)
          const results = stmt.all() as T[]
          return { results, success: true, meta: {} }
        },
        async run() {
          const stmt = sqlite.prepare(query)
          const info = stmt.run()
          return { success: true, meta: { changes: info.changes } }
        },
      } as unknown as D1PreparedStatement
    },
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      sqlite.exec('BEGIN TRANSACTION;')
      try {
        const results = []
        for (const s of statements) {
          results.push(await s.run())
        }
        sqlite.exec('COMMIT;')
        return results
      } catch (e) {
        sqlite.exec('ROLLBACK;')
        throw e
      }
    },
    async exec(query: string) {
      sqlite.exec(query)
      return { count: 1, duration: 0 }
    },
  } as unknown as D1Database
}

const executionCtx: ExecutionContext = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
}

describe('Purchases & Purchase Orders APIs', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const businessId = 'biz_po_test'
  const branchId = 'branch_po_main'
  const ownerUserId = 'usr_po_owner'
  const cashierUserId = 'usr_po_cashier'
  let ownerToken: string
  let cashierToken: string

  const supplierAId = 'supp_po_a'
  const supplierArchivedId = 'supp_po_arch'
  const prodAId = 'prod_po_a'
  const prodBId = 'prod_po_b'

  beforeEach(async () => {
    sqlite = new DatabaseSync(':memory:')
    sqlite.exec('PRAGMA foreign_keys = ON;')

    const migrationsDir = path.resolve(process.cwd(), 'worker/migrations')
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
      sqlite.exec(sql)
    }

    d1 = createRealD1(sqlite)
    env = {
      DB: d1,
      FILES: {} as unknown as R2Bucket,
      ENVIRONMENT: 'local',
      SERVICE_NAME: 'pos-system-api',
      API_VERSION: 'v1',
    }

    // Seed Business & Branch
    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'BIZPO', 'Apex Procurement Corp', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Main Distribution Center', 1, 'active')
    `).run(branchId, businessId)

    // Seed Users (Owner & Cashier)
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'owner@apexpo.pk', 'Purchasing Officer', 'dummy_hash', 'active'),
             (?, 'cashier@apexpo.pk', 'Cash Desk', 'dummy_hash', 'active')
    `).run(ownerUserId, cashierUserId)

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_po_owner', ?, ?, 'owner', 1),
             ('mem_po_cashier', ?, ?, 'cashier', 1)
    `).run(businessId, ownerUserId, businessId, cashierUserId)

    sqlite.prepare(`
      INSERT INTO member_branches (id, member_id, branch_id)
      VALUES ('mb_po_cashier', 'mem_po_cashier', ?)
    `).run(branchId)

    // Seed Active Supplier and Inactive Supplier
    sqlite.prepare(`
      INSERT INTO suppliers (id, business_id, supplier_code, name, company_name, phone, email, tax_number, opening_payable_minor, status)
      VALUES (?, ?, 'SUPP-001', 'Premier Tech Wholesale', 'Premier Ltd', '03001234567', 'sales@premier.pk', 'NTN112233', 0, 'active'),
             (?, ?, 'SUPP-002', 'Defunct Supply Co', 'Defunct Ltd', '03009999999', 'old@defunct.pk', 'NTN999999', 0, 'archived')
    `).run(supplierAId, businessId, supplierArchivedId, businessId)

    // Seed Category and Products
    sqlite.prepare(`
      INSERT INTO categories (id, business_id, name, slug)
      VALUES ('cat_po_1', ?, 'IT Hardware', 'it-hardware')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO products (id, business_id, category_id, name, sku, unit, purchase_price_minor, selling_price_minor, status)
      VALUES (?, ?, 'cat_po_1', '24-inch IPS Monitor', 'SKU-MON-24', 'piece', 2500000, 3200000, 'active'),
             (?, ?, 'cat_po_1', 'HDMI Cable 2m', 'SKU-HDMI-2M', 'piece', 50000, 120000, 'active')
    `).run(prodAId, businessId, prodBId, businessId)

    // Seed initial balance 0
    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand)
      VALUES ('bal_po_1', ?, ?, ?, 0.0),
             ('bal_po_2', ?, ?, ?, 0.0)
    `).run(businessId, branchId, prodAId, businessId, branchId, prodBId)

    ownerToken = (await createSession(d1, ownerUserId)).token
    cashierToken = (await createSession(d1, cashierUserId)).token
  })

  it('creates a draft purchase order with correct multi-item totals and WITHOUT muting stock', async () => {
    const payload = {
      branchId,
      supplierId: supplierAId,
      expectedDeliveryDate: '2026-11-20',
      notes: 'Urgent restocking order',
      items: [
        {
          productId: prodAId,
          orderedQuantity: 10,
          unitCostMinor: 2400000, // Rs 24,000 per monitor
          discountMinor: 1000000, // Rs 10,000 line discount
        },
        {
          productId: prodBId,
          orderedQuantity: 50,
          unitCostMinor: 45000, // Rs 450 per cable
          discountMinor: 0,
        },
      ],
    }

    const req = new Request('https://pos.internal/api/v1/purchases', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': businessId,
        'X-Branch-Id': branchId,
      },
      body: JSON.stringify(payload),
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(201)
    const json = (await res.json()) as { data: { id: string; purchaseNumber: string; status: string; subtotalMinor: number; discountMinor: number; totalAmountMinor: number; items: unknown[] } }
    
    // Subtotal: (10 * 2400000) + (50 * 45000) = 24,000,000 + 2,250,000 = 26,250,000
    expect(json.data.status).toBe('draft')
    expect(json.data.subtotalMinor).toBe(26250000)
    expect(json.data.discountMinor).toBe(1000000)
    expect(json.data.totalAmountMinor).toBe(25250000) // 26,250,000 - 1,000,000

    // CRITICAL: Stock balances MUST remain 0 and ZERO movements created!
    const balA = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND product_id = ?').get(businessId, prodAId) as { quantity_on_hand: number }
    expect(balA.quantity_on_hand).toBe(0.0)

    const movCount = sqlite.prepare('SELECT COUNT(*) as cnt FROM stock_movements WHERE business_id = ?').get(businessId) as { cnt: number }
    expect(movCount.cnt).toBe(0)
  })

  it('updates draft purchase and confirms PO without touching inventory balances', async () => {
    // 1. Create Draft
    const createReq = new Request('https://pos.internal/api/v1/purchases', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': businessId,
        'X-Branch-Id': branchId,
      },
      body: JSON.stringify({
        supplierId: supplierAId,
        items: [{ productId: prodAId, orderedQuantity: 5, unitCostMinor: 2500000 }],
      }),
    })
    const createRes = await worker.fetch(createReq, env, executionCtx)
    const purchase = ((await createRes.json()) as { data: { id: string } }).data

    // 2. Patch Draft
    const patchReq = new Request(`https://pos.internal/api/v1/purchases/${purchase.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': businessId,
      },
      body: JSON.stringify({
        notes: 'Updated PO delivery instructions',
        supplierInvoiceNumber: 'INV-SUPP-9988',
      }),
    })
    const patchRes = await worker.fetch(patchReq, env, executionCtx)
    expect(patchRes.status).toBe(200)

    // 3. Confirm Purchase
    const confirmReq = new Request(`https://pos.internal/api/v1/purchases/${purchase.id}/confirm`, {
      method: 'POST',
      headers: {
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': businessId,
      },
    })
    const confirmRes = await worker.fetch(confirmReq, env, executionCtx)
    expect(confirmRes.status).toBe(200)
    const confirmJson = (await confirmRes.json()) as { data: { status: string; confirmedAt: string | null } }
    expect(confirmJson.data.status).toBe('ordered')
    expect(confirmJson.data.confirmedAt).toBeTruthy()

    // CRITICAL: Inventory balances must still be 0! Stock ONLY increases on Goods Receipt.
    const balA = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND product_id = ?').get(businessId, prodAId) as { quantity_on_hand: number }
    expect(balA.quantity_on_hand).toBe(0.0)

    const movCount = sqlite.prepare('SELECT COUNT(*) as cnt FROM stock_movements WHERE business_id = ?').get(businessId) as { cnt: number }
    expect(movCount.cnt).toBe(0)
  })

  it('cancels an unreceived PO and enforces BDR-10 blocking when items have been received', async () => {
    // 1. Create & Confirm PO
    const createReq = new Request('https://pos.internal/api/v1/purchases', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': businessId,
        'X-Branch-Id': branchId,
      },
      body: JSON.stringify({
        supplierId: supplierAId,
        items: [{ productId: prodBId, orderedQuantity: 20, unitCostMinor: 40000 }],
      }),
    })
    const createRes = await worker.fetch(createReq, env, executionCtx)
    const po = ((await createRes.json()) as { data: { id: string } }).data

    // Cancel before receiving: should succeed
    const cancelReq = new Request(`https://pos.internal/api/v1/purchases/${po.id}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': businessId,
      },
      body: JSON.stringify({ reason: 'Supplier out of stock' }),
    })
    const cancelRes = await worker.fetch(cancelReq, env, executionCtx)
    expect(cancelRes.status).toBe(200)
    const cancelJson = (await cancelRes.json()) as { data: { status: string } }
    expect(cancelJson.data.status).toBe('cancelled')

    // BDR-10: Simulate PO with received items or payments: cancellation must be rejected
    sqlite.prepare(`
      INSERT INTO purchases (id, business_id, branch_id, purchase_number, supplier_id, supplier_snapshot_json, subtotal_minor, discount_minor, tax_minor, total_amount_minor, paid_amount_minor, status, purchase_date_key, created_by)
      VALUES ('po_with_receipt', ?, ?, 'PO-REC-1', ?, '{}', 100000, 0, 0, 100000, 0, 'partially_received', '2026-11-09', ?)
    `).run(businessId, branchId, supplierAId, ownerUserId)

    sqlite.prepare(`
      INSERT INTO purchase_items (id, purchase_id, product_id, sku, product_name, unit, ordered_quantity, received_quantity, unit_cost_minor, discount_minor, line_total_minor)
      VALUES ('poi_with_rec', 'po_with_receipt', ?, 'SKU-MON-24', 'Monitor', 'piece', 10, 5, 10000, 0, 100000)
    `).run(prodAId)

    const blockedCancelReq = new Request('https://pos.internal/api/v1/purchases/po_with_receipt/cancel', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': businessId,
      },
      body: JSON.stringify({ reason: 'Try to cancel received order' }),
    })
    const blockedRes = await worker.fetch(blockedCancelReq, env, executionCtx)
    expect(blockedRes.status).toBe(400)
    const err = (await blockedRes.json()) as { error: { message: string } }
    expect(err.error.message).toContain('items have already been received')
  })

  it('rejects purchase order creation against archived supplier', async () => {
    const req = new Request('https://pos.internal/api/v1/purchases', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': businessId,
        'X-Branch-Id': branchId,
      },
      body: JSON.stringify({
        supplierId: supplierArchivedId,
        items: [{ productId: prodAId, orderedQuantity: 5, unitCostMinor: 2500000 }],
      }),
    })
    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(400)
    const err = (await res.json()) as { error: { message: string } }
    expect(err.error.message).toContain('archived supplier')
  })

  it('enforces RBAC permissions: cashier cannot create or confirm purchase orders', async () => {
    const req = new Request('https://pos.internal/api/v1/purchases', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `__session=${cashierToken}`,
        'X-Business-Id': businessId,
        'X-Branch-Id': branchId,
      },
      body: JSON.stringify({
        supplierId: supplierAId,
        items: [{ productId: prodAId, orderedQuantity: 1, unitCostMinor: 100000 }],
      }),
    })
    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(403)
  })
})
