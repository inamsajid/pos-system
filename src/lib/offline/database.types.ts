/**
 * Offline IndexedDB / Dexie TypeScript domain interfaces and contracts.
 * Conforms to Step 13.1 Local Data Classification (zero credentials, zero purchase costs).
 */

export interface DeviceMetadataRecord {
  id: string // 'singleton'
  deviceId: string // 'dev_' + UUID
  schemaVersion: number
  createdAt: string
  lastHealthCheckAt: string
  appVersion: string
  platform: string
}

export interface CachedProductRecord {
  id: string // `${userId}:${businessId}:${snapshotId}:${productId}`
  userId: string
  businessId: string
  snapshotId: string
  productId: string
  name: string
  sku: string
  barcode: string | null
  categoryId: string | null
  unit: string
  sellingPriceMinor: number // Stored strictly in integer paise
  status: 'active' | 'archived'
  trackInventory: boolean
  imageUrl: string | null
  version: number // Multi-device revision version
  serverUpdatedAt: string | null
  cachedAt: string
}

export interface CachedCategoryRecord {
  id: string // `${userId}:${businessId}:${snapshotId}:${categoryId}`
  userId: string
  businessId: string
  snapshotId: string
  categoryId: string
  name: string
  slug: string
  description: string | null
  parentId: string | null
  status: 'active' | 'archived'
  displayOrder: number
  productCount: number
  version: number // Multi-device revision version
  serverUpdatedAt: string | null
  cachedAt: string
}

export interface CachedBranchStockRecord {
  id: string // `${userId}:${businessId}:${branchId}:${snapshotId}:${productId}`
  userId: string
  businessId: string
  branchId: string
  snapshotId: string
  productId: string
  quantityOnHand: number
  unit: string
  reorderThreshold: number | null
  serverUpdatedAt: string | null
  cachedAt: string
}

export interface CacheSyncStateRecord {
  id: string // `${userId}:${businessId}:${branchId}:${resource}`
  userId: string
  businessId: string
  branchId: string
  resource: 'catalog' | 'products' | 'categories' | 'stock'
  activeSnapshotId: string | null
  lastSuccessAt: string | null
  status: 'idle' | 'syncing' | 'success' | 'error'
  errorMessage: string | null
  recordCount: number
  updatedAt: string
}

export interface StorageEstimateResult {
  quotaBytes: number | null
  usageBytes: number | null
  percentUsed: number | null
  isPersisted: boolean
  warning: string | null
}

export interface SyncCursorRecord {
  id: string // `${userId}:${businessId}:${branchId || 'global'}:${stream}`
  userId: string
  businessId: string
  branchId: string | null
  stream: 'catalog' | 'stock'
  lastSequenceId: number
  cursor: string // e.g. "seq_104"
  lastSyncedAt: string
  updatedAt: string
}

export type OutboxCommandStatus =
  | 'pending'
  | 'leased'
  | 'sending'
  | 'acknowledged'
  | 'retryable'
  | 'conflict'
  | 'rejected'
  | 'blocked_auth'
  | 'cancelled'
  | 'reconciliation_required'

export interface OutboxCommandRecord {
  id: string // UUID
  userId: string
  businessId: string
  branchId: string | null
  deviceId: string
  commandType: string
  commandVersion: number
  idempotencyKey: string
  payload: Record<string, unknown>
  payloadHash: string
  status: OutboxCommandStatus
  createdAt: string
  updatedAt: string
  attemptCount: number
  nextAttemptAt: string | null
  lastAttemptAt: string | null
  leaseToken: string | null
  leaseExpiresAt: string | null
  lastErrorCode: string | null
  lastErrorAt: string | null
  serverResultId: string | null
  acknowledgedAt: string | null
  expiresAt: string | null
}

export interface DeviceRegistrationRecord {
  id: string
  installationId: string
  userId: string
  businessId: string
  label: string | null
  status: 'active' | 'revoked'
  registeredAt: string
  lastSeenAt: string
  lastSyncAt: string | null
  createdAt: string
  updatedAt: string
}

export interface DatabaseHealthResult {
  isHealthy: boolean
  schemaVersion: number
  deviceId: string
  tableCounts: {
    deviceMetadata: number
    cachedProducts: number
    cachedCategories: number
    cachedBranchStock: number
    cacheSyncState: number
    syncCursors?: number
    outboxCommands?: number
    offlineSales?: number
    offlineAuthorizations?: number
    offlineAllocations?: number
  }
  storage: StorageEstimateResult
  checkedAt: string
  error?: string
}

export interface ProvisionalSaleLineItem {
  productId: string
  sku: string
  name: string
  unit: string
  allocationId: string
  quantity: number
  unitPriceMinor: number
  subtotalMinor: number
  lineTotalMinor: number
}

export interface ProvisionalOfflineSaleRecord {
  id: string // 'prov_sale_' + uuid
  outboxCommandId: string
  idempotencyKey: string
  userId: string
  businessId: string
  branchId: string
  deviceId: string
  authorizationId: string
  provisionalReceiptNumber: string // 'OFF-{device}-{seq}'
  items: ProvisionalSaleLineItem[]
  totalAmountMinor: number
  cashTenderedMinor: number
  changeReturnedMinor: number
  status: 'provisional' | 'synchronized' | 'rejected' | 'conflict' | 'reconciliation_required'
  createdAt: string
  businessDateKey: string
  payloadHash: string
  serverSaleId?: string | null
  officialInvoiceNumber?: string | null
  acknowledgedAt?: string | null
  rejectionReason?: string | null
}

export interface LocalOfflineAuthorizationRecord {
  id: string // authorizationId
  userId: string
  businessId: string
  branchId: string
  deviceId: string
  installationId?: string
  catalogVersion: number
  pricingVersion: number
  maxTransactions: number
  maxTotalAmountMinor: number
  usedTransactions?: number
  usedTotalAmountMinor?: number
  allowDiscounts: boolean
  taxRatePercent?: number
  taxInclusive?: boolean
  status: 'active' | 'revoked' | 'expired' | 'completed'
  issuedAt: string
  expiresAt: string
  allowedPaymentMethods: string[]
  signature: string
  cachedAt: string
}

export interface LocalDeviceAllocationRecord {
  id: string // allocationId
  authorizationId: string
  userId: string
  businessId: string
  branchId: string
  deviceId: string
  productId: string
  sku: string
  name: string
  unit: string
  sellingPriceMinor: number
  allocatedQuantity: number
  consumedQuantity: number
  remainingQuantity: number
  status: 'active' | 'reconciled' | 'revoked'
  allocatedAt: string
  updatedAt: string
}

