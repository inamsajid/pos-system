/**
 * Dexie schema definition and version migration plans for Northstar POS.
 */

export const OFFLINE_DB_NAME = 'northstar_pos_offline'
export const CURRENT_OFFLINE_SCHEMA_VERSION = 5

export const OFFLINE_SCHEMA_DEFINITIONS = {
  1: {
    deviceMetadata: 'id, deviceId, schemaVersion',
    cachedProducts: 'id, [userId+businessId+snapshotId], productId, name, sku, barcode, categoryId, status',
    cachedCategories: 'id, [userId+businessId+snapshotId], categoryId, slug, status, displayOrder',
    cachedBranchStock: 'id, [userId+businessId+branchId+snapshotId], [userId+businessId+branchId+snapshotId+productId], productId',
    cacheSyncState: 'id, [userId+businessId], [userId+businessId+branchId], resource',
  },
  2: {
    deviceMetadata: 'id, deviceId, schemaVersion',
    cachedProducts: 'id, [userId+businessId+snapshotId], productId, name, sku, barcode, categoryId, status',
    cachedCategories: 'id, [userId+businessId+snapshotId], categoryId, slug, status, displayOrder',
    cachedBranchStock: 'id, [userId+businessId+branchId+snapshotId], [userId+businessId+branchId+snapshotId+productId], productId',
    cacheSyncState: 'id, [userId+businessId], [userId+businessId+branchId], resource',
    syncCursors: 'id, [userId+businessId], [userId+businessId+branchId], stream',
    outboxCommands: 'id, [userId+businessId+status], idempotencyKey, commandType, createdAt',
  },
  3: {
    deviceMetadata: 'id, deviceId, schemaVersion',
    cachedProducts: 'id, [userId+businessId+snapshotId], productId, name, sku, barcode, categoryId, status',
    cachedCategories: 'id, [userId+businessId+snapshotId], categoryId, slug, status, displayOrder',
    cachedBranchStock: 'id, [userId+businessId+branchId+snapshotId], [userId+businessId+branchId+snapshotId+productId], productId',
    cacheSyncState: 'id, [userId+businessId], [userId+businessId+branchId], resource',
    syncCursors: 'id, [userId+businessId], [userId+businessId+branchId], stream',
    outboxCommands: 'id, [userId+businessId+status], [userId+businessId+status+nextAttemptAt], idempotencyKey, commandType, status, nextAttemptAt, leaseExpiresAt, createdAt',
  },
  4: {
    deviceMetadata: 'id, deviceId, schemaVersion',
    cachedProducts: 'id, [userId+businessId+snapshotId], productId, name, sku, barcode, categoryId, status',
    cachedCategories: 'id, [userId+businessId+snapshotId], categoryId, slug, status, displayOrder',
    cachedBranchStock: 'id, [userId+businessId+branchId+snapshotId], [userId+businessId+branchId+snapshotId+productId], productId',
    cacheSyncState: 'id, [userId+businessId], [userId+businessId+branchId], resource',
    syncCursors: 'id, [userId+businessId], [userId+businessId+branchId], stream',
    outboxCommands: 'id, [userId+businessId+status], [userId+businessId+status+nextAttemptAt], idempotencyKey, commandType, status, nextAttemptAt, leaseExpiresAt, createdAt',
    offlineSales: 'id, [userId+businessId+status], [userId+businessId+branchId], idempotencyKey, authorizationId, status, createdAt',
    offlineAuthorizations: 'id, [userId+businessId+deviceId], status, expiresAt',
    offlineAllocations: 'id, [businessId+branchId+deviceId], productId, status',
  },
  5: {
    deviceMetadata: 'id, deviceId, schemaVersion',
    cachedProducts: 'id, [userId+businessId+snapshotId], productId, name, sku, barcode, categoryId, status',
    cachedCategories: 'id, [userId+businessId+snapshotId], categoryId, slug, status, displayOrder',
    cachedBranchStock: 'id, [userId+businessId+branchId+snapshotId], [userId+businessId+branchId+snapshotId+productId], productId',
    cacheSyncState: 'id, [userId+businessId], [userId+businessId+branchId], resource',
    syncCursors: 'id, [userId+businessId], [userId+businessId+branchId], stream',
    outboxCommands: 'id, [userId+businessId+status], [userId+businessId+status+nextAttemptAt], idempotencyKey, commandType, status, nextAttemptAt, leaseExpiresAt, createdAt',
    offlineSales: 'id, [userId+businessId+status], [userId+businessId+branchId], idempotencyKey, authorizationId, status, createdAt',
    offlineAuthorizations: 'id, [userId+businessId+deviceId], status, expiresAt',
    offlineAllocations: 'id, [userId+businessId+branchId+deviceId], [userId+businessId+authorizationId], [businessId+branchId+deviceId], authorizationId, productId, status',
  },
}
