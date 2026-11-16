import { HttpError } from './errors'

export const DISCRETE_UNITS = new Set([
  'piece',
  'box',
  'pack',
  'dozen',
])

export const CONTINUOUS_UNITS = new Set([
  'kg',
  'gram',
  'liter',
  'meter',
])

/**
 * Validates that a quantity conforms to unit precision rules:
 * - Discrete units ('piece', 'box', 'pack', 'dozen') must be strict positive integers.
 * - Continuous units ('kg', 'gram', 'liter', 'meter') may have up to 3 decimal places (scale 1000).
 */
export function validateQuantityByUnit(quantity: number, unit: string, fieldName = 'quantity'): number {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
    throw HttpError.badRequest(`${fieldName} must be a positive number.`, { field: fieldName })
  }

  if (DISCRETE_UNITS.has(unit)) {
    if (!Number.isInteger(quantity)) {
      throw HttpError.badRequest(
        `Quantity for unit '${unit}' must be a whole integer without decimals.`,
        { field: fieldName, unit, quantity }
      )
    }
  } else if (CONTINUOUS_UNITS.has(unit)) {
    // Max 3 decimal places
    const scaled = Math.round(quantity * 1000)
    if (Math.abs(scaled / 1000 - quantity) > 1e-6) {
      throw HttpError.badRequest(
        `Quantity for unit '${unit}' allows at most 3 decimal places (e.g. 1.250).`,
        { field: fieldName, unit, quantity }
      )
    }
  }

  return quantity
}

/**
 * Converts a major currency number (e.g. 10.50 PKR) into integer minor units (paise)
 * without binary float precision drift.
 */
export function toMinorUnits(amountMajor: number): number {
  if (typeof amountMajor !== 'number' || !Number.isFinite(amountMajor)) {
    return 0
  }
  const fixed = amountMajor.toFixed(6)
  const negative = fixed.startsWith('-')
  const unsigned = negative ? fixed.slice(1) : fixed
  const [wholePart = '0', fracPart = ''] = unsigned.split('.')
  const padded = `${fracPart}000000`
  const twoDigits = padded.slice(0, 2)
  const nextDigit = parseInt(padded[2] || '0', 10)
  let minor = parseInt(wholePart, 10) * 100 + parseInt(twoDigits, 10)
  if (nextDigit >= 5) {
    minor += 1
  }
  return negative ? -minor : minor
}

/**
 * Converts a percentage value (e.g. 16.5 -> 1650) into integer basis points (100 bps = 1%).
 */
export function bpsFromPercent(percent: number): number {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) {
    return 0
  }
  return Math.round((percent + Number.EPSILON) * 100)
}

/**
 * Calculates line subtotal in integer minor units (paise).
 * subtotalMinor = round(quantity * unitPriceMinor)
 */
export function calculateLineSubtotalMinor(quantity: number, unitPriceMinor: number): number {
  if (quantity <= 0 || unitPriceMinor < 0) return 0
  return Math.round(quantity * unitPriceMinor)
}

/**
 * Proportionally distributes an integer order discount across line weights
 * using largest-remainder rounding so the distributed sum equals totalDiscountMinor exactly.
 */
export function distributeDiscountProportionalMinor(
  weightsMinor: number[],
  totalDiscountMinor: number
): number[] {
  if (weightsMinor.length === 0) return []
  if (!Number.isFinite(totalDiscountMinor) || totalDiscountMinor <= 0) {
    return weightsMinor.map(() => 0)
  }

  const sanitizedWeights = weightsMinor.map((w) => Math.max(0, Math.round(w)))
  const totalWeight = sanitizedWeights.reduce((sum, w) => sum + w, 0)
  if (totalWeight <= 0) {
    return weightsMinor.map(() => 0)
  }

  const targetDiscount = Math.min(Math.round(totalDiscountMinor), totalWeight)
  const distributed: number[] = []
  let allocated = 0

  for (let i = 0; i < sanitizedWeights.length; i++) {
    const share = Math.floor((sanitizedWeights[i] * targetDiscount) / totalWeight)
    distributed.push(share)
    allocated += share
  }

  let remainder = targetDiscount - allocated
  if (remainder > 0) {
    const remainders = sanitizedWeights
      .map((weight, idx) => ({
        idx,
        fractional: (weight * targetDiscount) / totalWeight - distributed[idx],
      }))
      .sort((a, b) => b.fractional - a.fractional)

    for (let i = 0; i < remainders.length && remainder > 0; i++) {
      distributed[remainders[i].idx] += 1
      remainder -= 1
    }
  }

  return distributed
}

/**
 * Calculates tax in integer minor units using integer basis points.
 * Supports tax-exclusive (tax added on top) and tax-inclusive (tax extracted from price) modes.
 */
export function calculateTaxMinor(
  taxableAmountMinor: number,
  taxRateBps: number,
  taxInclusive = false
): number {
  if (!Number.isFinite(taxableAmountMinor) || taxableAmountMinor <= 0) return 0
  if (!Number.isFinite(taxRateBps) || taxRateBps <= 0) return 0

  if (taxInclusive) {
    return Math.round((taxableAmountMinor * taxRateBps) / (10000 + taxRateBps))
  }
  return Math.round((taxableAmountMinor * taxRateBps) / 10000)
}

/**
 * Calculates order discount in integer minor units without silent clamping bugs.
 */
export function calculateDiscountMinor(
  subtotalMinor: number,
  discountType: 'fixed' | 'percent' = 'fixed',
  discountValue = 0,
  explicitDiscountMinor?: number
): number {
  if (explicitDiscountMinor !== undefined) {
    if (!Number.isInteger(explicitDiscountMinor) || explicitDiscountMinor < 0) {
      throw HttpError.badRequest('discountMinor must be a non-negative integer.', { field: 'discountMinor' })
    }
    if (explicitDiscountMinor > subtotalMinor) {
      throw HttpError.badRequest('Discount cannot exceed subtotal.', { field: 'discountMinor' })
    }
    return explicitDiscountMinor
  }

  if (typeof discountValue !== 'number' || !Number.isFinite(discountValue) || discountValue < 0) {
    throw HttpError.badRequest('discountValue must be a non-negative number.', { field: 'discountValue' })
  }

  if (discountValue === 0) {
    return 0
  }

  if (subtotalMinor <= 0) {
    throw HttpError.badRequest('Discount cannot exceed subtotal.', { field: 'discountValue' })
  }

  if (discountType === 'fixed') {
    const fixedMinor = toMinorUnits(discountValue)
    if (fixedMinor > subtotalMinor) {
      throw HttpError.badRequest('Discount cannot exceed subtotal.', { field: 'discountValue' })
    }
    return fixedMinor
  }

  if (discountType === 'percent') {
    if (discountValue > 100) {
      throw HttpError.badRequest('Percentage discount must be between 0 and 100.', { field: 'discountValue' })
    }
    const discountBps = bpsFromPercent(discountValue)
    return Math.round((subtotalMinor * discountBps) / 10000)
  }

  return 0
}

