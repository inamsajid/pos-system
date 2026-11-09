import { apiClient, getApiContext } from '../../api-client'
import { offlineDb, NorthstarOfflineDatabase } from '../database'
import {
  buildProductKey,
  buildCategoryKey,
  buildStockKey,
  buildSyncStateKey,
} from '../cacheScopes'
import type {
  CachedProductRecord,
  CachedCategoryRecord,
  CachedBranchStockRecord,
} from '../database.types'
import type {
  PullChangesResponse,
  SyncResult,
  DeviceInfoDTO,
  SyncBroadcastMessage,
} from './sync.types'

export interface SyncClientOptions {
  db?: NorthstarOfflineDatabase
  api?: typeof apiClient
}

export class SyncClient {
  private readonly db: NorthstarOfflineDatabase
  private readonly api: typeof apiClient
  private broadcastChannel: BroadcastChannel | null = null
  private isSyncing = false

  constructor(options: SyncClientOptions = {}) {
    this.db = options.db || offlineDb
    this.api = options.api || apiClient

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.broadcastChannel = new BroadcastChannel('pos_multi_device_sync')
      } catch {
        // BroadcastChannel not supported in this environment
      }
    }
  }

  /**
   * Broadcasts a message to other browser tabs on the same origin.
   */
  private broadcast(msg: SyncBroadcastMessage) {
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(msg)
      } catch {
        // Safe broadcast failure
      }
    }
  }

  /**
   * Registers or re-activates this device on the server.
   */
  async registerDevice(label?: string): Promise<DeviceInfoDTO> {
    const deviceId = await this.db.getDeviceId()
    const response = await this.api.post<DeviceInfoDTO>('/sync/devices/register', {
      installationId: deviceId,
      label: label || (typeof navigator !== 'undefined' ? `${navigator.platform || 'Device'} (${deviceId.slice(-6)})` : `Device (${deviceId.slice(-6)})`),
    })
    return response
  }

  /**
   * Sends a device heartbeat to confirm registration status.
   */
  async heartbeat(): Promise<{ success: boolean; status: 'active' | 'revoked' }> {
    const deviceId = await this.db.getDeviceId()
    return this.api.post<{ success: boolean; status: 'active' | 'revoked' }>(
      '/sync/devices/heartbeat',
      { installationId: deviceId }
    )
  }

  /**
   * Pulls incremental server changes and applies them atomically to Dexie.
   */
  async pullAndApplyChanges(options: {
    userId?: string
    businessId?: string
    branchId?: string
    limit?: number
  } = {}): Promise<SyncResult> {
    if (this.isSyncing) {
      return { pulledCount: 0, appliedCount: 0, cursor: null, hasMore: false }
    }

    const context = getApiContext()
    const userId = options.userId || context.userId
    const businessId = options.businessId || context.businessId
    const branchId = options.branchId || context.branchId || null

    if (!userId || !businessId) {
      return { pulledCount: 0, appliedCount: 0, cursor: null, hasMore: false }
    }

    this.isSyncing = true
    try {
      const deviceId = await this.db.getDeviceId()

      // 1. Read existing cursor from Dexie
      const cursorRecord = await this.db.getSyncCursor(userId, businessId, branchId, 'catalog')
      const currentCursor = cursorRecord?.cursor || null

      // 2. Fetch changes from Server Change Feed
      const queryParams: Record<string, string | number> = {
        limit: options.limit || 50,
      }
      if (currentCursor) {
        queryParams.cursor = currentCursor
      }
      if (branchId) {
        queryParams.branchId = branchId
      }

      const response = await this.api.get<PullChangesResponse>('/sync/changes', {
        params: queryParams,
        headers: {
          'X-Device-Id': deviceId,
          ...(branchId ? { 'X-Branch-Id': branchId } : {}),
        },
      })

      const changes = response.changes || []
      const nextCursor = response.nextCursor
      const hasMore = Boolean(response.hasMore)

      if (changes.length === 0) {
        // Update heartbeat / last sync cursor if cursor changed
        if (nextCursor && nextCursor !== currentCursor) {
          const seqId = parseInt(nextCursor.replace('seq_', ''), 10) || 0
          const now = new Date().toISOString()
          await this.db.setSyncCursor({
            id: `${userId}:${businessId}:${branchId || 'global'}:catalog`,
            userId,
            businessId,
            branchId: branchId || 'global',
            stream: 'catalog',
            cursor: nextCursor,
            lastSequenceId: seqId,
            lastSyncedAt: now,
            updatedAt: now,
          })
          await this.ackChanges(deviceId, nextCursor)
        }
        return { pulledCount: 0, appliedCount: 0, cursor: nextCursor, hasMore }
      }

      // 3. Resolve active snapshot ID in Dexie
      const syncKey = buildSyncStateKey(userId, businessId, branchId || 'default', 'catalog')
      const syncState = await this.db.cacheSyncState.get(syncKey)
      const activeSnapshotId = syncState?.activeSnapshotId || 'snap_active'

      // 4. Apply changes atomically in a Dexie transaction
      await this.db.transaction(
        'rw',
        [
          this.db.cachedProducts,
          this.db.cachedCategories,
          this.db.cachedBranchStock,
          this.db.syncCursors,
          this.db.cacheSyncState,
        ],
        async () => {
          const now = new Date().toISOString()
          for (const change of changes) {

            if (change.resourceType === 'product') {
              const prodKey = buildProductKey(userId, businessId, activeSnapshotId, change.resourceId)
              const existing = await this.db.cachedProducts.get(prodKey)

              if (change.operation === 'archive') {
                if (existing) {
                  existing.status = 'archived'
                  existing.version = change.resourceVersion
                  existing.serverUpdatedAt = change.createdAt
                  existing.cachedAt = now
                  await this.db.cachedProducts.put(existing)
                }
              } else {
                // Upsert product (ensuring wholesale purchase cost is NEVER cached)
                const payload = (change.payload || change.data || {}) as Record<string, unknown>
                const newRec: CachedProductRecord = {
                  id: prodKey,
                  userId,
                  businessId,
                  snapshotId: activeSnapshotId,
                  productId: change.resourceId,
                  name: String(payload.name || existing?.name || ''),
                  sku: String(payload.sku || existing?.sku || ''),
                  barcode: payload.barcode ? String(payload.barcode) : existing?.barcode ?? null,
                  categoryId: payload.categoryId ? String(payload.categoryId) : existing?.categoryId ?? null,
                  unit: String(payload.unit || existing?.unit || 'piece'),
                  sellingPriceMinor: Number(payload.sellingPriceMinor ?? existing?.sellingPriceMinor ?? 0),
                  status: (payload.status as 'active' | 'archived') || existing?.status || 'active',
                  trackInventory: payload.trackInventory !== undefined ? Boolean(payload.trackInventory) : (existing?.trackInventory ?? true),
                  imageUrl: payload.imageUrl ? String(payload.imageUrl) : existing?.imageUrl ?? null,
                  version: change.resourceVersion || Number(payload.version || (existing?.version || 0) + 1),
                  serverUpdatedAt: String(payload.updatedAt || change.createdAt),
                  cachedAt: now,
                }
                await this.db.cachedProducts.put(newRec)
              }
            } else if (change.resourceType === 'category') {
              const catKey = buildCategoryKey(userId, businessId, activeSnapshotId, change.resourceId)
              const existing = await this.db.cachedCategories.get(catKey)

              if (change.operation === 'archive') {
                if (existing) {
                  existing.status = 'archived'
                  existing.version = change.resourceVersion
                  existing.serverUpdatedAt = change.createdAt
                  existing.cachedAt = now
                  await this.db.cachedCategories.put(existing)
                }
              } else {
                const payload = (change.payload || change.data || {}) as Record<string, unknown>
                const newRec: CachedCategoryRecord = {
                  id: catKey,
                  userId,
                  businessId,
                  snapshotId: activeSnapshotId,
                  categoryId: change.resourceId,
                  name: String(payload.name || existing?.name || ''),
                  slug: String(payload.slug || existing?.slug || ''),
                  description: payload.description ? String(payload.description) : existing?.description ?? null,
                  parentId: payload.parentId ? String(payload.parentId) : existing?.parentId ?? null,
                  status: (payload.status as 'active' | 'archived') || existing?.status || 'active',
                  displayOrder: Number(payload.displayOrder ?? existing?.displayOrder ?? 0),
                  productCount: Number(payload.productCount ?? existing?.productCount ?? 0),
                  version: change.resourceVersion || Number(payload.version || (existing?.version || 0) + 1),
                  serverUpdatedAt: String(payload.updatedAt || change.createdAt),
                  cachedAt: now,
                }
                await this.db.cachedCategories.put(newRec)
              }
            } else if (change.resourceType === 'stock') {
              const stockBranchId = change.branchId || branchId || 'default'
              const stockKey = buildStockKey(
                userId,
                businessId,
                stockBranchId,
                activeSnapshotId,
                change.resourceId.includes(':') ? change.resourceId.split(':')[1] : change.resourceId
              )
              const productId = change.resourceId.includes(':')
                ? change.resourceId.split(':')[1]
                : change.resourceId

              const payload = (change.payload || change.data || {}) as Record<string, unknown>
              const stockRec: CachedBranchStockRecord = {
                id: stockKey,
                userId,
                businessId,
                branchId: stockBranchId,
                snapshotId: activeSnapshotId,
                productId,
                quantityOnHand: Number(payload.quantityOnHand ?? 0),
                unit: String(payload.unit || 'piece'),
                reorderThreshold: null,
                serverUpdatedAt: String(payload.updatedAt || change.createdAt),
                cachedAt: now,
              }
              await this.db.cachedBranchStock.put(stockRec)
            }
          }

          // Advance cursor in Dexie
          if (nextCursor) {
            const seqId = parseInt(nextCursor.replace('seq_', ''), 10) || 0
            await this.db.syncCursors.put({
              id: `${userId}:${businessId}:${branchId || 'global'}:catalog`,
              userId,
              businessId,
              branchId: branchId || 'global',
              stream: 'catalog',
              cursor: nextCursor,
              lastSequenceId: seqId,
              lastSyncedAt: now,
              updatedAt: now,
            })
          }
        }
      )

      // 5. Acknowledge cursor to server
      if (nextCursor) {
        await this.ackChanges(deviceId, nextCursor)
      }

      // 6. Broadcast to peer tabs
      this.broadcast({
        type: 'CATALOG_UPDATED',
        businessId,
        branchId,
        timestamp: new Date().toISOString(),
        cursor: nextCursor,
      })

      return {
        pulledCount: changes.length,
        appliedCount: changes.length,
        cursor: nextCursor,
        hasMore,
      }
    } finally {
      this.isSyncing = false
    }
  }

  /**
   * Confirms cursor consumption to the server.
   */
  private async ackChanges(deviceId: string, cursor: string): Promise<void> {
    try {
      await this.api.post('/sync/ack', {
        installationId: deviceId,
        cursor,
      })
    } catch {
      // Safe acknowledgement failure — cursor is durably stored locally and will be resent or re-verified on next poll
    }
  }

  /**
   * Destroys resources and closes BroadcastChannel.
   */
  destroy() {
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close()
      } catch {
        // Safe close
      }
      this.broadcastChannel = null
    }
  }
}
