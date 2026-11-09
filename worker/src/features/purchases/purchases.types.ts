export type PurchaseStatus = 'draft' | 'ordered' | 'partially_received' | 'received' | 'cancelled'

export interface SupplierSnapshot {
  id: string
  supplierCode: string
  name: string
  companyName: string | null
  phone: string | null
  email: string | null
  taxNumber: string | null
}

export interface PurchaseRow {
  id: string
  business_id: string
  branch_id: string
  purchase_number: string
  supplier_id: string
  supplier_snapshot_json: string
  supplier_invoice_number: string | null
  subtotal_minor: number
  discount_minor: number
  tax_minor: number
  total_amount_minor: number
  paid_amount_minor: number
  status: PurchaseStatus
  purchase_date_key: string
  expected_delivery_date: string | null
  notes: string | null
  confirmed_at: string | null
  created_by: string
  created_at: string
  updated_at: string
  supplier_name?: string
  branch_name?: string
  creator_name?: string
}

export interface PurchaseItemRow {
  id: string
  purchase_id: string
  product_id: string
  sku: string
  product_name: string
  unit: string
  ordered_quantity: number
  received_quantity: number
  unit_cost_minor: number
  discount_minor: number
  line_total_minor: number
}

export interface PurchaseItemDTO {
  id: string
  purchaseId: string
  productId: string
  productName: string
  sku: string
  unit: string
  orderedQuantity: number
  receivedQuantity: number
  remainingQuantity: number
  unitCostMinor: number
  discountMinor: number
  lineTotalMinor: number
}

export interface PurchaseReceiptSummaryDTO {
  id: string
  receiptNumber: string
  receivedAt: string
  itemsCount: number
}

export interface PurchaseAllocationSummaryDTO {
  id: string
  paymentId: string
  amountMinor: number
  allocatedAt: string
}

export interface PurchaseDTO {
  id: string
  businessId: string
  branchId: string
  branchName?: string
  purchaseNumber: string
  supplierId: string
  supplierName?: string
  supplierSnapshot?: SupplierSnapshot
  supplierInvoiceNumber: string | null
  subtotalMinor: number
  discountMinor: number
  taxMinor: number
  totalAmountMinor: number
  paidAmountMinor: number
  remainingAmountMinor: number
  status: PurchaseStatus
  purchaseDateKey: string
  expectedDeliveryDate: string | null
  notes: string | null
  confirmedAt: string | null
  createdBy: string
  creatorName?: string
  createdAt: string
  updatedAt: string
  items?: PurchaseItemDTO[]
  receipts?: PurchaseReceiptSummaryDTO[]
  allocations?: PurchaseAllocationSummaryDTO[]
}

export interface CreatePurchaseItemInput {
  productId: string
  orderedQuantity: number
  unitCostMinor: number
  discountMinor?: number
}

export interface CreatePurchaseInput {
  branchId?: string
  supplierId: string
  supplierInvoiceNumber?: string | null
  expectedDeliveryDate?: string | null
  notes?: string | null
  items: CreatePurchaseItemInput[]
}

export interface UpdatePurchaseInput {
  supplierInvoiceNumber?: string | null
  expectedDeliveryDate?: string | null
  notes?: string | null
  items?: CreatePurchaseItemInput[]
}

export interface PurchaseFilterParams {
  branchId?: string
  supplierId?: string
  status?: PurchaseStatus | 'all'
  startDate?: string
  endDate?: string
  search?: string
  page: number
  limit: number
}

