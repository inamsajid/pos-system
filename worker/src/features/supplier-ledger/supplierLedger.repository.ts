import type {
  SupplierLedgerEntryDTO,
  SupplierLedgerFilterParams,
  SupplierFinancialSummaryDTO,
  SupplierLedgerType,
} from './supplierLedger.types'

export interface SupplierRow {
  id: string
  business_id: string
  name: string
  contact_person: string | null
  phone: string | null
  email: string | null
  tax_number: string | null
  opening_payable_minor: number
  status: string
}

export interface SupplierLedgerRow {
  id: string
  business_id: string
  branch_id: string
  supplier_id: string
  type: SupplierLedgerType
  reference_id: string
  reference_number: string
  description: string
  debit_minor: number
  credit_minor: number
  balance_minor: number
  business_date_key: string
  created_at: string
}

export function mapSupplierLedgerRowToDTO(row: SupplierLedgerRow): SupplierLedgerEntryDTO {
  return {
    id: row.id,
    businessId: row.business_id,
    branchId: row.branch_id,
    supplierId: row.supplier_id,
    type: row.type,
    referenceId: row.reference_id,
    referenceNumber: row.reference_number,
    description: row.description,
    debitMinor: row.debit_minor,
    creditMinor: row.credit_minor,
    balanceMinor: row.balance_minor,
    businessDateKey: row.business_date_key,
    createdAt: row.created_at,
  }
}

export class SupplierLedgerRepository {
  private readonly db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  async getSupplier(businessId: string, supplierId: string): Promise<SupplierRow | null> {
    return this.db
      .prepare(
        `SELECT id, business_id, name, contact_person, phone, email, tax_number,
                opening_payable_minor, status
         FROM suppliers
         WHERE business_id = ? AND id = ? LIMIT 1`
      )
      .bind(businessId, supplierId)
      .first<SupplierRow>()
  }

  private buildWhereClause(
    businessId: string,
    supplierId: string,
    filters: SupplierLedgerFilterParams,
    authorizedBranchIds: string[]
  ): { sql: string; bindings: (string | number)[] } {
    const conditions: string[] = ['slt.business_id = ?', 'slt.supplier_id = ?']
    const bindings: (string | number)[] = [businessId, supplierId]

    if (filters.branchId) {
      if (authorizedBranchIds.length > 0 && !authorizedBranchIds.includes(filters.branchId)) {
        conditions.push('1 = 0')
      } else {
        conditions.push('slt.branch_id = ?')
        bindings.push(filters.branchId)
      }
    } else if (authorizedBranchIds.length > 0) {
      const placeholders = authorizedBranchIds.map(() => '?').join(', ')
      conditions.push(`slt.branch_id IN (${placeholders})`)
      bindings.push(...authorizedBranchIds)
    }

    if (filters.type) {
      conditions.push('slt.type = ?')
      bindings.push(filters.type)
    }

    if (filters.startDate) {
      conditions.push('slt.business_date_key >= ?')
      bindings.push(filters.startDate)
    }

    if (filters.endDate) {
      conditions.push('slt.business_date_key <= ?')
      bindings.push(filters.endDate)
    }

    return { sql: conditions.join(' AND '), bindings }
  }

  async countEntries(
    businessId: string,
    supplierId: string,
    filters: SupplierLedgerFilterParams,
    authorizedBranchIds: string[]
  ): Promise<number> {
    const { sql, bindings } = this.buildWhereClause(
      businessId,
      supplierId,
      filters,
      authorizedBranchIds
    )
    const query = `
      SELECT COUNT(*) as cnt
      FROM supplier_ledger_transactions slt
      WHERE ${sql}
    `
    const res = await this.db.prepare(query).bind(...bindings).first<{ cnt: number }>()
    return res?.cnt ?? 0
  }

