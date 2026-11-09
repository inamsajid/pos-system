import { HttpError } from '../../lib/errors'
import { SuppliersRepository } from './suppliers.repository'
import type {
  SupplierDTO,
  SupplierFilterParams,
  SupplierListResult,
  CreateSupplierInput,
  UpdateSupplierInput,
  SupplierProductDTO,
  AddSupplierProductInput,
} from './suppliers.types'

export class SuppliersService {
  private readonly repo: SuppliersRepository
  private readonly db: D1Database

  constructor(db: D1Database) {
    this.db = db
    this.repo = new SuppliersRepository(db)
  }

  async listSuppliers(
    businessId: string,
    filters: SupplierFilterParams
  ): Promise<SupplierListResult> {
    const totalCount = await this.repo.countSuppliers(businessId, filters)
    const items = await this.repo.listSuppliers(businessId, filters)
    const totalPages = Math.max(1, Math.ceil(totalCount / filters.limit))

    return {
      items,
      meta: {
        page: filters.page,
        limit: filters.limit,
        totalCount,
        totalPages,
        hasNextPage: filters.page < totalPages,
      },
    }
  }

  async getSupplierById(businessId: string, supplierId: string): Promise<SupplierDTO> {
    const supplier = await this.repo.getSupplierById(businessId, supplierId)
    if (!supplier) {
      throw HttpError.notFound(`Supplier with id '${supplierId}' not found.`)
    }
    return supplier
  }

  async createSupplier(businessId: string, input: CreateSupplierInput): Promise<SupplierDTO> {
    const duplicate = await this.db
      .prepare('SELECT id FROM suppliers WHERE business_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1')
      .bind(businessId, input.name)
      .first()

    if (duplicate) {
      throw HttpError.conflict('A supplier with this name already exists in this business.', { field: 'name' })
    }

    if (input.phone) {
      const cleanPhone = input.phone.replace(/\D/g, '')
      if (cleanPhone.length >= 7) {
        const existingPhone = await this.db
          .prepare("SELECT id FROM suppliers WHERE business_id = ? AND REPLACE(REPLACE(REPLACE(phone, '-', ''), ' ', ''), '+', '') = ? LIMIT 1")
          .bind(businessId, cleanPhone)
          .first()
        if (existingPhone) {
          throw HttpError.conflict('This phone number is already registered to another supplier.', { field: 'phone' })
        }
      }
    }

    const id = `sup_${crypto.randomUUID()}`
    const code = input.supplierCode || (await this.repo.generateNextSupplierCode(businessId))

    return this.repo.createSupplier(businessId, input, id, code)
  }

  async updateSupplier(businessId: string, id: string, input: UpdateSupplierInput): Promise<SupplierDTO> {
    const existing = await this.repo.getSupplierById(businessId, id)
    if (!existing) {
      throw HttpError.notFound(`Supplier with id '${id}' not found.`)
    }

    if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
      const duplicate = await this.db
        .prepare('SELECT id FROM suppliers WHERE business_id = ? AND id != ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1')
        .bind(businessId, id, input.name)
        .first()
      if (duplicate) {
        throw HttpError.conflict('A supplier with this name already exists.', { field: 'name' })
      }
    }

    const updated = await this.repo.updateSupplier(businessId, id, input)
    if (!updated) {
      throw HttpError.internal('Failed to update supplier.')
    }
    return updated
  }

  async updateSupplierStatus(businessId: string, id: string, status: 'active' | 'inactive' | 'archived'): Promise<SupplierDTO> {
    const existing = await this.repo.getSupplierById(businessId, id)
    if (!existing) {
      throw HttpError.notFound(`Supplier with id '${id}' not found.`)
    }

    const updated = await this.repo.updateStatus(businessId, id, status)
    if (!updated) {
      throw HttpError.internal('Failed to update supplier status.')
    }
    return updated
  }

  async archiveSupplier(businessId: string, id: string): Promise<SupplierDTO> {
    return this.updateSupplierStatus(businessId, id, 'archived')
  }

  async listSupplierProducts(businessId: string, supplierId: string): Promise<SupplierProductDTO[]> {
    await this.getSupplierById(businessId, supplierId)
    return this.repo.listSupplierProducts(businessId, supplierId)
  }

  async addSupplierProduct(
    businessId: string,
    supplierId: string,
    input: AddSupplierProductInput
  ): Promise<SupplierProductDTO> {
    await this.getSupplierById(businessId, supplierId)

    // Verify product exists in this business
    const product = await this.db
      .prepare('SELECT id FROM products WHERE business_id = ? AND id = ? LIMIT 1')
      .bind(businessId, input.productId)
      .first()

    if (!product) {
      throw HttpError.notFound(`Product '${input.productId}' does not exist in this business.`)
    }

    return this.repo.addOrUpdateSupplierProduct(businessId, supplierId, input)
  }
}
