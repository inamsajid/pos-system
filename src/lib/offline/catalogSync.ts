import { apiClient, ApiError, getApiContext } from '../api-client'
import type { ProductDTO, CategoryDTO } from '../../api/types/dto'
import { offlineDb } from './database'
import {
  buildProductKey,
  buildCategoryKey,
  buildStockKey,
  buildSyncStateKey,
} from './cacheScopes'
import type {
  CachedProductRecord,
  CachedCategoryRecord,
  CachedBranchStockRecord,
  CacheSyncStateRecord,
} from './database.types'

export interface SyncCatalogOptions {
  userId?: string
  businessId?: string
  branchId?: string
  force?: boolean
}

export interface CatalogSyncResult {
  success: boolean
  snapshotId?: string
  productCount?: number
  categoryCount?: number
  error?: string
}

type SyncListener = (state: {
  isSyncing: boolean
  lastSuccessAt: string | null
  error: string | null
  activeSnapshotId: string | null
}) => void

const syncListeners = new Set<SyncListener>()
let activeSyncPromise: Promise<CatalogSyncResult> | null = null

export function subscribeToCatalogSync(listener: SyncListener): () => void {
  syncListeners.add(listener)
  return () => {
    syncListeners.delete(listener)
  }
}

function notifySyncListeners(state: {
  isSyncing: boolean
  lastSuccessAt: string | null
  error: string | null
  activeSnapshotId: string | null
}) {
  for (const listener of syncListeners) {
    try {
      listener(state)
    } catch {
      // safe listener execution
    }
  }
}

/**
 * Distinguishes true network transport failures from application/HTTP errors.
 * 401, 403, 404, 500, etc. return false.
 */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true
  }
  if (err instanceof ApiError) {
    return err.status === 0
  }
  if (err instanceof TypeError) {
    return true
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    return (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network request failed') ||
      msg.includes('connection refused') ||
      msg.includes('abort') ||
      msg.includes('offline')
    )
  }
  return false
}

/**
 * Downloads products, categories, and branch stock from Cloudflare Worker APIs
 * and persists them into IndexedDB using atomic snapshot activation.
 */
export async function syncCatalog(options: SyncCatalogOptions = {}): Promise<CatalogSyncResult> {
  if (activeSyncPromise) {
    return activeSyncPromise
  }

  activeSyncPromise = executeCatalogSync(options).finally(() => {
    activeSyncPromise = null
  })

  return activeSyncPromise
}

