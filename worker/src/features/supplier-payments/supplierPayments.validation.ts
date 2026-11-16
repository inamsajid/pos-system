import { HttpError } from '../../lib/errors'
import type {
  CreateSupplierPaymentInput,
  AllocateSupplierAdvanceInput,
  SupplierPaymentAllocationInput,
  SupplierPaymentMethod,
  SupplierPaymentFilterParams,
} from './supplierPayments.types'

const ALLOWED_METHODS: SupplierPaymentMethod[] = ['cash', 'bank_transfer', 'card', 'other']

export function validateCreateSupplierPaymentInput(body: unknown): CreateSupplierPaymentInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const raw = body as Record<string, unknown>

  if (!raw.supplierId || typeof raw.supplierId !== 'string' || raw.supplierId.trim().length === 0) {
    throw HttpError.badRequest('Supplier ID is required.', { field: 'supplierId' })
  }

  if (
    typeof raw.amountMinor !== 'number' ||
    !Number.isInteger(raw.amountMinor) ||
    raw.amountMinor <= 0
  ) {
    throw HttpError.badRequest('Payment amount must be a positive integer in minor units (paise).', {
      field: 'amountMinor',
    })
  }

  let validatedPaymentMethods: CreateSupplierPaymentInput['paymentMethods']
  let primaryMethod: SupplierPaymentMethod = 'cash'
  let primaryReference: string | null = null

  if (raw.paymentMethods !== undefined) {
    if (!Array.isArray(raw.paymentMethods) || raw.paymentMethods.length === 0) {
      throw HttpError.badRequest('Payment methods must be a non-empty array when provided.', {
        field: 'paymentMethods',
      })
    }

    let methodSum = 0
    validatedPaymentMethods = []

    for (let i = 0; i < raw.paymentMethods.length; i++) {
      const pm = raw.paymentMethods[i]
      if (!pm || typeof pm !== 'object') {
        throw HttpError.badRequest(`Payment method at index ${i} is invalid.`, {
          field: `paymentMethods[${i}]`,
        })
      }

      const { method: pmMethod, amountMinor: pmAmount, reference: pmRef } = pm as Record<string, unknown>

      if (typeof pmMethod !== 'string' || !ALLOWED_METHODS.includes(pmMethod as SupplierPaymentMethod)) {
        throw HttpError.badRequest(
          `Payment method at index ${i} must be one of: ${ALLOWED_METHODS.join(', ')}`,
          { field: `paymentMethods[${i}].method` }
        )
      }

      if (typeof pmAmount !== 'number' || !Number.isInteger(pmAmount) || pmAmount <= 0) {
        throw HttpError.badRequest(
          `Payment method amount at index ${i} must be a positive integer in minor units.`,
          { field: `paymentMethods[${i}].amountMinor` }
        )
      }

      methodSum += pmAmount
      validatedPaymentMethods.push({
        method: pmMethod as SupplierPaymentMethod,
        amountMinor: pmAmount,
        reference: typeof pmRef === 'string' && pmRef.trim().length > 0 ? pmRef.trim() : null,
      })
    }

    if (methodSum !== raw.amountMinor) {
      throw HttpError.badRequest(
        `Sum of payment methods (${methodSum}) must equal the total payment amount (${raw.amountMinor}).`,
        { field: 'paymentMethods' }
      )
    }

    primaryMethod = validatedPaymentMethods[0].method
    primaryReference = validatedPaymentMethods[0].reference || null
  } else {
    if (
      typeof raw.method !== 'string' ||
      !ALLOWED_METHODS.includes(raw.method as SupplierPaymentMethod)
    ) {
      throw HttpError.badRequest(
        `Payment method must be one of: ${ALLOWED_METHODS.join(', ')}`,
        { field: 'method' }
      )
    }
    primaryMethod = raw.method as SupplierPaymentMethod
    primaryReference = typeof raw.reference === 'string' && raw.reference.trim().length > 0 ? raw.reference.trim() : null
    validatedPaymentMethods = [
      {
        method: primaryMethod,
        amountMinor: raw.amountMinor,
        reference: primaryReference,
      },
    ]
  }

  let validatedAllocations: SupplierPaymentAllocationInput[] | undefined
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

      const { purchaseId, amountMinor } = alloc as Record<string, unknown>

      if (!purchaseId || typeof purchaseId !== 'string' || purchaseId.trim().length === 0) {
        throw HttpError.badRequest(`Purchase ID is required at allocation index ${i}.`, {
          field: `allocations[${i}].purchaseId`,
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
        purchaseId: purchaseId.trim(),
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
    supplierId: raw.supplierId.trim(),
    amountMinor: raw.amountMinor,
    method: primaryMethod,
    reference: primaryReference,
    paymentMethods: validatedPaymentMethods,
    notes: typeof raw.notes === 'string' && raw.notes.trim().length > 0 ? raw.notes.trim() : null,
    allocations: validatedAllocations,
  }
}

export function validateAllocateSupplierAdvanceInput(body: unknown): AllocateSupplierAdvanceInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const raw = body as Record<string, unknown>

  if (!Array.isArray(raw.allocations) || raw.allocations.length === 0) {
    throw HttpError.badRequest('At least one allocation item is required.', {
      field: 'allocations',
    })
  }

  const validatedAllocations: SupplierPaymentAllocationInput[] = []
  for (let i = 0; i < raw.allocations.length; i++) {
    const alloc = raw.allocations[i]
    if (!alloc || typeof alloc !== 'object') {
      throw HttpError.badRequest(`Allocation at index ${i} is invalid.`, {
        field: `allocations[${i}]`,
      })
    }

    const { purchaseId, amountMinor } = alloc as Record<string, unknown>

    if (!purchaseId || typeof purchaseId !== 'string' || purchaseId.trim().length === 0) {
      throw HttpError.badRequest(`Purchase ID is required at allocation index ${i}.`, {
        field: `allocations[${i}].purchaseId`,
      })
    }

    if (typeof amountMinor !== 'number' || !Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw HttpError.badRequest(
        `Allocation amount at index ${i} must be a positive integer in minor units.`,
        { field: `allocations[${i}].amountMinor` }
      )
    }

    validatedAllocations.push({
      purchaseId: purchaseId.trim(),
      amountMinor,
    })
  }

  return {
    allocations: validatedAllocations,
  }
}

export function parseSupplierPaymentQueryParams(url: URL): SupplierPaymentFilterParams {
  const branchId = url.searchParams.get('branchId') || undefined
  const supplierId = url.searchParams.get('supplierId') || undefined
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
    startDate,
    endDate,
    page,
    limit,
  }
}

