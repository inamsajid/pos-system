import type { Product, ProductStockStatus } from '../types/product.types'

export function getProductStockStatus(product: Pick<Product, 'status' | 'trackInventory' | 'stockQuantity' | 'lowStockThreshold'>): ProductStockStatus {
  if (product.status === 'archived') return 'archived'
  if (!product.trackInventory) return 'not-tracked'
  if (product.stockQuantity === 0) return 'out-of-stock'
  if (product.stockQuantity <= product.lowStockThreshold) return 'low-stock'
  return 'in-stock'
}

export function calculateProductProfit(purchasePrice: number, sellingPrice: number) {
  const profit = sellingPrice - purchasePrice
  return { profit, margin: sellingPrice > 0 ? (profit / sellingPrice) * 100 : 0 }
}

export function normalizeProductCode(value: string) {
  return value.trim().toLocaleLowerCase()
}

export function getProductInitials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || 'PR'
}
