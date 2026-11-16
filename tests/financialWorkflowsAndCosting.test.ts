import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import worker from '../worker/src/index'
import { getCurrentBusinessDateKey } from '../worker/src/lib/businessDate'

function createSqliteD1(sqlite: DatabaseSync): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async first<T = unknown>(colName?: string): Promise<T | null> {
              const stmt = sqlite.prepare(query)
              const row = stmt.get(...(params as any[])) as Record<string, unknown> | undefined
              if (!row) return null
              if (colName) return (row[colName] as T) ?? null
              return row as T
            },
            async all<T = unknown>(): Promise<D1Result<T>> {
              const stmt = sqlite.prepare(query)
              const rows = stmt.all(...(params as any[]))
              return { results: rows as T[], success: true, meta: {} as any }
            },
            async run(): Promise<D1Response> {
              const stmt = sqlite.prepare(query)
              const result = stmt.run(...(params as any[]))
              return { success: true, meta: { changes: result.changes } as any }
            },
          }
        },
      } as unknown as D1PreparedStatement
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const results: D1Result<T>[] = []
      for (const s of statements) {
        const r = await (s as any).run()
        results.push({ results: [], success: r.success, meta: r.meta })
      }
      return results
    },
    async exec(query: string): Promise<D1ExecResult> {
      sqlite.exec(query)
      return { count: 1, duration: 0 }
    },
    dump(): Promise<ArrayBuffer> {
      throw new Error('dump not supported')
    },
  } as unknown as D1Database
}

