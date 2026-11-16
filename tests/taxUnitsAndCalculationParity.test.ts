import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import worker from '../worker/src/index'
import type { Env } from '../worker/src/types/environment'
import { createSession } from '../worker/src/auth/sessionService'
import { createTestD1Database } from './offline/testD1Helper'
import { calculateTaxMinor, bpsFromPercent } from '../worker/src/lib/money'
import { taxAmount } from '../src/features/pos/utils/checkoutCalculations'
import { calculateTaxPaise } from '../src/domain/money/moneyUtils'

const executionCtx: ExecutionContext = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
}

describe('Tax Units and Calculation Parity Regression Suite', () => {
  let sqlite: DatabaseSync
  let d1: D1Database
  let env: Env

  const businessId = 'biz_tax_test'
  const branchId = 'branch_tax_test'
  const cashierUserId = 'usr_cashier_tax'
  const productAId = 'prod_tax_a'
  const productBId = 'prod_tax_b'

  let cashierToken: string
  let managerToken: string

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
      AUTH_SECRET: 'test-tax-parity-secret-key-32-chars-long',
    }

    sqlite.prepare(`
      INSERT INTO businesses (id, business_code, name, status)
      VALUES (?, 'TAX01', 'Tax Parity Business', 'active')
    `).run(businessId)

    sqlite.prepare(`
      INSERT INTO branches (id, business_id, branch_code, name, is_main_branch, status)
      VALUES (?, ?, 'MAIN', 'Tax Main Branch', 1, 'active')
    `).run(branchId, businessId)

    sqlite.prepare(`
      INSERT INTO business_settings (business_id, allow_negative_stock, default_tax_rate, settings_json)
      VALUES (?, 1, 17.0, '{"taxInclusive":false,"maxCashierDiscountPercent":10}')
    `).run(businessId)

    const managerUserId = 'usr_mgr_tax'
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, status)
      VALUES (?, 'cashier@tax.pk', 'Tax Cashier', 'hash', 'active'),
             (?, 'mgr@tax.pk', 'Tax Manager', 'hash', 'active')
    `).run(cashierUserId, managerUserId)

    sqlite.prepare(`
      INSERT INTO business_members (id, business_id, user_id, role, is_active)
      VALUES ('mem_cashier_tax', ?, ?, 'cashier', 1),
             ('mem_mgr_tax', ?, ?, 'manager', 1)
    `).run(businessId, cashierUserId, businessId, managerUserId)

    sqlite.prepare(`
      INSERT INTO member_branches (id, member_id, branch_id)
      VALUES ('mb_cashier_tax', 'mem_cashier_tax', ?),
             ('mb_mgr_tax', 'mem_mgr_tax', ?)
    `).run(branchId, branchId)

    sqlite.prepare(`
      INSERT INTO products (id, business_id, name, sku, barcode, unit, purchase_price_minor, selling_price_minor, track_inventory, status)
      VALUES (?, ?, 'Item A Standard', 'SKU-A', '2001', 'piece', 5000, 10000, 0, 'active'),
             (?, ?, 'Item B High Value', 'SKU-B', '2002', 'piece', 50000000, 100000000, 0, 'active')
    `).run(productAId, businessId, productBId, businessId)

    const session = await createSession(d1, cashierUserId, '127.0.0.1', 'Vitest Agent')
    cashierToken = session.token

    const mgrSession = await createSession(d1, managerUserId, '127.0.0.1', 'Vitest Agent')
    managerToken = mgrSession.token
  })

  // 1. Math and Unit Conversion Tests
  describe('Mathematical Parity & Unit Specifications', () => {
    it('accurately converts percentage units to basis points (bps)', () => {
      expect(bpsFromPercent(0)).toBe(0)
      expect(bpsFromPercent(1)).toBe(100)
      expect(bpsFromPercent(5)).toBe(500)
      expect(bpsFromPercent(17)).toBe(1700)
      expect(bpsFromPercent(17.5)).toBe(1750)
      expect(bpsFromPercent(16.25)).toBe(1625)
    })

    it('calculates 0% tax correctly across all helper functions', () => {
      const netMinor = 10000 // 100.00 PKR
      const bps = bpsFromPercent(0)
      expect(calculateTaxMinor(netMinor, bps)).toBe(0)
      expect(calculateTaxPaise(netMinor, 0)).toBe(0)
      expect(taxAmount(100, 0)).toBe(0)
    })

    it('calculates 1% tax correctly', () => {
      const netMinor = 10000 // 100.00 PKR
      const bps = bpsFromPercent(1) // 100 bps
      expect(calculateTaxMinor(netMinor, bps)).toBe(100) // 1.00 PKR
      expect(calculateTaxPaise(netMinor, 1)).toBe(100)
      expect(taxAmount(100, 1)).toBe(1)
    })

    it('calculates standard 17% tax accurately on integer base', () => {
      const netMinor = 10000 // 100.00 PKR
      const bps = bpsFromPercent(17) // 1700 bps
      // taxAmountMinor = round(10000 * 1700 / 10000) = 1700
      expect(calculateTaxMinor(netMinor, bps)).toBe(1700) // 17.00 PKR
      expect(calculateTaxPaise(netMinor, 17)).toBe(1700)
      expect(taxAmount(100, 17)).toBe(17)
    })

    it('handles fractional rounding to nearest integer minor unit (half-up round)', () => {
      // Net base: 333 paise (3.33 PKR) at 17% (1700 bps)
      // 333 * 1700 / 10000 = 56.61 paise -> rounds to 57 paise
      expect(calculateTaxMinor(333, 1700)).toBe(57)
      expect(calculateTaxPaise(333, 17)).toBe(57)

      // Net base: 332 paise (3.32 PKR) at 17% (1700 bps)
      // 332 * 1700 / 10000 = 56.44 paise -> rounds to 56 paise
      expect(calculateTaxMinor(332, 1700)).toBe(56)
      expect(calculateTaxPaise(332, 17)).toBe(56)

      // Net base: 99 paise at 17.5% (1750 bps)
      // 99 * 1750 / 10000 = 17.325 paise -> rounds to 17 paise
      expect(calculateTaxMinor(99, 1750)).toBe(17)
      expect(calculateTaxPaise(99, 17.5)).toBe(17)
    })

    it('returns zero tax for zero or negative transactions safely', () => {
      expect(calculateTaxMinor(0, 1700)).toBe(0)
      expect(calculateTaxMinor(-500, 1700)).toBe(0)
      expect(calculateTaxPaise(0, 17)).toBe(0)
      expect(calculateTaxPaise(-500, 17)).toBe(0)
      expect(taxAmount(0, 17)).toBe(0)
      expect(taxAmount(-50, 17)).toBe(0)
    })

    it('accurately computes tax on very large transaction amounts without precision drift', () => {
      // 10,000,000 PKR = 1,000,000,000 paise (1 billion minor units)
      const largeNetMinor = 1_000_000_000
      const bps = 1700 // 17%
      // 1,000,000,000 * 1700 / 10000 = 170,000,000 paise (1,700,000 PKR)
      expect(calculateTaxMinor(largeNetMinor, bps)).toBe(170_000_000)
      expect(calculateTaxPaise(largeNetMinor, 17)).toBe(170_000_000)
      expect(taxAmount(10_000_000, 17)).toBe(1_700_000)
    })

    it('calculates tax-inclusive mode accurately', () => {
      // If gross is 117.00 PKR (11700 paise) and tax rate is 17% inclusive
      // Tax = round(11700 * 1700 / (10000 + 1700)) = round(19890000 / 11700) = 1700 paise
      expect(calculateTaxMinor(11700, 1700, true)).toBe(1700)
      expect(taxAmount(117, 17, true)).toBe(17)
    })
  })

  // 2. End-to-End Flow: Settings -> Sales -> Invoices -> Reports Reconciliation
  describe('Full Stack Flow & Report Reconciliation', () => {
    it('applies business_settings default_tax_rate (17%) to POS sales, generates matching invoices, and reconciles with sales reports', async () => {
      // 1. Post a sale for 2 units of Item A (2 * 100.00 = 200.00 PKR / 20,000 paise)
      // Tax at 17% should be: 20000 * 1700 / 10000 = 3,400 paise (34.00 PKR)
      // Total amount should be: 20,000 + 3,400 = 23,400 paise (234.00 PKR)
      const saleReq = new Request('http://localhost/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cashierToken}`,
          'X-Branch-Id': branchId,
        },
        body: JSON.stringify({
          items: [{ productId: productAId, quantity: 2 }],
          payments: [{ method: 'cash', amountMinor: 23400 }],
        }),
      })

      const saleRes = await worker.fetch(saleReq, env, executionCtx)
      expect(saleRes.status).toBe(201)
      const saleData = await saleRes.json() as {
        data: {
          id: string
          subtotalMinor: number
          taxMinor: number
          totalAmountMinor: number
          invoiceNumber: string
        }
      }

      expect(saleData.data.subtotalMinor).toBe(20000)
      expect(saleData.data.taxMinor).toBe(3400)
      expect(saleData.data.totalAmountMinor).toBe(23400)

      // 2. Verify Sale & Invoice Match 1:1
      const invoiceReq = new Request(`http://localhost/api/v1/sales/${saleData.data.id}/invoice`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${cashierToken}`,
          'X-Branch-Id': branchId,
        },
      })
      const invoiceRes = await worker.fetch(invoiceReq, env, executionCtx)
      expect(invoiceRes.status).toBe(200)
      const invoiceData = await invoiceRes.json() as {
        data: {
          total_amount_minor: number
          sale_id: string
          payment_status: string
        }
      }
      expect(invoiceData.data.total_amount_minor).toBe(23400)
      expect(invoiceData.data.sale_id).toBe(saleData.data.id)

      // Fetch the full sale record to verify item tax breakdown
      const getSaleReq = new Request(`http://localhost/api/v1/sales/${saleData.data.id}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${cashierToken}`,
          'X-Branch-Id': branchId,
        },
      })
      const getSaleRes = await worker.fetch(getSaleReq, env, executionCtx)
      expect(getSaleRes.status).toBe(200)
      const fullSaleData = await getSaleRes.json() as {
        data: {
          subtotalMinor: number
          taxMinor: number
          totalAmountMinor: number
          items: Array<{ taxMinor: number; subtotalMinor: number; lineTotalMinor: number }>
        }
      }
      expect(fullSaleData.data.totalAmountMinor).toBe(23400)
      expect(fullSaleData.data.items[0].subtotalMinor).toBe(20000)
      expect(fullSaleData.data.items[0].taxMinor).toBe(3400)
      expect(fullSaleData.data.items[0].lineTotalMinor).toBe(23400)

      // 3. Verify Daily Sales Summary Report Matches 1:1 using manager token
      const todayKey = new Date().toISOString().slice(0, 10)
      const reportReq = new Request(`http://localhost/api/v1/reports/sales/summary?startDate=${todayKey}&endDate=${todayKey}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${managerToken}`,
          'X-Branch-Id': branchId,
        },
      })
      const reportRes = await worker.fetch(reportReq, env, executionCtx)
      expect(reportRes.status).toBe(200)
      const reportData = await reportRes.json() as {
        data: {
          grossSalesMinor: number
          netSalesMinor: number
          taxTotalMinor: number
          totalOrders: number
        }
      }

      expect(reportData.data.completedSalesCount).toBe(1)
      expect(reportData.data.grossSalesMinor).toBe(20000)
      expect(reportData.data.taxTotalMinor).toBe(3400)
      expect(reportData.data.netSalesMinor).toBe(20000)
      expect(reportData.data.totalAmountMinor).toBe(23400)
    })
  })
})
