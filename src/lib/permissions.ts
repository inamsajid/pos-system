import type { UserRole } from '../features/auth/types'

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

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
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

