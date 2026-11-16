import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../auth/context/useAuth'
import { queryKeys } from '../../../api/queryKeys'
import { staffService } from '../services/staffService'
import type { StaffFilters } from '../types/staff.types'

export function useStaff(filters: StaffFilters = {}) {
  const { user, activeBusiness, activeBranch } = useAuth()
  const scope = {
    userId: user?.id,
    businessId: activeBusiness?.id,
    branchId: activeBranch?.id,
  }

  const query = useQuery({
    queryKey: queryKeys.staff.list(filters as Record<string, unknown>, scope),
    queryFn: () => staffService.getStaff(filters),
    staleTime: 30_000,
  })

  return {
    staff: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  }
}

export function useStaffMember(id: string | undefined) {
  const { user, activeBusiness, activeBranch } = useAuth()
  const scope = {
    userId: user?.id,
    businessId: activeBusiness?.id,
    branchId: activeBranch?.id,
  }

  return useQuery({
    queryKey: queryKeys.staff.detail(id || 'none', scope),
    queryFn: () => (id ? staffService.getStaffMember(id) : Promise.reject(new Error('No ID'))),
    enabled: Boolean(id),
    staleTime: 30_000,
  })
}

export function useStaffInvitations() {
  const { user, activeBusiness, activeBranch } = useAuth()
  const scope = {
    userId: user?.id,
    businessId: activeBusiness?.id,
    branchId: activeBranch?.id,
  }

  return useQuery({
    queryKey: queryKeys.staff.invitations(scope),
    queryFn: () => staffService.getInvitations(),
    staleTime: 30_000,
  })
}