  async getEntries(
    businessId: string,
    supplierId: string,
    filters: SupplierLedgerFilterParams,
    authorizedBranchIds: string[]
  ): Promise<SupplierLedgerEntryDTO[]> {
    const { sql, bindings } = this.buildWhereClause(
      businessId,
      supplierId,
      filters,
      authorizedBranchIds
    )
    const offset = (filters.page - 1) * filters.limit

    const query = `
      SELECT slt.*
      FROM supplier_ledger_transactions slt
      WHERE ${sql}
      ORDER BY slt.business_date_key ASC, slt.created_at ASC, slt.rowid ASC
      LIMIT ? OFFSET ?
    `
    const rows = await this.db
      .prepare(query)
      .bind(...bindings, filters.limit, offset)
      .all<SupplierLedgerRow>()

    return (rows.results || []).map(mapSupplierLedgerRowToDTO)
  }

  async getOpeningPayableBeforeDate(
    businessId: string,
    supplierId: string,
    startDate?: string
  ): Promise<number> {
    if (!startDate) {
      const supp = await this.getSupplier(businessId, supplierId)
      return supp?.opening_payable_minor ?? 0
    }

    // Find the latest entry before startDate
    const prior = await this.db
      .prepare(
        `SELECT balance_minor
         FROM supplier_ledger_transactions
         WHERE business_id = ? AND supplier_id = ? AND business_date_key < ?
         ORDER BY business_date_key DESC, created_at DESC, rowid DESC
         LIMIT 1`
      )
      .bind(businessId, supplierId, startDate)
      .first<{ balance_minor: number }>()

    if (prior) {
      return prior.balance_minor
    }

    const supp = await this.getSupplier(businessId, supplierId)
    return supp?.opening_payable_minor ?? 0
  }

  async getFinancialSummary(
    businessId: string,
    supplierId: string
  ): Promise<SupplierFinancialSummaryDTO> {
    const supp = await this.getSupplier(businessId, supplierId)
    if (!supp) {
      throw new Error('Supplier not found')
    }

    // Latest balance
    const lastEntry = await this.db
      .prepare(
        `SELECT balance_minor
         FROM supplier_ledger_transactions
         WHERE business_id = ? AND supplier_id = ?
         ORDER BY rowid DESC
         LIMIT 1`
      )
      .bind(businessId, supplierId)
      .first<{ balance_minor: number }>()

    const currentPayableMinor = lastEntry ? lastEntry.balance_minor : (supp.opening_payable_minor || 0)

    // Total billed
    const billedRes = await this.db
      .prepare(
        `SELECT SUM(credit_minor) as total
         FROM supplier_ledger_transactions
         WHERE business_id = ? AND supplier_id = ? AND type = 'bill'`
      )
      .bind(businessId, supplierId)
      .first<{ total: number | null }>()
    const totalBilledMinor = billedRes?.total ?? 0

    // Total paid
    const paidRes = await this.db
      .prepare(
        `SELECT SUM(amount_minor) as total
         FROM supplier_payments
         WHERE business_id = ? AND supplier_id = ?`
      )
      .bind(businessId, supplierId)
      .first<{ total: number | null }>()
    const totalPaidMinor = paidRes?.total ?? 0

    // Open purchases count and earliest unpaid purchase date
    const openPurchasesRes = await this.db
      .prepare(
        `SELECT COUNT(*) as open_count, MIN(purchase_date_key) as earliest_date
         FROM purchases
         WHERE business_id = ? AND supplier_id = ? AND status NOT IN ('draft', 'cancelled') AND (total_amount_minor - paid_amount_minor) > 0`
      )
      .bind(businessId, supplierId)
      .first<{ open_count: number; earliest_date: string | null }>()

    return {
      supplierId: supp.id,
      supplierName: supp.name,
      contactPerson: supp.contact_person,
      phone: supp.phone,
      openingPayableMinor: supp.opening_payable_minor || 0,
      currentPayableMinor,
      totalBilledMinor,
      totalPaidMinor,
      openPurchasesCount: openPurchasesRes?.open_count ?? 0,
      earliestUnpaidPurchaseDate: openPurchasesRes?.earliest_date ?? null,
    }
  }
}
