import type {
  CustomerLedgerEntryDTO,
  CustomerLedgerFilterParams,
  CustomerFinancialSummaryDTO,
} from './customerLedger.types'

export interface CustomerRow {
  id: string
  business_id: string
  customer_code: string
  name: string
  opening_balance_minor: number
  credit_limit_minor: number
  is_walk_in: number
  status: string
}

export interface CustomerLedgerRow {
  id: string
  business_id: string
  branch_id: string
  customer_id: string
  type: 'opening' | 'invoice' | 'payment' | 'credit_note' | 'void' | 'adjustment'
  reference_id: string
  reference_number: string
  description: string
  debit_minor: number
  credit_minor: number
  balance_minor: number
  business_date_key: string
  created_at: string
}

export function mapLedgerRowToDTO(row: CustomerLedgerRow): CustomerLedgerEntryDTO {
  return {
    id: row.id,
    businessId: row.business_id,
    branchId: row.branch_id,
    customerId: row.customer_id,
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

export class CustomerLedgerRepository {
  private readonly db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  async getCustomer(businessId: string, customerId: string): Promise<CustomerRow | null> {
    return this.db
      .prepare(
        `SELECT id, business_id, customer_code, name, opening_balance_minor,
                credit_limit_minor, is_walk_in, status
         FROM customers
         WHERE business_id = ? AND id = ? LIMIT 1`
      )
      .bind(businessId, customerId)
      .first<CustomerRow>()
  }

  private buildWhereClause(
    businessId: string,
    customerId: string,
    filters: CustomerLedgerFilterParams,
    authorizedBranchIds: string[]
  ): { sql: string; bindings: (string | number)[] } {
    const conditions: string[] = ['business_id = ?', 'customer_id = ?']
    const bindings: (string | number)[] = [businessId, customerId]

    if (filters.branchId) {
      if (authorizedBranchIds.length > 0 && !authorizedBranchIds.includes(filters.branchId)) {
        conditions.push('1 = 0')
      } else {
        conditions.push('branch_id = ?')
        bindings.push(filters.branchId)
      }
    } else if (authorizedBranchIds.length > 0) {
      const placeholders = authorizedBranchIds.map(() => '?').join(', ')
      conditions.push(`branch_id IN (${placeholders})`)
      bindings.push(...authorizedBranchIds)
    }

    if (filters.type) {
      conditions.push('type = ?')
      bindings.push(filters.type)
    }

    if (filters.startDate) {
      conditions.push('business_date_key >= ?')
      bindings.push(filters.startDate)
    }

    if (filters.endDate) {
      conditions.push('business_date_key <= ?')
      bindings.push(filters.endDate)
    }

    return { sql: conditions.join(' AND '), bindings }
  }

  async countEntries(
    businessId: string,
    customerId: string,
    filters: CustomerLedgerFilterParams,
    authorizedBranchIds: string[]
  ): Promise<number> {
    const { sql, bindings } = this.buildWhereClause(
      businessId,
      customerId,
      filters,
      authorizedBranchIds
    )
    const query = `
      SELECT COUNT(*) as cnt
      FROM customer_ledger_transactions
      WHERE ${sql}
    `
    const res = await this.db.prepare(query).bind(...bindings).first<{ cnt: number }>()
    return res?.cnt ?? 0
  }

  async getEntries(
    businessId: string,
    customerId: string,
    filters: CustomerLedgerFilterParams,
    authorizedBranchIds: string[]
  ): Promise<CustomerLedgerEntryDTO[]> {
    const { sql, bindings } = this.buildWhereClause(
      businessId,
      customerId,
      filters,
      authorizedBranchIds
    )
    const offset = (filters.page - 1) * filters.limit

    const query = `
      SELECT *
      FROM customer_ledger_transactions
      WHERE ${sql}
      ORDER BY business_date_key ASC, created_at ASC, id ASC
      LIMIT ? OFFSET ?
    `
    const rows = await this.db
      .prepare(query)
      .bind(...bindings, filters.limit, offset)
      .all<CustomerLedgerRow>()

    return (rows.results || []).map(mapLedgerRowToDTO)
  }

  async getOpeningBalanceBeforeDate(
    businessId: string,
    customerId: string,
    startDate?: string
  ): Promise<number> {
    if (!startDate) {
      const cust = await this.getCustomer(businessId, customerId)
      return cust?.opening_balance_minor ?? 0
    }

    // Find the latest entry before startDate
    const prior = await this.db
      .prepare(
        `SELECT balance_minor
         FROM customer_ledger_transactions
         WHERE business_id = ? AND customer_id = ? AND business_date_key < ?
         ORDER BY business_date_key DESC, created_at DESC, id DESC
         LIMIT 1`
      )
      .bind(businessId, customerId, startDate)
      .first<{ balance_minor: number }>()

    if (prior) {
      return prior.balance_minor
    }

    const cust = await this.getCustomer(businessId, customerId)
    return cust?.opening_balance_minor ?? 0
  }

  async getFinancialSummary(
    businessId: string,
    customerId: string
  ): Promise<CustomerFinancialSummaryDTO> {
    const cust = await this.getCustomer(businessId, customerId)
    if (!cust) {
      throw new Error('Customer not found')
    }

    // Latest balance
    const lastEntry = await this.db
      .prepare(
        `SELECT balance_minor
         FROM customer_ledger_transactions
         WHERE business_id = ? AND customer_id = ?
         ORDER BY rowid DESC
         LIMIT 1`
      )
      .bind(businessId, customerId)
      .first<{ balance_minor: number }>()

    const currentBalanceMinor = lastEntry ? lastEntry.balance_minor : (cust.opening_balance_minor || 0)
    const creditLimitMinor = cust.credit_limit_minor || 0
    const availableCreditMinor = Math.max(0, creditLimitMinor - currentBalanceMinor)

    // Total invoiced
    const invoicedRes = await this.db
      .prepare(
        `SELECT SUM(total_amount_minor) as total
         FROM invoices
         WHERE business_id = ? AND customer_id = ? AND status = 'active'`
      )
      .bind(businessId, customerId)
      .first<{ total: number | null }>()
    const totalInvoicedMinor = invoicedRes?.total ?? 0

    // Total paid
    const paidRes = await this.db
      .prepare(
        `SELECT SUM(amount_minor) as total
         FROM payments
         WHERE business_id = ? AND customer_id = ?`
      )
      .bind(businessId, customerId)
      .first<{ total: number | null }>()
    const totalPaidMinor = paidRes?.total ?? 0

    // Open invoices count and earliest unpaid invoice date
    const openInvoicesRes = await this.db
      .prepare(
        `SELECT COUNT(*) as open_count, MIN(business_date_key) as earliest_date
         FROM invoices
         WHERE business_id = ? AND customer_id = ? AND status = 'active' AND remaining_amount_minor > 0`
      )
      .bind(businessId, customerId)
      .first<{ open_count: number; earliest_date: string | null }>()

    return {
      customerId: cust.id,
      customerCode: cust.customer_code,
      customerName: cust.name,
      openingBalanceMinor: cust.opening_balance_minor || 0,
      currentBalanceMinor,
      creditLimitMinor,
      availableCreditMinor,
      totalInvoicedMinor,
      totalPaidMinor,
      openInvoicesCount: openInvoicesRes?.open_count ?? 0,
      earliestUnpaidInvoiceDate: openInvoicesRes?.earliest_date ?? null,
    }
  }
}
