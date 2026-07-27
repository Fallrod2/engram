// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Card, ReviewPreview, ReviewQueueResponse } from '@engram/shared'
import { qk } from '@/lib/query-keys'

// --- Module mocks (keep the hook's effects inert but observable) ------------
const postReview = vi.fn()
const postUndoReview = vi.fn()
const fetchReviewQueue = vi.fn()
const fetchCardPreview = vi.fn()
const updateCard = vi.fn()

const toastError = vi.fn()
// Stable across renders so "the session left the screen" is assertable: leaving
// only shows up as a navigation — `exited` is internal and `confirmingExit` is
// deliberately not cleared by CONFIRM_EXIT.
const navigate = vi.fn()
// Records every call the hook makes on the per-card clock, so a freeze can be
// asserted without a fake `performance.now()`.
const timerCalls: string[] = []

vi.mock('motion/react', () => ({ useReducedMotion: () => false }))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: (...args: unknown[]) => toastError(...args) }),
}))
vi.mock('./session-timer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./session-timer')>()
  return {
    ...actual,
    createCardTimer: (machinePaused: boolean) => {
      const inner = actual.createCardTimer(machinePaused)
      return {
        pause: () => {
          timerCalls.push('pause')
          inner.pause()
        },
        pauseIdle: () => {
          timerCalls.push('pauseIdle')
          inner.pauseIdle()
        },
        resume: () => {
          timerCalls.push('resume')
          inner.resume()
        },
        read: () => inner.read(),
      }
    },
  }
})
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useRouter: () => ({ history: { back: vi.fn(), canGoBack: () => false } }),
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
  // Same rule as `updateCard` below: the hook imports it at module evaluation.
  postUndoReview: (...args: unknown[]) => postUndoReview(...args),
  fetchReviewQueue: (...args: unknown[]) => fetchReviewQueue(...args),
  fetchCardPreview: (...args: unknown[]) => fetchCardPreview(...args),
  // Must be exported by the mock: the hook imports it at module evaluation, so
  // an omission here would leave `updateCard` undefined, not merely unstubbed.
  updateCard: (...args: unknown[]) => updateCard(...args),
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

/** Same wrapper, but hands the `QueryClient` back so the cache can be read. */
function renderSession() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const rendered = renderHook(() => useReviewSession({}), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
  return { ...rendered, client }
}

/** The frozen queue entry, found by key prefix (its `now` is generated at mount). */
function queueCache(client: QueryClient): ReviewQueueResponse | undefined {
  const entries = client.getQueriesData<ReviewQueueResponse>({ queryKey: ['review', 'queue'] })
  return entries[0]?.[1]
}

/** A `ReviewResult`-shaped ack whose `log.id` is the undo handle. */
function reviewResult(cardId: string, logId: string) {
  return {
    card: makeCard(cardId),
    log: {
      id: logId,
      cardId,
      rating: 3,
      state: 1,
      due: '2026-07-13T00:00:00.000Z',
      stability: 2,
      difficulty: 5,
      elapsedDays: 0,
      lastElapsedDays: 0,
      scheduledDays: 1,
      learningSteps: 0,
      review: '2026-07-12T10:00:00.000Z',
      durationMs: 1000,
      createdAt: '2026-07-12T10:00:00.000Z',
    },
  }
}

