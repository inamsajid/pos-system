/**
 * Domain types for Offline POS Cash Checkout (Step 13.6 & Step 13.7).
 */

export interface OfflineCartItem {
  productId: string
  name: string
  sku: string
  unit: string
  quantity: number
  unitPriceMinor: number
  subtotalMinor: number
  lineTotalMinor: number
  allocationId: string
}

export interface RecordOfflineSaleInput {
  userId: string
  businessId: string
  branchId: string
  deviceId: string
  authorizationId: string
  items: OfflineCartItem[]
  cashTenderedMinor: number
  idempotencyKey?: string
  terminalId?: string
}

export interface OfflineCheckoutResult {
  provisionalSaleId: string
  provisionalReceiptNumber: string
  outboxCommandId: string
  idempotencyKey: string
  totalAmountMinor: number
  cashTenderedMinor: number
  changeReturnedMinor: number
  itemsCount: number
  status: 'provisional'
  createdAt: string
  warning: string
}

export interface OfflineReceiptData {
  provisionalReceiptNumber: string
  notice: string // 'PENDING SYNCHRONIZATION — NOT AN OFFICIAL TAX INVOICE'
  createdAt: string
  deviceId: string
  cashierName?: string
  items: Array<{
    name: string
    quantity: number
    unit: string
    unitPriceMinor: number
    lineTotalMinor: number
  }>
  totalAmountMinor: number
  cashTenderedMinor: number
  changeReturnedMinor: number
}

