import type { ProductUnit } from '../../products/types/product.types'

export type StockMovementType = 'opening_stock' | 'purchase_receipt' | 'sale' | 'adjustment_in' | 'adjustment_out' | 'stock_count_adjustment'
export type StockReferenceType = 'sale' | 'purchase' | 'adjustment' | 'opening_stock' | 'stock_count'

export interface StockMovement {
  id: string
  movementNumber: string
  productId: string
  productSnapshot: { name: string; sku: string; unit: ProductUnit }
  type: StockMovementType
  quantityChange: number
  previousQuantity: number
  newQuantity: number
  unitCost?: number
  referenceType?: StockReferenceType
  referenceId?: string
  referenceNumber?: string
  reason?: string
  notes?: string
  createdAt: string
  createdBy?: string
}

export interface StockMovementInput {
  type: Exclude<StockMovementType, 'opening_stock'>
  quantityChange: number
  referenceType?: StockReferenceType
  referenceId?: string
  referenceNumber?: string
  unitCost?: number
  reason?: string
  notes?: string
  createdBy?: string
  movementId?: string
}

export interface StockCountDraft {
  id: string
  name: string
  createdAt: string
  status: 'draft' | 'confirmed'
  rows: Array<{ productId: string; productName: string; sku: string; unit: ProductUnit; systemQuantity: number; physicalQuantity: number | null }>
  confirmedAt?: string
}
