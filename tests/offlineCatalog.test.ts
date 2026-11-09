import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { apiClient, ApiError, setApiContextProvider } from '../src/lib/api-client'
import {
  offlineDb,
  syncCatalog,
  isNetworkError,
  buildProductKey,
  buildCategoryKey,
  buildStockKey,
} from '../src/lib/offline'
import { productService } from '../src/features/products/services/productService'
import { categoryService } from '../src/features/categories/services/categoryService'
import type { ProductDTO, CategoryDTO } from '../src/api/types/dto'

describe('Step 13.3 — Products & Categories Offline Caching', () => {
  const testUserId = 'usr_offline_test'
  const testBusinessId = 'biz_offline_test'
  const testBranchId = 'branch_offline_test'

  beforeEach(async () => {
    vi.restoreAllMocks()
    await offlineDb.clearAllOfflineData()

    // Configure test API context
    setApiContextProvider(() => ({
      userId: testUserId,
      businessId: testBusinessId,
      branchId: testBranchId,
    }))

    // Default navigator.onLine to true
    vi.stubGlobal('navigator', {
      onLine: true,
      platform: 'test',
      storage: {
        estimate: async () => ({ quota: 1000000, usage: 200000 }),
        persisted: async () => true,
        persist: async () => true,
      },
    })
  })

  afterEach(async () => {
    setApiContextProvider(null)
    vi.unstubAllGlobals()
    await offlineDb.clearAllOfflineData()
  })

  const mockCategories: CategoryDTO[] = [
    {
      id: 'cat_beverages',
      businessId: testBusinessId,
      name: 'Cold & Hot Beverages',
      slug: 'beverages',
      description: 'Refreshing drinks and coffees',
      status: 'active',
      productCount: 2,
      activeProductCount: 2,
      totalStockQuantity: 50,
      createdAt: '2026-11-09T00:00:00Z',
      updatedAt: '2026-11-09T00:00:00Z',
    },
    {
      id: 'cat_bakery',
      businessId: testBusinessId,
      name: 'Fresh Bakery',
      slug: 'bakery',
      description: 'Breads, muffins, and pastries',
      status: 'active',
      productCount: 1,
      activeProductCount: 1,
      totalStockQuantity: 15,
      createdAt: '2026-11-09T00:00:00Z',
      updatedAt: '2026-11-09T00:00:00Z',
    },
  ]

  const mockProducts: ProductDTO[] = [
    {
      id: 'prod_latte',
      businessId: testBusinessId,
      name: 'Caramel Macchiato',
      sku: 'COF-LATTE-01',
      barcode: '990100200300',
      description: 'Espresso with vanilla syrup and caramel drizzle',
      categoryId: 'cat_beverages',
      imageUrl: 'https://cdn.example.com/latte.jpg',
      unit: 'cup',
      purchasePriceMinor: 15000, // 150.00 PKR cost
      sellingPriceMinor: 45000, // 450.00 PKR selling
      stockQuantity: 35,
      lowStockThreshold: 10,
      status: 'active',
      trackInventory: true,
      createdAt: '2026-11-09T00:00:00Z',
      updatedAt: '2026-11-09T00:00:00Z',
    },
    {
      id: 'prod_croissant',
      businessId: testBusinessId,
      name: 'Butter Croissant',
      sku: 'BAK-CROISS-01',
      barcode: '990100200301',
      description: 'Flaky baked French butter croissant',
      categoryId: 'cat_bakery',
      imageUrl: null,
      unit: 'piece',
      purchasePriceMinor: 8000, // 80.00 PKR cost
      sellingPriceMinor: 22000, // 220.00 PKR selling
      stockQuantity: 15,
      lowStockThreshold: 5,
      status: 'active',
      trackInventory: true,
      createdAt: '2026-11-09T00:00:00Z',
      updatedAt: '2026-11-09T00:00:00Z',
    },
  ]

  describe('Catalog Synchronization Engine (syncCatalog)', () => {
    it('downloads and stores catalog in Dexie under an active snapshot', async () => {
      // Mock apiClient.get
      vi.spyOn(apiClient, 'get').mockImplementation(async (path: string) => {
        if (path === '/categories') {
          return mockCategories as any
        }
        if (path === '/products') {
          return mockProducts as any
        }
        return [] as any
      })

      const syncResult = await syncCatalog({
        userId: testUserId,
        businessId: testBusinessId,
        branchId: testBranchId,
      })

      expect(syncResult.success).toBe(true)
      expect(syncResult.productCount).toBe(2)
      expect(syncResult.categoryCount).toBe(2)
      expect(syncResult.snapshotId).toBeDefined()

      // Verify active snapshot is registered in Dexie
      const activeSnapshot = await offlineDb.getActiveSnapshotId(
        testUserId,
        testBusinessId,
        testBranchId,
        'catalog'
      )
      expect(activeSnapshot).toBe(syncResult.snapshotId)

      // Verify cached products in Dexie
      const cachedProducts = await offlineDb.cachedProducts.toArray()
      expect(cachedProducts).toHaveLength(2)

      // INVARIANT: purchasePriceMinor MUST be stripped from client cache
      for (const p of cachedProducts) {
        expect((p as any).purchasePriceMinor).toBeUndefined()
        expect(p.sellingPriceMinor).toBeGreaterThan(0)
      }

      // Verify branch stock cached
      const cachedStock = await offlineDb.cachedBranchStock.toArray()
      expect(cachedStock).toHaveLength(2)
      const latteStock = cachedStock.find((s) => s.productId === 'prod_latte')
      expect(latteStock?.quantityOnHand).toBe(35)
    })

    it('rolls back candidate snapshot and keeps previous active snapshot on fetch failure', async () => {
      // Seed an initial stable snapshot
      const stableSnap = 'snap_stable_prior'
      await offlineDb.cachedProducts.put({
        id: buildProductKey(testUserId, testBusinessId, stableSnap, 'prod_stable'),
        userId: testUserId,
        businessId: testBusinessId,
        snapshotId: stableSnap,
        productId: 'prod_stable',
        name: 'Stable Item',
        sku: 'STABLE-01',
        barcode: null,
        categoryId: null,
        unit: 'piece',
        sellingPriceMinor: 10000,
        status: 'active',
        trackInventory: false,
        imageUrl: null,
        serverUpdatedAt: null,
        cachedAt: '2026-11-09T00:00:00Z',
      })
      await offlineDb.activateSnapshot({
        userId: testUserId,
        businessId: testBusinessId,
        branchId: testBranchId,
        resource: 'catalog',
        newSnapshotId: stableSnap,
        recordCount: 1,
      })

      // Simulate network dropping during subsequent sync
      vi.spyOn(apiClient, 'get').mockImplementation(async (path: string) => {
        if (path === '/categories') {
          return mockCategories as any
        }
        if (path === '/products') {
          throw new TypeError('Failed to fetch (network disconnected)')
        }
        return [] as any
      })

      const syncResult = await syncCatalog({
        userId: testUserId,
        businessId: testBusinessId,
        branchId: testBranchId,
      })

      expect(syncResult.success).toBe(false)
      expect(syncResult.error).toContain('Failed to fetch')

      // Verify the previous stable snapshot is preserved as active
      const activeSnapshot = await offlineDb.getActiveSnapshotId(
        testUserId,
        testBusinessId,
        testBranchId,
        'catalog'
      )
      expect(activeSnapshot).toBe(stableSnap)

      // Verify candidate category records were rolled back
      const categoriesRemaining = await offlineDb.cachedCategories.toArray()
      expect(categoriesRemaining).toHaveLength(0)

      // Verify stable product is still present
      const productsRemaining = await offlineDb.cachedProducts.toArray()
      expect(productsRemaining).toHaveLength(1)
      expect(productsRemaining[0].productId).toBe('prod_stable')
    })
  })

  describe('Product Service Network-First with Offline Fallback', () => {
    it('returns fresh server data when online', async () => {
      vi.spyOn(apiClient, 'get').mockResolvedValue(mockProducts as any)

      const products = await productService.getProducts()
      expect(products).toHaveLength(2)
      expect(products[0].id).toBe('prod_latte')
      expect(products[0].purchasePrice).toBe(150)
      expect(products[0].sellingPrice).toBe(450)
      expect(products[0].isCached).toBeUndefined()
    })

    it('falls back to Dexie cached snapshot when network is offline', async () => {
      // 1. Ingest cache
      const snap = 'snap_offline_view'
      await offlineDb.cachedProducts.bulkPut([
        {
          id: buildProductKey(testUserId, testBusinessId, snap, 'prod_latte'),
          userId: testUserId,
          businessId: testBusinessId,
          snapshotId: snap,
          productId: 'prod_latte',
          name: 'Caramel Macchiato',
          sku: 'COF-LATTE-01',
          barcode: '990100200300',
          categoryId: 'cat_beverages',
          unit: 'cup',
          sellingPriceMinor: 45000,
          status: 'active',
          trackInventory: true,
          imageUrl: null,
          serverUpdatedAt: '2026-11-09T00:00:00Z',
          cachedAt: '2026-11-09T08:00:00Z',
        },
      ])
      await offlineDb.cachedBranchStock.put({
        id: buildStockKey(testUserId, testBusinessId, testBranchId, snap, 'prod_latte'),
        userId: testUserId,
        businessId: testBusinessId,
        branchId: testBranchId,
        snapshotId: snap,
        productId: 'prod_latte',
        quantityOnHand: 28,
        unit: 'cup',
        reorderThreshold: 10,
        serverUpdatedAt: null,
        cachedAt: '2026-11-09T08:00:00Z',
      })
      await offlineDb.activateSnapshot({
        userId: testUserId,
        businessId: testBusinessId,
        branchId: testBranchId,
        resource: 'catalog',
        newSnapshotId: snap,
        recordCount: 1,
      })

      // 2. Simulate offline network error
      vi.spyOn(apiClient, 'get').mockRejectedValue(new TypeError('Failed to fetch'))

      const products = await productService.getProducts()
      expect(products).toHaveLength(1)
      const latte = products[0]
      expect(latte.id).toBe('prod_latte')
      expect(latte.isCached).toBe(true)
      expect(latte.isStale).toBe(true)
      expect(latte.cachedSnapshotId).toBe(snap)
      expect(latte.stockNotice).toContain('Last known stock')
      expect(latte.stockQuantity).toBe(28)
      // Wholesale purchase price is 0 to protect sensitive margin data
      expect(latte.purchasePrice).toBe(0)
    })

    it('falls back to Dexie cached snapshot for single product lookup', async () => {
      const snap = 'snap_single_lookup'
      await offlineDb.cachedProducts.put({
        id: buildProductKey(testUserId, testBusinessId, snap, 'prod_croissant'),
        userId: testUserId,
        businessId: testBusinessId,
        snapshotId: snap,
        productId: 'prod_croissant',
        name: 'Butter Croissant',
        sku: 'BAK-CROISS-01',
        barcode: '990100200301',
        categoryId: 'cat_bakery',
        unit: 'piece',
        sellingPriceMinor: 22000,
        status: 'active',
        trackInventory: true,
        imageUrl: null,
        serverUpdatedAt: '2026-11-09T00:00:00Z',
        cachedAt: '2026-11-09T09:00:00Z',
      })
      await offlineDb.cachedBranchStock.put({
        id: buildStockKey(testUserId, testBusinessId, testBranchId, snap, 'prod_croissant'),
        userId: testUserId,
        businessId: testBusinessId,
        branchId: testBranchId,
        snapshotId: snap,
        productId: 'prod_croissant',
        quantityOnHand: 14,
        unit: 'piece',
        reorderThreshold: 5,
        serverUpdatedAt: null,
        cachedAt: '2026-11-09T09:00:00Z',
      })
      await offlineDb.activateSnapshot({
        userId: testUserId,
        businessId: testBusinessId,
        branchId: testBranchId,
        resource: 'catalog',
        newSnapshotId: snap,
        recordCount: 1,
      })

      vi.spyOn(apiClient, 'get').mockRejectedValue(new TypeError('Failed to fetch'))

      const item = await productService.getProductById('prod_croissant')
      expect(item).toBeDefined()
      expect(item?.id).toBe('prod_croissant')
      expect(item?.isCached).toBe(true)
      expect(item?.stockQuantity).toBe(14)
    })

    it('does NOT fall back to offline cache on HTTP 401 or 403 errors', async () => {
      vi.spyOn(apiClient, 'get').mockRejectedValue(
        new ApiError('Unauthorized', 401, 'UNAUTHORIZED')
      )

      await expect(productService.getProducts()).rejects.toThrow('Unauthorized')
    })

    it('returns undefined without falling back on HTTP 404 error', async () => {
      vi.spyOn(apiClient, 'get').mockRejectedValue(
        new ApiError('Product not found', 404, 'NOT_FOUND')
      )

      const result = await productService.getProductById('non_existent')
      expect(result).toBeUndefined()
    })
  })

  describe('Category Service Network-First with Offline Fallback', () => {
    it('returns cached categories when offline', async () => {
      const snap = 'snap_cat_offline'
      await offlineDb.cachedCategories.put({
        id: buildCategoryKey(testUserId, testBusinessId, snap, 'cat_beverages'),
        userId: testUserId,
        businessId: testBusinessId,
        snapshotId: snap,
        categoryId: 'cat_beverages',
        name: 'Cold & Hot Beverages',
        slug: 'beverages',
        description: 'Beverages description',
        parentId: null,
        status: 'active',
        displayOrder: 1,
        productCount: 4,
        serverUpdatedAt: null,
        cachedAt: '2026-11-09T00:00:00Z',
      })
      await offlineDb.activateSnapshot({
        userId: testUserId,
        businessId: testBusinessId,
        branchId: testBranchId,
        resource: 'catalog',
        newSnapshotId: snap,
        recordCount: 1,
      })

      vi.spyOn(apiClient, 'get').mockRejectedValue(new TypeError('NetworkError'))

      const categories = await categoryService.getCategories()
      expect(categories).toHaveLength(1)
      expect(categories[0].id).toBe('cat_beverages')
      expect(categories[0].isCached).toBe(true)
      expect(categories[0].isStale).toBe(true)
      expect(categories[0].cachedSnapshotId).toBe(snap)
    })
  })

  describe('Offline Mutation Guarding', () => {
    it('blocks product creation when offline', async () => {
      vi.stubGlobal('navigator', { onLine: false })

      await expect(
        productService.createProduct({
          name: 'New Offline Item',
          sku: 'OFF-01',
          categoryId: 'cat_beverages',
          unit: 'piece',
          purchasePrice: 10,
          sellingPrice: 20,
          stockQuantity: 10,
          lowStockThreshold: 2,
          status: 'active',
          trackInventory: true,
        })
      ).rejects.toThrow(/Offline mode: Product creation requires an active server connection/i)
    })

    it('blocks category creation when offline', async () => {
      vi.stubGlobal('navigator', { onLine: false })

      await expect(
        categoryService.createCategory({
          name: 'Offline Category',
          slug: 'offline-cat',
          color: 'blue',
          icon: 'Tags',
          status: 'active',
        })
      ).rejects.toThrow(/Offline mode: Category creation requires an active server connection/i)
    })
  })

  describe('Network Error Detection Utility', () => {
    it('correctly classifies network errors vs HTTP status codes', () => {
      expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true)
      expect(isNetworkError(new Error('Network request failed'))).toBe(true)
      expect(isNetworkError(new ApiError('Not Found', 404))).toBe(false)
      expect(isNetworkError(new ApiError('Forbidden', 403))).toBe(false)
      expect(isNetworkError(new ApiError('Bad Request', 400))).toBe(false)
      expect(isNetworkError(new ApiError('Internal Error', 500))).toBe(false)
    })
  })
})