beforeEach(() => {
  postReview.mockReset()
  postUndoReview.mockReset()
  fetchReviewQueue.mockReset()
  fetchCardPreview.mockReset()
  updateCard.mockReset()
  toastError.mockReset()
  navigate.mockReset()
  timerCalls.length = 0
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
  postUndoReview.mockReturnValue(new Promise(() => {}))
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

describe('useReviewSession — editing the current card (E)', () => {
  it('E opens the editor and freezes the card clock; closing restarts it', async () => {
    const { result } = renderHook(() => useReviewSession({}), { wrapper })
    await waitFor(() => expect(result.current.phase).toBe('ASKING'))
    expect(result.current.editing).toBe(false)

    timerCalls.length = 0
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }))
    })
    expect(result.current.editing).toBe(true)
    // Time spent fixing a typo is not recall time.
    expect(timerCalls.at(-1)).toBe('pause')
    // The phase is untouched — the card underneath is still the same one.
    expect(result.current.phase).toBe('ASKING')

    act(() => result.current.closeEdit())
    expect(result.current.editing).toBe(false)
    expect(timerCalls.at(-1)).toBe('resume')
  })

  it('openEdit() sets editing and pauses, from REVEALED too', async () => {
    const { result } = renderHook(() => useReviewSession({}), { wrapper })
    await waitFor(() => expect(result.current.phase).toBe('ASKING'))
    act(() => result.current.reveal())
    await waitFor(() => expect(result.current.phase).toBe('REVEALED'))

    timerCalls.length = 0
    act(() => result.current.openEdit())
    expect(result.current.editing).toBe(true)
    expect(result.current.phase).toBe('REVEALED')
    expect(timerCalls.at(-1)).toBe('pause')
  })

  it('writes the rendered card AND the frozen queue cache, PATCHes, never touches fsrs', async () => {
    updateCard.mockResolvedValue(makeCard('c1'))
    const { result, client } = renderSession()
    await waitFor(() => expect(result.current.phase).toBe('ASKING'))
    const fsrsBefore = result.current.current?.fsrs

    act(() => result.current.submitEdit({ front: 'recto corrigé', back: 'verso corrigé' }))

    // 1. The array the session renders.
    expect(result.current.current?.front).toBe('recto corrigé')
    expect(result.current.current?.back).toBe('verso corrigé')
    expect(result.current.current?.fsrs).toBe(fsrsBefore)

    // 2. The frozen queue entry — patched in place, rest of the response intact.
    const cached = queueCache(client)
    expect(cached?.cards[0]?.front).toBe('recto corrigé')
    expect(cached?.cards[0]?.fsrs).toEqual(fsrsBefore)
    expect(cached?.cards[1]?.front).toBe('front c2')
    expect(cached?.total).toBe(2)
    expect(cached?.now).toBe('2026-07-12T10:00:00.000Z')

    await waitFor(() => expect(updateCard).toHaveBeenCalledTimes(1))
    expect(updateCard).toHaveBeenCalledWith('c1', { front: 'recto corrigé', back: 'verso corrigé' })
  })

  it('does not block rating: the review POST still fires right after an edit', async () => {
    updateCard.mockReturnValue(new Promise(() => {})) // PATCH left in flight
    const { result } = renderHook(() => useReviewSession({}), { wrapper })
    await waitFor(() => expect(result.current.phase).toBe('ASKING'))

    act(() => result.current.submitEdit({ front: 'f', back: 'b' }))
    act(() => result.current.reveal())
    act(() => result.current.rate(3))

    await waitFor(() => expect(postReview).toHaveBeenCalledTimes(1))
    expect(postReview).toHaveBeenCalledWith('c1', { grade: 3, durationMs: expect.any(Number) })
  })

  it('rolls back both writes and toasts when the PATCH fails', async () => {
    updateCard.mockRejectedValue(new Error('nope'))
    const { result, client } = renderSession()
    await waitFor(() => expect(result.current.phase).toBe('ASKING'))

    act(() => result.current.submitEdit({ front: 'raté', back: 'raté aussi' }))
    expect(result.current.current?.front).toBe('raté')

    await waitFor(() => expect(result.current.current?.front).toBe('front c1'))
    expect(result.current.current?.back).toBe('back c1')
    expect(queueCache(client)?.cards[0]?.front).toBe('front c1')
    expect(queueCache(client)?.cards[0]?.back).toBe('back c1')
    expect(toastError).toHaveBeenCalledWith('Modification de la carte échouée')
  })

  it('a keystroke inside the editor never reaches the rating router', async () => {
    const { result } = renderHook(() => useReviewSession({}), { wrapper })
    await waitFor(() => expect(result.current.phase).toBe('ASKING'))
    act(() => result.current.reveal())
    await waitFor(() => expect(result.current.phase).toBe('REVEALED'))

    // The dialog's textarea: typing "3" in it must edit text, not grade a card.
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    textarea.focus()
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }))
    })
    expect(postReview).not.toHaveBeenCalled()
    expect(result.current.phase).toBe('REVEALED')
    textarea.remove()
  })

  it('an open Radix dialog swallows the session shortcuts', async () => {
    const { result } = renderHook(() => useReviewSession({}), { wrapper })
    await waitFor(() => expect(result.current.phase).toBe('ASKING'))

    // Stand-in for the mounted `CardEditDialog` content (Radix stamps exactly
    // this pair on an open Dialog).
    const surface = document.createElement('div')
    surface.setAttribute('role', 'dialog')
    surface.setAttribute('data-state', 'open')
    document.body.appendChild(surface)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
    })
    expect(result.current.phase).toBe('ASKING') // no reveal behind the dialog
    surface.remove()
  })
})

