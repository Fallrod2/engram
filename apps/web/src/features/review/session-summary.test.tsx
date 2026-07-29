// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { QueueNewCards } from '@engram/shared'
import type { RatingResult } from './session-reducer'
import { computeSummary } from './summary'
import { SessionSummary } from './session-summary'

afterEach(cleanup)

const RESULTS: RatingResult[] = [
  { cardId: 'a', grade: 1, durationMs: 2000 },
  { cardId: 'b', grade: 3, durationMs: 4000 },
  { cardId: 'c', grade: 3, durationMs: 6000 },
  { cardId: 'd', grade: 4, durationMs: 8000 },
]

describe('computeSummary + <SessionSummary> (§16.2 item 14)', () => {
  it('derives the correct stats', () => {
    const s = computeSummary(RESULTS)
    expect(s.viewed).toBe(4)
    expect(s.byGrade).toEqual({ 1: 1, 2: 0, 3: 2, 4: 1 })
    expect(s.totalMs).toBe(20_000)
    expect(s.avgMs).toBe(5000)
    expect(s.successRate).toBe(75) // (2 Good + 1 Easy) / 4
  })

  it('renders the hero count, distribution, times and success', () => {
    render(
      <SessionSummary
        summary={computeSummary(RESULTS)}
        canReviewAgain={false}
        canUndo={false}
        undoing={false}
        onExit={() => {}}
        onReviewAgain={() => {}}
        onUndo={() => {}}
      />,
    )
    expect(screen.getByText('4')).toBeTruthy() // hero viewed
    expect(screen.getByText('cartes vues')).toBeTruthy()
    expect(screen.getByText('0:20')).toBeTruthy() // total mm:ss
    expect(screen.getByText('5 s')).toBeTruthy() // avg
    expect(screen.getByText('75 %')).toBeTruthy() // success
  })

  it('gates the streak (no Phase-1 endpoint) — nothing rendered', () => {
    render(
      <SessionSummary
        summary={computeSummary(RESULTS)}
        canReviewAgain={false}
        canUndo={false}
        undoing={false}
        onExit={() => {}}
        onReviewAgain={() => {}}
        onUndo={() => {}}
      />,
    )
    expect(screen.queryByText(/streak/i)).toBeNull()
    expect(screen.queryByText(/série/i)).toBeNull()
  })

  it('hides "Réviser encore" until the probe finds a due card, then shows it', () => {
    const onReviewAgain = vi.fn()
    const { rerender } = render(
      <SessionSummary
        summary={computeSummary(RESULTS)}
        canReviewAgain={false}
        canUndo={false}
        undoing={false}
        onExit={() => {}}
        onReviewAgain={onReviewAgain}
        onUndo={() => {}}
      />,
    )
    expect(screen.queryByText('Réviser encore')).toBeNull()
    rerender(
      <SessionSummary
        summary={computeSummary(RESULTS)}
        canReviewAgain
        canUndo={false}
        undoing={false}
        onExit={() => {}}
        onReviewAgain={onReviewAgain}
        onUndo={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('Réviser encore'))
    expect(onReviewAgain).toHaveBeenCalledTimes(1)
  })

  // T-010: `canUndo` means "there is a rating to take back", `undoing` means "a
  // POST is in flight". The button is mounted on the first and disabled by the
  // second — it must not vanish for the length of the request.
  it('offers "Annuler" once a rating is undoable, and greys it out while it flies', () => {
    const onUndo = vi.fn()
    const props = {
      summary: computeSummary(RESULTS),
      canReviewAgain: false,
      onExit: () => {},
      onReviewAgain: () => {},
      onUndo,
    }
    const label = 'Annuler la dernière note (U)'
    const { rerender } = render(<SessionSummary {...props} canUndo={false} undoing={false} />)
    expect(screen.queryByRole('button', { name: label })).toBeNull()

    rerender(<SessionSummary {...props} canUndo undoing={false} />)
    const button = screen.getByRole('button', { name: label })
    expect((button as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(button)
    expect(onUndo).toHaveBeenCalledTimes(1)

    rerender(<SessionSummary {...props} canUndo undoing />)
    const pending = screen.getByRole('button', { name: label })
    expect((pending as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(pending)
    expect(onUndo).toHaveBeenCalledTimes(1) // still one: the click was refused
  })
})

/**
 * The MIXED case: the session was not empty — the user reviewed cards and
 * reached this summary — yet the daily budget still held new cards back. Without
 * a word here they walk away believing they have seen everything there was.
 *
 * The line is strictly conditional: the common case is `withheld === 0`, and a
 * permanent "0 cards held back" row would be noise on every single session.
 */
describe('<SessionSummary> — new cards held back by the daily budget', () => {
  const base = {
    summary: computeSummary(RESULTS),
    canReviewAgain: false,
    canUndo: false,
    undoing: false,
    onExit: () => {},
    onReviewAgain: () => {},
    onUndo: () => {},
  }
  const budget = (o: Partial<QueueNewCards> = {}): QueueNewCards => ({
    limit: 20,
    introduced: 0,
    remaining: 20,
    withheld: 0,
    ...o,
  })

  it('says nothing when nothing was held back (the common case)', () => {
    render(<SessionSummary {...base} newCards={budget({ withheld: 0 })} />)
    expect(screen.queryByText(/gardée/)).toBeNull()
  })

  it('says nothing when the server sent no budget at all', () => {
    render(<SessionSummary {...base} newCards={undefined} />)
    expect(screen.queryByText(/gardée/)).toBeNull()
  })

  it('explains why the session stopped there, with the limit', () => {
    render(
      <SessionSummary
        {...base}
        newCards={budget({ limit: 20, introduced: 20, remaining: 0, withheld: 5 })}
      />,
    )
    expect(
      screen.getByText('5 nouvelles cartes sont gardées pour demain (limite de 20/jour).'),
    ).toBeTruthy()
    // The stats are untouched — the note is additive, not a replacement.
    expect(screen.getByText('4')).toBeTruthy()
  })

  it('uses the singular for exactly one', () => {
    render(
      <SessionSummary
        {...base}
        newCards={budget({ limit: 3, introduced: 3, remaining: 0, withheld: 1 })}
      />,
    )
    expect(
      screen.getByText('1 nouvelle carte est gardée pour demain (limite de 3/jour).'),
    ).toBeTruthy()
  })

  it('uses the paused wording when the limit is 0, never "limite de 0/jour"', () => {
    render(<SessionSummary {...base} newCards={budget({ limit: 0, remaining: 0, withheld: 2 })} />)
    expect(
      screen.getByText('2 cartes jamais vues attendent : tes nouvelles cartes sont en pause.'),
    ).toBeTruthy()
    expect(screen.queryByText(/limite de 0/)).toBeNull()
  })
})
