import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsService, type UpdateBusinessSettingsInput } from '../services/settingsService'

export const SETTINGS_QUERY_KEY = ['business-settings']

export function useSettings() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: () => settingsService.getSettings(),
  })

  const updateMutation = useMutation({
    mutationFn: (input: UpdateBusinessSettingsInput) => settingsService.updateSettings(input),
    onSuccess: (updated) => {
      queryClient.setQueryData(SETTINGS_QUERY_KEY, updated)
      queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY })
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

