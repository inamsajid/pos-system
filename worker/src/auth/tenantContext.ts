import { HttpError } from '../lib/errors'

export type MemberRole = 'owner' | 'admin' | 'manager' | 'cashier' | 'accountant' | 'inventory_manager'

export interface BusinessSummary {
  id: string
  business_code: string
  name: string
  currency: string
  status: string
  role: MemberRole
}

export interface BranchSummary {
  id: string
  business_id: string
  branch_code: string
  name: string
  is_main_branch: boolean
  status: string
}

export interface TenantContext {
  business: {
    id: string
    business_code: string
    name: string
    currency: string
    status: string
  }
  membership: {
    id: string
    role: MemberRole
  }
  branch?: BranchSummary
}

export type Permission =
  | 'manage_settings'
  | 'settings_read'
  | 'manage_staff'
  | 'staff_read'
  | 'catalog_read'
  | 'catalog_write'
  | 'customer_read'
  | 'customer_write'
  | 'supplier_read'
  | 'supplier_write'
  | 'pos_sale'
  | 'sales_read'
  | 'apply_discount'
  | 'discount_override'
  | 'price_override'
  | 'tax_override'
  | 'void_sale'
  | 'collect_payments'
  | 'inventory_read'
  | 'stock_adjustment'
  | 'stocktake_confirm'
  | 'purchase_read'
  | 'purchase_order'
  | 'receive_goods'
  | 'disburse_payments'
  | 'reports_view'
  | 'export_backup'
  | 'expenses_read'
  | 'expenses_write'
  | 'sync_use'
  | 'files_read'
  | 'files_upload'
  | 'files_delete'

export const ROLE_PERMISSIONS: Record<MemberRole, readonly Permission[]> = {
  owner: [
    'manage_settings',
    'settings_read',
    'manage_staff',
    'staff_read',
    'catalog_read',
    'catalog_write',
    'customer_read',
    'customer_write',
    'supplier_read',
    'supplier_write',
    'pos_sale',
    'sales_read',
    'apply_discount',
    'discount_override',
    'price_override',
    'tax_override',
    'void_sale',
    'collect_payments',
    'inventory_read',
    'stock_adjustment',
    'stocktake_confirm',
    'purchase_read',
    'purchase_order',
    'receive_goods',
    'disburse_payments',
    'reports_view',
    'export_backup',
    'expenses_read',
    'expenses_write',
    'sync_use',
    'files_read',
    'files_upload',
    'files_delete',
  ],
  admin: [
    'settings_read',
    'manage_staff',
    'staff_read',
    'catalog_read',
    'catalog_write',
    'customer_read',
    'customer_write',
    'supplier_read',
    'supplier_write',
    'pos_sale',
    'sales_read',
    'apply_discount',
    'discount_override',
    'price_override',
    'tax_override',
    'void_sale',
    'collect_payments',
    'inventory_read',
    'stock_adjustment',
    'stocktake_confirm',
    'purchase_read',
    'purchase_order',
    'receive_goods',
    'disburse_payments',
    'reports_view',
    'expenses_read',
    'expenses_write',
    'sync_use',
    'files_read',
    'files_upload',
    'files_delete',
  ],
  manager: [
    'settings_read',
    'staff_read',
    'catalog_read',
    'catalog_write',
    'customer_read',
    'customer_write',
    'supplier_read',
    'supplier_write',
    'pos_sale',
    'sales_read',
    'apply_discount',
    'discount_override',
    'price_override',
    'tax_override',
    'void_sale',
    'collect_payments',
    'inventory_read',
    'stock_adjustment',
    'stocktake_confirm',
    'purchase_read',
    'purchase_order',
    'receive_goods',
    'disburse_payments',
    'reports_view',
    'expenses_read',
    'expenses_write',
    'sync_use',
    'files_read',
    'files_upload',
    'files_delete',
  ],
  cashier: [
    'catalog_read',
    'customer_read',
    'pos_sale',
    'sales_read',
    'apply_discount',
    'collect_payments',
    'sync_use',
    'files_read',
    'files_upload',
  ],
  inventory_manager: [
    'catalog_read',
    'catalog_write',
    'supplier_read',
    'supplier_write',
    'inventory_read',
    'stock_adjustment',
    'stocktake_confirm',
    'purchase_read',
    'purchase_order',
    'receive_goods',
    'files_read',
    'files_upload',
  ],
  accountant: [
    'catalog_read',
    'customer_read',
    'supplier_read',
    'sales_read',
    'collect_payments',
    'inventory_read',
    'purchase_read',
    'disburse_payments',
    'reports_view',
    'expenses_read',
    'expenses_write',
    'files_read',
    'files_upload',
  ],
}

/**
 * Checks whether a given role holds the requested permission.
 */
export function hasPermission(role: MemberRole, permission: Permission): boolean {
  const allowed = ROLE_PERMISSIONS[role]
  return allowed ? allowed.includes(permission) : false
}

/**
 * Retrieves all active business memberships for a given user.
 */
export async function getUserBusinesses(db: D1Database, userId: string): Promise<BusinessSummary[]> {
  const result = await db
    .prepare(
      `SELECT
         b.id,
         b.business_code,
         b.name,
         b.currency,
         b.status,
         bm.role
       FROM business_members bm
       INNER JOIN businesses b ON bm.business_id = b.id
       WHERE bm.user_id = ? AND bm.is_active = 1 AND b.status = 'active'
       ORDER BY b.created_at ASC`
    )
    .bind(userId)
    .all<BusinessSummary>()

  return result.results || []
}

