import { productService } from '../../products/services/productService'
import { initialCategories } from '../data/categoryMockData'
import type {
  Category,
  CategoryDraft,
  CategoryWithStats,
} from '../types/category.types'
import { generateSlug } from '../utils/categoryUtils'

export interface CategoryService {
  getCategories(): Promise<CategoryWithStats[]>
  getCategoryById(categoryId: string): Promise<CategoryWithStats | undefined>
  createCategory(draft: CategoryDraft): Promise<CategoryWithStats>
  updateCategory(categoryId: string, draft: CategoryDraft): Promise<CategoryWithStats>
  archiveCategory(categoryId: string): Promise<CategoryWithStats>
  restoreCategory(categoryId: string): Promise<CategoryWithStats>
  exportCategoriesCsv(categories: CategoryWithStats[]): void
}

let categories: Category[] = initialCategories.map((c) => ({ ...c }))

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
    const found = categories.find((c) => c.id === categoryId)
    if (!found) return undefined
    return attachStats(found)
  },

  async createCategory(draft: CategoryDraft) {
    validateCategoryUnique(draft)
    const now = new Date().toISOString()
    const slug = draft.slug?.trim() ? generateSlug(draft.slug) : generateSlug(draft.name)
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
    return attachStats(newCategory)
  },

  async updateCategory(categoryId: string, draft: CategoryDraft) {
    const existing = findCategory(categoryId)
    validateCategoryUnique(draft, categoryId)
    const now = new Date().toISOString()
    const slug = draft.slug?.trim() ? generateSlug(draft.slug) : generateSlug(draft.name)

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
    return attachStats(updated)
  },

  async archiveCategory(categoryId: string) {
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

