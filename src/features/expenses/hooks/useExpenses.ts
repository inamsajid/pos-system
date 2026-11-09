import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/context/useAuth'
import { expenseService } from '../services/expenseService'
import type { ExpenseDraft, ExpenseFilterParams } from '../types/expense.types'

export function useExpenses(filters: ExpenseFilterParams = {}) {
  const { activeBusiness, activeBranch } = useAuth()
  const businessId = activeBusiness?.id || 'default'
  const branchId = filters.branchId || activeBranch?.id || 'all'

  const query = useQuery({
    queryKey: ['expenses', businessId, branchId, filters],
    queryFn: () => expenseService.getExpenses({ ...filters, branchId: filters.branchId || activeBranch?.id }),
    staleTime: 30_000,
  })

  return {
    expenses: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    page: query.data?.page ?? 1,
    limit: query.data?.limit ?? 50,
    totalPages: query.data?.totalPages ?? 1,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  }
}

export function useExpenseSummary() {
  const { activeBusiness, activeBranch } = useAuth()
  const businessId = activeBusiness?.id || 'default'
  const branchId = activeBranch?.id || 'all'

  return useQuery({
    queryKey: ['expenseSummary', businessId, branchId],
    queryFn: () => expenseService.getExpenseSummary(),
    staleTime: 30_000,
  })
}

export function useCreateExpense() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (draft: ExpenseDraft) => expenseService.createExpense(draft),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] })
      void queryClient.invalidateQueries({ queryKey: ['expenseSummary'] })
      void queryClient.invalidateQueries({ queryKey: ['expenseCategories'] })
    },
  })
}

export function useVoidExpense() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      expenseService.voidExpense(id, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] })
      void queryClient.invalidateQueries({ queryKey: ['expenseSummary'] })
    },
  })
}

export function useUpdateExpense() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string
      updates: { title?: string; notes?: string; receiptAttachmentUrl?: string }
    }) => expenseService.updateExpense(id, updates),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] })
    },
  })
}

