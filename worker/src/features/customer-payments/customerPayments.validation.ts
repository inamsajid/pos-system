import { HttpError } from '../../lib/errors'
import type {
  CreateCustomerPaymentInput,
  AllocateAdvanceInput,
  PaymentMethodEntry,
  PaymentAllocationItemInput,
  PaymentMethodType,
  CustomerPaymentFilterParams,
} from './customerPayments.types'

const ALLOWED_PAYMENT_METHODS: PaymentMethodType[] = [
  'cash',
  'card',
  'bank_transfer',
  'digital_wallet',
  'other',
]

export function validateCreateCustomerPaymentInput(body: unknown): CreateCustomerPaymentInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const raw = body as Record<string, unknown>

  if (!raw.customerId || typeof raw.customerId !== 'string' || raw.customerId.trim().length === 0) {
    throw HttpError.badRequest('Customer ID is required.', { field: 'customerId' })
  }

  if (
    typeof raw.amountMinor !== 'number' ||
    !Number.isInteger(raw.amountMinor) ||
    raw.amountMinor <= 0
  ) {
    throw HttpError.badRequest('Payment amount must be a positive integer in minor units.', {
      field: 'amountMinor',
    })
  }

  if (!Array.isArray(raw.paymentMethods) || raw.paymentMethods.length === 0) {
    throw HttpError.badRequest('At least one payment method is required.', {
      field: 'paymentMethods',
    })
  }

  const validatedMethods: PaymentMethodEntry[] = []
  let methodsSum = 0

  for (let i = 0; i < raw.paymentMethods.length; i++) {
    const pm = raw.paymentMethods[i]
    if (!pm || typeof pm !== 'object') {
      throw HttpError.badRequest(`Payment method at index ${i} is invalid.`, {
        field: `paymentMethods[${i}]`,
      })
    }

    const { method, amountMinor, reference } = pm as Record<string, unknown>

    if (typeof method !== 'string' || !ALLOWED_PAYMENT_METHODS.includes(method as PaymentMethodType)) {
      throw HttpError.badRequest(
        `Invalid payment method '${String(method)}' at index ${i}. Allowed: ${ALLOWED_PAYMENT_METHODS.join(', ')}`,
        { field: `paymentMethods[${i}].method` }
      )
    }

    if (typeof amountMinor !== 'number' || !Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw HttpError.badRequest(
        `Payment method amount at index ${i} must be a positive integer in minor units.`,
        { field: `paymentMethods[${i}].amountMinor` }
      )
    }

    methodsSum += amountMinor
    validatedMethods.push({
      method: method as PaymentMethodType,
      amountMinor,
      reference: typeof reference === 'string' && reference.trim().length > 0 ? reference.trim() : null,
    })
  }

  if (methodsSum !== raw.amountMinor) {
    throw HttpError.badRequest(
      `Sum of payment methods (${methodsSum}) does not match total payment amount (${raw.amountMinor}).`,
      { field: 'paymentMethods' }
    )
  }

  let validatedAllocations: PaymentAllocationItemInput[] | undefined
  if (raw.allocations !== undefined) {
    if (!Array.isArray(raw.allocations)) {
      throw HttpError.badRequest('Allocations must be an array if provided.', {
        field: 'allocations',
      })
    }

    let allocSum = 0
    validatedAllocations = []

    for (let i = 0; i < raw.allocations.length; i++) {
      const alloc = raw.allocations[i]
      if (!alloc || typeof alloc !== 'object') {
        throw HttpError.badRequest(`Allocation at index ${i} is invalid.`, {
          field: `allocations[${i}]`,
        })
      }

      const { invoiceId, amountMinor } = alloc as Record<string, unknown>

      if (!invoiceId || typeof invoiceId !== 'string' || invoiceId.trim().length === 0) {
        throw HttpError.badRequest(`Invoice ID is required at allocation index ${i}.`, {
          field: `allocations[${i}].invoiceId`,
        })
      }

      if (typeof amountMinor !== 'number' || !Number.isInteger(amountMinor) || amountMinor <= 0) {
        throw HttpError.badRequest(
          `Allocation amount at index ${i} must be a positive integer in minor units.`,
          { field: `allocations[${i}].amountMinor` }
        )
      }

      allocSum += amountMinor
      validatedAllocations.push({
        invoiceId: invoiceId.trim(),
        amountMinor,
      })
    }

    if (allocSum > raw.amountMinor) {
      throw HttpError.badRequest(
        `Total allocated amount (${allocSum}) cannot exceed payment amount (${raw.amountMinor}).`,
        { field: 'allocations' }
      )
    }
  }

  return {
    branchId: typeof raw.branchId === 'string' && raw.branchId.trim().length > 0 ? raw.branchId.trim() : undefined,
    customerId: raw.customerId.trim(),
    amountMinor: raw.amountMinor,
    paymentMethods: validatedMethods,
    allocations: validatedAllocations,
    notes: typeof raw.notes === 'string' && raw.notes.trim().length > 0 ? raw.notes.trim() : null,
  }
}

export function validateAllocateAdvanceInput(body: unknown): AllocateAdvanceInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const raw = body as Record<string, unknown>

  if (!Array.isArray(raw.allocations) || raw.allocations.length === 0) {
    throw HttpError.badRequest('At least one allocation item is required.', {
      field: 'allocations',
    })
  }

  const validatedAllocations: PaymentAllocationItemInput[] = []
  for (let i = 0; i < raw.allocations.length; i++) {
    const alloc = raw.allocations[i]
    if (!alloc || typeof alloc !== 'object') {
      throw HttpError.badRequest(`Allocation at index ${i} is invalid.`, {
        field: `allocations[${i}]`,
      })
    }

    const { invoiceId, amountMinor } = alloc as Record<string, unknown>

    if (!invoiceId || typeof invoiceId !== 'string' || invoiceId.trim().length === 0) {
      throw HttpError.badRequest(`Invoice ID is required at allocation index ${i}.`, {
        field: `allocations[${i}].invoiceId`,
      })
    }

    if (typeof amountMinor !== 'number' || !Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw HttpError.badRequest(
        `Allocation amount at index ${i} must be a positive integer in minor units.`,
        { field: `allocations[${i}].amountMinor` }
      )
    }

    validatedAllocations.push({
      invoiceId: invoiceId.trim(),
      amountMinor,
    })
  }

  return {
    allocations: validatedAllocations,
  }
}

export function parseCustomerPaymentQueryParams(url: URL): CustomerPaymentFilterParams {
  const branchId = url.searchParams.get('branchId') || undefined
  const customerId = url.searchParams.get('customerId') || undefined
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
    customerId,
    startDate,
    endDate,
    page,
    limit,
  }
}

