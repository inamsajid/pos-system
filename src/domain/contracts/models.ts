import type { ProductUnit } from '../../features/products/types/product.types'
import type { CustomerType, CustomerStatus } from '../../features/customers/types/customer.types'
import type { SupplierType, SupplierStatus } from '../../features/suppliers/types/supplier.types'
import type { CheckoutMethod } from '../../features/pos/types/checkout.types'
import type { StockMovementType, StockReferenceType } from '../../features/inventory/types/inventory.types'
import type { PurchaseStatus } from '../../features/purchases/types/purchase.types'

/**
 * Monetary representation in integer minor units (paise).
 * 1 PKR = 100 paise.
 */
export interface CanonicalMoney {
  amountMinor: number
  currency: 'PKR'
}

export interface CanonicalProduct {
  id: string
  sku: string
  barcode?: string
  name: string
  description?: string
  categoryId: string
  unit: ProductUnit
  purchasePriceMinor: number // Current moving weighted average cost in paise
  sellingPriceMinor: number
  stockQuantity: number
  lowStockThreshold: number
  status: 'active' | 'archived'
  trackInventory: boolean
  createdAt: string
  updatedAt: string
}

export interface CanonicalCustomer {
  id: string
  customerCode: string
  name: string
  phone?: string
  email?: string
  type: CustomerType
  companyName?: string
  taxNumber?: string
  address?: string
  city?: string
  openingBalanceMinor: number
  creditLimitMinor: number
  status: CustomerStatus
  isWalkIn: boolean
  createdAt: string
  updatedAt: string
}

export interface CanonicalSupplier {
  id: string
  supplierCode: string
  name: string
  type: SupplierType
  companyName?: string
  contactPerson?: string
  phone?: string
  alternatePhone?: string
  email?: string
  taxNumber?: string
  address?: string
  city?: string
  country?: string
  openingPayableMinor: number
  status: SupplierStatus
  createdAt: string
  updatedAt: string
}

export interface CanonicalSaleItem {
  id: string
  saleId: string
  productId: string
  sku: string
  productName: string
  unit: ProductUnit
  unitPriceMinor: number
  unitCostMinor: number // Locked-in snapshot COGS at checkout
  cogsEstimated?: boolean
  quantity: number
  subtotalMinor: number
  discountMinor: number
  taxMinor: number
  lineTotalMinor: number
  returnedQuantity: number
}

export type SaleStatus = 'draft' | 'completed' | 'voided' | 'partially_returned' | 'returned'

export interface CanonicalSale {
  id: string
  saleNumber: string
  receiptNumber: string
  invoiceNumber: string
  customerId: string
  customerSnapshot: {
    name: string
    customerCode?: string
    phone?: string
    address?: string
  }
  terminalId: string
  cashierId: string
  cashierName: string
  items: CanonicalSaleItem[]
  subtotalMinor: number
  discountMinor: number
  taxMinor: number
  totalAmountMinor: number
  amountPaidMinor: number
  remainingBalanceMinor: number
  changeReturnedMinor: number
  status: SaleStatus
  businessDateKey: string // Asia/Karachi YYYY-MM-DD
  createdAt: string
  updatedAt: string
}

export interface CanonicalInvoice {
  id: string
  invoiceNumber: string
  saleId: string
  customerId: string
  businessDateKey: string
  totalAmountMinor: number
  paidAmountMinor: number
  remainingAmountMinor: number
  paymentStatus: 'paid' | 'partial' | 'unpaid'
  status: 'active' | 'voided'
  createdAt: string
  updatedAt: string
}

export interface CanonicalPaymentAllocation {
  id: string
  invoiceId: string
  invoiceNumber: string
  allocatedMinor: number
}

export interface CanonicalCustomerPayment {
  id: string
  receiptNumber: string
  customerId: string
  amountMinor: number
  paymentMethod: CheckoutMethod
  allocations: CanonicalPaymentAllocation[]
  unallocatedMinor: number
  businessDateKey: string
  receivedAt: string
  receivedBy: string
  notes?: string
  createdAt: string
}

export interface CanonicalPurchaseItem {
  id: string
  purchaseId: string
  productId: string
  orderedQuantity: number
  receivedQuantity: number
  unitCostMinor: number
  discountMinor: number
  lineTotalMinor: number
}

export interface CanonicalPurchase {
  id: string
  purchaseNumber: string
  supplierId: string
  supplierInvoiceNumber?: string
  items: CanonicalPurchaseItem[]
  subtotalMinor: number
  discountMinor: number
  taxMinor: number
  totalAmountMinor: number
  paidAmountMinor: number
  status: PurchaseStatus
  purchaseDateKey: string
  expectedDeliveryDate?: string
  createdAt: string
  updatedAt: string
}

export interface CanonicalStockMovement {
  id: string
  movementNumber: string
  productId: string
  type: StockMovementType | 'return_restock' | 'return_damaged' | 'return_discard'
  quantityChange: number
  previousQuantity: number
  newQuantity: number
  unitCostMinor: number
  referenceType?: StockReferenceType | 'return'
  referenceId?: string
  referenceNumber?: string
  reason?: string
  businessDateKey: string
  createdAt: string
  createdBy?: string
}

export interface CanonicalCustomerLedgerEntry {
  id: string
  customerId: string
  type: 'opening' | 'invoice' | 'payment' | 'credit_note' | 'void'
  referenceId: string
  referenceNumber: string
  debitMinor: number
  creditMinor: number
  balanceMinor: number
  businessDateKey: string
  createdAt: string
}

export interface CanonicalSupplierLedgerEntry {
  id: string
  supplierId: string
  type: 'opening' | 'bill' | 'payment' | 'debit_note'
  referenceId: string
  referenceNumber: string
  debitMinor: number
  creditMinor: number
  balanceMinor: number
  businessDateKey: string
  createdAt: string
}

export interface CanonicalSaleReturnItem {
  id: string
  returnId: string
  saleItemId: string
  productId: string
  quantity: number
  unitRefundPriceMinor: number
  lineRefundMinor: number
  stockDisposition: 'restock' | 'damaged' | 'discard'
}

export interface CanonicalSaleReturn {
  id: string
  returnNumber: string
  saleId: string
  invoiceNumber: string
  customerId: string
  items: CanonicalSaleReturnItem[]
  totalRefundMinor: number
  refundMethod: 'cash' | 'credit_note' | 'card_reversal'
  businessDateKey: string
  authorizedBy: string
  reason: string
  createdAt: string
}

