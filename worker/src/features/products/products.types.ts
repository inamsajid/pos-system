export type ProductUnit =
  | 'piece'
  | 'kg'
  | 'gram'
  | 'liter'
  | 'meter'
  | 'box'
  | 'pack'
  | 'dozen'

export type ProductStatus = 'active' | 'archived'

export interface ProductRow {
  id: string
  business_id: string
  category_id: string | null
  category_name?: string | null
  sku: string
  barcode: string | null
  name: string
  description: string | null
  image_url: string | null
  unit: ProductUnit
  purchase_price_minor: number
  selling_price_minor: number
  low_stock_threshold: number
  track_inventory: number
  status: ProductStatus
  stock_quantity: number
  version: number
  created_at: string
  updated_at: string
}

export interface ProductDTO {
  id: string
  businessId: string
  sku: string
  barcode: string | null
  name: string
  description: string | null
  categoryId: string | null
  categoryName?: string | null
  unit: ProductUnit
  purchasePriceMinor: number
  sellingPriceMinor: number
  stockQuantity: number
  lowStockThreshold: number
  trackInventory: boolean
  status: ProductStatus
  imageUrl: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface CreateProductInput {
  name: string
  sku: string
  barcode?: string | null
  categoryId?: string | null
  description?: string | null
  imageUrl?: string | null
  unit: ProductUnit
  purchasePriceMinor: number
  sellingPriceMinor: number
  lowStockThreshold?: number
  trackInventory?: boolean
}

export interface UpdateProductInput {
  name?: string
  sku?: string
  barcode?: string | null
  categoryId?: string | null
  description?: string | null
  imageUrl?: string | null
  unit?: ProductUnit
  purchasePriceMinor?: number
  sellingPriceMinor?: number
  lowStockThreshold?: number
  trackInventory?: boolean
  status?: ProductStatus
  expectedVersion?: number
}

export interface ReplaceProductInput {
  name: string
  sku: string
  barcode?: string | null
  categoryId?: string | null
  description?: string | null
  imageUrl?: string | null
  unit: ProductUnit
  purchasePriceMinor: number
  sellingPriceMinor: number
  lowStockThreshold?: number
  trackInventory?: boolean
  status?: ProductStatus
  expectedVersion?: number
}

export type ProductSortField =
  | 'name'
  | 'sku'
  | 'selling_price'
  | 'purchase_price'
  | 'stock'
  | 'created_at'
  | 'updated_at'

export interface ProductFilterParams {
  search?: string
  sku?: string
  barcode?: string
  categoryId?: string
  status?: ProductStatus | 'all'
  lowStock?: boolean
  page: number
  limit: number
  sortBy: ProductSortField
  sortOrder: 'asc' | 'desc'
}

export interface ProductPaginationMeta {
  page: number
  limit: number
  totalCount: number
  totalPages: number
  hasNextPage: boolean
}

export interface ProductListResult {
  items: ProductDTO[]
  meta: ProductPaginationMeta
}

