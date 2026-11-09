/**
 * Standard TanStack Query Key Factory for Northstar POS.
 * Ensures consistent cache scoping, hierarchical invalidation, and type safety.
 */

export const queryKeys = {
  auth: {
    all: ['auth'] as const,
    me: () => [...queryKeys.auth.all, 'me'] as const,
  },
  products: {
    all: ['products'] as const,
    lists: () => [...queryKeys.products.all, 'list'] as const,
    list: (filters: Record<string, unknown> = {}) => [...queryKeys.products.lists(), filters] as const,
    details: () => [...queryKeys.products.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.products.details(), id] as const,
  },
  categories: {
    all: ['categories'] as const,
    list: () => [...queryKeys.categories.all, 'list'] as const,
  },
  customers: {
    all: ['customers'] as const,
    lists: () => [...queryKeys.customers.all, 'list'] as const,
    list: (filters: Record<string, unknown> = {}) => [...queryKeys.customers.lists(), filters] as const,
    details: () => [...queryKeys.customers.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.customers.details(), id] as const,
    ledger: (id: string, filters: Record<string, unknown> = {}) =>
      [...queryKeys.customers.detail(id), 'ledger', filters] as const,
    balances: () => [...queryKeys.customers.all, 'balances'] as const,
  },
  suppliers: {
    all: ['suppliers'] as const,
    lists: () => [...queryKeys.suppliers.all, 'list'] as const,
    list: (filters: Record<string, unknown> = {}) => [...queryKeys.suppliers.lists(), filters] as const,
    details: () => [...queryKeys.suppliers.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.suppliers.details(), id] as const,
    ledger: (id: string, filters: Record<string, unknown> = {}) =>
      [...queryKeys.suppliers.detail(id), 'ledger', filters] as const,
    balances: () => [...queryKeys.suppliers.all, 'balances'] as const,
  },
  sales: {
    all: ['sales'] as const,
    lists: () => [...queryKeys.sales.all, 'list'] as const,
    list: (filters: Record<string, unknown> = {}) => [...queryKeys.sales.lists(), filters] as const,
    details: () => [...queryKeys.sales.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.sales.details(), id] as const,
  },
  invoices: {
    all: ['invoices'] as const,
    lists: () => [...queryKeys.invoices.all, 'list'] as const,
    list: (filters: Record<string, unknown> = {}) => [...queryKeys.invoices.lists(), filters] as const,
    details: () => [...queryKeys.invoices.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.invoices.details(), id] as const,
  },
  payments: {
    all: ['payments'] as const,
    lists: () => [...queryKeys.payments.all, 'list'] as const,
    list: (filters: Record<string, unknown> = {}) => [...queryKeys.payments.lists(), filters] as const,
    details: () => [...queryKeys.payments.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.payments.details(), id] as const,
  },
  purchases: {
    all: ['purchases'] as const,
    lists: () => [...queryKeys.purchases.all, 'list'] as const,
    list: (filters: Record<string, unknown> = {}) => [...queryKeys.purchases.lists(), filters] as const,
    details: () => [...queryKeys.purchases.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.purchases.details(), id] as const,
  },
  goodsReceipts: {
    all: ['goodsReceipts'] as const,
    lists: () => [...queryKeys.goodsReceipts.all, 'list'] as const,
    list: (filters: Record<string, unknown> = {}) => [...queryKeys.goodsReceipts.lists(), filters] as const,
  },
  supplierPayments: {
    all: ['supplierPayments'] as const,
    lists: () => [...queryKeys.supplierPayments.all, 'list'] as const,
    list: (filters: Record<string, unknown> = {}) => [...queryKeys.supplierPayments.lists(), filters] as const,
  },
  inventory: {
    all: ['inventory'] as const,
    balances: (branchId?: string) => [...queryKeys.inventory.all, 'balances', branchId ?? 'all'] as const,
    movements: (filters: Record<string, unknown> = {}) =>
      [...queryKeys.inventory.all, 'movements', filters] as const,
    counts: () => [...queryKeys.inventory.all, 'counts'] as const,
  },
  reports: {
    all: ['reports'] as const,
    dashboard: (filters: Record<string, unknown> = {}) =>
      [...queryKeys.reports.all, 'dashboard', filters] as const,
    sales: (filters: Record<string, unknown> = {}) => [...queryKeys.reports.all, 'sales', filters] as const,
    products: (filters: Record<string, unknown> = {}) => [...queryKeys.reports.all, 'products', filters] as const,
    customerBalances: () => [...queryKeys.reports.all, 'customerBalances'] as const,
    supplierBalances: () => [...queryKeys.reports.all, 'supplierBalances'] as const,
    profit: (filters: Record<string, unknown> = {}) => [...queryKeys.reports.all, 'profit', filters] as const,
  },
}
