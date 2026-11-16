import { HttpError } from '../../lib/errors'
import { toMinorUnits } from '../../lib/money'
import type {
  CreateSaleInput,
  CreateSaleItemInput,
  CreateSalePaymentInput,
  PaymentMethodType,
  SaleDiscountType,
  SaleFilterParams,
  SaleStatus,
} from './sales.types'

const ALLOWED_PAYMENT_METHODS: readonly PaymentMethodType[] = [
  'cash',
  'card',
  'bank_transfer',
  'digital_wallet',
  'other',
  'credit',
]

export function validateCreateSaleInput(input: unknown): CreateSaleInput {
  if (!input || typeof input !== 'object') {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const raw = input as Record<string, unknown>

  // Items (required, at least 1)
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    throw HttpError.badRequest('Sale must contain at least one item.', { field: 'items' })
  }

  const validatedItems: CreateSaleItemInput[] = []
  for (let i = 0; i < raw.items.length; i++) {
    const rawItem = raw.items[i]
    if (!rawItem || typeof rawItem !== 'object') {
      throw HttpError.badRequest(`Item at index ${i} must be an object.`, { field: `items[${i}]` })
    }
    const item = rawItem as Record<string, unknown>

    if (typeof item.productId !== 'string' || !item.productId.trim()) {
      throw HttpError.badRequest(`Item at index ${i} requires a valid productId.`, {
        field: `items[${i}].productId`,
      })
    }

    if (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw HttpError.badRequest(`Item at index ${i} quantity must be a positive number.`, {
        field: `items[${i}].quantity`,
      })
    }

    let unitPriceMinor: number | undefined
    if (item.unitPriceMinor !== undefined && item.unitPriceMinor !== null) {
      if (
        typeof item.unitPriceMinor !== 'number' ||
        !Number.isInteger(item.unitPriceMinor) ||
        item.unitPriceMinor < 0
      ) {
        throw HttpError.badRequest(`Item at index ${i} unitPriceMinor must be a non-negative integer.`, {
          field: `items[${i}].unitPriceMinor`,
        })
      }
      unitPriceMinor = item.unitPriceMinor
    } else if (item.unitPrice !== undefined && item.unitPrice !== null) {
      if (typeof item.unitPrice !== 'number' || !Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
        throw HttpError.badRequest(`Item at index ${i} unitPrice must be a non-negative number.`, {
          field: `items[${i}].unitPrice`,
        })
      }
      unitPriceMinor = toMinorUnits(item.unitPrice)
    }

    let discountMinor: number | undefined
    if (item.discountMinor !== undefined && item.discountMinor !== null) {
      if (typeof item.discountMinor !== 'number' || !Number.isInteger(item.discountMinor) || item.discountMinor < 0) {
        throw HttpError.badRequest(`Item at index ${i} discountMinor must be a non-negative integer.`, {
          field: `items[${i}].discountMinor`,
        })
      }
      discountMinor = item.discountMinor
    }

    let taxMinor: number | undefined
    if (item.taxMinor !== undefined && item.taxMinor !== null) {
      if (typeof item.taxMinor !== 'number' || !Number.isInteger(item.taxMinor) || item.taxMinor < 0) {
        throw HttpError.badRequest(`Item at index ${i} taxMinor must be a non-negative integer.`, {
          field: `items[${i}].taxMinor`,
        })
      }
      taxMinor = item.taxMinor
    }

    const overrideReason =
      typeof item.overrideReason === 'string' && item.overrideReason.trim()
        ? item.overrideReason.trim()
        : undefined
    const taxOverride = typeof item.taxOverride === 'boolean' ? item.taxOverride : undefined

    validatedItems.push({
      productId: item.productId.trim(),
      quantity: item.quantity,
      unitPriceMinor,
      discountMinor,
      taxMinor,
      overrideReason,
      taxOverride,
    })
  }

  // Customer ID (optional)
  let customerId: string | undefined
  if (raw.customerId !== undefined && raw.customerId !== null && String(raw.customerId).trim()) {
    if (typeof raw.customerId !== 'string') {
      throw HttpError.badRequest('customerId must be a string.', { field: 'customerId' })
    }
    customerId = raw.customerId.trim()
  }

  // Discount
  let discountType: SaleDiscountType = 'fixed'
  if (raw.discountType !== undefined && raw.discountType !== null) {
    if (raw.discountType !== 'fixed' && raw.discountType !== 'percent') {
      throw HttpError.badRequest("discountType must be either 'fixed' or 'percent'.", { field: 'discountType' })
    }
    discountType = raw.discountType as SaleDiscountType
  }

  let discountValue = 0
  if (raw.discountValue !== undefined && raw.discountValue !== null) {
    if (typeof raw.discountValue !== 'number' || !Number.isFinite(raw.discountValue) || raw.discountValue < 0) {
      throw HttpError.badRequest('discountValue must be a non-negative number.', { field: 'discountValue' })
    }
    if (discountType === 'percent' && raw.discountValue > 100) {
      throw HttpError.badRequest('Percentage discount must be between 0 and 100.', { field: 'discountValue' })
    }
    discountValue = raw.discountValue
  }

  let discountMinor: number | undefined
  if (raw.discountMinor !== undefined && raw.discountMinor !== null) {
    if (typeof raw.discountMinor !== 'number' || !Number.isInteger(raw.discountMinor) || raw.discountMinor < 0) {
      throw HttpError.badRequest('discountMinor must be a non-negative integer.', { field: 'discountMinor' })
    }
    discountMinor = raw.discountMinor
    if (discountType === 'fixed' && raw.discountValue === undefined) {
      discountValue = discountMinor / 100
    } else if (
      discountType === 'fixed' &&
      raw.discountValue !== undefined &&
      toMinorUnits(discountValue) !== discountMinor
    ) {
      throw HttpError.badRequest('Fixed discountValue and discountMinor do not match.', { field: 'discountMinor' })
    }
  }

  const orderOverrideReason =
    typeof raw.overrideReason === 'string' && raw.overrideReason.trim()
      ? raw.overrideReason.trim()
      : undefined
  const orderTaxOverride = typeof raw.taxOverride === 'boolean' ? raw.taxOverride : undefined

  // Payments (optional, defaults to empty array / full credit)
  const validatedPayments: CreateSalePaymentInput[] = []
  if (raw.payments !== undefined && raw.payments !== null) {
    if (!Array.isArray(raw.payments)) {
      throw HttpError.badRequest('payments must be an array.', { field: 'payments' })
    }
    for (let j = 0; j < raw.payments.length; j++) {
      const p = raw.payments[j]
      if (!p || typeof p !== 'object') {
        throw HttpError.badRequest(`Payment at index ${j} must be an object.`, { field: `payments[${j}]` })
      }
      const rawP = p as Record<string, unknown>

      let normalizedMethod: string = String(rawP.method || '').toLowerCase().replace('-', '_')
      if (normalizedMethod === 'bank_transfer' || normalizedMethod === 'banktransfer') {
        normalizedMethod = 'bank_transfer'
      } else if (normalizedMethod === 'digital_wallet' || normalizedMethod === 'digitalwallet') {
        normalizedMethod = 'digital_wallet'
      }

      if (!ALLOWED_PAYMENT_METHODS.includes(normalizedMethod as PaymentMethodType)) {
        throw HttpError.badRequest(
          `Payment method must be one of: ${ALLOWED_PAYMENT_METHODS.join(', ')}.`,
          { field: `payments[${j}].method` }
        )
      }

      let amountMinor: number
      if (rawP.amountMinor !== undefined && rawP.amountMinor !== null) {
        if (typeof rawP.amountMinor !== 'number' || !Number.isInteger(rawP.amountMinor) || rawP.amountMinor < 0) {
          throw HttpError.badRequest(`Payment amountMinor at index ${j} must be a non-negative integer.`, {
            field: `payments[${j}].amountMinor`,
          })
        }
        amountMinor = rawP.amountMinor
      } else if (rawP.amount !== undefined && rawP.amount !== null) {
        if (typeof rawP.amount !== 'number' || !Number.isFinite(rawP.amount) || rawP.amount < 0) {
          throw HttpError.badRequest(`Payment amount at index ${j} must be a non-negative number.`, {
            field: `payments[${j}].amount`,
          })
        }
        amountMinor = toMinorUnits(rawP.amount)
      } else {
        throw HttpError.badRequest(`Payment amount is required at index ${j}.`, { field: `payments[${j}].amount` })
      }

      const reference =
        typeof rawP.reference === 'string' && rawP.reference.trim() ? rawP.reference.trim() : null

      validatedPayments.push({
        method: normalizedMethod as PaymentMethodType,
        amountMinor,
        reference,
      })
    }
  }

  const notes = typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes.trim() : undefined
  const terminalId =
    typeof raw.terminalId === 'string' && raw.terminalId.trim() ? raw.terminalId.trim() : 'POS01'

  return {
    customerId,
    items: validatedItems,
    discountType,
    discountValue,
    discountMinor,
    overrideReason: orderOverrideReason,
    taxOverride: orderTaxOverride,
    payments: validatedPayments,
    notes,
    terminalId,
  }
}

