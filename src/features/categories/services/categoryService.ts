import { apiClient, ApiError, getApiContext } from '../../../lib/api-client'
import type { CategoryDTO } from '../../../api/types/dto'
import { productService } from '../../products/services/productService'
import { initialCategories } from '../data/categoryMockData'
import type {
  Category,
  CategoryColor,
  CategoryDraft,
  CategoryIconName,
  CategoryWithStats,
} from '../types/category.types'
import { generateSlug } from '../utils/categoryUtils'
import {
  offlineDb,
  isNetworkError,
  buildCategoryKey,
  type CachedCategoryRecord,
} from '../../../lib/offline'

export interface CategoryService {
  getCategories(): Promise<CategoryWithStats[]>
  getCategoryById(categoryId: string): Promise<CategoryWithStats | undefined>
  createCategory(draft: CategoryDraft): Promise<CategoryWithStats>
  updateCategory(categoryId: string, draft: CategoryDraft): Promise<CategoryWithStats>
  archiveCategory(categoryId: string): Promise<CategoryWithStats>
  restoreCategory(categoryId: string): Promise<CategoryWithStats>
  exportCategoriesCsv(categories: CategoryWithStats[]): void
}

function isExplicitDemo(): boolean {
  return import.meta.env?.VITE_DATA_SOURCE === 'mock'
}

let categories: Category[] = initialCategories.map((c) => ({ ...c }))
const clientMetadata = new Map<string, { color: CategoryColor; icon: CategoryIconName }>()

const colorPalette: CategoryColor[] = ['blue', 'indigo', 'emerald', 'amber', 'rose', 'purple', 'cyan']
const iconPalette: CategoryIconName[] = [
  'Tags',
  'Boxes',
  'Package',
  'ShoppingBag',
  'Laptop',
  'Shirt',
  'Utensils',
  'BookOpen',
  'Sparkles',
  'Headphones',
]

function getCategoryColor(slug: string, fallbackColor?: CategoryColor): CategoryColor {
  if (fallbackColor) return fallbackColor
  let hash = 0
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) >>> 0
  return colorPalette[hash % colorPalette.length]
}

function getCategoryIcon(slug: string, fallbackIcon?: CategoryIconName): CategoryIconName {
  if (fallbackIcon) return fallbackIcon
  let hash = 0
  for (let i = 0; i < slug.length; i++) hash = (hash * 17 + slug.charCodeAt(i)) >>> 0
  return iconPalette[hash % iconPalette.length]
}

