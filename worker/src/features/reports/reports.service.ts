import type { Env } from '../../types/environment'
import { HttpError } from '../../lib/errors'
import { hasPermission, type MemberRole } from '../../auth/tenantContext'
import { ReportsRepository } from './reports.repository'
import type {
  CustomerReceivableItem,
  DashboardReportDTO,
  InventoryMovementItem,
  InventorySummaryDTO,
  InventoryValuationItem,
  LowStockProductItem,
  PaymentByMethodItem,
  PaymentsSummaryDTO,
  PurchasesSummaryDTO,
  PurchasesTrendPoint,
  SalesByCategoryItem,
  SalesByProductItem,
  SalesSummaryDTO,
  SalesTrendPoint,
  SupplierPayableItem,
} from './reports.types'
import {
  BUSINESS_TIMEZONE,
  buildCsvDocument,
  validateReportDateRange,
} from './reports.validation'

export class ReportsService {
  private readonly repository: ReportsRepository

  constructor(repository = new ReportsRepository()) {
    this.repository = repository
  }

  /**
   * Enforces that the user holds 'reports_view' permission.
   */
  private assertReportsPermission(role: MemberRole): void {
    if (!hasPermission(role, 'reports_view')) {
      throw HttpError.forbidden("Permission 'reports_view' required to access reporting and analytics")
    }
  }

  /**
   * Resolves authorized branch scope (fail closed when empty, multi-branch explicit list).
   */
  private resolveBranchScope(
    authorizedBranchIds: string[],
    requestedBranchId?: string | null
  ): { displayBranchId: string | null; branchIds: string[] } {
    if (requestedBranchId) {
      if (!authorizedBranchIds.includes(requestedBranchId)) {
        throw HttpError.forbidden(
          `Access denied: branch '${requestedBranchId}' is not in authorized branches`
        )
      }
      return { displayBranchId: requestedBranchId, branchIds: [requestedBranchId] }
    }

    // If restricted to a single branch, return that branch
    if (authorizedBranchIds.length === 1) {
      return { displayBranchId: authorizedBranchIds[0], branchIds: [authorizedBranchIds[0]] }
    }

    return { displayBranchId: null, branchIds: [...authorizedBranchIds] }
  }

  /**
   * Generates Executive Dashboard metrics.
   */
  async getDashboardReport(
    env: Env,
    businessId: string,
    role: MemberRole,
    authorizedBranchIds: string[],
    rawFromDate?: string | null,
    rawToDate?: string | null,
    requestedBranchId?: string | null
  ): Promise<DashboardReportDTO> {
    this.assertReportsPermission(role)
    const { fromDate, toDate } = validateReportDateRange(rawFromDate, rawToDate)
    const { displayBranchId, branchIds } = this.resolveBranchScope(
      authorizedBranchIds,
      requestedBranchId
    )

    const [sales, cogsMinor, collections, purchases, inventory, expensesMinor] = await Promise.all([
      this.repository.getDashboardSalesMetrics(env.DB, businessId, branchIds, fromDate, toDate),
      this.repository.getDashboardCogsMinor(env.DB, businessId, branchIds, fromDate, toDate),
      this.repository.getDashboardCollectionsMetrics(env.DB, businessId, branchIds, fromDate, toDate),
      this.repository.getDashboardPurchasesMetrics(env.DB, businessId, branchIds, fromDate, toDate),
      this.repository.getDashboardInventoryMetrics(env.DB, businessId, branchIds),
      this.repository.getDashboardExpensesMinor(env.DB, businessId, branchIds, fromDate, toDate),
    ])

    const grossProfitMinor = sales.netSalesMinor - cogsMinor
    const netProfitMinor = grossProfitMinor - expensesMinor

    return {
      businessDateRange: {
        fromDate,
        toDate,
        timezone: BUSINESS_TIMEZONE,
      },
      branchId: displayBranchId,
      sales,
      collections,
      purchases,
      inventory,
      financial: {
        cogs: {
          isAvailable: true,
          method: 'snapshot_unit_cost',
          totalCogsMinor: cogsMinor,
        },
        grossProfitMinor,
        expenses: {
          isAvailable: true,
          data: {
            totalExpensesMinor: expensesMinor,
          },
        },
        netProfit: {
          isAvailable: true,
          data: {
            netProfitMinor,
          },
        },
      },
    }
  }

