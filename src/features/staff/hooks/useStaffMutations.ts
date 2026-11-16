import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../../api/queryKeys'
import { staffService } from '../services/staffService'
import type { InviteStaffDraft, StaffRole } from '../types/staff.types'

export function useStaffMutations() {
  const queryClient = useQueryClient()

  const invalidateStaff = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.staff.all })
    void queryClient.invalidateQueries({ queryKey: ['staffMember'] })
    void queryClient.invalidateQueries({ queryKey: ['staffInvitations'] })
  }

  const inviteStaff = useMutation({
    mutationFn: (draft: InviteStaffDraft) => staffService.inviteStaff(draft),
    onSuccess: invalidateStaff,
  })

  const revokeInvitation = useMutation({
    mutationFn: (id: string) => staffService.revokeInvitation(id),
    onSuccess: invalidateStaff,
  })

  const updateRole = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: StaffRole }) =>
      staffService.updateRole(memberId, role),
    onSuccess: invalidateStaff,
  })

  const updateBranches = useMutation({
    mutationFn: ({ memberId, branchIds }: { memberId: string; branchIds: string[] }) =>
      staffService.updateBranches(memberId, branchIds),
    onSuccess: invalidateStaff,
  })

  const suspendStaff = useMutation({
    mutationFn: (memberId: string) => staffService.suspendStaff(memberId),
    onSuccess: invalidateStaff,
  })

  const reactivateStaff = useMutation({
    mutationFn: (memberId: string) => staffService.reactivateStaff(memberId),
    onSuccess: invalidateStaff,
  })

  return {
    inviteStaff,
    revokeInvitation,
    updateRole,
    updateBranches,
    suspendStaff,
    reactivateStaff,
  }
}
