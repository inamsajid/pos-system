import type { CustomerSnapshot, SaleItemDTO } from '../sales/sales.types'

export interface InvoiceRow {
  id: string
  business_id: string
  branch_id: string
  invoice_number: string
  sale_id: string
  customer_id: string
  business_date_key: string
  total_amount_minor: number
  paid_amount_minor: number
  remaining_amount_minor: number
  payment_status: 'paid' | 'partial' | 'unpaid'
  status: 'active' | 'voided'
  created_at: string
  updated_at: string
  customer_name?: string
  customer_snapshot_json?: string
}

export interface PaymentAllocationDetailDTO {
  id: string
  paymentId: string
  receiptNumber: string
  amountMinor: number
  method: string
  allocatedAt: string
}

export interface InvoiceDTO {
  id: string
  businessId: string
  branchId: string
  invoiceNumber: string
  saleId: string
  customerId: string
  customerName?: string
  customerSnapshot?: CustomerSnapshot
  businessDateKey: string
  totalAmountMinor: number
  paidAmountMinor: number
  remainingAmountMinor: number
  paymentStatus: 'paid' | 'partial' | 'unpaid'
  status: 'active' | 'voided'
  createdAt: string
  updatedAt: string
  items?: SaleItemDTO[]
  allocations?: PaymentAllocationDetailDTO[]
}

export interface InvoiceFilterParams {
  branchId?: string
  customerId?: string
  paymentStatus?: 'paid' | 'partial' | 'unpaid'
  status?: 'active' | 'voided'
  startDate?: string
  endDate?: string
  search?: string
  page: number
  limit: number
}

export interface InvoiceListResult {
  items: InvoiceDTO[]
  meta: {
    page: number
    limit: number
    totalCount: number
    totalPages: number
    hasNextPage: boolean
  }
}

