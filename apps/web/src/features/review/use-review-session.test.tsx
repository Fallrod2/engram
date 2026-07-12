// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Card, ReviewPreview, ReviewQueueResponse } from '@engram/shared'

// --- Module mocks (keep the hook's effects inert but observable) ------------
const postReview = vi.fn()
const fetchReviewQueue = vi.fn()
const fetchCardPreview = vi.fn()

vi.mock('motion/react', () => ({ useReducedMotion: () => false }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouter: () => ({ history: { back: vi.fn() } }),
}))
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
  postReview: (...args: unknown[]) => postReview(...args),
  fetchReviewQueue: (...args: unknown[]) => fetchReviewQueue(...args),
  fetchCardPreview: (...args: unknown[]) => fetchCardPreview(...args),
}))

import { useReviewSession } from './use-review-session'

function makeCard(id: string): Card {
  return {
    id,
    deckId: 'deck-1',
    front: `front ${id}`,
    back: `back ${id}`,
    fsrs: {
      due: '2026-07-12T00:00:00.000Z',
      stability: 1,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      state: 0,
      lastReview: null,
    },
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
}

const grade = {
  due: '2026-07-13T00:00:00.000Z',
  stability: 2,
  difficulty: 5,
  scheduledDays: 1,
  state: 1,
} as const
const PREVIEW: ReviewPreview = {
  now: '2026-07-12T10:00:00.000Z',
  again: grade,
  hard: grade,
  good: grade,
  easy: grade,
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  postReview.mockReset()
  fetchReviewQueue.mockReset()
  fetchCardPreview.mockReset()
  const queue: ReviewQueueResponse = {
    now: '2026-07-12T10:00:00.000Z',
    total: 2,
    cards: [makeCard('c1'), makeCard('c2')],
  }
  fetchReviewQueue.mockResolvedValue(queue)
  fetchCardPreview.mockResolvedValue(PREVIEW)
  // Never resolves: keep the review in flight so the machine stays SUBMITTING
  // and any same-tick second submit has to be blocked by the synchronous guard,
  // not by a state that has already advanced.
  postReview.mockReturnValue(new Promise(() => {}))
})

afterEach(cleanup)

describe('useReviewSession — double-submit guard (§16.1 item 2bis, finding #9, wired-up)', () => {
  it('fires exactly one POST when two rating keydowns land in the same tick', async () => {
    const { result } = renderHook(() => useReviewSession({}), { wrapper })

    await waitFor(() => expect(result.current.phase).toBe('ASKING'))

    act(() => result.current.reveal())
    await waitFor(() => expect(result.current.phase).toBe('REVEALED'))

    // Two rating keydowns dispatched synchronously, before React re-renders and
    // refreshes `stateRef` — the exact repro from the review.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '4' }))
    })

    // mutate() runs the mutationFn in a microtask; wait for it to land.
    await waitFor(() => expect(postReview).toHaveBeenCalled())
    expect(postReview).toHaveBeenCalledTimes(1)
    // ...and with the FIRST grade the user actually pressed, not the last.
    expect(postReview).toHaveBeenCalledWith('c1', { grade: 2, durationMs: expect.any(Number) })
    expect(result.current.phase).toBe('SUBMITTING')
  })

  it('fires exactly one POST when rate() is called twice synchronously', async () => {
    const { result } = renderHook(() => useReviewSession({}), { wrapper })

    await waitFor(() => expect(result.current.phase).toBe('ASKING'))
    act(() => result.current.reveal())
    await waitFor(() => expect(result.current.phase).toBe('REVEALED'))

    act(() => {
      result.current.rate(1)
      result.current.rate(4)
    })

    await waitFor(() => expect(postReview).toHaveBeenCalled())
    expect(postReview).toHaveBeenCalledTimes(1)
    expect(postReview).toHaveBeenCalledWith('c1', { grade: 1, durationMs: expect.any(Number) })
  })
})
