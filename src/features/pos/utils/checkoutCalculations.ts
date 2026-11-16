import type { Product } from '../../products/types/product.types'
import { toMinorUnits, toMajorUnits, calculatePercentageDiscountPaise } from '../../../domain/money/moneyUtils'

export function money(value: number): number {
  return toMajorUnits(toMinorUnits(value))
}

export function subtotal(products: Product[], quantities: Record<string, number>): number {
  const sumMinor = products.reduce(
    (sum, p) => sum + Math.round((quantities[p.id] ?? 0) * toMinorUnits(p.sellingPrice)),
    0
  )
  return toMajorUnits(sumMinor)
}

export function discountAmount(base: number, type: 'fixed' | 'percent', value: number): number {
  if (!Number.isFinite(value) || value < 0) throw Error('Discount cannot be negative.')
  if (type === 'percent' && value > 100) throw Error('Percentage discount must be from 0 to 100.')
  const baseMinor = toMinorUnits(base)
  const discountMinor =
    type === 'percent'
      ? calculatePercentageDiscountPaise(baseMinor, value)
      : toMinorUnits(value)
  if (discountMinor > baseMinor) throw Error('Discount cannot exceed the subtotal.')
  return toMajorUnits(discountMinor)
}

export function taxAmount(
  netBase: number,
  taxRatePercent: number,
  taxInclusive = false
): number {
  if (!Number.isFinite(netBase) || netBase <= 0) return 0
  if (!Number.isFinite(taxRatePercent) || taxRatePercent <= 0) return 0
  const netMinor = toMinorUnits(netBase)
  const rateBps = Math.round((taxRatePercent + Number.EPSILON) * 100)
  const computedMinor = taxInclusive
    ? Math.round((netMinor * rateBps) / (10000 + rateBps))
    : Math.round((netMinor * rateBps) / 10000)
  return toMajorUnits(computedMinor)
}

export function orderTotal(
  base: number,
  discount: number,
  tax = 0,
  taxInclusive = false
): number {
  const baseMinor = toMinorUnits(base)
  const discountMinor = toMinorUnits(discount)
  const taxMinor = taxInclusive ? 0 : toMinorUnits(tax)
  return toMajorUnits(Math.max(0, baseMinor - discountMinor + taxMinor))
}
