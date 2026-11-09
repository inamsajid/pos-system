import type {
  SupplierRow,
  SupplierDTO,
  SupplierFilterParams,
  CreateSupplierInput,
  UpdateSupplierInput,
  SupplierProductRow,
  SupplierProductDTO,
  AddSupplierProductInput,
} from './suppliers.types'

export function mapSupplierRowToDTO(row: SupplierRow): SupplierDTO {
  return {
    id: row.id,
    businessId: row.business_id,
    supplierCode: row.supplier_code,
    name: row.name,
    type: row.type,
    companyName: row.company_name,
    contactPerson: row.contact_person,
    phone: row.phone,
    alternatePhone: row.alternate_phone,
    email: row.email,
    taxNumber: row.tax_number,
    address: row.address,
    city: row.city,
    country: row.country,
    openingPayableMinor: row.opening_payable_minor,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapSupplierProductRowToDTO(row: SupplierProductRow): SupplierProductDTO {
  return {
    id: row.id,
    businessId: row.business_id,
    supplierId: row.supplier_id,
    productId: row.product_id,
    supplierSku: row.supplier_sku ?? undefined,
    purchasePriceMinor: row.purchase_price_minor,
    purchasePrice: row.purchase_price_minor / 100,
    isPreferred: Boolean(row.is_preferred),
    createdAt: row.created_at,
  }
}

export class SuppliersRepository {
  private readonly db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  private buildWhereClause(
    businessId: string,
    filters: SupplierFilterParams
  ): { sql: string; bindings: (string | number)[] } {
    const conditions: string[] = ['business_id = ?']
    const bindings: (string | number)[] = [businessId]

    if (filters.status && filters.status !== 'all') {
      conditions.push('status = ?')
      bindings.push(filters.status)
    }

    if (filters.search && filters.search.trim().length > 0) {
      const term = `%${filters.search.trim()}%`
      conditions.push('(name LIKE ? OR supplier_code LIKE ? OR company_name LIKE ? OR phone LIKE ?)')
      bindings.push(term, term, term, term)
    }

    return { sql: conditions.join(' AND '), bindings }
  }

  async countSuppliers(businessId: string, filters: SupplierFilterParams): Promise<number> {
    const { sql, bindings } = this.buildWhereClause(businessId, filters)
    const query = `SELECT COUNT(*) as cnt FROM suppliers WHERE ${sql}`
    const result = await this.db.prepare(query).bind(...bindings).first<{ cnt: number }>()
    return result?.cnt ?? 0
  }

  async listSuppliers(businessId: string, filters: SupplierFilterParams): Promise<SupplierDTO[]> {
    const { sql, bindings } = this.buildWhereClause(businessId, filters)
    const offset = (filters.page - 1) * filters.limit
    const query = `
      SELECT * FROM suppliers
      WHERE ${sql}
      ORDER BY name ASC
      LIMIT ? OFFSET ?
    `
    const rows = await this.db
      .prepare(query)
      .bind(...bindings, filters.limit, offset)
      .all<SupplierRow>()

    return (rows.results || []).map(mapSupplierRowToDTO)
  }

  async getSupplierById(businessId: string, supplierId: string): Promise<SupplierDTO | null> {
    const row = await this.db
      .prepare('SELECT * FROM suppliers WHERE business_id = ? AND id = ? LIMIT 1')
      .bind(businessId, supplierId)
      .first<SupplierRow>()

    if (!row) return null
    return mapSupplierRowToDTO(row)
  }

  async generateNextSupplierCode(businessId: string): Promise<string> {
    const rows = await this.db
      .prepare("SELECT supplier_code FROM suppliers WHERE business_id = ? AND supplier_code LIKE 'SUP-%'")
      .bind(businessId)
      .all<{ supplier_code: string }>()

    let maxNum = 1000
    for (const r of rows.results || []) {
      const match = r.supplier_code.match(/SUP-(\d+)/)
      if (match) {
        const num = parseInt(match[1], 10)
        if (!isNaN(num) && num > maxNum) {
          maxNum = num
        }
      }
    }
    return `SUP-${maxNum + 1}`
  }

  async createSupplier(
    businessId: string,
    input: CreateSupplierInput,
    id: string,
    supplierCode: string
  ): Promise<SupplierDTO> {
    const now = new Date().toISOString()
    await this.db
      .prepare(
        `INSERT INTO suppliers (
          id, business_id, supplier_code, name, type, company_name,
          contact_person, phone, alternate_phone, email, tax_number,
          address, city, country, opening_payable_minor, status, notes,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        businessId,
        supplierCode,
        input.name,
        input.type || 'business',
        input.companyName ?? null,
        input.contactPerson ?? null,
        input.phone ?? null,
        input.alternatePhone ?? null,
        input.email ?? null,
        input.taxNumber ?? null,
        input.address ?? null,
        input.city ?? null,
        input.country || 'Pakistan',
        input.openingPayableMinor ?? 0,
        input.status || 'active',
        input.notes ?? null,
        now,
        now
      )
      .run()

    return (await this.getSupplierById(businessId, id))!
  }

  async updateSupplier(
    businessId: string,
    id: string,
    input: UpdateSupplierInput
  ): Promise<SupplierDTO | null> {
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
    if (input.contactPerson !== undefined) {
      updates.push('contact_person = ?')
      bindings.push(input.contactPerson ?? null)
    }
    if (input.phone !== undefined) {
      updates.push('phone = ?')
      bindings.push(input.phone ?? null)
    }
    if (input.alternatePhone !== undefined) {
      updates.push('alternate_phone = ?')
      bindings.push(input.alternatePhone ?? null)
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
    if (input.country !== undefined) {
      updates.push('country = ?')
      bindings.push(input.country)
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
      .prepare(`UPDATE suppliers SET ${updates.join(', ')} WHERE business_id = ? AND id = ?`)
      .bind(...bindings)
      .run()

    if (result.meta.changes === 0) return null
    return this.getSupplierById(businessId, id)
  }

  async updateStatus(
    businessId: string,
    id: string,
    status: 'active' | 'inactive' | 'archived'
  ): Promise<SupplierDTO | null> {
    const now = new Date().toISOString()
    const result = await this.db
      .prepare('UPDATE suppliers SET status = ?, updated_at = ? WHERE business_id = ? AND id = ?')
      .bind(status, now, businessId, id)
      .run()

    if (result.meta.changes === 0) return null
    return this.getSupplierById(businessId, id)
  }

  async listSupplierProducts(businessId: string, supplierId: string): Promise<SupplierProductDTO[]> {
    const rows = await this.db
      .prepare('SELECT * FROM supplier_products WHERE business_id = ? AND supplier_id = ? ORDER BY is_preferred DESC')
      .bind(businessId, supplierId)
      .all<SupplierProductRow>()

    return (rows.results || []).map(mapSupplierProductRowToDTO)
  }

  async addOrUpdateSupplierProduct(
    businessId: string,
    supplierId: string,
    input: AddSupplierProductInput
  ): Promise<SupplierProductDTO> {
    const id = `sp_${crypto.randomUUID()}`
    const now = new Date().toISOString()
    const isPref = input.isPreferred ? 1 : 0

    await this.db
      .prepare(
        `INSERT INTO supplier_products (id, business_id, supplier_id, product_id, supplier_sku, purchase_price_minor, is_preferred, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(supplier_id, product_id) DO UPDATE SET
           supplier_sku = excluded.supplier_sku,
           purchase_price_minor = excluded.purchase_price_minor,
           is_preferred = excluded.is_preferred`
      )
      .bind(
        id,
        businessId,
        supplierId,
        input.productId,
        input.supplierSku ?? null,
        input.purchasePriceMinor ?? 0,
        isPref,
        now
      )
      .run()

    const row = await this.db
      .prepare('SELECT * FROM supplier_products WHERE business_id = ? AND supplier_id = ? AND product_id = ? LIMIT 1')
      .bind(businessId, supplierId, input.productId)
      .first<SupplierProductRow>()

    return mapSupplierProductRowToDTO(row!)
  }
}
