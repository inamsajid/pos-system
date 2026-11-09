export interface UnavailableMetric {
  isAvailable: false
  reason: string
}

export interface AvailableMetric<T> {
  isAvailable: true
  data: T
}

export interface ReportDateFilter {
  fromDate: string
  toDate: string
  branchId?: string
}

export interface DashboardSalesMetrics {
  totalCompletedSalesMinor: number
  salesCount: number
  netSalesMinor: number
  discountTotalMinor: number
  taxTotalMinor: number
  averageTransactionValueMinor: number
}

export interface DashboardCollectionsMetrics {
  totalCollectedMinor: number
  cashCollectedMinor: number
  digitalCollectedMinor: number
  outstandingReceivablesMinor: number
  unallocatedCustomerAdvancesMinor: number
}

export interface DashboardPurchasesMetrics {
  totalPurchasesMinor: number
  purchaseCount: number
  goodsReceivedValueMinor: number
  outstandingPayablesMinor: number
  supplierPaymentsMinor: number
  unallocatedSupplierAdvancesMinor: number
}

export interface DashboardInventoryMetrics {
  totalTrackedProducts: number
  lowStockProductsCount: number
  outOfStockProductsCount: number
  totalQuantityOnHand: number
}

export interface DashboardFinancialMetrics {
  cogs: {
    isAvailable: true
    method: string
    totalCogsMinor: number
  }
  grossProfitMinor: number
  expenses: UnavailableMetric
  netProfit: UnavailableMetric
}

export interface DashboardReportDTO {
  businessDateRange: {
    fromDate: string
    toDate: string
    timezone: string
  }
  branchId: string | null
  sales: DashboardSalesMetrics
  collections: DashboardCollectionsMetrics
  purchases: DashboardPurchasesMetrics
  inventory: DashboardInventoryMetrics
  financial: DashboardFinancialMetrics
}

export interface SalesSummaryDTO {
  fromDate: string
  toDate: string
  branchId: string | null
  completedSalesCount: number
  voidedSalesCount: number
  grossSalesMinor: number
  discountTotalMinor: number
  netSalesMinor: number
  taxTotalMinor: number
  totalAmountMinor: number
  amountPaidMinor: number
  remainingBalanceMinor: number
  averageSaleValueMinor: number
}

export interface SalesTrendPoint {
  dateKey: string
  salesCount: number
  grossSalesMinor: number
  discountMinor: number
  netSalesMinor: number
  taxMinor: number
  totalAmountMinor: number
}

export interface SalesByProductItem {
  productId: string
  productName: string
  sku: string
  categoryName: string
  quantitySold: number
  totalRevenueMinor: number
  totalCostMinor: number
  estimatedMarginMinor: number
}

export interface SalesByCategoryItem {
  categoryId: string
  categoryName: string
  distinctProductsSold: number
  quantitySold: number
  totalRevenueMinor: number
}

export interface PaymentsSummaryDTO {
  fromDate: string
  toDate: string
  branchId: string | null
  totalCollectedMinor: number
  totalPaymentsCount: number
  cashCollectedMinor: number
  digitalCollectedMinor: number
  allocatedMinor: number
  unallocatedAdvanceMinor: number
}

export interface PaymentByMethodItem {
  method: string
  count: number
  totalAmountMinor: number
  percentage: number
}

export interface PurchasesSummaryDTO {
  fromDate: string
  toDate: string
  branchId: string | null
  totalPurchasesMinor: number
  totalPurchasesCount: number
  orderedPurchasesCount: number
  receivedPurchasesCount: number
  cancelledPurchasesCount: number
  paidAmountMinor: number
  outstandingPayableMinor: number
}

export interface PurchasesTrendPoint {
  dateKey: string
  purchaseCount: number
  totalAmountMinor: number
  paidAmountMinor: number
}

export interface SupplierPayableItem {
  supplierId: string
  supplierName: string
  companyName: string | null
  phone: string | null
  balanceMinor: number
  unallocatedAdvanceMinor: number
}

export interface CustomerReceivableItem {
  customerId: string
  customerName: string
  phone: string | null
  balanceMinor: number
  unallocatedAdvanceMinor: number
}

export interface InventorySummaryDTO {
  branchId: string | null
  totalTrackedProducts: number
  inStockCount: number
  lowStockCount: number
  outOfStockCount: number
  totalQuantityOnHand: number
  totalValuationMinor: number
  costMethod: string
}

export interface InventoryMovementItem {
  id: string
  movementNumber: string
  productId: string
  productName: string
  sku: string
  type: string
  quantityChange: number
  previousQuantity: number
  newQuantity: number
  unitCostMinor: number
  referenceType: string | null
  referenceNumber: string | null
  businessDateKey: string
  createdAt: string
}

export interface LowStockProductItem {
  productId: string
  productName: string
  sku: string
  categoryName: string
  branchId: string
  quantityOnHand: number
  lowStockThreshold: number
  unit: string
  purchasePriceMinor: number
}

export interface InventoryValuationItem {
  productId: string
  productName: string
  sku: string
  quantityOnHand: number
  unitCostMinor: number
  valuationMinor: number
}

