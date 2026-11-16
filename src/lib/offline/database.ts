import Dexie, { type Table } from 'dexie'
import {
  OFFLINE_DB_NAME,
  OFFLINE_SCHEMA_DEFINITIONS,
} from './database.schema'
import type {
  DeviceMetadataRecord,
  CachedProductRecord,
  CachedCategoryRecord,
  CachedBranchStockRecord,
  CacheSyncStateRecord,
  StorageEstimateResult,
  DatabaseHealthResult,
  SyncCursorRecord,
  OutboxCommandRecord,
  ProvisionalOfflineSaleRecord,
  LocalOfflineAuthorizationRecord,
  LocalDeviceAllocationRecord,
} from './database.types'
import { getOrCreateDeviceId } from './deviceIdentity'
import { checkDatabaseHealth } from './databaseHealth'
import { getStorageEstimate, requestPersistentStorage } from './storageManager'
import { buildSyncStateKey } from './cacheScopes'

export class NorthstarOfflineDatabase extends Dexie {
  deviceMetadata!: Table<DeviceMetadataRecord, string>
  cachedProducts!: Table<CachedProductRecord, string>
  cachedCategories!: Table<CachedCategoryRecord, string>
  cachedBranchStock!: Table<CachedBranchStockRecord, string>
  cacheSyncState!: Table<CacheSyncStateRecord, string>
  syncCursors!: Table<SyncCursorRecord, string>
  outboxCommands!: Table<OutboxCommandRecord, string>
  offlineSales!: Table<ProvisionalOfflineSaleRecord, string>
  offlineAuthorizations!: Table<LocalOfflineAuthorizationRecord, string>
  offlineAllocations!: Table<LocalDeviceAllocationRecord, string>

  constructor(databaseName: string = OFFLINE_DB_NAME) {
    super(databaseName)

    this.version(1).stores(OFFLINE_SCHEMA_DEFINITIONS[1])
    this.version(2).stores(OFFLINE_SCHEMA_DEFINITIONS[2])
    this.version(3).stores(OFFLINE_SCHEMA_DEFINITIONS[3])
    this.version(4).stores(OFFLINE_SCHEMA_DEFINITIONS[4])
    this.version(5)
      .stores(OFFLINE_SCHEMA_DEFINITIONS[5])
      .upgrade(async (tx) => {
        const auths = await tx.table('offlineAuthorizations').toArray()
        const authUserMap = new Map<string, string>()
        for (const a of auths as Array<{ id: string; userId?: string }>) {
          if (a.userId) {
            authUserMap.set(a.id, a.userId)
          }
        }
        await tx
          .table('offlineAllocations')
          .toCollection()
          .modify((alloc: Record<string, unknown>) => {
            if (!alloc.userId) {
              alloc.userId = authUserMap.get(String(alloc.authorizationId || '')) || 'unknown'
            }
          })
      })
  }

  /**
   * Diagnostic / Device identity helpers
   */
  async getDeviceId(): Promise<string> {
    return getOrCreateDeviceId(this)
  }

  async checkHealth(): Promise<DatabaseHealthResult> {
    return checkDatabaseHealth(this)
  }

  async getStorageEstimate(): Promise<StorageEstimateResult> {
    return getStorageEstimate()
  }

  async requestPersistence(): Promise<boolean> {
    return requestPersistentStorage()
  }

  /**
   * Sync State Helpers
   */
  async getSyncState(
    userId: string,
    businessId: string,
    branchId: string,
    resource: 'catalog' | 'products' | 'categories' | 'stock' = 'catalog'
  ): Promise<CacheSyncStateRecord | undefined> {
    const key = buildSyncStateKey(userId, businessId, branchId, resource)
    return this.cacheSyncState.get(key)
  }

  async getActiveSnapshotId(
    userId: string,
    businessId: string,
    branchId: string,
    resource: 'catalog' | 'products' | 'categories' | 'stock' = 'catalog'
  ): Promise<string | null> {
    const state = await this.getSyncState(userId, businessId, branchId, resource)
    return state?.activeSnapshotId || null
  }

  async setSyncState(record: CacheSyncStateRecord): Promise<void> {
    await this.cacheSyncState.put(record)
  }

