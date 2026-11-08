import type { ProductUnit } from '../../products/types/product.types'

export type PurchaseStatus = 'draft' | 'ordered' | 'partially_received' | 'received' | 'cancelled'
export interface PurchaseItem {
  id: string
  productId: string
  productSnapshot: { name: string; sku: string; unit: ProductUnit; categoryId: string }
  orderedQuantity: number
  receivedQuantity: number
  unitCost: number
  discountAmount: number
  lineTotal: number
}
export interface Purchase {
  id: string
  purchaseNumber: string
  supplierId: string
  supplierSnapshot: { name: string; supplierCode: string; companyName?: string }
  supplierInvoiceNumber?: string
  items: PurchaseItem[]
  subtotal: number
  discountAmount: number
  taxAmount: number
  totalAmount: number
  status: PurchaseStatus
  purchaseDate: string
  expectedDeliveryDate?: string
  notes?: string
  createdAt: string
  updatedAt: string
  confirmedAt?: string
}
export interface PurchaseItemDraft { productId: string; orderedQuantity: number; unitCost: number; discountAmount?: number }
export interface PurchaseDraft { supplierId: string; supplierInvoiceNumber?: string; items: PurchaseItemDraft[]; discountAmount?: number; taxAmount?: number; purchaseDate: string; expectedDeliveryDate?: string; notes?: string }
export interface GoodsReceiptItem { purchaseItemId: string; productId: string; productSnapshot: { name: string; sku: string; unit: ProductUnit }; quantityReceived: number }
export interface GoodsReceipt { id: string; requestId: string; receiptNumber: string; purchaseId: string; supplierId: string; supplierSnapshot: Purchase['supplierSnapshot']; items: GoodsReceiptItem[]; receivedAt: string; receivedBy: string; notes?: string }
