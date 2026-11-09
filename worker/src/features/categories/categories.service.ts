import { HttpError } from '../../lib/errors'
import { CategoriesRepository } from './categories.repository'
import type {
  CategoryDTO,
  CategoryWithStatsRow,
  CategoryFilterParams,
  CreateCategoryInput,
  UpdateCategoryInput,
  ReplaceCategoryInput,
} from './categories.types'

export function mapCategoryToDTO(row: CategoryWithStatsRow): CategoryDTO {
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    parentId: row.parent_id,
    displayOrder: row.display_order,
    status: row.status,
    productCount: Number(row.product_count || 0),
    activeProductCount: Number(row.active_product_count || 0),
    totalStockQuantity: Number(row.total_stock_quantity || 0),
    version: Number(row.version || 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class CategoriesService {
  private readonly repo: CategoriesRepository

  constructor(db: D1Database) {
    this.repo = new CategoriesRepository(db)
  }

  async listCategories(
    businessId: string,
    filters: CategoryFilterParams = {},
    authorizedBranchIds: string[] = []
  ): Promise<CategoryDTO[]> {
    const rows = await this.repo.listCategories(businessId, filters, authorizedBranchIds)
    return rows.map(mapCategoryToDTO)
  }

  async getCategoryById(
    businessId: string,
    categoryId: string,
    authorizedBranchIds: string[] = []
  ): Promise<CategoryDTO> {
    const row = await this.repo.getCategoryById(businessId, categoryId, authorizedBranchIds)
    if (!row) {
      throw HttpError.notFound('Category not found.')
    }
    return mapCategoryToDTO(row)
  }

  async createCategory(businessId: string, input: CreateCategoryInput): Promise<CategoryDTO> {
    // Check name uniqueness within tenant
    const existingName = await this.repo.findCategoryByName(businessId, input.name)
    if (existingName) {
      throw HttpError.conflict('A category with this name already exists.')
    }

    // Check slug uniqueness within tenant
    const slug = input.slug || input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const existingSlug = await this.repo.findCategoryBySlug(businessId, slug)
    if (existingSlug) {
      throw HttpError.conflict('A category with this slug already exists.')
    }

    // If parentId is specified, ensure it exists and belongs to the same business
    if (input.parentId) {
      const parent = await this.repo.getCategoryById(businessId, input.parentId)
      if (!parent) {
        throw HttpError.badRequest('Parent category does not exist or belongs to another business.', {
          field: 'parentId',
        })
      }
    }

    const id = `cat_${crypto.randomUUID()}`
    await this.repo.createCategory(id, businessId, {
      ...input,
      slug,
    })

    const created = await this.repo.getCategoryById(businessId, id)
    if (!created) {
      throw HttpError.internal('Failed to retrieve created category.')
    }

    return mapCategoryToDTO(created)
  }

  async updateCategory(
    businessId: string,
    categoryId: string,
    input: UpdateCategoryInput
  ): Promise<CategoryDTO> {
    const existing = await this.repo.getCategoryById(businessId, categoryId)
    if (!existing) {
      throw HttpError.notFound('Category not found.')
    }

    // Name uniqueness check if changed
    if (input.name && input.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      const duplicate = await this.repo.findCategoryByName(businessId, input.name)
      if (duplicate && duplicate.id !== categoryId) {
        throw HttpError.conflict('A category with this name already exists.')
      }
    }

    // Slug uniqueness check if changed
    if (input.slug && input.slug.trim().toLowerCase() !== existing.slug.toLowerCase()) {
      const duplicate = await this.repo.findCategoryBySlug(businessId, input.slug)
      if (duplicate && duplicate.id !== categoryId) {
        throw HttpError.conflict('A category with this slug already exists.')
      }
    }

    // Hierarchy cycle check if parentId changed
    if (input.parentId !== undefined && input.parentId !== existing.parent_id) {
      if (input.parentId !== null) {
        if (input.parentId === categoryId) {
          throw HttpError.badRequest('A category cannot be its own parent.', { field: 'parentId' })
        }

        const parent = await this.repo.getCategoryById(businessId, input.parentId)
        if (!parent) {
          throw HttpError.badRequest('Parent category does not exist or belongs to another business.', {
            field: 'parentId',
          })
        }

        const createsCycle = await this.repo.wouldCreateCycle(businessId, categoryId, input.parentId)
        if (createsCycle) {
          throw HttpError.badRequest('Circular category hierarchy detected: A category cannot be its own ancestor.', {
            field: 'parentId',
          })
        }
      }
    }

    if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
      throw HttpError.conflict(
        `Category was modified by another device. Expected version ${input.expectedVersion}, current server version is ${existing.version}.`,
        { resourceId: categoryId, expectedVersion: input.expectedVersion, serverVersion: existing.version }
      )
    }

    await this.repo.updateCategory(businessId, categoryId, input, existing)

    const updated = await this.repo.getCategoryById(businessId, categoryId)
    if (!updated) {
      throw HttpError.internal('Failed to retrieve updated category.')
    }

    return mapCategoryToDTO(updated)
  }

  async replaceCategory(
    businessId: string,
    categoryId: string,
    input: ReplaceCategoryInput
  ): Promise<CategoryDTO> {
    const existing = await this.repo.getCategoryById(businessId, categoryId)
    if (!existing) {
      throw HttpError.notFound('Category not found.')
    }

    // Check name uniqueness if different from current
    if (input.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      const duplicate = await this.repo.findCategoryByName(businessId, input.name)
      if (duplicate && duplicate.id !== categoryId) {
        throw HttpError.conflict('A category with this name already exists.')
      }
    }

    // Check slug uniqueness
    const slug = input.slug || input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    if (slug.toLowerCase() !== existing.slug.toLowerCase()) {
      const duplicate = await this.repo.findCategoryBySlug(businessId, slug)
      if (duplicate && duplicate.id !== categoryId) {
        throw HttpError.conflict('A category with this slug already exists.')
      }
    }

    // Cycle check if parentId is specified
    if (input.parentId) {
      if (input.parentId === categoryId) {
        throw HttpError.badRequest('A category cannot be its own parent.', { field: 'parentId' })
      }
      const parent = await this.repo.getCategoryById(businessId, input.parentId)
      if (!parent) {
        throw HttpError.badRequest('Parent category does not exist or belongs to another business.', {
          field: 'parentId',
        })
      }
      const createsCycle = await this.repo.wouldCreateCycle(businessId, categoryId, input.parentId)
      if (createsCycle) {
        throw HttpError.badRequest('Circular category hierarchy detected: A category cannot be its own ancestor.', {
          field: 'parentId',
        })
      }
    }

    if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
      throw HttpError.conflict(
        `Category was modified by another device. Expected version ${input.expectedVersion}, current server version is ${existing.version}.`,
        { resourceId: categoryId, expectedVersion: input.expectedVersion, serverVersion: existing.version }
      )
    }

    await this.repo.replaceCategory(businessId, categoryId, {
      ...input,
      slug,
    }, existing)

    const replaced = await this.repo.getCategoryById(businessId, categoryId)
    if (!replaced) {
      throw HttpError.internal('Failed to retrieve replaced category.')
    }

    return mapCategoryToDTO(replaced)
  }

  async archiveCategory(
    businessId: string,
    categoryId: string
  ): Promise<{ id: string; status: 'archived' }> {
    const existing = await this.repo.getCategoryById(businessId, categoryId)
    if (!existing) {
      throw HttpError.notFound('Category not found.')
    }

    await this.repo.archiveCategory(businessId, categoryId, existing)
    return { id: categoryId, status: 'archived' }
  }
}

