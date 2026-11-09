/**
 * Pure monetary calculation utilities for POS domain.
 * Operates on integer minor units (paise) to prevent IEEE 754 floating point drift.
 * 1 PKR = 100 paise.
 */

/**
 * Converts a major currency value (e.g. 10.50 PKR) to integer minor units (1050 paise).
 * Uses Math.round to safely mitigate floating-point multiplication anomalies.
 */
export function toMinorUnits(amountMajor: number): number {
  if (!Number.isFinite(amountMajor)) {
    return 0
  }
  return Math.round(amountMajor * 100)
}

/**
 * Converts integer minor units (1050 paise) back to major currency (10.50 PKR).
 */
export function toMajorUnits(amountMinor: number): number {
  if (!Number.isFinite(amountMinor)) {
    return 0
  }
  return Math.round(amountMinor) / 100
}

/**
 * Formats minor units (paise) to standard Pakistani Rupee representation.
 * e.g. 2486900 -> "Rs 24,869.00"
 */
export function formatPaiseToPkr(amountMinor: number): string {
  const major = toMajorUnits(amountMinor)
  return `Rs ${major.toLocaleString('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/**
 * Sums an array of integer minor units safely.
 */
export function addPaise(...amounts: number[]): number {
  return amounts.reduce((acc, curr) => {
    const val = Number.isFinite(curr) ? Math.round(curr) : 0
    return acc + val
  }, 0)
}

/**
 * Subtracts subtrahends from a minuend in integer minor units.
 */
export function subtractPaise(minuend: number, ...subtrahends: number[]): number {
  const base = Number.isFinite(minuend) ? Math.round(minuend) : 0
  const subTotal = addPaise(...subtrahends)
  return base - subTotal
}

/**
 * Calculates a percentage discount in integer minor units.
 * Applies standard half-up rounding.
 * e.g., 1000 paise with 10% discount -> 100 paise.
 */
export function calculatePercentageDiscountPaise(baseAmountMinor: number, percentage: number): number {
  if (!Number.isFinite(baseAmountMinor) || baseAmountMinor <= 0) return 0
  if (!Number.isFinite(percentage) || percentage <= 0) return 0
  if (percentage >= 100) return Math.round(baseAmountMinor)

  return Math.round((baseAmountMinor * percentage) / 100)
}

/**
 * Proportionally distributes a header discount across line item totals.
 * Ensures the sum of item discounts strictly matches totalDiscountMinor with 0 remainder.
 *
 * @param itemTotalsMinor Array of line item totals in paise.
 * @param totalDiscountMinor Cart-level discount in paise to distribute.
 * @returns Array of discount amounts per line item in paise.
 */
export function distributeDiscountPaise(itemTotalsMinor: number[], totalDiscountMinor: number): number[] {
  if (itemTotalsMinor.length === 0) return []
  if (!Number.isFinite(totalDiscountMinor) || totalDiscountMinor <= 0) {
    return itemTotalsMinor.map(() => 0)
  }

  const subtotal = itemTotalsMinor.reduce((sum, val) => sum + Math.max(0, Math.round(val)), 0)
  if (subtotal <= 0) {
    return itemTotalsMinor.map(() => 0)
  }

  // Cap discount at subtotal
  const effectiveDiscount = Math.min(Math.round(totalDiscountMinor), subtotal)

  // Initial proportional calculation using floor
  const distributed: number[] = []
  let sumDistributed = 0

  for (let i = 0; i < itemTotalsMinor.length; i++) {
    const itemTotal = Math.max(0, Math.round(itemTotalsMinor[i]))
    const itemShare = Math.floor((itemTotal * effectiveDiscount) / subtotal)
    distributed.push(itemShare)
    sumDistributed += itemShare
  }

  // Distribute remaining pennies (due to floor) to items with the largest fractional part
  let remainder = effectiveDiscount - sumDistributed
  if (remainder > 0) {
    // Sort indices by fractional remainder descending
    const fractionalRemainders = itemTotalsMinor.map((itemTotal, idx) => {
      const validTotal = Math.max(0, Math.round(itemTotal))
      const exact = (validTotal * effectiveDiscount) / subtotal
      return { idx, remainder: exact - distributed[idx] }
    })

    fractionalRemainders.sort((a, b) => b.remainder - a.remainder)

    for (let i = 0; i < fractionalRemainders.length && remainder > 0; i++) {
      const targetIdx = fractionalRemainders[i].idx
      distributed[targetIdx] += 1
      remainder -= 1
    }
  }

  return distributed
}

/**
 * Calculates sales tax in integer minor units from a taxable base and tax rate percentage.
 */
export function calculateTaxPaise(taxableAmountMinor: number, taxRatePercent: number): number {
  if (!Number.isFinite(taxableAmountMinor) || taxableAmountMinor <= 0) return 0
  if (!Number.isFinite(taxRatePercent) || taxRatePercent <= 0) return 0

  return Math.round((taxableAmountMinor * taxRatePercent) / 100)
}

