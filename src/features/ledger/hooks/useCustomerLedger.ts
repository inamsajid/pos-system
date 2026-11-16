import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../auth/context/useAuth'
import { queryKeys } from '../../../api/queryKeys'
import {
  fetchCustomerLedger,
  fetchCustomerLedgerSummary,
  type LedgerEntry,
} from '../../customers/services/customerLedgerService'
import type { CustomerFinancialSummary } from '../../customers/types/customer.types'

export function useCustomerLedger(customerId?: string) {
  const { user, activeBusiness, activeBranch } = useAuth()
  const scope = {
    userId: user?.id,
    businessId: activeBusiness?.id,
    branchId: activeBranch?.id,
  }

  const ledgerQuery = useQuery<LedgerEntry[]>({
    queryKey: queryKeys.customers.ledger(customerId || 'none', {}, scope),
    queryFn: () => (customerId ? fetchCustomerLedger(customerId) : Promise.resolve([])),
    enabled: Boolean(customerId && customerId !== 'walk-in'),
    staleTime: 30_000,
  })

  const summaryQuery = useQuery<CustomerFinancialSummary>({
    queryKey: queryKeys.customers.ledgerSummary(customerId || 'none', scope),
    queryFn: () =>
      customerId ? fetchCustomerLedgerSummary(customerId) : Promise.reject(new Error('No ID')),
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
