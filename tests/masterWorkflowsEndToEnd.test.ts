import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import worker from '../worker/src/index'
import { getCurrentBusinessDateKey } from '../worker/src/lib/businessDate'
import { signAuthorizationPayload } from '../worker/src/features/offline/offlineCrypto'

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

class MemoryR2Bucket {
  private store = new Map<string, { body: Uint8Array; httpMetadata?: Record<string, string>; customMetadata?: Record<string, string>; etag: string }>()

  async put(key: string, value: any, options?: any): Promise<R2Object> {
    let bytes: Uint8Array
    if (value instanceof Uint8Array) {
      bytes = value
    } else if (value instanceof ArrayBuffer) {
      bytes = new Uint8Array(value)
    } else if (typeof value === 'string') {
      bytes = new TextEncoder().encode(value)
    } else {
      bytes = new Uint8Array(0)
    }
    const etag = `etag_${Math.random().toString(36).slice(2)}`
    this.store.set(key, {
      body: bytes,
      httpMetadata: options?.httpMetadata,
      customMetadata: options?.customMetadata,
      etag,
    })
    return {
      key,
      version: '1',
      size: bytes.byteLength,
      etag,
      httpEtag: `"${etag}"`,
      uploaded: new Date(),
      httpMetadata: options?.httpMetadata || {},
      customMetadata: options?.customMetadata || {},
    } as unknown as R2Object
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const item = this.store.get(key)
    if (!item) return null
    return {
      key,
      version: '1',
      size: item.body.byteLength,
      etag: item.etag,
      httpEtag: `"${item.etag}"`,
      uploaded: new Date(),
      httpMetadata: item.httpMetadata || {},
      customMetadata: item.customMetadata || {},
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(item.body)
          controller.close()
        },
      }),
      arrayBuffer: async () => item.body.buffer,
    } as unknown as R2ObjectBody
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }
}

