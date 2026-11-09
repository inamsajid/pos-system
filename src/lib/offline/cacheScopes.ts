/**
 * Scoping and composite key formatting utilities to ensure multi-tenant
 * and multi-branch data isolation in local IndexedDB storage.
 */

export function buildProductKey(
  userId: string,
  businessId: string,
  snapshotId: string,
  productId: string
): string {
  return `${userId}:${businessId}:${snapshotId}:${productId}`
}

export function buildCategoryKey(
  userId: string,
  businessId: string,
  snapshotId: string,
  categoryId: string
): string {
  return `${userId}:${businessId}:${snapshotId}:${categoryId}`
}

export function buildStockKey(
  userId: string,
  businessId: string,
  branchId: string,
  snapshotId: string,
  productId: string
): string {
  return `${userId}:${businessId}:${branchId}:${snapshotId}:${productId}`
}

export function buildSyncStateKey(
  userId: string,
  businessId: string,
  branchId: string,
  resource: string
): string {
  return `${userId}:${businessId}:${branchId}:${resource}`
}

