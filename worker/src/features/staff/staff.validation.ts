import { HttpError } from '../../lib/errors'
import type { MemberRole } from '../../auth/tenantContext'
import type {
  InviteStaffInput,
  UpdateStaffRoleInput,
  UpdateStaffBranchesInput,
  StaffFilterParams,
} from './staff.types'

const VALID_ROLES: MemberRole[] = [
  'owner',
  'admin',
  'manager',
  'cashier',
  'accountant',
  'inventory_manager',
]

export function validateInviteStaffInput(data: unknown): InviteStaffInput {
  if (!data || typeof data !== 'object') {
    throw HttpError.badRequest('Request body must be a valid JSON object.')
  }

  const { email, role, branchIds } = data as Record<string, unknown>

  if (!email || typeof email !== 'string' || !email.trim()) {
    throw HttpError.badRequest('Email is required.')
  }

  const normalizedEmail = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw HttpError.badRequest('A valid email address is required.')
  }

  if (!role || typeof role !== 'string' || !VALID_ROLES.includes(role as MemberRole)) {
    throw HttpError.badRequest(`Role must be one of: ${VALID_ROLES.join(', ')}.`)
  }

  let cleanedBranchIds: string[] | undefined = undefined
  if (branchIds !== undefined) {
    if (!Array.isArray(branchIds)) {
      throw HttpError.badRequest('branchIds must be an array of branch ID strings.')
    }
    cleanedBranchIds = branchIds.filter(id => typeof id === 'string' && id.trim().length > 0)
  }

  return {
    email: normalizedEmail,
    role: role as MemberRole,
    branchIds: cleanedBranchIds,
  }
}

export function validateUpdateStaffRoleInput(data: unknown): UpdateStaffRoleInput {
  if (!data || typeof data !== 'object') {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const { role } = data as Record<string, unknown>
  if (!role || typeof role !== 'string' || !VALID_ROLES.includes(role as MemberRole)) {
    throw HttpError.badRequest(`Role must be one of: ${VALID_ROLES.join(', ')}.`)
  }

  return {
    role: role as MemberRole,
  }
}

export function validateUpdateStaffBranchesInput(data: unknown): UpdateStaffBranchesInput {
  if (!data || typeof data !== 'object') {
    throw HttpError.badRequest('Request body must be a JSON object.')
  }

  const { branchIds } = data as Record<string, unknown>
  if (!Array.isArray(branchIds)) {
    throw HttpError.badRequest('branchIds must be an array of branch IDs.')
  }

  return {
    branchIds: branchIds.filter(id => typeof id === 'string' && id.trim().length > 0),
  }
}

export function parseStaffFilterParams(url: URL): StaffFilterParams {
  const search = url.searchParams.get('search')?.trim() || undefined
  const roleParam = url.searchParams.get('role')
  const branchId = url.searchParams.get('branchId') || undefined
  const activeParam = url.searchParams.get('isActive')

  const role = roleParam && VALID_ROLES.includes(roleParam as MemberRole) ? (roleParam as MemberRole) : undefined
  const isActive = activeParam !== null ? activeParam === 'true' || activeParam === '1' : undefined

  return {
    search,
    role,
    branchId,
    isActive,
  }
}

