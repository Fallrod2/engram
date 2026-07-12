import { queryOptions } from '@tanstack/react-query'
import { fetchCardPreview, fetchReviewQueue, type ReviewScope } from '@/lib/api'
import { qk } from '@/lib/query-keys'

/** API max page — captures the whole mono-user queue in one call (spec §3.2). */
export const QUEUE_LIMIT = 500

/**
 * The frozen session queue (spec §13.2): `staleTime Infinity` + `gcTime 0` so it
 * never refetches mid-session and is collected on unmount. `now` is the frozen
 * `sessionNow`, part of the key.
 */
export function queueOptions(scope: ReviewScope, now: string) {
  return queryOptions({
    queryKey: qk.review.queue({ ...scope, now }),
    queryFn: ({ signal }) => fetchReviewQueue({ ...scope, now, limit: QUEUE_LIMIT }, signal),
    staleTime: Infinity,
    gcTime: 0,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}

/**
 * Interval preview of a card at `now` (spec §13.2, finding #5). `now` is both in
 * the key and forwarded to the fetcher. Prefetched for card i and i+1 so the 4
 * intervals appear instantly at reveal.
 */
export function previewOptions(cardId: string, now: string) {
  return queryOptions({
    queryKey: qk.review.preview(cardId, now),
    queryFn: ({ signal }) => fetchCardPreview(cardId, now, signal),
    staleTime: 60_000,
  })
}

/**
 * "Review again" probe (spec §10.2, finding #13): a cheap `limit 1` queue at a
 * fresh `now`, fired on entering SUMMARY. The R button appears only once this
 * resolves with `total >= 1`, so it never flashes.
 */
export function againProbeOptions(scope: ReviewScope, nowProbe: string) {
  return queryOptions({
    queryKey: qk.review.queue({ ...scope, now: nowProbe }),
    queryFn: ({ signal }) => fetchReviewQueue({ ...scope, now: nowProbe, limit: 1 }, signal),
    staleTime: 0,
  })
}
