import { HttpError } from '../../lib/errors'
import { SupplierLedgerRepository } from './supplierLedger.repository'
import type {
  SupplierLedgerFilterParams,
  SupplierLedgerStatementDTO,
  SupplierFinancialSummaryDTO,
} from './supplierLedger.types'

export class SupplierLedgerService {
  private readonly repo: SupplierLedgerRepository

  constructor(db: D1Database) {
    this.repo = new SupplierLedgerRepository(db)
  }

  async getSupplierLedgerStatement(
    businessId: string,
    supplierId: string,
    filters: SupplierLedgerFilterParams,
    authorizedBranchIds: string[]
  ): Promise<SupplierLedgerStatementDTO> {
    const supplier = await this.repo.getSupplier(businessId, supplierId)
    if (!supplier) {
      throw HttpError.notFound('Supplier not found.')
    }

    const scopedBranchIds = filters.branchId
      ? authorizedBranchIds.includes(filters.branchId)
        ? [filters.branchId]
        : []
      : authorizedBranchIds

    const openingBalanceMinor = await this.repo.getOpeningPayableBeforeDate(
      businessId,
      supplierId,
      filters.startDate,
      scopedBranchIds
    )

    const totalCount = await this.repo.countEntries(
      businessId,
      supplierId,
      filters,
      authorizedBranchIds
    )

    const entries = await this.repo.getEntries(
      businessId,
      supplierId,
      filters,
      authorizedBranchIds
    )

    let totalDebitsMinor = 0
    let totalCreditsMinor = 0
    for (const e of entries) {
      totalDebitsMinor += e.debitMinor
      totalCreditsMinor += e.creditMinor
    }

    // Credits increase payable, Debits decrease payable
    const netChangeMinor = totalCreditsMinor - totalDebitsMinor
    const closingBalanceMinor = openingBalanceMinor + netChangeMinor

    const totalPages = Math.max(1, Math.ceil(totalCount / filters.limit))
    const hasNextPage = filters.page < totalPages

    return {
      supplierId: supplier.id,
      supplierName: supplier.name,
      contactPerson: supplier.contact_person,
      phone: supplier.phone,
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

  async getSupplierFinancialSummary(
    businessId: string,
    supplierId: string,
    authorizedBranchIds?: string[]
  ): Promise<SupplierFinancialSummaryDTO> {
    const supplier = await this.repo.getSupplier(businessId, supplierId)
    if (!supplier) {
      throw HttpError.notFound('Supplier not found.')
    }

    return this.repo.getFinancialSummary(businessId, supplierId, authorizedBranchIds)
  }
}