describe('useReviewSession — undoing the last rating (U)', () => {
  it('nothing is undoable before the first rating is acknowledged', async () => {
    const { result } = renderHook(() => useReviewSession({}), { wrapper })
    await waitFor(() => expect(result.current.phase).toBe('ASKING'))
    expect(result.current.canUndo).toBe(false)

    // Rating started but never acked (postReview hangs) → still nothing: the
    // `logId` the server needs does not exist yet.
    act(() => result.current.reveal())
    act(() => result.current.rate(3))
    await waitFor(() => expect(result.current.phase).toBe('SUBMITTING'))
    expect(result.current.canUndo).toBe(false)
  })

  it('canUndo flips true once the review POST resolves', async () => {
    postReview.mockResolvedValue(reviewResult('c1', 'log-1'))
    const { result } = renderHook(() => useReviewSession({}), { wrapper })
    await waitFor(() => expect(result.current.phase).toBe('ASKING'))

    act(() => result.current.reveal())
    act(() => result.current.rate(3))

    await waitFor(() => expect(result.current.canUndo).toBe(true))
    // The session has moved on to the second card…
    expect(result.current.phase).toBe('ASKING')
    expect(result.current.current?.id).toBe('c2')
    expect(result.current.undoing).toBe(false)
  })

  it('undo() POSTs exactly once, with the logId of the review it unwinds', async () => {
    postReview.mockResolvedValue(reviewResult('c1', 'log-1'))
    const { result } = renderHook(() => useReviewSession({}), { wrapper })
    await waitFor(() => expect(result.current.phase).toBe('ASKING'))

    act(() => result.current.reveal())
    act(() => result.current.rate(3))
    await waitFor(() => expect(result.current.canUndo).toBe(true))

    // Two synchronous calls: the in-flight ref must collapse them into one POST.
    act(() => {
      result.current.undo()
      result.current.undo()
    })

    await waitFor(() => expect(postUndoReview).toHaveBeenCalled())
    expect(postUndoReview).toHaveBeenCalledTimes(1)
    expect(postUndoReview).toHaveBeenCalledWith('c1', { logId: 'log-1' })
    // While the POST is in flight the affordance is closed.
    expect(result.current.undoing).toBe(true)
    expect(result.current.canUndo).toBe(false)
  })

  it('U on the keyboard unwinds from SUMMARY, where the session had ended', async () => {
    fetchReviewQueue.mockResolvedValue({
      now: '2026-07-12T10:00:00.000Z',
      total: 1,
      cards: [makeCard('c1')],
    })
    postReview.mockResolvedValue(reviewResult('c1', 'log-1'))
    const { result } = renderHook(() => useReviewSession({}), { wrapper })
    await waitFor(() => expect(result.current.phase).toBe('ASKING'))

    act(() => result.current.reveal())
    act(() => result.current.rate(4))
    await waitFor(() => expect(result.current.phase).toBe('SUMMARY'))
    expect(result.current.canUndo).toBe(true)

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'u' }))
    })
    await waitFor(() => expect(postUndoReview).toHaveBeenCalledTimes(1))
    expect(postUndoReview).toHaveBeenCalledWith('c1', { logId: 'log-1' })
  })

  it('a resolved undo rewinds to the rated card, revealed, and purges its previews', async () => {
    postReview.mockResolvedValue(reviewResult('c1', 'log-1'))
    postUndoReview.mockResolvedValue({ card: makeCard('c1'), undoneLogId: 'log-1' })
    const { result, client } = renderSession()
    await waitFor(() => expect(result.current.phase).toBe('ASKING'))

    /** The `now` of every preview entry cached for c1. */
    const previewNows = () =>
      client.getQueriesData({ queryKey: ['review', 'preview', 'c1'] }).map(([key]) => key[3])

    act(() => result.current.reveal())
    act(() => result.current.rate(3))
    await waitFor(() => expect(result.current.canUndo).toBe(true))
    await waitFor(() => expect(previewNows().length).toBeGreaterThan(0))
    // The intervals computed against the PRE-undo FSRS state.
    const staleNows = previewNows()

    act(() => result.current.undo())

    await waitFor(() => expect(result.current.phase).toBe('REVEALED'))
    expect(result.current.current?.id).toBe('c1')
    expect(result.current.progress.done).toBe(0)
    expect(result.current.counts).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0 })
    expect(result.current.canUndo).toBe(false)
    expect(result.current.undoing).toBe(false)
    // Every pre-undo entry is gone (they describe a card that no longer exists)…
    const fresh = previewNows()
    for (const stale of staleNows) expect(fresh).not.toContain(stale)
    // …and the card is previewed again under a `now` minted by the undo itself.
    expect(fresh.length).toBeGreaterThan(0)
  })

  it('a resolved undo refreshes the aggregate caches, even after the session had ended', async () => {
    fetchReviewQueue.mockResolvedValue({
      now: '2026-07-12T10:00:00.000Z',
      total: 1,
      cards: [makeCard('c1')],
    })
    postReview.mockResolvedValue(reviewResult('c1', 'log-1'))
    postUndoReview.mockResolvedValue({ card: makeCard('c1'), undoneLogId: 'log-1' })
    const { result, client } = renderSession()
    await waitFor(() => expect(result.current.phase).toBe('ASKING'))

    act(() => result.current.reveal())
    act(() => result.current.rate(4))
    // Entering SUMMARY already fired the end-of-session batch against a server
    // state where the card WAS reviewed. The spy goes up only now, so what it
    // records is the undo's own doing and nothing else.
    await waitFor(() => expect(result.current.phase).toBe('SUMMARY'))
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    act(() => result.current.undo())
    await waitFor(() => expect(result.current.phase).toBe('REVEALED'))

    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey)
    expect(keys).toContainEqual(qk.dueCounts.all)
    expect(keys).toContainEqual(qk.analytics.all)
    expect(keys).toContainEqual(qk.planning.all)
    expect(keys).toContainEqual(qk.subjects.all)
    expect(keys).toContainEqual(qk.decks.all)
    expect(keys).toContainEqual(qk.cards.all)
    invalidate.mockRestore()
  })

  it('a refused undo (409) is final: the target is dropped and an error is toasted', async () => {
    postReview.mockResolvedValue(reviewResult('c1', 'log-1'))
    postUndoReview.mockRejectedValue(new Error('409'))
    const { result } = renderHook(() => useReviewSession({}), { wrapper })
    await waitFor(() => expect(result.current.phase).toBe('ASKING'))

    act(() => result.current.reveal())
    act(() => result.current.rate(3))
    await waitFor(() => expect(result.current.canUndo).toBe(true))

    act(() => result.current.undo())
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Annulation impossible'))
    expect(result.current.canUndo).toBe(false)
    expect(result.current.undoing).toBe(false)
    // Nothing was rewound — the rating stands and the session stayed put.
    expect(result.current.current?.id).toBe('c2')
    expect(result.current.counts[3]).toBe(1)
  })
})

