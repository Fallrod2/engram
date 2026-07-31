// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CardSearchHit } from '@engram/shared'
// The FSRS glyph in each row is a tooltip trigger; Radix needs its provider.
import { TooltipProvider } from '@/components/ui/tooltip'
import { EMPTY_SELECTION, type Selection } from '../selection'
import { SearchResultsTable } from './search-results-table'

afterEach(cleanup)

function hit(id: string, front: string, archived = false): CardSearchHit {
  return {
    card: {
      id,
      deckId: 'deck1',
      front,
      back: `back ${id}`,
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
    deck: { id: 'deck1', name: 'Automates' },
    subject: { id: 'sub1', name: 'TL', color: '#7999f5', icon: 'brain', archived },
  }
}

const HITS = [hit('a', 'Alpha'), hit('b', 'Bravo'), hit('c', 'Charlie'), hit('d', 'Delta')]

function renderTable(over: Partial<Parameters<typeof SearchResultsTable>[0]> = {}) {
  const spies = {
    onToggle: vi.fn(),
    onExtend: vi.fn(),
    onTogglePage: vi.fn(),
    onOpen: vi.fn(),
    onClearSelection: vi.fn(),
  }
  render(
    <TooltipProvider>
      <SearchResultsTable
        hits={HITS}
        selection={EMPTY_SELECTION}
        stale={false}
        {...spies}
        {...over}
      />
    </TooltipProvider>,
  )
  return spies
}

const rows = () => screen.getAllByRole('row').slice(1) // drop the header row
/** The per-row boxes, header "select the page" box excluded by its name. */
const boxes = () => screen.getAllByRole('checkbox', { name: 'Sélectionner cette carte' })

describe('<SearchResultsTable> keyboard', () => {
  it('Space toggles the row under the cursor', () => {
    const s = renderTable()
    fireEvent.focus(rows()[1]!)
    fireEvent.keyDown(rows()[1]!, { key: ' ' })
    expect(s.onToggle).toHaveBeenCalledWith('b')
  })

  it('Shift+ArrowDown moves the cursor AND extends in one press', () => {
    const s = renderTable()
    fireEvent.focus(rows()[1]!)
    fireEvent.keyDown(rows()[1]!, { key: 'ArrowDown', shiftKey: true })
    expect(s.onExtend).toHaveBeenCalledWith('c')
  })

  it('Shift+k extends upwards', () => {
    const s = renderTable()
    fireEvent.focus(rows()[2]!)
    fireEvent.keyDown(rows()[2]!, { key: 'k', shiftKey: true })
    expect(s.onExtend).toHaveBeenCalledWith('b')
  })

  it('does not run off the ends of the page', () => {
    const s = renderTable()
    fireEvent.focus(rows()[0]!)
    fireEvent.keyDown(rows()[0]!, { key: 'k', shiftKey: true })
    expect(s.onExtend).toHaveBeenCalledWith('a')
  })

  it('leaves plain j/k to the roving cursor — moving is not selecting', () => {
    const s = renderTable()
    fireEvent.focus(rows()[0]!)
    fireEvent.keyDown(rows()[0]!, { key: 'j' })
    expect(s.onExtend).not.toHaveBeenCalled()
    expect(s.onToggle).not.toHaveBeenCalled()
  })

  it('Enter opens the row under the cursor', () => {
    const s = renderTable()
    fireEvent.focus(rows()[2]!)
    fireEvent.keyDown(rows()[2]!, { key: 'Enter' })
    expect(s.onOpen).toHaveBeenCalledWith(HITS[2])
  })

  /**
   * The regression this file exists for. Escape lives on the LIST, not on the
   * window: as a global hotkey it also fired when Escape was cancelling the
   * delete confirmation — Radix closes the dialog on the same key and React has
   * already flushed that close by the time a window listener runs, so no
   * "is a modal open?" check can see it. The user backed out of a destructive
   * action and lost the selection that led to it. A dialog traps focus, so a
   * key handled here can only ever come from the list.
   */
  it('Escape clears the selection when the list has focus', () => {
    const s = renderTable()
    fireEvent.focus(rows()[0]!)
    fireEvent.keyDown(rows()[0]!, { key: 'Escape' })
    expect(s.onClearSelection).toHaveBeenCalledOnce()
  })
})

describe('<SearchResultsTable> mouse', () => {
  it('a plain click opens the card', () => {
    const s = renderTable()
    fireEvent.click(rows()[1]!)
    expect(s.onOpen).toHaveBeenCalledWith(HITS[1])
    expect(s.onExtend).not.toHaveBeenCalled()
  })

  it('Shift+click extends the range instead of opening', () => {
    const s = renderTable()
    fireEvent.click(rows()[3]!, { shiftKey: true })
    expect(s.onExtend).toHaveBeenCalledWith('d')
    expect(s.onOpen).not.toHaveBeenCalled()
  })

  it('the row checkbox selects without opening the card', () => {
    const s = renderTable()
    fireEvent.click(boxes()[2]!)
    expect(s.onToggle).toHaveBeenCalledWith('c')
    expect(s.onOpen).not.toHaveBeenCalled()
  })

  /**
   * The regression the test above USED to hide. "Shift+click extends" was
   * asserted by clicking the `<tr>` — never the box — while the box is exactly
   * what a hand aims at to pick a range. It swallowed the click before the row
   * could read `shiftKey` and silently degraded the gesture to a plain toggle:
   * rows 1 and 3 selected, row 2 skipped. So click the BOX, not the row.
   */
  it('Shift+click ON THE CHECKBOX extends the range, like anywhere else on the row', () => {
    const s = renderTable()
    fireEvent.click(boxes()[2]!, { shiftKey: true })
    expect(s.onExtend).toHaveBeenCalledWith('c')
    // Not a toggle, and not an open either: one gesture, one action.
    expect(s.onToggle).not.toHaveBeenCalled()
    expect(s.onOpen).not.toHaveBeenCalled()
  })
})

describe('<SearchResultsTable> state on screen', () => {
  const selection: Selection = { ids: ['a', 'b'], anchor: 'b' }

  it('marks selected rows for assistive tech, not only with colour', () => {
    renderTable({ selection })
    expect(rows().map((r) => r.getAttribute('aria-selected'))).toEqual([
      'true',
      'true',
      'false',
      'false',
    ])
  })

  it('shows the header checkbox as mixed when only part of the page is picked', () => {
    renderTable({ selection })
    const header = screen.getByRole('checkbox', {
      name: 'Sélectionner toutes les cartes de la page',
    }) as HTMLInputElement
    expect(header.indeterminate).toBe(true)
    expect(header.checked).toBe(false)
  })

  it('shows it fully checked when the whole page is picked', () => {
    renderTable({ selection: { ids: ['a', 'b', 'c', 'd'], anchor: 'd' } })
    const header = screen.getByRole('checkbox', {
      name: 'Sélectionner toutes les cartes de la page',
    }) as HTMLInputElement
    expect(header.checked).toBe(true)
    expect(header.indeterminate).toBe(false)
  })

  it('badges a card filed under an archived subject rather than hiding it', () => {
    render(
      <TooltipProvider>
        <SearchResultsTable
          hits={[hit('z', 'Vieux cours', true)]}
          selection={EMPTY_SELECTION}
          stale={false}
          onToggle={() => {}}
          onExtend={() => {}}
          onTogglePage={() => {}}
          onOpen={() => {}}
          onClearSelection={() => {}}
        />
      </TooltipProvider>,
    )
    expect(screen.getByText('Vieux cours')).toBeTruthy()
    expect(screen.getByText('Archivée')).toBeTruthy()
  })

  /**
   * A stale page is the previous needle's answer, kept on screen so the list
   * does not collapse mid-typing. It must be unmistakably inert: acting on a
   * row that answers a different question is how someone deletes the wrong card.
   */
  it('makes a stale page inert and announces it as busy', () => {
    const { container } = render(
      <TooltipProvider>
        <SearchResultsTable
          hits={HITS}
          selection={EMPTY_SELECTION}
          stale
          onToggle={() => {}}
          onExtend={() => {}}
          onTogglePage={() => {}}
          onOpen={() => {}}
          onClearSelection={() => {}}
        />
      </TooltipProvider>,
    )
    const box = container.querySelector('[aria-busy="true"]')
    expect(box).toBeTruthy()
    expect(box?.className).toContain('pointer-events-none')
  })
})
