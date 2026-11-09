export type CategoryStatus = 'active' | 'archived'

export type CategoryColor = 'blue' | 'indigo' | 'emerald' | 'amber' | 'rose' | 'purple' | 'cyan'

export type CategoryIconName =
  | 'Tags'
  | 'Laptop'
  | 'Headphones'
  | 'ShoppingBag'
  | 'Shirt'
  | 'Utensils'
  | 'BookOpen'
  | 'Boxes'
  | 'Sparkles'
  | 'Package'

export interface Category {
  id: string
  name: string
  slug: string
  description?: string
  color: CategoryColor
  icon: CategoryIconName
  status: CategoryStatus
  version?: number
  createdAt: string
  updatedAt: string
}

export interface CategoryWithStats extends Category {
  productCount: number
  activeProductCount: number
  totalStockQuantity: number
  // Offline caching metadata
  isCached?: boolean
  isStale?: boolean
  cachedAt?: string
  cachedSnapshotId?: string
}

export type CategoryDraft = Omit<Category, 'id' | 'createdAt' | 'updatedAt'>

export type CategorySort = 'name-asc' | 'name-desc' | 'products-desc' | 'products-asc' | 'newest'

