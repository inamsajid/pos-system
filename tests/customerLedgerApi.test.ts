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

describe('Customer Ledger API (/api/v1/customers/:customerId/ledger)', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const businessId = 'biz_ledger_test'
  const branchId = 'branch_ledger_main'
  const accountantUserId = 'usr_accountant_ledger'
  let accountantToken: string

  const custId = 'cust_ledger_profile_1'
  const prodId = 'prod_ledger_1'

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
      VALUES (?, 'BIZLEDGER', 'Ledger Enterprise', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Ledger Main Branch', 1, 'active')
    `).run(branchId, businessId)

    // Seed Accountant
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'accountant@ledger.pk', 'Accountant User', 'dummy_hash', 'active')
    `).run(accountantUserId)
    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_acct_ledger', ?, ?, 'accountant', 1)
    `).run(businessId, accountantUserId)
    sqlite.prepare(`
      INSERT INTO member_branches (id, member_id, branch_id)
      VALUES ('mb_acct_ledger', 'mem_acct_ledger', ?)
    `).run(branchId)

    // Seed Customer (Opening balance: PKR 10,000 = 1,000,000 minor, Credit Limit: PKR 50,000 = 5,000,000 minor)
    sqlite.prepare(`
      INSERT INTO customers (id, business_id, customer_code, name, type, phone, opening_balance_minor, credit_limit_minor, is_walk_in, status)
      VALUES (?, ?, 'CUST-LEDGER', 'Tariq Wholesale', 'business', '03331234567', 1000000, 5000000, 0, 'active')
    `).run(custId, businessId)

    // Seed initial opening balance entry in ledger
    sqlite.prepare(`
      INSERT INTO customer_ledger_transactions (
        id, business_id, branch_id, customer_id, type, reference_id, reference_number,
        description, debit_minor, credit_minor, balance_minor, business_date_key, created_at
      ) VALUES (
        'clt_init_opening', ?, ?, ?, 'opening', 'init', 'OP-BAL',
        'Opening Balance', 1000000, 0, 1000000, '2026-11-01', '2026-11-01 08:00:00'
      )
    `).run(businessId, branchId, custId)

    // Seed Product & Stock
    sqlite.prepare(`
      INSERT INTO products (id, business_id, name, sku, barcode, unit, purchase_price_minor, selling_price_minor, track_inventory, status)
      VALUES (?, ?, 'Flour Bag 20kg', 'FLOUR-20KG', '8967000100', 'piece', 180000, 220000, 1, 'active')
    `).run(prodId, businessId)
    sqlite.prepare(`
      INSERT INTO inventory_balances (id, business_id, branch_id, product_id, quantity_on_hand, updated_at)
      VALUES ('inv_bal_ledg', ?, ?, ?, 500.0, datetime('now'))
    `).run(businessId, branchId, prodId)

    accountantToken = (await createSession(d1, accountantUserId)).token

    // Transaction 1: Invoice on 2026-11-03 (Total: 440,000 minor, remaining: 440,000)
    sqlite.prepare(`
      INSERT INTO sales (
        id, business_id, branch_id, sale_number, receipt_number, invoice_number,
        customer_id, customer_snapshot_json, terminal_id, cashier_id, cashier_name,
        subtotal_minor, discount_minor, tax_minor, total_amount_minor, amount_paid_minor, remaining_balance_minor, change_returned_minor,
        status, business_date_key, created_at, updated_at
      ) VALUES (
        'sale_ledg_1', ?, ?, 'S-001', 'R-001', 'INV-001',
        ?, '{}', 'POS01', ?, 'Cashier',
        440000, 0, 0, 440000, 0, 440000, 0,
        'completed', '2026-11-03', '2026-11-03 10:00:00', '2026-11-03 10:00:00'
      )
    `).run(businessId, branchId, custId, accountantUserId)

    sqlite.prepare(`
      INSERT INTO invoices (
        id, business_id, branch_id, invoice_number, sale_id, customer_id,
        business_date_key, total_amount_minor, paid_amount_minor, remaining_amount_minor,
        payment_status, status, created_at, updated_at
      ) VALUES (
        'inv_ledg_1', ?, ?, 'INV-001', 'sale_ledg_1', ?,
        '2026-11-03', 440000, 0, 440000,
        'unpaid', 'active', '2026-11-03 10:00:00', '2026-11-03 10:00:00'
      )
    `).run(businessId, branchId, custId)

    sqlite.prepare(`
      INSERT INTO customer_ledger_transactions (
        id, business_id, branch_id, customer_id, type, reference_id, reference_number,
        description, debit_minor, credit_minor, balance_minor, business_date_key, created_at
      ) VALUES (
        'clt_ledg_1', ?, ?, ?, 'invoice', 'sale_ledg_1', 'INV-001',
        'Sales Invoice INV-001', 440000, 0, 1440000, '2026-11-03', '2026-11-03 10:00:00'
      )
    `).run(businessId, branchId, custId)

    // Transaction 2: Payment on 2026-11-05 (Amount: 500,000 minor)
    sqlite.prepare(`
      INSERT INTO payments (
        id, business_id, branch_id, receipt_number, customer_id, customer_snapshot_json,
        amount_minor, unallocated_amount_minor, source, business_date_key,
        received_by, received_at, created_at
      ) VALUES (
        'pay_ledg_1', ?, ?, 'RCP-001', ?, '{}',
        500000, 60000, 'manual', '2026-11-05',
        ?, '2026-11-05 14:00:00', '2026-11-05 14:00:00'
      )
    `).run(businessId, branchId, custId, accountantUserId)

    sqlite.prepare(`
      INSERT INTO customer_ledger_transactions (
        id, business_id, branch_id, customer_id, type, reference_id, reference_number,
        description, debit_minor, credit_minor, balance_minor, business_date_key, created_at
      ) VALUES (
        'clt_ledg_2', ?, ?, ?, 'payment', 'pay_ledg_1', 'RCP-001',
        'Customer Payment RCP-001', 0, 500000, 940000, '2026-11-05', '2026-11-05 14:00:00'
      )
    `).run(businessId, branchId, custId)
  })

  it('generates full ledger statement with opening, debits, credits, and closing balance', async () => {
    const res = await worker.fetch(
      new Request(`http://localhost/api/v1/customers/${custId}/ledger`, {
        headers: {
          Authorization: `Bearer ${accountantToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
      }),
      env,
      executionCtx
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      data: {
        openingBalanceMinor: number
        closingBalanceMinor: number
        totalDebitsMinor: number
        totalCreditsMinor: number
        netChangeMinor: number
        entries: Array<{
          type: string
          debitMinor: number
          creditMinor: number
          balanceMinor: number
        }>
      }
    }
    const stmt = json.data
    expect(stmt.entries.length).toBe(3)
    expect(stmt.openingBalanceMinor).toBe(1000000)
    expect(stmt.totalDebitsMinor).toBe(1440000) // opening debit 1,000,000 + invoice 440,000
    expect(stmt.totalCreditsMinor).toBe(500000)
    expect(stmt.netChangeMinor).toBe(940000)
    expect(stmt.closingBalanceMinor).toBe(1940000) // 1,000,000 + 940,000

    // Check last entry running balance
    expect(stmt.entries[2].balanceMinor).toBe(940000)
  })

  it('supports date filtering and computes opening balance prior to startDate', async () => {
    // Filter starting from 2026-11-04 (so after the invoice on 2026-11-03)
    // Opening balance before 2026-11-04 is 1,440,000
    const res = await worker.fetch(
      new Request(`http://localhost/api/v1/customers/${custId}/ledger?startDate=2026-11-04&endDate=2026-11-06`, {
        headers: {
          Authorization: `Bearer ${accountantToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
      }),
      env,
      executionCtx
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      data: {
        openingBalanceMinor: number
        closingBalanceMinor: number
        totalDebitsMinor: number
        totalCreditsMinor: number
        entries: Array<{ type: string; creditMinor: number; balanceMinor: number }>
      }
    }
    const stmt = json.data
    expect(stmt.openingBalanceMinor).toBe(1440000) // Balance at end of 2026-11-03
    expect(stmt.entries.length).toBe(1) // Only the payment on 2026-11-05
    expect(stmt.totalDebitsMinor).toBe(0)
    expect(stmt.totalCreditsMinor).toBe(500000)
    expect(stmt.closingBalanceMinor).toBe(940000) // 1,440,000 - 500,000
  })

  it('filters ledger entries by transaction type', async () => {
    const res = await worker.fetch(
      new Request(`http://localhost/api/v1/customers/${custId}/ledger?type=payment`, {
        headers: {
          Authorization: `Bearer ${accountantToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
      }),
      env,
      executionCtx
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: { entries: Array<{ type: string }> } }
    expect(json.data.entries.length).toBe(1)
    expect(json.data.entries[0].type).toBe('payment')
  })

  it('returns customer financial summary metrics via /customers/:customerId/ledger/summary', async () => {
    const res = await worker.fetch(
      new Request(`http://localhost/api/v1/customers/${custId}/ledger/summary`, {
        headers: {
          Authorization: `Bearer ${accountantToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
      }),
      env,
      executionCtx
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      data: {
        customerId: string
        currentBalanceMinor: number
        creditLimitMinor: number
        availableCreditMinor: number
        totalInvoicedMinor: number
        totalPaidMinor: number
        openInvoicesCount: number
        earliestUnpaidInvoiceDate: string
      }
    }
    const summary = json.data
    expect(summary.customerId).toBe(custId)
    expect(summary.currentBalanceMinor).toBe(940000)
    expect(summary.creditLimitMinor).toBe(5000000)
    expect(summary.availableCreditMinor).toBe(5000000 - 940000) // 4,060,000
    expect(summary.totalInvoicedMinor).toBe(440000)
    expect(summary.totalPaidMinor).toBe(500000)
    expect(summary.openInvoicesCount).toBe(1)
    expect(summary.earliestUnpaidInvoiceDate).toBe('2026-11-03')
  })

  it('returns 404 for non-existent customer ledger', async () => {
    const res = await worker.fetch(
      new Request('http://localhost/api/v1/customers/cust_unknown_999/ledger', {
        headers: {
          Authorization: `Bearer ${accountantToken}`,
          'X-Business-Id': businessId,
          'X-Branch-Id': branchId,
        },
      }),
      env,
      executionCtx
    )
    expect(res.status).toBe(404)
  })
})
