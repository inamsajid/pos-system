import type {
  CategoryRow,
  CategoryWithStatsRow,
  CategoryFilterParams,
  CreateCategoryInput,
  UpdateCategoryInput,
  ReplaceCategoryInput,
} from './categories.types'
import { ChangeLogRepository } from '../sync/changeLog.repository'

function buildCategoryStockSubquery(authorizedBranchIds: string[], params: unknown[]): string {
  if (authorizedBranchIds.length === 0) {
    return '0'
  }
  if (authorizedBranchIds.length === 1) {
    params.push(authorizedBranchIds[0])
    return `COALESCE((
      SELECT SUM(ib.quantity_on_hand)
      FROM inventory_balances ib
      JOIN products p ON p.id = ib.product_id
      WHERE p.category_id = c.id AND p.business_id = c.business_id AND p.track_inventory = 1 AND ib.branch_id = ?
    ), 0)`
  }
  const placeholders = authorizedBranchIds.map(() => '?').join(', ')
  params.push(...authorizedBranchIds)
  return `COALESCE((
    SELECT SUM(ib.quantity_on_hand)
    FROM inventory_balances ib
    JOIN products p ON p.id = ib.product_id
    WHERE p.category_id = c.id AND p.business_id = c.business_id AND p.track_inventory = 1 AND ib.branch_id IN (${placeholders})
  ), 0)`
}

export class CategoriesRepository {
  private readonly db: D1Database
  private readonly changeLogRepo: ChangeLogRepository

  constructor(db: D1Database) {
    this.db = db
    this.changeLogRepo = new ChangeLogRepository(db)
  }

  async listCategories(
    businessId: string,
    filters: CategoryFilterParams = {},
    authorizedBranchIds: string[] = []
  ): Promise<CategoryWithStatsRow[]> {
    const stockParams: unknown[] = []
    const stockSubquery = buildCategoryStockSubquery(authorizedBranchIds, stockParams)

    let sql = `
      SELECT 
        c.id,
        c.business_id,
        c.name,
        c.slug,
        c.description,
        c.parent_id,
        c.display_order,
        c.status,
        c.version,
        c.created_at,
        c.updated_at,
        COALESCE((
          SELECT COUNT(*) 
          FROM products p 
          WHERE p.category_id = c.id AND p.business_id = c.business_id
        ), 0) AS product_count,
        COALESCE((
          SELECT COUNT(*) 
          FROM products p 
          WHERE p.category_id = c.id AND p.business_id = c.business_id AND p.status = 'active'
        ), 0) AS active_product_count,
        ${stockSubquery} AS total_stock_quantity
      FROM categories c
      WHERE c.business_id = ?
    `
    const params: unknown[] = [...stockParams, businessId]

    if (filters.status && filters.status !== 'all') {
      sql += ` AND c.status = ?`
      params.push(filters.status)
    }

    if (filters.parentId !== undefined) {
      if (filters.parentId === null) {
        sql += ` AND c.parent_id IS NULL`
      } else {
        sql += ` AND c.parent_id = ?`
        params.push(filters.parentId)
      }
    }

    sql += ` ORDER BY c.display_order ASC, c.name ASC`

    const stmt = this.db.prepare(sql).bind(...params)
    const result = await stmt.all<CategoryWithStatsRow>()
    return result.results || []
  }

  async getCategoryById(
    businessId: string,
    categoryId: string,
    authorizedBranchIds: string[] = []
  ): Promise<CategoryWithStatsRow | null> {
    const stockParams: unknown[] = []
    const stockSubquery = buildCategoryStockSubquery(authorizedBranchIds, stockParams)

    const sql = `
      SELECT 
        c.id,
        c.business_id,
        c.name,
        c.slug,
        c.description,
        c.parent_id,
        c.display_order,
        c.status,
        c.version,
        c.created_at,
        c.updated_at,
        COALESCE((
          SELECT COUNT(*) 
          FROM products p 
          WHERE p.category_id = c.id AND p.business_id = c.business_id
        ), 0) AS product_count,
        COALESCE((
          SELECT COUNT(*) 
          FROM products p 
          WHERE p.category_id = c.id AND p.business_id = c.business_id AND p.status = 'active'
        ), 0) AS active_product_count,
        ${stockSubquery} AS total_stock_quantity
      FROM categories c
      WHERE c.business_id = ? AND c.id = ?
      LIMIT 1
    `
    const params = [...stockParams, businessId, categoryId]
    return this.db.prepare(sql).bind(...params).first<CategoryWithStatsRow>()
  }

