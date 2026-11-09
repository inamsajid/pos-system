export interface GoodsReceiptRow {
  id: string
  business_id: string
  branch_id: string
  receipt_number: string
  purchase_id: string
  supplier_id: string
  notes: string | null
  business_date_key: string
  received_by: string
  received_at: string
  created_at: string
  supplier_name?: string
  branch_name?: string
  receiver_name?: string
  purchase_number?: string
}

export interface GoodsReceiptItemRow {
  id: string
  receipt_id: string
  purchase_item_id: string
  product_id: string
  quantity_received: number
  unit_cost_minor: number
  product_name?: string
  sku?: string
  unit?: string
}

export interface GoodsReceiptItemDTO {
  id: string
  receiptId: string
  purchaseItemId: string
  productId: string
  productName: string
  sku: string
  unit: string
  quantityReceived: number
  unitCostMinor: number
  lineTotalMinor: number
}

export interface GoodsReceiptDTO {
  id: string
  businessId: string
  branchId: string
  branchName?: string
  receiptNumber: string
  purchaseId: string
  purchaseNumber?: string
  supplierId: string
  supplierName?: string
  notes: string | null
  businessDateKey: string
  receivedBy: string
  receivedByName?: string
  receivedAt: string
  createdAt: string
  items?: GoodsReceiptItemDTO[]
}

export interface CreateGoodsReceiptItemInput {
  purchaseItemId: string
  quantityReceived: number
}

export interface CreateGoodsReceiptInput {
  notes?: string | null
  items: CreateGoodsReceiptItemInput[]
}

export interface GoodsReceiptFilterParams {
  branchId?: string
  supplierId?: string
  purchaseId?: string
  startDate?: string
  endDate?: string
  page: number
  limit: number
}

