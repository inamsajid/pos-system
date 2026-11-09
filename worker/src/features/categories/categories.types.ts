export type CategoryStatus = 'active' | 'archived'

export interface CategoryRow {
  id: string
  business_id: string
  name: string
  slug: string
  description: string | null
  parent_id: string | null
  display_order: number
  status: CategoryStatus
  version: number
  created_at: string
  updated_at: string
}

export interface CategoryWithStatsRow extends CategoryRow {
  product_count: number
  active_product_count: number
  total_stock_quantity: number
}

export interface CategoryDTO {
  id: string
  businessId: string
  name: string
  slug: string
  description: string | null
  parentId: string | null
  displayOrder: number
  status: CategoryStatus
  productCount: number
  activeProductCount: number
  totalStockQuantity: number
  version: number
  createdAt: string
  updatedAt: string
}

export interface CreateCategoryInput {
  name: string
  slug?: string
  description?: string | null
  parentId?: string | null
  displayOrder?: number
}

export interface UpdateCategoryInput {
  name?: string
  slug?: string
  description?: string | null
  parentId?: string | null
  displayOrder?: number
  status?: CategoryStatus
  expectedVersion?: number
}

export interface ReplaceCategoryInput {
  name: string
  slug?: string
  description?: string | null
  parentId?: string | null
  displayOrder?: number
  status?: CategoryStatus
  expectedVersion?: number
}

export interface CategoryFilterParams {
  status?: CategoryStatus | 'all'
  parentId?: string | null
}

