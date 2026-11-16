export type SaleDiscountType = 'fixed' | 'percent'
export type SaleStatus = 'draft' | 'completed' | 'voided' | 'partially_returned' | 'returned'
export type PaymentMethodType = 'cash' | 'card' | 'bank_transfer' | 'digital_wallet' | 'other' | 'credit'

export interface CustomerSnapshot {
  id: string
  name: string
  customerCode?: string
  phone?: string | null
  email?: string | null
  address?: string | null
  city?: string | null
  isWalkIn?: boolean
}

export interface SaleRow {
  id: string
  business_id: string
  branch_id: string
  sale_number: string
  receipt_number: string
  invoice_number: string
  customer_id: string
  customer_snapshot_json: string
  terminal_id: string
  cashier_id: string
  cashier_name: string
  subtotal_minor: number
  discount_type: SaleDiscountType
  discount_value: number
  discount_minor: number
  tax_minor: number
  total_amount_minor: number
  amount_paid_minor: number
  remaining_balance_minor: number
  change_returned_minor: number
  status: SaleStatus
  business_date_key: string
  idempotency_key: string | null
  created_at: string
  updated_at: string
}

export interface SaleItemRow {
  id: string
  sale_id: string
  product_id: string
  sku: string
  product_name: string
  unit: string
  unit_price_minor: number
  original_unit_price_minor?: number | null
  price_override_reason?: string | null
  price_override_by?: string | null
  price_override_at?: string | null
  unit_cost_minor: number
  cogs_estimated: number
  quantity: number
  subtotal_minor: number
  discount_minor: number
  tax_minor: number
  line_total_minor: number
  returned_quantity: number
}

export interface SaleItemDTO {
  id: string
  productId: string
  sku: string
  productName: string
  unit: string
  unitPriceMinor: number
  originalUnitPriceMinor?: number | null
  priceOverrideReason?: string | null
  priceOverrideBy?: string | null
  priceOverrideAt?: string | null
  unitCostMinor: number
  cogsEstimated: boolean
  quantity: number
  subtotalMinor: number
  discountMinor: number
  taxMinor: number
  lineTotalMinor: number
  returnedQuantity: number
}

export interface SalePaymentDTO {
  method: PaymentMethodType
  amountMinor: number
  reference?: string | null
}

export interface SaleDTO {
  id: string
  businessId: string
  branchId: string
  saleNumber: string
  receiptNumber: string
  invoiceNumber: string
  customerId: string
  customerSnapshot: CustomerSnapshot
  terminalId: string
  cashierId: string
  cashierName: string
  subtotalMinor: number
  discountType: SaleDiscountType
  discountValue: number
  discountMinor: number
  taxMinor: number
  totalAmountMinor: number
  amountPaidMinor: number
  remainingBalanceMinor: number
  changeReturnedMinor: number
  status: SaleStatus
  businessDateKey: string
  createdAt: string
  updatedAt: string
  items: SaleItemDTO[]
  payments?: SalePaymentDTO[]
}

export interface CreateSaleItemInput {
  productId: string
  quantity: number
  unitPriceMinor?: number
  discountMinor?: number
  taxMinor?: number
  overrideReason?: string
  taxOverride?: boolean
}

export interface CreateSalePaymentInput {
  method: PaymentMethodType
  amountMinor: number
  reference?: string | null
}

export interface CreateSaleInput {
  branchId?: string
  customerId?: string
  items: CreateSaleItemInput[]
  discountType?: SaleDiscountType
  discountValue?: number
  discountMinor?: number
  overrideReason?: string
  taxOverride?: boolean
  payments?: CreateSalePaymentInput[]
  notes?: string
  terminalId?: string
}

export interface SaleFilterParams {
  startDate?: string
  endDate?: string
  branchId?: string
  customerId?: string
  status?: SaleStatus | 'all'
  page: number
  limit: number
  sortBy: 'created_at' | 'total_amount' | 'sale_number'
  sortOrder: 'asc' | 'desc'
}

export interface SaleListResult {
  items: SaleDTO[]
  meta: {
    page: number
    limit: number
    totalCount: number
    totalPages: number
    hasNextPage: boolean
  }
}
