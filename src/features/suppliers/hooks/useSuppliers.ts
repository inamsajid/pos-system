import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supplierService } from '../services/supplierService'
import type { SupplierDraft } from '../types/supplier.types'

export const SUPPLIERS_QUERY_KEY = ['suppliers']

export function useSuppliers() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: SUPPLIERS_QUERY_KEY,
    queryFn: () => supplierService.getSuppliers(),
  })

  const createMutation = useMutation({
    mutationFn: (draft: SupplierDraft) => supplierService.createSupplier(draft),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SUPPLIERS_QUERY_KEY }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: SupplierDraft }) => supplierService.updateSupplier(id, draft),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: SUPPLIERS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ['supplier', vars.id] })
    },
  })

  const archiveMutation = useMutation({
    mutationFn: (id: string) => supplierService.archiveSupplier(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: SUPPLIERS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ['supplier', id] })
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

