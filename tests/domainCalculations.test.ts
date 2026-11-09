import { describe, it, expect } from 'vitest'
import {
  toMinorUnits,
  toMajorUnits,
  formatPaiseToPkr,
  addPaise,
  subtractPaise,
  calculatePercentageDiscountPaise,
  distributeDiscountPaise,
  calculateTaxPaise,
} from '../src/domain/money/moneyUtils'
import {
  isDiscreteUnit,
  validateQuantityForUnit,
  roundQuantity,
  calculateMovingWeightedAverageCost,
  calculateSaleCogs,
} from '../src/domain/inventory/costingUtils'
import {
  calculateCustomerBalances,
  calculateSupplierBalances,
  allocatePayment,
} from '../src/domain/ledger/allocationUtils'
import {
  canVoidSale,
  calculateReturnableItemQuantity,
  validateReturnItem,
  calculateItemRefundAmount,
  canCancelPurchase,
} from '../src/domain/sales/returnCalculations'

describe('Domain Calculations — Money & Precision Utilities', () => {
  it('converts major to minor units without IEEE 754 precision loss', () => {
    expect(toMinorUnits(10.5)).toBe(1050)
    expect(toMinorUnits(19.99)).toBe(1999)
    expect(toMinorUnits(0.1 + 0.2)).toBe(30) // Mitigates 0.30000000000000004
    expect(toMinorUnits(0)).toBe(0)
    expect(toMinorUnits(NaN)).toBe(0)
  })

  it('converts minor units back to major units', () => {
    expect(toMajorUnits(1050)).toBe(10.5)
    expect(toMajorUnits(1999)).toBe(19.99)
    expect(toMajorUnits(0)).toBe(0)
  })

  it('formats minor units as Pakistani Rupee string', () => {
    expect(formatPaiseToPkr(2486900)).toBe('Rs 24,869.00')
    expect(formatPaiseToPkr(1050)).toBe('Rs 10.50')
  })

  it('adds and subtracts paise safely', () => {
    expect(addPaise(100, 250, 50)).toBe(400)
    expect(subtractPaise(1000, 200, 300)).toBe(500)
  })

  it('calculates percentage discount in paise with rounding', () => {
    // 10% of 1000 paise = 100 paise
    expect(calculatePercentageDiscountPaise(1000, 10)).toBe(100)
    // 15% of 999 paise = 149.85 -> 150 paise
    expect(calculatePercentageDiscountPaise(999, 15)).toBe(150)
    // 0% discount
    expect(calculatePercentageDiscountPaise(500, 0)).toBe(0)
    // 100% discount
    expect(calculatePercentageDiscountPaise(500, 100)).toBe(500)
  })

  it('distributes cart discount across items with guaranteed zero penny remainder', () => {
    // 3 items: 1000, 2000, 3000 (total = 6000). Total discount = 1000.
    const items = [1000, 2000, 3000]
    const distributed = distributeDiscountPaise(items, 1000)

    expect(distributed.length).toBe(3)
    const sum = distributed.reduce((a, b) => a + b, 0)
    expect(sum).toBe(1000)

    // Check odd split where floor leaves remainder
    // e.g. 3 items with 333, 333, 334 (total = 1000), discount = 100
    const oddItems = [333, 333, 334]
    const oddDistributed = distributeDiscountPaise(oddItems, 100)
    const oddSum = oddDistributed.reduce((a, b) => a + b, 0)
    expect(oddSum).toBe(100)
  })

  it('calculates tax paise safely', () => {
    // 1000 paise with 17% tax -> 170 paise
    expect(calculateTaxPaise(1000, 17)).toBe(170)
  })
})

