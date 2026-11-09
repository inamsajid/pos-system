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
 * Calculates line subtotal in integer minor units (paise).
 * subtotalMinor = round(quantity * unitPriceMinor)
 */
export function calculateLineSubtotalMinor(quantity: number, unitPriceMinor: number): number {
  if (quantity <= 0 || unitPriceMinor < 0) return 0
  return Math.round(quantity * unitPriceMinor)
}

/**
 * Calculates order discount in minor units.
 */
export function calculateDiscountMinor(
  subtotalMinor: number,
  discountType: 'fixed' | 'percent' = 'fixed',
  discountValue = 0
): number {
  if (discountValue <= 0 || subtotalMinor <= 0) {
    return 0
  }

  if (discountType === 'fixed') {
    // discountValue is in major units (PKR) or already minor?
    // Let's support both major and minor input safely
    const fixedMinor = Math.round(discountValue * 100)
    return Math.min(subtotalMinor, fixedMinor)
  }

  if (discountType === 'percent') {
    const clampedPercent = Math.min(100, Math.max(0, discountValue))
    return Math.round((subtotalMinor * clampedPercent) / 100)
  }

  return 0
}

