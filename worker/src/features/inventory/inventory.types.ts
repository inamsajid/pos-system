export type StockMovementType =
  | 'opening_stock'
  | 'purchase_receipt'
  | 'sale'
  | 'adjustment_in'
  | 'adjustment_out'
  | 'stock_count_adjustment'
  | 'return_restock'
  | 'return_damaged'
  | 'return_discard'

export type MovementReferenceType =
  | 'sale'
  | 'purchase'
  | 'adjustment'
  | 'opening_stock'
  | 'stock_count'
  | 'return'

export interface InventoryBalanceRow {
  id: string
  business_id: string
  branch_id: string
  product_id: string
  quantity_on_hand: number
  quarantine_quantity: number
  allocated_quantity: number
  last_counted_at: string | null
  updated_at: string
  product_name?: string
  sku?: string
  barcode?: string | null
  unit?: string
  category_name?: string | null
  purchase_price_minor?: number
  min_stock_level?: number
}

export interface InventoryBalanceDTO {
  id: string
  businessId: string
  branchId: string
  productId: string
  productName: string
  sku: string
  barcode: string | null
  unit: string
  categoryName: string | null
  quantityOnHand: number
  quarantineQuantity: number
  allocatedQuantity: number
  availableQuantity: number
  unitCostMinor: number
  isLowStock: boolean
  lastCountedAt: string | null
  updatedAt: string
}

export interface StockMovementRow {
  id: string
  business_id: string
  branch_id: string
  movement_number: string
  product_id: string
  type: StockMovementType
  quantity_change: number
  previous_quantity: number
  new_quantity: number
  unit_cost_minor: number
  reference_type: MovementReferenceType | null
  reference_id: string | null
  reference_number: string | null
  reason: string | null
  notes: string | null
  business_date_key: string
  created_by: string | null
  created_at: string
  product_name?: string
  sku?: string
  unit?: string
  creator_name?: string
}

export interface StockMovementDTO {
  id: string
  businessId: string
  branchId: string
  movementNumber: string
  productId: string
  productName?: string
  sku?: string
  unit?: string
  type: StockMovementType
  quantityChange: number
  previousQuantity: number
  newQuantity: number
  unitCostMinor: number
  referenceType: MovementReferenceType | null
  referenceId: string | null
  referenceNumber: string | null
  reason: string | null
  notes: string | null
  businessDateKey: string
  createdBy: string | null
  creatorName?: string
  createdAt: string
}

export interface CreateStockAdjustmentInput {
  branchId?: string
  productId: string
  quantityChange: number
  type: 'adjustment_in' | 'adjustment_out'
  reason: string
  notes?: string | null
}

export interface StockCountItemInput {
  productId: string
  physicalQuantity?: number
  notes?: string | null
}

export interface CreateStockCountInput {
  branchId?: string
  name: string
  items: StockCountItemInput[]
}

export interface StockCountRow {
  id: string
  business_id: string
  branch_id: string
  count_number: string
  name: string
  status: 'draft' | 'confirmed' | 'cancelled'
  business_date_key: string
  confirmed_at: string | null
  confirmed_by: string | null
  created_by: string
  created_at: string
  branch_name?: string
  creator_name?: string
  confirmer_name?: string
}

export interface StockCountItemRow {
  id: string
  count_id: string
  product_id: string
  system_quantity: number
  physical_quantity: number | null
  variance: number | null
  unit_cost_minor: number
  notes: string | null
  product_name?: string
  sku?: string
  unit?: string
}

export interface StockCountItemDTO {
  id: string
  countId: string
  productId: string
  productName: string
  sku: string
  unit: string
  systemQuantity: number
  physicalQuantity: number | null
  variance: number | null
  unitCostMinor: number
  notes: string | null
}

export interface StockCountDTO {
  id: string
  businessId: string
  branchId: string
  branchName?: string
  countNumber: string
  name: string
  status: 'draft' | 'confirmed' | 'cancelled'
  businessDateKey: string
  confirmedAt: string | null
  confirmedBy: string | null
  createdBy: string
  createdAt: string
  items?: StockCountItemDTO[]
}

export interface InventoryFilterParams {
  branchId?: string
  productId?: string
  categoryId?: string
  search?: string
  lowStock?: boolean
  page: number
  limit: number
}

export interface StockMovementFilterParams {
  branchId?: string
  productId?: string
  type?: StockMovementType
  referenceType?: MovementReferenceType
  startDate?: string
  endDate?: string
  page: number
  limit: number
}

export interface StockCountFilterParams {
  branchId?: string
  status?: 'draft' | 'confirmed' | 'cancelled' | 'all'
  page: number
  limit: number
}

