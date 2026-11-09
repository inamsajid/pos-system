export type DeviceStatus = 'active' | 'revoked'

export interface DeviceRow {
  id: string
  installation_id: string
  business_id: string
  user_id: string
  label: string | null
  status: DeviceStatus
  registered_at: string
  last_seen_at: string
  last_sync_at: string | null
  created_at: string
  updated_at: string
}

export interface DeviceDTO {
  id: string
  installationId: string
  businessId: string
  userId: string
  label: string | null
  status: DeviceStatus
  registeredAt: string
  lastSeenAt: string
  lastSyncAt: string | null
  createdAt: string
  updatedAt: string
}

export interface RegisterDeviceInput {
  installationId: string
  label?: string | null
}

export interface DeviceHeartbeatInput {
  installationId: string
}

export type SyncResourceType = 'product' | 'category' | 'stock'
export type SyncOperation = 'upsert' | 'archive' | 'delete'

export interface SyncChangeLogRow {
  id: number
  business_id: string
  branch_id: string | null
  resource_type: SyncResourceType
  resource_id: string
  resource_version: number
  operation: SyncOperation
  payload: string
  event_id: string
  created_at: string
}

export interface SyncChangeDTO {
  seq: number
  resourceType: SyncResourceType
  resourceId: string
  resourceVersion: number
  operation: SyncOperation
  branchId: string | null
  data: Record<string, unknown>
  createdAt: string
}

export interface PullChangesResult {
  changes: SyncChangeDTO[]
  nextCursor: string
  hasMore: boolean
  serverTime: string
}

export interface AckChangesInput {
  cursor: string
  installationId: string
}

