import { HttpError } from '../../lib/errors'
import { CustomersRepository } from './customers.repository'
import type {
  CustomerDTO,
  CreateCustomerInput,
  UpdateCustomerInput,
  CustomerFilterParams,
  CustomerStatus,
} from './customers.types'

export class CustomersService {
  private readonly repo: CustomersRepository
  private readonly db: D1Database

  constructor(db: D1Database) {
    this.db = db
    this.repo = new CustomersRepository(db)
  }

  async listCustomers(
    businessId: string,
    filters: CustomerFilterParams
  ): Promise<{ items: CustomerDTO[]; meta: { total: number; page: number; limit: number; totalPages: number } }> {
    const total = await this.repo.countCustomers(businessId, filters)
    const items = await this.repo.listCustomers(businessId, filters)
    const totalPages = Math.max(1, Math.ceil(total / filters.limit))

    return {
      items,
      meta: {
        total,
        page: filters.page,
        limit: filters.limit,
        totalPages,
      },
    }
  }

  async getCustomerById(businessId: string, id: string): Promise<CustomerDTO> {
    const customer = await this.repo.getCustomerById(businessId, id)
    if (!customer) {
      throw HttpError.notFound('Customer not found.')
    }
    return customer
  }

  async createCustomer(businessId: string, input: CreateCustomerInput): Promise<CustomerDTO> {
    // Check duplicate name within business
    const existingName = await this.db
      .prepare('SELECT id FROM customers WHERE business_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1')
      .bind(businessId, input.name)
      .first()

    if (existingName) {
      throw HttpError.conflict('A customer with this name already exists in this business.', { field: 'name' })
    }

    if (input.phone) {
      const cleanPhone = input.phone.replace(/\D/g, '')
      if (cleanPhone.length >= 7) {
        const existingPhone = await this.db
          .prepare("SELECT id FROM customers WHERE business_id = ? AND REPLACE(REPLACE(REPLACE(phone, '-', ''), ' ', ''), '+', '') = ? LIMIT 1")
          .bind(businessId, cleanPhone)
          .first()
        if (existingPhone) {
          throw HttpError.conflict('This phone number is already registered to another customer.', { field: 'phone' })
        }
      }
    }

    if (input.email) {
      const existingEmail = await this.db
        .prepare('SELECT id FROM customers WHERE business_id = ? AND LOWER(email) = LOWER(?) LIMIT 1')
        .bind(businessId, input.email)
        .first()
      if (existingEmail) {
        throw HttpError.conflict('This email is already registered to another customer.', { field: 'email' })
      }
    }

    const id = `cus_${crypto.randomUUID()}`
    const code = input.customerCode || (await this.repo.generateNextCustomerCode(businessId))

    return this.repo.createCustomer(businessId, input, id, code)
  }

  async updateCustomer(businessId: string, id: string, input: UpdateCustomerInput): Promise<CustomerDTO> {
    const existing = await this.repo.getCustomerById(businessId, id)
    if (!existing) {
      throw HttpError.notFound('Customer not found.')
    }

    if (existing.isWalkIn) {
      throw HttpError.badRequest('Walk-in Customer details are system protected and cannot be modified.')
    }

    if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
      const duplicateName = await this.db
        .prepare('SELECT id FROM customers WHERE business_id = ? AND id != ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1')
        .bind(businessId, id, input.name)
        .first()
      if (duplicateName) {
        throw HttpError.conflict('A customer with this name already exists.', { field: 'name' })
      }
    }

    if (input.phone) {
      const cleanPhone = input.phone.replace(/\D/g, '')
      if (cleanPhone.length >= 7) {
        const existingPhone = await this.db
          .prepare("SELECT id FROM customers WHERE business_id = ? AND id != ? AND REPLACE(REPLACE(REPLACE(phone, '-', ''), ' ', ''), '+', '') = ? LIMIT 1")
          .bind(businessId, id, cleanPhone)
          .first()
        if (existingPhone) {
          throw HttpError.conflict('This phone number is already in use by another customer.', { field: 'phone' })
        }
      }
    }

    if (input.email) {
      const existingEmail = await this.db
        .prepare('SELECT id FROM customers WHERE business_id = ? AND id != ? AND LOWER(email) = LOWER(?) LIMIT 1')
        .bind(businessId, id, input.email)
        .first()
      if (existingEmail) {
        throw HttpError.conflict('This email is already in use by another customer.', { field: 'email' })
      }
    }

    const updated = await this.repo.updateCustomer(businessId, id, input)
    if (!updated) {
      throw HttpError.internal('Failed to update customer.')
    }
    return updated
  }

  async updateCustomerStatus(businessId: string, id: string, status: CustomerStatus): Promise<CustomerDTO> {
    const existing = await this.repo.getCustomerById(businessId, id)
    if (!existing) {
      throw HttpError.notFound('Customer not found.')
    }

    if (existing.isWalkIn && status !== 'active') {
      throw HttpError.badRequest('Walk-in Customer must remain active.')
    }

    const updated = await this.repo.updateStatus(businessId, id, status)
    if (!updated) {
      throw HttpError.internal('Failed to update customer status.')
    }
    return updated
  }

  async archiveCustomer(businessId: string, id: string): Promise<CustomerDTO> {
    const existing = await this.repo.getCustomerById(businessId, id)
    if (!existing) {
      throw HttpError.notFound('Customer not found.')
    }

    if (existing.isWalkIn) {
      throw HttpError.badRequest('Walk-in Customer cannot be archived.')
    }

    const updated = await this.repo.updateStatus(businessId, id, 'archived')
    if (!updated) {
      throw HttpError.internal('Failed to archive customer.')
    }
    return updated
  }
}
