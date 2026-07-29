import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  onboardingStatusSchema,
  type OnboardingStatus,
  type UpdateOnboarding,
} from '@engram/shared'
import { api } from '@/lib/api'
import { qk } from '@/lib/query-keys'

/**
 * The first-run journey's marker — `GET /api/onboarding`.
 *
 * SERVER-SIDE, not `localStorage`: the whole point is that the journey does not
 * come back on a second browser, a second machine or a private window.
 *
 * `staleTime: Infinity` because this is read on EVERY navigation by the root
 * `beforeLoad` (that is how the journey is offered at all), and its answer only
 * changes when this very client completes the journey — in which case the
 * mutation writes the new value into the cache directly.
 */
export function onboardingStatusOptions() {
  return queryOptions({
    queryKey: qk.onboarding,
    queryFn: ({ signal }) => api.get('/onboarding', onboardingStatusSchema, signal),
    staleTime: Infinity,
    // One attempt. A failed probe must never delay the first paint, and its
    // fallback ("do not offer the journey") is the safe direction.
    retry: false,
  })
}

/**
 * Record that the user went through the journey — or left it, which is the same
 * answer to "should we ask again". Writes the server's own projection into the
 * cache so the redirect in `beforeLoad` cannot fire once more on the very
 * navigation that follows.
 */
export function useCompleteOnboarding() {
  const qc = useQueryClient()
  return useMutation<OnboardingStatus, unknown, UpdateOnboarding>({
    mutationFn: (body) => api.patch('/onboarding', body, onboardingStatusSchema),
    onSuccess: (data) => qc.setQueryData(qk.onboarding, data),
  })
}
