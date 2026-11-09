import { HttpError } from '../../lib/errors'
import { InvoicesRepository } from './invoices.repository'
import { SalesRepository } from '../sales/sales.repository'
import type {
  InvoiceDTO,
  InvoiceFilterParams,
  InvoiceListResult,
} from './invoices.types'
import type { SaleDTO } from '../sales/sales.types'

export class InvoicesService {
  private readonly repo: InvoicesRepository
  private readonly salesRepo: SalesRepository

  constructor(db: D1Database) {
    this.repo = new InvoicesRepository(db)
    this.salesRepo = new SalesRepository(db)
  }

  async listInvoices(
    businessId: string,
    filters: InvoiceFilterParams,
    authorizedBranchIds: string[]
  ): Promise<InvoiceListResult> {
    const totalCount = await this.repo.countInvoices(businessId, filters, authorizedBranchIds)
    const items = await this.repo.listInvoices(businessId, filters, authorizedBranchIds)
    const totalPages = Math.max(1, Math.ceil(totalCount / filters.limit))
    const hasNextPage = filters.page < totalPages

    return {
      items,
      meta: {
        page: filters.page,
        limit: filters.limit,
        totalCount,
        totalPages,
        hasNextPage,
      },
    }
  }

  async getInvoiceById(
    businessId: string,
    invoiceId: string,
    authorizedBranchIds: string[]
  ): Promise<InvoiceDTO> {
    const invoice = await this.repo.getInvoiceById(businessId, invoiceId, authorizedBranchIds)
    if (!invoice) {
      throw HttpError.notFound('Invoice not found.')
    }
    return invoice
  }

  async getInvoiceBySaleId(
    businessId: string,
    saleId: string,
    authorizedBranchIds: string[]
  ): Promise<InvoiceDTO> {
    const invoice = await this.repo.getInvoiceBySaleId(businessId, saleId, authorizedBranchIds)
    if (!invoice) {
      throw HttpError.notFound('Invoice for this sale not found.')
    }
    return invoice
  }

  async getSaleForInvoice(
    businessId: string,
    invoiceId: string,
    authorizedBranchIds: string[]
  ): Promise<SaleDTO> {
    const invoice = await this.repo.getInvoiceById(businessId, invoiceId, authorizedBranchIds)
    if (!invoice) {
      throw HttpError.notFound('Invoice not found.')
    }

    const sale = await this.salesRepo.getSaleById(businessId, invoice.saleId, authorizedBranchIds)
    if (!sale) {
      throw HttpError.notFound('Sale associated with this invoice not found.')
    }
    return sale
  }
}
