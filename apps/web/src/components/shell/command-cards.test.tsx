// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CardSearchHit, SearchCardsResponse } from '@engram/shared'
import { CardResultsGroup, CardResultsSkeleton, useCardPaletteResults } from './command-cards'

/**
 * Requests are held open, keyed by the needle in the query string, so a test
 * decides WHEN each one lands — which is the only way to reproduce an
 * out-of-order network.
 */
const inflight = new Map<string, (res: unknown) => void>()

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    api: {
      get: (path: string) => {
        const q = new URLSearchParams(path.slice(path.indexOf('?'))).get('q') ?? ''
        return new Promise((resolve) => inflight.set(q, resolve))
      },
    },
  }
})

// cmdk items need a Command root to register against; the group is the unit
// under test here, not cmdk's own plumbing.
vi.mock('@/components/ui/command', () => ({
  CommandGroup: ({ heading, children }: { heading: ReactNode; children: ReactNode }) => (
    <div>
      <p>{heading}</p>
      {children}
    </div>
  ),
  CommandItem: ({ children, onSelect }: { children: ReactNode; onSelect: () => void }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
}))

afterEach(() => {
  cleanup()
  inflight.clear()
  vi.useRealTimers()
})

function hit(id: string, front: string, deck: string, archived = false): CardSearchHit {
  return {
    card: {
      id,
      deckId: 'deck1',
      front,
      back: 'back',
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
    },
    deck: { id: 'deck1', name: deck },
    subject: { id: 'sub1', name: 'TL', color: '#7999f5', icon: 'brain', archived },
  }
}

function answer(query: string, hits: CardSearchHit[]): SearchCardsResponse {
  return { total: hits.length, query, limit: 8, offset: 0, hits }
}

// --- the hook ---------------------------------------------------------------

/** Renders the hook's output as text so the assertions read as behaviour. */
function Probe({ search }: { search: string }) {
  const r = useCardPaletteResults(search, true)
  return (
    <div>
      <span data-testid="pending">{String(r.pending)}</span>
      <span data-testid="needle">{r.needle}</span>
      <span data-testid="fronts">{r.hits.map((h) => h.card.front).join(',')}</span>
    </div>
  )
}

/** A query client plus the two verbs a timing test needs. */
function harness() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  const land = async (needle: string, hits: CardSearchHit[]) => {
    const resolve = inflight.get(needle)
    if (!resolve) throw new Error(`no request in flight for ${JSON.stringify(needle)}`)
    await act(async () => {
      resolve(answer(needle, hits))
      await Promise.resolve()
    })
    // React Query batches its notifications through a scheduled task; with fake
    // timers that task has to be run explicitly before the render is observable.
    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
    })
  }
  const wrap = (ui: ReactNode) => <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
  /** Fire the debounce, then let the query it enables actually start. */
  const tick = async (ms = 250) => {
    await act(async () => {
      vi.advanceTimersByTime(ms)
    })
    await act(async () => {
      await Promise.resolve()
    })
  }
  return { land, wrap, tick }
}