/**
 * Resolves the business context from request header `X-Business-Id` or single membership fallback.
 */
export async function resolveBusinessContext(
  db: D1Database,
  userId: string,
  requestedBusinessId?: string | null
): Promise<{
  business: { id: string; business_code: string; name: string; currency: string; status: string }
  membership: { id: string; role: MemberRole }
}> {
  const businesses = await getUserBusinesses(db, userId)

  if (businesses.length === 0) {
    throw new HttpError(403, 'FORBIDDEN', 'User is not an active member of any business.')
  }

  let selectedBusiness: BusinessSummary | undefined

  if (requestedBusinessId) {
    selectedBusiness = businesses.find((b) => b.id === requestedBusinessId)
    if (!selectedBusiness) {
      throw new HttpError(403, 'FORBIDDEN', 'Access to specified business is denied.')
    }
  } else {
    // If only 1 business is available, auto-select it.
    if (businesses.length === 1) {
      selectedBusiness = businesses[0]
    } else {
      throw new HttpError(
        400,
        'VALIDATION_ERROR',
        'Multiple businesses accessible. Specify target business via X-Business-Id header.',
        {
          availableBusinesses: businesses.map((b) => ({ id: b.id, name: b.name })),
        }
      )
    }
  }

  // Fetch full membership record ID
  const memberRecord = await db
    .prepare(
      `SELECT id, role FROM business_members
       WHERE business_id = ? AND user_id = ? AND is_active = 1`
    )
    .bind(selectedBusiness.id, userId)
    .first<{ id: string; role: MemberRole }>()

  if (!memberRecord) {
    throw new HttpError(403, 'FORBIDDEN', 'Membership verification failed.')
  }

  return {
    business: {
      id: selectedBusiness.id,
      business_code: selectedBusiness.business_code,
      name: selectedBusiness.name,
      currency: selectedBusiness.currency,
      status: selectedBusiness.status,
    },
    membership: {
      id: memberRecord.id,
      role: memberRecord.role,
    },
  }
}

/**
 * Retrieves branches accessible to the user within the resolved business.
 */
export async function getUserBranches(
  db: D1Database,
  businessId: string,
  memberId: string,
  role: MemberRole
): Promise<BranchSummary[]> {
  // Owners and Admins have access to all active branches in the business
  if (role === 'owner' || role === 'admin') {
    const allBranches = await db
      .prepare(
        `SELECT id, business_id, branch_code, name, is_main_branch, status
         FROM branches
         WHERE business_id = ? AND status = 'active'
         ORDER BY is_main_branch DESC, name ASC`
      )
      .bind(businessId)
      .all<BranchSummary>()

    return allBranches.results || []
  }

  // Other roles: check assigned member_branches
  const assigned = await db
    .prepare(
      `SELECT b.id, b.business_id, b.branch_code, b.name, b.is_main_branch, b.status
       FROM member_branches mb
       INNER JOIN branches b ON mb.branch_id = b.id
       WHERE mb.member_id = ? AND b.business_id = ? AND b.status = 'active'
       ORDER BY b.is_main_branch DESC, b.name ASC`
    )
    .bind(memberId, businessId)
    .all<BranchSummary>()

  // Explicit branch assignments are mandatory for non-owner/admin roles (fail closed on zero branches).
  return assigned.results || []
}

/**
 * Resolves the branch context for a request.
 */
export async function resolveBranchContext(
  db: D1Database,
  businessId: string,
  memberId: string,
  role: MemberRole,
  requestedBranchId?: string | null
): Promise<BranchSummary> {
  const branches = await getUserBranches(db, businessId, memberId, role)

  if (branches.length === 0) {
    throw new HttpError(403, 'FORBIDDEN', 'No accessible branches in this business.')
  }

  if (requestedBranchId) {
    const selected = branches.find((b) => b.id === requestedBranchId)
    if (!selected) {
      throw new HttpError(403, 'FORBIDDEN', 'Access to specified branch is denied or branch does not belong to business.')
    }
    return selected
  }

  // If only 1 branch exists or user has 1 branch, auto-select it.
  if (branches.length === 1) {
    return branches[0]
  }

  throw new HttpError(
    400,
    'VALIDATION_ERROR',
    'Multiple branches accessible. Specify target branch via X-Branch-Id header.',
    {
      availableBranches: branches.map((b) => ({ id: b.id, name: b.name })),
    }
  )
}

/**
 * Resolves the branch IDs the user is authorized to view stock for.
 * - If requestedBranchId is provided, validates user access and returns [requestedBranchId].
 * - If omitted, returns all branch IDs accessible to the user in this business (all branches for owner/admin, assigned branches for staff).
 */
export async function resolveAuthorizedBranchIds(
  db: D1Database,
  businessId: string,
  memberId: string,
  role: MemberRole,
  requestedBranchId?: string | null
): Promise<string[]> {
  const branches = await getUserBranches(db, businessId, memberId, role)

  if (requestedBranchId) {
    const selected = branches.find((b) => b.id === requestedBranchId)
    if (!selected) {
      throw new HttpError(
        403,
        'FORBIDDEN',
        'Access to specified branch is denied or branch does not belong to business.'
      )
    }
    return [selected.id]
  }

  return branches.map((b) => b.id)
}

