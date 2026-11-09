import { HttpError } from '../../lib/errors'
import { ProductsRepository } from './products.repository'
import { CategoriesRepository } from '../categories/categories.repository'
import type {
  ProductDTO,
  ProductRow,
  CreateProductInput,
  UpdateProductInput,
  ReplaceProductInput,
  ProductFilterParams,
  ProductListResult,
} from './products.types'

export function mapProductToDTO(row: ProductRow): ProductDTO {
  return {
    id: row.id,
    businessId: row.business_id,
    sku: row.sku,
    barcode: row.barcode,
    name: row.name,
    description: row.description,
    categoryId: row.category_id,
    categoryName: row.category_name ?? null,
    unit: row.unit,
    purchasePriceMinor: row.purchase_price_minor,
    sellingPriceMinor: row.selling_price_minor,
    stockQuantity: Number(row.stock_quantity || 0),
    lowStockThreshold: Number(row.low_stock_threshold || 0),
    trackInventory: Boolean(row.track_inventory),
    status: row.status,
    imageUrl: row.image_url,
    version: Number(row.version || 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class ProductsService {
  private readonly repo: ProductsRepository
  private readonly categoriesRepo: CategoriesRepository

  constructor(db: D1Database) {
    this.repo = new ProductsRepository(db)
    this.categoriesRepo = new CategoriesRepository(db)
  }

  async listProducts(
    businessId: string,
    filters: ProductFilterParams,
    authorizedBranchIds: string[] = []
  ): Promise<ProductListResult> {
    const totalCount = await this.repo.countProducts(businessId, filters, authorizedBranchIds)
    const rows = await this.repo.listProducts(businessId, filters, authorizedBranchIds)
    const totalPages = Math.max(1, Math.ceil(totalCount / filters.limit))
    const hasNextPage = filters.page < totalPages

    return {
      items: rows.map(mapProductToDTO),
      meta: {
        page: filters.page,
        limit: filters.limit,
        totalCount,
        totalPages,
        hasNextPage,
      },
    }
  }

  async getProductById(
    businessId: string,
    productId: string,
    authorizedBranchIds: string[] = []
  ): Promise<ProductDTO> {
    const row = await this.repo.getProductById(businessId, productId, authorizedBranchIds)
    if (!row) {
      throw HttpError.notFound('Product not found.')
    }
    return mapProductToDTO(row)
  }

  async createProduct(
    businessId: string,
    input: CreateProductInput,
    authorizedBranchIds: string[] = []
  ): Promise<ProductDTO> {
    // Check SKU uniqueness within business
    const existingSku = await this.repo.findProductBySku(businessId, input.sku)
    if (existingSku) {
      throw HttpError.conflict('A product with this SKU already exists.')
    }

    // Check Barcode uniqueness within business if provided
    if (input.barcode) {
      const existingBarcode = await this.repo.findProductByBarcode(businessId, input.barcode)
      if (existingBarcode) {
        throw HttpError.conflict('A product with this barcode already exists.')
      }
    }

    // Validate category existence and tenant ownership if categoryId is provided
    if (input.categoryId) {
      const category = await this.categoriesRepo.getCategoryById(businessId, input.categoryId)
      if (!category) {
        throw HttpError.badRequest('Category does not exist or belongs to another business.', {
          field: 'categoryId',
        })
      }
    }

    const id = `prod_${crypto.randomUUID()}`
    await this.repo.createProduct(id, businessId, input)

    const created = await this.repo.getProductById(businessId, id, authorizedBranchIds)
    if (!created) {
      throw HttpError.internal('Failed to retrieve created product.')
    }

    return mapProductToDTO(created)
  }

  async updateProduct(
    businessId: string,
    productId: string,
    input: UpdateProductInput,
    authorizedBranchIds: string[] = []
  ): Promise<ProductDTO> {
    const existing = await this.repo.getProductById(businessId, productId, authorizedBranchIds)
    if (!existing) {
      throw HttpError.notFound('Product not found.')
    }

    // Check SKU uniqueness if changed
    if (input.sku && input.sku.toLowerCase() !== existing.sku.toLowerCase()) {
      const duplicateSku = await this.repo.findProductBySku(businessId, input.sku)
      if (duplicateSku && duplicateSku.id !== productId) {
        throw HttpError.conflict('A product with this SKU already exists.')
      }
    }

    // Check Barcode uniqueness if changed
    if (input.barcode && input.barcode.toLowerCase() !== (existing.barcode || '').toLowerCase()) {
      const duplicateBarcode = await this.repo.findProductByBarcode(businessId, input.barcode)
      if (duplicateBarcode && duplicateBarcode.id !== productId) {
        throw HttpError.conflict('A product with this barcode already exists.')
      }
    }

    // Validate category ownership if categoryId is updated
    if (input.categoryId !== undefined && input.categoryId !== existing.category_id) {
      if (input.categoryId !== null) {
        const category = await this.categoriesRepo.getCategoryById(businessId, input.categoryId)
        if (!category) {
          throw HttpError.badRequest('Category does not exist or belongs to another business.', {
            field: 'categoryId',
          })
        }
      }
    }

    if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
      throw HttpError.conflict(
        `Product was modified by another device. Expected version ${input.expectedVersion}, current server version is ${existing.version}.`,
        { resourceId: productId, expectedVersion: input.expectedVersion, serverVersion: existing.version }
      )
    }

    try {
      await this.repo.updateProduct(businessId, productId, input, existing)
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('VERSION_CONFLICT')) {
        throw HttpError.conflict(err.message, { resourceId: productId })
      }
      throw err
    }

    const updated = await this.repo.getProductById(businessId, productId, authorizedBranchIds)
    if (!updated) {
      throw HttpError.internal('Failed to retrieve updated product.')
    }

    return mapProductToDTO(updated)
  }

  async replaceProduct(
    businessId: string,
    productId: string,
    input: ReplaceProductInput,
    authorizedBranchIds: string[] = []
  ): Promise<ProductDTO> {
    const existing = await this.repo.getProductById(businessId, productId, authorizedBranchIds)
    if (!existing) {
      throw HttpError.notFound('Product not found.')
    }

    // Check SKU uniqueness if changed
    if (input.sku.toLowerCase() !== existing.sku.toLowerCase()) {
      const duplicateSku = await this.repo.findProductBySku(businessId, input.sku)
      if (duplicateSku && duplicateSku.id !== productId) {
        throw HttpError.conflict('A product with this SKU already exists.')
      }
    }

    // Check Barcode uniqueness if provided and changed
    if (input.barcode && input.barcode.toLowerCase() !== (existing.barcode || '').toLowerCase()) {
      const duplicateBarcode = await this.repo.findProductByBarcode(businessId, input.barcode)
      if (duplicateBarcode && duplicateBarcode.id !== productId) {
        throw HttpError.conflict('A product with this barcode already exists.')
      }
    }

    // Validate category ownership if categoryId is provided
    if (input.categoryId) {
      const category = await this.categoriesRepo.getCategoryById(businessId, input.categoryId)
      if (!category) {
        throw HttpError.badRequest('Category does not exist or belongs to another business.', {
          field: 'categoryId',
        })
      }
    }

    if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
      throw HttpError.conflict(
        `Product was modified by another device. Expected version ${input.expectedVersion}, current server version is ${existing.version}.`,
        { resourceId: productId, expectedVersion: input.expectedVersion, serverVersion: existing.version }
      )
    }

    try {
      await this.repo.replaceProduct(businessId, productId, input, existing)
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('VERSION_CONFLICT')) {
        throw HttpError.conflict(err.message, { resourceId: productId })
      }
      throw err
    }

    const updated = await this.repo.getProductById(businessId, productId, authorizedBranchIds)
    if (!updated) {
      throw HttpError.internal('Failed to retrieve replaced product.')
    }

    return mapProductToDTO(updated)
  }

  async archiveProduct(
    businessId: string,
    productId: string
  ): Promise<{ id: string; status: 'archived' }> {
    const existing = await this.repo.getProductById(businessId, productId)
    if (!existing) {
      throw HttpError.notFound('Product not found.')
    }

    await this.repo.archiveProduct(businessId, productId, existing)
    return { id: productId, status: 'archived' }
  }
}

