import type { ProductUnit } from '../../features/products/types/product.types'
import type { CustomerType, CustomerStatus } from '../../features/customers/types/customer.types'
import type { SupplierType, SupplierStatus } from '../../features/suppliers/types/supplier.types'
import type { CheckoutMethod } from '../../features/pos/types/checkout.types'
import type { StockMovementType } from '../../features/inventory/types/inventory.types'
import type { PurchaseStatus } from '../../features/purchases/types/purchase.types'
import type { SaleStatus } from '../../domain/contracts/models'

export interface ProductDTO {
  id: string
  businessId: string
  sku: string
  barcode?: string | null
  name: string
  description?: string | null
  categoryId?: string | null
  categoryName?: string | null
  imageUrl?: string | null
  unit: ProductUnit
  purchasePriceMinor: number // paise
  sellingPriceMinor: number // paise
  stockQuantity: number
  lowStockThreshold: number
  trackInventory: boolean
  status: 'active' | 'archived'
  version?: number
  createdAt: string
  updatedAt: string
}

export interface CreateProductRequest {
  sku: string
  barcode?: string | null
  name: string
  description?: string | null
  categoryId?: string | null
  imageUrl?: string | null
  unit: ProductUnit
  purchasePriceMinor: number
  sellingPriceMinor: number
  lowStockThreshold?: number
  trackInventory?: boolean
}

export interface UpdateProductRequest {
  sku?: string
  barcode?: string | null
  name?: string
  description?: string | null
  categoryId?: string | null
  imageUrl?: string | null
  unit?: ProductUnit
  purchasePriceMinor?: number
  sellingPriceMinor?: number
  lowStockThreshold?: number
  trackInventory?: boolean
  status?: 'active' | 'archived'
}

export interface CategoryDTO {
  id: string
  businessId: string
  name: string
  slug: string
  description?: string | null
  parentId?: string | null
  displayOrder: number
  status: 'active' | 'archived'
  productCount: number
  activeProductCount: number
  totalStockQuantity: number
  version?: number
  createdAt: string
  updatedAt: string
}

export interface CreateCategoryRequest {
  name: string
  slug?: string
  description?: string | null
  parentId?: string | null
  displayOrder?: number
}

export interface UpdateCategoryRequest {
  name?: string
  slug?: string
  description?: string | null
  parentId?: string | null
  displayOrder?: number
  status?: 'active' | 'archived'
}

export interface ProductListMeta {
  page: number
  limit: number
  totalCount: number
  totalPages: number
  hasNextPage: boolean
}

export interface CustomerDTO {
  id: string
  businessId: string
  customerCode: string
  name: string
  type: CustomerType
  companyName?: string | null
  phone?: string | null
  email?: string | null
  taxNumber?: string | null
  address?: string | null
  city?: string | null
  openingBalanceMinor: number
  creditLimitMinor: number
  status: CustomerStatus
  isWalkIn: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateCustomerRequest {
  customerCode?: string
  name: string
  type: CustomerType
  companyName?: string
  phone?: string
  email?: string
  taxNumber?: string
  address?: string
  city?: string
  openingBalanceMinor?: number
  creditLimitMinor?: number
}

export interface SupplierDTO {
  id: string
  businessId: string
  supplierCode: string
  name: string
  type: SupplierType
  companyName?: string | null
  contactPerson?: string | null
  phone?: string | null
  alternatePhone?: string | null
  email?: string | null
  taxNumber?: string | null
  address?: string | null
  city?: string | null
  openingPayableMinor: number
  status: SupplierStatus
  createdAt: string
  updatedAt: string
}

export interface CreateSupplierRequest {
  supplierCode?: string
  name: string
  type: SupplierType
  companyName?: string
  contactPerson?: string
  phone?: string
  email?: string
  taxNumber?: string
  address?: string
  city?: string
  openingPayableMinor?: number
}

export interface CreateSaleItemRequest {
  productId: string
  quantity: number
  unitPriceMinor: number
  discountMinor?: number
  taxMinor?: number
}

export interface CreateSalePaymentRequest {
  method: CheckoutMethod
  amountMinor: number
  reference?: string
}

export interface CreateSaleRequest {
  customerId: string
  terminalId?: string
  items: CreateSaleItemRequest[]
  payments: CreateSalePaymentRequest[]
  subtotalMinor: number
  discountType?: 'fixed' | 'percent'
  discountValue?: number
  discountMinor?: number
  taxMinor?: number
  totalAmountMinor: number
  amountPaidMinor: number
  notes?: string
}

export interface SaleItemDTO {
  id: string
  saleId: string
  productId: string
  sku: string
  productName: string
  unit: ProductUnit
  unitPriceMinor: number
  unitCostMinor: number
  cogsEstimated: boolean
  quantity: number
  subtotalMinor: number
  discountMinor: number
  taxMinor: number
  lineTotalMinor: number
  returnedQuantity: number
}

export interface SaleDTO {
  id: string
  businessId: string
  branchId: string
  saleNumber: string
  receiptNumber: string
  invoiceNumber: string
  customerId: string
  customerSnapshot: {
    name: string
    customerCode?: string
    phone?: string
  }
  terminalId: string
  cashierId: string
  cashierName: string
  items: SaleItemDTO[]
  subtotalMinor: number
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
}

export interface PaymentAllocationDTO {
  id: string
  invoiceId: string
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
  customerSnapshot: {
    name: string
    customerCode?: string
  }
  amountMinor: number
  unallocatedAmountMinor: number
  source: 'pos_checkout' | 'manual' | 'online'
  allocations: PaymentAllocationDTO[]
  notes?: string
  businessDateKey: string
  receivedBy: string
  receivedAt: string
  createdAt: string
}

export interface PurchaseDTO {
  id: string
  businessId: string
  branchId: string
  purchaseNumber: string
  supplierId: string
  supplierSnapshot: {
    name: string
    supplierCode: string
  }
  supplierInvoiceNumber?: string | null
  subtotalMinor: number
  discountMinor: number
  taxMinor: number
  totalAmountMinor: number
  paidAmountMinor: number
  status: PurchaseStatus
  purchaseDateKey: string
  expectedDeliveryDate?: string | null
  createdAt: string
  updatedAt: string
}

export interface StockMovementDTO {
  id: string
  businessId: string
  branchId: string
  movementNumber: string
  productId: string
  type: StockMovementType | 'return_restock' | 'return_damaged' | 'return_discard'
  quantityChange: number
  previousQuantity: number
  newQuantity: number
  unitCostMinor: number
  referenceType?: string | null
  referenceId?: string | null
  referenceNumber?: string | null
  businessDateKey: string
  createdAt: string
  createdBy?: string | null
}

