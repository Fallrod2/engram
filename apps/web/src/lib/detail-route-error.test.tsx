// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClientProvider, queryOptions, type QueryClient } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { ApiError } from '@/lib/api'
import { createQueryClient } from '@/lib/query-client'
import { ErrorState } from '@/components/error-state'

afterEach(cleanup)

/**
 * T-028 (a) — end to end over the exact wiring every detail route uses: a
 * `loader` that awaits `ensureQueryData`, a `pendingComponent` skeleton and an
 * `errorComponent`. Four routes shared this shape and all four sat on the
 * skeleton for a dead id:
 *   /subjects/$subjectId, /subjects/$subjectId/decks/$deckId,
 *   /import/$noteId, /import/$noteId/generations/$generationId
 * The contract pinned here: a 404 reaches the error screen — once, without a
 * replay, so the retryer never gets a window in which to pause indefinitely.
 */
function mountDetailRoute(fail: () => Promise<unknown>) {
  const calls = vi.fn(fail)
  const detailOptions = (id: string) =>
    queryOptions({ queryKey: ['subjects', 'detail', id], queryFn: () => calls() })

  const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
    component: Outlet,
  })
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/subjects/$subjectId',
    loader: ({ context, params }) =>
      context.queryClient.ensureQueryData(detailOptions(params.subjectId)),
    component: () => <div>subject loaded</div>,
    pendingComponent: () => <div data-testid="skeleton" />,
    errorComponent: ({ error }) => (
      <ErrorState
        kind="subject"
        notFound={error instanceof ApiError && error.status === 404}
        back={<span>Retour aux matières</span>}
      />
    ),
  })

  const queryClient = createQueryClient()
  const router = createRouter({
    routeTree: rootRoute.addChildren([detailRoute]),
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ['/subjects/does-not-exist'] }),
    // Show the skeleton immediately, so a failure to reach the error screen
    // would leave a skeleton on screen exactly as the tester saw it.
    defaultPendingMs: 0,
  })

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return calls
}

describe('detail route whose entity is gone', () => {
  it('renders the "no longer exists" screen, not an endless skeleton', async () => {
    const calls = mountDetailRoute(() =>
      Promise.reject(new ApiError(404, 'subject not found', 'not_found')),
    )

    expect(await screen.findByText('Cette matière n’existe plus.')).toBeTruthy()
    expect(screen.queryByTestId('skeleton')).toBeNull()
    // The whole point of the fix: a 404 is asked exactly once.
    expect(calls).toHaveBeenCalledTimes(1)
    // …and it offers the way out, not a pointless retry.
    expect(screen.getByText('Retour aux matières')).toBeTruthy()
  })

  it('keeps the load-failure wording when the failure is not a 404', async () => {
    mountDetailRoute(() => Promise.reject(new ApiError(503, 'boom', 'service_unavailable')))

    // 5xx still retries (2 backoffs), so this asserts the screen is reached at
    // all — the wording must stay "could not load", never "no longer exists".
    expect(
      await screen.findByText('Impossible de charger cette matière.', {}, { timeout: 10_000 }),
    ).toBeTruthy()
    expect(screen.queryByText('Cette matière n’existe plus.')).toBeNull()
  }, 15_000)
})