async function executeCatalogSync(options: SyncCatalogOptions): Promise<CatalogSyncResult> {
  const context = getApiContext()
  const userId = options.userId || context.userId
  const businessId = options.businessId || context.businessId
  const branchId = options.branchId || context.branchId || 'default'

  if (!userId || !businessId) {
    return {
      success: false,
      error: 'Cannot sync catalog without authenticated user and active business context.',
    }
  }

  const syncKey = buildSyncStateKey(userId, businessId, branchId, 'catalog')
  const previousState = await offlineDb.cacheSyncState.get(syncKey)
  const candidateSnapshotId = `snap_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`

  notifySyncListeners({
    isSyncing: true,
    lastSuccessAt: previousState?.lastSuccessAt ?? null,
    error: null,
    activeSnapshotId: previousState?.activeSnapshotId ?? null,
  })

  const syncingRecord: CacheSyncStateRecord = {
    id: syncKey,
    userId,
    businessId,
    branchId,
    resource: 'catalog',
    activeSnapshotId: previousState?.activeSnapshotId ?? null,
    lastSuccessAt: previousState?.lastSuccessAt ?? null,
    status: 'syncing',
    errorMessage: null,
    recordCount: previousState?.recordCount ?? 0,
    updatedAt: new Date().toISOString(),
  }
  await offlineDb.setSyncState(syncingRecord)

  try {
    // 1. Ingest Categories
    const categoriesDto = await apiClient.get<CategoryDTO[]>('/categories')
    const cachedCategories: CachedCategoryRecord[] = (categoriesDto || []).map((cat, index) => ({
      id: buildCategoryKey(userId, businessId, candidateSnapshotId, cat.id),
      userId,
      businessId,
      snapshotId: candidateSnapshotId,
      categoryId: cat.id,
      name: cat.name,
      slug: cat.slug,
      description: cat.description || null,
      parentId: null,
      status: (cat.status as 'active' | 'archived') || 'active',
      displayOrder: index,
      productCount: cat.productCount || 0,
      version: cat.version || 1,
      serverUpdatedAt: cat.updatedAt || null,
      cachedAt: new Date().toISOString(),
    }))

    if (cachedCategories.length > 0) {
      await offlineDb.cachedCategories.bulkPut(cachedCategories)
    }

    // 2. Ingest Products (paginated)
    let page = 1
    let hasMore = true
    let totalProducts = 0
    const allProducts: CachedProductRecord[] = []
    const allStock: CachedBranchStockRecord[] = []

    while (hasMore) {
      const pageResult = await apiClient.get<ProductDTO[]>('/products', {
        params: { page, limit: 100 },
      })

      const items = Array.isArray(pageResult) ? pageResult : []
      if (items.length === 0) {
        hasMore = false
        break
      }

      for (const p of items) {
        // SECURITY INVARIANT: Strip wholesale purchase price before local Dexie persistence
        allProducts.push({
          id: buildProductKey(userId, businessId, candidateSnapshotId, p.id),
          userId,
          businessId,
          snapshotId: candidateSnapshotId,
          productId: p.id,
          name: p.name,
          sku: p.sku,
          barcode: p.barcode || null,
          categoryId: p.categoryId || null,
          unit: p.unit,
          sellingPriceMinor: p.sellingPriceMinor,
          status: (p.status as 'active' | 'archived') || 'active',
          trackInventory: p.trackInventory,
          imageUrl: p.imageUrl || null,
          version: p.version || 1,
          serverUpdatedAt: p.updatedAt || null,
          cachedAt: new Date().toISOString(),
        })

        // Branch-scoped stock snapshot
        allStock.push({
          id: buildStockKey(userId, businessId, branchId, candidateSnapshotId, p.id),
          userId,
          businessId,
          branchId,
          snapshotId: candidateSnapshotId,
          productId: p.id,
          quantityOnHand: p.stockQuantity ?? 0,
          unit: p.unit,
          reorderThreshold: p.lowStockThreshold ?? null,
          serverUpdatedAt: p.updatedAt || null,
          cachedAt: new Date().toISOString(),
        })
      }

      totalProducts += items.length
      if (items.length < 100) {
        hasMore = false
      } else {
        page++
      }
    }

    if (allProducts.length > 0) {
      await offlineDb.cachedProducts.bulkPut(allProducts)
    }
    if (allStock.length > 0) {
      await offlineDb.cachedBranchStock.bulkPut(allStock)
    }

    // 3. Atomically activate snapshot and purge stale snapshots
    await offlineDb.activateSnapshot({
      userId,
      businessId,
      branchId,
      resource: 'catalog',
      newSnapshotId: candidateSnapshotId,
      recordCount: totalProducts,
    })

    const now = new Date().toISOString()
    notifySyncListeners({
      isSyncing: false,
      lastSuccessAt: now,
      error: null,
      activeSnapshotId: candidateSnapshotId,
    })

    return {
      success: true,
      snapshotId: candidateSnapshotId,
      productCount: totalProducts,
      categoryCount: cachedCategories.length,
    }
  } catch (err) {
    const errorMessage = (err as Error).message || 'Failed to synchronize catalog with server.'

    // Roll back uncommitted candidate records
    await offlineDb.rollbackCandidateSnapshot({
      userId,
      businessId,
      branchId,
      snapshotId: candidateSnapshotId,
    })

    // Retain previous active snapshot in sync state
    const errorRecord: CacheSyncStateRecord = {
      id: syncKey,
      userId,
      businessId,
      branchId,
      resource: 'catalog',
      activeSnapshotId: previousState?.activeSnapshotId ?? null,
      lastSuccessAt: previousState?.lastSuccessAt ?? null,
      status: 'error',
      errorMessage,
      recordCount: previousState?.recordCount ?? 0,
      updatedAt: new Date().toISOString(),
    }
    await offlineDb.setSyncState(errorRecord)

    notifySyncListeners({
      isSyncing: false,
      lastSuccessAt: previousState?.lastSuccessAt ?? null,
      error: errorMessage,
      activeSnapshotId: previousState?.activeSnapshotId ?? null,
    })

    return {
      success: false,
      error: errorMessage,
      snapshotId: previousState?.activeSnapshotId ?? undefined,
    }
  }
}
