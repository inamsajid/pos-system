import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/context/useAuth'
import { queryKeys } from '../../../api/queryKeys'
import { settingsService, type UpdateBusinessSettingsInput } from '../services/settingsService'

export const SETTINGS_QUERY_KEY = queryKeys.settings.all

export function useSettings() {
  const queryClient = useQueryClient()
  const { user, activeBusiness, activeBranch } = useAuth()
  const scope = {
    userId: user?.id,
    businessId: activeBusiness?.id,
    branchId: activeBranch?.id,
  }
  const settingsKey = queryKeys.settings.detail(scope)

  const query = useQuery({
    queryKey: settingsKey,
    queryFn: () => settingsService.getSettings(),
  })

  const updateMutation = useMutation({
    mutationFn: (input: UpdateBusinessSettingsInput) => settingsService.updateSettings(input),
    onSuccess: (updated) => {
      queryClient.setQueryData(settingsKey, updated)
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.all })
    },
  })

  return {
    ...query,
    settings: query.data,
    updateSettings: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
    updateError: updateMutation.error,
  }
}