  async findCategoryByName(businessId: string, name: string): Promise<CategoryRow | null> {
    const sql = `
      SELECT id, business_id, name, slug, description, parent_id, display_order, status, version, created_at, updated_at
      FROM categories
      WHERE business_id = ? AND LOWER(name) = LOWER(?)
      LIMIT 1
    `
    return this.db.prepare(sql).bind(businessId, name.trim()).first<CategoryRow>()
  }

  async findCategoryBySlug(businessId: string, slug: string): Promise<CategoryRow | null> {
    const sql = `
      SELECT id, business_id, name, slug, description, parent_id, display_order, status, version, created_at, updated_at
      FROM categories
      WHERE business_id = ? AND LOWER(slug) = LOWER(?)
      LIMIT 1
    `
    return this.db.prepare(sql).bind(businessId, slug.trim()).first<CategoryRow>()
  }

  async createCategory(
    id: string,
    businessId: string,
    input: CreateCategoryInput
  ): Promise<void> {
    const slug = input.slug || input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const sql = `
      INSERT INTO categories (
        id, business_id, name, slug, description, parent_id, display_order, status, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, datetime('now'), datetime('now'))
    `
    const insertStmt = this.db
      .prepare(sql)
      .bind(
        id,
        businessId,
        input.name,
        slug,
        input.description ?? null,
        input.parentId ?? null,
        input.displayOrder ?? 0
      )

    const changeStmt = this.changeLogRepo.createChangeEventStatement({
      businessId,
      resourceType: 'category',
      resourceId: id,
      resourceVersion: 1,
      operation: 'upsert',
      payload: {
        id,
        businessId,
        name: input.name,
        slug,
        description: input.description ?? null,
        parentId: input.parentId ?? null,
        displayOrder: input.displayOrder ?? 0,
        status: 'active',
        version: 1,
        updatedAt: new Date().toISOString(),
      },
      eventId: `${businessId}:category:${id}:1`,
    })

    await this.db.batch([insertStmt, changeStmt])
  }

  async updateCategory(
    businessId: string,
    categoryId: string,
    input: UpdateCategoryInput,
    currentCategory: CategoryWithStatsRow
  ): Promise<void> {
    const newVersion = (currentCategory.version || 1) + 1
    const setClauses: string[] = ["updated_at = datetime('now')", "version = version + 1"]
    const params: unknown[] = []

    if (input.name !== undefined) {
      setClauses.push('name = ?')
      params.push(input.name)
    }

    if (input.slug !== undefined) {
      setClauses.push('slug = ?')
      params.push(input.slug)
    }

    if (input.description !== undefined) {
      setClauses.push('description = ?')
      params.push(input.description)
    }

    if (input.parentId !== undefined) {
      setClauses.push('parent_id = ?')
      params.push(input.parentId)
    }

    if (input.displayOrder !== undefined) {
      setClauses.push('display_order = ?')
      params.push(input.displayOrder)
    }

    if (input.status !== undefined) {
      setClauses.push('status = ?')
      params.push(input.status)
    }

    let sql = `
      UPDATE categories
      SET ${setClauses.join(', ')}
      WHERE business_id = ? AND id = ?
    `
    params.push(businessId, categoryId)

    if (input.expectedVersion !== undefined) {
      sql += ' AND version = ?'
      params.push(input.expectedVersion)
    }

    const updateStmt = this.db.prepare(sql).bind(...params)

    const changeStmt = this.changeLogRepo.createChangeEventStatement({
      businessId,
      resourceType: 'category',
      resourceId: categoryId,
      resourceVersion: newVersion,
      operation: 'upsert',
      payload: {
        id: categoryId,
        businessId,
        name: input.name !== undefined ? input.name : currentCategory.name,
        slug: input.slug !== undefined ? input.slug : currentCategory.slug,
        description: input.description !== undefined ? input.description : currentCategory.description,
        parentId: input.parentId !== undefined ? input.parentId : currentCategory.parent_id,
        displayOrder: input.displayOrder !== undefined ? input.displayOrder : currentCategory.display_order,
        status: input.status !== undefined ? input.status : currentCategory.status,
        version: newVersion,
        updatedAt: new Date().toISOString(),
      },
      eventId: `${businessId}:category:${categoryId}:${newVersion}`,
    })

    const results = await this.db.batch([updateStmt, changeStmt])
    const updateRes = results[0] as { meta?: { changes?: number } }
    if (input.expectedVersion !== undefined && updateRes.meta?.changes === 0) {
      throw new Error(`VERSION_CONFLICT: Category was modified by another device.`)
    }
  }

