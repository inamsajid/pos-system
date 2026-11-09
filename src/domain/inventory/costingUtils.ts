import type { ProductUnit } from '../../features/products/types/product.types'

/**
 * Pure inventory costing and unit precision utilities.
 * Implements Perpetual Moving Weighted Average (MWA) valuation.
 */

const DISCRETE_UNITS: ReadonlySet<ProductUnit> = new Set([
  'piece',
  'box',
  'pack',
  'dozen',
])

/**
 * Checks if a product unit is discrete (whole counts only).
 */
export function isDiscreteUnit(unit: ProductUnit): boolean {
  return DISCRETE_UNITS.has(unit)
}

/**
 * Validates a quantity according to its unit type.
 * - Discrete units must be positive integers.
 * - Continuous units allow up to 3 decimal places (scale 1000).
 */
export function validateQuantityForUnit(
  quantity: number,
  unit: ProductUnit,
  allowZero: boolean = false
): { valid: boolean; error?: string } {
  if (!Number.isFinite(quantity)) {
    return { valid: false, error: 'Quantity must be a finite number.' }
  }

  if (allowZero ? quantity < 0 : quantity <= 0) {
    return {
      valid: false,
      error: allowZero
        ? 'Quantity cannot be negative.'
        : 'Quantity must be greater than zero.',
    }
  }

  if (isDiscreteUnit(unit)) {
    if (!Number.isInteger(quantity)) {
      return {
        valid: false,
        error: `Unit '${unit}' requires a whole integer quantity. Received: ${quantity}`,
      }
    }
  } else {
    // Continuous unit: verify max 3 decimal places
    const scaled = quantity * 1000
    if (Math.abs(scaled - Math.round(scaled)) > 1e-5) {
      return {
        valid: false,
        error: `Unit '${unit}' allows at most 3 decimal places (scale 1000). Received: ${quantity}`,
      }
    }
  }

  return { valid: true }
}

/**
 * Rounds a quantity according to the unit standard.
 */
export function roundQuantity(quantity: number, unit: ProductUnit): number {
  if (!Number.isFinite(quantity)) return 0
  if (isDiscreteUnit(unit)) {
    return Math.round(quantity)
  }
  return Math.round(quantity * 1000) / 1000
}

/**
 * Computes the updated Perpetual Moving Weighted Average (MWA) unit cost
 * upon physical inventory receiving.
 *
 * Formula:
 * New Cost = ((CurrentQty * CurrentCost) + (ReceivedQty * ReceivedCost)) / (CurrentQty + ReceivedQty)
 *
 * @param currentQuantity Sellable quantity before receipt
 * @param currentUnitCostMinor Pre-receipt moving unit cost in paise
 * @param receivedQuantity Quantity being received
 * @param receivedUnitCostMinor Net unit purchase cost on incoming invoice in paise
 * @returns Updated moving unit cost in paise (integer)
 */
export function calculateMovingWeightedAverageCost(
  currentQuantity: number,
  currentUnitCostMinor: number,
  receivedQuantity: number,
  receivedUnitCostMinor: number
): number {
  const safeCurrentQty = Math.max(0, currentQuantity)
  const safeReceivedQty = Math.max(0, receivedQuantity)
  const safeReceivedCost = Math.max(0, Math.round(receivedUnitCostMinor))
  const safeCurrentCost = Math.max(0, Math.round(currentUnitCostMinor))

  // If no incoming stock, cost does not change
  if (safeReceivedQty === 0) {
    return safeCurrentCost
  }

  // If previous stock was zero or negative, incoming cost becomes the new base
  if (safeCurrentQty <= 0) {
    return safeReceivedCost
  }

  const totalQuantity = safeCurrentQty + safeReceivedQty
  if (totalQuantity <= 0) {
    return safeCurrentCost
  }

  const currentValuation = safeCurrentQty * safeCurrentCost
  const receivedValuation = safeReceivedQty * safeReceivedCost
  const totalValuation = currentValuation + receivedValuation

  return Math.round(totalValuation / totalQuantity)
}

/**
 * Computes Cost of Goods Sold (COGS) for a sale line item, locked at checkout.
 *
 * @param quantitySold Number of units sold
 * @param unitCostMinor Snapshot moving average unit cost in paise
 * @returns Total line COGS in integer paise
 */
export function calculateSaleCogs(quantitySold: number, unitCostMinor: number): number {
  if (!Number.isFinite(quantitySold) || quantitySold <= 0) return 0
  if (!Number.isFinite(unitCostMinor) || unitCostMinor <= 0) return 0

  return Math.round(quantitySold * unitCostMinor)
}