describe('Financial Workflows and Costing Integration (Phase 8 Remediation)', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: any
  const executionCtx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  }

  const bizId = 'biz_fin_test'
  const branchA = 'br_fin_a'
  const branchB = 'br_fin_b'
  const ownerId = 'usr_fin_owner'
  const ownerToken = 'tok_fin_owner'

  beforeEach(async () => {
    sqlite = new DatabaseSync(':memory:')
    d1 = createSqliteD1(sqlite)

    // Execute migrations 0001 to 0020
    const migrationsDir = path.resolve(__dirname, '../worker/migrations')
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
      sqlite.exec(sql)
    }

    env = {
      DB: d1,
      APP_ENV: 'test',
      JWT_SECRET: 'test_secret_32_chars_long_for_auth!!',
    }

    // Seed business, branches, and owner user
    const enc = new TextEncoder()
    const hashBuf = await crypto.subtle.digest('SHA-256', enc.encode(ownerToken))
    const tokenHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('')

    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, currency, timezone, status)
      VALUES (?, 'FIN-CORP', 'Fin Corp', 'PKR', 'Asia/Karachi', 'active')
    `).run(bizId)

    sqlite.prepare(`
      INSERT INTO business_settings (business_id, allow_negative_stock, max_void_hours)
      VALUES (?, 1, 24)
    `).run(bizId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, name, branch_code, status)
      VALUES
        (?, ?, 'Main Branch', 'MAIN', 'active'),
        (?, ?, 'North Branch', 'NORTH', 'active')
    `).run(branchA, bizId, branchB, bizId)

    sqlite.prepare(`
      INSERT INTO users (id, email, password_hash, name, status)
      VALUES (?, 'owner@fin.com', 'pbkdf2:hash', 'Fin Owner', 'active')
    `).run(ownerId)

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('bm_fin_owner', ?, ?, 'owner', 1)
    `).run(bizId, ownerId)

    sqlite.prepare(`
      INSERT INTO sessions (id, user_id, token, token_hash, expires_at)
      VALUES ('sess_fin_owner', ?, ?, ?, datetime('now', '+1 day'))
    `).run(ownerId, ownerToken, tokenHash)
  })

  it('FIN-003: supports multi-tender split payment methods for supplier payments', async () => {
    // 1. Seed supplier
    const suppId = 'supp_split'
    sqlite.prepare(`
      INSERT INTO suppliers (id, business_id, name, supplier_code, status)
      VALUES (?, ?, 'Split Tenders Supplier', 'SUP-SPLIT', 'active')
    `).run(suppId, bizId)

    // 2. Post supplier payment with 2 split methods: cash (60,000) and bank_transfer (40,000)
    const req = new Request('http://localhost/api/v1/supplier-payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': bizId,
        'X-Branch-Id': branchA,
      },
      body: JSON.stringify({
        supplierId: suppId,
        amountMinor: 100000,
        paymentMethods: [
          { method: 'cash', amountMinor: 60000 },
          { method: 'bank_transfer', amountMinor: 40000, reference: 'TXN-SPLIT-99' },
        ],
        notes: 'Split payment test',
      }),
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(201)
    const json = (await res.json()) as { data: any }
    expect(json.data.amountMinor).toBe(100000)
    expect(json.data.paymentMethods).toHaveLength(2)
    expect(json.data.paymentMethods[0].method).toBe('cash')
    expect(json.data.paymentMethods[0].amountMinor).toBe(60000)
    expect(json.data.paymentMethods[1].method).toBe('bank_transfer')
    expect(json.data.paymentMethods[1].amountMinor).toBe(40000)

    // Verify stored in supplier_payment_methods table
    const stored = sqlite.prepare('SELECT * FROM supplier_payment_methods WHERE payment_id = ?').all(json.data.id) as any[]
    expect(stored).toHaveLength(2)
  })

  it('FIN-002: rejects duplicate invoice allocations in customer payments', async () => {
    // Seed customer
    const custId = 'cust_dup'
    sqlite.prepare(`
      INSERT INTO customers (id, business_id, name, customer_code, status)
      VALUES (?, ?, 'Dup Customer', 'CUST-DUP', 'active')
    `).run(custId, bizId)

    // Seed sale & invoice
    const saleId = 'sale_dup'
    const invId = 'inv_dup'
    sqlite.prepare(`
      INSERT INTO sales (
        id, business_id, branch_id, sale_number, receipt_number, invoice_number,
        customer_id, customer_snapshot_json, cashier_id, cashier_name,
        subtotal_minor, discount_minor, tax_minor, total_amount_minor,
        amount_paid_minor, remaining_balance_minor, status, business_date_key
      ) VALUES (?, ?, ?, 'S-DUP', 'R-DUP', 'INV-DUP', ?, '{}', ?, 'Owner', 100000, 0, 0, 100000, 0, 100000, 'completed', ?)
    `).run(saleId, bizId, branchA, custId, ownerId, getCurrentBusinessDateKey())

    sqlite.prepare(`
      INSERT INTO invoices (
        id, business_id, branch_id, sale_id, invoice_number, customer_id,
        business_date_key, total_amount_minor, paid_amount_minor, remaining_amount_minor,
        payment_status, status
      ) VALUES (?, ?, ?, ?, 'INV-DUP', ?, ?, 100000, 0, 100000, 'unpaid', 'active')
    `).run(invId, bizId, branchA, saleId, custId, getCurrentBusinessDateKey())

    // Attempt to post payment with DUPLICATE invoiceId allocations
    const req = new Request('http://localhost/api/v1/customer-payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': bizId,
        'X-Branch-Id': branchA,
      },
      body: JSON.stringify({
        customerId: custId,
        amountMinor: 50000,
        paymentMethods: [{ method: 'cash', amountMinor: 50000 }],
        allocations: [
          { invoiceId: invId, amountMinor: 25000 },
          { invoiceId: invId, amountMinor: 25000 },
        ],
      }),
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(400)
    const err = (await res.json()) as { error: { message: string } }
    expect(err.error.message).toMatch(/Duplicate allocation to invoice/i)
  })

  it('FIN-008: voiding sale marks payments as voided and updates unallocated amounts', async () => {
    const custId = 'cust_void'
    sqlite.prepare(`
      INSERT INTO customers (id, business_id, name, customer_code, status)
      VALUES (?, ?, 'Void Cust', 'CUST-V', 'active')
    `).run(custId, bizId)

    const saleId = 'sale_to_void'
    const invId = 'inv_to_void'
    sqlite.prepare(`
      INSERT INTO sales (
        id, business_id, branch_id, sale_number, receipt_number, invoice_number,
        customer_id, customer_snapshot_json, cashier_id, cashier_name,
        subtotal_minor, discount_minor, tax_minor, total_amount_minor,
        amount_paid_minor, remaining_balance_minor, status, business_date_key
      ) VALUES (?, ?, ?, 'S-VOID', 'R-VOID', 'INV-VOID', ?, '{}', ?, 'Owner', 50000, 0, 0, 50000, 50000, 0, 'completed', ?)
    `).run(saleId, bizId, branchA, custId, ownerId, getCurrentBusinessDateKey())

    sqlite.prepare(`
      INSERT INTO invoices (
        id, business_id, branch_id, sale_id, invoice_number, customer_id,
        business_date_key, total_amount_minor, paid_amount_minor, remaining_amount_minor,
        payment_status, status
      ) VALUES (?, ?, ?, ?, 'INV-VOID', ?, ?, 50000, 50000, 0, 'paid', 'active')
    `).run(invId, bizId, branchA, saleId, custId, getCurrentBusinessDateKey())

    const payId = 'pay_void_test'
    sqlite.prepare(`
      INSERT INTO payments (
        id, business_id, branch_id, receipt_number, customer_id, customer_snapshot_json,
        amount_minor, unallocated_amount_minor, status, business_date_key, received_by
      ) VALUES (?, ?, ?, 'R-VOID', ?, '{}', 50000, 0, 'posted', ?, ?)
    `).run(payId, bizId, branchA, custId, getCurrentBusinessDateKey(), ownerId)

    sqlite.prepare(`
      INSERT INTO payment_allocations (id, business_id, payment_id, sale_id, invoice_number, amount_minor)
      VALUES ('alloc_void', ?, ?, ?, 'INV-VOID', 50000)
    `).run(bizId, payId, saleId)

    // Call POST /sales/:id/void
    const req = new Request(`http://localhost/api/v1/sales/${saleId}/void`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': bizId,
        'X-Branch-Id': branchA,
      },
      body: JSON.stringify({ reason: 'Customer requested cancellation' }),
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(200)

    // Check payment status updated to 'voided'
    const pay = sqlite.prepare('SELECT status, reversal_reason, voided_by_sale_id FROM payments WHERE id = ?').get(payId) as any
    expect(pay.status).toBe('voided')
    expect(pay.reversal_reason).toBe('Customer requested cancellation')
    expect(pay.voided_by_sale_id).toBe(saleId)

    // Check invoice remaining_amount_minor is 0 and status is voided
    const inv = sqlite.prepare('SELECT status, remaining_amount_minor FROM invoices WHERE id = ?').get(invId) as any
    expect(inv.status).toBe('voided')
    expect(inv.remaining_amount_minor).toBe(0)
  })

  it('INV-004: goods receipt calculates branch-isolated moving weighted average cost', async () => {
    // 1. Seed product
    const prodId = 'prod_cost_iso'
    sqlite.prepare(`
      INSERT INTO products (id, business_id, name, sku, unit, purchase_price_minor, selling_price_minor, status, track_inventory)
      VALUES (?, ?, 'Cost Isolated Item', 'SKU-COST', 'piece', 10000, 20000, 'active', 1)
    `).run(prodId, bizId)

    // Seed inventory on Branch A: 10 units @ 10,000 minor = 100,000 minor
    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand, average_cost_minor)
      VALUES ('ib_a', ?, ?, ?, 10.0, 10000)
    `).run(bizId, branchA, prodId)

    // Seed inventory on Branch B: 5 units @ 8,000 minor = 40,000 minor
    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand, average_cost_minor)
      VALUES ('ib_b', ?, ?, ?, 5.0, 8000)
    `).run(bizId, branchB, prodId)

    // 2. Seed supplier and PO on Branch A: 10 units @ 14,000 minor
    const suppId = 'supp_cost'
    sqlite.prepare(`
      INSERT INTO suppliers (id, business_id, name, supplier_code, status)
      VALUES (?, ?, 'Cost Supplier', 'SUP-COST', 'active')
    `).run(suppId, bizId)

    const poId = 'po_cost'
    const poItemId = 'poi_cost'
    sqlite.prepare(`
      INSERT INTO purchases (
        id, business_id, branch_id, purchase_number, supplier_id, supplier_snapshot_json,
        subtotal_minor, discount_minor, tax_minor, total_amount_minor, paid_amount_minor,
        status, purchase_date_key, created_by
      ) VALUES (?, ?, ?, 'PO-COST', ?, '{}', 140000, 0, 0, 140000, 0, 'ordered', ?, ?)
    `).run(poId, bizId, branchA, suppId, getCurrentBusinessDateKey(), ownerId)

    sqlite.prepare(`
      INSERT INTO purchase_items (
        id, purchase_id, product_id, sku, product_name, unit, ordered_quantity, received_quantity,
        unit_cost_minor, discount_minor, line_total_minor
      ) VALUES (?, ?, ?, 'SKU-COST', 'Cost Isolated Item', 'piece', 10.0, 0.0, 14000, 0, 140000)
    `).run(poItemId, poId, prodId)

    // 3. Receive 10 units on Branch A
    const req = new Request(`http://localhost/api/v1/purchases/${poId}/receipts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `__session=${ownerToken}`,
        'X-Business-Id': bizId,
        'X-Branch-Id': branchA,
      },
      body: JSON.stringify({
        items: [{ purchaseItemId: poItemId, productId: prodId, quantityReceived: 10.0 }],
      }),
    })

    const res = await worker.fetch(req, env, executionCtx)
    expect(res.status).toBe(201)

    // Branch A new cost calculation:
    // (10 units * 10,000) + (10 units * 14,000) = 100,000 + 140,000 = 240,000
    // Total units = 20 -> New MWA cost = 240,000 / 20 = 12,000 minor!
    const balA = sqlite.prepare('SELECT quantity_on_hand, average_cost_minor FROM inventory_balances WHERE id = ?').get('ib_a') as any
    expect(balA.quantity_on_hand).toBe(20.0)
    expect(balA.average_cost_minor).toBe(12000)

    // Verify Branch B is COMPLETELY ISOLATED (still 5 units @ 8,000 minor)
    const balB = sqlite.prepare('SELECT quantity_on_hand, average_cost_minor FROM inventory_balances WHERE id = ?').get('ib_b') as any
    expect(balB.quantity_on_hand).toBe(5.0)
    expect(balB.average_cost_minor).toBe(8000)

    // Verify catalog purchase_price_minor is NOT mutated
    const prod = sqlite.prepare('SELECT purchase_price_minor FROM products WHERE id = ?').get(prodId) as any
    expect(prod.purchase_price_minor).toBe(10000)
  })
})
