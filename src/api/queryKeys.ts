import { getApiContext } from '../lib/api-client'

/**
 * Standard TanStack Query Key Factory for Northstar POS.
 * Every cached domain key is scoped by (userId, businessId, branchId) to
 * guarantee strict multi-tenant & cross-user isolation alongside clean
 * prefix invalidation via `.all`.
 */

export interface QueryScope {
  userId?: string | null
  businessId?: string | null
  branchId?: string | null
}

export function getDefaultQueryScope(): [string, string, string] {
  const ctx = getApiContext()
  return [
    ctx.userId || 'anon',
    ctx.businessId || 'no-biz',
    ctx.branchId || 'all-branches',
  ]
}

export function normalizeQueryScope(scope?: QueryScope): [string, string, string] {
  if (!scope) return getDefaultQueryScope()
  const fallback = getApiContext()
  return [
    scope.userId ?? fallback.userId ?? 'anon',
    scope.businessId ?? fallback.businessId ?? 'no-biz',
    scope.branchId ?? fallback.branchId ?? 'all-branches',
  ]
}

export const queryKeys = {
  auth: {
    all: ['auth'] as const,
    me: () => [...queryKeys.auth.all, 'me'] as const,
  },
  products: {
    all: ['products'] as const,
    lists: (scope?: QueryScope) =>
      [...queryKeys.products.all, ...normalizeQueryScope(scope), 'list'] as const,
    list: (filters: Record<string, unknown> = {}, scope?: QueryScope) =>
      [...queryKeys.products.lists(scope), filters] as const,
    details: (scope?: QueryScope) =>
      [...queryKeys.products.all, ...normalizeQueryScope(scope), 'detail'] as const,
    detail: (id: string, scope?: QueryScope) =>
      [...queryKeys.products.details(scope), id] as const,
  },
  categories: {
    all: ['categories'] as const,
    list: (scope?: QueryScope) =>
      [...queryKeys.categories.all, ...normalizeQueryScope(scope), 'list'] as const,
  },
  customers: {
    all: ['customers'] as const,
    lists: (scope?: QueryScope) =>
      [...queryKeys.customers.all, ...normalizeQueryScope(scope), 'list'] as const,
    list: (filters: Record<string, unknown> = {}, scope?: QueryScope) =>
      [...queryKeys.customers.lists(scope), filters] as const,
    details: (scope?: QueryScope) =>
      [...queryKeys.customers.all, ...normalizeQueryScope(scope), 'detail'] as const,
    detail: (id: string, scope?: QueryScope) =>
      [...queryKeys.customers.details(scope), id] as const,
    ledger: (id: string, filters: Record<string, unknown> = {}, scope?: QueryScope) =>
      [...queryKeys.customers.detail(id, scope), 'ledger', filters] as const,
    ledgerSummary: (id: string, scope?: QueryScope) =>
      [...queryKeys.customers.detail(id, scope), 'ledgerSummary'] as const,
    balances: (scope?: QueryScope) =>
      [...queryKeys.customers.all, ...normalizeQueryScope(scope), 'balances'] as const,
  },
  suppliers: {
    all: ['suppliers'] as const,
    lists: (scope?: QueryScope) =>
      [...queryKeys.suppliers.all, ...normalizeQueryScope(scope), 'list'] as const,
    list: (filters: Record<string, unknown> = {}, scope?: QueryScope) =>
      [...queryKeys.suppliers.lists(scope), filters] as const,
    details: (scope?: QueryScope) =>
      [...queryKeys.suppliers.all, ...normalizeQueryScope(scope), 'detail'] as const,
    detail: (id: string, scope?: QueryScope) =>
      [...queryKeys.suppliers.details(scope), id] as const,
    ledger: (id: string, filters: Record<string, unknown> = {}, scope?: QueryScope) =>
      [...queryKeys.suppliers.detail(id, scope), 'ledger', filters] as const,
    ledgerSummary: (id: string, scope?: QueryScope) =>
      [...queryKeys.suppliers.detail(id, scope), 'ledgerSummary'] as const,
    balances: (scope?: QueryScope) =>
      [...queryKeys.suppliers.all, ...normalizeQueryScope(scope), 'balances'] as const,
  },
  sales: {
    all: ['sales'] as const,
    lists: (scope?: QueryScope) =>
      [...queryKeys.sales.all, ...normalizeQueryScope(scope), 'list'] as const,
    list: (filters: Record<string, unknown> = {}, scope?: QueryScope) =>
      [...queryKeys.sales.lists(scope), filters] as const,
    details: (scope?: QueryScope) =>
      [...queryKeys.sales.all, ...normalizeQueryScope(scope), 'detail'] as const,
    detail: (id: string, scope?: QueryScope) =>
      [...queryKeys.sales.details(scope), id] as const,
  },
  invoices: {
    all: ['invoices'] as const,
    lists: (scope?: QueryScope) =>
      [...queryKeys.invoices.all, ...normalizeQueryScope(scope), 'list'] as const,
    list: (filters: Record<string, unknown> = {}, scope?: QueryScope) =>
      [...queryKeys.invoices.lists(scope), filters] as const,
    details: (scope?: QueryScope) =>
      [...queryKeys.invoices.all, ...normalizeQueryScope(scope), 'detail'] as const,
    detail: (id: string, scope?: QueryScope) =>
      [...queryKeys.invoices.details(scope), id] as const,
  },
  payments: {
    all: ['payments'] as const,
    lists: (scope?: QueryScope) =>
      [...queryKeys.payments.all, ...normalizeQueryScope(scope), 'list'] as const,
    list: (filters: Record<string, unknown> = {}, scope?: QueryScope) =>
      [...queryKeys.payments.lists(scope), filters] as const,
    details: (scope?: QueryScope) =>
      [...queryKeys.payments.all, ...normalizeQueryScope(scope), 'detail'] as const,
    detail: (id: string, scope?: QueryScope) =>
      [...queryKeys.payments.details(scope), id] as const,
  },
  purchases: {
    all: ['purchases'] as const,
    lists: (scope?: QueryScope) =>
      [...queryKeys.purchases.all, ...normalizeQueryScope(scope), 'list'] as const,
    list: (filters: Record<string, unknown> = {}, scope?: QueryScope) =>
      [...queryKeys.purchases.lists(scope), filters] as const,
    details: (scope?: QueryScope) =>
      [...queryKeys.purchases.all, ...normalizeQueryScope(scope), 'detail'] as const,
    detail: (id: string, scope?: QueryScope) =>
      [...queryKeys.purchases.details(scope), id] as const,
  },
  goodsReceipts: {
    all: ['goodsReceipts'] as const,
    lists: (scope?: QueryScope) =>
      [...queryKeys.goodsReceipts.all, ...normalizeQueryScope(scope), 'list'] as const,
    list: (filters: Record<string, unknown> = {}, scope?: QueryScope) =>
      [...queryKeys.goodsReceipts.lists(scope), filters] as const,
  },
  supplierPayments: {
    all: ['supplierPayments'] as const,
    lists: (scope?: QueryScope) =>
      [...queryKeys.supplierPayments.all, ...normalizeQueryScope(scope), 'list'] as const,
    list: (filters: Record<string, unknown> = {}, scope?: QueryScope) =>
      [...queryKeys.supplierPayments.lists(scope), filters] as const,
  },
  inventory: {
    all: ['inventory'] as const,
    balances: (scopeOrBranchId?: string | QueryScope) => {
      const scope =
        typeof scopeOrBranchId === 'string' ? { branchId: scopeOrBranchId } : scopeOrBranchId
      return [...queryKeys.inventory.all, ...normalizeQueryScope(scope), 'balances'] as const
    },
    movements: (filters: Record<string, unknown> = {}, scope?: QueryScope) =>
      [...queryKeys.inventory.all, ...normalizeQueryScope(scope), 'movements', filters] as const,
    counts: (scope?: QueryScope) =>
      [...queryKeys.inventory.all, ...normalizeQueryScope(scope), 'counts'] as const,
  },
  reports: {
    all: ['reports'] as const,
    dashboard: (filters: Record<string, unknown> = {}, scope?: QueryScope) =>
      [...queryKeys.reports.all, ...normalizeQueryScope(scope), 'dashboard', filters] as const,
    sales: (filters: Record<string, unknown> = {}, scope?: QueryScope) =>
      [...queryKeys.reports.all, ...normalizeQueryScope(scope), 'sales', filters] as const,
    products: (filters: Record<string, unknown> = {}, scope?: QueryScope) =>
      [...queryKeys.reports.all, ...normalizeQueryScope(scope), 'products', filters] as const,
    customerBalances: (scope?: QueryScope) =>
      [...queryKeys.reports.all, ...normalizeQueryScope(scope), 'customerBalances'] as const,
    supplierBalances: (scope?: QueryScope) =>
      [...queryKeys.reports.all, ...normalizeQueryScope(scope), 'supplierBalances'] as const,
    profit: (filters: Record<string, unknown> = {}, scope?: QueryScope) =>
      [...queryKeys.reports.all, ...normalizeQueryScope(scope), 'profit', filters] as const,
  },
  expenses: {
    all: ['expenses'] as const,
    list: (filters: Record<string, unknown> = {}, scope?: QueryScope) =>
      [...queryKeys.expenses.all, ...normalizeQueryScope(scope), 'list', filters] as const,
    summary: (scope?: QueryScope) =>
      ['expenseSummary', ...normalizeQueryScope(scope)] as const,
  },
  expenseCategories: {
    all: ['expenseCategories'] as const,
    list: (scope?: QueryScope) =>
      ['expenseCategories', ...normalizeQueryScope(scope)] as const,
  },
  staff: {
    all: ['staff'] as const,
    list: (filters: Record<string, unknown> = {}, scope?: QueryScope) =>
      [...queryKeys.staff.all, ...normalizeQueryScope(scope), 'list', filters] as const,
    detail: (id: string, scope?: QueryScope) =>
      ['staffMember', ...normalizeQueryScope(scope), id] as const,
    invitations: (scope?: QueryScope) =>
      ['staffInvitations', ...normalizeQueryScope(scope)] as const,
  },
  settings: {
    all: ['business-settings'] as const,
    detail: (scope?: QueryScope) =>
      ['business-settings', ...normalizeQueryScope(scope)] as const,
  },
}