function mapDtoToWithStats(dto: CategoryDTO): CategoryWithStats {
  const meta = clientMetadata.get(dto.id) || clientMetadata.get(dto.slug)
  const color = meta?.color || getCategoryColor(dto.slug)
  const icon = meta?.icon || getCategoryIcon(dto.slug)

  return {
    id: dto.id,
    name: dto.name,
    slug: dto.slug,
    description: dto.description || undefined,
    color,
    icon,
    status: dto.status,
    productCount: dto.productCount,
    activeProductCount: dto.activeProductCount,
    totalStockQuantity: dto.totalStockQuantity,
    version: dto.version,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}

function mapCachedCategoryToWithStats(cached: CachedCategoryRecord): CategoryWithStats {
  const meta = clientMetadata.get(cached.categoryId) || clientMetadata.get(cached.slug)
  const color = meta?.color || getCategoryColor(cached.slug)
  const icon = meta?.icon || getCategoryIcon(cached.slug)

  return {
    id: cached.categoryId,
    name: cached.name,
    slug: cached.slug,
    description: cached.description || undefined,
    color,
    icon,
    status: cached.status,
    productCount: cached.productCount,
    activeProductCount: cached.productCount,
    totalStockQuantity: 0,
    version: cached.version,
    createdAt: cached.cachedAt,
    updatedAt: cached.serverUpdatedAt || cached.cachedAt,
    isCached: true,
    isStale: true,
    cachedAt: cached.cachedAt,
    cachedSnapshotId: cached.snapshotId,
  }
}

function cloneCategory(category: Category): Category {
  return { ...category }
}

function findCategory(id: string): Category {
  const found = categories.find((c) => c.id === id)
  if (!found) throw new Error('Category not found.')
  return found
}

function validateCategoryUnique(draft: CategoryDraft, excludedId?: string) {
  const normName = draft.name.trim().toLowerCase()
  const duplicateName = categories.some(
    (c) => c.id !== excludedId && c.name.trim().toLowerCase() === normName
  )
  if (duplicateName) throw new Error('A category with this name already exists.')

  const slug = (draft.slug?.trim() || generateSlug(draft.name)).toLowerCase()
  const duplicateSlug = categories.some(
    (c) => c.id !== excludedId && c.slug.trim().toLowerCase() === slug
  )
  if (duplicateSlug) throw new Error('A category with this slug already exists.')
}

async function attachStats(category: Category): Promise<CategoryWithStats> {
  const products = await productService.getProducts()
  const matched = products.filter((p) => p.categoryId === category.id)
  const activeMatched = matched.filter((p) => p.status === 'active')
  const totalStock = matched.reduce(
    (sum, p) => (p.trackInventory ? sum + p.stockQuantity : sum),
    0
  )

  return {
    ...cloneCategory(category),
    productCount: matched.length,
    activeProductCount: activeMatched.length,
    totalStockQuantity: totalStock,
  }
}

export const categoryService: CategoryService = {
  async getCategories() {
    if (!isExplicitDemo()) {
      try {
        const response = await apiClient.get<CategoryDTO[]>('/categories')
        return (response || []).map(mapDtoToWithStats)
      } catch (err) {
        if (!isNetworkError(err)) {
          throw err
        }

        const ctx = getApiContext()
        if (ctx.userId && ctx.businessId) {
          const activeSnap = await offlineDb.getActiveSnapshotId(
            ctx.userId,
            ctx.businessId,
            ctx.branchId || 'default',
            'catalog'
          )
          if (activeSnap) {
            const cached = await offlineDb.queryCategories({
              userId: ctx.userId,
              businessId: ctx.businessId,
              snapshotId: activeSnap,
            })
            return cached.map(mapCachedCategoryToWithStats)
          }
        }

        throw err
      }
    }

    const products = await productService.getProducts()
    return categories.map((cat) => {
      const matched = products.filter((p) => p.categoryId === cat.id)
      const activeMatched = matched.filter((p) => p.status === 'active')
      const totalStock = matched.reduce(
        (sum, p) => (p.trackInventory ? sum + p.stockQuantity : sum),
        0
      )
      return {
        ...cloneCategory(cat),
        productCount: matched.length,
        activeProductCount: activeMatched.length,
        totalStockQuantity: totalStock,
      }
    })
  },

  async getCategoryById(categoryId: string) {
    if (!isExplicitDemo()) {
      try {
        const response = await apiClient.get<CategoryDTO>(`/categories/${categoryId}`)
        return response ? mapDtoToWithStats(response) : undefined
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          return undefined
        }
        if (!isNetworkError(err)) {
          throw err
        }

        const ctx = getApiContext()
        if (ctx.userId && ctx.businessId) {
          const activeSnap = await offlineDb.getActiveSnapshotId(
            ctx.userId,
            ctx.businessId,
            ctx.branchId || 'default',
            'catalog'
          )
          if (activeSnap) {
            const key = buildCategoryKey(ctx.userId, ctx.businessId, activeSnap, categoryId)
            const cached = await offlineDb.cachedCategories.get(key)
            if (cached) {
              return mapCachedCategoryToWithStats(cached)
            }
            return undefined
          }
        }

        throw err
      }
    }

    const found = categories.find((c) => c.id === categoryId)
    if (!found) return undefined
    return attachStats(found)
  },

  async createCategory(draft: CategoryDraft) {
    if (!isExplicitDemo() && typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Offline mode: Category creation requires an active server connection.')
    }
    const slug = draft.slug?.trim() ? generateSlug(draft.slug) : generateSlug(draft.name)
    if (!isExplicitDemo()) {
      const response = await apiClient.post<CategoryDTO>('/categories', {
        name: draft.name.trim(),
        slug,
        description: draft.description?.trim() || null,
      })
      clientMetadata.set(response.id, { color: draft.color, icon: draft.icon })
      clientMetadata.set(response.slug, { color: draft.color, icon: draft.icon })
      return mapDtoToWithStats(response)
    }

    validateCategoryUnique(draft)
    const now = new Date().toISOString()
    const id = slug || `cat-${Date.now()}`

    const newCategory: Category = {
      ...draft,
      id,
      name: draft.name.trim(),
      slug,
      description: draft.description?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    }

    categories = [newCategory, ...categories]
    clientMetadata.set(id, { color: draft.color, icon: draft.icon })
    return attachStats(newCategory)
  },

  async updateCategory(categoryId: string, draft: CategoryDraft) {
    if (!isExplicitDemo() && typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Offline mode: Category updates require an active server connection.')
    }
    const slug = draft.slug?.trim() ? generateSlug(draft.slug) : generateSlug(draft.name)
    if (!isExplicitDemo()) {
      const response = await apiClient.patch<CategoryDTO>(`/categories/${categoryId}`, {
        name: draft.name.trim(),
        slug,
        description: draft.description?.trim() || null,
        status: draft.status,
        expectedVersion: draft.version,
      })
      clientMetadata.set(response.id, { color: draft.color, icon: draft.icon })
      clientMetadata.set(response.slug, { color: draft.color, icon: draft.icon })
      return mapDtoToWithStats(response)
    }

    const existing = findCategory(categoryId)
    validateCategoryUnique(draft, categoryId)
    const now = new Date().toISOString()

    const updated: Category = {
      ...existing,
      ...draft,
      id: existing.id,
      name: draft.name.trim(),
      slug,
      description: draft.description?.trim() || undefined,
      createdAt: existing.createdAt,
      updatedAt: now,
    }

    categories = categories.map((c) => (c.id === categoryId ? updated : c))
    clientMetadata.set(categoryId, { color: draft.color, icon: draft.icon })
    return attachStats(updated)
  },

  async archiveCategory(categoryId: string) {
    if (!isExplicitDemo() && typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Offline mode: Archiving categories requires an active server connection.')
    }
    if (!isExplicitDemo()) {
      await apiClient.delete(`/categories/${categoryId}`)
      const updatedCat = await this.getCategoryById(categoryId)
      if (!updatedCat) {
        throw new Error('Category not found after archiving.')
      }
      return updatedCat
    }

    const existing = findCategory(categoryId)
    const updated: Category = {
      ...existing,
      status: 'archived',
      updatedAt: new Date().toISOString(),
    }
    categories = categories.map((c) => (c.id === categoryId ? updated : c))
    return attachStats(updated)
  },

  async restoreCategory(categoryId: string) {
    if (!isExplicitDemo() && typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Offline mode: Restoring categories requires an active server connection.')
    }
    if (!isExplicitDemo()) {
      const response = await apiClient.patch<CategoryDTO>(`/categories/${categoryId}`, {
        status: 'active',
      })
      return mapDtoToWithStats(response)
    }

    const existing = findCategory(categoryId)
    const updated: Category = {
      ...existing,
      status: 'active',
      updatedAt: new Date().toISOString(),
    }
    categories = categories.map((c) => (c.id === categoryId ? updated : c))
    return attachStats(updated)
  },

  exportCategoriesCsv(categoriesList: CategoryWithStats[]) {
    const headers = [
      'Category Name',
      'Slug',
      'Description',
      'Color',
      'Icon',
      'Status',
      'Total Products',
      'Active Products',
      'Total Stock Units',
      'Created At',
    ]

    const rows = categoriesList.map((cat) => [
      cat.name,
      cat.slug,
      cat.description ?? '',
      cat.color,
      cat.icon,
      cat.status,
      String(cat.productCount),
      String(cat.activeProductCount),
      String(cat.totalStockQuantity),
      cat.createdAt,
    ])

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(','))
      .join('\r\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'pos-categories.csv'
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
}
