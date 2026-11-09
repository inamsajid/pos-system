import { HttpError } from '../../lib/errors'
import type {
  CreateProductInput,
  UpdateProductInput,
  ReplaceProductInput,
  ProductUnit,
  ProductStatus,
  ProductSortField,
  ProductFilterParams,
} from './products.types'

const ALLOWED_UNITS: readonly ProductUnit[] = [
  'piece',
  'kg',
  'gram',
  'liter',
  'meter',
  'box',
  'pack',
  'dozen',
]

const ALLOWED_SORT_FIELDS: Record<string, ProductSortField> = {
  name: 'name',
  sku: 'sku',
  selling_price: 'selling_price',
  sellingprice: 'selling_price',
  purchase_price: 'purchase_price',
  purchaseprice: 'purchase_price',
  stock: 'stock',
  created_at: 'created_at',
  createdat: 'created_at',
  updated_at: 'updated_at',
  updatedat: 'updated_at',
}

function parseMinorAmount(
  rawMinor: unknown,
  rawMajor: unknown,
  fieldName: string
): number {
  if (rawMinor !== undefined && rawMinor !== null) {
    if (typeof rawMinor !== 'number' || !Number.isInteger(rawMinor) || rawMinor < 0) {
      throw HttpError.badRequest(
        `${fieldName} must be a non-negative integer representing minor units (paise).`,
        { field: fieldName }
      )
    }
    return rawMinor
  }

  if (rawMajor !== undefined && rawMajor !== null) {
    if (typeof rawMajor !== 'number' || !Number.isFinite(rawMajor) || rawMajor < 0) {
      throw HttpError.badRequest(`${fieldName} must be a non-negative number.`, { field: fieldName })
    }
    return Math.round(rawMajor * 100)
  }

  throw HttpError.badRequest(`${fieldName} is required.`, { field: fieldName })
}

