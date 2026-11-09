import { HttpError } from '../../lib/errors'
import type {
  CreateStockAdjustmentInput,
  CreateStockCountInput,
  StockCountItemInput,
  InventoryFilterParams,
  StockMovementFilterParams,
  StockCountFilterParams,
  StockMovementType,
  MovementReferenceType,
} from './inventory.types'

const ALLOWED_ADJUSTMENT_TYPES = ['adjustment_in', 'adjustment_out']
const ALLOWED_ADJUSTMENT_REASONS = ['damaged', 'expired', 'lost', 'found', 'correction', 'other']

export function validateStockAdjustmentInput(body: unknown): CreateStockAdjustmentInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const raw = body as Record<string, unknown>

  if (!raw.productId || typeof raw.productId !== 'string' || raw.productId.trim().length === 0) {
    throw HttpError.badRequest('Product ID is required.', { field: 'productId' })
  }

  if (
    typeof raw.quantityChange !== 'number' ||
    isNaN(raw.quantityChange) ||
    raw.quantityChange <= 0
  ) {
    throw HttpError.badRequest('Quantity change must be a positive number.', {
      field: 'quantityChange',
    })
  }

  if (
    typeof raw.type !== 'string' ||
    !ALLOWED_ADJUSTMENT_TYPES.includes(raw.type)
  ) {
    throw HttpError.badRequest(
      `Adjustment type must be one of: ${ALLOWED_ADJUSTMENT_TYPES.join(', ')}`,
      { field: 'type' }
    )
  }

  if (
    !raw.reason ||
    typeof raw.reason !== 'string' ||
    raw.reason.trim().length === 0
  ) {
    throw HttpError.badRequest('Adjustment reason is required.', { field: 'reason' })
  }

  const reasonNormalized = raw.reason.trim().toLowerCase()
  const isApprovedReason = ALLOWED_ADJUSTMENT_REASONS.includes(reasonNormalized)
  if (!isApprovedReason && reasonNormalized.length < 3) {
    throw HttpError.badRequest(
      `Adjustment reason must be descriptive or one of: ${ALLOWED_ADJUSTMENT_REASONS.join(', ')}`,
      { field: 'reason' }
    )
  }

  return {
    branchId: typeof raw.branchId === 'string' && raw.branchId.trim().length > 0 ? raw.branchId.trim() : undefined,
    productId: raw.productId.trim(),
    quantityChange: raw.quantityChange,
    type: raw.type as 'adjustment_in' | 'adjustment_out',
    reason: raw.reason.trim(),
    notes: typeof raw.notes === 'string' && raw.notes.trim().length > 0 ? raw.notes.trim() : null,
  }
}

export function validateCreateStockCountInput(body: unknown): CreateStockCountInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const raw = body as Record<string, unknown>

  if (!raw.name || typeof raw.name !== 'string' || raw.name.trim().length === 0) {
    throw HttpError.badRequest('Stock count name is required.', { field: 'name' })
  }

  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    throw HttpError.badRequest('At least one item must be included in stock count.', {
      field: 'items',
    })
  }

  const validatedItems: StockCountItemInput[] = []
  for (let i = 0; i < raw.items.length; i++) {
    const item = raw.items[i]
    if (!item || typeof item !== 'object') {
      throw HttpError.badRequest(`Item at index ${i} is invalid.`, { field: `items[${i}]` })
    }

    const { productId, physicalQuantity, notes } = item as Record<string, unknown>

    if (!productId || typeof productId !== 'string' || productId.trim().length === 0) {
      throw HttpError.badRequest(`Product ID is required at index ${i}.`, {
        field: `items[${i}].productId`,
      })
    }

    let parsedPhysQty: number | undefined
    if (physicalQuantity !== undefined && physicalQuantity !== null) {
      if (typeof physicalQuantity !== 'number' || isNaN(physicalQuantity) || physicalQuantity < 0) {
        throw HttpError.badRequest(`Physical quantity at index ${i} must be a non-negative number.`, {
          field: `items[${i}].physicalQuantity`,
        })
      }
      parsedPhysQty = physicalQuantity
    }

    validatedItems.push({
      productId: productId.trim(),
      physicalQuantity: parsedPhysQty,
      notes: typeof notes === 'string' && notes.trim().length > 0 ? notes.trim() : null,
    })
  }

  return {
    branchId: typeof raw.branchId === 'string' && raw.branchId.trim().length > 0 ? raw.branchId.trim() : undefined,
    name: raw.name.trim(),
    items: validatedItems,
  }
}

export function parseInventoryQueryParams(url: URL): InventoryFilterParams {
  const branchId = url.searchParams.get('branchId') || undefined
  const productId = url.searchParams.get('productId') || undefined
  const categoryId = url.searchParams.get('categoryId') || undefined
  const search = url.searchParams.get('search') || undefined
  const lowStock = url.searchParams.get('lowStock') === 'true'

  const pageStr = url.searchParams.get('page')
  const page = pageStr && !isNaN(Number(pageStr)) && Number(pageStr) > 0 ? Number(pageStr) : 1

  const limitStr = url.searchParams.get('limit')
  const parsedLimit =
    limitStr && !isNaN(Number(limitStr)) && Number(limitStr) > 0 ? Number(limitStr) : 20
  const limit = Math.min(Math.max(parsedLimit, 1), 100)

  return {
    branchId,
    productId,
    categoryId,
    search,
    lowStock,
    page,
    limit,
  }
}

export function parseStockMovementQueryParams(url: URL): StockMovementFilterParams {
  const branchId = url.searchParams.get('branchId') || undefined
  const productId = url.searchParams.get('productId') || undefined
  const rawType = url.searchParams.get('type')
  const type = rawType ? (rawType as StockMovementType) : undefined
  const rawRef = url.searchParams.get('referenceType')
  const referenceType = rawRef ? (rawRef as MovementReferenceType) : undefined
  const startDate = url.searchParams.get('startDate') || undefined
  const endDate = url.searchParams.get('endDate') || undefined

  const pageStr = url.searchParams.get('page')
  const page = pageStr && !isNaN(Number(pageStr)) && Number(pageStr) > 0 ? Number(pageStr) : 1

  const limitStr = url.searchParams.get('limit')
  const parsedLimit =
    limitStr && !isNaN(Number(limitStr)) && Number(limitStr) > 0 ? Number(limitStr) : 20
  const limit = Math.min(Math.max(parsedLimit, 1), 100)

  return {
    branchId,
    productId,
    type,
    referenceType,
    startDate,
    endDate,
    page,
    limit,
  }
}

export function parseStockCountQueryParams(url: URL): StockCountFilterParams {
  const branchId = url.searchParams.get('branchId') || undefined
  const rawStatus = url.searchParams.get('status')
  const status =
    rawStatus && ['draft', 'confirmed', 'cancelled', 'all'].includes(rawStatus)
      ? (rawStatus as StockCountFilterParams['status'])
      : 'all'

  const pageStr = url.searchParams.get('page')
  const page = pageStr && !isNaN(Number(pageStr)) && Number(pageStr) > 0 ? Number(pageStr) : 1

  const limitStr = url.searchParams.get('limit')
  const parsedLimit =
    limitStr && !isNaN(Number(limitStr)) && Number(limitStr) > 0 ? Number(limitStr) : 20
  const limit = Math.min(Math.max(parsedLimit, 1), 100)

  return {
    branchId,
    status,
    page,
    limit,
  }
}

