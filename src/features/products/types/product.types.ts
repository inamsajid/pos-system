export type ProductStatus = 'active' | 'archived'

export type ProductUnit = 'piece' | 'kg' | 'gram' | 'liter' | 'meter' | 'box' | 'pack' | 'dozen'

export interface Product {
  id: string
  name: string
  sku: string
  barcode?: string
  description?: string
  categoryId: string
  imageUrl?: string
  unit: ProductUnit
  purchasePrice: number
  sellingPrice: number
  stockQuantity: number
  lowStockThreshold: number
  status: ProductStatus
  trackInventory: boolean
  createdAt: string
  updatedAt: string
}

export type ProductDraft = Omit<Product, 'id' | 'createdAt' | 'updatedAt'>

export type StockAdjustmentType = 'add' | 'remove' | 'set'

export interface StockAdjustmentInput {
  type: StockAdjustmentType
  quantity: number
  reason: string
  notes?: string
}

export interface StockAdjustmentRecord extends StockAdjustmentInput {
  id: string
  productId: string
  previousStock: number
  resultingStock: number
  createdAt: string
}

export interface ProductCategory {
  id: string
  name: string
}

export type ProductStockStatus = 'in-stock' | 'low-stock' | 'out-of-stock' | 'not-tracked' | 'archived'

export type ProductSort = 'name-asc' | 'name-desc' | 'price-asc' | 'price-desc' | 'stock-asc' | 'stock-desc'