  /**
   * Detailed Sales Summary.
   */
  async getSalesSummary(
    env: Env,
    businessId: string,
    role: MemberRole,
    authorizedBranchIds: string[],
    rawFromDate?: string | null,
    rawToDate?: string | null,
    requestedBranchId?: string | null
  ): Promise<SalesSummaryDTO> {
    this.assertReportsPermission(role)
    const { fromDate, toDate } = validateReportDateRange(rawFromDate, rawToDate)
    const { displayBranchId, branchIds } = this.resolveBranchScope(
      authorizedBranchIds,
      requestedBranchId
    )

    return this.repository.getSalesSummary(
      env.DB,
      businessId,
      branchIds,
      fromDate,
      toDate,
      displayBranchId
    )
  }

  /**
   * Sales over time (trends).
   */
  async getSalesTrends(
    env: Env,
    businessId: string,
    role: MemberRole,
    authorizedBranchIds: string[],
    rawFromDate?: string | null,
    rawToDate?: string | null,
    requestedBranchId?: string | null,
    interval: 'daily' | 'monthly' = 'daily'
  ): Promise<SalesTrendPoint[]> {
    this.assertReportsPermission(role)
    const { fromDate, toDate } = validateReportDateRange(rawFromDate, rawToDate)
    const { branchIds } = this.resolveBranchScope(authorizedBranchIds, requestedBranchId)

    return this.repository.getSalesTrends(
      env.DB,
      businessId,
      branchIds,
      fromDate,
      toDate,
      interval
    )
  }

  /**
   * Sales breakdown by product.
   */
  async getSalesByProduct(
    env: Env,
    businessId: string,
    role: MemberRole,
    authorizedBranchIds: string[],
    rawFromDate?: string | null,
    rawToDate?: string | null,
    requestedBranchId?: string | null,
    limit = 50,
    categoryId?: string
  ): Promise<SalesByProductItem[]> {
    this.assertReportsPermission(role)
    const { fromDate, toDate } = validateReportDateRange(rawFromDate, rawToDate)
    const { branchIds } = this.resolveBranchScope(authorizedBranchIds, requestedBranchId)

    return this.repository.getSalesByProduct(
      env.DB,
      businessId,
      branchIds,
      fromDate,
      toDate,
      Math.min(Math.max(limit, 1), 100),
      categoryId
    )
  }

  /**
   * Sales breakdown by category.
   */
  async getSalesByCategory(
    env: Env,
    businessId: string,
    role: MemberRole,
    authorizedBranchIds: string[],
    rawFromDate?: string | null,
    rawToDate?: string | null,
    requestedBranchId?: string | null
  ): Promise<SalesByCategoryItem[]> {
    this.assertReportsPermission(role)
    const { fromDate, toDate } = validateReportDateRange(rawFromDate, rawToDate)
    const { branchIds } = this.resolveBranchScope(authorizedBranchIds, requestedBranchId)

    return this.repository.getSalesByCategory(
      env.DB,
      businessId,
      branchIds,
      fromDate,
      toDate
    )
  }

  /**
   * Payments Summary.
   */
  async getPaymentsSummary(
    env: Env,
    businessId: string,
    role: MemberRole,
    authorizedBranchIds: string[],
    rawFromDate?: string | null,
    rawToDate?: string | null,
    requestedBranchId?: string | null
  ): Promise<PaymentsSummaryDTO> {
    this.assertReportsPermission(role)
    const { fromDate, toDate } = validateReportDateRange(rawFromDate, rawToDate)
    const { displayBranchId, branchIds } = this.resolveBranchScope(
      authorizedBranchIds,
      requestedBranchId
    )

    return this.repository.getPaymentsSummary(
      env.DB,
      businessId,
      branchIds,
      fromDate,
      toDate,
      displayBranchId
    )
  }

  /**
   * Payments grouped by method.
   */
  async getPaymentsByMethod(
    env: Env,
    businessId: string,
    role: MemberRole,
    authorizedBranchIds: string[],
    rawFromDate?: string | null,
    rawToDate?: string | null,
    requestedBranchId?: string | null
  ): Promise<PaymentByMethodItem[]> {
    this.assertReportsPermission(role)
    const { fromDate, toDate } = validateReportDateRange(rawFromDate, rawToDate)
    const { branchIds } = this.resolveBranchScope(authorizedBranchIds, requestedBranchId)

    return this.repository.getPaymentsByMethod(
      env.DB,
      businessId,
      branchIds,
      fromDate,
      toDate
    )
  }

  /**
   * Purchases Summary.
   */
  async getPurchasesSummary(
    env: Env,
    businessId: string,
    role: MemberRole,
    authorizedBranchIds: string[],
    rawFromDate?: string | null,
    rawToDate?: string | null,
    requestedBranchId?: string | null
  ): Promise<PurchasesSummaryDTO> {
    this.assertReportsPermission(role)
    const { fromDate, toDate } = validateReportDateRange(rawFromDate, rawToDate)
    const { displayBranchId, branchIds } = this.resolveBranchScope(
      authorizedBranchIds,
      requestedBranchId
    )

    return this.repository.getPurchasesSummary(
      env.DB,
      businessId,
      branchIds,
      fromDate,
      toDate,
      displayBranchId
    )
  }

