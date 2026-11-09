import type { UserRole } from '../features/auth/types'

export type Permission =
  | 'manage_settings'
  | 'manage_staff'
  | 'catalog_read'
  | 'catalog_write'
  | 'pos_sale'
  | 'collect_payments'
  | 'stock_adjustment'
  | 'stocktake_confirm'
  | 'purchase_order'
  | 'receive_goods'
  | 'disburse_payments'
  | 'reports_view'
  | 'export_backup'
  | 'expenses_read'
  | 'expenses_write'

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  owner: [
    'manage_settings',
    'manage_staff',
    'catalog_read',
    'catalog_write',
    'pos_sale',
    'collect_payments',
    'stock_adjustment',
    'stocktake_confirm',
    'purchase_order',
    'receive_goods',
    'disburse_payments',
    'reports_view',
    'export_backup',
    'expenses_read',
    'expenses_write',
  ],
  admin: [
    'manage_staff',
    'catalog_read',
    'catalog_write',
    'pos_sale',
    'collect_payments',
    'stock_adjustment',
    'stocktake_confirm',
    'purchase_order',
    'receive_goods',
    'disburse_payments',
    'reports_view',
    'expenses_read',
    'expenses_write',
  ],
  manager: [
    'catalog_read',
    'catalog_write',
    'pos_sale',
    'collect_payments',
    'stock_adjustment',
    'stocktake_confirm',
    'purchase_order',
    'receive_goods',
    'disburse_payments',
    'reports_view',
    'expenses_read',
    'expenses_write',
  ],
  cashier: [
    'catalog_read',
    'pos_sale',
    'collect_payments',
  ],
  inventory_manager: [
    'catalog_read',
    'catalog_write',
    'stock_adjustment',
    'stocktake_confirm',
    'purchase_order',
    'receive_goods',
  ],
  accountant: [
    'catalog_read',
    'collect_payments',
    'disburse_payments',
    'reports_view',
    'expenses_read',
    'expenses_write',
  ],
}

/**
 * Checks whether the given user role possesses a specific business permission.
 */
export function hasPermission(
  role: UserRole | string | null | undefined,
  permission: Permission
): boolean {
  if (!role) return false
  const allowed = ROLE_PERMISSIONS[role as UserRole]
  return allowed ? allowed.includes(permission) : false
}

