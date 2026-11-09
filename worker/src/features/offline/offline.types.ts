/**
 * Step 13.6 & 13.7 Offline POS, Stock Allocations & Synchronization Types
 */

export interface ProductAllocationRequest {
  productId: string
  allocatedQuantity: number
}

export interface CreateOfflineAuthorizationInput {
  deviceId: string
  branchId?: string
  durationHours?: number
  maxTransactions?: number
  maxTotalAmountMinor?: number
  products: ProductAllocationRequest[]
}

export interface ProductAllocationDTO {
  allocationId: string
  productId: string
  sku: string
  name: string
  unit: string
  sellingPriceMinor: number
  allocatedQuantity: number
  consumedQuantity: number
  remainingQuantity: number
}

export interface OfflineAuthorizationDTO {
  authorizationId: string
  businessId: string
  branchId: string
  userId: string
  deviceId: string
  catalogVersion: number
  pricingVersion: number
  maxTransactions: number
  maxTotalAmountMinor: number
  allowDiscounts: boolean
  status: 'active' | 'revoked' | 'expired' | 'completed'
  issuedAt: string
  expiresAt: string
  allowedPaymentMethods: string[]
  productAllocations: ProductAllocationDTO[]
  signature: string
}

export interface OfflineSaleItemInput {
  productId: string
  allocationId: string
  quantity: number
  unitPriceMinor: number
  subtotalMinor?: number
  lineTotalMinor?: number
}

export interface CommitOfflineSaleInput {
  authorizationId: string
  deviceId: string
  provisionalSaleId: string
  provisionalReceiptNumber: string
  items: OfflineSaleItemInput[]
  cashTenderedMinor: number
  offlineCreatedAt: string
  terminalId?: string
}

export interface CommitOfflineSaleResponse {
  isCached?: boolean
  saleId: string
  saleNumber: string
  invoiceId: string
  invoiceNumber: string
  totalAmountMinor: number
  cashTenderedMinor: number
  changeReturnedMinor: number
  provisionalReceiptNumber: string
  provisionalSaleId: string
  status: 'completed'
  createdAt: string
}

export interface AllocationReconciliationResponse {
  allocationId: string
  productId: string
  allocatedQuantity: number
  consumedQuantity: number
  releasedQuantity: number
  status: 'reconciled'
  reconciledAt: string
}