  /**
   * Purchases trends.
   */
  async getPurchasesTrends(
    env: Env,
    businessId: string,
    role: MemberRole,
    authorizedBranchIds: string[],
    rawFromDate?: string | null,
    rawToDate?: string | null,
    requestedBranchId?: string | null,
    interval: 'daily' | 'monthly' = 'daily'
  ): Promise<PurchasesTrendPoint[]> {
    this.assertReportsPermission(role)
    const { fromDate, toDate } = validateReportDateRange(rawFromDate, rawToDate)
    const { branchIds } = this.resolveBranchScope(authorizedBranchIds, requestedBranchId)

    return this.repository.getPurchasesTrends(
      env.DB,
      businessId,
      branchIds,
      fromDate,
      toDate,
      interval
    )
  }

  /**
   * Supplier Payables balances.
   */
  async getSupplierPayables(
    env: Env,
    businessId: string,
    role: MemberRole,
    authorizedBranchIds: string[] = [],
    requestedBranchId?: string | null
  ): Promise<SupplierPayableItem[]> {
    this.assertReportsPermission(role)
    const { branchIds } = this.resolveBranchScope(authorizedBranchIds, requestedBranchId)
    return this.repository.getSupplierPayables(env.DB, businessId, branchIds)
  }

  /**
   * Inventory stock summary.
   */
  async getInventorySummary(
    env: Env,
    businessId: string,
    role: MemberRole,
    authorizedBranchIds: string[],
    requestedBranchId?: string | null
  ): Promise<InventorySummaryDTO> {
    this.assertReportsPermission(role)
    const { displayBranchId, branchIds } = this.resolveBranchScope(
      authorizedBranchIds,
      requestedBranchId
    )
    return this.repository.getInventorySummary(env.DB, businessId, branchIds, displayBranchId)
  }

  /**
   * Inventory stock movements.
   */
  async getInventoryMovements(
    env: Env,
    businessId: string,
    role: MemberRole,
    authorizedBranchIds: string[],
    rawFromDate?: string | null,
    rawToDate?: string | null,
    requestedBranchId?: string | null,
    productId?: string,
    type?: string,
    limit = 50,
    offset = 0
  ): Promise<{ items: InventoryMovementItem[]; total: number }> {
    this.assertReportsPermission(role)
    const { fromDate, toDate } = validateReportDateRange(rawFromDate, rawToDate)
    const { branchIds } = this.resolveBranchScope(authorizedBranchIds, requestedBranchId)

    return this.repository.getInventoryMovements(
      env.DB,
      businessId,
      branchIds,
      fromDate,
      toDate,
      productId,
      type,
      Math.min(Math.max(limit, 1), 100),
      Math.max(offset, 0)
    )
  }

  /**
   * Low stock products listing.
   */
  async getLowStockReport(
    env: Env,
    businessId: string,
    role: MemberRole,
    authorizedBranchIds: string[],
    requestedBranchId?: string | null,
    limit = 50,
    offset = 0
  ): Promise<{ items: LowStockProductItem[]; total: number }> {
    this.assertReportsPermission(role)
    const { branchIds } = this.resolveBranchScope(authorizedBranchIds, requestedBranchId)

    return this.repository.getLowStockProducts(
      env.DB,
      businessId,
      branchIds,
      Math.min(Math.max(limit, 1), 100),
      Math.max(offset, 0)
    )
  }

  /**
   * Inventory valuation detailed listing.
   */
  async getInventoryValuation(
    env: Env,
    businessId: string,
    role: MemberRole,
    authorizedBranchIds: string[],
    requestedBranchId?: string | null
  ): Promise<InventoryValuationItem[]> {
    this.assertReportsPermission(role)
    const { branchIds } = this.resolveBranchScope(authorizedBranchIds, requestedBranchId)

    return this.repository.getInventoryValuation(env.DB, businessId, branchIds)
  }

  /**
   * Customer receivables summary.
   */
  async getCustomerReceivables(
    env: Env,
    businessId: string,
    role: MemberRole,
    authorizedBranchIds: string[] = [],
    requestedBranchId?: string | null
  ): Promise<CustomerReceivableItem[]> {
    this.assertReportsPermission(role)
    const { branchIds } = this.resolveBranchScope(authorizedBranchIds, requestedBranchId)
    return this.repository.getCustomerReceivables(env.DB, businessId, branchIds)
  }