export function validateCreateProductInput(input: unknown): CreateProductInput {
  if (!input || typeof input !== 'object') {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const raw = input as Record<string, unknown>

  // Name
  if (typeof raw.name !== 'string' || raw.name.trim().length < 2) {
    throw HttpError.badRequest('Product name must be at least 2 characters.', { field: 'name' })
  }
  if (raw.name.trim().length > 200) {
    throw HttpError.badRequest('Product name must not exceed 200 characters.', { field: 'name' })
  }

  // SKU
  if (typeof raw.sku !== 'string' || raw.sku.trim().length < 2) {
    throw HttpError.badRequest('Product SKU must be at least 2 characters.', { field: 'sku' })
  }
  const trimmedSku = raw.sku.trim()
  if (trimmedSku.length > 50) {
    throw HttpError.badRequest('Product SKU must not exceed 50 characters.', { field: 'sku' })
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(trimmedSku)) {
    throw HttpError.badRequest(
      'Product SKU may only contain letters, numbers, hyphens, underscores, and periods.',
      { field: 'sku' }
    )
  }

  // Barcode (optional)
  let barcode: string | null = null
  if (raw.barcode !== undefined && raw.barcode !== null && String(raw.barcode).trim()) {
    if (typeof raw.barcode !== 'string') {
      throw HttpError.badRequest('Barcode must be a string.', { field: 'barcode' })
    }
    const trimmedBarcode = raw.barcode.trim()
    if (trimmedBarcode.length < 3 || trimmedBarcode.length > 100) {
      throw HttpError.badRequest('Barcode must be between 3 and 100 characters.', { field: 'barcode' })
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(trimmedBarcode)) {
      throw HttpError.badRequest('Barcode contains invalid characters.', { field: 'barcode' })
    }
    barcode = trimmedBarcode
  }

  // Category ID (optional)
  let categoryId: string | null = null
  if (raw.categoryId !== undefined && raw.categoryId !== null && String(raw.categoryId).trim()) {
    if (typeof raw.categoryId !== 'string') {
      throw HttpError.badRequest('Category ID must be a string.', { field: 'categoryId' })
    }
    categoryId = raw.categoryId.trim()
  }

  // Description (optional)
  let description: string | null = null
  if (raw.description !== undefined && raw.description !== null) {
    if (typeof raw.description !== 'string') {
      throw HttpError.badRequest('Description must be a string.', { field: 'description' })
    }
    if (raw.description.length > 2000) {
      throw HttpError.badRequest('Description must not exceed 2000 characters.', { field: 'description' })
    }
    description = raw.description.trim() || null
  }

  // Image URL (optional)
  let imageUrl: string | null = null
  if (raw.imageUrl !== undefined && raw.imageUrl !== null && String(raw.imageUrl).trim()) {
    if (typeof raw.imageUrl !== 'string') {
      throw HttpError.badRequest('Image URL must be a string.', { field: 'imageUrl' })
    }
    imageUrl = raw.imageUrl.trim()
  }

  // Unit
  if (typeof raw.unit !== 'string' || !ALLOWED_UNITS.includes(raw.unit as ProductUnit)) {
    throw HttpError.badRequest(
      `Unit must be one of: ${ALLOWED_UNITS.join(', ')}.`,
      { field: 'unit' }
    )
  }
  const unit = raw.unit as ProductUnit

  // Monetary Amounts (integer paise)
  const purchasePriceMinor = parseMinorAmount(
    raw.purchasePriceMinor,
    raw.purchasePrice,
    'purchasePrice'
  )
  const sellingPriceMinor = parseMinorAmount(
    raw.sellingPriceMinor,
    raw.sellingPrice,
    'sellingPrice'
  )

  // Low stock threshold
  let lowStockThreshold = 5.0
  if (raw.lowStockThreshold !== undefined && raw.lowStockThreshold !== null) {
    if (typeof raw.lowStockThreshold !== 'number' || !Number.isFinite(raw.lowStockThreshold) || raw.lowStockThreshold < 0) {
      throw HttpError.badRequest('Low stock threshold must be a non-negative number.', {
        field: 'lowStockThreshold',
      })
    }
    lowStockThreshold = raw.lowStockThreshold
  }

  // Track inventory
  let trackInventory = true
  if (raw.trackInventory !== undefined && raw.trackInventory !== null) {
    if (typeof raw.trackInventory !== 'boolean') {
      throw HttpError.badRequest('trackInventory must be a boolean.', { field: 'trackInventory' })
    }
    trackInventory = raw.trackInventory
  }

  return {
    name: raw.name.trim(),
    sku: trimmedSku,
    barcode,
    categoryId,
    description,
    imageUrl,
    unit,
    purchasePriceMinor,
    sellingPriceMinor,
    lowStockThreshold,
    trackInventory,
  }
}

export function validateUpdateProductInput(input: unknown): UpdateProductInput {
  if (!input || typeof input !== 'object') {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const raw = input as Record<string, unknown>
  const result: UpdateProductInput = {}
  let hasField = false

  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string' || raw.name.trim().length < 2) {
      throw HttpError.badRequest('Product name must be at least 2 characters.', { field: 'name' })
    }
    if (raw.name.trim().length > 200) {
      throw HttpError.badRequest('Product name must not exceed 200 characters.', { field: 'name' })
    }
    result.name = raw.name.trim()
    hasField = true
  }

  if (raw.sku !== undefined) {
    if (typeof raw.sku !== 'string' || raw.sku.trim().length < 2) {
      throw HttpError.badRequest('Product SKU must be at least 2 characters.', { field: 'sku' })
    }
    const trimmedSku = raw.sku.trim()
    if (trimmedSku.length > 50) {
      throw HttpError.badRequest('Product SKU must not exceed 50 characters.', { field: 'sku' })
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(trimmedSku)) {
      throw HttpError.badRequest('Product SKU contains invalid characters.', { field: 'sku' })
    }
    result.sku = trimmedSku
    hasField = true
  }

  if (raw.barcode !== undefined) {
    if (raw.barcode === null || raw.barcode === '') {
      result.barcode = null
    } else if (typeof raw.barcode !== 'string') {
      throw HttpError.badRequest('Barcode must be a string or null.', { field: 'barcode' })
    } else {
      const trimmedBarcode = raw.barcode.trim()
      if (trimmedBarcode.length < 3 || trimmedBarcode.length > 100) {
        throw HttpError.badRequest('Barcode must be between 3 and 100 characters.', { field: 'barcode' })
      }
      if (!/^[a-zA-Z0-9_.-]+$/.test(trimmedBarcode)) {
        throw HttpError.badRequest('Barcode contains invalid characters.', { field: 'barcode' })
      }
      result.barcode = trimmedBarcode
    }
    hasField = true
  }

  if (raw.categoryId !== undefined) {
    if (raw.categoryId === null || raw.categoryId === '') {
      result.categoryId = null
    } else if (typeof raw.categoryId !== 'string') {
      throw HttpError.badRequest('Category ID must be a string or null.', { field: 'categoryId' })
    } else {
      result.categoryId = raw.categoryId.trim()
    }
    hasField = true
  }

  if (raw.description !== undefined) {
    if (raw.description === null) {
      result.description = null
    } else if (typeof raw.description !== 'string') {
      throw HttpError.badRequest('Description must be a string or null.', { field: 'description' })
    } else if (raw.description.length > 2000) {
      throw HttpError.badRequest('Description must not exceed 2000 characters.', { field: 'description' })
    } else {
      result.description = raw.description.trim() || null
    }
    hasField = true
  }

  if (raw.imageUrl !== undefined) {
    if (raw.imageUrl === null || raw.imageUrl === '') {
      result.imageUrl = null
    } else if (typeof raw.imageUrl !== 'string') {
      throw HttpError.badRequest('Image URL must be a string or null.', { field: 'imageUrl' })
    } else {
      result.imageUrl = raw.imageUrl.trim()
    }
    hasField = true
  }

  if (raw.unit !== undefined) {
    if (typeof raw.unit !== 'string' || !ALLOWED_UNITS.includes(raw.unit as ProductUnit)) {
      throw HttpError.badRequest(
        `Unit must be one of: ${ALLOWED_UNITS.join(', ')}.`,
        { field: 'unit' }
      )
    }
    result.unit = raw.unit as ProductUnit
    hasField = true
  }

  if (raw.purchasePriceMinor !== undefined || raw.purchasePrice !== undefined) {
    result.purchasePriceMinor = parseMinorAmount(
      raw.purchasePriceMinor,
      raw.purchasePrice,
      'purchasePrice'
    )
    hasField = true
  }

  if (raw.sellingPriceMinor !== undefined || raw.sellingPrice !== undefined) {
    result.sellingPriceMinor = parseMinorAmount(
      raw.sellingPriceMinor,
      raw.sellingPrice,
      'sellingPrice'
    )
    hasField = true
  }

  if (raw.lowStockThreshold !== undefined) {
    if (typeof raw.lowStockThreshold !== 'number' || !Number.isFinite(raw.lowStockThreshold) || raw.lowStockThreshold < 0) {
      throw HttpError.badRequest('Low stock threshold must be a non-negative number.', {
        field: 'lowStockThreshold',
      })
    }
    result.lowStockThreshold = raw.lowStockThreshold
    hasField = true
  }

  if (raw.trackInventory !== undefined) {
    if (typeof raw.trackInventory !== 'boolean') {
      throw HttpError.badRequest('trackInventory must be a boolean.', { field: 'trackInventory' })
    }
    result.trackInventory = raw.trackInventory
    hasField = true
  }

  if (raw.status !== undefined) {
    if (raw.status !== 'active' && raw.status !== 'archived') {
      throw HttpError.badRequest("Product status must be either 'active' or 'archived'.", { field: 'status' })
    }
    result.status = raw.status as ProductStatus
    hasField = true
  }

  if (raw.expectedVersion !== undefined && raw.expectedVersion !== null) {
    const v = Number(raw.expectedVersion)
    if (!Number.isInteger(v) || v < 1) {
      throw HttpError.badRequest('expectedVersion must be a positive integer.', { field: 'expectedVersion' })
    }
    result.expectedVersion = v
  }

  if (!hasField && result.expectedVersion === undefined) {
    throw HttpError.badRequest('At least one field must be provided for update.')
  }

  return result
}