  async replaceCategory(
    businessId: string,
    categoryId: string,
    input: ReplaceCategoryInput,
    currentCategory: CategoryWithStatsRow
  ): Promise<void> {
    const newVersion = (currentCategory.version || 1) + 1
    const slug = input.slug || input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')

    let sql = `
      UPDATE categories
      SET name = ?,
          slug = ?,
          description = ?,
          parent_id = ?,
          display_order = ?,
          status = ?,
          version = version + 1,
          updated_at = datetime('now')
      WHERE business_id = ? AND id = ?
    `
    const params: unknown[] = [
      input.name,
      slug,
      input.description ?? null,
      input.parentId ?? null,
      input.displayOrder ?? 0,
      input.status ?? 'active',
      businessId,
      categoryId,
    ]

    if (input.expectedVersion !== undefined) {
      sql += ' AND version = ?'
      params.push(input.expectedVersion)
    }

    const replaceStmt = this.db.prepare(sql).bind(...params)

    const changeStmt = this.changeLogRepo.createChangeEventStatement({
      businessId,
      resourceType: 'category',
      resourceId: categoryId,
      resourceVersion: newVersion,
      operation: 'upsert',
      payload: {
        id: categoryId,
        businessId,
        name: input.name,
        slug,
        description: input.description ?? null,
        parentId: input.parentId ?? null,
        displayOrder: input.displayOrder ?? 0,
        status: input.status ?? 'active',
        version: newVersion,
        updatedAt: new Date().toISOString(),
      },
      eventId: `${businessId}:category:${categoryId}:${newVersion}`,
    })

    const results = await this.db.batch([replaceStmt, changeStmt])
    const replaceRes = results[0] as { meta?: { changes?: number } }
    if (input.expectedVersion !== undefined && replaceRes.meta?.changes === 0) {
      throw new Error(`VERSION_CONFLICT: Category was modified by another device.`)
    }
  }

  async archiveCategory(
    businessId: string,
    categoryId: string,
    currentCategory: CategoryWithStatsRow
  ): Promise<void> {
    const newVersion = (currentCategory.version || 1) + 1
    const sql = `
      UPDATE categories
      SET status = 'archived', version = version + 1, updated_at = datetime('now')
      WHERE business_id = ? AND id = ?
    `
    const archiveStmt = this.db.prepare(sql).bind(businessId, categoryId)

    const changeStmt = this.changeLogRepo.createChangeEventStatement({
      businessId,
      resourceType: 'category',
      resourceId: categoryId,
      resourceVersion: newVersion,
      operation: 'archive',
      payload: {
        id: categoryId,
        businessId,
        name: currentCategory.name,
        slug: currentCategory.slug,
        status: 'archived',
        version: newVersion,
        updatedAt: new Date().toISOString(),
      },
      eventId: `${businessId}:category:${categoryId}:${newVersion}`,
    })

    await this.db.batch([archiveStmt, changeStmt])
  }

  /**
   * Checks whether setting candidateParentId as parent of categoryId would create a cycle.
   * Walks up the ancestor tree starting from candidateParentId.
   */
  async wouldCreateCycle(
    businessId: string,
    categoryId: string,
    candidateParentId: string
  ): Promise<boolean> {
    if (categoryId === candidateParentId) {
      return true
    }

    let currentParentId: string | null = candidateParentId
    let depth = 0
    const maxDepth = 25

    while (currentParentId && depth < maxDepth) {
      if (currentParentId === categoryId) {
        return true
      }

      const parent: { parent_id: string | null } | null = await this.db
        .prepare('SELECT parent_id FROM categories WHERE business_id = ? AND id = ?')
        .bind(businessId, currentParentId)
        .first()

      if (!parent) {
        break
      }

      currentParentId = parent.parent_id
      depth++
    }

    return false
  }

  async countActiveChildCategories(businessId: string, parentId: string): Promise<number> {
    const res = await this.db
      .prepare("SELECT COUNT(*) as count FROM categories WHERE business_id = ? AND parent_id = ? AND status = 'active'")
      .bind(businessId, parentId)
      .first<{ count: number }>()

    return res?.count ?? 0
  }
}
