import { HttpError } from '../../lib/errors'
import type {
  CreateGoodsReceiptInput,
  CreateGoodsReceiptItemInput,
  GoodsReceiptFilterParams,
} from './goodsReceipts.types'

export function validateCreateGoodsReceiptInput(body: unknown): CreateGoodsReceiptInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const raw = body as Record<string, unknown>

  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    throw HttpError.badRequest('At least one item is required for a goods receipt.', {
      field: 'items',
    })
  }

  const validatedItems: CreateGoodsReceiptItemInput[] = []
  for (let i = 0; i < raw.items.length; i++) {
    const it = raw.items[i]
    if (!it || typeof it !== 'object') {
      throw HttpError.badRequest(`Item at index ${i} is invalid.`, { field: `items[${i}]` })
    }

    const { purchaseItemId, quantityReceived } = it as Record<string, unknown>

    if (
      !purchaseItemId ||
      typeof purchaseItemId !== 'string' ||
      purchaseItemId.trim().length === 0
    ) {
      throw HttpError.badRequest(`Purchase item ID is required at index ${i}.`, {
        field: `items[${i}].purchaseItemId`,
      })
    }

    if (
      typeof quantityReceived !== 'number' ||
      isNaN(quantityReceived) ||
      quantityReceived <= 0
    ) {
      throw HttpError.badRequest(
        `Quantity received at index ${i} must be a positive number.`,
        { field: `items[${i}].quantityReceived` }
      )
    }

    validatedItems.push({
      purchaseItemId: purchaseItemId.trim(),
      quantityReceived,
    })
  }

  return {
    notes: typeof raw.notes === 'string' && raw.notes.trim().length > 0 ? raw.notes.trim() : null,
    items: validatedItems,
  }
}

export function parseGoodsReceiptQueryParams(url: URL): GoodsReceiptFilterParams {
  const branchId = url.searchParams.get('branchId') || undefined
  const supplierId = url.searchParams.get('supplierId') || undefined
  const purchaseId = url.searchParams.get('purchaseId') || undefined
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
    supplierId,
    purchaseId,
    startDate,
    endDate,
    page,
    limit,
  }
}

