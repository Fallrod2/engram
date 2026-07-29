import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  studySettingsResponseSchema,
  type StudySettingsResponse,
  type UpdateStudySettings,
} from '@engram/shared'
import { api } from '@/lib/api'
import { qk } from '@/lib/query-keys'

/**
 * Daily pacing — `GET /api/study-settings`. The response also carries where the
 * caller stands TODAY (`today`), which is why the control can say "3 / 20
 * nouvelles aujourd'hui" without a second request.
 */
export function studySettingsOptions() {
  return queryOptions({
    queryKey: qk.studySettings,
    queryFn: ({ signal }) => api.get('/study-settings', studySettingsResponseSchema, signal),
    staleTime: 10_000,
  })
}

/**
 * PATCH the pacing pair. The server answers with the FULL projection (settings +
 * today), so the response is written straight into the cache rather than
 * triggering a refetch — one round-trip, and the "N left today" line under the
 * field updates with the number that caused it.
 *
 * NOTHING ELSE IS INVALIDATED, deliberately. The obvious candidates do not want
 * it: the review queue is FROZEN for the length of a session by design (its key
 * carries the session's `now`), and neither `/api/review/counts` nor the study
 * plan subtracts the budget today (TODO T-052) — so invalidating them would cost
 * round-trips and change no number on screen.
 */
export function useUpdateStudySettings() {
  const qc = useQueryClient()
  return useMutation<StudySettingsResponse, unknown, UpdateStudySettings>({
    mutationFn: (patch) => api.patch('/study-settings', patch, studySettingsResponseSchema),
    onSuccess: (data) => qc.setQueryData(qk.studySettings, data),
  })
}
