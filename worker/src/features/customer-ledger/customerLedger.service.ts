import { HttpError } from '../../lib/errors'
import { CustomerLedgerRepository } from './customerLedger.repository'
import type {
  CustomerLedgerFilterParams,
  CustomerLedgerStatementDTO,
  CustomerFinancialSummaryDTO,
} from './customerLedger.types'

export class CustomerLedgerService {
  private readonly repo: CustomerLedgerRepository

  constructor(db: D1Database) {
    this.repo = new CustomerLedgerRepository(db)
  }

  async getCustomerLedgerStatement(
    businessId: string,
    customerId: string,
    filters: CustomerLedgerFilterParams,
    authorizedBranchIds: string[]
  ): Promise<CustomerLedgerStatementDTO> {
    const customer = await this.repo.getCustomer(businessId, customerId)
    if (!customer) {
      throw HttpError.notFound('Customer not found.')
    }

    const scopedBranchIds = filters.branchId
      ? authorizedBranchIds.includes(filters.branchId)
        ? [filters.branchId]
        : []
      : authorizedBranchIds

    const openingBalanceMinor = await this.repo.getOpeningBalanceBeforeDate(
      businessId,
      customerId,
      filters.startDate,
      scopedBranchIds
    )

    const totalCount = await this.repo.countEntries(
      businessId,
      customerId,
      filters,
      authorizedBranchIds
    )

    const entries = await this.repo.getEntries(
      businessId,
      customerId,
      filters,
      authorizedBranchIds
    )

    let totalDebitsMinor = 0
    let totalCreditsMinor = 0
    for (const e of entries) {
      totalDebitsMinor += e.debitMinor
      totalCreditsMinor += e.creditMinor
    }

    const netChangeMinor = totalDebitsMinor - totalCreditsMinor
    const closingBalanceMinor = openingBalanceMinor + netChangeMinor

    const totalPages = Math.max(1, Math.ceil(totalCount / filters.limit))
    const hasNextPage = filters.page < totalPages

    return {
      customerId: customer.id,
      customerCode: customer.customer_code,
      customerName: customer.name,
      openingBalanceMinor,
      closingBalanceMinor,
      totalDebitsMinor,
      totalCreditsMinor,
      netChangeMinor,
      entries,
      meta: {
        page: filters.page,
        limit: filters.limit,
        totalCount,
        totalPages,
        hasNextPage,
      },
    }
  }

  async getCustomerFinancialSummary(
    businessId: string,
    customerId: string,
    authorizedBranchIds?: string[]
  ): Promise<CustomerFinancialSummaryDTO> {
    const customer = await this.repo.getCustomer(businessId, customerId)
    if (!customer) {
      throw HttpError.notFound('Customer not found.')
    }

    return this.repo.getFinancialSummary(businessId, customerId, authorizedBranchIds)
  }
}

