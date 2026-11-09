import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { customerService } from '../services/customerService'
import type { CustomerDraft } from '../types/customer.types'

export const CUSTOMERS_QUERY_KEY = ['customers']

export function useCustomers() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: CUSTOMERS_QUERY_KEY,
    queryFn: () => customerService.getCustomers(),
  })

  const createMutation = useMutation({
    mutationFn: (draft: CustomerDraft) => customerService.createCustomer(draft),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CUSTOMERS_QUERY_KEY }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: CustomerDraft }) => customerService.updateCustomer(id, draft),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: CUSTOMERS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ['customer', vars.id] })
    },
  })

  const archiveMutation = useMutation({
    mutationFn: (id: string) => customerService.archiveCustomer(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: CUSTOMERS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ['customer', id] })
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

