import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  aiSettingsResponseSchema,
  listModelsResponseSchema,
  testConnectionResponseSchema,
  type AiProviderId,
  type TestConnectionRequest,
  type TestConnectionResponse,
  type UpdateAiSettings,
} from '@engram/shared'
import { api } from '@/lib/api'
import { qk } from '@/lib/query-keys'

/** AI config + per-provider status — `GET /api/ai/settings`. Never holds a key. */
export function aiSettingsOptions() {
  return queryOptions({
    queryKey: qk.ai.settings,
    queryFn: ({ signal }) => api.get('/ai/settings', aiSettingsResponseSchema, signal),
    staleTime: 10_000,
  })
}

/** PATCH the non-secret config (active provider + model/baseUrl). */
export function useUpdateAiSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateAiSettings) =>
      api.patch('/ai/settings', input, aiSettingsResponseSchema),
    onSuccess: (data) => {
      qc.setQueryData(qk.ai.settings, data)
    },
  })
}

/** PUT a provider key (write-only, 204) → refetch settings for the new status. */
export function useSetAiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ provider, key }: { provider: AiProviderId; key: string }) =>
      api.put(`/ai/providers/${provider}/key`, { key }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.ai.settings }),
  })
}

/** DELETE a provider key (204) → refetch settings. */
export function useDeleteAiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (provider: AiProviderId) => api.delete(`/ai/providers/${provider}/key`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.ai.settings }),
  })
}

/** POST a connection test with the current candidate (not cached). */
export function useTestConnection() {
  return useMutation<
    TestConnectionResponse,
    unknown,
    { provider: AiProviderId; candidate: TestConnectionRequest }
  >({
    mutationFn: ({ provider, candidate }) =>
      api.post(`/ai/providers/${provider}/test`, candidate, testConnectionResponseSchema),
  })
}

/**
 * Selectable models for a provider (`GET /api/ai/providers/:provider/models`).
 * Enabled only for providers that expose a model list (mainly ollama).
 */
export function useProviderModels(provider: AiProviderId, enabled: boolean) {
  return useQuery({
    queryKey: qk.ai.models(provider),
    queryFn: ({ signal }) =>
      api.get(`/ai/providers/${provider}/models`, listModelsResponseSchema, signal),
    enabled,
    staleTime: 30_000,
  })
}
