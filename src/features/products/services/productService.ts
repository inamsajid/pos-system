import { apiClient, ApiError, getApiContext } from '../../../lib/api-client'
import type { ProductDTO } from '../../../api/types/dto'
import { productMockData } from '../data/productMockData'
import type { Product, ProductDraft, StockAdjustmentInput, StockAdjustmentRecord, ProductUnit } from '../types/product.types'
import { normalizeProductCode } from '../utils/productUtils'
import { getProductStock, initializeInventory, initializeProduct, getProductMovements, recordSaleStockMovements, recordStockAdjustment } from '../../inventory/services/inventoryService'
import type { StockMovement } from '../../inventory/types/inventory.types'
import {
  offlineDb,
  isNetworkError,
  syncCatalog,
  buildProductKey,
  type CachedProductRecord,
  type CachedBranchStockRecord,
} from '../../../lib/offline'

export interface ProductService {
  getProducts(): Promise<Product[]>
  getProductById(productId: string): Promise<Product | undefined>
  createProduct(draft: ProductDraft): Promise<Product>
  updateProduct(productId: string, draft: ProductDraft): Promise<Product>
  archiveProduct(productId: string): Promise<Product>
  restoreProduct(productId: string): Promise<Product>
  adjustProductStock(productId: string, adjustment: StockAdjustmentInput): Promise<Product>
  getProductAdjustments(productId: string): Promise<StockAdjustmentRecord[]>
  deductStockForSale(items: Array<{ productId: string; quantity: number }>, sale?: { id: string; number: string }): Promise<void>
}

function isExplicitDemo(): boolean {
  return import.meta.env?.VITE_DATA_SOURCE === 'mock'
}

let products = productMockData.map((product) => ({ ...product }))
initializeInventory(productMockData)

