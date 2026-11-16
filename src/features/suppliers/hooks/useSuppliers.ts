import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useOptionalAuth } from '../../auth/context/useAuth'
import { queryKeys } from '../../../api/queryKeys'
import { supplierService } from '../services/supplierService'
import type { SupplierDraft } from '../types/supplier.types'

export const SUPPLIERS_QUERY_KEY = queryKeys.suppliers.all

export function useSuppliers() {
  const queryClient = useQueryClient()
  const auth = useOptionalAuth()
  const scope = {
    userId: auth?.user?.id,
    businessId: auth?.activeBusiness?.id,
    branchId: auth?.activeBranch?.id,
  }
  const listKey = queryKeys.suppliers.list({}, scope)

  const query = useQuery({
    queryKey: listKey,
    queryFn: () => supplierService.getSuppliers(),
  })

  const createMutation = useMutation({
    mutationFn: (draft: SupplierDraft) => supplierService.createSupplier(draft),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: SupplierDraft }) =>
      supplierService.updateSupplier(id, draft),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all })
    },
  })

  const archiveMutation = useMutation({
    mutationFn: (id: string) => supplierService.archiveSupplier(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all })
    },
  })

  return {
    ...query,
    suppliers: query.data || [],
    createSupplier: createMutation.mutateAsync,
    updateSupplier: updateMutation.mutateAsync,
    archiveSupplier: archiveMutation.mutateAsync,
  }
}