  /**
   * Atomically activates a candidate snapshot for a given tenant/branch scope.
   * Purges previous snapshot records in the same transaction so readers never observe partial state.
   */
  async activateSnapshot(params: {
    userId: string
    businessId: string
    branchId: string
    resource: 'catalog' | 'products' | 'categories' | 'stock'
    newSnapshotId: string
    recordCount: number
  }): Promise<void> {
    const { userId, businessId, branchId, resource, newSnapshotId, recordCount } = params
    const now = new Date().toISOString()
    const syncKey = buildSyncStateKey(userId, businessId, branchId, resource)

    await this.transaction(
      'rw',
      [this.cacheSyncState, this.cachedProducts, this.cachedCategories, this.cachedBranchStock],
      async () => {
        // 1. Update sync state
        const stateRecord: CacheSyncStateRecord = {
          id: syncKey,
          userId,
          businessId,
          branchId,
          resource,
          activeSnapshotId: newSnapshotId,
          lastSuccessAt: now,
          status: 'success',
          errorMessage: null,
          recordCount,
          updatedAt: now,
        }
        await this.cacheSyncState.put(stateRecord)

        // 2. Purge stale product snapshots for this tenant
        if (resource === 'catalog' || resource === 'products') {
          const staleProductKeys = await this.cachedProducts
            .filter(
              (p) =>
                p.userId === userId &&
                p.businessId === businessId &&
                p.snapshotId !== newSnapshotId
            )
            .primaryKeys()
          if (staleProductKeys.length > 0) {
            await this.cachedProducts.bulkDelete(staleProductKeys)
          }
        }

        // 3. Purge stale category snapshots for this tenant
        if (resource === 'catalog' || resource === 'categories') {
          const staleCategoryKeys = await this.cachedCategories
            .filter(
              (c) =>
                c.userId === userId &&
                c.businessId === businessId &&
                c.snapshotId !== newSnapshotId
            )
            .primaryKeys()
          if (staleCategoryKeys.length > 0) {
            await this.cachedCategories.bulkDelete(staleCategoryKeys)
          }
        }

        // 4. Purge stale branch stock snapshots for this tenant + branch
        if (resource === 'catalog' || resource === 'stock') {
          const staleStockKeys = await this.cachedBranchStock
            .filter(
              (s) =>
                s.userId === userId &&
                s.businessId === businessId &&
                s.branchId === branchId &&
                s.snapshotId !== newSnapshotId
            )
            .primaryKeys()
          if (staleStockKeys.length > 0) {
            await this.cachedBranchStock.bulkDelete(staleStockKeys)
          }
        }
      }
    )
  }

  /**
   * Cleans up uncommitted candidate snapshot records when synchronization is aborted or errors.
   */
  async rollbackCandidateSnapshot(params: {
    userId: string
    businessId: string
    branchId?: string
    snapshotId: string
  }): Promise<void> {
    const { userId, businessId, branchId, snapshotId } = params

    await this.transaction(
      'rw',
      [this.cachedProducts, this.cachedCategories, this.cachedBranchStock],
      async () => {
        const prodKeys = await this.cachedProducts
          .filter(
            (p) =>
              p.userId === userId &&
              p.businessId === businessId &&
              p.snapshotId === snapshotId
          )
          .primaryKeys()
        if (prodKeys.length > 0) {
          await this.cachedProducts.bulkDelete(prodKeys)
        }

        const catKeys = await this.cachedCategories
          .filter(
            (c) =>
              c.userId === userId &&
              c.businessId === businessId &&
              c.snapshotId === snapshotId
          )
          .primaryKeys()
        if (catKeys.length > 0) {
          await this.cachedCategories.bulkDelete(catKeys)
        }

        if (branchId) {
          const stockKeys = await this.cachedBranchStock
            .filter(
              (s) =>
                s.userId === userId &&
                s.businessId === businessId &&
                s.branchId === branchId &&
                s.snapshotId === snapshotId
            )
            .primaryKeys()
          if (stockKeys.length > 0) {
            await this.cachedBranchStock.bulkDelete(stockKeys)
          }
        }
      }
    )
  }

