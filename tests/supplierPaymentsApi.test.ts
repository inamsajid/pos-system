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

describe('Supplier Payments & Advance Allocation APIs', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const businessId = 'biz_sp_test'
  const branchId = 'branch_sp_main'
  const ownerUserId = 'usr_sp_owner'
  const cashierUserId = 'usr_sp_cashier'
  let ownerToken: string
  let cashierToken: string

  const supplierAId = 'supp_sp_a'
  const supplierBId = 'supp_sp_b'
  const po1Id = 'po_sp_1'
  const po2Id = 'po_sp_2'

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
      VALUES (?, 'BIZSP', 'Apex Treasury Services', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Treasury HQ', 1, 'active')
    `).run(branchId, businessId)

    // Seed Users (Owner & Cashier)
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'owner@apexsp.pk', 'Finance Director', 'dummy_hash', 'active'),
             (?, 'cashier@apexsp.pk', 'Front Desk', 'dummy_hash', 'active')
    `).run(ownerUserId, cashierUserId)

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_sp_owner', ?, ?, 'owner', 1),
             ('mem_sp_cashier', ?, ?, 'cashier', 1)
    `).run(businessId, ownerUserId, businessId, cashierUserId)

    sqlite.prepare(`
      INSERT INTO member_branches (id, member_id, branch_id)
      VALUES ('mb_sp_cashier', 'mem_sp_cashier', ?)
    `).run(branchId)

    // Seed Suppliers: A has opening payable 0, B has opening payable 0
    sqlite.prepare(`
      INSERT INTO suppliers (id, business_id, supplier_code, name, company_name, phone, email, tax_number, opening_payable_minor, status)
      VALUES (?, ?, 'SUPP-A', 'Intel Distributor', 'Intel Ltd', '03001234567', 'sales@intel.pk', 'NTN1122', 0, 'active'),
             (?, ?, 'SUPP-B', 'AMD Distributor', 'AMD Ltd', '03007654321', 'sales@amd.pk', 'NTN3344', 0, 'active')
    `).run(supplierAId, businessId, supplierBId, businessId)

    // Seed Purchases for Supplier A:
    // PO 1: Rs 500,000 minor, paid 0, status 'ordered'
    // PO 2: Rs 300,000 minor, paid 0, status 'received'
    sqlite.prepare(`
      INSERT INTO purchases (id, business_id, branch_id, purchase_number, supplier_id, supplier_snapshot_json, subtotal_minor, discount_minor, tax_minor, total_amount_minor, paid_amount_minor, status, purchase_date_key, created_by)
      VALUES (?, ?, ?, 'PO-A-001', ?, '{}', 500000, 0, 0, 500000, 0, 'ordered', '2026-11-09', ?),
             (?, ?, ?, 'PO-A-002', ?, '{}', 300000, 0, 0, 300000, 0, 'received', '2026-11-09', ?)
    `).run(po1Id, businessId, branchId, supplierAId, ownerUserId, po2Id, businessId, branchId, supplierAId, ownerUserId)

    // Seed an initial Goods Receipt Bill on Supplier Ledger for PO 2: credit Rs 300,000, balance 300,000
    sqlite.prepare(`
      INSERT INTO supplier_ledger_transactions (id, business_id, branch_id, supplier_id, type, reference_id, reference_number, description, debit_minor, credit_minor, balance_minor, business_date_key)
      VALUES ('slt_init_1', ?, ?, ?, 'bill', ?, 'PO-A-002', 'Goods receipt bill', 0, 300000, 300000, '2026-11-09')
    `).run(businessId, branchId, supplierAId, po2Id)

    ownerToken = (await createSession(d1, ownerUserId)).token
    cashierToken = (await createSession(d1, cashierUserId)).token
  })

  it('disburses supplier payment with PO bill allocations, updates purchase paid amount, and debits supplier ledger', async () => {
    // Pay Rs 200,000 allocated to PO 2 (which owes Rs 300,000)
    const paymentPayload = {
      supplierId: supplierAId,
      amountMinor: 200000,
      method: 'bank_transfer',
      reference: 'TXN-BANK-100293',
      notes: 'Partial payment against PO-A-002',
      allocations: [
        {
          purchaseId: po2Id,
          amountMinor: 200000,
        },
      ],
    }

    const res = await worker.fetch(
      new Request('https://pos.internal/api/v1/supplier-payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify(paymentPayload),
      }),
      env,
      executionCtx
    )
    expect(res.status).toBe(201)
    const json = (await res.json()) as { data: { id: string; receiptNumber: string; amountMinor: number; unallocatedAmountMinor: number; allocations: unknown[] } }
    expect(json.data.amountMinor).toBe(200000)
    expect(json.data.unallocatedAmountMinor).toBe(0)

    // 1. Verify PO 2 paid amount updated to 200,000
    const po2 = sqlite.prepare('SELECT paid_amount_minor, total_amount_minor FROM purchases WHERE id = ?').get(po2Id) as { paid_amount_minor: number; total_amount_minor: number }
    expect(po2.paid_amount_minor).toBe(200000)

    // 2. Verify Allocation record in DB
    const alloc = sqlite.prepare('SELECT * FROM supplier_payment_allocations WHERE payment_id = ?').get(json.data.id) as { amount_minor: number; purchase_id: string }
    expect(alloc).toBeTruthy()
    expect(alloc.amount_minor).toBe(200000)
    expect(alloc.purchase_id).toBe(po2Id)

    // 3. Verify Supplier Ledger: debited 200,000 -> balance becomes 300,000 - 200,000 = 100,000
    const lastLedger = sqlite.prepare('SELECT * FROM supplier_ledger_transactions WHERE business_id = ? AND supplier_id = ? ORDER BY rowid DESC LIMIT 1').get(businessId, supplierAId) as { type: string; debit_minor: number; credit_minor: number; balance_minor: number }
    expect(lastLedger.type).toBe('payment')
    expect(lastLedger.debit_minor).toBe(200000)
    expect(lastLedger.credit_minor).toBe(0)
    expect(lastLedger.balance_minor).toBe(100000)
  })

  it('records advance payment and subsequent advance allocation WITHOUT duplicating ledger entries', async () => {
    // 1. Disburse Rs 500,000: Rs 100,000 allocated to PO 2 (settling it completely), Rs 400,000 unallocated advance!
    const advancePayload = {
      supplierId: supplierAId,
      amountMinor: 500000,
      method: 'cash',
      reference: 'CASH-ADVANCE-01',
      allocations: [
        {
          purchaseId: po2Id,
          amountMinor: 100000,
        },
      ],
    }

    const payRes = await worker.fetch(
      new Request('https://pos.internal/api/v1/supplier-payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify(advancePayload),
      }),
      env,
      executionCtx
    )
    expect(payRes.status).toBe(201)
    const payJson = (await payRes.json()) as { data: { id: string; amountMinor: number; unallocatedAmountMinor: number } }
    expect(payJson.data.amountMinor).toBe(500000)
    expect(payJson.data.unallocatedAmountMinor).toBe(400000)

    const paymentId = payJson.data.id

    // Check ledger after initial payment: debited 500,000, balance was 300,000 -> 300,000 - 500,000 = -200,000 (advance)
    const ledgerAfterPay = sqlite.prepare('SELECT * FROM supplier_ledger_transactions WHERE business_id = ? AND supplier_id = ? ORDER BY rowid DESC LIMIT 1').get(businessId, supplierAId) as { debit_minor: number; balance_minor: number }
    expect(ledgerAfterPay.debit_minor).toBe(500000)
    expect(ledgerAfterPay.balance_minor).toBe(-200000)

    const ledgerCountBeforeAdvance = sqlite.prepare('SELECT COUNT(*) as cnt FROM supplier_ledger_transactions WHERE business_id = ? AND supplier_id = ?').get(businessId, supplierAId) as { cnt: number }

    // 2. Allocate Rs 250,000 from this advance against PO 1
    const allocRes = await worker.fetch(
      new Request(`https://pos.internal/api/v1/supplier-payments/${paymentId}/allocations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
        },
        body: JSON.stringify({
          allocations: [
            {
              purchaseId: po1Id,
              amountMinor: 250000,
            },
          ],
        }),
      }),
      env,
      executionCtx
    )
    expect(allocRes.status).toBe(200)
    const allocJson = (await allocRes.json()) as { data: { unallocatedAmountMinor: number } }
    expect(allocJson.data.unallocatedAmountMinor).toBe(150000) // 400,000 - 250,000 = 150,000

    // 3. Verify PO 1 paid amount updated to 250,000
    const po1 = sqlite.prepare('SELECT paid_amount_minor FROM purchases WHERE id = ?').get(po1Id) as { paid_amount_minor: number }
    expect(po1.paid_amount_minor).toBe(250000)

    // 4. CRITICAL: Advance allocation MUST NOT create a duplicate debit in supplier ledger!
    const ledgerCountAfterAdvance = sqlite.prepare('SELECT COUNT(*) as cnt FROM supplier_ledger_transactions WHERE business_id = ? AND supplier_id = ?').get(businessId, supplierAId) as { cnt: number }
    expect(ledgerCountAfterAdvance.cnt).toBe(ledgerCountBeforeAdvance.cnt)
  })

  it('rejects over-allocation and cross-supplier allocations', async () => {
    // Attempt to allocate payment to PO 2 more than remaining unpaid (PO 2 total is 300,000)
    const overAllocReq = await worker.fetch(
      new Request('https://pos.internal/api/v1/supplier-payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          supplierId: supplierAId,
          amountMinor: 400000,
          method: 'cash',
          allocations: [{ purchaseId: po2Id, amountMinor: 350000 }],
        }),
      }),
      env,
      executionCtx
    )
    expect(overAllocReq.status).toBe(400)
    const overErr = (await overAllocReq.json()) as { error: { message: string } }
    expect(overErr.error.message).toContain('exceeds remaining unpaid balance')

    // Cross-supplier allocation: Supplier B cannot allocate to PO 2 (which belongs to Supplier A)
    const crossAllocReq = await worker.fetch(
      new Request('https://pos.internal/api/v1/supplier-payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          supplierId: supplierBId,
          amountMinor: 100000,
          method: 'cash',
          allocations: [{ purchaseId: po2Id, amountMinor: 100000 }],
        }),
      }),
      env,
      executionCtx
    )
    expect(crossAllocReq.status).toBe(400)
    const crossErr = (await crossAllocReq.json()) as { error: { message: string } }
    expect(crossErr.error.message).toContain('does not belong to supplier')
  })

  it('guarantees idempotency on supplier payment creation', async () => {
    const idemKey = 'idemp_sp_key_999'
    const payload = {
      supplierId: supplierAId,
      amountMinor: 50000,
      method: 'cash' as const,
      reference: 'REC-IDEM-01',
    }

    const res1 = await worker.fetch(
      new Request('https://pos.internal/api/v1/supplier-payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
          'Idempotency-Key': idemKey,
        },
        body: JSON.stringify(payload),
      }),
      env,
      executionCtx
    )
    expect(res1.status).toBe(201)
    const json1 = (await res1.json()) as { data: { id: string } }

    // Replay
    const res2 = await worker.fetch(
      new Request('https://pos.internal/api/v1/supplier-payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
          'Idempotency-Key': idemKey,
        },
        body: JSON.stringify(payload),
      }),
      env,
      executionCtx
    )
    expect(res2.status).toBe(201)
    const json2 = (await res2.json()) as { data: { id: string } }
    expect(json2.data.id).toBe(json1.data.id)

    // Conflict with different payload
    const res3 = await worker.fetch(
      new Request('https://pos.internal/api/v1/supplier-payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `__session=${ownerToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
          'Idempotency-Key': idemKey,
        },
        body: JSON.stringify({ ...payload, amountMinor: 75000 }),
      }),
      env,
      executionCtx
    )
    expect(res3.status).toBe(409)
  })

  it('enforces RBAC permissions: cashier cannot disburse supplier payments', async () => {
    const res = await worker.fetch(
      new Request('https://pos.internal/api/v1/supplier-payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `__session=${cashierToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          supplierId: supplierAId,
          amountMinor: 10000,
          method: 'cash',
        }),
      }),
      env,
      executionCtx
    )
    expect(res.status).toBe(403)
  })
})