export function validateReplaceProductInput(input: unknown): ReplaceProductInput {
  if (!input || typeof input !== 'object') {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const raw = input as Record<string, unknown>

  // Name (required)
  if (typeof raw.name !== 'string' || raw.name.trim().length < 2) {
    throw HttpError.badRequest('Product name must be at least 2 characters.', { field: 'name' })
  }
  if (raw.name.trim().length > 200) {
    throw HttpError.badRequest('Product name must not exceed 200 characters.', { field: 'name' })
  }

  // SKU (required)
  if (typeof raw.sku !== 'string' || raw.sku.trim().length < 2) {
    throw HttpError.badRequest('Product SKU must be at least 2 characters.', { field: 'sku' })
  }
  const trimmedSku = raw.sku.trim()
  if (trimmedSku.length > 50) {
    throw HttpError.badRequest('Product SKU must not exceed 50 characters.', { field: 'sku' })
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(trimmedSku)) {
    throw HttpError.badRequest(
      'Product SKU may only contain letters, numbers, hyphens, underscores, and periods.',
      { field: 'sku' }
    )
  }

  // Unit (required)
  if (typeof raw.unit !== 'string' || !ALLOWED_UNITS.includes(raw.unit as ProductUnit)) {
    throw HttpError.badRequest(
      `Unit must be one of: ${ALLOWED_UNITS.join(', ')}.`,
      { field: 'unit' }
    )
  }
  const unit = raw.unit as ProductUnit

  // Monetary Amounts (required)
  const purchasePriceMinor = parseMinorAmount(
    raw.purchasePriceMinor,
    raw.purchasePrice,
    'purchasePrice'
  )
  const sellingPriceMinor = parseMinorAmount(
    raw.sellingPriceMinor,
    raw.sellingPrice,
    'sellingPrice'
  )

  // Barcode (optional - defaults to null)
  let barcode: string | null = null
  if (raw.barcode !== undefined && raw.barcode !== null && String(raw.barcode).trim()) {
    if (typeof raw.barcode !== 'string') {
      throw HttpError.badRequest('Barcode must be a string.', { field: 'barcode' })
    }
    const trimmedBarcode = raw.barcode.trim()
    if (trimmedBarcode.length < 3 || trimmedBarcode.length > 100) {
      throw HttpError.badRequest('Barcode must be between 3 and 100 characters.', { field: 'barcode' })
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(trimmedBarcode)) {
      throw HttpError.badRequest('Barcode contains invalid characters.', { field: 'barcode' })
    }
    barcode = trimmedBarcode
  }

  // Category ID (optional - defaults to null)
  let categoryId: string | null = null
  if (raw.categoryId !== undefined && raw.categoryId !== null && String(raw.categoryId).trim()) {
    if (typeof raw.categoryId !== 'string') {
      throw HttpError.badRequest('Category ID must be a string.', { field: 'categoryId' })
    }
    categoryId = raw.categoryId.trim()
  }

  // Description (optional - defaults to null)
  let description: string | null = null
  if (raw.description !== undefined && raw.description !== null) {
    if (typeof raw.description !== 'string') {
      throw HttpError.badRequest('Description must be a string.', { field: 'description' })
    }
    if (raw.description.length > 2000) {
      throw HttpError.badRequest('Description must not exceed 2000 characters.', { field: 'description' })
    }
    description = raw.description.trim() || null
  }

  // Image URL (optional - defaults to null)
  let imageUrl: string | null = null
  if (raw.imageUrl !== undefined && raw.imageUrl !== null && String(raw.imageUrl).trim()) {
    if (typeof raw.imageUrl !== 'string') {
      throw HttpError.badRequest('Image URL must be a string.', { field: 'imageUrl' })
    }
    imageUrl = raw.imageUrl.trim()
  }

  // Low stock threshold (optional - defaults to 5.0)
  let lowStockThreshold = 5.0
  if (raw.lowStockThreshold !== undefined && raw.lowStockThreshold !== null) {
    if (
      typeof raw.lowStockThreshold !== 'number' ||
      !Number.isFinite(raw.lowStockThreshold) ||
      raw.lowStockThreshold < 0
    ) {
      throw HttpError.badRequest('Low stock threshold must be a non-negative number.', {
        field: 'lowStockThreshold',
      })
    }
    lowStockThreshold = raw.lowStockThreshold
  }

  // Track inventory (optional - defaults to true)
  let trackInventory = true
  if (raw.trackInventory !== undefined && raw.trackInventory !== null) {
    if (typeof raw.trackInventory !== 'boolean') {
      throw HttpError.badRequest('trackInventory must be a boolean.', { field: 'trackInventory' })
    }
    trackInventory = raw.trackInventory
  }

  // Status (optional - defaults to 'active')
  let status: ProductStatus = 'active'
  if (raw.status !== undefined && raw.status !== null) {
    if (raw.status !== 'active' && raw.status !== 'archived') {
      throw HttpError.badRequest("Product status must be either 'active' or 'archived'.", { field: 'status' })
    }
    status = raw.status as ProductStatus
  }

  let expectedVersion: number | undefined = undefined
  if (raw.expectedVersion !== undefined && raw.expectedVersion !== null) {
    const v = Number(raw.expectedVersion)
    if (!Number.isInteger(v) || v < 1) {
      throw HttpError.badRequest('expectedVersion must be a positive integer.', { field: 'expectedVersion' })
    }
    expectedVersion = v
  }

  return {
    name: raw.name.trim(),
    sku: trimmedSku,
    barcode,
    categoryId,
    description,
    imageUrl,
    unit,
    purchasePriceMinor,
    sellingPriceMinor,
    lowStockThreshold,
    trackInventory,
    status,
    expectedVersion,
  }
}

export function parseProductQueryParams(url: URL): ProductFilterParams {
  const params = url.searchParams

  const search = params.get('search')?.trim() || undefined
  const sku = params.get('sku')?.trim() || undefined
  const barcode = params.get('barcode')?.trim() || undefined
  const categoryId = params.get('categoryId')?.trim() || undefined

  let status: ProductStatus | 'all' = 'all'
  const rawStatus = params.get('status')?.trim().toLowerCase()
  if (rawStatus === 'active' || rawStatus === 'archived') {
    status = rawStatus
  }

  const rawLowStock = params.get('lowStock')
  const lowStock = rawLowStock === 'true' || rawLowStock === '1'

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
    if (Number.isInteger(parsedLimit) && parsedLimit >= 1) {
      limit = Math.min(100, parsedLimit)
    }
  }

  let sortBy: ProductSortField = 'name'
  const rawSortBy = params.get('sortBy')?.trim().toLowerCase()
  if (rawSortBy && ALLOWED_SORT_FIELDS[rawSortBy]) {
    sortBy = ALLOWED_SORT_FIELDS[rawSortBy]
  }

  let sortOrder: 'asc' | 'desc' = 'asc'
  const rawSortOrder = params.get('sortOrder')?.trim().toLowerCase()
  if (rawSortOrder === 'desc') {
    sortOrder = 'desc'
  }

  return {
    search,
    sku,
    barcode,
    categoryId,
    status,
    lowStock,
    page,
    limit,
    sortBy,
    sortOrder,
  }
}

