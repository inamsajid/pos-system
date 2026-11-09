import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/context/useAuth'
import { expenseService } from '../services/expenseService'

export function useExpenseCategories() {
  const { activeBusiness } = useAuth()
  const businessId = activeBusiness?.id || 'default'

  const query = useQuery({
    queryKey: ['expenseCategories', businessId],
    queryFn: () => expenseService.getCategories(),
    staleTime: 60_000,
  })

  return {
    categories: query.data ?? [],
    activeCategories: (query.data ?? []).filter((c) => c.status === 'active'),
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  }
}

export function useCreateExpenseCategory() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ name, description }: { name: string; description?: string }) =>
      expenseService.createCategory(name, description),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenseCategories'] })
    },
  })
}

export function useUpdateExpenseCategory() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string
      updates: { name?: string; description?: string; status?: 'active' | 'archived' }
    }) => expenseService.updateCategory(id, updates),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenseCategories'] })
    },
  })
}

export function useDeleteExpenseCategory() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => expenseService.deleteCategory(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenseCategories'] })
    },
  })
}

