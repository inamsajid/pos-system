import { HttpError } from '../../lib/errors'
import type {
  CreatePurchaseInput,
  CreatePurchaseItemInput,
  UpdatePurchaseInput,
  PurchaseFilterParams,
  PurchaseStatus,
} from './purchases.types'

const ALLOWED_PURCHASE_STATUSES: PurchaseStatus[] = [
  'draft',
  'ordered',
  'partially_received',
  'received',
  'cancelled',
]

export function validateCreatePurchaseInput(body: unknown): CreatePurchaseInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const raw = body as Record<string, unknown>

  if (!raw.supplierId || typeof raw.supplierId !== 'string' || raw.supplierId.trim().length === 0) {
    throw HttpError.badRequest('Supplier ID is required.', { field: 'supplierId' })
  }

  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    throw HttpError.badRequest('At least one item is required in a purchase order.', {
      field: 'items',
    })
  }

  const validatedItems: CreatePurchaseItemInput[] = []
  for (let i = 0; i < raw.items.length; i++) {
    const it = raw.items[i]
    if (!it || typeof it !== 'object') {
      throw HttpError.badRequest(`Item at index ${i} is invalid.`, { field: `items[${i}]` })
    }

    const { productId, orderedQuantity, unitCostMinor, discountMinor } = it as Record<string, unknown>

    if (!productId || typeof productId !== 'string' || productId.trim().length === 0) {
      throw HttpError.badRequest(`Product ID is required at index ${i}.`, {
        field: `items[${i}].productId`,
      })
    }

    if (
      typeof orderedQuantity !== 'number' ||
      isNaN(orderedQuantity) ||
      orderedQuantity <= 0
    ) {
      throw HttpError.badRequest(
        `Ordered quantity at index ${i} must be a positive number.`,
        { field: `items[${i}].orderedQuantity` }
      )
    }

    if (
      typeof unitCostMinor !== 'number' ||
      !Number.isInteger(unitCostMinor) ||
      unitCostMinor < 0
    ) {
      throw HttpError.badRequest(
        `Unit cost at index ${i} must be a non-negative integer in minor units (paise).`,
        { field: `items[${i}].unitCostMinor` }
      )
    }

    let parsedDisc: number | undefined
    if (discountMinor !== undefined && discountMinor !== null) {
      if (typeof discountMinor !== 'number' || !Number.isInteger(discountMinor) || discountMinor < 0) {
        throw HttpError.badRequest(
          `Discount at index ${i} must be a non-negative integer in minor units (paise).`,
          { field: `items[${i}].discountMinor` }
        )
      }
      parsedDisc = discountMinor
    }

    validatedItems.push({
      productId: productId.trim(),
      orderedQuantity,
      unitCostMinor,
      discountMinor: parsedDisc,
    })
  }

  return {
    branchId: typeof raw.branchId === 'string' && raw.branchId.trim().length > 0 ? raw.branchId.trim() : undefined,
    supplierId: raw.supplierId.trim(),
    supplierInvoiceNumber: typeof raw.supplierInvoiceNumber === 'string' && raw.supplierInvoiceNumber.trim().length > 0 ? raw.supplierInvoiceNumber.trim() : null,
    expectedDeliveryDate: typeof raw.expectedDeliveryDate === 'string' && raw.expectedDeliveryDate.trim().length > 0 ? raw.expectedDeliveryDate.trim() : null,
    notes: typeof raw.notes === 'string' && raw.notes.trim().length > 0 ? raw.notes.trim() : null,
    items: validatedItems,
  }
}

export function validateUpdatePurchaseInput(body: unknown): UpdatePurchaseInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const raw = body as Record<string, unknown>

  let validatedItems: CreatePurchaseItemInput[] | undefined
  if (raw.items !== undefined) {
    if (!Array.isArray(raw.items) || raw.items.length === 0) {
      throw HttpError.badRequest('Items must be a non-empty array if provided.', { field: 'items' })
    }

    validatedItems = []
    for (let i = 0; i < raw.items.length; i++) {
      const it = raw.items[i]
      if (!it || typeof it !== 'object') {
        throw HttpError.badRequest(`Item at index ${i} is invalid.`, { field: `items[${i}]` })
      }

      const { productId, orderedQuantity, unitCostMinor, discountMinor } = it as Record<string, unknown>

      if (!productId || typeof productId !== 'string' || productId.trim().length === 0) {
        throw HttpError.badRequest(`Product ID is required at index ${i}.`, {
          field: `items[${i}].productId`,
        })
      }

      if (
        typeof orderedQuantity !== 'number' ||
        isNaN(orderedQuantity) ||
        orderedQuantity <= 0
      ) {
        throw HttpError.badRequest(
          `Ordered quantity at index ${i} must be a positive number.`,
          { field: `items[${i}].orderedQuantity` }
        )
      }

      if (
        typeof unitCostMinor !== 'number' ||
        !Number.isInteger(unitCostMinor) ||
        unitCostMinor < 0
      ) {
        throw HttpError.badRequest(
          `Unit cost at index ${i} must be a non-negative integer in minor units (paise).`,
          { field: `items[${i}].unitCostMinor` }
        )
      }

      let parsedDisc: number | undefined
      if (discountMinor !== undefined && discountMinor !== null) {
        if (typeof discountMinor !== 'number' || !Number.isInteger(discountMinor) || discountMinor < 0) {
          throw HttpError.badRequest(
            `Discount at index ${i} must be a non-negative integer in minor units (paise).`,
            { field: `items[${i}].discountMinor` }
          )
        }
        parsedDisc = discountMinor
      }

      validatedItems.push({
        productId: productId.trim(),
        orderedQuantity,
        unitCostMinor,
        discountMinor: parsedDisc,
      })
    }
  }

  return {
    supplierInvoiceNumber: typeof raw.supplierInvoiceNumber === 'string' ? raw.supplierInvoiceNumber.trim() || null : undefined,
    expectedDeliveryDate: typeof raw.expectedDeliveryDate === 'string' ? raw.expectedDeliveryDate.trim() || null : undefined,
    notes: typeof raw.notes === 'string' ? raw.notes.trim() || null : undefined,
    items: validatedItems,
  }
}

export function parsePurchaseQueryParams(url: URL): PurchaseFilterParams {
  const branchId = url.searchParams.get('branchId') || undefined
  const supplierId = url.searchParams.get('supplierId') || undefined
  const rawStatus = url.searchParams.get('status')
  const status =
    rawStatus && (ALLOWED_PURCHASE_STATUSES as string[]).includes(rawStatus)
      ? (rawStatus as PurchaseStatus)
      : (rawStatus === 'all' ? 'all' : undefined)

  const startDate = url.searchParams.get('startDate') || undefined
  const endDate = url.searchParams.get('endDate') || undefined
  const search = url.searchParams.get('search') || undefined

  const pageStr = url.searchParams.get('page')
  const page = pageStr && !isNaN(Number(pageStr)) && Number(pageStr) > 0 ? Number(pageStr) : 1

  const limitStr = url.searchParams.get('limit')
  const parsedLimit =
    limitStr && !isNaN(Number(limitStr)) && Number(limitStr) > 0 ? Number(limitStr) : 20
  const limit = Math.min(Math.max(parsedLimit, 1), 100)

  return {
    branchId,
    supplierId,
    status,
    startDate,
    endDate,
    search,
    page,
    limit,
  }
}

