import { HttpError } from '../../lib/errors'
import type { CreateCategoryInput, UpdateCategoryInput, ReplaceCategoryInput, CategoryStatus } from './categories.types'

export function generateCategorySlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'category'
}

export function validateCreateCategoryInput(input: unknown): CreateCategoryInput {
  if (!input || typeof input !== 'object') {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const raw = input as Record<string, unknown>

  if (typeof raw.name !== 'string' || raw.name.trim().length < 2) {
    throw HttpError.badRequest('Category name must be at least 2 characters.', { field: 'name' })
  }
  if (raw.name.trim().length > 100) {
    throw HttpError.badRequest('Category name must not exceed 100 characters.', { field: 'name' })
  }

  let slug: string | undefined
  if (raw.slug !== undefined && raw.slug !== null) {
    if (typeof raw.slug !== 'string') {
      throw HttpError.badRequest('Category slug must be a string.', { field: 'slug' })
    }
    const trimmedSlug = raw.slug.trim().toLowerCase()
    if (trimmedSlug.length < 2 || trimmedSlug.length > 100) {
      throw HttpError.badRequest('Category slug must be between 2 and 100 characters.', { field: 'slug' })
    }
    if (!/^[a-z0-9-]+$/.test(trimmedSlug)) {
      throw HttpError.badRequest('Category slug may only contain lowercase letters, numbers, and hyphens.', {
        field: 'slug',
      })
    }
    slug = trimmedSlug
  } else {
    slug = generateCategorySlug(raw.name)
  }

  let description: string | null = null
  if (raw.description !== undefined && raw.description !== null) {
    if (typeof raw.description !== 'string') {
      throw HttpError.badRequest('Description must be a string.', { field: 'description' })
    }
    if (raw.description.length > 1000) {
      throw HttpError.badRequest('Description must not exceed 1000 characters.', { field: 'description' })
    }
    description = raw.description.trim() || null
  }

  let parentId: string | null = null
  if (raw.parentId !== undefined && raw.parentId !== null) {
    if (typeof raw.parentId !== 'string' || !raw.parentId.trim()) {
      throw HttpError.badRequest('Parent category ID must be a non-empty string or null.', { field: 'parentId' })
    }
    parentId = raw.parentId.trim()
  }

  let displayOrder = 0
  if (raw.displayOrder !== undefined && raw.displayOrder !== null) {
    if (typeof raw.displayOrder !== 'number' || !Number.isInteger(raw.displayOrder) || raw.displayOrder < 0) {
      throw HttpError.badRequest('Display order must be a non-negative integer.', { field: 'displayOrder' })
    }
    displayOrder = raw.displayOrder
  }

  return {
    name: raw.name.trim(),
    slug,
    description,
    parentId,
    displayOrder,
  }
}

export function validateUpdateCategoryInput(input: unknown): UpdateCategoryInput {
  if (!input || typeof input !== 'object') {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const raw = input as Record<string, unknown>
  const result: UpdateCategoryInput = {}
  let hasField = false

  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string' || raw.name.trim().length < 2) {
      throw HttpError.badRequest('Category name must be at least 2 characters.', { field: 'name' })
    }
    if (raw.name.trim().length > 100) {
      throw HttpError.badRequest('Category name must not exceed 100 characters.', { field: 'name' })
    }
    result.name = raw.name.trim()
    hasField = true
  }

  if (raw.slug !== undefined) {
    if (raw.slug === null) {
      throw HttpError.badRequest('Category slug cannot be null.', { field: 'slug' })
    }
    if (typeof raw.slug !== 'string') {
      throw HttpError.badRequest('Category slug must be a string.', { field: 'slug' })
    }
    const trimmedSlug = raw.slug.trim().toLowerCase()
    if (trimmedSlug.length < 2 || trimmedSlug.length > 100) {
      throw HttpError.badRequest('Category slug must be between 2 and 100 characters.', { field: 'slug' })
    }
    if (!/^[a-z0-9-]+$/.test(trimmedSlug)) {
      throw HttpError.badRequest('Category slug may only contain lowercase letters, numbers, and hyphens.', {
        field: 'slug',
      })
    }
    result.slug = trimmedSlug
    hasField = true
  }

  if (raw.description !== undefined) {
    if (raw.description === null) {
      result.description = null
    } else if (typeof raw.description !== 'string') {
      throw HttpError.badRequest('Description must be a string or null.', { field: 'description' })
    } else if (raw.description.length > 1000) {
      throw HttpError.badRequest('Description must not exceed 1000 characters.', { field: 'description' })
    } else {
      result.description = raw.description.trim() || null
    }
    hasField = true
  }

  if (raw.parentId !== undefined) {
    if (raw.parentId === null || raw.parentId === '') {
      result.parentId = null
    } else if (typeof raw.parentId !== 'string') {
      throw HttpError.badRequest('Parent ID must be a string or null.', { field: 'parentId' })
    } else {
      result.parentId = raw.parentId.trim()
    }
    hasField = true
  }

  if (raw.displayOrder !== undefined) {
    if (typeof raw.displayOrder !== 'number' || !Number.isInteger(raw.displayOrder) || raw.displayOrder < 0) {
      throw HttpError.badRequest('Display order must be a non-negative integer.', { field: 'displayOrder' })
    }
    result.displayOrder = raw.displayOrder
    hasField = true
  }

  if (raw.status !== undefined) {
    if (raw.status !== 'active' && raw.status !== 'archived') {
      throw HttpError.badRequest("Category status must be either 'active' or 'archived'.", { field: 'status' })
    }
    result.status = raw.status as CategoryStatus
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

export function validateReplaceCategoryInput(input: unknown): ReplaceCategoryInput {
  if (!input || typeof input !== 'object') {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const raw = input as Record<string, unknown>

  if (typeof raw.name !== 'string' || raw.name.trim().length < 2) {
    throw HttpError.badRequest('Category name must be at least 2 characters.', { field: 'name' })
  }
  if (raw.name.trim().length > 100) {
    throw HttpError.badRequest('Category name must not exceed 100 characters.', { field: 'name' })
  }

  let slug: string
  if (raw.slug !== undefined && raw.slug !== null && String(raw.slug).trim()) {
    if (typeof raw.slug !== 'string') {
      throw HttpError.badRequest('Category slug must be a string.', { field: 'slug' })
    }
    const trimmedSlug = raw.slug.trim().toLowerCase()
    if (trimmedSlug.length < 2 || trimmedSlug.length > 100) {
      throw HttpError.badRequest('Category slug must be between 2 and 100 characters.', { field: 'slug' })
    }
    if (!/^[a-z0-9-]+$/.test(trimmedSlug)) {
      throw HttpError.badRequest('Category slug may only contain lowercase letters, numbers, and hyphens.', {
        field: 'slug',
      })
    }
    slug = trimmedSlug
  } else {
    slug = generateCategorySlug(raw.name)
  }

  let description: string | null = null
  if (raw.description !== undefined && raw.description !== null) {
    if (typeof raw.description !== 'string') {
      throw HttpError.badRequest('Description must be a string or null.', { field: 'description' })
    }
    if (raw.description.length > 1000) {
      throw HttpError.badRequest('Description must not exceed 1000 characters.', { field: 'description' })
    }
    description = raw.description.trim() || null
  }

  let parentId: string | null = null
  if (raw.parentId !== undefined && raw.parentId !== null && String(raw.parentId).trim()) {
    if (typeof raw.parentId !== 'string') {
      throw HttpError.badRequest('Parent ID must be a string or null.', { field: 'parentId' })
    }
    parentId = raw.parentId.trim()
  }

  let displayOrder = 0
  if (raw.displayOrder !== undefined && raw.displayOrder !== null) {
    if (typeof raw.displayOrder !== 'number' || !Number.isInteger(raw.displayOrder) || raw.displayOrder < 0) {
      throw HttpError.badRequest('Display order must be a non-negative integer.', { field: 'displayOrder' })
    }
    displayOrder = raw.displayOrder
  }

  let status: CategoryStatus = 'active'
  if (raw.status !== undefined) {
    if (raw.status !== 'active' && raw.status !== 'archived') {
      throw HttpError.badRequest("Category status must be either 'active' or 'archived'.", { field: 'status' })
    }
    status = raw.status as CategoryStatus
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
    slug,
    description,
    parentId,
    displayOrder,
    status,
    expectedVersion,
  }
}

