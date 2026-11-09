import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../auth/context/useAuth'
import { staffService } from '../services/staffService'
import type { StaffFilters } from '../types/staff.types'

export function useStaff(filters: StaffFilters = {}) {
  const { activeBusiness } = useAuth()
  const businessId = activeBusiness?.id || 'default'

  const query = useQuery({
    queryKey: ['staff', businessId, filters],
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
  const { activeBusiness } = useAuth()
  const businessId = activeBusiness?.id || 'default'

  return useQuery({
    queryKey: ['staffMember', businessId, id],
    queryFn: () => (id ? staffService.getStaffMember(id) : Promise.reject('No ID')),
    enabled: Boolean(id),
    staleTime: 30_000,
  })
}

export function useStaffInvitations() {
  const { activeBusiness } = useAuth()
  const businessId = activeBusiness?.id || 'default'

  return useQuery({
    queryKey: ['staffInvitations', businessId],
    queryFn: () => staffService.getInvitations(),
    staleTime: 30_000,
  })
}

