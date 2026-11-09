import type { CustomerSnapshot } from '../sales/sales.types'

export type PaymentSource = 'pos_checkout' | 'manual' | 'online'
export type PaymentMethodType = 'cash' | 'card' | 'bank_transfer' | 'digital_wallet' | 'other'

export interface PaymentMethodEntry {
  method: PaymentMethodType
  amountMinor: number
  reference?: string | null
}

export interface PaymentAllocationItemInput {
  invoiceId: string
  amountMinor: number
}

export interface CreateCustomerPaymentInput {
  branchId?: string
  customerId: string
  amountMinor: number
  paymentMethods: PaymentMethodEntry[]
  allocations?: PaymentAllocationItemInput[]
  notes?: string | null
}

export interface AllocateAdvanceInput {
  allocations: PaymentAllocationItemInput[]
}

export interface PaymentRow {
  id: string
  business_id: string
  branch_id: string
  receipt_number: string
  customer_id: string
  customer_snapshot_json: string
  amount_minor: number
  unallocated_amount_minor: number
  source: PaymentSource
  notes: string | null
  business_date_key: string
  received_by: string
  received_at: string
  created_at: string
  customer_name?: string
  receiver_name?: string
}

export interface PaymentMethodRow {
  id: string
  payment_id: string
  method: PaymentMethodType
  amount_minor: number
  reference: string | null
}

export interface PaymentAllocationRow {
  id: string
  business_id: string
  payment_id: string
  sale_id: string
  invoice_number: string
  amount_minor: number
  allocated_at: string
}

export interface PaymentAllocationDTO {
  id: string
  paymentId: string
  saleId: string
  invoiceNumber: string
  amountMinor: number
  allocatedAt: string
}

export interface CustomerPaymentDTO {
  id: string
  businessId: string
  branchId: string
  receiptNumber: string
  customerId: string
  customerName?: string
  customerSnapshot?: CustomerSnapshot
  amountMinor: number
  unallocatedAmountMinor: number
  source: PaymentSource
  notes: string | null
  businessDateKey: string
  receivedBy: string
  receivedByName?: string
  receivedAt: string
  createdAt: string
  paymentMethods: PaymentMethodEntry[]
  allocations?: PaymentAllocationDTO[]
}

export interface CustomerPaymentFilterParams {
  branchId?: string
  customerId?: string
  startDate?: string
  endDate?: string
  page: number
  limit: number
}

export interface CustomerPaymentListResult {
  items: CustomerPaymentDTO[]
  meta: {
    page: number
    limit: number
    totalCount: number
    totalPages: number
    hasNextPage: boolean
  }
}