export function parseSaleQueryParams(url: URL): SaleFilterParams {
  const params = url.searchParams

  const startDate = params.get('startDate')?.trim() || undefined
  const endDate = params.get('endDate')?.trim() || undefined
  const branchId = params.get('branchId')?.trim() || undefined
  const customerId = params.get('customerId')?.trim() || undefined

  let status: SaleStatus | 'all' = 'all'
  const rawStatus = params.get('status')?.trim().toLowerCase()
  if (
    rawStatus === 'completed' ||
    rawStatus === 'voided' ||
    rawStatus === 'partially_returned' ||
    rawStatus === 'returned' ||
    rawStatus === 'draft'
  ) {
    status = rawStatus as SaleStatus
  }

  let page = 1
  const rawPage = params.get('page')
  if (rawPage) {
    const parsedPage = parseInt(rawPage, 10)
    if (Number.isInteger(parsedPage) && parsedPage >= 1) {
      page = parsedPage
    }
  }

  let limit = 50
  const rawLimit = params.get('limit')
  if (rawLimit) {
    const parsedLimit = parseInt(rawLimit, 10)
    if (Number.isInteger(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 100) {
      limit = parsedLimit
    }
  }

  let sortBy: 'created_at' | 'total_amount' | 'sale_number' = 'created_at'
  const rawSortBy = params.get('sortBy')?.trim().toLowerCase()
  if (rawSortBy === 'total_amount' || rawSortBy === 'sale_number') {
    sortBy = rawSortBy
  }

  let sortOrder: 'asc' | 'desc' = 'desc'
  const rawSortOrder = params.get('sortOrder')?.trim().toLowerCase()
  if (rawSortOrder === 'asc') {
    sortOrder = 'asc'
  }

  return {
    startDate,
    endDate,
    branchId,
    customerId,
    status,
    page,
    limit,
    sortBy,
    sortOrder,
  }
}