describe('useReviewSession — modifiers are not session shortcuts', () => {
  /** Hide the tab the way the browser does, so the machine pauses (mechanism B). */
  function hideTab() {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
  }

  afterEach(() => {
    Reflect.deleteProperty(document, 'hidden')
  })

  it('Cmd+S in ASKING neither skips the card nor moves the cursor', async () => {
    const { result } = renderHook(() => useReviewSession({}), { wrapper })
    await waitFor(() => expect(result.current.phase).toBe('ASKING'))
    expect(result.current.current?.id).toBe('c1')

    // "Save page": the browser's command, not ours.
    fireEvent.keyDown(window, { key: 's', metaKey: true })

    expect(result.current.phase).toBe('ASKING')
    expect(result.current.progress.done).toBe(0)
    expect(result.current.current?.id).toBe('c1')
  })

  it('bare S in ASKING does skip — the control that makes the Cmd+S case meaningful', async () => {
    const { result } = renderHook(() => useReviewSession({}), { wrapper })
    await waitFor(() => expect(result.current.phase).toBe('ASKING'))

    fireEvent.keyDown(window, { key: 's' })

    expect(result.current.phase).toBe('ASKING')
    expect(result.current.progress.done).toBe(1)
    expect(result.current.current?.id).toBe('c2')
  })

  it('Ctrl+R in SUMMARY reloads the page instead of restarting a session', async () => {
    fetchReviewQueue.mockResolvedValue({
      now: '2026-07-12T10:00:00.000Z',
      total: 1,
      cards: [makeCard('c1')],
    })
    postReview.mockResolvedValue(reviewResult('c1', 'log-1'))
    const { result } = renderHook(() => useReviewSession({}), { wrapper })
    await waitFor(() => expect(result.current.phase).toBe('ASKING'))

    act(() => result.current.reveal())
    act(() => result.current.rate(4))
    await waitFor(() => expect(result.current.phase).toBe('SUMMARY'))

    fireEvent.keyDown(window, { key: 'r', ctrlKey: true })

    // REVIEW_AGAIN would have reset the machine to LOADING; the summary stands.
    expect(result.current.phase).toBe('SUMMARY')
    expect(result.current.summary?.viewed).toBe(1)
  })

  it('Cmd+Q in the exit-confirm dialog does not confirm the exit', async () => {
    postReview.mockResolvedValue(reviewResult('c1', 'log-1'))
    const { result } = renderHook(() => useReviewSession({}), { wrapper })
    await waitFor(() => expect(result.current.phase).toBe('ASKING'))

    // One graded card is what makes a requested exit open the confirm dialog.
    act(() => result.current.reveal())
    act(() => result.current.rate(3))
    await waitFor(() => expect(result.current.current?.id).toBe('c2'))
    act(() => result.current.requestExit())
    expect(result.current.confirmingExit).toBe(true)

    fireEvent.keyDown(window, { key: 'q', metaKey: true })
    expect(navigate).not.toHaveBeenCalled()

    // Control: bare Q is the confirm, and confirming leaves the session.
    fireEvent.keyDown(window, { key: 'q' })
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/' }))
  })

  it('the pause overlay still resumes on any bare key', async () => {
    const { result } = renderHook(() => useReviewSession({}), { wrapper })
    await waitFor(() => expect(result.current.phase).toBe('ASKING'))

    hideTab()
    expect(result.current.paused).toBe(true)

    // "S" here means resume, nothing else — the pause branch runs before the
    // modifier filter and consumes every bare key.
    fireEvent.keyDown(window, { key: 's' })

    expect(result.current.paused).toBe(false)
    expect(result.current.phase).toBe('ASKING')
    expect(result.current.progress.done).toBe(0)
  })

  // Pins the pause branch's OWN copy of the modifier test — the one the new
  // guard deliberately does not replace, since it has to run before a catch-all
  // that would otherwise resume on Cmd+R.
  it('a modified key while paused leaves the overlay up', async () => {
    const { result } = renderHook(() => useReviewSession({}), { wrapper })
    await waitFor(() => expect(result.current.phase).toBe('ASKING'))

    hideTab()
    expect(result.current.paused).toBe(true)

    fireEvent.keyDown(window, { key: 'r', metaKey: true })

    expect(result.current.paused).toBe(true)
  })
})
