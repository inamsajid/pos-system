import { HttpError } from '../../lib/errors'
import type {
  CreateCustomerInput,
  UpdateCustomerInput,
  CustomerFilterParams,
  CustomerType,
  CustomerStatus,
} from './customers.types'

export function validateCreateCustomer(raw: unknown): CreateCustomerInput {
  if (!raw || typeof raw !== 'object') {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const data = raw as Record<string, unknown>

  if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
    throw HttpError.badRequest('Customer name is required.', { field: 'name' })
  }

  const name = data.name.trim()
  if (name.length > 200) {
    throw HttpError.badRequest('Customer name cannot exceed 200 characters.', { field: 'name' })
  }

  let type: CustomerType = 'individual'
  if (data.type !== undefined) {
    if (data.type !== 'individual' && data.type !== 'business') {
      throw HttpError.badRequest("Customer type must be either 'individual' or 'business'.", { field: 'type' })
    }
    type = data.type
  }

  let customerCode: string | undefined
  if (data.customerCode !== undefined && data.customerCode !== null) {
    if (typeof data.customerCode !== 'string') {
      throw HttpError.badRequest('Customer code must be a string.', { field: 'customerCode' })
    }
    customerCode = data.customerCode.trim() || undefined
  }

  let openingBalanceMinor = 0
  if (data.openingBalanceMinor !== undefined && data.openingBalanceMinor !== null) {
    const val = Number(data.openingBalanceMinor)
    if (!Number.isInteger(val)) {
      throw HttpError.badRequest('openingBalanceMinor must be an integer.', { field: 'openingBalanceMinor' })
    }
    openingBalanceMinor = val
  } else if (data.openingBalance !== undefined && data.openingBalance !== null) {
    // If client sent major unit
    openingBalanceMinor = Math.round(Number(data.openingBalance) * 100)
  }

  let creditLimitMinor = 0
  if (data.creditLimitMinor !== undefined && data.creditLimitMinor !== null) {
    const val = Number(data.creditLimitMinor)
    if (!Number.isInteger(val) || val < 0) {
      throw HttpError.badRequest('creditLimitMinor must be a non-negative integer.', { field: 'creditLimitMinor' })
    }
    creditLimitMinor = val
  } else if (data.creditLimit !== undefined && data.creditLimit !== null) {
    creditLimitMinor = Math.max(0, Math.round(Number(data.creditLimit) * 100))
  }

  let status: CustomerStatus = 'active'
  if (data.status !== undefined) {
    if (data.status !== 'active' && data.status !== 'inactive' && data.status !== 'archived') {
      throw HttpError.badRequest("status must be 'active', 'inactive', or 'archived'.", { field: 'status' })
    }
    status = data.status
  }

  return {
    name,
    customerCode,
    type,
    companyName: typeof data.companyName === 'string' ? data.companyName.trim() || undefined : undefined,
    phone: typeof data.phone === 'string' ? data.phone.trim() || undefined : undefined,
    email: typeof data.email === 'string' ? data.email.trim().toLowerCase() || undefined : undefined,
    taxNumber: typeof data.taxNumber === 'string' ? data.taxNumber.trim() || undefined : undefined,
    address: typeof data.address === 'string' ? data.address.trim() || undefined : undefined,
    city: typeof data.city === 'string' ? data.city.trim() || undefined : undefined,
    notes: typeof data.notes === 'string' ? data.notes.trim() || undefined : undefined,
    openingBalanceMinor,
    creditLimitMinor,
    status,
  }
}

export function validateUpdateCustomer(raw: unknown): UpdateCustomerInput {
  if (!raw || typeof raw !== 'object') {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const data = raw as Record<string, unknown>
  const output: UpdateCustomerInput = {}

  if (data.name !== undefined) {
    if (typeof data.name !== 'string' || !data.name.trim()) {
      throw HttpError.badRequest('Customer name cannot be empty.', { field: 'name' })
    }
    output.name = data.name.trim()
  }

  if (data.type !== undefined) {
    if (data.type !== 'individual' && data.type !== 'business') {
      throw HttpError.badRequest("Customer type must be either 'individual' or 'business'.", { field: 'type' })
    }
    output.type = data.type
  }

  if (data.companyName !== undefined) {
    output.companyName = typeof data.companyName === 'string' ? data.companyName.trim() || undefined : undefined
  }
  if (data.phone !== undefined) {
    output.phone = typeof data.phone === 'string' ? data.phone.trim() || undefined : undefined
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
  if (data.notes !== undefined) {
    output.notes = typeof data.notes === 'string' ? data.notes.trim() || undefined : undefined
  }

  if (data.creditLimitMinor !== undefined) {
    const val = Number(data.creditLimitMinor)
    if (!Number.isInteger(val) || val < 0) {
      throw HttpError.badRequest('creditLimitMinor must be a non-negative integer.', { field: 'creditLimitMinor' })
    }
    output.creditLimitMinor = val
  } else if (data.creditLimit !== undefined) {
    output.creditLimitMinor = Math.max(0, Math.round(Number(data.creditLimit) * 100))
  }

  if (data.status !== undefined) {
    if (data.status !== 'active' && data.status !== 'inactive' && data.status !== 'archived') {
      throw HttpError.badRequest("status must be 'active', 'inactive', or 'archived'.", { field: 'status' })
    }
    output.status = data.status
  }

  return output
}

export function parseCustomerQueryParams(url: URL): CustomerFilterParams {
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50))
  const search = url.searchParams.get('search')?.trim() || url.searchParams.get('q')?.trim() || undefined
  const rawStatus = url.searchParams.get('status')?.trim().toLowerCase()
  const status = (rawStatus === 'active' || rawStatus === 'inactive' || rawStatus === 'archived' || rawStatus === 'all')
    ? rawStatus
    : undefined
  const rawType = url.searchParams.get('type')?.trim().toLowerCase()
  const type = (rawType === 'individual' || rawType === 'business') ? rawType : undefined
  const includeWalkIn = url.searchParams.get('includeWalkIn') === 'true' || url.searchParams.get('include_walk_in') === 'true'

  return { page, limit, search, status, type, includeWalkIn }
}