function mapDtoToProduct(dto: ProductDTO): Product {
  return {
    id: dto.id,
    name: dto.name,
    sku: dto.sku,
    barcode: dto.barcode ?? undefined,
    description: dto.description ?? undefined,
    categoryId: dto.categoryId ?? '',
    imageUrl: dto.imageUrl ?? undefined,
    unit: dto.unit,
    purchasePrice: dto.purchasePriceMinor / 100,
    sellingPrice: dto.sellingPriceMinor / 100,
    stockQuantity: dto.stockQuantity,
    lowStockThreshold: dto.lowStockThreshold,
    status: dto.status,
    trackInventory: dto.trackInventory,
    version: dto.version,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}

function mapCachedToProduct(
  cached: CachedProductRecord,
  stockRec?: CachedBranchStockRecord
): Product {
  return {
    id: cached.productId,
    name: cached.name,
    sku: cached.sku,
    barcode: cached.barcode ?? undefined,
    description: undefined,
    categoryId: cached.categoryId ?? '',
    imageUrl: cached.imageUrl ?? undefined,
    unit: cached.unit as ProductUnit,
    purchasePrice: 0, // Excluded from local storage for merchant privacy
    sellingPrice: cached.sellingPriceMinor / 100,
    stockQuantity: stockRec?.quantityOnHand ?? 0,
    lowStockThreshold: stockRec?.reorderThreshold ?? 0,
    status: cached.status,
    trackInventory: cached.trackInventory,
    version: cached.version,
    createdAt: cached.cachedAt,
    updatedAt: cached.serverUpdatedAt || cached.cachedAt,
    isCached: true,
    isStale: true,
    cachedAt: cached.cachedAt,
    cachedSnapshotId: cached.snapshotId,
    stockNotice: `Last known stock — synchronized at ${new Date(cached.cachedAt).toLocaleDateString()}. Informational only.`,
  }
}

function cloneProduct(product: Product): Product {
  return { ...product, stockQuantity: product.trackInventory ? getProductStock(product.id) : 0 }
}

function findProduct(productId: string) {
  const product = products.find((entry) => entry.id === productId)
  if (!product) throw new Error('Product not found.')
  return product
}

function validateUniqueCodes(draft: ProductDraft, excludedId?: string) {
  const duplicateSku = products.some((product) => product.id !== excludedId && normalizeProductCode(product.sku) === normalizeProductCode(draft.sku))
  if (duplicateSku) throw new Error('SKU must be unique.')
  const barcode = draft.barcode?.trim()
  const duplicateBarcode = Boolean(barcode && products.some((product) => product.id !== excludedId && product.barcode && normalizeProductCode(product.barcode) === normalizeProductCode(barcode)))
  if (duplicateBarcode) throw new Error('Barcode must be unique.')
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `prd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export const productService: ProductService = {
  async getProducts() {
    if (!isExplicitDemo()) {
      try {
        const response = await apiClient.get<ProductDTO[]>('/products?limit=100')
        // Background sync to update Dexie offline cache
        syncCatalog().catch(() => {})
        return (response || []).map(mapDtoToProduct)
      } catch (err) {
        if (!isNetworkError(err)) {
          throw err
        }

        // Offline fallback
        const ctx = getApiContext()
        if (ctx.userId && ctx.businessId) {
          const branchId = ctx.branchId || 'default'
          const activeSnap = await offlineDb.getActiveSnapshotId(
            ctx.userId,
            ctx.businessId,
            branchId,
            'catalog'
          )

          if (activeSnap) {
            const [cachedProducts, stockMap] = await Promise.all([
              offlineDb.queryProducts({
                userId: ctx.userId,
                businessId: ctx.businessId,
                snapshotId: activeSnap,
              }),
              offlineDb.queryStockMap({
                userId: ctx.userId,
                businessId: ctx.businessId,
                branchId,
                snapshotId: activeSnap,
              }),
            ])

            return cachedProducts.map((p) => mapCachedToProduct(p, stockMap.get(p.productId)))
          }
        }

        throw err
      }
    }
    return products.map(cloneProduct)
  },

  async getProductById(productId) {
    if (!isExplicitDemo()) {
      try {
        const response = await apiClient.get<ProductDTO>(`/products/${productId}`)
        return response ? mapDtoToProduct(response) : undefined
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          return undefined
        }
        if (!isNetworkError(err)) {
          throw err
        }

        // Offline fallback
        const ctx = getApiContext()
        if (ctx.userId && ctx.businessId) {
          const branchId = ctx.branchId || 'default'
          const activeSnap = await offlineDb.getActiveSnapshotId(
            ctx.userId,
            ctx.businessId,
            branchId,
            'catalog'
          )

          if (activeSnap) {
            const key = buildProductKey(ctx.userId, ctx.businessId, activeSnap, productId)
            const cached = await offlineDb.cachedProducts.get(key)
            if (cached) {
              const stockMap = await offlineDb.queryStockMap({
                userId: ctx.userId,
                businessId: ctx.businessId,
                branchId,
                snapshotId: activeSnap,
              })
              return mapCachedToProduct(cached, stockMap.get(productId))
            }
            return undefined
          }
        }

        throw err
      }
    }
    const product = products.find((entry) => entry.id === productId)
    return product ? cloneProduct(product) : undefined
  },

  async createProduct(draft) {
    if (!isExplicitDemo()) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error('Offline mode: Product creation requires an active server connection.')
      }
      const response = await apiClient.post<ProductDTO>('/products', {
        name: draft.name.trim(),
        sku: draft.sku.trim(),
        barcode: draft.barcode?.trim() || null,
        categoryId: draft.categoryId || null,
        description: draft.description?.trim() || null,
        imageUrl: draft.imageUrl || null,
        unit: draft.unit,
        purchasePriceMinor: Math.round(draft.purchasePrice * 100),
        sellingPriceMinor: Math.round(draft.sellingPrice * 100),
        lowStockThreshold: draft.lowStockThreshold,
        trackInventory: draft.trackInventory,
      })
      syncCatalog().catch(() => {})
      const mapped = mapDtoToProduct(response)
      initializeProduct(mapped)
      return mapped
    }

    validateUniqueCodes(draft)
    const now = new Date().toISOString()
    const product: Product = { ...draft, id: createId(), createdAt: now, updatedAt: now }
    initializeProduct(product)
    products = [product, ...products]
    return cloneProduct(product)
  },

  async updateProduct(productId, draft) {
    if (!isExplicitDemo()) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error('Offline mode: Product updates require an active server connection.')
      }
      const response = await apiClient.patch<ProductDTO>(`/products/${productId}`, {
        name: draft.name.trim(),
        sku: draft.sku.trim(),
        barcode: draft.barcode?.trim() || null,
        categoryId: draft.categoryId || null,
        description: draft.description?.trim() || null,
        imageUrl: draft.imageUrl || null,
        unit: draft.unit,
        purchasePriceMinor: Math.round(draft.purchasePrice * 100),
        sellingPriceMinor: Math.round(draft.sellingPrice * 100),
        lowStockThreshold: draft.lowStockThreshold,
        trackInventory: draft.trackInventory,
        status: draft.status,
        expectedVersion: draft.version,
      })
      syncCatalog().catch(() => {})
      return mapDtoToProduct(response)
    }

    const existing = findProduct(productId)
    validateUniqueCodes(draft, productId)
    const updated: Product = { ...existing, ...draft, stockQuantity: existing.trackInventory ? getProductStock(existing.id) : draft.stockQuantity, id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() }
    products = products.map((product) => product.id === productId ? updated : product)
    return cloneProduct(updated)
  },

  async archiveProduct(productId) {
    if (!isExplicitDemo()) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error('Offline mode: Archiving products requires an active server connection.')
      }
      await apiClient.delete(`/products/${productId}`)
      syncCatalog().catch(() => {})
      const updated = await this.getProductById(productId)
      if (!updated) {
        throw new Error('Product not found after archiving.')
      }
      return updated
    }

    const existing = findProduct(productId)
    const updated = { ...existing, status: 'archived' as const, updatedAt: new Date().toISOString() }
    products = products.map((product) => product.id === productId ? updated : product)
    return cloneProduct(updated)
  },

  async restoreProduct(productId) {
    if (!isExplicitDemo()) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error('Offline mode: Restoring products requires an active server connection.')
      }
      const response = await apiClient.patch<ProductDTO>(`/products/${productId}`, { status: 'active' })
      syncCatalog().catch(() => {})
      return mapDtoToProduct(response)
    }

    const existing = findProduct(productId)
    const updated = { ...existing, status: 'active' as const, updatedAt: new Date().toISOString() }
    products = products.map((product) => product.id === productId ? updated : product)
    return cloneProduct(updated)
  },

  async adjustProductStock(productId, adjustment) {
    if (!isExplicitDemo()) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error('Offline mode: Stock adjustments require an active server connection.')
      }
      const existing = await this.getProductById(productId)
      if (!existing) throw new Error('Product not found.')
      if (existing.status === 'archived') throw new Error('Archived products cannot receive normal stock adjustments.')
      if (!existing.trackInventory) throw new Error('Inventory tracking is disabled for this product.')
      if (!Number.isFinite(adjustment.quantity) || adjustment.quantity < 0 || (adjustment.type !== 'set' && adjustment.quantity === 0)) throw new Error('Enter a valid stock adjustment quantity.')
      if (!adjustment.reason.trim()) throw new Error('A stock adjustment reason is required.')

      const previous = existing.stockQuantity ?? 0
      const next = adjustment.type === 'add' ? previous + adjustment.quantity : adjustment.type === 'remove' ? previous - adjustment.quantity : adjustment.quantity
      if (next < 0) throw new Error('Stock quantity cannot be negative.')
      const change = next - previous
      if (change === 0) return cloneProduct(existing)

      const type = change > 0 ? 'adjustment_in' : 'adjustment_out'
      const payload = {
        productId,
        quantityChange: Math.abs(change),
        type,
        reason: adjustment.reason,
        notes: adjustment.notes || null,
      }
      await apiClient.post('/inventory/adjustments', payload)
      syncCatalog().catch(() => {})
      const updated = await this.getProductById(productId)
      return updated ?? existing
    }

    const existing = findProduct(productId)
    if (existing.status === 'archived') throw new Error('Archived products cannot receive normal stock adjustments.')
    if (!existing.trackInventory) throw new Error('Inventory tracking is disabled for this product.')
    if (!Number.isFinite(adjustment.quantity) || adjustment.quantity < 0 || (adjustment.type !== 'set' && adjustment.quantity === 0)) throw new Error('Enter a valid stock adjustment quantity.')
    if (!adjustment.reason.trim()) throw new Error('A stock adjustment reason is required.')
    const previous = getProductStock(productId)
    const next = adjustment.type === 'add' ? previous + adjustment.quantity : adjustment.type === 'remove' ? previous - adjustment.quantity : adjustment.quantity
    if (next < 0) throw new Error('Stock quantity cannot be negative.')
    const change = next - previous
    if (change !== 0) recordStockAdjustment(existing, { type: change > 0 ? 'adjustment_in' : 'adjustment_out', quantityChange: change, referenceType: 'adjustment', referenceId: createId(), referenceNumber: `ADJ-${Date.now()}`, reason: adjustment.reason, notes: adjustment.notes })
    const updated = { ...existing, stockQuantity: getProductStock(productId), updatedAt: new Date().toISOString() }
    products = products.map((product) => product.id === productId ? updated : product)
    return cloneProduct(updated)
  },

  async getProductAdjustments(productId) {
    return getProductMovements(productId).filter(movement => movement.type === 'adjustment_in' || movement.type === 'adjustment_out').map(movement => movementToAdjustment(movement))
  },

  async deductStockForSale(items, sale = { id: createId(), number: 'POS Sale' }) {
    const requested = new Map<string, number>()
    for (const item of items) {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error('Sale quantities must be greater than zero.')
      requested.set(item.productId, (requested.get(item.productId) ?? 0) + item.quantity)
    }
    const snapshots = [...requested].map(([productId, quantity]) => {
      const product = products.find(entry => entry.id === productId)
      if (!product) throw new Error('A product in the cart no longer exists.')
      if (product.status !== 'active') throw new Error(`${product.name} is not available for sale.`)
      if (product.trackInventory && quantity > getProductStock(productId)) throw new Error(`${product.name} does not have enough stock.`)
      return { product: { ...product, stockQuantity: getProductStock(productId) }, quantity }
    })
    recordSaleStockMovements(snapshots, sale)
  },
}

function movementToAdjustment(movement: StockMovement): StockAdjustmentRecord {
  const quantity = Math.abs(movement.quantityChange)
  return { id: movement.id, productId: movement.productId, type: movement.type === 'adjustment_in' ? 'add' : 'remove', quantity, reason: movement.reason ?? 'Stock adjustment', notes: movement.notes, previousStock: movement.previousQuantity, resultingStock: movement.newQuantity, createdAt: movement.createdAt }
}
