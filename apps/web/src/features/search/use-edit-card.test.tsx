// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Card, CardSearchHit } from '@engram/shared'

/**
 * T-067 — `?edit=<id>` can name a card that is not on the fetched page (a ⌘K
 * hand-off lands on the needle, not on the offset), so it is read by id. That
 * read had no failure path: `data ?? null` made a dropped request identical to
 * "no such card", the dialog's `open` condition stayed false, and the screen did
 * NOTHING after the user had picked something — verbatim the outcome the comment
 * above the fetch said it existed to prevent.
 */

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

import { api } from '@/lib/api'
import { useEditCard } from './use-edit-card'

const CARD: Card = {
  id: 'c-42',
  deckId: 'd1',
  front: 'Pumping lemma',
  back: 'Every regular language…',
  fsrs: {
    due: '2026-07-30T00:00:00.000Z',
    stability: 1,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 1,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    lastReview: null,
  },
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}

const HIT: CardSearchHit = {
  card: CARD,
  deck: { id: 'd1', name: 'Automates' },
  subject: { id: 's1', name: 'TL', color: '#7999f5', icon: 'brain', archived: false },
}

beforeEach(() => toastError.mockClear())
afterEach(cleanup)
afterEach(() => vi.restoreAllMocks())

function wrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  return ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useEditCard', () => {
  it('takes the card straight from the page when the row is already known', () => {
    const get = vi.spyOn(api, 'get')
    const { result } = renderHook(() => useEditCard('c-42', new Map([['c-42', HIT]])), {
      wrapper: wrapper(),
    })
    expect(result.current.card).toBe(CARD)
    expect(get).not.toHaveBeenCalled()
  })

  it('fetches by id when the row is off-page, and hands the card back', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(CARD)
    const { result } = renderHook(() => useEditCard('c-42', new Map()), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.card).toEqual(CARD))
    expect(toastError).not.toHaveBeenCalled()
  })

  it('SAYS SO when the by-id read fails, instead of doing nothing at all', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useEditCard('c-42', new Map()), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.failed).toBe(true))
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(toastError.mock.calls[0]?.[0]).toBe('Impossible d’ouvrir cette carte.')
    // The card is still null — the dialog cannot open on nothing — but the
    // difference from before is that the user is told, and offered a way back.
    expect(result.current.card).toBeNull()
  })

  it('offers a retry that re-runs the request rather than reloading', async () => {
    const get = vi.spyOn(api, 'get').mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useEditCard('c-42', new Map()), { wrapper: wrapper() })
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    const action = toastError.mock.calls[0]?.[1] as
      { action?: { label: string; onClick: () => void } } | undefined
    expect(action?.action?.label).toBe('Réessayer')
    const before = get.mock.calls.length
    get.mockResolvedValue(CARD)
    action?.action?.onClick()
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(before))
    await waitFor(() => expect(result.current.card).toEqual(CARD))
  })

  it('announces a failure once, not once per render', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('offline'))
    const { result, rerender } = renderHook(() => useEditCard('c-42', new Map()), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.failed).toBe(true))
    rerender()
    rerender()
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it('says nothing at all when no card is being edited', () => {
    const get = vi.spyOn(api, 'get')
    const { result } = renderHook(() => useEditCard(undefined, new Map()), { wrapper: wrapper() })
    expect(result.current.card).toBeNull()
    expect(result.current.failed).toBe(false)
    expect(get).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })
})
