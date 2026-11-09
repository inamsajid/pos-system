import { HttpError } from '../../lib/errors'
import type {
  CreateExpenseInput,
  VoidExpenseInput,
  CreateCategoryInput,
  ExpenseFilterParams,
  ExpensePaymentMethod,
  ExpenseStatus,
} from './expenses.types'

const VALID_METHODS: ExpensePaymentMethod[] = ['cash', 'bank_transfer', 'card', 'other']
const VALID_STATUSES: ExpenseStatus[] = ['posted', 'voided']

export function validateCreateExpenseInput(data: unknown): CreateExpenseInput {
  if (!data || typeof data !== 'object') {
    throw HttpError.badRequest('Request body must be a valid JSON object.')
  }

  const { branchId, categoryId, amountMinor, amount, paymentMethod, title, notes, receiptAttachmentUrl, businessDateKey } =
    data as Record<string, unknown>

  if (!branchId || typeof branchId !== 'string' || !branchId.trim()) {
    throw HttpError.badRequest('branchId is required.')
  }

  if (!categoryId || typeof categoryId !== 'string' || !categoryId.trim()) {
    throw HttpError.badRequest('categoryId is required.')
  }

  // Support both amountMinor (integer) or amount (float currency in Rupees)
  let calculatedAmountMinor: number
  if (typeof amountMinor === 'number') {
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw HttpError.badRequest('amountMinor must be a positive integer in minor units (paise).')
    }
    calculatedAmountMinor = amountMinor
  } else if (typeof amount === 'number') {
    if (amount <= 0 || Number.isNaN(amount)) {
      throw HttpError.badRequest('amount must be greater than zero.')
    }
    calculatedAmountMinor = Math.round(amount * 100)
  } else {
    throw HttpError.badRequest('amountMinor or amount is required.')
  }

  if (!paymentMethod || typeof paymentMethod !== 'string' || !VALID_METHODS.includes(paymentMethod as ExpensePaymentMethod)) {
    throw HttpError.badRequest(`paymentMethod must be one of: ${VALID_METHODS.join(', ')}.`)
  }

  if (!title || typeof title !== 'string' || !title.trim()) {
    throw HttpError.badRequest('title is required and cannot be empty.')
  }

  if (title.trim().length > 255) {
    throw HttpError.badRequest('title cannot exceed 255 characters.')
  }

  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    throw HttpError.badRequest('notes must be a string if provided.')
  }

  if (receiptAttachmentUrl !== undefined && receiptAttachmentUrl !== null && typeof receiptAttachmentUrl !== 'string') {
    throw HttpError.badRequest('receiptAttachmentUrl must be a string if provided.')
  }

  if (businessDateKey !== undefined && businessDateKey !== null && typeof businessDateKey !== 'string') {
    throw HttpError.badRequest('businessDateKey must be a string if provided.')
  }

  return {
    branchId: branchId.trim(),
    categoryId: categoryId.trim(),
    amountMinor: calculatedAmountMinor,
    paymentMethod: paymentMethod as ExpensePaymentMethod,
    title: title.trim(),
    notes: typeof notes === 'string' ? notes.trim() : undefined,
    receiptAttachmentUrl: typeof receiptAttachmentUrl === 'string' ? receiptAttachmentUrl.trim() : undefined,
    businessDateKey: typeof businessDateKey === 'string' ? businessDateKey.trim() : undefined,
  }
}

export function validateVoidExpenseInput(data: unknown): VoidExpenseInput {
  if (!data || typeof data !== 'object') {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const { reason } = data as Record<string, unknown>
  if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
    throw HttpError.badRequest('A void reason of at least 3 characters is mandatory.')
  }

  return {
    reason: reason.trim(),
  }
}

