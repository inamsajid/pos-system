import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useOptionalAuth } from '../../auth/context/useAuth'
import { queryKeys } from '../../../api/queryKeys'
import { customerService } from '../services/customerService'
import type { CustomerDraft } from '../types/customer.types'

export const CUSTOMERS_QUERY_KEY = queryKeys.customers.all

export function useCustomers() {
  const queryClient = useQueryClient()
  const auth = useOptionalAuth()
  const scope = {
    userId: auth?.user?.id,
    businessId: auth?.activeBusiness?.id,
    branchId: auth?.activeBranch?.id,
  }
  const listKey = queryKeys.customers.list({}, scope)

  const query = useQuery({
    queryKey: listKey,
    queryFn: () => customerService.getCustomers(),
  })

  const createMutation = useMutation({
    mutationFn: (draft: CustomerDraft) => customerService.createCustomer(draft),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.customers.all }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: CustomerDraft }) =>
      customerService.updateCustomer(id, draft),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.customers.all })
    },
  })

  const archiveMutation = useMutation({
    mutationFn: (id: string) => customerService.archiveCustomer(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.customers.all })
    },
  })

  return {
    ...query,
    customers: query.data || [],
    createCustomer: createMutation.mutateAsync,
    updateCustomer: updateMutation.mutateAsync,
    archiveCustomer: archiveMutation.mutateAsync,
  }
}
