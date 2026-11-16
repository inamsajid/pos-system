import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/context/useAuth'
import { queryKeys } from '../../../api/queryKeys'
import { expenseService } from '../services/expenseService'
import type { ExpenseDraft, ExpenseFilterParams } from '../types/expense.types'

export function useExpenses(filters: ExpenseFilterParams = {}) {
  const { user, activeBusiness, activeBranch } = useAuth()
  const scope = {
    userId: user?.id,
    businessId: activeBusiness?.id,
    branchId: filters.branchId || activeBranch?.id,
  }

  const query = useQuery({
    queryKey: queryKeys.expenses.list(filters as Record<string, unknown>, scope),
    queryFn: () =>
      expenseService.getExpenses({ ...filters, branchId: filters.branchId || activeBranch?.id }),
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
  const { user, activeBusiness, activeBranch } = useAuth()
  const scope = {
    userId: user?.id,
    businessId: activeBusiness?.id,
    branchId: activeBranch?.id,
  }

  return useQuery({
    queryKey: queryKeys.expenses.summary(scope),
    queryFn: () => expenseService.getExpenseSummary(),
    staleTime: 30_000,
  })
}

export function useCreateExpense() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (draft: ExpenseDraft) => expenseService.createExpense(draft),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all })
      void queryClient.invalidateQueries({ queryKey: ['expenseSummary'] })
      void queryClient.invalidateQueries({ queryKey: queryKeys.expenseCategories.all })
    },
  })
}

export function useVoidExpense() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      expenseService.voidExpense(id, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all })
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all })
    },
  })
}