export function validateCreateCategoryInput(data: unknown): CreateCategoryInput {
  if (!data || typeof data !== 'object') {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const { name, description } = data as Record<string, unknown>
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw HttpError.badRequest('Category name is required.')
  }

  if (name.trim().length > 100) {
    throw HttpError.badRequest('Category name cannot exceed 100 characters.')
  }

  return {
    name: name.trim(),
    description: typeof description === 'string' ? description.trim() : undefined,
  }
}

export function validateUpdateExpenseInput(data: unknown): {
  title?: string
  notes?: string | null
  receiptAttachmentUrl?: string | null
} {
  if (!data || typeof data !== 'object') {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const { title, notes, receiptAttachmentUrl } = data as Record<string, unknown>
  const result: { title?: string; notes?: string | null; receiptAttachmentUrl?: string | null } = {}

  if (title !== undefined) {
    if (typeof title !== 'string' || !title.trim()) {
      throw HttpError.badRequest('title must be a non-empty string.')
    }
    if (title.trim().length > 255) {
      throw HttpError.badRequest('title cannot exceed 255 characters.')
    }
    result.title = title.trim()
  }

  if (notes !== undefined) {
    if (notes === null || notes === '') {
      result.notes = null
    } else if (typeof notes === 'string') {
      result.notes = notes.trim()
    } else {
      throw HttpError.badRequest('notes must be a string or null.')
    }
  }

  if (receiptAttachmentUrl !== undefined) {
    if (receiptAttachmentUrl === null || receiptAttachmentUrl === '') {
      result.receiptAttachmentUrl = null
    } else if (typeof receiptAttachmentUrl === 'string') {
      result.receiptAttachmentUrl = receiptAttachmentUrl.trim()
    } else {
      throw HttpError.badRequest('receiptAttachmentUrl must be a string or null.')
    }
  }

  return result
}

export function validateUpdateCategoryInput(data: unknown): {
  name?: string
  description?: string | null
  status?: 'active' | 'archived'
} {
  if (!data || typeof data !== 'object') {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const { name, description, status } = data as Record<string, unknown>
  const result: { name?: string; description?: string | null; status?: 'active' | 'archived' } = {}

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      throw HttpError.badRequest('Category name cannot be empty.')
    }
    if (name.trim().length > 100) {
      throw HttpError.badRequest('Category name cannot exceed 100 characters.')
    }
    result.name = name.trim()
  }

  if (description !== undefined) {
    if (description === null || description === '') {
      result.description = null
    } else if (typeof description === 'string') {
      result.description = description.trim()
    } else {
      throw HttpError.badRequest('description must be a string or null.')
    }
  }

  if (status !== undefined) {
    if (status !== 'active' && status !== 'archived') {
      throw HttpError.badRequest('status must be either active or archived.')
    }
    result.status = status
  }

  return result
}

export function parseExpenseFilterParams(url: URL): ExpenseFilterParams {
  const branchId = url.searchParams.get('branchId') || url.searchParams.get('branch_id') || undefined
  const categoryId = url.searchParams.get('categoryId') || url.searchParams.get('category_id') || undefined
  const paymentMethodParam = url.searchParams.get('paymentMethod') || url.searchParams.get('payment_method')
  const statusParam = url.searchParams.get('status')
  const startDate = url.searchParams.get('startDate') || url.searchParams.get('start_date') || undefined
  const endDate = url.searchParams.get('endDate') || url.searchParams.get('end_date') || undefined
  const search = url.searchParams.get('search')?.trim() || undefined

  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50))

  const paymentMethod =
    paymentMethodParam && VALID_METHODS.includes(paymentMethodParam as ExpensePaymentMethod)
      ? (paymentMethodParam as ExpensePaymentMethod)
      : undefined

  const status =
    statusParam && VALID_STATUSES.includes(statusParam as ExpenseStatus)
      ? (statusParam as ExpenseStatus)
      : undefined

  return {
    branchId: branchId || undefined,
    categoryId: categoryId || undefined,
    paymentMethod,
    status,
    startDate,
    endDate,
    search,
    page,
    limit,
  }
}

