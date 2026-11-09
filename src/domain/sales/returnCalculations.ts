/**
 * Pure business calculation utilities for Sales Voids, Returns, Refunds,
 * and Purchase Order Cancellations.
 */

export interface VoidCheckTarget {
  status: string
  createdAt: string
  totalAmountMinor: number
  amountPaidMinor: number
}

export interface PurchaseCancelTarget {
  status: string
  receivedItemsCount: number
  amountPaidMinor: number
}

/**
 * Checks whether a completed sale can be voided.
 * Voids are restricted to same-day / immediate cashier errors prior to bank settlement.
 */
export function canVoidSale(
  sale: VoidCheckTarget,
  currentTimeIso: string,
  maxVoidHours: number = 24
): { canVoid: boolean; reason?: string } {
  if (sale.status === 'voided') {
    return { canVoid: false, reason: 'Sale is already voided.' }
  }

  if (sale.status === 'returned' || sale.status === 'partially_returned') {
    return { canVoid: false, reason: 'Sale has existing returns; cannot void.' }
  }

  if (sale.status !== 'completed') {
    return { canVoid: false, reason: `Cannot void a sale with status '${sale.status}'.` }
  }

  const createdTime = new Date(sale.createdAt).getTime()
  const currentTime = new Date(currentTimeIso).getTime()

  if (isNaN(createdTime) || isNaN(currentTime)) {
    return { canVoid: false, reason: 'Invalid timestamp provided for void check.' }
  }

  const elapsedHours = (currentTime - createdTime) / (1000 * 60 * 60)
  if (elapsedHours > maxVoidHours) {
    return {
      canVoid: false,
      reason: `Void window expired. Sale is ${Math.round(elapsedHours)} hours old (max allowed: ${maxVoidHours}h). Use return workflow instead.`,
    }
  }

  return { canVoid: true }
}

/**
 * Calculates remaining quantity that can be returned for a sale item.
 */
export function calculateReturnableItemQuantity(
  originalQuantity: number,
  previouslyReturnedQuantity: number
): number {
  const original = Math.max(0, originalQuantity)
  const returned = Math.max(0, previouslyReturnedQuantity)
  return Math.max(0, original - returned)
}

/**
 * Validates a requested return item line against original sold quantity.
 */
export function validateReturnItem(
  originalQuantity: number,
  previouslyReturnedQuantity: number,
  requestedReturnQuantity: number
): { valid: boolean; error?: string } {
  if (!Number.isFinite(requestedReturnQuantity) || requestedReturnQuantity <= 0) {
    return { valid: false, error: 'Return quantity must be greater than zero.' }
  }

  const returnable = calculateReturnableItemQuantity(originalQuantity, previouslyReturnedQuantity)
  if (returnable <= 0) {
    return { valid: false, error: 'All units for this line item have already been returned.' }
  }

  if (requestedReturnQuantity > returnable) {
    return {
      valid: false,
      error: `Requested return quantity (${requestedReturnQuantity}) exceeds returnable quantity (${returnable}).`,
    }
  }

  return { valid: true }
}

/**
 * Calculates the net refund amount in integer paise for a returned item.
 * Prorates any line-item discount previously applied.
 *
 * @param requestedQuantity Quantity being returned
 * @param unitPriceMinor Gross unit price at time of sale
 * @param allocatedDiscountMinor Total line discount in paise
 * @param originalQuantity Total units sold on the original line
 * @returns Net refund in integer minor units (paise)
 */
export function calculateItemRefundAmount(
  requestedQuantity: number,
  unitPriceMinor: number,
  allocatedDiscountMinor: number,
  originalQuantity: number
): number {
  if (requestedQuantity <= 0 || originalQuantity <= 0) return 0

  const safePrice = Math.max(0, Math.round(unitPriceMinor))
  const safeDiscount = Math.max(0, Math.round(allocatedDiscountMinor))

  // Net revenue originally paid for the entire line
  const netLineRevenue = Math.max(0, originalQuantity * safePrice - safeDiscount)

  // Net refund per unit
  const netUnitRefund = netLineRevenue / originalQuantity

  return Math.round(requestedQuantity * netUnitRefund)
}

/**
 * Validates whether a purchase order is eligible for direct cancellation.
 * Purchase orders cannot be cancelled once goods are received or payments allocated.
 */
export function canCancelPurchase(purchase: PurchaseCancelTarget): {
  canCancel: boolean
  reason?: string
} {
  if (purchase.status === 'cancelled') {
    return { canCancel: false, reason: 'Purchase order is already cancelled.' }
  }

  if (purchase.status === 'received') {
    return {
      canCancel: false,
      reason: 'Purchase order is already fully received. Use purchase return workflow instead.',
    }
  }

  if (purchase.receivedItemsCount > 0) {
    return {
      canCancel: false,
      reason: 'Goods have already been received for this purchase. Cannot cancel directly.',
    }
  }

  if (purchase.amountPaidMinor > 0) {
    return {
      canCancel: false,
      reason: 'Payments have been allocated to this purchase. Reallocate or refund payments before cancellation.',
    }
  }

  return { canCancel: true }
}

