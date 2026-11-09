import type {
  CustomerRow,
  CustomerDTO,
  CustomerFilterParams,
  CreateCustomerInput,
  UpdateCustomerInput,
  CustomerStatus,
} from './customers.types'

export function mapCustomerRowToDTO(row: CustomerRow): CustomerDTO {
  return {
    id: row.id,
    businessId: row.business_id,
    customerCode: row.customer_code,
    name: row.name,
    type: row.type,
    companyName: row.company_name ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    taxNumber: row.tax_number ?? undefined,
    address: row.address ?? undefined,
    city: row.city ?? undefined,
    openingBalanceMinor: row.opening_balance_minor,
    creditLimitMinor: row.credit_limit_minor,
    isWalkIn: Boolean(row.is_walk_in),
    status: row.status,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class CustomersRepository {
  private readonly db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  private buildWhereClause(
    businessId: string,
    filters: CustomerFilterParams
  ): { sql: string; bindings: (string | number)[] } {
    const conditions: string[] = ['business_id = ?']
    const bindings: (string | number)[] = [businessId]

    if (!filters.includeWalkIn) {
      // By default if includeWalkIn is explicitly false, filter it out
      // But if omitted, allow all or let query param decide
    }

    if (filters.status && filters.status !== 'all') {
      conditions.push('status = ?')
      bindings.push(filters.status)
    }

    if (filters.type) {
      conditions.push('type = ?')
      bindings.push(filters.type)
    }

    if (filters.search && filters.search.trim().length > 0) {
      const term = `%${filters.search.trim()}%`
      conditions.push('(name LIKE ? OR customer_code LIKE ? OR phone LIKE ? OR email LIKE ? OR company_name LIKE ?)')
      bindings.push(term, term, term, term, term)
    }

    return { sql: conditions.join(' AND '), bindings }
  }

  async countCustomers(businessId: string, filters: CustomerFilterParams): Promise<number> {
    const { sql, bindings } = this.buildWhereClause(businessId, filters)
    const query = `SELECT COUNT(*) as cnt FROM customers WHERE ${sql}`
    const result = await this.db.prepare(query).bind(...bindings).first<{ cnt: number }>()
    return result?.cnt ?? 0
  }

  async listCustomers(businessId: string, filters: CustomerFilterParams): Promise<CustomerDTO[]> {
    const { sql, bindings } = this.buildWhereClause(businessId, filters)
    const offset = (filters.page - 1) * filters.limit
    const query = `
      SELECT * FROM customers
      WHERE ${sql}
      ORDER BY is_walk_in DESC, name ASC
      LIMIT ? OFFSET ?
    `
    const rows = await this.db
      .prepare(query)
      .bind(...bindings, filters.limit, offset)
      .all<CustomerRow>()

    return (rows.results || []).map(mapCustomerRowToDTO)
  }

  async getCustomerById(businessId: string, customerId: string): Promise<CustomerDTO | null> {
    const row = await this.db
      .prepare('SELECT * FROM customers WHERE business_id = ? AND id = ? LIMIT 1')
      .bind(businessId, customerId)
      .first<CustomerRow>()

    if (!row) return null
    return mapCustomerRowToDTO(row)
  }

  async getCustomerByCode(businessId: string, customerCode: string): Promise<CustomerDTO | null> {
    const row = await this.db
      .prepare('SELECT * FROM customers WHERE business_id = ? AND customer_code = ? LIMIT 1')
      .bind(businessId, customerCode)
      .first<CustomerRow>()

    if (!row) return null
    return mapCustomerRowToDTO(row)
  }

  async getWalkInCustomer(businessId: string): Promise<CustomerDTO | null> {
    const row = await this.db
      .prepare('SELECT * FROM customers WHERE business_id = ? AND is_walk_in = 1 LIMIT 1')
      .bind(businessId)
      .first<CustomerRow>()

    if (!row) return null
    return mapCustomerRowToDTO(row)
  }

  async generateNextCustomerCode(businessId: string): Promise<string> {
    const rows = await this.db
      .prepare("SELECT customer_code FROM customers WHERE business_id = ? AND customer_code LIKE 'CUS-%'")
      .bind(businessId)
      .all<{ customer_code: string }>()

    let maxNum = 1000
    for (const r of rows.results || []) {
      const match = r.customer_code.match(/CUS-(\d+)/)
      if (match) {
        const num = parseInt(match[1], 10)
        if (!isNaN(num) && num > maxNum) {
          maxNum = num
        }
      }
    }
    return `CUS-${maxNum + 1}`
  }

  async createCustomer(
    businessId: string,
    input: CreateCustomerInput,
    id: string,
    customerCode: string
  ): Promise<CustomerDTO> {
    const now = new Date().toISOString()
    await this.db
      .prepare(
        `INSERT INTO customers (
          id, business_id, customer_code, name, type, company_name,
          phone, email, tax_number, address, city,
          opening_balance_minor, credit_limit_minor, is_walk_in, status, notes,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
      )
      .bind(
        id,
        businessId,
        customerCode,
        input.name,
        input.type || 'individual',
        input.companyName ?? null,
        input.phone ?? null,
        input.email ?? null,
        input.taxNumber ?? null,
        input.address ?? null,
        input.city ?? null,
        input.openingBalanceMinor ?? 0,
        input.creditLimitMinor ?? 0,
        input.status || 'active',
        input.notes ?? null,
        now,
        now
      )
      .run()

    return (await this.getCustomerById(businessId, id))!
  }

  async updateCustomer(
    businessId: string,
    id: string,
    input: UpdateCustomerInput
  ): Promise<CustomerDTO | null> {
    const updates: string[] = ['updated_at = ?']
    const bindings: (string | number | null)[] = [new Date().toISOString()]

    if (input.name !== undefined) {
      updates.push('name = ?')
      bindings.push(input.name)
    }
    if (input.type !== undefined) {
      updates.push('type = ?')
      bindings.push(input.type)
    }
    if (input.companyName !== undefined) {
      updates.push('company_name = ?')
      bindings.push(input.companyName ?? null)
    }
    if (input.phone !== undefined) {
      updates.push('phone = ?')
      bindings.push(input.phone ?? null)
    }
    if (input.email !== undefined) {
      updates.push('email = ?')
      bindings.push(input.email ?? null)
    }
    if (input.taxNumber !== undefined) {
      updates.push('tax_number = ?')
      bindings.push(input.taxNumber ?? null)
    }
    if (input.address !== undefined) {
      updates.push('address = ?')
      bindings.push(input.address ?? null)
    }
    if (input.city !== undefined) {
      updates.push('city = ?')
      bindings.push(input.city ?? null)
    }
    if (input.creditLimitMinor !== undefined) {
      updates.push('credit_limit_minor = ?')
      bindings.push(input.creditLimitMinor)
    }
    if (input.notes !== undefined) {
      updates.push('notes = ?')
      bindings.push(input.notes ?? null)
    }
    if (input.status !== undefined) {
      updates.push('status = ?')
      bindings.push(input.status)
    }

    bindings.push(businessId, id)

    const result = await this.db
      .prepare(`UPDATE customers SET ${updates.join(', ')} WHERE business_id = ? AND id = ?`)
      .bind(...bindings)
      .run()

    if (result.meta.changes === 0) return null
    return this.getCustomerById(businessId, id)
  }

  async updateStatus(
    businessId: string,
    id: string,
    status: CustomerStatus
  ): Promise<CustomerDTO | null> {
    const now = new Date().toISOString()
    const result = await this.db
      .prepare('UPDATE customers SET status = ?, updated_at = ? WHERE business_id = ? AND id = ?')
      .bind(status, now, businessId, id)
      .run()

    if (result.meta.changes === 0) return null
    return this.getCustomerById(businessId, id)
  }
}

