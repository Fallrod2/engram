import { QueryClient } from '@tanstack/react-query'

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
        retry: 2,
        refetchOnWindowFocus: true,
      },
    },
  })
}
