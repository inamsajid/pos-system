import { describe, expect, it } from 'vitest'
import { isWithinBusinessDateRange } from '../src/lib/businessDate'
import { saleMatchesDate } from '../src/features/sales/utils/salesUtils'
import { dateInRange, getComparisonRange } from '../src/features/reports/utils/reportDateUtils'
import type { CheckoutSale } from '../src/features/pos/types/checkout.types'

function makeMockSale(id: string, createdAt: string): CheckoutSale {
  return {
    id,
    receiptNumber: `REC-${id}`,
    invoiceNumber: `INV-${id}`,
    customerId: 'cust-1',
    customerName: 'Test Customer',
    cashierName: 'Ayesha Khan',
    subtotal: 1000,
    discountAmount: 0,
    taxAmount: 0,
    totalAmount: 1000,
    amountPaid: 1000,
    changeGiven: 0,
    status: 'completed',
    items: [],
    payments: [{ method: 'cash', amount: 1000, receivedAt: createdAt }],
    createdAt,
  }
}

describe('Date Filters Cross-Module Integration', () => {
  describe('Sales Date Filtering (saleMatchesDate)', () => {
    it('correctly filters sales on Pakistan calendar boundaries', () => {
      // 2026-11-07 20:30:00 UTC is 2026-11-08 01:30:00 in Pakistan
      const saleNov8 = makeMockSale('sale-nov8', '2026-11-07T20:30:00.000Z')
      // 2026-11-07 15:00:00 UTC is 2026-11-07 20:00:00 in Pakistan
      const saleNov7 = makeMockSale('sale-nov7', '2026-11-07T15:00:00.000Z')

      expect(saleMatchesDate(saleNov8, 'custom', '2026-11-08', '2026-11-08')).toBe(true)
      expect(saleMatchesDate(saleNov8, 'custom', '2026-11-07', '2026-11-07')).toBe(false)

      expect(saleMatchesDate(saleNov7, 'custom', '2026-11-07', '2026-11-07')).toBe(true)
      expect(saleMatchesDate(saleNov7, 'custom', '2026-11-08', '2026-11-08')).toBe(false)
    })

    it('includes all sales when range is "all"', () => {
      const sale = makeMockSale('sale-all', '2025-01-01T00:00:00.000Z')
      expect(saleMatchesDate(sale, 'all', '', '')).toBe(true)
    })
  })

  describe('Invoices Date Filtering', () => {
    it('filters invoice timestamps with inclusive end-of-day in Pakistan', () => {
      // 23:59 PKT on Nov 8 (18:59 UTC)
      const lateInvoice = '2026-11-08T18:59:00.000Z'
      // 00:01 PKT on Nov 9 (19:01 UTC on Nov 8)
      const nextDayInvoice = '2026-11-08T19:01:00.000Z'

      expect(isWithinBusinessDateRange(lateInvoice, '2026-11-01', '2026-11-08')).toBe(true)
      expect(isWithinBusinessDateRange(nextDayInvoice, '2026-11-01', '2026-11-08')).toBe(false)
    })
  })

  describe('Customer & Supplier Ledger Date Filtering', () => {
    it('filters ledger transactions by business date accurately', () => {
      const entryNov1 = { date: '2026-11-01T10:00:00.000Z', reference: 'INV-1' }
      const entryNov5 = { date: '2026-11-05T12:00:00.000Z', reference: 'PAY-1' }
      const entryNov9 = { date: '2026-11-09T08:00:00.000Z', reference: 'INV-2' }

      const ledger = [entryNov1, entryNov5, entryNov9]
      const filtered = ledger.filter((e) =>
        isWithinBusinessDateRange(e.date, '2026-11-02', '2026-11-08')
      )

      expect(filtered).toHaveLength(1)
      expect(filtered[0].reference).toBe('PAY-1')
    })
  })

  describe('Stock Movements Date Filtering', () => {
    it('filters inventory movements across business date range', () => {
      // 19:30 UTC on Nov 7 = 00:30 PKT on Nov 8
      const movementNov8 = { createdAt: '2026-11-07T19:30:00.000Z', movementNumber: 'MOV-001' }
      const movementNov6 = { createdAt: '2026-11-06T12:00:00.000Z', movementNumber: 'MOV-002' }

      const movements = [movementNov8, movementNov6]
      const inRangeNov8 = movements.filter((m) =>
        isWithinBusinessDateRange(m.createdAt, '2026-11-08', '2026-11-08')
      )

      expect(inRangeNov8).toHaveLength(1)
      expect(inRangeNov8[0].movementNumber).toBe('MOV-001')
    })
  })

  describe('Purchases Date Filtering', () => {
    it('filters date-only and ISO timestamp purchase dates identically', () => {
      const purchaseDateOnly = '2026-11-08'
      const purchaseTimestamp = '2026-11-08T07:00:00.000Z'

      expect(isWithinBusinessDateRange(purchaseDateOnly, '2026-11-08', '2026-11-08')).toBe(true)
      expect(isWithinBusinessDateRange(purchaseTimestamp, '2026-11-08', '2026-11-08')).toBe(true)
    })
  })

  describe('Reports Date Filtering & Comparison', () => {
    it('applies dateInRange to report datasets accurately', () => {
      const range = { from: '2026-11-01', to: '2026-11-08' }
      // Timestamp at 22:00 PKT on Nov 8 (17:00 UTC)
      expect(dateInRange('2026-11-08T17:00:00.000Z', range)).toBe(true)
      // Timestamp on Nov 9
      expect(dateInRange('2026-11-09T05:00:00.000Z', range)).toBe(false)
    })

    it('calculates previous-period comparison range correctly', () => {
      const range = { from: '2026-11-01', to: '2026-11-08' } // 8 days
      const comparison = getComparisonRange(range, 'previous-period')
      expect(comparison).toBeDefined()
      expect(comparison?.to).toBe('2026-10-31')
      expect(comparison?.from).toBe('2026-10-24')
    })

    it('calculates previous-month comparison range correctly', () => {
      const range = { from: '2026-11-01', to: '2026-11-08' }
      const comparison = getComparisonRange(range, 'previous-month')
      expect(comparison).toBeDefined()
      expect(comparison?.from).toBe('2026-10-01')
      expect(comparison?.to).toBe('2026-10-08')
    })
  })
})
