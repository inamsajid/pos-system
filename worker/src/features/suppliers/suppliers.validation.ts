import { HttpError } from '../../lib/errors'
import type {
  SupplierFilterParams,
  CreateSupplierInput,
  UpdateSupplierInput,
  AddSupplierProductInput,
} from './suppliers.types'

export function parseSupplierQueryParams(url: URL): SupplierFilterParams {
  const search = url.searchParams.get('search') || undefined
  const rawStatus = url.searchParams.get('status')
  const status =
    rawStatus && ['active', 'inactive', 'archived', 'all'].includes(rawStatus)
      ? (rawStatus as SupplierFilterParams['status'])
      : 'active'

  const pageStr = url.searchParams.get('page')
  const page = pageStr && !isNaN(Number(pageStr)) && Number(pageStr) > 0 ? Number(pageStr) : 1

  const limitStr = url.searchParams.get('limit')
  const parsedLimit =
    limitStr && !isNaN(Number(limitStr)) && Number(limitStr) > 0 ? Number(limitStr) : 50
  const limit = Math.min(Math.max(parsedLimit, 1), 100)

  return {
    search,
    status,
    page,
    limit,
  }
}

export function validateCreateSupplier(raw: unknown): CreateSupplierInput {
  if (!raw || typeof raw !== 'object') {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const data = raw as Record<string, unknown>

  if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
    throw HttpError.badRequest('Supplier name is required.', { field: 'name' })
  }

  const name = data.name.trim()
  if (name.length > 200) {
    throw HttpError.badRequest('Supplier name cannot exceed 200 characters.', { field: 'name' })
  }

  let type: 'individual' | 'business' = 'business'
  if (data.type !== undefined) {
    if (data.type !== 'individual' && data.type !== 'business') {
      throw HttpError.badRequest("Supplier type must be either 'individual' or 'business'.", { field: 'type' })
    }
    type = data.type
  }

  let openingPayableMinor = 0
  if (data.openingPayableMinor !== undefined && data.openingPayableMinor !== null) {
    const val = Number(data.openingPayableMinor)
    if (!Number.isInteger(val)) {
      throw HttpError.badRequest('openingPayableMinor must be an integer.', { field: 'openingPayableMinor' })
    }
    openingPayableMinor = val
  } else if (data.openingPayable !== undefined && data.openingPayable !== null) {
    openingPayableMinor = Math.round(Number(data.openingPayable) * 100)
  }

  let status: 'active' | 'inactive' | 'archived' = 'active'
  if (data.status !== undefined) {
    if (data.status !== 'active' && data.status !== 'inactive' && data.status !== 'archived') {
      throw HttpError.badRequest("status must be 'active', 'inactive', or 'archived'.", { field: 'status' })
    }
    status = data.status
  }

  return {
    name,
    supplierCode: typeof data.supplierCode === 'string' ? data.supplierCode.trim() || undefined : undefined,
    type,
    companyName: typeof data.companyName === 'string' ? data.companyName.trim() || undefined : undefined,
    contactPerson: typeof data.contactPerson === 'string' ? data.contactPerson.trim() || undefined : undefined,
    phone: typeof data.phone === 'string' ? data.phone.trim() || undefined : undefined,
    alternatePhone: typeof data.alternatePhone === 'string' ? data.alternatePhone.trim() || undefined : undefined,
    email: typeof data.email === 'string' ? data.email.trim().toLowerCase() || undefined : undefined,
    taxNumber: typeof data.taxNumber === 'string' ? data.taxNumber.trim() || undefined : undefined,
    address: typeof data.address === 'string' ? data.address.trim() || undefined : undefined,
    city: typeof data.city === 'string' ? data.city.trim() || undefined : undefined,
    country: typeof data.country === 'string' && data.country.trim() ? data.country.trim() : 'Pakistan',
    openingPayableMinor,
    notes: typeof data.notes === 'string' ? data.notes.trim() || undefined : undefined,
    status,
  }
}

export function validateUpdateSupplier(raw: unknown): UpdateSupplierInput {
  if (!raw || typeof raw !== 'object') {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const data = raw as Record<string, unknown>
  const output: UpdateSupplierInput = {}

  if (data.name !== undefined) {
    if (typeof data.name !== 'string' || !data.name.trim()) {
      throw HttpError.badRequest('Supplier name cannot be empty.', { field: 'name' })
    }
    output.name = data.name.trim()
  }

  if (data.type !== undefined) {
    if (data.type !== 'individual' && data.type !== 'business') {
      throw HttpError.badRequest("Supplier type must be either 'individual' or 'business'.", { field: 'type' })
    }
    output.type = data.type
  }

  if (data.companyName !== undefined) {
    output.companyName = typeof data.companyName === 'string' ? data.companyName.trim() || undefined : undefined
  }
  if (data.contactPerson !== undefined) {
    output.contactPerson = typeof data.contactPerson === 'string' ? data.contactPerson.trim() || undefined : undefined
  }
  if (data.phone !== undefined) {
    output.phone = typeof data.phone === 'string' ? data.phone.trim() || undefined : undefined
  }
  if (data.alternatePhone !== undefined) {
    output.alternatePhone = typeof data.alternatePhone === 'string' ? data.alternatePhone.trim() || undefined : undefined
  }
  if (data.email !== undefined) {
    output.email = typeof data.email === 'string' ? data.email.trim().toLowerCase() || undefined : undefined
  }
  if (data.taxNumber !== undefined) {
    output.taxNumber = typeof data.taxNumber === 'string' ? data.taxNumber.trim() || undefined : undefined
  }
  if (data.address !== undefined) {
    output.address = typeof data.address === 'string' ? data.address.trim() || undefined : undefined
  }
  if (data.city !== undefined) {
    output.city = typeof data.city === 'string' ? data.city.trim() || undefined : undefined
  }
  if (data.country !== undefined) {
    output.country = typeof data.country === 'string' ? data.country.trim() || undefined : undefined
  }
  if (data.notes !== undefined) {
    output.notes = typeof data.notes === 'string' ? data.notes.trim() || undefined : undefined
  }
  if (data.status !== undefined) {
    if (data.status !== 'active' && data.status !== 'inactive' && data.status !== 'archived') {
      throw HttpError.badRequest("status must be 'active', 'inactive', or 'archived'.", { field: 'status' })
    }
    output.status = data.status
  }

  return output
}

export function validateAddSupplierProduct(raw: unknown): AddSupplierProductInput {
  if (!raw || typeof raw !== 'object') {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const data = raw as Record<string, unknown>
  if (!data.productId || typeof data.productId !== 'string' || !data.productId.trim()) {
    throw HttpError.badRequest('productId is required.', { field: 'productId' })
  }

  let purchasePriceMinor = 0
  if (data.purchasePriceMinor !== undefined && data.purchasePriceMinor !== null) {
    const val = Number(data.purchasePriceMinor)
    if (!Number.isInteger(val) || val < 0) {
      throw HttpError.badRequest('purchasePriceMinor must be a non-negative integer.', { field: 'purchasePriceMinor' })
    }
    purchasePriceMinor = val
  } else if (data.purchasePrice !== undefined && data.purchasePrice !== null) {
    purchasePriceMinor = Math.max(0, Math.round(Number(data.purchasePrice) * 100))
  }

  return {
    productId: data.productId.trim(),
    supplierSku: typeof data.supplierSku === 'string' ? data.supplierSku.trim() || undefined : undefined,
    purchasePriceMinor,
    purchasePrice: purchasePriceMinor / 100,
    isPreferred: Boolean(data.isPreferred),
  }
}
