import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../auth/context/useAuth'
import {
  fetchCustomerLedger,
  fetchCustomerLedgerSummary,
  type LedgerEntry,
} from '../../customers/services/customerLedgerService'
import type { CustomerFinancialSummary } from '../../customers/types/customer.types'

export function useCustomerLedger(customerId?: string) {
  const { activeBusiness, activeBranch } = useAuth()
  const businessId = activeBusiness?.id || 'default'
  const branchId = activeBranch?.id || 'all'

  const ledgerQuery = useQuery<LedgerEntry[]>({
    queryKey: ['customerLedger', businessId, branchId, customerId],
    queryFn: () => (customerId ? fetchCustomerLedger(customerId) : Promise.resolve([])),
    enabled: Boolean(customerId && customerId !== 'walk-in'),
    staleTime: 30_000,
  })

  const summaryQuery = useQuery<CustomerFinancialSummary>({
    queryKey: ['customerLedgerSummary', businessId, branchId, customerId],
    queryFn: () => (customerId ? fetchCustomerLedgerSummary(customerId) : Promise.reject('No ID')),
    enabled: Boolean(customerId && customerId !== 'walk-in'),
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