describe('useCardPaletteResults', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  /**
   * The report's headline complaint: ⌘K answering "Aucun résultat" for a card
   * that exists. It never came from an empty result set — it came from the
   * palette speaking before the answer arrived.
   */
  it('reports pending from the FIRST keystroke, before the debounce even fires', () => {
    const { wrap } = harness()
    render(wrap(<Probe search="kle" />))
    expect(screen.getByTestId('pending').textContent).toBe('true')
    expect(screen.getByTestId('fronts').textContent).toBe('')
  })

  it('stays pending until the answer for the CURRENT needle has landed', async () => {
    const { wrap, land, tick } = harness()
    render(wrap(<Probe search="kleene" />))
    await tick()
    expect(screen.getByTestId('pending').textContent).toBe('true')

    await land('kleene', [hit('c1', 'Théorème de Kleene', 'Automates')])
    expect(screen.getByTestId('pending').textContent).toBe('false')
    expect(screen.getByTestId('fronts').textContent).toBe('Théorème de Kleene')
  })

  /**
   * The anti-stale rule, end to end: `kle` is typed, the user keeps typing to
   * `kleene`, and the network delivers the FIRST answer last. Rendering it
   * would replace the right rows with a superset of them.
   */
  it('never renders a late answer to an older needle', async () => {
    const { wrap, land, tick } = harness()
    const { rerender } = render(wrap(<Probe search="kle" />))
    await tick()

    rerender(wrap(<Probe search="kleene" />))
    await tick()
    await land('kleene', [hit('c1', 'Théorème de Kleene', 'Automates')])
    expect(screen.getByTestId('fronts').textContent).toBe('Théorème de Kleene')

    // The stale answer finally arrives. It must change nothing.
    await land('kle', [hit('c9', 'Klein bottle', 'Topologie')])
    expect(screen.getByTestId('fronts').textContent).toBe('Théorème de Kleene')
    expect(screen.getByTestId('pending').textContent).toBe('false')
  })

  it('asks nothing at all with an empty box', async () => {
    const { wrap, tick } = harness()
    render(wrap(<Probe search="   " />))
    await tick()
    expect(inflight.size).toBe(0)
    expect(screen.getByTestId('pending').textContent).toBe('false')
  })
})

// --- the rows ---------------------------------------------------------------

describe('<CardResultsGroup>', () => {
  const base = { needle: 'kleene', total: 2, pending: false }

  it('shows the front as the label and the deck as its subtitle', () => {
    render(
      <CardResultsGroup
        results={{ ...base, hits: [hit('c1', 'Théorème de Kleene', 'Automates finis')] }}
        onSelectCard={() => {}}
        onSeeAll={() => {}}
      />,
    )
    expect(screen.getByText('Théorème de Kleene')).toBeTruthy()
    expect(screen.getByText('Automates finis')).toBeTruthy()
  })

  it('flattens Markdown rather than printing raw syntax in the corridor', () => {
    render(
      <CardResultsGroup
        results={{ ...base, hits: [hit('c1', '## **Kleene** `star`', 'Automates')] }}
        onSelectCard={() => {}}
        onSeeAll={() => {}}
      />,
    )
    expect(screen.getByText('Kleene star')).toBeTruthy()
  })

  it('marks a card whose subject is archived instead of hiding it', () => {
    render(
      <CardResultsGroup
        results={{ ...base, hits: [hit('c1', 'Vieux cours', 'Archive', true)] }}
        onSelectCard={() => {}}
        onSeeAll={() => {}}
      />,
    )
    expect(screen.getByText('Vieux cours')).toBeTruthy()
    expect(screen.getByText('archivée')).toBeTruthy()
  })

  it('offers a way to the full result set only when there IS more', () => {
    const hits = [hit('c1', 'A', 'Deck'), hit('c2', 'B', 'Deck')]
    const { rerender } = render(
      <CardResultsGroup
        results={{ ...base, total: 2, hits }}
        onSelectCard={() => {}}
        onSeeAll={() => {}}
      />,
    )
    expect(screen.queryByText(/Voir/)).toBeNull()

    rerender(
      <CardResultsGroup
        results={{ ...base, total: 57, hits }}
        onSelectCard={() => {}}
        onSeeAll={() => {}}
      />,
    )
    expect(screen.getByText('Voir les 57 résultats dans la recherche')).toBeTruthy()
  })

  it('renders nothing at all with no hits — an empty group is not a group', () => {
    const { container } = render(
      <CardResultsGroup
        results={{ ...base, total: 0, hits: [] }}
        onSelectCard={() => {}}
        onSeeAll={() => {}}
      />,
    )
    expect(container.textContent).toBe('')
  })
})

describe('<CardResultsSkeleton>', () => {
  it('announces a search in progress — never a result, never a spinner', () => {
    render(<CardResultsSkeleton />)
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-busy')).toBe('true')
    expect(status.getAttribute('aria-label')).toBe('Recherche dans les cartes…')
  })
})
