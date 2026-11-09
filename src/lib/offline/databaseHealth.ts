import type { Dexie } from 'dexie'
import type { DatabaseHealthResult } from './database.types'
import { CURRENT_OFFLINE_SCHEMA_VERSION } from './database.schema'
import { getOrCreateDeviceId } from './deviceIdentity'
import { getStorageEstimate } from './storageManager'

/**
 * Diagnostic health check verifying database accessibility,
 * table count integrity, device identifier, and storage utilization.
 */
export async function checkDatabaseHealth(db: Dexie): Promise<DatabaseHealthResult> {
  const now = new Date().toISOString()
  try {
    if (!db.isOpen()) {
      await db.open()
    }

    const deviceId = await getOrCreateDeviceId(db)
    const storage = await getStorageEstimate()

    // Read counts concurrently
    const [
      deviceMetadataCount,
      cachedProductsCount,
      cachedCategoriesCount,
      cachedBranchStockCount,
      cacheSyncStateCount,
      syncCursorsCount,
      outboxCommandsCount,
    ] = await Promise.all([
      db.table('deviceMetadata').count(),
      db.table('cachedProducts').count(),
      db.table('cachedCategories').count(),
      db.table('cachedBranchStock').count(),
      db.table('cacheSyncState').count(),
      db.table('syncCursors').count().catch(() => 0),
      db.table('outboxCommands').count().catch(() => 0),
    ])

    return {
      isHealthy: true,
      schemaVersion: CURRENT_OFFLINE_SCHEMA_VERSION,
      deviceId,
      tableCounts: {
        deviceMetadata: deviceMetadataCount,
        cachedProducts: cachedProductsCount,
        cachedCategories: cachedCategoriesCount,
        cachedBranchStock: cachedBranchStockCount,
        cacheSyncState: cacheSyncStateCount,
        syncCursors: syncCursorsCount,
        outboxCommands: outboxCommandsCount,
      },
      storage,
      checkedAt: now,
    }
  } catch (err) {
    return {
      isHealthy: false,
      schemaVersion: CURRENT_OFFLINE_SCHEMA_VERSION,
      deviceId: 'unknown',
      tableCounts: {
        deviceMetadata: 0,
        cachedProducts: 0,
        cachedCategories: 0,
        cachedBranchStock: 0,
        cacheSyncState: 0,
      },
      storage: {
        quotaBytes: null,
        usageBytes: null,
        percentUsed: null,
        isPersisted: false,
        warning: null,
      },
      checkedAt: now,
      error: (err as Error).message || String(err),
    }
  }
}

