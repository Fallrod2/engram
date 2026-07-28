import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api'

/**
 * Retry policy (T-028). A 4xx is the server's FINAL answer about this exact
 * request — a deleted deck stays deleted, an unknown id stays unknown — so
 * replaying it changes nothing and only delays the screen whose whole job is to
 * say "introuvable". It also opens a trap: between two attempts TanStack Query
 * PAUSES the retryer whenever the document is hidden or the device is offline
 * (`canContinue()` in `@tanstack/query-core`), and that pause has no deadline.
 * A route loader awaiting such a query therefore never settles, so the router
 * stays `pending` and its `pendingComponent` skeleton runs forever instead of
 * handing over to `errorComponent` — exactly what a bookmark on a deleted
 * subject/note produced.
 *
 * 408 (request timeout) and 429 (rate limited) are the two 4xx the server sends
 * precisely to invite another attempt, so they keep retrying. 5xx, network
 * failures and schema errors keep retrying too — those are genuinely transient.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const definitive =
    error instanceof ApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  return !definitive && failureCount < 2
}

/**
 * QueryClient defaults (spec §1.2). Dues "mature" over time, so we refetch on
 * window focus; individual queries (e.g. due counts) add their own interval.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetryQuery,
        refetchOnWindowFocus: true,
      },
    },
  })
}