  /**
   * Scoped Query: Products
   */
  async queryProducts(params: {
    userId: string
    businessId: string
    snapshotId: string
    categoryId?: string
    search?: string
    status?: 'active' | 'archived'
  }): Promise<CachedProductRecord[]> {
    const { userId, businessId, snapshotId, categoryId, search, status } = params

    let collection = this.cachedProducts
      .where('[userId+businessId+snapshotId]')
      .equals([userId, businessId, snapshotId])

    if (status) {
      collection = collection.filter((p) => p.status === status)
    }

    if (categoryId) {
      collection = collection.filter((p) => p.categoryId === categoryId)
    }

    if (search && search.trim().length > 0) {
      const q = search.trim().toLowerCase()
      collection = collection.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.barcode ? p.barcode.toLowerCase().includes(q) : false)
      )
    }

    return collection.toArray()
  }

  /**
   * Scoped Query: Categories
   */
  async queryCategories(params: {
    userId: string
    businessId: string
    snapshotId: string
    status?: 'active' | 'archived'
  }): Promise<CachedCategoryRecord[]> {
    const { userId, businessId, snapshotId, status } = params

    let collection = this.cachedCategories
      .where('[userId+businessId+snapshotId]')
      .equals([userId, businessId, snapshotId])

    if (status) {
      collection = collection.filter((c) => c.status === status)
    }

    const results = await collection.toArray()
    return results.sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))
  }

  /**
   * Scoped Query: Branch Stock Map (returns Map of productId -> quantityOnHand)
   */
  async queryStockMap(params: {
    userId: string
    businessId: string
    branchId: string
    snapshotId: string
  }): Promise<Map<string, CachedBranchStockRecord>> {
    const { userId, businessId, branchId, snapshotId } = params

    const records = await this.cachedBranchStock
      .where('[userId+businessId+branchId+snapshotId]')
      .equals([userId, businessId, branchId, snapshotId])
      .toArray()

    const map = new Map<string, CachedBranchStockRecord>()
    for (const rec of records) {
      map.set(rec.productId, rec)
    }
    return map
  }

  /**
   * Sync Cursor Helpers
   */
  async getSyncCursor(
    userId: string,
    businessId: string,
    branchId: string | null,
    stream: 'catalog' | 'stock' = 'catalog'
  ): Promise<SyncCursorRecord | undefined> {
    const key = `${userId}:${businessId}:${branchId || 'global'}:${stream}`
    return this.syncCursors.get(key)
  }

  async setSyncCursor(record: SyncCursorRecord): Promise<void> {
    await this.syncCursors.put(record)
  }

  /**
   * Purges cached catalog, cursors & completed/non-pending state for a specific user and business
   * (e.g. on user sign-out or business switch).
   * Preserves unsynced pending/retryable/conflict/blocked_auth outbox commands & provisional sales
   * locked to the original userId/businessId unless preservePendingOffline is false.
   */
  async clearScopedCache(
    userId: string,
    businessId: string,
    options: { preservePendingOffline?: boolean } = {}
  ): Promise<void> {
    const { preservePendingOffline = true } = options
    const pendingStatuses = new Set([
      'pending',
      'leased',
      'sending',
      'retryable',
      'conflict',
      'blocked_auth',
      'reconciliation_required',
    ])
    const preservedSaleStatuses = new Set(['provisional', 'conflict', 'reconciliation_required'])

    await this.transaction(
      'rw',
      [
        this.cacheSyncState,
        this.cachedProducts,
        this.cachedCategories,
        this.cachedBranchStock,
        this.syncCursors,
        this.outboxCommands,
        this.offlineSales,
        this.offlineAuthorizations,
        this.offlineAllocations,
      ],
      async () => {
        const prodKeys = await this.cachedProducts
          .filter((p) => p.userId === userId && p.businessId === businessId)
          .primaryKeys()
        await this.cachedProducts.bulkDelete(prodKeys)

        const catKeys = await this.cachedCategories
          .filter((c) => c.userId === userId && c.businessId === businessId)
          .primaryKeys()
        await this.cachedCategories.bulkDelete(catKeys)

        const stockKeys = await this.cachedBranchStock
          .filter((s) => s.userId === userId && s.businessId === businessId)
          .primaryKeys()
        await this.cachedBranchStock.bulkDelete(stockKeys)

        const syncKeys = await this.cacheSyncState
          .filter((s) => s.userId === userId && s.businessId === businessId)
          .primaryKeys()
        await this.cacheSyncState.bulkDelete(syncKeys)

        const cursorKeys = await this.syncCursors
          .filter((c) => c.userId === userId && c.businessId === businessId)
          .primaryKeys()
        await this.syncCursors.bulkDelete(cursorKeys)

        const activeAuthIds = new Set<string>()
        const allOutbox = await this.outboxCommands
          .filter((o) => o.userId === userId && o.businessId === businessId)
          .toArray()
        const outboxToDelete: string[] = []
        for (const o of allOutbox) {
          if (preservePendingOffline && pendingStatuses.has(o.status)) {
            const authId = o.payload?.authorizationId
            if (typeof authId === 'string' && authId) {
              activeAuthIds.add(authId)
            }
          } else {
            outboxToDelete.push(o.id)
          }
        }
        if (outboxToDelete.length > 0) {
          await this.outboxCommands.bulkDelete(outboxToDelete)
        }

        const allSales = await this.offlineSales
          .filter((s) => s.userId === userId && s.businessId === businessId)
          .toArray()
        const salesToDelete: string[] = []
        for (const s of allSales) {
          if (preservePendingOffline && preservedSaleStatuses.has(s.status)) {
            if (s.authorizationId) {
              activeAuthIds.add(s.authorizationId)
            }
          } else {
            salesToDelete.push(s.id)
          }
        }
        if (salesToDelete.length > 0) {
          await this.offlineSales.bulkDelete(salesToDelete)
        }

        const authKeysToDelete = await this.offlineAuthorizations
          .filter(
            (a) =>
              a.userId === userId &&
              a.businessId === businessId &&
              (!preservePendingOffline || !activeAuthIds.has(a.id))
          )
          .primaryKeys()
        if (authKeysToDelete.length > 0) {
          await this.offlineAuthorizations.bulkDelete(authKeysToDelete)
        }

        const allocKeysToDelete = await this.offlineAllocations
          .filter(
            (al) =>
              al.userId === userId &&
              al.businessId === businessId &&
              (!preservePendingOffline || !activeAuthIds.has(al.authorizationId))
          )
          .primaryKeys()
        if (allocKeysToDelete.length > 0) {
          await this.offlineAllocations.bulkDelete(allocKeysToDelete)
        }
      }
    )
  }

  /**
   * Purges all non-pending cached data across all businesses belonging to userId on sign-out.
   * Preserves unsynced offline transactions and their referenced authorizations/allocations.
   */
  async clearUserNonPendingCache(userId: string): Promise<void> {
    const bizIds = new Set<string>()
    const [prods, cats, stock, syncStates, cursors, sales, outbox, auths] = await Promise.all([
      this.cachedProducts.filter((p) => p.userId === userId).toArray(),
      this.cachedCategories.filter((c) => c.userId === userId).toArray(),
      this.cachedBranchStock.filter((s) => s.userId === userId).toArray(),
      this.cacheSyncState.filter((s) => s.userId === userId).toArray(),
      this.syncCursors.filter((c) => c.userId === userId).toArray(),
      this.offlineSales.filter((s) => s.userId === userId).toArray(),
      this.outboxCommands.filter((o) => o.userId === userId).toArray(),
      this.offlineAuthorizations.filter((a) => a.userId === userId).toArray(),
    ])
    for (const r of [...prods, ...cats, ...stock, ...syncStates, ...cursors, ...sales, ...outbox, ...auths]) {
      if (r.businessId) bizIds.add(r.businessId)
    }
    for (const businessId of bizIds) {
      await this.clearScopedCache(userId, businessId, { preservePendingOffline: true })
    }
  }

  /**
   * Clears all cache data across all tables. Retains deviceMetadata.
   */
  async clearAllOfflineData(): Promise<void> {
    await this.transaction(
      'rw',
      [
        this.cacheSyncState,
        this.cachedProducts,
        this.cachedCategories,
        this.cachedBranchStock,
        this.syncCursors,
        this.outboxCommands,
        this.offlineSales,
        this.offlineAuthorizations,
        this.offlineAllocations,
      ],
      async () => {
        await this.cachedProducts.clear()
        await this.cachedCategories.clear()
        await this.cachedBranchStock.clear()
        await this.cacheSyncState.clear()
        await this.syncCursors.clear()
        await this.outboxCommands.clear()
        await this.offlineSales.clear()
        await this.offlineAuthorizations.clear()
        await this.offlineAllocations.clear()
      }
    )
  }
}

/**
 * Global singleton offline database instance for client application usage.
 */
export const offlineDb = new NorthstarOfflineDatabase()