describe('Domain Calculations — Inventory Costing & Unit Precision', () => {
  it('correctly classifies discrete vs continuous units', () => {
    expect(isDiscreteUnit('piece')).toBe(true)
    expect(isDiscreteUnit('box')).toBe(true)
    expect(isDiscreteUnit('pack')).toBe(true)
    expect(isDiscreteUnit('dozen')).toBe(true)
    expect(isDiscreteUnit('kg')).toBe(false)
    expect(isDiscreteUnit('liter')).toBe(false)
    expect(isDiscreteUnit('meter')).toBe(false)
    expect(isDiscreteUnit('gram')).toBe(false)
  })

  it('validates discrete units must be integers', () => {
    expect(validateQuantityForUnit(5, 'piece').valid).toBe(true)
    const invalidDiscrete = validateQuantityForUnit(2.5, 'piece')
    expect(invalidDiscrete.valid).toBe(false)
    expect(invalidDiscrete.error).toContain('whole integer quantity')
  })

  it('validates continuous units allow up to 3 decimals', () => {
    expect(validateQuantityForUnit(1.245, 'kg').valid).toBe(true)
    expect(validateQuantityForUnit(0.001, 'kg').valid).toBe(true)
    const invalidContinuous = validateQuantityForUnit(1.2345, 'kg')
    expect(invalidContinuous.valid).toBe(false)
    expect(invalidContinuous.error).toContain('allows at most 3 decimal places')
  })

  it('rejects zero or negative quantities when not allowed', () => {
    expect(validateQuantityForUnit(0, 'piece').valid).toBe(false)
    expect(validateQuantityForUnit(-3, 'kg').valid).toBe(false)
    expect(validateQuantityForUnit(0, 'piece', true).valid).toBe(true)
  })

  it('rounds quantities appropriately', () => {
    expect(roundQuantity(3.7, 'piece')).toBe(4)
    expect(roundQuantity(1.23456, 'kg')).toBe(1.235)
  })

  it('calculates perpetual moving weighted average cost accurately', () => {
    // Current: 10 units @ 1000 paise (Rs 10.00). Valuation = 10,000 paise.
    // Received: 10 units @ 2000 paise (Rs 20.00). Valuation = 20,000 paise.
    // Total = 30,000 / 20 = 1500 paise (Rs 15.00).
    const newCost = calculateMovingWeightedAverageCost(10, 1000, 10, 2000)
    expect(newCost).toBe(1500)

    // Current: 0 units. Received: 50 units @ 4500 paise.
    // New cost should equal received cost.
    expect(calculateMovingWeightedAverageCost(0, 1000, 50, 4500)).toBe(4500)

    // No incoming units: retains current cost
    expect(calculateMovingWeightedAverageCost(20, 1200, 0, 1500)).toBe(1200)
  })

  it('calculates locked sale COGS', () => {
    // 5 units sold with snapshot cost 1500 paise -> 7500 paise
    expect(calculateSaleCogs(5, 1500)).toBe(7500)
  })
})

describe('Domain Calculations — Ledger & Payment Allocation', () => {
  it('calculates customer balances with outstanding debt', () => {
    const openingReceivable = 5000 // Rs 50.00
    const entries = [
      { debitMinor: 10000, creditMinor: 0 }, // Invoice 1: Rs 100
      { debitMinor: 5000, creditMinor: 0 },  // Invoice 2: Rs 50
      { debitMinor: 0, creditMinor: 12000 }, // Payment: Rs 120
    ]

    const result = calculateCustomerBalances(openingReceivable, entries)
    // Net = 5000 + 15000 - 12000 = 8000 paise
    expect(result.totalDebitsMinor).toBe(15000)
    expect(result.totalCreditsMinor).toBe(12000)
    expect(result.outstandingReceivableMinor).toBe(8000)
    expect(result.advanceBalanceMinor).toBe(0)
    expect(result.netBalanceMinor).toBe(8000)
  })

  it('calculates customer balances with customer advance', () => {
    const openingReceivable = 0
    const entries = [
      { debitMinor: 5000, creditMinor: 0 },  // Invoice: Rs 50
      { debitMinor: 0, creditMinor: 8000 },  // Payment: Rs 80
    ]

    const result = calculateCustomerBalances(openingReceivable, entries)
    // Net = 5000 - 8000 = -3000 paise (Customer advance of 3000)
    expect(result.outstandingReceivableMinor).toBe(0)
    expect(result.advanceBalanceMinor).toBe(3000)
    expect(result.netBalanceMinor).toBe(-3000)
  })

  it('calculates supplier balances with outstanding payable and advances', () => {
    const openingPayable = 20000 // Rs 200
    const entries = [
      { debitMinor: 0, creditMinor: 50000 }, // Bill: Rs 500
      { debitMinor: 40000, creditMinor: 0 }, // Payment: Rs 400
    ]

    const result = calculateSupplierBalances(openingPayable, entries)
    // Net = 20000 + 50000 - 40000 = 30000 paise
    expect(result.outstandingPayableMinor).toBe(30000)
    expect(result.advanceBalanceMinor).toBe(0)

    // If overpaid:
    const overpaidEntries = [
      { debitMinor: 0, creditMinor: 10000 }, // Bill: Rs 100
      { debitMinor: 15000, creditMinor: 0 }, // Payment: Rs 150
    ]
    const overpaidResult = calculateSupplierBalances(0, overpaidEntries)
    expect(overpaidResult.outstandingPayableMinor).toBe(0)
    expect(overpaidResult.advanceBalanceMinor).toBe(5000)
  })

  it('allocates payment across outstanding invoices sequentially', () => {
    const targets = [
      { id: 'inv-1', outstandingMinor: 3000 },
      { id: 'inv-2', outstandingMinor: 5000 },
      { id: 'inv-3', outstandingMinor: 2000 },
    ]

    // Settle 6000 paise:
    // Should fully satisfy inv-1 (3000), partially satisfy inv-2 (3000), 0 for inv-3
    const result = allocatePayment(6000, targets)
    expect(result.allocations).toEqual([
      { targetId: 'inv-1', allocatedMinor: 3000 },
      { targetId: 'inv-2', allocatedMinor: 3000 },
    ])
    expect(result.unallocatedMinor).toBe(0)
    expect(result.totalAllocatedMinor).toBe(6000)

    // Overpayment: 12000 paise against 10000 total outstanding
    const overpayment = allocatePayment(12000, targets)
    expect(overpayment.allocations.length).toBe(3)
    expect(overpayment.totalAllocatedMinor).toBe(10000)
    expect(overpayment.unallocatedMinor).toBe(2000) // Rs 20 advance
  })
})

