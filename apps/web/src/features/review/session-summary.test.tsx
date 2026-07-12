// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
        onExit={() => {}}
        onReviewAgain={() => {}}
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
        onExit={() => {}}
        onReviewAgain={() => {}}
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
        onExit={() => {}}
        onReviewAgain={onReviewAgain}
      />,
    )
    expect(screen.queryByText('Réviser encore')).toBeNull()
    rerender(
      <SessionSummary
        summary={computeSummary(RESULTS)}
        canReviewAgain
        onExit={() => {}}
        onReviewAgain={onReviewAgain}
      />,
    )
    fireEvent.click(screen.getByText('Réviser encore'))
    expect(onReviewAgain).toHaveBeenCalledTimes(1)
  })
})
