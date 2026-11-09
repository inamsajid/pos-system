import type {
  CustomerReceivableItem,
  DashboardCollectionsMetrics,
  DashboardInventoryMetrics,
  DashboardPurchasesMetrics,
  DashboardSalesMetrics,
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

export class ReportsRepository {
  /**
   * Aggregates sales metrics for the dashboard.
   * Completely avoids joining with payment tables to prevent multiplication.
   */
  async getDashboardSalesMetrics(
    d1: D1Database,
    businessId: string,
    branchId: string | null,
    fromDate: string,
    toDate: string
  ): Promise<DashboardSalesMetrics> {
    const conditions = [
      'business_id = ?',
      "status IN ('completed', 'partially_returned')",
      'business_date_key >= ?',
      'business_date_key <= ?',
    ]
    const params: unknown[] = [businessId, fromDate, toDate]

    if (branchId) {
      conditions.push('branch_id = ?')
      params.push(branchId)
    }

    const row = await d1
      .prepare(
        `SELECT
           COALESCE(SUM(total_amount_minor), 0) AS total_completed_sales_minor,
           COUNT(*) AS sales_count,
           COALESCE(SUM(subtotal_minor - discount_minor), 0) AS net_sales_minor,
           COALESCE(SUM(discount_minor), 0) AS discount_total_minor,
           COALESCE(SUM(tax_minor), 0) AS tax_total_minor
         FROM sales
         WHERE ${conditions.join(' AND ')}`
      )
      .bind(...params)
      .first<{
        total_completed_sales_minor: number
        sales_count: number
        net_sales_minor: number
        discount_total_minor: number
        tax_total_minor: number
      }>()

    const salesCount = row?.sales_count ?? 0
    const totalSalesMinor = row?.total_completed_sales_minor ?? 0
    const avgValue = salesCount > 0 ? Math.round(totalSalesMinor / salesCount) : 0

    return {
      totalCompletedSalesMinor: totalSalesMinor,
      salesCount,
      netSalesMinor: row?.net_sales_minor ?? 0,
      discountTotalMinor: row?.discount_total_minor ?? 0,
      taxTotalMinor: row?.tax_total_minor ?? 0,
      averageTransactionValueMinor: avgValue,
    }
  }

  /**
   * Aggregates COGS based on snapshot unit_cost_minor in sale_items.
   */
  async getDashboardCogsMinor(
    d1: D1Database,
    businessId: string,
    branchId: string | null,
    fromDate: string,
    toDate: string
  ): Promise<number> {
    const conditions = [
      's.business_id = ?',
      "s.status IN ('completed', 'partially_returned')",
      's.business_date_key >= ?',
      's.business_date_key <= ?',
    ]
    const params: unknown[] = [businessId, fromDate, toDate]

    if (branchId) {
      conditions.push('s.branch_id = ?')
      params.push(branchId)
    }

    const row = await d1
      .prepare(
        `SELECT
           COALESCE(SUM(CAST(ROUND(si.unit_cost_minor * si.quantity) AS INTEGER)), 0) AS total_cogs_minor
         FROM sale_items si
         JOIN sales s ON si.sale_id = s.id
         WHERE ${conditions.join(' AND ')}`
      )
      .bind(...params)
      .first<{ total_cogs_minor: number }>()

    return row?.total_cogs_minor ?? 0
  }

  /**
   * Aggregates collections metrics for the dashboard.
   */
  async getDashboardCollectionsMetrics(
    d1: D1Database,
    businessId: string,
    branchId: string | null,
    fromDate: string,
    toDate: string
  ): Promise<DashboardCollectionsMetrics> {
    const pConditions = ['p.business_id = ?', 'p.business_date_key >= ?', 'p.business_date_key <= ?']
    const pParams: unknown[] = [businessId, fromDate, toDate]

    if (branchId) {
      pConditions.push('p.branch_id = ?')
      pParams.push(branchId)
    }

    const totalsRow = await d1
      .prepare(
        `SELECT
           COALESCE(SUM(p.amount_minor), 0) AS total_collected_minor,
           COALESCE(SUM(p.unallocated_amount_minor), 0) AS unallocated_advance_minor
         FROM payments p
         WHERE ${pConditions.join(' AND ')}`
      )
      .bind(...pParams)
      .first<{ total_collected_minor: number; unallocated_advance_minor: number }>()

    const methodsRow = await d1
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN pm.method = 'cash' THEN pm.amount_minor ELSE 0 END), 0) AS cash_collected_minor,
           COALESCE(SUM(CASE WHEN pm.method IN ('card', 'bank_transfer', 'digital_wallet') THEN pm.amount_minor ELSE 0 END), 0) AS digital_collected_minor
         FROM payment_methods pm
         JOIN payments p ON pm.payment_id = p.id
         WHERE ${pConditions.join(' AND ')}`
      )
      .bind(...pParams)
      .first<{ cash_collected_minor: number; digital_collected_minor: number }>()

    // Outstanding customer receivables
    const sConditions = ['business_id = ?', "status = 'completed'", 'remaining_balance_minor > 0']
    const sParams: unknown[] = [businessId]
    if (branchId) {
      sConditions.push('branch_id = ?')
      sParams.push(branchId)
    }

    const receivablesRow = await d1
      .prepare(
        `SELECT COALESCE(SUM(remaining_balance_minor), 0) AS outstanding_receivables_minor
         FROM sales
         WHERE ${sConditions.join(' AND ')}`
      )
      .bind(...sParams)
      .first<{ outstanding_receivables_minor: number }>()

    return {
      totalCollectedMinor: totalsRow?.total_collected_minor ?? 0,
      cashCollectedMinor: methodsRow?.cash_collected_minor ?? 0,
      digitalCollectedMinor: methodsRow?.digital_collected_minor ?? 0,
      outstandingReceivablesMinor: receivablesRow?.outstanding_receivables_minor ?? 0,
      unallocatedCustomerAdvancesMinor: totalsRow?.unallocated_advance_minor ?? 0,
    }
  }

  /**
   * Aggregates procurement and payables metrics for the dashboard.
   */
  async getDashboardPurchasesMetrics(
    d1: D1Database,
    businessId: string,
    branchId: string | null,
    fromDate: string,
    toDate: string
  ): Promise<DashboardPurchasesMetrics> {
    const poConditions = [
      'business_id = ?',
      "status IN ('ordered', 'partially_received', 'received')",
      'purchase_date_key >= ?',
      'purchase_date_key <= ?',
    ]
    const poParams: unknown[] = [businessId, fromDate, toDate]
    if (branchId) {
      poConditions.push('branch_id = ?')
      poParams.push(branchId)
    }

    const poRow = await d1
      .prepare(
        `SELECT
           COALESCE(SUM(total_amount_minor), 0) AS total_purchases_minor,
           COUNT(*) AS purchase_count
         FROM purchases
         WHERE ${poConditions.join(' AND ')}`
      )
      .bind(...poParams)
      .first<{ total_purchases_minor: number; purchase_count: number }>()

    // Goods received value
    const grConditions = [
      'gr.business_id = ?',
      'gr.business_date_key >= ?',
      'gr.business_date_key <= ?',
    ]
    const grParams: unknown[] = [businessId, fromDate, toDate]
    if (branchId) {
      grConditions.push('gr.branch_id = ?')
      grParams.push(branchId)
    }

    const grRow = await d1
      .prepare(
        `SELECT
           COALESCE(SUM(CAST(ROUND(gri.quantity_received * gri.unit_cost_minor) AS INTEGER)), 0) AS goods_received_value_minor
         FROM goods_receipt_items gri
         JOIN goods_receipts gr ON gri.receipt_id = gr.id
         WHERE ${grConditions.join(' AND ')}`
      )
      .bind(...grParams)
      .first<{ goods_received_value_minor: number }>()

    // Supplier payments & advances
    const spConditions = [
      'sp.business_id = ?',
      'sp.business_date_key >= ?',
      'sp.business_date_key <= ?',
    ]
    const spParams: unknown[] = [businessId, fromDate, toDate]
    if (branchId) {
      spConditions.push('sp.branch_id = ?')
      spParams.push(branchId)
    }

    const spRow = await d1
      .prepare(
        `SELECT
           COALESCE(SUM(sp.amount_minor), 0) AS supplier_payments_minor,
           COALESCE(SUM(sp.unallocated_amount_minor), 0) AS unallocated_supplier_advances_minor
         FROM supplier_payments sp
         WHERE ${spConditions.join(' AND ')}`
      )
      .bind(...spParams)
      .first<{ supplier_payments_minor: number; unallocated_supplier_advances_minor: number }>()

    // Outstanding supplier payables
    const payablesConditions = [
      'business_id = ?',
      "status IN ('ordered', 'partially_received', 'received')",
      'total_amount_minor > paid_amount_minor',
    ]
    const payablesParams: unknown[] = [businessId]
    if (branchId) {
      payablesConditions.push('branch_id = ?')
      payablesParams.push(branchId)
    }

    const payablesRow = await d1
      .prepare(
        `SELECT
           COALESCE(SUM(total_amount_minor - paid_amount_minor), 0) AS outstanding_payables_minor
         FROM purchases
         WHERE ${payablesConditions.join(' AND ')}`
      )
      .bind(...payablesParams)
      .first<{ outstanding_payables_minor: number }>()

    return {
      totalPurchasesMinor: poRow?.total_purchases_minor ?? 0,
      purchaseCount: poRow?.purchase_count ?? 0,
      goodsReceivedValueMinor: grRow?.goods_received_value_minor ?? 0,
      outstandingPayablesMinor: payablesRow?.outstanding_payables_minor ?? 0,
      supplierPaymentsMinor: spRow?.supplier_payments_minor ?? 0,
      unallocatedSupplierAdvancesMinor: spRow?.unallocated_supplier_advances_minor ?? 0,
    }
  }

  /**
   * Aggregates inventory metrics for the dashboard.
   */
  async getDashboardInventoryMetrics(
    d1: D1Database,
    businessId: string,
    branchId: string | null
  ): Promise<DashboardInventoryMetrics> {
    const joinParams: unknown[] = []
    let joinClause = 'LEFT JOIN inventory_balances ib ON p.id = ib.product_id'
    if (branchId) {
      joinClause += ' AND ib.branch_id = ?'
      joinParams.push(branchId)
    }

    const conditions = ['p.business_id = ?', "p.status = 'active'"]
    const whereParams: unknown[] = [businessId]
    const allParams = [...joinParams, ...whereParams]

    const row = await d1
      .prepare(
        `SELECT
           COUNT(DISTINCT p.id) AS total_tracked_products,
           COUNT(DISTINCT CASE WHEN COALESCE(ib.quantity_on_hand, 0) <= p.low_stock_threshold AND COALESCE(ib.quantity_on_hand, 0) > 0 THEN p.id END) AS low_stock_products_count,
           COUNT(DISTINCT CASE WHEN COALESCE(ib.quantity_on_hand, 0) <= 0 THEN p.id END) AS out_of_stock_products_count,
           COALESCE(SUM(ib.quantity_on_hand), 0) AS total_quantity_on_hand
         FROM products p
         ${joinClause}
         WHERE ${conditions.join(' AND ')}`
      )
      .bind(...allParams)
      .first<{
        total_tracked_products: number
        low_stock_products_count: number
        out_of_stock_products_count: number
        total_quantity_on_hand: number
      }>()

    return {
      totalTrackedProducts: row?.total_tracked_products ?? 0,
      lowStockProductsCount: row?.low_stock_products_count ?? 0,
      outOfStockProductsCount: row?.out_of_stock_products_count ?? 0,
      totalQuantityOnHand: row?.total_quantity_on_hand ?? 0,
    }
  }

  /**
   * Generates detailed Sales Summary report.
   */
  async getSalesSummary(
    d1: D1Database,
    businessId: string,
    branchId: string | null,
    fromDate: string,
    toDate: string
  ): Promise<SalesSummaryDTO> {
    const conditions = ['business_id = ?', 'business_date_key >= ?', 'business_date_key <= ?']
    const params: unknown[] = [businessId, fromDate, toDate]

    if (branchId) {
      conditions.push('branch_id = ?')
      params.push(branchId)
    }

    const row = await d1
      .prepare(
        `SELECT
           COUNT(CASE WHEN status IN ('completed', 'partially_returned') THEN 1 END) AS completed_count,
           COUNT(CASE WHEN status = 'voided' THEN 1 END) AS voided_count,
           COALESCE(SUM(CASE WHEN status IN ('completed', 'partially_returned') THEN subtotal_minor ELSE 0 END), 0) AS gross_sales_minor,
           COALESCE(SUM(CASE WHEN status IN ('completed', 'partially_returned') THEN discount_minor ELSE 0 END), 0) AS discount_minor,
           COALESCE(SUM(CASE WHEN status IN ('completed', 'partially_returned') THEN (subtotal_minor - discount_minor) ELSE 0 END), 0) AS net_sales_minor,
           COALESCE(SUM(CASE WHEN status IN ('completed', 'partially_returned') THEN tax_minor ELSE 0 END), 0) AS tax_minor,
           COALESCE(SUM(CASE WHEN status IN ('completed', 'partially_returned') THEN total_amount_minor ELSE 0 END), 0) AS total_amount_minor,
           COALESCE(SUM(CASE WHEN status IN ('completed', 'partially_returned') THEN amount_paid_minor ELSE 0 END), 0) AS amount_paid_minor,
           COALESCE(SUM(CASE WHEN status IN ('completed', 'partially_returned') THEN remaining_balance_minor ELSE 0 END), 0) AS remaining_balance_minor
         FROM sales
         WHERE ${conditions.join(' AND ')}`
      )
      .bind(...params)
      .first<{
        completed_count: number
        voided_count: number
        gross_sales_minor: number
        discount_minor: number
        net_sales_minor: number
        tax_minor: number
        total_amount_minor: number
        amount_paid_minor: number
        remaining_balance_minor: number
      }>()

    const completed = row?.completed_count ?? 0
    const totalAmount = row?.total_amount_minor ?? 0
    const avgSale = completed > 0 ? Math.round(totalAmount / completed) : 0

    return {
      fromDate,
      toDate,
      branchId,
      completedSalesCount: completed,
      voidedSalesCount: row?.voided_count ?? 0,
      grossSalesMinor: row?.gross_sales_minor ?? 0,
      discountTotalMinor: row?.discount_minor ?? 0,
      netSalesMinor: row?.net_sales_minor ?? 0,
      taxTotalMinor: row?.tax_minor ?? 0,
      totalAmountMinor: totalAmount,
      amountPaidMinor: row?.amount_paid_minor ?? 0,
      remainingBalanceMinor: row?.remaining_balance_minor ?? 0,
      averageSaleValueMinor: avgSale,
    }
  }

  /**
   * Generates Sales Trends grouped by day or month.
   */
  async getSalesTrends(
    d1: D1Database,
    businessId: string,
    branchId: string | null,
    fromDate: string,
    toDate: string,
    interval: 'daily' | 'monthly' = 'daily'
  ): Promise<SalesTrendPoint[]> {
    const conditions = [
      'business_id = ?',
      "status IN ('completed', 'partially_returned')",
      'business_date_key >= ?',
      'business_date_key <= ?',
    ]
    const params: unknown[] = [businessId, fromDate, toDate]

    if (branchId) {
      conditions.push('branch_id = ?')
      params.push(branchId)
    }

    const groupExpression =
      interval === 'monthly'
        ? 'SUBSTR(business_date_key, 1, 7)'
        : 'business_date_key'

    const rows = await d1
      .prepare(
        `SELECT
           ${groupExpression} AS date_key,
           COUNT(*) AS sales_count,
           COALESCE(SUM(subtotal_minor), 0) AS gross_sales_minor,
           COALESCE(SUM(discount_minor), 0) AS discount_minor,
           COALESCE(SUM(subtotal_minor - discount_minor), 0) AS net_sales_minor,
           COALESCE(SUM(tax_minor), 0) AS tax_minor,
           COALESCE(SUM(total_amount_minor), 0) AS total_amount_minor
         FROM sales
         WHERE ${conditions.join(' AND ')}
         GROUP BY ${groupExpression}
         ORDER BY date_key ASC`
      )
      .bind(...params)
      .all<{
        date_key: string
        sales_count: number
        gross_sales_minor: number
        discount_minor: number
        net_sales_minor: number
        tax_minor: number
        total_amount_minor: number
      }>()

    return (rows.results || []).map((r) => ({
      dateKey: r.date_key,
      salesCount: r.sales_count,
      grossSalesMinor: r.gross_sales_minor,
      discountMinor: r.discount_minor,
      netSalesMinor: r.net_sales_minor,
      taxMinor: r.tax_minor,
      totalAmountMinor: r.total_amount_minor,
    }))
  }

  /**
   * Top selling products by revenue.
   */
  async getSalesByProduct(
    d1: D1Database,
    businessId: string,
    branchId: string | null,
    fromDate: string,
    toDate: string,
    limit = 50,
    categoryId?: string
  ): Promise<SalesByProductItem[]> {
    const conditions = [
      's.business_id = ?',
      "s.status IN ('completed', 'partially_returned')",
      's.business_date_key >= ?',
      's.business_date_key <= ?',
    ]
    const params: unknown[] = [businessId, fromDate, toDate]

    if (branchId) {
      conditions.push('s.branch_id = ?')
      params.push(branchId)
    }

    if (categoryId) {
      conditions.push('p.category_id = ?')
      params.push(categoryId)
    }

    params.push(limit)

    const rows = await d1
      .prepare(
        `SELECT
           si.product_id,
           si.product_name,
           si.sku,
           COALESCE(c.name, 'Uncategorized') AS category_name,
           COALESCE(SUM(si.quantity), 0) AS quantity_sold,
           COALESCE(SUM(si.line_total_minor), 0) AS total_revenue_minor,
           COALESCE(SUM(CAST(ROUND(si.unit_cost_minor * si.quantity) AS INTEGER)), 0) AS total_cost_minor
         FROM sale_items si
         JOIN sales s ON si.sale_id = s.id
         LEFT JOIN products p ON si.product_id = p.id
         LEFT JOIN categories c ON p.category_id = c.id
         WHERE ${conditions.join(' AND ')}
         GROUP BY si.product_id, si.product_name, si.sku, c.name
         ORDER BY total_revenue_minor DESC
         LIMIT ?`
      )
      .bind(...params)
      .all<{
        product_id: string
        product_name: string
        sku: string
        category_name: string
        quantity_sold: number
        total_revenue_minor: number
        total_cost_minor: number
      }>()

    return (rows.results || []).map((r) => ({
      productId: r.product_id,
      productName: r.product_name,
      sku: r.sku,
      categoryName: r.category_name,
      quantitySold: r.quantity_sold,
      totalRevenueMinor: r.total_revenue_minor,
      totalCostMinor: r.total_cost_minor,
      estimatedMarginMinor: r.total_revenue_minor - r.total_cost_minor,
    }))
  }

  /**
   * Category breakdown by revenue.
   */
  async getSalesByCategory(
    d1: D1Database,
    businessId: string,
    branchId: string | null,
    fromDate: string,
    toDate: string
  ): Promise<SalesByCategoryItem[]> {
    const conditions = [
      's.business_id = ?',
      "s.status IN ('completed', 'partially_returned')",
      's.business_date_key >= ?',
      's.business_date_key <= ?',
    ]
    const params: unknown[] = [businessId, fromDate, toDate]

    if (branchId) {
      conditions.push('s.branch_id = ?')
      params.push(branchId)
    }

    const rows = await d1
      .prepare(
        `SELECT
           COALESCE(c.id, 'uncategorized') AS category_id,
           COALESCE(c.name, 'Uncategorized') AS category_name,
           COUNT(DISTINCT si.product_id) AS distinct_products_sold,
           COALESCE(SUM(si.quantity), 0) AS quantity_sold,
           COALESCE(SUM(si.line_total_minor), 0) AS total_revenue_minor
         FROM sale_items si
         JOIN sales s ON si.sale_id = s.id
         LEFT JOIN products p ON si.product_id = p.id
         LEFT JOIN categories c ON p.category_id = c.id
         WHERE ${conditions.join(' AND ')}
         GROUP BY c.id, c.name
         ORDER BY total_revenue_minor DESC`
      )
      .bind(...params)
      .all<{
        category_id: string
        category_name: string
        distinct_products_sold: number
        quantity_sold: number
        total_revenue_minor: number
      }>()

    return (rows.results || []).map((r) => ({
      categoryId: r.category_id,
      categoryName: r.category_name,
      distinctProductsSold: r.distinct_products_sold,
      quantitySold: r.quantity_sold,
      totalRevenueMinor: r.total_revenue_minor,
    }))
  }

  /**
   * Payments collections summary.
   */
  async getPaymentsSummary(
    d1: D1Database,
    businessId: string,
    branchId: string | null,
    fromDate: string,
    toDate: string
  ): Promise<PaymentsSummaryDTO> {
    const conditions = ['p.business_id = ?', 'p.business_date_key >= ?', 'p.business_date_key <= ?']
    const params: unknown[] = [businessId, fromDate, toDate]

    if (branchId) {
      conditions.push('p.branch_id = ?')
      params.push(branchId)
    }

    const pRow = await d1
      .prepare(
        `SELECT
           COALESCE(SUM(p.amount_minor), 0) AS total_collected_minor,
           COUNT(*) AS total_payments_count,
           COALESCE(SUM(p.unallocated_amount_minor), 0) AS unallocated_advance_minor
         FROM payments p
         WHERE ${conditions.join(' AND ')}`
      )
      .bind(...params)
      .first<{
        total_collected_minor: number
        total_payments_count: number
        unallocated_advance_minor: number
      }>()

    const mRow = await d1
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN pm.method = 'cash' THEN pm.amount_minor ELSE 0 END), 0) AS cash_collected_minor,
           COALESCE(SUM(CASE WHEN pm.method IN ('card', 'bank_transfer', 'digital_wallet') THEN pm.amount_minor ELSE 0 END), 0) AS digital_collected_minor
         FROM payment_methods pm
         JOIN payments p ON pm.payment_id = p.id
         WHERE ${conditions.join(' AND ')}`
      )
      .bind(...params)
      .first<{ cash_collected_minor: number; digital_collected_minor: number }>()

    const totalCollected = pRow?.total_collected_minor ?? 0
    const unallocated = pRow?.unallocated_advance_minor ?? 0

    return {
      fromDate,
      toDate,
      branchId,
      totalCollectedMinor: totalCollected,
      totalPaymentsCount: pRow?.total_payments_count ?? 0,
      cashCollectedMinor: mRow?.cash_collected_minor ?? 0,
      digitalCollectedMinor: mRow?.digital_collected_minor ?? 0,
      allocatedMinor: totalCollected - unallocated,
      unallocatedAdvanceMinor: unallocated,
    }
  }

  /**
   * Breakdown of payments grouped by payment method.
   */
  async getPaymentsByMethod(
    d1: D1Database,
    businessId: string,
    branchId: string | null,
    fromDate: string,
    toDate: string
  ): Promise<PaymentByMethodItem[]> {
    const conditions = ['p.business_id = ?', 'p.business_date_key >= ?', 'p.business_date_key <= ?']
    const params: unknown[] = [businessId, fromDate, toDate]

    if (branchId) {
      conditions.push('p.branch_id = ?')
      params.push(branchId)
    }

    const rows = await d1
      .prepare(
        `SELECT
           pm.method,
           COUNT(*) AS count,
           COALESCE(SUM(pm.amount_minor), 0) AS total_amount_minor
         FROM payment_methods pm
         JOIN payments p ON pm.payment_id = p.id
         WHERE ${conditions.join(' AND ')}
         GROUP BY pm.method
         ORDER BY total_amount_minor DESC`
      )
      .bind(...params)
      .all<{ method: string; count: number; total_amount_minor: number }>()

    const totalAll = (rows.results || []).reduce((acc, r) => acc + r.total_amount_minor, 0)

    return (rows.results || []).map((r) => ({
      method: r.method,
      count: r.count,
      totalAmountMinor: r.total_amount_minor,
      percentage: totalAll > 0 ? Number(((r.total_amount_minor / totalAll) * 100).toFixed(2)) : 0,
    }))
  }

  /**
   * Purchases summary report.
   */
  async getPurchasesSummary(
    d1: D1Database,
    businessId: string,
    branchId: string | null,
    fromDate: string,
    toDate: string
  ): Promise<PurchasesSummaryDTO> {
    const conditions = ['business_id = ?', 'purchase_date_key >= ?', 'purchase_date_key <= ?']
    const params: unknown[] = [businessId, fromDate, toDate]

    if (branchId) {
      conditions.push('branch_id = ?')
      params.push(branchId)
    }

    const row = await d1
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total_amount_minor ELSE 0 END), 0) AS total_purchases_minor,
           COUNT(*) AS total_count,
           COUNT(CASE WHEN status = 'ordered' THEN 1 END) AS ordered_count,
           COUNT(CASE WHEN status IN ('partially_received', 'received') THEN 1 END) AS received_count,
           COUNT(CASE WHEN status = 'cancelled' THEN 1 END) AS cancelled_count,
           COALESCE(SUM(CASE WHEN status != 'cancelled' THEN paid_amount_minor ELSE 0 END), 0) AS paid_amount_minor,
           COALESCE(SUM(CASE WHEN status != 'cancelled' THEN (total_amount_minor - paid_amount_minor) ELSE 0 END), 0) AS outstanding_payable_minor
         FROM purchases
         WHERE ${conditions.join(' AND ')}`
      )
      .bind(...params)
      .first<{
        total_purchases_minor: number
        total_count: number
        ordered_count: number
        received_count: number
        cancelled_count: number
        paid_amount_minor: number
        outstanding_payable_minor: number
      }>()

    return {
      fromDate,
      toDate,
      branchId,
      totalPurchasesMinor: row?.total_purchases_minor ?? 0,
      totalPurchasesCount: row?.total_count ?? 0,
      orderedPurchasesCount: row?.ordered_count ?? 0,
      receivedPurchasesCount: row?.received_count ?? 0,
      cancelledPurchasesCount: row?.cancelled_count ?? 0,
      paidAmountMinor: row?.paid_amount_minor ?? 0,
      outstandingPayableMinor: row?.outstanding_payable_minor ?? 0,
    }
  }

  /**
   * Purchases trends grouped by day or month.
   */
  async getPurchasesTrends(
    d1: D1Database,
    businessId: string,
    branchId: string | null,
    fromDate: string,
    toDate: string,
    interval: 'daily' | 'monthly' = 'daily'
  ): Promise<PurchasesTrendPoint[]> {
    const conditions = [
      'business_id = ?',
      "status != 'cancelled'",
      'purchase_date_key >= ?',
      'purchase_date_key <= ?',
    ]
    const params: unknown[] = [businessId, fromDate, toDate]

    if (branchId) {
      conditions.push('branch_id = ?')
      params.push(branchId)
    }

    const groupExpression =
      interval === 'monthly'
        ? 'SUBSTR(purchase_date_key, 1, 7)'
        : 'purchase_date_key'

    const rows = await d1
      .prepare(
        `SELECT
           ${groupExpression} AS date_key,
           COUNT(*) AS purchase_count,
           COALESCE(SUM(total_amount_minor), 0) AS total_amount_minor,
           COALESCE(SUM(paid_amount_minor), 0) AS paid_amount_minor
         FROM purchases
         WHERE ${conditions.join(' AND ')}
         GROUP BY ${groupExpression}
         ORDER BY date_key ASC`
      )
      .bind(...params)
      .all<{
        date_key: string
        purchase_count: number
        total_amount_minor: number
        paid_amount_minor: number
      }>()

    return (rows.results || []).map((r) => ({
      dateKey: r.date_key,
      purchaseCount: r.purchase_count,
      totalAmountMinor: r.total_amount_minor,
      paidAmountMinor: r.paid_amount_minor,
    }))
  }

  /**
   * Supplier payables summary from purchases & payments.
   */
  async getSupplierPayables(
    d1: D1Database,
    businessId: string
  ): Promise<SupplierPayableItem[]> {
    const rows = await d1
      .prepare(
        `SELECT
           s.id AS supplier_id,
           s.name AS supplier_name,
           s.company_name,
           s.phone,
           COALESCE(po.total_unpaid, 0) AS balance_minor,
           COALESCE(sp.total_advance, 0) AS unallocated_advance_minor
         FROM suppliers s
         LEFT JOIN (
           SELECT supplier_id, SUM(total_amount_minor - paid_amount_minor) AS total_unpaid
           FROM purchases
           WHERE business_id = ? AND status != 'cancelled' AND total_amount_minor > paid_amount_minor
           GROUP BY supplier_id
         ) po ON s.id = po.supplier_id
         LEFT JOIN (
           SELECT supplier_id, SUM(unallocated_amount_minor) AS total_advance
           FROM supplier_payments
           WHERE business_id = ? AND unallocated_amount_minor > 0
           GROUP BY supplier_id
         ) sp ON s.id = sp.supplier_id
         WHERE s.business_id = ?
           AND (COALESCE(po.total_unpaid, 0) > 0 OR COALESCE(sp.total_advance, 0) > 0)
         ORDER BY balance_minor DESC`
      )
      .bind(businessId, businessId, businessId)
      .all<{
        supplier_id: string
        supplier_name: string
        company_name: string | null
        phone: string | null
        balance_minor: number
        unallocated_advance_minor: number
      }>()

    return (rows.results || []).map((r) => ({
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      companyName: r.company_name,
      phone: r.phone,
      balanceMinor: r.balance_minor,
      unallocatedAdvanceMinor: r.unallocated_advance_minor,
    }))
  }

  /**
   * Inventory summary report.
   */
  async getInventorySummary(
    d1: D1Database,
    businessId: string,
    branchId: string | null
  ): Promise<InventorySummaryDTO> {
    const joinParams: unknown[] = []
    let joinClause = 'LEFT JOIN inventory_balances ib ON p.id = ib.product_id'
    if (branchId) {
      joinClause += ' AND ib.branch_id = ?'
      joinParams.push(branchId)
    }

    const conditions = ['p.business_id = ?', "p.status = 'active'"]
    const whereParams: unknown[] = [businessId]
    const allParams = [...joinParams, ...whereParams]

    const row = await d1
      .prepare(
        `SELECT
           COUNT(DISTINCT p.id) AS total_tracked_products,
           COUNT(DISTINCT CASE WHEN COALESCE(ib.quantity_on_hand, 0) > p.low_stock_threshold THEN p.id END) AS in_stock_count,
           COUNT(DISTINCT CASE WHEN COALESCE(ib.quantity_on_hand, 0) <= p.low_stock_threshold AND COALESCE(ib.quantity_on_hand, 0) > 0 THEN p.id END) AS low_stock_count,
           COUNT(DISTINCT CASE WHEN COALESCE(ib.quantity_on_hand, 0) <= 0 THEN p.id END) AS out_of_stock_count,
           COALESCE(SUM(ib.quantity_on_hand), 0) AS total_quantity_on_hand,
           COALESCE(SUM(CAST(ROUND(CASE WHEN ib.quantity_on_hand > 0 THEN ib.quantity_on_hand * p.purchase_price_minor ELSE 0 END) AS INTEGER)), 0) AS total_valuation_minor
         FROM products p
         ${joinClause}
         WHERE ${conditions.join(' AND ')}`
      )
      .bind(...allParams)
      .first<{
        total_tracked_products: number
        in_stock_count: number
        low_stock_count: number
        out_of_stock_count: number
        total_quantity_on_hand: number
        total_valuation_minor: number
      }>()

    return {
      branchId,
      totalTrackedProducts: row?.total_tracked_products ?? 0,
      inStockCount: row?.in_stock_count ?? 0,
      lowStockCount: row?.low_stock_count ?? 0,
      outOfStockCount: row?.out_of_stock_count ?? 0,
      totalQuantityOnHand: row?.total_quantity_on_hand ?? 0,
      totalValuationMinor: row?.total_valuation_minor ?? 0,
      costMethod: 'perpetual_cost_baseline',
    }
  }

  /**
   * Inventory movements report.
   */
  async getInventoryMovements(
    d1: D1Database,
    businessId: string,
    branchId: string | null,
    fromDate: string,
    toDate: string,
    productId?: string,
    type?: string,
    limit = 50,
    offset = 0
  ): Promise<{ items: InventoryMovementItem[]; total: number }> {
    const conditions = [
      'sm.business_id = ?',
      'sm.business_date_key >= ?',
      'sm.business_date_key <= ?',
    ]
    const params: unknown[] = [businessId, fromDate, toDate]

    if (branchId) {
      conditions.push('sm.branch_id = ?')
      params.push(branchId)
    }

    if (productId) {
      conditions.push('sm.product_id = ?')
      params.push(productId)
    }

    if (type) {
      conditions.push('sm.type = ?')
      params.push(type)
    }

    const whereClause = conditions.join(' AND ')

    const countRow = await d1
      .prepare(`SELECT COUNT(*) AS total FROM stock_movements sm WHERE ${whereClause}`)
      .bind(...params)
      .first<{ total: number }>()

    const total = countRow?.total ?? 0

    const rows = await d1
      .prepare(
        `SELECT
           sm.id,
           sm.movement_number,
           sm.product_id,
           p.name AS product_name,
           p.sku,
           sm.type,
           sm.quantity_change,
           sm.previous_quantity,
           sm.new_quantity,
           sm.unit_cost_minor,
           sm.reference_type,
           sm.reference_number,
           sm.business_date_key,
           sm.created_at
         FROM stock_movements sm
         JOIN products p ON sm.product_id = p.id
         WHERE ${whereClause}
         ORDER BY sm.created_at DESC
         LIMIT ? OFFSET ?`
      )
      .bind(...params, limit, offset)
      .all<{
        id: string
        movement_number: string
        product_id: string
        product_name: string
        sku: string
        type: string
        quantity_change: number
        previous_quantity: number
        new_quantity: number
        unit_cost_minor: number
        reference_type: string | null
        reference_number: string | null
        business_date_key: string
        created_at: string
      }>()

    const items = (rows.results || []).map((r) => ({
      id: r.id,
      movementNumber: r.movement_number,
      productId: r.product_id,
      productName: r.product_name,
      sku: r.sku,
      type: r.type,
      quantityChange: r.quantity_change,
      previousQuantity: r.previous_quantity,
      newQuantity: r.new_quantity,
      unitCostMinor: r.unit_cost_minor,
      referenceType: r.reference_type,
      referenceNumber: r.reference_number,
      businessDateKey: r.business_date_key,
      createdAt: r.created_at,
    }))

    return { items, total }
  }

  /**
   * Low stock products report.
   */
  async getLowStockProducts(
    d1: D1Database,
    businessId: string,
    branchId: string | null,
    limit = 50,
    offset = 0
  ): Promise<{ items: LowStockProductItem[]; total: number }> {
    const joinParams: unknown[] = []
    let joinClause = 'LEFT JOIN inventory_balances ib ON p.id = ib.product_id'
    if (branchId) {
      joinClause += ' AND ib.branch_id = ?'
      joinParams.push(branchId)
    }

    const conditions = [
      'p.business_id = ?',
      "p.status = 'active'",
      'COALESCE(ib.quantity_on_hand, 0) <= p.low_stock_threshold',
    ]
    const whereParams: unknown[] = [businessId]
    const allParams = [...joinParams, ...whereParams]

    const whereClause = conditions.join(' AND ')

    const countRow = await d1
      .prepare(
        `SELECT COUNT(*) AS total
         FROM products p
         ${joinClause}
         WHERE ${whereClause}`
      )
      .bind(...allParams)
      .first<{ total: number }>()

    const total = countRow?.total ?? 0

    const rows = await d1
      .prepare(
        `SELECT
           p.id AS product_id,
           p.name AS product_name,
           p.sku,
           COALESCE(c.name, 'Uncategorized') AS category_name,
           COALESCE(ib.branch_id, '') AS branch_id,
           COALESCE(ib.quantity_on_hand, 0) AS quantity_on_hand,
           p.low_stock_threshold,
           p.unit,
           p.purchase_price_minor
         FROM products p
         ${joinClause}
         LEFT JOIN categories c ON p.category_id = c.id
         WHERE ${whereClause}
         ORDER BY quantity_on_hand ASC
         LIMIT ? OFFSET ?`
      )
      .bind(...allParams, limit, offset)
      .all<{
        product_id: string
        product_name: string
        sku: string
        category_name: string
        branch_id: string
        quantity_on_hand: number
        low_stock_threshold: number
        unit: string
        purchase_price_minor: number
      }>()

    const items = (rows.results || []).map((r) => ({
      productId: r.product_id,
      productName: r.product_name,
      sku: r.sku,
      categoryName: r.category_name,
      branchId: r.branch_id,
      quantityOnHand: r.quantity_on_hand,
      lowStockThreshold: r.low_stock_threshold,
      unit: r.unit,
      purchasePriceMinor: r.purchase_price_minor,
    }))

    return { items, total }
  }

  /**
   * Inventory valuation detailed listing.
   */
  async getInventoryValuation(
    d1: D1Database,
    businessId: string,
    branchId: string | null
  ): Promise<InventoryValuationItem[]> {
    const joinParams: unknown[] = []
    let joinClause = 'LEFT JOIN inventory_balances ib ON p.id = ib.product_id'
    if (branchId) {
      joinClause += ' AND ib.branch_id = ?'
      joinParams.push(branchId)
    }

    const conditions = ['p.business_id = ?', "p.status = 'active'"]
    const whereParams: unknown[] = [businessId]
    const allParams = [...joinParams, ...whereParams]

    const rows = await d1
      .prepare(
        `SELECT
           p.id AS product_id,
           p.name AS product_name,
           p.sku,
           COALESCE(ib.quantity_on_hand, 0) AS quantity_on_hand,
           p.purchase_price_minor AS unit_cost_minor,
           CAST(ROUND(CASE WHEN COALESCE(ib.quantity_on_hand, 0) > 0 THEN ib.quantity_on_hand * p.purchase_price_minor ELSE 0 END) AS INTEGER) AS valuation_minor
         FROM products p
         ${joinClause}
         WHERE ${conditions.join(' AND ')}
         ORDER BY valuation_minor DESC`
      )
      .bind(...allParams)
      .all<{
        product_id: string
        product_name: string
        sku: string
        quantity_on_hand: number
        unit_cost_minor: number
        valuation_minor: number
      }>()

    return (rows.results || []).map((r) => ({
      productId: r.product_id,
      productName: r.product_name,
      sku: r.sku,
      quantityOnHand: r.quantity_on_hand,
      unitCostMinor: r.unit_cost_minor,
      valuationMinor: r.valuation_minor,
    }))
  }

  /**
   * Customer receivables summary from unpaid sales and unallocated advances.
   */
  async getCustomerReceivables(
    d1: D1Database,
    businessId: string
  ): Promise<CustomerReceivableItem[]> {
    const rows = await d1
      .prepare(
        `SELECT
           c.id AS customer_id,
           c.name AS customer_name,
           c.phone,
           COALESCE(s.total_unpaid, 0) AS balance_minor,
           COALESCE(p.total_advance, 0) AS unallocated_advance_minor
         FROM customers c
         LEFT JOIN (
           SELECT customer_id, SUM(remaining_balance_minor) AS total_unpaid
           FROM sales
           WHERE business_id = ? AND status = 'completed' AND remaining_balance_minor > 0
           GROUP BY customer_id
         ) s ON c.id = s.customer_id
         LEFT JOIN (
           SELECT customer_id, SUM(unallocated_amount_minor) AS total_advance
           FROM payments
           WHERE business_id = ? AND unallocated_amount_minor > 0
           GROUP BY customer_id
         ) p ON c.id = p.customer_id
         WHERE c.business_id = ?
           AND (COALESCE(s.total_unpaid, 0) > 0 OR COALESCE(p.total_advance, 0) > 0)
         ORDER BY balance_minor DESC`
      )
      .bind(businessId, businessId, businessId)
      .all<{
        customer_id: string
        customer_name: string
        phone: string | null
        balance_minor: number
        unallocated_advance_minor: number
      }>()

    return (rows.results || []).map((r) => ({
      customerId: r.customer_id,
      customerName: r.customer_name,
      phone: r.phone,
      balanceMinor: r.balance_minor,
      unallocatedAdvanceMinor: r.unallocated_advance_minor,
    }))
  }
}
