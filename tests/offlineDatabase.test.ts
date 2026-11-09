import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { NorthstarOfflineDatabase } from '../src/lib/offline/database'
import { resetInMemoryDeviceIdentity } from '../src/lib/offline/deviceIdentity'
import { isStorageQuotaExceeded } from '../src/lib/offline/storageManager'
import { buildProductKey, buildCategoryKey, buildStockKey } from '../src/lib/offline/cacheScopes'
import type {
  CachedProductRecord,
  CachedCategoryRecord,
  CachedBranchStockRecord,
} from '../src/lib/offline/database.types'

describe('Offline IndexedDB Foundation (Step 13.2)', () => {
  let db: NorthstarOfflineDatabase

  beforeEach(async () => {
    resetInMemoryDeviceIdentity()
    // Unique DB name per test to ensure pristine isolation
    const uniqueName = `test_offline_db_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    db = new NorthstarOfflineDatabase(uniqueName)
    await db.open()
  })

  afterEach(async () => {
    if (db && db.isOpen()) {
      await db.delete()
    }
  })

  describe('Device Identity & Initialization', () => {
    it('initializes schema version 1 and creates required stores', async () => {
      expect(db.isOpen()).toBe(true)
      expect(db.verno).toBeGreaterThanOrEqual(1)
      expect(db.tables.map((t) => t.name)).toEqual(
        expect.arrayContaining([
          'deviceMetadata',
          'cachedProducts',
          'cachedCategories',
          'cachedBranchStock',
          'cacheSyncState',
        ])
      )
    })

    it('generates, persists, and returns a stable device ID', async () => {
      const deviceId1 = await db.getDeviceId()
      expect(deviceId1).toMatch(/^dev_[0-9a-f-]+$/)

      // Subsequence call should return the exact same deviceId
      const deviceId2 = await db.getDeviceId()
      expect(deviceId2).toBe(deviceId1)

      // Check record in deviceMetadata table
      const stored = await db.deviceMetadata.get('singleton')
      expect(stored).toBeDefined()
      expect(stored?.deviceId).toBe(deviceId1)
      expect(stored?.schemaVersion).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Scoped Keys and Tenant/Branch Isolation', () => {
    it('isolates cached products between different businesses and users', async () => {
      const snapA = 'snap_user_a_1'
      const snapB = 'snap_user_b_1'

      const productA: CachedProductRecord = {
        id: buildProductKey('usr_1', 'biz_1', snapA, 'prod_101'),
        userId: 'usr_1',
        businessId: 'biz_1',
        snapshotId: snapA,
        productId: 'prod_101',
        name: 'Business 1 Widget',
        sku: 'BIZ1-WIDGET',
        barcode: '111222333',
        categoryId: 'cat_1',
        unit: 'piece',
        sellingPriceMinor: 50000,
        status: 'active',
        trackInventory: true,
        imageUrl: null,
        serverUpdatedAt: '2026-11-09T00:00:00Z',
        cachedAt: '2026-11-09T10:00:00Z',
      }

      const productB: CachedProductRecord = {
        id: buildProductKey('usr_2', 'biz_2', snapB, 'prod_101'),
        userId: 'usr_2',
        businessId: 'biz_2',
        snapshotId: snapB,
        productId: 'prod_101',
        name: 'Business 2 Widget',
        sku: 'BIZ2-WIDGET',
        barcode: '999888777',
        categoryId: 'cat_2',
        unit: 'box',
        sellingPriceMinor: 85000,
        status: 'active',
        trackInventory: true,
        imageUrl: null,
        serverUpdatedAt: '2026-11-09T00:00:00Z',
        cachedAt: '2026-11-09T10:00:00Z',
      }

      await db.cachedProducts.bulkPut([productA, productB])

      // Query for Business 1
      const resA = await db.queryProducts({
        userId: 'usr_1',
        businessId: 'biz_1',
        snapshotId: snapA,
      })
      expect(resA).toHaveLength(1)
      expect(resA[0].name).toBe('Business 1 Widget')

      // Query for Business 2
      const resB = await db.queryProducts({
        userId: 'usr_2',
        businessId: 'biz_2',
        snapshotId: snapB,
      })
      expect(resB).toHaveLength(1)
      expect(resB[0].name).toBe('Business 2 Widget')
    })

    it('isolates branch stock across branches in the same business', async () => {
      const snap = 'snap_stock_1'

      const stockBranch1: CachedBranchStockRecord = {
        id: buildStockKey('usr_1', 'biz_1', 'branch_main', snap, 'prod_101'),
        userId: 'usr_1',
        businessId: 'biz_1',
        branchId: 'branch_main',
        snapshotId: snap,
        productId: 'prod_101',
        quantityOnHand: 45,
        unit: 'piece',
        reorderThreshold: 10,
        serverUpdatedAt: '2026-11-09T00:00:00Z',
        cachedAt: '2026-11-09T10:00:00Z',
      }

      const stockBranch2: CachedBranchStockRecord = {
        id: buildStockKey('usr_1', 'biz_1', 'branch_downtown', snap, 'prod_101'),
        userId: 'usr_1',
        businessId: 'biz_1',
        branchId: 'branch_downtown',
        snapshotId: snap,
        productId: 'prod_101',
        quantityOnHand: 8,
        unit: 'piece',
        reorderThreshold: 15,
        serverUpdatedAt: '2026-11-09T00:00:00Z',
        cachedAt: '2026-11-09T10:00:00Z',
      }

      await db.cachedBranchStock.bulkPut([stockBranch1, stockBranch2])

      const mainMap = await db.queryStockMap({
        userId: 'usr_1',
        businessId: 'biz_1',
        branchId: 'branch_main',
        snapshotId: snap,
      })
      expect(mainMap.get('prod_101')?.quantityOnHand).toBe(45)

      const downtownMap = await db.queryStockMap({
        userId: 'usr_1',
        businessId: 'biz_1',
        branchId: 'branch_downtown',
        snapshotId: snap,
      })
      expect(downtownMap.get('prod_101')?.quantityOnHand).toBe(8)
    })
  })

  describe('Atomic Snapshot Activation and Stale Snapshot Purging', () => {
    it('activates candidate snapshot and deletes prior snapshot records atomically', async () => {
      const snap1 = 'snap_v1'
      const snap2 = 'snap_v2'

      // Step 1: Ingest and activate snapshot 1
      const prod1: CachedProductRecord = {
        id: buildProductKey('usr_1', 'biz_1', snap1, 'p1'),
        userId: 'usr_1',
        businessId: 'biz_1',
        snapshotId: snap1,
        productId: 'p1',
        name: 'Product Old 1',
        sku: 'OLD-1',
        barcode: null,
        categoryId: null,
        unit: 'piece',
        sellingPriceMinor: 1000,
        status: 'active',
        trackInventory: false,
        imageUrl: null,
        serverUpdatedAt: null,
        cachedAt: '2026-11-09T00:00:00Z',
      }
      await db.cachedProducts.put(prod1)

      await db.activateSnapshot({
        userId: 'usr_1',
        businessId: 'biz_1',
        branchId: 'branch_1',
        resource: 'catalog',
        newSnapshotId: snap1,
        recordCount: 1,
      })

      let activeSnap = await db.getActiveSnapshotId('usr_1', 'biz_1', 'branch_1', 'catalog')
      expect(activeSnap).toBe(snap1)

      // Step 2: Ingest candidate snapshot 2 (staged alongside snap1)
      const prod2: CachedProductRecord = {
        id: buildProductKey('usr_1', 'biz_1', snap2, 'p2'),
        userId: 'usr_1',
        businessId: 'biz_1',
        snapshotId: snap2,
        productId: 'p2',
        name: 'Product New 2',
        sku: 'NEW-2',
        barcode: null,
        categoryId: null,
        unit: 'piece',
        sellingPriceMinor: 2000,
        status: 'active',
        trackInventory: false,
        imageUrl: null,
        serverUpdatedAt: null,
        cachedAt: '2026-11-09T01:00:00Z',
      }
      await db.cachedProducts.put(prod2)

      // Total count before activation is 2
      expect(await db.cachedProducts.count()).toBe(2)

      // Step 3: Activate snapshot 2
      await db.activateSnapshot({
        userId: 'usr_1',
        businessId: 'biz_1',
        branchId: 'branch_1',
        resource: 'catalog',
        newSnapshotId: snap2,
        recordCount: 1,
      })

      activeSnap = await db.getActiveSnapshotId('usr_1', 'biz_1', 'branch_1', 'catalog')
      expect(activeSnap).toBe(snap2)

      // Stale snap1 records must have been pruned
      const remainingProducts = await db.cachedProducts.toArray()
      expect(remainingProducts).toHaveLength(1)
      expect(remainingProducts[0].productId).toBe('p2')
      expect(remainingProducts[0].snapshotId).toBe(snap2)
    })

    it('rolls back candidate snapshot records when sync encounters an error', async () => {
      const activeSnap = 'snap_stable'
      const candidateSnap = 'snap_candidate_failed'

      // Stable product
      await db.cachedProducts.put({
        id: buildProductKey('usr_1', 'biz_1', activeSnap, 'p_stable'),
        userId: 'usr_1',
        businessId: 'biz_1',
        snapshotId: activeSnap,
        productId: 'p_stable',
        name: 'Stable Product',
        sku: 'STABLE-1',
        barcode: null,
        categoryId: null,
        unit: 'piece',
        sellingPriceMinor: 1500,
        status: 'active',
        trackInventory: false,
        imageUrl: null,
        serverUpdatedAt: null,
        cachedAt: '2026-11-09T00:00:00Z',
      })

      // Candidate product ingested before failure
      await db.cachedProducts.put({
        id: buildProductKey('usr_1', 'biz_1', candidateSnap, 'p_partial'),
        userId: 'usr_1',
        businessId: 'biz_1',
        snapshotId: candidateSnap,
        productId: 'p_partial',
        name: 'Partial Product',
        sku: 'PARTIAL-1',
        barcode: null,
        categoryId: null,
        unit: 'piece',
        sellingPriceMinor: 1500,
        status: 'active',
        trackInventory: false,
        imageUrl: null,
        serverUpdatedAt: null,
        cachedAt: '2026-11-09T01:00:00Z',
      })

      expect(await db.cachedProducts.count()).toBe(2)

      // Rollback candidate
      await db.rollbackCandidateSnapshot({
        userId: 'usr_1',
        businessId: 'biz_1',
        snapshotId: candidateSnap,
      })

      const remaining = await db.cachedProducts.toArray()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].productId).toBe('p_stable')
    })
  })

  describe('Diagnostic Health & Storage Verification', () => {
    it('reports accurate health metrics and store counts', async () => {
      await db.getDeviceId()

      const health = await db.checkHealth()
      expect(health.isHealthy).toBe(true)
      expect(health.schemaVersion).toBeGreaterThanOrEqual(1)
      expect(health.deviceId).toMatch(/^dev_/)
      expect(health.tableCounts.deviceMetadata).toBe(1)
      expect(health.tableCounts.cachedProducts).toBe(0)
    })

    it('identifies storage quota exceeded errors accurately', () => {
      const quotaErr = new Error('The quota has been exceeded.')
      quotaErr.name = 'QuotaExceededError'
      expect(isStorageQuotaExceeded(quotaErr)).toBe(true)

      const genericErr = new Error('Network timeout')
      expect(isStorageQuotaExceeded(genericErr)).toBe(false)
    })
  })

  describe('Scoped Queries with Filtering and Sorting', () => {
    it('filters products by search term and category ID', async () => {
      const snap = 'snap_query_test'
      const products: CachedProductRecord[] = [
        {
          id: buildProductKey('u1', 'b1', snap, 'p1'),
          userId: 'u1',
          businessId: 'b1',
          snapshotId: snap,
          productId: 'p1',
          name: 'Chai Tea Latte',
          sku: 'TEA-01',
          barcode: '8901234567890',
          categoryId: 'cat_beverages',
          unit: 'cup',
          sellingPriceMinor: 25000,
          status: 'active',
          trackInventory: true,
          imageUrl: null,
          serverUpdatedAt: null,
          cachedAt: '2026-11-09T00:00:00Z',
        },
        {
          id: buildProductKey('u1', 'b1', snap, 'p2'),
          userId: 'u1',
          businessId: 'b1',
          snapshotId: snap,
          productId: 'p2',
          name: 'Espresso Double',
          sku: 'COF-02',
          barcode: '8901234567891',
          categoryId: 'cat_beverages',
          unit: 'cup',
          sellingPriceMinor: 30000,
          status: 'active',
          trackInventory: true,
          imageUrl: null,
          serverUpdatedAt: null,
          cachedAt: '2026-11-09T00:00:00Z',
        },
        {
          id: buildProductKey('u1', 'b1', snap, 'p3'),
          userId: 'u1',
          businessId: 'b1',
          snapshotId: snap,
          productId: 'p3',
          name: 'Chocolate Croissant',
          sku: 'BAK-01',
          barcode: '8901234567892',
          categoryId: 'cat_bakery',
          unit: 'piece',
          sellingPriceMinor: 20000,
          status: 'active',
          trackInventory: true,
          imageUrl: null,
          serverUpdatedAt: null,
          cachedAt: '2026-11-09T00:00:00Z',
        },
      ]

      await db.cachedProducts.bulkPut(products)

      // Filter by category
      const beverages = await db.queryProducts({
        userId: 'u1',
        businessId: 'b1',
        snapshotId: snap,
        categoryId: 'cat_beverages',
      })
      expect(beverages).toHaveLength(2)

      // Filter by search name
      const searchChai = await db.queryProducts({
        userId: 'u1',
        businessId: 'b1',
        snapshotId: snap,
        search: 'chai',
      })
      expect(searchChai).toHaveLength(1)
      expect(searchChai[0].productId).toBe('p1')

      // Filter by SKU
      const searchSku = await db.queryProducts({
        userId: 'u1',
        businessId: 'b1',
        snapshotId: snap,
        search: 'BAK-01',
      })
      expect(searchSku).toHaveLength(1)
      expect(searchSku[0].name).toBe('Chocolate Croissant')

      // Filter by Barcode
      const searchBarcode = await db.queryProducts({
        userId: 'u1',
        businessId: 'b1',
        snapshotId: snap,
        search: '8901234567891',
      })
      expect(searchBarcode).toHaveLength(1)
      expect(searchBarcode[0].name).toBe('Espresso Double')
    })

    it('returns categories sorted by displayOrder', async () => {
      const snap = 'snap_cat_test'
      const categories: CachedCategoryRecord[] = [
        {
          id: buildCategoryKey('u1', 'b1', snap, 'c2'),
          userId: 'u1',
          businessId: 'b1',
          snapshotId: snap,
          categoryId: 'c2',
          name: 'Snacks',
          slug: 'snacks',
          description: null,
          parentId: null,
          status: 'active',
          displayOrder: 2,
          productCount: 5,
          serverUpdatedAt: null,
          cachedAt: '2026-11-09T00:00:00Z',
        },
        {
          id: buildCategoryKey('u1', 'b1', snap, 'c1'),
          userId: 'u1',
          businessId: 'b1',
          snapshotId: snap,
          categoryId: 'c1',
          name: 'Hot Beverages',
          slug: 'hot-beverages',
          description: null,
          parentId: null,
          status: 'active',
          displayOrder: 1,
          productCount: 12,
          serverUpdatedAt: null,
          cachedAt: '2026-11-09T00:00:00Z',
        },
      ]

      await db.cachedCategories.bulkPut(categories)

      const sorted = await db.queryCategories({
        userId: 'u1',
        businessId: 'b1',
        snapshotId: snap,
      })

      expect(sorted).toHaveLength(2)
      expect(sorted[0].categoryId).toBe('c1')
      expect(sorted[1].categoryId).toBe('c2')
    })
  })
})

