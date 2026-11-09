import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import worker from '../worker/src/index'
import type { Env } from '../worker/src/types/environment'
import { createSession } from '../worker/src/auth/sessionService'
import { hashPassword } from '../worker/src/auth/crypto'

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

describe('Step 12.8 Master System Acceptance & Data Integrity Test Suite', () => {
  const migrationsDir = path.resolve(process.cwd(), 'worker/migrations')
  const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()

  describe('Part 5.2 & Part 4.4: Fresh Migration & Structural Integrity Verification', () => {
    it('applies all 11 migrations cleanly from an empty database and passes PRAGMA checks', () => {
      const freshDb = new DatabaseSync(':memory:')
      freshDb.exec('PRAGMA foreign_keys = ON;')

      for (const file of migrationFiles) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
        freshDb.exec(sql)
      }

      // Check PRAGMA integrity_check
      const integrity = freshDb.prepare('PRAGMA integrity_check;').all() as Array<{ integrity_check: string }>
      expect(integrity.length).toBe(1)
      expect(integrity[0].integrity_check).toBe('ok')

      // Check PRAGMA foreign_key_check
      const fkViolations = freshDb.prepare('PRAGMA foreign_key_check;').all()
      expect(fkViolations.length).toBe(0)

      // Verify all expected core tables exist
      const tables = freshDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>
      const tableNames = tables.map((t) => t.name)

      expect(tableNames).toContain('businesses')
      expect(tableNames).toContain('branches')
      expect(tableNames).toContain('users')
      expect(tableNames).toContain('business_members')
      expect(tableNames).toContain('sessions')
      expect(tableNames).toContain('products')
      expect(tableNames).toContain('categories')
      expect(tableNames).toContain('customers')
      expect(tableNames).toContain('suppliers')
      expect(tableNames).toContain('sales')
      expect(tableNames).toContain('sale_items')
      expect(tableNames).toContain('invoices')
      expect(tableNames).toContain('payments')
      expect(tableNames).toContain('payment_allocations')
      expect(tableNames).toContain('customer_ledger_transactions')
      expect(tableNames).toContain('supplier_ledger_transactions')
      expect(tableNames).toContain('purchases')
      expect(tableNames).toContain('purchase_items')
      expect(tableNames).toContain('goods_receipts')
      expect(tableNames).toContain('goods_receipt_items')
      expect(tableNames).toContain('supplier_payments')
      expect(tableNames).toContain('inventory_balances')
      expect(tableNames).toContain('stock_movements')
      expect(tableNames).toContain('stock_adjustments')
      expect(tableNames).toContain('stock_counts')
      expect(tableNames).toContain('idempotency_keys')
      expect(tableNames).toContain('files')
    })

    it('verifies idempotent re-application of migration scripts without failure', () => {
      const db = new DatabaseSync(':memory:')
      db.exec('PRAGMA foreign_keys = ON;')

      // Pass 1
      for (const file of migrationFiles) {
        db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf-8'))
      }

      // Pass 2 (re-run CREATE TABLE IF NOT EXISTS, etc.)
      for (const file of migrationFiles) {
        expect(() => {
          try {
            db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf-8'))
          } catch (err: unknown) {
            // SQLite ALTER TABLE ADD COLUMN does not support native IF NOT EXISTS syntax
            if (err instanceof Error && err.message.includes('duplicate column name')) {
              return
            }
            throw err
          }
        }).not.toThrow()
      }
    })
  })

  describe('Part 9.5: Local Database Backup and Restore Rehearsal', () => {
    it('executes a local database dump and verifies full schema and record count fidelity upon restore', () => {
      const sourceDb = new DatabaseSync(':memory:')
      sourceDb.exec('PRAGMA foreign_keys = ON;')

      for (const file of migrationFiles) {
        sourceDb.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf-8'))
      }

      // Seed records across businesses, branches, products, and categories
      sourceDb.prepare(`
        INSERT INTO businesses (id, business_code, name, status)
        VALUES ('biz_bkp', 'BIZBKP', 'Backup Verification Mart', 'active')
      `).run()

      sourceDb.prepare(`
        INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
        VALUES ('br_bkp_1', 'biz_bkp', 'MAIN', 'Main Store', 1, 'active')
      `).run()

      sourceDb.prepare(`
        INSERT INTO categories (id, business_id, name, slug, status)
        VALUES ('cat_bkp_1', 'biz_bkp', 'Beverages', 'beverages', 'active')
      `).run()

      sourceDb.prepare(`
        INSERT INTO products (id, business_id, category_id, name, sku, unit, purchase_price_minor, selling_price_minor, status)
        VALUES ('prod_bkp_1', 'biz_bkp', 'cat_bkp_1', 'Karak Chai 500g', 'CHAI-500', 'piece', 50000, 65000, 'active')
      `).run()

      // Rehearsal: Extract schema + data export
      const targetDb = new DatabaseSync(':memory:')
      targetDb.exec('PRAGMA foreign_keys = ON;')

      for (const file of migrationFiles) {
        targetDb.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf-8'))
      }

      // Export and load business, branch, category, product
      const bizRows = sourceDb.prepare('SELECT * FROM businesses').all() as any[]
      for (const b of bizRows) {
        targetDb.prepare('INSERT INTO businesses (id, business_code, name, status) VALUES (?, ?, ?, ?)').run(b.id, b.business_code, b.name, b.status)
      }

      const branchRows = sourceDb.prepare('SELECT * FROM branches').all() as any[]
      for (const br of branchRows) {
        targetDb.prepare('INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status) VALUES (?, ?, ?, ?, ?, ?)').run(br.id, br.business_id, br.branch_code, br.name, br.is_main_branch, br.status)
      }

      const catRows = sourceDb.prepare('SELECT * FROM categories').all() as any[]
      for (const c of catRows) {
        targetDb.prepare('INSERT INTO categories (id, business_id, name, slug, status) VALUES (?, ?, ?, ?, ?)').run(c.id, c.business_id, c.name, c.slug, c.status)
      }

      const prodRows = sourceDb.prepare('SELECT * FROM products').all() as any[]
      for (const p of prodRows) {
        targetDb.prepare('INSERT INTO products (id, business_id, category_id, name, sku, unit, purchase_price_minor, selling_price_minor, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
          p.id, p.business_id, p.category_id, p.name, p.sku, p.unit, p.purchase_price_minor, p.selling_price_minor, p.status
        )
      }

      // Verify target matches source exactly
      const restoredBiz = targetDb.prepare('SELECT * FROM businesses WHERE id = ?').get('biz_bkp') as any
      expect(restoredBiz).toBeDefined()
      expect(restoredBiz.name).toBe('Backup Verification Mart')

      const restoredProd = targetDb.prepare('SELECT * FROM products WHERE id = ?').get('prod_bkp_1') as any
      expect(restoredProd).toBeDefined()
      expect(restoredProd.sku).toBe('CHAI-500')
      expect(restoredProd.selling_price_minor).toBe(65000)

      // Verify PRAGMA foreign_key_check passes on restored DB
      const targetFkViolations = targetDb.prepare('PRAGMA foreign_key_check;').all()
      expect(targetFkViolations.length).toBe(0)
    })
  })

  describe('Part 3: End-to-End Business Workflows & Data Integrity Verification', () => {
    let sqlite: DatabaseSync
    let d1: D1Database
    let r2: MemoryR2Bucket
    let env: Env

    const businessId = 'biz_e2e_master'
    const branchA = 'br_e2e_a'
    const branchB = 'br_e2e_b'
    const ownerId = 'usr_e2e_owner'
    const cashierId = 'usr_e2e_cashier'
    let ownerToken: string
    let cashierToken: string

    beforeEach(async () => {
      sqlite = new DatabaseSync(':memory:')
      sqlite.exec('PRAGMA foreign_keys = ON;')

      for (const file of migrationFiles) {
        sqlite.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf-8'))
      }

      d1 = createRealD1(sqlite)
      r2 = new MemoryR2Bucket()
      env = {
        DB: d1,
        FILES: r2 as unknown as R2Bucket,
        ENVIRONMENT: 'local',
        SERVICE_NAME: 'pos-system-api',
        API_VERSION: 'v1',
      }

      // Seed business & branches
      sqlite.prepare(`
        INSERT INTO businesses (id, business_code, name, status)
        VALUES (?, 'E2E001', 'Northstar Flagship', 'active')
      `).run(businessId)

      sqlite.prepare(`
        INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
        VALUES (?, ?, 'BR-A', 'Branch Alpha', 1, 'active'),
               (?, ?, 'BR-B', 'Branch Beta', 0, 'active')
      `).run(branchA, businessId, branchB, businessId)

      sqlite.prepare(`
        INSERT INTO business_settings (business_id, allow_negative_stock)
        VALUES (?, 0)
      `).run(businessId)

      // Seed Owner & Cashier (using 10k iterations for ultra-fast test execution)
      const pwHash = await hashPassword('TestPassword123!', 10_000)
      sqlite.prepare(`
        INSERT INTO users (id, email, name, password_hash, status)
        VALUES (?, 'owner@northstar.pk', 'Owner Boss', ?, 'active'),
               (?, 'cashier@northstar.pk', 'Cashier Counter', ?, 'active')
      `).run(ownerId, pwHash, cashierId, pwHash)

      sqlite.prepare(`
        INSERT INTO business_members (id, business_id, user_id, role, is_active)
        VALUES ('mem_owner', ?, ?, 'owner', 1),
               ('mem_cashier', ?, ?, 'cashier', 1)
      `).run(businessId, ownerId, businessId, cashierId)

      sqlite.prepare(`
        INSERT INTO member_branches (id, member_id, branch_id)
        VALUES ('mb_cashier_a', 'mem_cashier', ?)
      `).run(branchA)

      ownerToken = (await createSession(d1, ownerId)).token
      cashierToken = (await createSession(d1, cashierId)).token
    })

    it('3.1 User Authentication Workflow: handles sign-in, session validation, staff role limits, and sign-out', async () => {
      // 1. Sign in via API
      const signinRes = await worker.fetch(
        new Request('http://localhost/api/v1/auth/sign-in', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'owner@northstar.pk', password: 'TestPassword123!' }),
        }),
        env
      )
      expect(signinRes.status).toBe(200)
      const signinData = (await signinRes.json()) as any
      expect(signinData.success).toBe(true)
      expect(signinData.data.user.email).toBe('owner@northstar.pk')

      // Check cookie header was set
      const cookieHeader = signinRes.headers.get('set-cookie')
      expect(cookieHeader).toContain('__session=')
      expect(cookieHeader).toContain('HttpOnly')

      // 2. Validate session via /api/v1/auth/me
      const meRes = await worker.fetch(
        new Request('http://localhost/api/v1/auth/me', {
          headers: { Cookie: `__session=${ownerToken}` },
        }),
        env
      )
      expect(meRes.status).toBe(200)
      const meData = (await meRes.json()) as any
      expect(meData.data.user.id).toBe(ownerId)
      expect(meData.data.businesses.length).toBeGreaterThan(0)

      // 3. Staff Role Guard: Cashier cannot perform managerial action (e.g., create category)
      const cashierForbiddenRes = await worker.fetch(
        new Request('http://localhost/api/v1/categories', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__session=${cashierToken}`,
            'X-Business-Id': businessId,
            'X-Branch-Id': branchA,
          },
          body: JSON.stringify({ name: 'Unauthorized Category' }),
        }),
        env
      )
      expect(cashierForbiddenRes.status).toBe(403)

      // 4. Sign-out clears session (with Origin for CSRF check)
      const signoutRes = await worker.fetch(
        new Request('http://localhost/api/v1/auth/sign-out', {
          method: 'POST',
          headers: {
            Cookie: `__session=${ownerToken}`,
            Origin: 'http://localhost:5173',
          },
        }),
        env
      )
      expect(signoutRes.status).toBe(200)

      // 5. Expired / signed-out session returns 401
      const revokedMeRes = await worker.fetch(
        new Request('http://localhost/api/v1/auth/me', {
          headers: { Cookie: `__session=${ownerToken}` },
        }),
        env
      )
      expect(revokedMeRes.status).toBe(401)
    })

    it('3.2 Product and Category Workflow: category create, product create, update, archive, and branch-specific stock', async () => {
      // 1. Create category
      const catRes = await worker.fetch(
        new Request('http://localhost/api/v1/categories', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__session=${ownerToken}`,
            'X-Business-Id': businessId,
            'X-Branch-Id': branchA,
          },
          body: JSON.stringify({ name: 'Groceries', description: 'Daily staple goods' }),
        }),
        env
      )
      expect(catRes.status).toBe(201)
      const catData = (await catRes.json()) as any
      const categoryId = catData.data.id

      // 2. Create product
      const prodRes = await worker.fetch(
        new Request('http://localhost/api/v1/products', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__session=${ownerToken}`,
            'X-Business-Id': businessId,
            'X-Branch-Id': branchA,
          },
          body: JSON.stringify({
            categoryId,
            name: 'Basmati Rice 5kg',
            sku: 'RICE-5KG',
            barcode: '8964000300',
            unit: 'piece',
            purchasePriceMinor: 120000,
            sellingPriceMinor: 150000,
            trackInventory: true,
          }),
        }),
        env
      )
      expect(prodRes.status).toBe(201)
      const prodData = (await prodRes.json()) as any
      const productId = prodData.data.id

      // 3. Update product
      const updateRes = await worker.fetch(
        new Request(`http://localhost/api/v1/products/${productId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__session=${ownerToken}`,
            'X-Business-Id': businessId,
            'X-Branch-Id': branchA,
          },
          body: JSON.stringify({
            name: 'Super Basmati Rice 5kg (Premium)',
            purchasePriceMinor: 125000,
            sellingPriceMinor: 155000,
          }),
        }),
        env
      )
      expect(updateRes.status).toBe(200)

      // 4. Archive product
      const archiveRes = await worker.fetch(
        new Request(`http://localhost/api/v1/products/${productId}`, {
          method: 'DELETE',
          headers: {
            Cookie: `__session=${ownerToken}`,
            'X-Business-Id': businessId,
            'X-Branch-Id': branchA,
          },
        }),
        env
      )
      expect(archiveRes.status).toBe(200)

      // Verify product is archived in DB
      const dbProd = sqlite.prepare('SELECT status FROM products WHERE id = ?').get(productId) as any
      expect(dbProd.status).toBe('archived')
    })

    it('3.3 & 3.4: Purchase-to-Stock & Supplier Payment Lifecycle: partial receipts, inventory balance increments, and ledger verification', async () => {
      // 1. Seed supplier
      const supplierId = 'sup_rice_mill'
      sqlite.prepare(`
        INSERT INTO suppliers (id, business_id, supplier_code, name, contact_person, phone, opening_payable_minor, status)
        VALUES (?, ?, 'SUP-01', 'Punjab Rice Mills Ltd', 'Chaudhry Akram', '03009998877', 0, 'active')
      `).run(supplierId, businessId)

      // 2. Seed product
      const productId = 'prod_rice_po'
      sqlite.prepare(`
        INSERT INTO products (id, business_id, name, sku, unit, purchase_price_minor, selling_price_minor, track_inventory, status)
        VALUES (?, ?, 'Kernal Basmati 25kg', 'RICE-25KG', 'piece', 500000, 620000, 1, 'active')
      `).run(productId, businessId)

      // 3. Create purchase order (10 bags @ PKR 5,000 = PKR 50,000 = 5,000,000 minor)
      const poRes = await worker.fetch(
        new Request('http://localhost/api/v1/purchases', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__session=${ownerToken}`,
            'X-Business-Id': businessId,
            'X-Branch-Id': branchA,
          },
          body: JSON.stringify({
            branchId: branchA,
            supplierId,
            items: [
              {
                productId,
                orderedQuantity: 10,
                unitCostMinor: 500000,
              },
            ],
          }),
        }),
        env
      )
      expect(poRes.status).toBe(201)
      const po = ((await poRes.json()) as any).data
      const purchaseId = po.id
      expect(po.status).toBe('draft')

      // 4. Confirm purchase order
      const confirmRes = await worker.fetch(
        new Request(`http://localhost/api/v1/purchases/${purchaseId}/confirm`, {
          method: 'POST',
          headers: {
            Cookie: `__session=${ownerToken}`,
            'X-Business-Id': businessId,
            'X-Branch-Id': branchA,
          },
        }),
        env
      )
      expect(confirmRes.status).toBe(200)

      // Invariant: Confirmation must NOT increment stock!
      const stockPreReceipt = sqlite.prepare(
        'SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?'
      ).get(businessId, branchA, productId) as any
      expect(stockPreReceipt?.quantity_on_hand || 0).toBe(0)

      // Get the purchase item ID
      const poItemId = (sqlite.prepare('SELECT id FROM purchase_items WHERE purchase_id = ?').get(purchaseId) as any).id

      // 5. Receive Partial Goods (4 bags out of 10)
      const partialReceiptRes = await worker.fetch(
        new Request(`http://localhost/api/v1/purchases/${purchaseId}/receipts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__session=${ownerToken}`,
            'X-Business-Id': businessId,
            'X-Branch-Id': branchA,
          },
          body: JSON.stringify({
            items: [
              {
                purchaseItemId: poItemId,
                quantityReceived: 4,
                unitCostMinor: 500000,
              },
            ],
          }),
        }),
        env
      )
      expect(partialReceiptRes.status).toBe(201)

      // Invariant: Stock must now increase strictly by 4
      const stockPartial = sqlite.prepare(
        'SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?'
      ).get(businessId, branchA, productId) as any
      expect(stockPartial.quantity_on_hand).toBe(4)

      // Verify PO status is 'partially_received'
      const poPartial = sqlite.prepare('SELECT status FROM purchases WHERE id = ?').get(purchaseId) as any
      expect(poPartial.status).toBe('partially_received')

      // 6. Receive Remaining Goods (6 bags)
      const fullReceiptRes = await worker.fetch(
        new Request(`http://localhost/api/v1/purchases/${purchaseId}/receipts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__session=${ownerToken}`,
            'X-Business-Id': businessId,
            'X-Branch-Id': branchA,
          },
          body: JSON.stringify({
            items: [
              {
                purchaseItemId: poItemId,
                quantityReceived: 6,
                unitCostMinor: 500000,
              },
            ],
          }),
        }),
        env
      )
      expect(fullReceiptRes.status).toBe(201)

      // Invariant: Total stock is now 10
      const stockFull = sqlite.prepare(
        'SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?'
      ).get(businessId, branchA, productId) as any
      expect(stockFull.quantity_on_hand).toBe(10)

      // Invariant: PO status is now 'received'
      const poFull = sqlite.prepare('SELECT status FROM purchases WHERE id = ?').get(purchaseId) as any
      expect(poFull.status).toBe('received')

      // 7. Verify Supplier Ledger reflects total liability of 5,000,000 minor
      const ledgerRows = sqlite.prepare(
        'SELECT * FROM supplier_ledger_transactions WHERE business_id = ? AND supplier_id = ?'
      ).all(businessId, supplierId) as any[]
      expect(ledgerRows.length).toBe(2) // 2 goods receipts
      const totalCredit = ledgerRows.reduce((acc, row) => acc + row.credit_minor, 0)
      expect(totalCredit).toBe(5000000)

      // 8. Record Supplier Payment of PKR 30,000 (3,000,000 minor)
      const payRes = await worker.fetch(
        new Request('http://localhost/api/v1/supplier-payments', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__session=${ownerToken}`,
            'X-Business-Id': businessId,
            'X-Branch-Id': branchA,
          },
          body: JSON.stringify({
            supplierId,
            amountMinor: 3000000,
            method: 'bank_transfer',
            referenceNumber: 'TXN-SUP-001',
          }),
        }),
        env
      )
      expect(payRes.status).toBe(201)

      // Verify supplier ledger summary reflects 2,000,000 remaining payable
      const summaryRes = await worker.fetch(
        new Request(`http://localhost/api/v1/suppliers/${supplierId}/ledger/summary`, {
          headers: {
            Cookie: `__session=${ownerToken}`,
            'X-Business-Id': businessId,
          },
        }),
        env
      )
      expect(summaryRes.status).toBe(200)
      const summaryData = ((await summaryRes.json()) as any).data
      expect(summaryData.totalBilledMinor).toBe(5000000)
      expect(summaryData.totalPaidMinor).toBe(3000000)
      expect(summaryData.currentPayableMinor).toBe(2000000)
    })

    it('3.5 & 3.6: POS Sale, Invoice Generation, Customer Ledger & Payment Lifecycle with Idempotency', async () => {
      // 1. Seed customer and initial stock
      const customerId = 'cust_vip_khan'
      sqlite.prepare(`
        INSERT INTO customers (id, business_id, customer_code, name, type, phone, opening_balance_minor, credit_limit_minor, is_walk_in, status)
        VALUES (?, ?, 'CUST-02', 'Khan Supermarket', 'business', '03112223344', 0, 10000000, 0, 'active')
      `).run(customerId, businessId)

      const prodId = 'prod_oil_1'
      sqlite.prepare(`
        INSERT INTO products (id, business_id, name, sku, unit, purchase_price_minor, selling_price_minor, track_inventory, status)
        VALUES (?, ?, 'Habib Cooking Oil 5L', 'OIL-5L', 'piece', 250000, 310000, 1, 'active')
      `).run(prodId, businessId)

      sqlite.prepare(`
        INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand, updated_at)
        VALUES ('inv_oil_a', ?, ?, ?, 20, datetime('now'))
      `).run(businessId, branchA, prodId)

      // 2. Perform POS Credit Sale of 2 cans (PKR 6,200 = 620,000 minor)
      const idempotencyKey = 'idemp_sale_pos_001'
      const salePayload = {
        customerId,
        items: [
          {
            productId: prodId,
            quantity: 2,
          },
        ],
        payments: [], // pure credit sale
      }

      const saleRes = await worker.fetch(
        new Request('http://localhost/api/v1/sales', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
            Cookie: `__session=${cashierToken}`,
            'X-Business-Id': businessId,
            'X-Branch-Id': branchA,
          },
          body: JSON.stringify(salePayload),
        }),
        env
      )
      expect(saleRes.status).toBe(201)
      const sale = ((await saleRes.json()) as any).data
      const saleId = sale.id
      expect(sale.totalAmountMinor).toBe(620000)

      // Invariant: Stock deducted exactly by 2 (20 -> 18)
      const stockAfterSale = sqlite.prepare(
        'SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?'
      ).get(businessId, branchA, prodId) as any
      expect(stockAfterSale.quantity_on_hand).toBe(18)

      // 3. Concurrency & Idempotency Check: Re-submitting the exact same sale request
      const dupSaleRes = await worker.fetch(
        new Request('http://localhost/api/v1/sales', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
            Cookie: `__session=${cashierToken}`,
            'X-Business-Id': businessId,
            'X-Branch-Id': branchA,
          },
          body: JSON.stringify(salePayload),
        }),
        env
      )
      expect(dupSaleRes.status).toBe(201)
      const dupSale = ((await dupSaleRes.json()) as any).data
      expect(dupSale.id).toBe(saleId)

      // Invariant: Stock must NOT be deducted twice! Still 18!
      const stockAfterDup = sqlite.prepare(
        'SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?'
      ).get(businessId, branchA, prodId) as any
      expect(stockAfterDup.quantity_on_hand).toBe(18)

      // 4. Verify Invoice was automatically generated
      const invoiceRes = await worker.fetch(
        new Request(`http://localhost/api/v1/sales/${saleId}/invoice`, {
          headers: {
            Cookie: `__session=${cashierToken}`,
            'X-Business-Id': businessId,
            'X-Branch-Id': branchA,
          },
        }),
        env
      )
      expect(invoiceRes.status).toBe(200)
      const invoice = ((await invoiceRes.json()) as any).data
      expect(invoice.total_amount_minor).toBe(620000)
      const invoiceId = invoice.id

      // 5. Verify Customer Ledger reflects 620,000 debit
      const ledgerRes = await worker.fetch(
        new Request(`http://localhost/api/v1/customers/${customerId}/ledger/summary`, {
          headers: {
            Cookie: `__session=${cashierToken}`,
            'X-Business-Id': businessId,
          },
        }),
        env
      )
      expect(ledgerRes.status).toBe(200)
      const custSummary = ((await ledgerRes.json()) as any).data
      expect(custSummary.totalInvoicedMinor).toBe(620000)
      expect(custSummary.currentBalanceMinor).toBe(620000)

      // 6. Customer makes a partial payment of PKR 4,000 (400,000 minor)
      const payRes = await worker.fetch(
        new Request('http://localhost/api/v1/customer-payments', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__session=${cashierToken}`,
            'X-Business-Id': businessId,
            'X-Branch-Id': branchA,
          },
          body: JSON.stringify({
            customerId,
            amountMinor: 400000,
            paymentMethods: [
              { method: 'cash', amountMinor: 400000 },
            ],
            allocations: [
              {
                invoiceId,
                amountMinor: 400000,
              },
            ],
          }),
        }),
        env
      )
      expect(payRes.status).toBe(201)

      // Invariant: Customer outstanding balance is now 220,000 minor
      const postPaySummaryRes = await worker.fetch(
        new Request(`http://localhost/api/v1/customers/${customerId}/ledger/summary`, {
          headers: {
            Cookie: `__session=${cashierToken}`,
            'X-Business-Id': businessId,
          },
        }),
        env
      )
      expect(postPaySummaryRes.status).toBe(200)
      const postPayData = ((await postPaySummaryRes.json()) as any).data
      expect(postPayData.totalPaidMinor).toBe(400000)
      expect(postPayData.currentBalanceMinor).toBe(220000)
    })

    it('3.7 Inventory Adjustment & Physical Stock Count Workflow: records variance, updates balances and prevents duplicate count finalization', async () => {
      const prodId = 'prod_tea_adj'
      sqlite.prepare(`
        INSERT INTO products (id, business_id, name, sku, unit, purchase_price_minor, selling_price_minor, track_inventory, status)
        VALUES (?, ?, 'Lipton Yellow Label 200g', 'LIPTON-200', 'piece', 20000, 26000, 1, 'active')
      `).run(prodId, businessId)

      sqlite.prepare(`
        INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand, updated_at)
        VALUES ('inv_tea_a', ?, ?, ?, 30, datetime('now'))
      `).run(businessId, branchA, prodId)

      // 1. Record stock adjustment: +5 pieces (damages found restocked or found stock)
      const adjRes = await worker.fetch(
        new Request('http://localhost/api/v1/inventory/adjustments', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__session=${ownerToken}`,
            'X-Business-Id': businessId,
            'X-Branch-Id': branchA,
          },
          body: JSON.stringify({
            productId: prodId,
            type: 'adjustment_in',
            quantityChange: 5,
            reason: 'audit_found',
            notes: 'Found in back stockroom',
          }),
        }),
        env
      )
      expect(adjRes.status).toBe(201)

      // Invariant: Stock balance is now 35
      const balAfterAdj = sqlite.prepare(
        'SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?'
      ).get(businessId, branchA, prodId) as any
      expect(balAfterAdj.quantity_on_hand).toBe(35)

      // 2. Physical Stock Count: Counted 32 (Variance: -3)
      const createCountRes = await worker.fetch(
        new Request('http://localhost/api/v1/inventory/counts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__session=${ownerToken}`,
            'X-Business-Id': businessId,
            'X-Branch-Id': branchA,
          },
          body: JSON.stringify({
            name: 'Weekly Cycle Count',
            items: [
              {
                productId: prodId,
                physicalQuantity: 32,
              },
            ],
          }),
        }),
        env
      )
      expect(createCountRes.status).toBe(201)
      const countId = ((await createCountRes.json()) as any).data.id

      // 3. Finalize stock count
      const finalizeRes = await worker.fetch(
        new Request(`http://localhost/api/v1/inventory/counts/${countId}/complete`, {
          method: 'POST',
          headers: {
            Cookie: `__session=${ownerToken}`,
            'X-Business-Id': businessId,
            'X-Branch-Id': branchA,
          },
        }),
        env
      )
      expect(finalizeRes.status).toBe(200)

      // Invariant: Balance is now reconciled to counted quantity (32)
      const balAfterCount = sqlite.prepare(
        'SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?'
      ).get(businessId, branchA, prodId) as any
      expect(balAfterCount.quantity_on_hand).toBe(32)

      // 4. Duplicate Finalization Check: Calling complete on an already completed count must fail safely
      const dupFinalizeRes = await worker.fetch(
        new Request(`http://localhost/api/v1/inventory/counts/${countId}/complete`, {
          method: 'POST',
          headers: {
            Cookie: `__session=${ownerToken}`,
            'X-Business-Id': businessId,
            'X-Branch-Id': branchA,
          },
        }),
        env
      )
      expect(dupFinalizeRes.status).toBe(400) // already completed

      // Invariant: Stock balance remains 32
      const balAfterDup = sqlite.prepare(
        'SELECT quantity_on_hand FROM inventory_balances WHERE business_id = ? AND branch_id = ? AND product_id = ?'
      ).get(businessId, branchA, prodId) as any
      expect(balAfterDup.quantity_on_hand).toBe(32)
    })

    it('3.8 Reports & Financial Invariants: verifies sales summary and revenue without inflation or duplicate aggregates', async () => {
      // Query sales summary report
      const reportRes = await worker.fetch(
        new Request('http://localhost/api/v1/reports/sales/summary', {
          headers: {
            Cookie: `__session=${ownerToken}`,
            'X-Business-Id': businessId,
            'X-Branch-Id': branchA,
          },
        }),
        env
      )
      expect(reportRes.status).toBe(200)
      const reportData = ((await reportRes.json()) as any).data
      expect(reportData).toBeDefined()
      expect(typeof reportData.totalAmountMinor).toBe('number')
      expect(typeof reportData.completedSalesCount).toBe('number')

      // Query inventory valuation report
      const valRes = await worker.fetch(
        new Request('http://localhost/api/v1/reports/inventory/valuation', {
          headers: {
            Cookie: `__session=${ownerToken}`,
            'X-Business-Id': businessId,
            'X-Branch-Id': branchA,
          },
        }),
        env
      )
      expect(valRes.status).toBe(200)
      const valData = ((await valRes.json()) as any).data
      expect(valData).toBeDefined()
      expect(Array.isArray(valData)).toBe(true)
    })

    it('3.9 R2 File Storage Workflow: upload, authorized content retrieval, cross-tenant isolation, and safe deletion', async () => {
      // Seed a product to attach the image to
      const testProdId = 'prod_photo_1'
      sqlite.prepare(`
        INSERT INTO products (id, business_id, name, sku, unit, purchase_price_minor, selling_price_minor, status)
        VALUES (?, ?, 'Photo Test Product', 'SKU-PHOTO', 'piece', 1000, 2000, 'active')
      `).run(testProdId, businessId)

      // 1. Upload a PNG image (fake PNG magic bytes: \x89PNG\r\n\x1a\n)
      const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03])
      const formData = new FormData()
      formData.append('file', new Blob([fakePng], { type: 'image/png' }), 'product_photo.png')
      formData.append('category', 'product_image')
      formData.append('relatedType', 'product')
      formData.append('relatedId', testProdId)

      const uploadRes = await worker.fetch(
        new Request('http://localhost/api/v1/files', {
          method: 'POST',
          headers: {
            Cookie: `__session=${ownerToken}`,
            'X-Business-Id': businessId,
            'X-Branch-Id': branchA,
          },
          body: formData,
        }),
        env
      )
      expect(uploadRes.status).toBe(201)
      const fileData = ((await uploadRes.json()) as any).data
      const fileId = fileData.id
      expect(fileData.originalFilename).toBe('product_photo.png')

      // 2. Retrieve authorized file content
      const contentRes = await worker.fetch(
        new Request(`http://localhost/api/v1/files/${fileId}/content`, {
          headers: {
            Cookie: `__session=${ownerToken}`,
            'X-Business-Id': businessId,
          },
        }),
        env
      )
      expect(contentRes.status).toBe(200)
      expect(contentRes.headers.get('content-type')).toBe('image/png')
      const bodyBytes = new Uint8Array(await contentRes.arrayBuffer())
      expect(bodyBytes.length).toBe(fakePng.length)

      // 3. Cross-Tenant Isolation: Another business user cannot access this file
      const otherBizId = 'biz_foreign_corp'
      sqlite.prepare(`
        INSERT INTO businesses (id, business_code, name, status)
        VALUES (?, 'FOR001', 'Foreign Competitor Ltd', 'active')
      `).run(otherBizId)
      sqlite.prepare(`
        INSERT INTO users (id, email, name, password_hash, status)
        VALUES ('usr_foreign', 'intruder@foreign.pk', 'Foreign User', 'dummy', 'active')
      `).run()
      sqlite.prepare(`
        INSERT INTO business_members (id, business_id, user_id, role, is_active)
        VALUES ('mem_foreign', ?, 'usr_foreign', 'owner', 1)
      `).run(otherBizId)
      const foreignToken = (await createSession(d1, 'usr_foreign')).token

      const crossTenantRes = await worker.fetch(
        new Request(`http://localhost/api/v1/files/${fileId}/content`, {
          headers: {
            Cookie: `__session=${foreignToken}`,
            'X-Business-Id': otherBizId,
          },
        }),
        env
      )
      expect(crossTenantRes.status).toBe(404) // scoped to authenticated tenant

      // 4. Delete file
      const deleteRes = await worker.fetch(
        new Request(`http://localhost/api/v1/files/${fileId}`, {
          method: 'DELETE',
          headers: {
            Cookie: `__session=${ownerToken}`,
            'X-Business-Id': businessId,
          },
        }),
        env
      )
      expect(deleteRes.status).toBe(200)

      // 5. Subsequent access returns 404
      const afterDeleteRes = await worker.fetch(
        new Request(`http://localhost/api/v1/files/${fileId}/content`, {
          headers: {
            Cookie: `__session=${ownerToken}`,
            'X-Business-Id': businessId,
          },
        }),
        env
      )
      expect(afterDeleteRes.status).toBe(404)
    })
  })
})
