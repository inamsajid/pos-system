import type { SupplierSnapshot } from '../purchases/purchases.types'

export type SupplierPaymentMethod = 'cash' | 'bank_transfer' | 'card' | 'other'

export interface SupplierPaymentRow {
  id: string
  business_id: string
  branch_id: string
  receipt_number: string
  supplier_id: string
  supplier_snapshot_json: string
  amount_minor: number
  unallocated_amount_minor: number
  method: SupplierPaymentMethod
  reference: string | null
  notes: string | null
  business_date_key: string
  paid_by: string
  paid_at: string
  created_at: string
  supplier_name?: string
  branch_name?: string
  payer_name?: string
}

export interface SupplierPaymentAllocationRow {
  id: string
  business_id: string
  payment_id: string
  purchase_id: string
  purchase_number: string
  amount_minor: number
  allocated_at: string
}

export interface SupplierPaymentAllocationDTO {
  id: string
  paymentId: string
  purchaseId: string
  purchaseNumber: string
  amountMinor: number
  allocatedAt: string
}

export interface SupplierPaymentDTO {
  id: string
  businessId: string
  branchId: string
  branchName?: string
  receiptNumber: string
  supplierId: string
  supplierName?: string
  supplierSnapshot?: SupplierSnapshot
  amountMinor: number
  unallocatedAmountMinor: number
  method: SupplierPaymentMethod
  reference: string | null
  notes: string | null
  businessDateKey: string
  paidBy: string
  paidByName?: string
  paidAt: string
  createdAt: string
  allocations?: SupplierPaymentAllocationDTO[]
}

export interface SupplierPaymentAllocationInput {
  purchaseId: string
  amountMinor: number
}

export interface CreateSupplierPaymentInput {
  branchId?: string
  supplierId: string
  amountMinor: number
  method: SupplierPaymentMethod
  reference?: string | null
  notes?: string | null
  allocations?: SupplierPaymentAllocationInput[]
}

export interface AllocateSupplierAdvanceInput {
  allocations: SupplierPaymentAllocationInput[]
}

export interface SupplierPaymentFilterParams {
  branchId?: string
  supplierId?: string
  startDate?: string
  endDate?: string
  page: number
  limit: number
}

