/**
 * Multi-device synchronization types for Northstar POS.
 */

export type SyncResourceType = 'product' | 'category' | 'stock'
export type SyncOperation = 'upsert' | 'archive'

export interface SyncChangeItem {
  id?: number
  seq?: number
  cursor?: string
  businessId?: string
  branchId: string | null
  resourceType: SyncResourceType
  resourceId: string
  resourceVersion: number
  operation: SyncOperation
  payload?: Record<string, unknown>
  data?: Record<string, unknown>
  createdAt: string
}

export interface PullChangesResponse {
  changes: SyncChangeItem[]
  nextCursor: string | null
  hasMore: boolean
  serverTimestamp: string
}

export interface DeviceInfoDTO {
  id: string
  installationId: string
  businessId: string
  userId: string
  label: string | null
  status: 'active' | 'revoked'
  registeredAt: string
  lastSeenAt: string
  lastSyncAt: string | null
}

export interface SyncResult {
  pulledCount: number
  appliedCount: number
  cursor: string | null
  hasMore: boolean
}

export type SyncStatus = 'idle' | 'syncing' | 'paused' | 'error'

export interface ConflictDetails {
  resourceType: 'product' | 'category'
  resourceId: string
  expectedVersion?: number
  serverVersion?: number
  message: string
  draftData?: Record<string, unknown>
  serverData?: Record<string, unknown>
}

export interface SyncBroadcastMessage {
  type: 'SYNC_STARTED' | 'SYNC_COMPLETED' | 'CATALOG_UPDATED' | 'STOCK_UPDATED'
  businessId: string
  branchId?: string | null
  timestamp: string
  cursor?: string | null
}
