import { queryOptions } from '@tanstack/react-query'
import { dueCountsSchema, type DueCounts } from '@engram/shared'
import { api } from '@/lib/api'
import { qk } from '@/lib/query-keys'

/**
 * Real due counts (spec §5) — `GET /api/review/counts`. Dues "mature" over
 * time, so this refetches on an interval and on window focus.
 */
export function dueCountsOptions() {
  return queryOptions({
    queryKey: qk.dueCounts.all,
    queryFn: ({ signal }) => api.get('/review/counts', dueCountsSchema, signal),
    refetchInterval: 60_000,
  })
}

/** Index `bySubject` into a `subjectId → dueCount` lookup. */
export function bySubjectMap(counts: DueCounts | undefined): Map<string, number> {
  const m = new Map<string, number>()
  if (!counts) return m
  for (const { subjectId, dueCount } of counts.bySubject) m.set(subjectId, dueCount)
  return m
}

/** Index `byDeck` into a `deckId → dueCount` lookup. */
export function byDeckMap(counts: DueCounts | undefined): Map<string, number> {
  const m = new Map<string, number>()
  if (!counts) return m
  for (const { deckId, dueCount } of counts.byDeck) m.set(deckId, dueCount)
  return m
}