describe('Master End-to-End Business Workflows Verification Suite (Part 6)', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: any
  const executionCtx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  }

  const bizId = 'biz_e2e_master'
  const branchMain = 'br_e2e_main'
  const branchSecond = 'br_e2e_second'
  const ownerId = 'usr_e2e_owner'
  const ownerToken = 'tok_e2e_owner'
  const cashierId = 'usr_e2e_cashier'
  const cashierToken = 'tok_e2e_cashier'
  const foreignBizId = 'biz_e2e_foreign'
  const foreignUserId = 'usr_e2e_foreign'
  const foreignToken = 'tok_e2e_foreign'

  const authSecret = 'master-e2e-auth-secret-32-chars-long'

  async function sha256Hex(str: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  async function jsonBody<T = any>(res: Response): Promise<T> {
    const json = (await res.json()) as any
    return json?.data !== undefined ? json.data : json
  }

  beforeEach(async () => {
    sqlite = new DatabaseSync(':memory:')
    d1 = createSqliteD1(sqlite)

    // Execute all 21 migrations cleanly
    const migrationsDir = path.resolve(__dirname, '../worker/migrations')
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
      sqlite.exec(sql)
    }

    env = {
      DB: d1,
      FILES: new MemoryR2Bucket(),
      AUTH_SECRET: authSecret,
      OFFLINE_SIGNING_SECRET: authSecret,
      ENVIRONMENT: 'test',
      TIMEZONE: 'Asia/Karachi',
      SERVICE_NAME: 'pos-system-api',
      API_VERSION: 'v1',
    }

    const ownerHash = await sha256Hex(ownerToken)
    const cashierHash = await sha256Hex(cashierToken)
    const foreignHash = await sha256Hex(foreignToken)

    // Seed master business, branches, and users
    sqlite.exec(`
      INSERT INTO businesses (id, business_code, name, status, currency, timezone, created_at, updated_at)
      VALUES ('${bizId}', 'BIZ001', 'Northstar Retail E2E', 'active', 'PKR', 'Asia/Karachi', datetime('now'), datetime('now'));

      INSERT INTO businesses (id, business_code, name, status, currency, timezone, created_at, updated_at)
      VALUES ('${foreignBizId}', 'BIZ002', 'Foreign Competitor Ltd', 'active', 'PKR', 'Asia/Karachi', datetime('now'), datetime('now'));

      INSERT INTO branches (id, business_id, name, branch_code, status, is_main_branch, created_at, updated_at)
      VALUES
        ('${branchMain}', '${bizId}', 'Main Flagship', 'MAIN', 'active', 1, datetime('now'), datetime('now')),
        ('${branchSecond}', '${bizId}', 'Second Branch', 'SEC', 'active', 0, datetime('now'), datetime('now')),
        ('br_foreign', '${foreignBizId}', 'Foreign Branch', 'FB01', 'active', 1, datetime('now'), datetime('now'));

      INSERT INTO business_settings (business_id, receipt_header, default_tax_rate, allow_negative_stock, max_void_hours, updated_at)
      VALUES
        ('${bizId}', 'Northstar E2E Receipt', 10.0, 0, 24, datetime('now')),
        ('${foreignBizId}', 'Foreign Receipt', 5.0, 0, 24, datetime('now'));

      INSERT INTO users (id, email, password_hash, name, status, created_at, updated_at)
      VALUES
        ('${ownerId}', 'owner@e2e.test', 'hash', 'Owner Master', 'active', datetime('now'), datetime('now')),
        ('${cashierId}', 'cashier@e2e.test', 'hash', 'Cashier User', 'active', datetime('now'), datetime('now')),
        ('${foreignUserId}', 'foreign@e2e.test', 'hash', 'Foreign User', 'active', datetime('now'), datetime('now'));

      INSERT INTO business_members (id, business_id, user_id, role, is_active, created_at, updated_at)
      VALUES
        ('bm_owner', '${bizId}', '${ownerId}', 'owner', 1, datetime('now'), datetime('now')),
        ('bm_cashier', '${bizId}', '${cashierId}', 'cashier', 1, datetime('now'), datetime('now')),
        ('bm_foreign', '${foreignBizId}', '${foreignUserId}', 'owner', 1, datetime('now'), datetime('now'));

      INSERT INTO member_branches (id, member_id, branch_id, created_at)
      VALUES
        ('mb_c1', 'bm_cashier', '${branchMain}', datetime('now'));

      INSERT INTO sessions (id, user_id, token, token_hash, expires_at, created_at)
      VALUES
        ('sess_owner', '${ownerId}', 'masked_owner', '${ownerHash}', datetime('now', '+1 day'), datetime('now')),
        ('sess_cashier', '${cashierId}', 'masked_cashier', '${cashierHash}', datetime('now', '+1 day'), datetime('now')),
        ('sess_foreign', '${foreignUserId}', 'masked_foreign', '${foreignHash}', datetime('now', '+1 day'), datetime('now'));
    `)
  })

  function apiReq(
    method: string,
    pathUrl: string,
    body?: any,
    token = ownerToken,
    business = bizId,
    branch: string | null = branchMain,
    extraHeaders?: Record<string, string>
  ) {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'X-Business-Id': business,
    }
    if (branch) {
      headers['X-Branch-Id'] = branch
    }
    if (body) {
      headers['Content-Type'] = 'application/json'
    }
    if (extraHeaders) {
      Object.assign(headers, extraHeaders)
    }
    return new Request(`https://api.northstar.pos${pathUrl}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  it('WORKFLOW 1: Standard POS Cash Sale → Stock Deduction → Invoice Verification', async () => {
    // 1. Create a product with track_inventory = 1 and initial stock of 20
    const prodRes = await worker.fetch(
      apiReq('POST', '/api/v1/products', {
        name: 'Master Widget',
        sku: 'WGT-001',
        unit: 'piece',
        sellingPriceMinor: 10000, // PKR 100.00
        purchasePriceMinor: 6000,  // PKR 60.00
        trackInventory: true,
      }),
      env,
      executionCtx
    )
    expect(prodRes.status).toBe(201)
    const prod = await jsonBody(prodRes)

    // Initial stock balance = 20
    sqlite.exec(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand, average_cost_minor, updated_at)
      VALUES ('bal_w1', '${bizId}', '${branchMain}', '${prod.id}', 20.0, 6000, datetime('now'));
    `)

    // 2. Cashier rings up 3 units at POS
    const saleRes = await worker.fetch(
      apiReq('POST', '/api/v1/sales', {
        customerId: 'walk-in',
        items: [
          {
            productId: prod.id,
            quantity: 3,
            unitPriceMinor: 10000,
            discountMinor: 0,
            taxMinor: 3000, // 10% tax on 30,000 = 3,000
          },
        ],
        payments: [
          {
            method: 'cash',
            amountMinor: 33000,
          },
        ],
      }, cashierToken, bizId, branchMain),
      env,
      executionCtx
    )
    expect(saleRes.status).toBe(201)
    const saleData = await jsonBody(saleRes)
    expect(saleData.totalAmountMinor).toBe(33000)
    expect(saleData.status).toBe('completed')

    // 3. Verify stock deduction (20 - 3 = 17)
    const balRow = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE product_id = ? AND branch_id = ?').get(prod.id, branchMain) as any
    expect(balRow.quantity_on_hand).toBe(17.0)

    // 4. Verify Invoice totals and paid status
    const invRow = sqlite.prepare('SELECT * FROM invoices WHERE sale_id = ?').get(saleData.id) as any
    expect(invRow.total_amount_minor).toBe(33000)
    expect(invRow.paid_amount_minor).toBe(33000)
    expect(invRow.remaining_amount_minor).toBe(0)
    expect(invRow.payment_status).toBe('paid')
  })

  it('WORKFLOW 2: Credit Sale → Customer Receivable → Partial Payment & Allocation', async () => {
    // 1. Create a credit customer
    const custRes = await worker.fetch(
      apiReq('POST', '/api/v1/customers', {
        name: 'VIP Corporate Client',
        type: 'business',
        creditLimitMinor: 500000,
        openingBalanceMinor: 0,
      }),
      env,
      executionCtx
    )
    expect(custRes.status).toBe(201)
    const cust = await jsonBody(custRes)

    // 2. Create product
    const prodRes = await worker.fetch(
      apiReq('POST', '/api/v1/products', {
        name: 'Bulk Goods',
        sku: 'BLK-002',
        unit: 'piece',
        sellingPriceMinor: 50000, // PKR 500.00
        purchasePriceMinor: 30000,
        trackInventory: false,
      }),
      env,
      executionCtx
    )
    expect(prodRes.status).toBe(201)
    const prod = await jsonBody(prodRes)

    // 3. Credit sale of 2 units (PKR 100,000 + 10,000 tax = 110,000)
    const saleRes = await worker.fetch(
      apiReq('POST', '/api/v1/sales', {
        customerId: cust.id,
        items: [
          {
            productId: prod.id,
            quantity: 2,
            unitPriceMinor: 50000,
            discountMinor: 0,
            taxMinor: 10000,
          },
        ],
        payments: [
          {
            method: 'credit',
            amountMinor: 110000,
          },
        ],
      }, ownerToken, bizId, branchMain),
      env,
      executionCtx
    )
    expect(saleRes.status).toBe(201)
    const sale = await jsonBody(saleRes)

    // Customer ledger should have debit of 110,000 with balance 110,000
    const ledgerStmtRes = await worker.fetch(
      apiReq('GET', `/api/v1/customers/${cust.id}/ledger`),
      env,
      executionCtx
    )
    expect(ledgerStmtRes.status).toBe(200)
    const ledgerData = await jsonBody(ledgerStmtRes)
    expect(ledgerData.closingBalanceMinor).toBe(110000)
    expect(ledgerData.totalDebitsMinor).toBe(110000)

    // Invoice status should be unpaid
    const inv = sqlite.prepare('SELECT * FROM invoices WHERE sale_id = ?').get(sale.id) as any
    expect(inv.payment_status).toBe('unpaid')
    expect(inv.remaining_amount_minor).toBe(110000)

    // 4. Receive partial payment of PKR 60,000 allocated to this invoice
    const payRes = await worker.fetch(
      apiReq('POST', '/api/v1/customer-payments', {
        customerId: cust.id,
        branchId: branchMain,
        amountMinor: 60000,
        paymentMethods: [{ method: 'bank_transfer', amountMinor: 60000 }],
        allocations: [{ invoiceId: inv.id, amountMinor: 60000 }],
      }, ownerToken, bizId, branchMain),
      env,
      executionCtx
    )
    expect(payRes.status).toBe(201)

    // Verify invoice remaining balance is 50,000 and status is partial
    const updatedInv = sqlite.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id) as any
    expect(updatedInv.paid_amount_minor).toBe(60000)
    expect(updatedInv.remaining_amount_minor).toBe(50000)
    expect(updatedInv.payment_status).toBe('partial')

    // Customer balance is now 50,000
    const updatedLedger = sqlite.prepare('SELECT balance_minor FROM customer_ledger_transactions WHERE customer_id = ? ORDER BY rowid DESC LIMIT 1').get(cust.id) as any
    expect(updatedLedger.balance_minor).toBe(50000)
  })

  it('WORKFLOW 3: Purchase Order → Physical Goods Receipt (GRN) → MWA Costing & Payables', async () => {
    // 1. Create Supplier
    const supRes = await worker.fetch(
      apiReq('POST', '/api/v1/suppliers', {
        name: 'Apex Wholesale Hub',
        contactPerson: 'Zubair Ahmed',
        phone: '03001234567',
      }),
      env,
      executionCtx
    )
    expect(supRes.status).toBe(201)
    const sup = await jsonBody(supRes)

    // 2. Create Product with initial purchase price 4000
    const prodRes = await worker.fetch(
      apiReq('POST', '/api/v1/products', {
        name: 'MWA Sample Product',
        sku: 'MWA-003',
        unit: 'piece',
        sellingPriceMinor: 8000,
        purchasePriceMinor: 4000,
        trackInventory: true,
      }),
      env,
      executionCtx
    )
    expect(prodRes.status).toBe(201)
    const prod = await jsonBody(prodRes)

    // Establish existing branch inventory: 10 units @ 4,000 minor = 40,000
    sqlite.exec(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand, average_cost_minor, updated_at)
      VALUES ('bal_mwa', '${bizId}', '${branchMain}', '${prod.id}', 10.0, 4000, datetime('now'));
    `)

    // 3. Create PO for 10 units @ 6,000 minor = 60,000
    const poRes = await worker.fetch(
      apiReq('POST', '/api/v1/purchases', {
        supplierId: sup.id,
        branchId: branchMain,
        items: [
          {
            productId: prod.id,
            orderedQuantity: 10,
            unitCostMinor: 6000,
          },
        ],
      }, ownerToken, bizId, branchMain),
      env,
      executionCtx
    )
    expect(poRes.status).toBe(201)
    const po = await jsonBody(poRes)

    // Draft PO must NOT update payables yet (FIN-006)
    const payablesBefore = await worker.fetch(
      apiReq('GET', '/api/v1/reports/suppliers/payables'),
      env,
      executionCtx
    )
    const payDataBefore = await jsonBody(payablesBefore)
    const supPayableBefore = Array.isArray(payDataBefore)
      ? payDataBefore.find((i: any) => i.supplierId === sup.id)
      : payDataBefore.items?.find((i: any) => i.supplierId === sup.id)
    expect(supPayableBefore?.balanceMinor || 0).toBe(0)

    // Confirm PO to transition status from 'draft' to 'ordered'
    const confirmPoRes = await worker.fetch(
      apiReq('POST', `/api/v1/purchases/${po.id}/confirm`, {}, ownerToken, bizId, branchMain),
      env,
      executionCtx
    )
    expect(confirmPoRes.status).toBe(200)

    // 4. Physically receive all 10 units via Goods Receipt (GRN)
    const grnRes = await worker.fetch(
      apiReq('POST', `/api/v1/purchases/${po.id}/receipts`, {
        notes: 'GRN-E2E-001',
        items: [
          {
            purchaseItemId: po.items[0].id,
            quantityReceived: 10,
          },
        ],
      }, ownerToken, bizId, branchMain),
      env,
      executionCtx
    )
    expect(grnRes.status).toBe(201)

    // Stock should now be 10 + 10 = 20 units
    const balRow = sqlite.prepare('SELECT quantity_on_hand, average_cost_minor FROM inventory_balances WHERE product_id = ? AND branch_id = ?').get(prod.id, branchMain) as any
    expect(balRow.quantity_on_hand).toBe(20.0)

    // MWA Cost Formula: ((10 * 4000) + (10 * 6000)) / (10 + 10) = 100,000 / 20 = 5,000 minor
    expect(balRow.average_cost_minor).toBe(5000)

    // Supplier payables should now recognize 60,000
    const payablesAfter = await worker.fetch(
      apiReq('GET', '/api/v1/reports/suppliers/payables'),
      env,
      executionCtx
    )
    const payDataAfter = await jsonBody(payablesAfter)
    const supPayableAfter = Array.isArray(payDataAfter)
      ? payDataAfter.find((i: any) => i.supplierId === sup.id)
      : payDataAfter.items?.find((i: any) => i.supplierId === sup.id)
    expect(supPayableAfter?.balanceMinor).toBe(60000)
  })

  it('WORKFLOW 4: Supplier Multi-Tender Disbursement & Ledger Balance Reduction', async () => {
    // 1. Create Supplier and Purchase of 100,000
    const supId = 'sup_e2e_w4'
    const poId = 'po_e2e_w4'
    sqlite.exec(`
      INSERT INTO suppliers (id, business_id, supplier_code, name, status, created_at, updated_at)
      VALUES ('${supId}', '${bizId}', 'SUP-W4', 'Prime Supplies', 'active', datetime('now'), datetime('now'));

      INSERT INTO purchases (id, business_id, branch_id, supplier_id, supplier_snapshot_json, purchase_number, status, subtotal_minor, total_amount_minor, paid_amount_minor, purchase_date_key, created_by, created_at, updated_at)
      VALUES ('${poId}', '${bizId}', '${branchMain}', '${supId}', '{}', 'PO-100K', 'received', 100000, 100000, 0, '${getCurrentBusinessDateKey()}', '${ownerId}', datetime('now'), datetime('now'));

      INSERT INTO supplier_ledger_transactions (id, business_id, branch_id, supplier_id, type, reference_id, reference_number, description, debit_minor, credit_minor, balance_minor, business_date_key, created_at)
      VALUES ('slt_1', '${bizId}', '${branchMain}', '${supId}', 'bill', '${poId}', 'PO-100K', 'Goods Receipt', 0, 100000, 100000, '${getCurrentBusinessDateKey()}', datetime('now'));
    `)

    // 2. Pay 100,000 using split tenders: PKR 40,000 Cash + PKR 60,000 Bank Transfer (FIN-003)
    const payRes = await worker.fetch(
      apiReq('POST', '/api/v1/supplier-payments', {
        supplierId: supId,
        branchId: branchMain,
        amountMinor: 100000,
        paymentMethods: [
          { method: 'cash', amountMinor: 40000 },
          { method: 'bank_transfer', amountMinor: 60000, reference: 'HBL-99281' },
        ],
        allocations: [
          { purchaseId: poId, amountMinor: 100000 },
        ],
      }, ownerToken, bizId, branchMain),
      env,
      executionCtx
    )
    expect(payRes.status).toBe(201)
    const payData = await jsonBody(payRes)
    expect(payData.paymentMethods).toHaveLength(2)

    // Verify split tender rows exist in supplier_payment_methods
    const methodRows = sqlite.prepare('SELECT method, amount_minor FROM supplier_payment_methods WHERE payment_id = ?').all(payData.id) as any[]
    expect(methodRows).toHaveLength(2)

    // Supplier balance should now be 0
    const lastSlt = sqlite.prepare('SELECT balance_minor FROM supplier_ledger_transactions WHERE supplier_id = ? ORDER BY rowid DESC LIMIT 1').get(supId) as any
    expect(lastSlt.balance_minor).toBe(0)
  })

  it('WORKFLOW 5: Expense Creation & Inclusion in Net Profit Reporting', async () => {
    // 1. Create Expense Category
    const catRes = await worker.fetch(
      apiReq('POST', '/api/v1/expense-categories', {
        name: 'Store Utilities',
        description: 'Electricity, Water, Generator Fuel',
      }, ownerToken, bizId, branchMain),
      env,
      executionCtx
    )
    expect(catRes.status).toBe(201)
    const cat = await jsonBody(catRes)

    // 2. Post an Expense of PKR 25,000 (2500000 minor)
    const expRes = await worker.fetch(
      apiReq('POST', '/api/v1/expenses', {
        branchId: branchMain,
        categoryId: cat.id,
        amountMinor: 2500000,
        paymentMethod: 'cash',
        title: 'October Electricity Bill',
      }, ownerToken, bizId, branchMain),
      env,
      executionCtx
    )
    expect(expRes.status).toBe(201)

    // 3. Verify Dashboard includes posted expense (FIN-005)
    const dashRes = await worker.fetch(
      apiReq('GET', '/api/v1/reports/dashboard', null, ownerToken, bizId, branchMain),
      env,
      executionCtx
    )
    expect(dashRes.status).toBe(200)
    const dash = await jsonBody(dashRes)
    expect(dash.financial.expenses.isAvailable).toBe(true)
    expect(dash.financial.expenses.data.totalExpensesMinor).toBeGreaterThanOrEqual(2500000)
  })

  it('WORKFLOW 6: Physical Stock Count → Variance Reconciliation → Inventory Update', async () => {
    // 1. Create tracked product with 50 recorded units
    const prodRes = await worker.fetch(
      apiReq('POST', '/api/v1/products', {
        name: 'Stock Count Item',
        sku: 'SCI-006',
        unit: 'piece',
        sellingPriceMinor: 2000,
        purchasePriceMinor: 1000,
        trackInventory: true,
      }),
      env,
      executionCtx
    )
    expect(prodRes.status).toBe(201)
    const prod = await jsonBody(prodRes)

    sqlite.exec(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand, average_cost_minor, updated_at)
      VALUES ('bal_sci', '${bizId}', '${branchMain}', '${prod.id}', 50.0, 1000, datetime('now'));
    `)

    // 2. Create stock count draft
    const countDraftRes = await worker.fetch(
      apiReq('POST', '/api/v1/inventory/counts', {
        branchId: branchMain,
        name: 'Monthly physical audit',
        items: [
          {
            productId: prod.id,
            physicalQuantity: 45,
          },
        ],
      }, ownerToken, bizId, branchMain),
      env,
      executionCtx
    )
    expect(countDraftRes.status).toBe(201)
    const countDraft = await jsonBody(countDraftRes)

    // 3. Confirm count (variance = -5)
    const confirmRes = await worker.fetch(
      apiReq('POST', `/api/v1/inventory/counts/${countDraft.id}/confirm`, {}, ownerToken, bizId, branchMain),
      env,
      executionCtx
    )
    expect(confirmRes.status).toBe(200)

    // 4. Verify balance is updated to 45
    const balRow = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE product_id = ? AND branch_id = ?').get(prod.id, branchMain) as any
    expect(balRow.quantity_on_hand).toBe(45.0)

    // 5. Verify movement journal recorded
    const movRow = sqlite.prepare('SELECT type, quantity_change FROM stock_movements WHERE product_id = ? AND branch_id = ? ORDER BY id DESC LIMIT 1').get(prod.id, branchMain) as any
    expect(movRow.quantity_change).toBe(-5.0)
  })

  it('WORKFLOW 7: Two-Branch Isolation & Branch Switch Scoping', async () => {
    // Create product
    const prodRes = await worker.fetch(
      apiReq('POST', '/api/v1/products', {
        name: 'Branch Shared Catalog Item',
        sku: 'BSC-007',
        unit: 'piece',
        sellingPriceMinor: 5000,
        purchasePriceMinor: 2500,
        trackInventory: true,
      }),
      env,
      executionCtx
    )
    expect(prodRes.status).toBe(201)
    const prod = await jsonBody(prodRes)

    // Set Branch 1 stock = 100, Branch 2 stock = 25
    sqlite.exec(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand, average_cost_minor, updated_at)
      VALUES
        ('bal_b1', '${bizId}', '${branchMain}', '${prod.id}', 100.0, 2500, datetime('now')),
        ('bal_b2', '${bizId}', '${branchSecond}', '${prod.id}', 25.0, 2500, datetime('now'));
    `)

    // Query Branch 1 inventory
    const resB1 = await worker.fetch(
      apiReq('GET', `/api/v1/inventory/balances/${prod.id}`, null, ownerToken, bizId, branchMain),
      env,
      executionCtx
    )
    expect(resB1.status).toBe(200)
    const dataB1 = await jsonBody(resB1)
    expect(dataB1[0].quantityOnHand).toBe(100.0)

    // Query Branch 2 inventory
    const resB2 = await worker.fetch(
      apiReq('GET', `/api/v1/inventory/balances/${prod.id}`, null, ownerToken, bizId, branchSecond),
      env,
      executionCtx
    )
    expect(resB2.status).toBe(200)
    const dataB2 = await jsonBody(resB2)
    expect(dataB2[0].quantityOnHand).toBe(25.0)
  })

  it('WORKFLOW 8: Disconnect Terminal → Offline Sale Commit → Reconnect Idempotency', async () => {
    // 1. Create product and establish stock
    const prodRes = await worker.fetch(
      apiReq('POST', '/api/v1/products', {
        name: 'Offline Candy',
        sku: 'OFF-008',
        unit: 'piece',
        sellingPriceMinor: 500,
        purchasePriceMinor: 300,
        trackInventory: true,
      }),
      env,
      executionCtx
    )
    expect(prodRes.status).toBe(201)
    const prod = await jsonBody(prodRes)

    sqlite.exec(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand, average_cost_minor, updated_at)
      VALUES ('bal_off', '${bizId}', '${branchMain}', '${prod.id}', 50.0, 300, datetime('now'));

      INSERT INTO devices (id, business_id, user_id, label, status, installation_id, created_at, updated_at)
      VALUES ('dev_e2e', '${bizId}', '${ownerId}', 'Terminal 1', 'active', 'inst_e2e_01', datetime('now'), datetime('now'));
    `)

    // 2. Generate authorization grant with HMAC
    const authId = 'auth_e2e_001'
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
    const signature = await signAuthorizationPayload(authSecret, {
      authorizationId: authId,
      businessId: bizId,
      branchId: branchMain,
      userId: ownerId,
      deviceId: 'dev_e2e',
      expiresAt,
      productIds: [prod.id],
    })

    sqlite.exec(`
      INSERT INTO offline_authorizations (
        id, business_id, branch_id, user_id, device_id, catalog_version, pricing_version,
        max_transactions, max_total_amount_minor, allow_discounts, status, issued_at, expires_at, signature
      ) VALUES (
        '${authId}', '${bizId}', '${branchMain}', '${ownerId}', 'dev_e2e', 1, 1,
        100, 1000000, 1, 'active', datetime('now'), '${expiresAt}', '${signature}'
      );

      INSERT INTO device_stock_allocations (
        id, authorization_id, business_id, branch_id, device_id, user_id, product_id,
        allocated_quantity, consumed_quantity, status, allocated_at, created_at, updated_at
      ) VALUES (
        'dsa_001', '${authId}', '${bizId}', '${branchMain}', 'dev_e2e', '${ownerId}', '${prod.id}',
        50.0, 0, 'active', datetime('now'), datetime('now'), datetime('now')
      );
    `)

    // 3. Commit offline sale (2 units @ 500 minor = 1000 minor)
    const offlinePayload = {
      authorizationId: authId,
      deviceId: 'dev_e2e',
      provisionalSaleId: 'sale_off_e2e_001',
      provisionalReceiptNumber: 'OFF-RCPT-001',
      offlineCreatedAt: new Date().toISOString(),
      items: [
        {
          productId: prod.id,
          allocationId: 'dsa_001',
          quantity: 2,
          unitPriceMinor: 500,
          discountMinor: 0,
          taxMinor: 0,
          lineTotalMinor: 1000,
        },
      ],
      cashTenderedMinor: 1000,
    }

    const commitRes1 = await worker.fetch(
      apiReq('POST', '/api/v1/offline/sales/commit', offlinePayload, ownerToken, bizId, branchMain, {
        'Idempotency-Key': 'idem_offline_sale_001',
      }),
      env,
      executionCtx
    )
    expect([200, 201]).toContain(commitRes1.status)
    const commitData1 = await jsonBody(commitRes1)
    expect(commitData1.provisionalSaleId).toBe('sale_off_e2e_001')

    // Stock deducted from 50 to 48
    const balRow1 = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE product_id = ? AND branch_id = ?').get(prod.id, branchMain) as any
    expect(balRow1.quantity_on_hand).toBe(48.0)

    // 4. Duplicate sync attempt (e.g. timeout retry with same payload)
    const commitRes2 = await worker.fetch(
      apiReq('POST', '/api/v1/offline/sales/commit', offlinePayload, ownerToken, bizId, branchMain, {
        'Idempotency-Key': 'idem_offline_sale_001',
      }),
      env,
      executionCtx
    )
    expect([200, 201]).toContain(commitRes2.status)
    const commitData2 = await jsonBody(commitRes2)
    expect(commitData2.provisionalSaleId).toBe('sale_off_e2e_001')

    // Stock must NOT be deducted again (still 48.0)
    const balRow2 = sqlite.prepare('SELECT quantity_on_hand FROM inventory_balances WHERE product_id = ? AND branch_id = ?').get(prod.id, branchMain) as any
    expect(balRow2.quantity_on_hand).toBe(48.0)
  })

  it('WORKFLOW 9: Security & Tenant Isolation Rejection', async () => {
    // 1. User from foreign business attempts to access master business products
    const crossRes = await worker.fetch(
      apiReq('GET', '/api/v1/products', null, foreignToken, bizId, null),
      env,
      executionCtx
    )
    expect([403, 404]).toContain(crossRes.status)

    // 2. Cashier attempts managerial price override without permission
    const prodRes = await worker.fetch(
      apiReq('POST', '/api/v1/products', {
        name: 'Protected Price Item',
        sku: 'PPI-009',
        unit: 'piece',
        sellingPriceMinor: 10000,
        purchasePriceMinor: 5000,
        trackInventory: false,
      }),
      env,
      executionCtx
    )
    expect(prodRes.status).toBe(201)
    const prod = await jsonBody(prodRes)

    const cashierTamperRes = await worker.fetch(
      apiReq('POST', '/api/v1/sales', {
        customerId: 'walk-in',
        items: [
          {
            productId: prod.id,
            quantity: 1,
            unitPriceMinor: 100, // Tampered down from 10000
            discountMinor: 0,
            taxMinor: 10,
          },
        ],
        payments: [{ method: 'cash', amountMinor: 110 }],
      }, cashierToken, bizId, branchMain),
      env,
      executionCtx
    )
    expect(cashierTamperRes.status).toBe(403)
  })

  it('WORKFLOW 10: Financial Reporting Date Range & Source Reconciliation', async () => {
    const today = getCurrentBusinessDateKey()
    const summaryRes = await worker.fetch(
      apiReq('GET', `/api/v1/reports/sales/summary?fromDate=${today}&toDate=${today}`, null, ownerToken, bizId, branchMain),
      env,
      executionCtx
    )
    expect(summaryRes.status).toBe(200)
    const summary = await jsonBody(summaryRes)

    // Reconcile against actual completed sales in SQLite
    const actualSales = sqlite.prepare(`
      SELECT
        COUNT(*) as total_orders,
        COALESCE(SUM(total_amount_minor), 0) as total_gross,
        COALESCE(SUM(discount_minor), 0) as total_disc,
        COALESCE(SUM(tax_minor), 0) as total_tax
      FROM sales
      WHERE business_id = ? AND status = 'completed' AND business_date_key = ?
    `).get(bizId, today) as any

    expect(summary.completedSalesCount).toBe(actualSales.total_orders)
    expect(summary.totalAmountMinor).toBe(actualSales.total_gross)
    expect(summary.taxTotalMinor).toBe(actualSales.total_tax)
  })
})