describe('Domain Calculations — Returns, Voids & Cancellation Protocol', () => {
  it('validates void eligibility within allowed time window', () => {
    const now = '2026-11-08T15:00:00.000Z'
    const recentSale = {
      status: 'completed',
      createdAt: '2026-11-08T14:00:00.000Z', // 1 hour ago
      totalAmountMinor: 5000,
      amountPaidMinor: 5000,
    }

    const check1 = canVoidSale(recentSale, now, 24)
    expect(check1.canVoid).toBe(true)

    // Expired sale (26 hours ago)
    const oldSale = {
      status: 'completed',
      createdAt: '2026-11-07T12:00:00.000Z',
      totalAmountMinor: 5000,
      amountPaidMinor: 5000,
    }
    const check2 = canVoidSale(oldSale, now, 24)
    expect(check2.canVoid).toBe(false)
    expect(check2.reason).toContain('Void window expired')

    // Already returned sale
    const returnedSale = { ...recentSale, status: 'returned' }
    const check3 = canVoidSale(returnedSale, now, 24)
    expect(check3.canVoid).toBe(false)
    expect(check3.reason).toContain('existing returns')
  })

  it('validates returnable quantities and prevents over-returns', () => {
    expect(calculateReturnableItemQuantity(10, 3)).toBe(7)
    expect(calculateReturnableItemQuantity(5, 5)).toBe(0)

    const validCheck = validateReturnItem(10, 3, 5)
    expect(validCheck.valid).toBe(true)

    const excessiveCheck = validateReturnItem(10, 3, 8) // only 7 left
    expect(excessiveCheck.valid).toBe(false)
    expect(excessiveCheck.error).toContain('exceeds returnable quantity')

    const zeroLeftCheck = validateReturnItem(5, 5, 1)
    expect(zeroLeftCheck.valid).toBe(false)
    expect(zeroLeftCheck.error).toContain('already been returned')
  })

  it('calculates net item refund proration accurately', () => {
    // Sold 2 units @ 1000 paise each = 2000 paise gross.
    // Applied 200 paise discount. Net line revenue = 1800 paise.
    // Net price per unit = 900 paise.
    // Returning 1 unit should refund exactly 900 paise.
    const refund = calculateItemRefundAmount(1, 1000, 200, 2)
    expect(refund).toBe(900)

    // Returning 2 units refunds full 1800 paise.
    const fullRefund = calculateItemRefundAmount(2, 1000, 200, 2)
    expect(fullRefund).toBe(1800)
  })

  it('governs purchase order cancellation eligibility', () => {
    // Draft or ordered PO with 0 receipts and 0 payments can be cancelled
    const cleanPo = {
      status: 'ordered',
      receivedItemsCount: 0,
      amountPaidMinor: 0,
    }
    expect(canCancelPurchase(cleanPo).canCancel).toBe(true)

    // PO with received goods cannot be cancelled
    const receivedPo = {
      status: 'partially_received',
      receivedItemsCount: 3,
      amountPaidMinor: 0,
    }
    const checkReceived = canCancelPurchase(receivedPo)
    expect(checkReceived.canCancel).toBe(false)
    expect(checkReceived.reason).toContain('Goods have already been received')

    // PO with payments allocated cannot be cancelled directly
    const paidPo = {
      status: 'ordered',
      receivedItemsCount: 0,
      amountPaidMinor: 15000,
    }
    const checkPaid = canCancelPurchase(paidPo)
    expect(checkPaid.canCancel).toBe(false)
    expect(checkPaid.reason).toContain('Payments have been allocated')
  })
})