  /**
   * Exports authorized reports to sanitized CSV format.
   */
  async exportReportCsv(
    env: Env,
    businessId: string,
    role: MemberRole,
    authorizedBranchIds: string[],
    reportType: string,
    rawFromDate?: string | null,
    rawToDate?: string | null,
    requestedBranchId?: string | null
  ): Promise<{ csvContent: string; filename: string; rowCount: number }> {
    this.assertReportsPermission(role)
    const { fromDate, toDate } = validateReportDateRange(rawFromDate, rawToDate)
    const { branchIds } = this.resolveBranchScope(authorizedBranchIds, requestedBranchId)

    let headers: string[] = []
    let rows: (string | number | null | undefined)[][] = []
    const filename = `${reportType}-report-${fromDate}-to-${toDate}.csv`

    switch (reportType) {
      case 'sales': {
        headers = [
          'Date',
          'Sales Count',
          'Gross Sales (Rs)',
          'Discount (Rs)',
          'Net Sales (Rs)',
          'Tax (Rs)',
          'Total Amount (Rs)',
        ]
        const trends = await this.repository.getSalesTrends(
          env.DB,
          businessId,
          branchIds,
          fromDate,
          toDate,
          'daily'
        )
        rows = trends.map((t) => [
          t.dateKey,
          t.salesCount,
          (t.grossSalesMinor / 100).toFixed(2),
          (t.discountMinor / 100).toFixed(2),
          (t.netSalesMinor / 100).toFixed(2),
          (t.taxMinor / 100).toFixed(2),
          (t.totalAmountMinor / 100).toFixed(2),
        ])
        break
      }
      case 'products': {
        headers = [
          'Product Name',
          'SKU',
          'Category',
          'Quantity Sold',
          'Revenue (Rs)',
          'Cost (Rs)',
          'Estimated Margin (Rs)',
        ]
        const products = await this.repository.getSalesByProduct(
          env.DB,
          businessId,
          branchIds,
          fromDate,
          toDate,
          100
        )
        rows = products.map((p) => [
          p.productName,
          p.sku,
          p.categoryName,
          p.quantitySold,
          (p.totalRevenueMinor / 100).toFixed(2),
          (p.totalCostMinor / 100).toFixed(2),
          (p.estimatedMarginMinor / 100).toFixed(2),
        ])
        break
      }
      case 'payments': {
        headers = ['Payment Method', 'Transaction Count', 'Total Amount (Rs)', 'Share (%)']
        const methods = await this.repository.getPaymentsByMethod(
          env.DB,
          businessId,
          branchIds,
          fromDate,
          toDate
        )
        rows = methods.map((m) => [
          m.method,
          m.count,
          (m.totalAmountMinor / 100).toFixed(2),
          m.percentage,
        ])
        break
      }
      case 'inventory': {
        headers = [
          'Product Name',
          'SKU',
          'Quantity on Hand',
          'Unit Cost (Rs)',
          'Total Valuation (Rs)',
        ]
        const valuation = await this.repository.getInventoryValuation(
          env.DB,
          businessId,
          branchIds
        )
        rows = valuation.map((v) => [
          v.productName,
          v.sku,
          v.quantityOnHand,
          (v.unitCostMinor / 100).toFixed(2),
          (v.valuationMinor / 100).toFixed(2),
        ])
        break
      }
      case 'customers': {
        headers = ['Customer Name', 'Phone', 'Receivable Balance (Rs)', 'Unallocated Advance (Rs)']
        const customers = await this.repository.getCustomerReceivables(
          env.DB,
          businessId,
          branchIds
        )
        rows = customers.map((c) => [
          c.customerName,
          c.phone || '',
          (c.balanceMinor / 100).toFixed(2),
          (c.unallocatedAdvanceMinor / 100).toFixed(2),
        ])
        break
      }
      case 'suppliers': {
        headers = ['Supplier Name', 'Company', 'Phone', 'Payable Balance (Rs)', 'Unallocated Advance (Rs)']
        const suppliers = await this.repository.getSupplierPayables(
          env.DB,
          businessId,
          branchIds
        )
        rows = suppliers.map((s) => [
          s.supplierName,
          s.companyName || '',
          s.phone || '',
          (s.balanceMinor / 100).toFixed(2),
          (s.unallocatedAdvanceMinor / 100).toFixed(2),
        ])
        break
      }
      default:
        throw HttpError.badRequest(
          `Unsupported reportType '${reportType}'. Allowed types: sales, products, payments, inventory, customers, suppliers`
        )
    }

    const csvContent = buildCsvDocument(headers, rows)
    return {
      csvContent,
      filename,
      rowCount: rows.length,
    }
  }
}
