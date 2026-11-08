import { productMockData } from '../data/productMockData'
import type { Product, ProductDraft, StockAdjustmentInput, StockAdjustmentRecord } from '../types/product.types'
import { normalizeProductCode } from '../utils/productUtils'
import { getProductStock, initializeInventory, initializeProduct, getProductMovements, recordSaleStockMovements, recordStockAdjustment } from '../../inventory/services/inventoryService'
import type { StockMovement } from '../../inventory/types/inventory.types'

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

let products = productMockData.map((product) => ({ ...product }))
initializeInventory(productMockData)

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
    return products.map(cloneProduct)
  },

  async getProductById(productId) {
    const product = products.find((entry) => entry.id === productId)
    return product ? cloneProduct(product) : undefined
  },

  async createProduct(draft) {
    validateUniqueCodes(draft)
    const now = new Date().toISOString()
    const product: Product = { ...draft, id: createId(), createdAt: now, updatedAt: now }
    initializeProduct(product)
    products = [product, ...products]
    return cloneProduct(product)
  },

  async updateProduct(productId, draft) {
    const existing = findProduct(productId)
    validateUniqueCodes(draft, productId)
    const updated: Product = { ...existing, ...draft, stockQuantity: existing.trackInventory ? getProductStock(existing.id) : draft.stockQuantity, id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() }
    products = products.map((product) => product.id === productId ? updated : product)
    return cloneProduct(updated)
  },

  async archiveProduct(productId) {
    const existing = findProduct(productId)
    const updated = { ...existing, status: 'archived' as const, updatedAt: new Date().toISOString() }
    products = products.map((product) => product.id === productId ? updated : product)
    return cloneProduct(updated)
  },

  async restoreProduct(productId) {
    const existing = findProduct(productId)
    const updated = { ...existing, status: 'active' as const, updatedAt: new Date().toISOString() }
    products = products.map((product) => product.id === productId ? updated : product)
    return cloneProduct(updated)
  },

  async adjustProductStock(productId, adjustment) {
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
