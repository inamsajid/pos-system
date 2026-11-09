import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../auth/context/useAuth'
import {
  fetchSupplierLedger,
  fetchSupplierLedgerSummary,
  type SupplierLedgerEntry,
} from '../../suppliers/services/supplierLedgerService'
import type { SupplierFinancialSummary } from '../../suppliers/types/supplier.types'

export function useSupplierLedger(supplierId?: string) {
  const { activeBusiness, activeBranch } = useAuth()
  const businessId = activeBusiness?.id || 'default'
  const branchId = activeBranch?.id || 'all'

  const ledgerQuery = useQuery<SupplierLedgerEntry[]>({
    queryKey: ['supplierLedger', businessId, branchId, supplierId],
    queryFn: () => (supplierId ? fetchSupplierLedger(supplierId) : Promise.resolve([])),
    enabled: Boolean(supplierId),
    staleTime: 30_000,
  })

  const summaryQuery = useQuery<SupplierFinancialSummary>({
    queryKey: ['supplierLedgerSummary', businessId, branchId, supplierId],
    queryFn: () => (supplierId ? fetchSupplierLedgerSummary(supplierId) : Promise.reject('No ID')),
    enabled: Boolean(supplierId),
    staleTime: 30_000,
  })

  return {
    entries: ledgerQuery.data ?? [],
    summary: summaryQuery.data,
    isLoading: ledgerQuery.isLoading || summaryQuery.isLoading,
    isError: ledgerQuery.isError || summaryQuery.isError,
    error: ledgerQuery.error || summaryQuery.error,
    refetch: async () => {
      await Promise.all([ledgerQuery.refetch(), summaryQuery.refetch()])
    },
  }
}

