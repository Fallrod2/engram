// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { StreaksResponse, Subject } from '@engram/shared'
import { StatTilesRow } from './stat-tiles-row'
import { SubjectFilter } from './subject-filter'

/**
 * T-066 — the KPI row was the worst of the eight adjacent sites. `/analytics`
 * loads through `Promise.allSettled` ON PURPOSE, so no failure ever reaches the
 * route's `errorComponent`; the row was gated on `streaks && volume &&
 * studyTime` with `<StatTilesSkeleton>` as the else, and one dropped request
 * left four tiles pulsing until the tab was closed. Nothing on screen said
 * anything had gone wrong, and nothing ever would.
 *
 * The granularity is asserted here, both halves of it:
 *   · per TILE for the figures — a source that failed shows `—`, and the three
 *     that landed keep their numbers rather than being hidden with it;
 *   · one RETRY for the ROW — four buttons in four 100px boxes would be noise,
 *     and no one wants to re-ask for a single tile.
 */

afterEach(cleanup)

const STREAKS: StreaksResponse = {
  now: '2026-07-29T00:00:00.000Z',
  current: 14,
  longest: 20,
  includesToday: true,
  lastStudyDay: '2026-07-29',
  totalStudyDays: 60,
}

const TOTALS = { again: 2, hard: 3, good: 30, easy: 5, total: 40 }

function renderRow(o: Partial<Parameters<typeof StatTilesRow>[0]> = {}): ReturnType<typeof render> {
  return render(
    <StatTilesRow
      streaks={STREAKS}
      spark={[]}
      studyMs={3_600_000}
      totals={TOTALS}
      deltas={null}
      windowLabel="30 j"
      reduce
      {...o}
    />,
  )
}

describe('<StatTilesRow> — a source that did not land', () => {
  it('prints every figure when every source landed, and offers no retry', () => {
    renderRow()
    expect(screen.getByText('14')).toBeTruthy()
    expect(screen.getByText('1 h')).toBeTruthy()
    expect(screen.getByText('40')).toBeTruthy()
    expect(screen.getByText('95 %')).toBeTruthy()
    expect(screen.queryByText('Réessayer')).toBeNull()
    expect(screen.queryByText('indisponible')).toBeNull()
  })

  it('keeps the figures it HAS when one source failed', () => {
    // The whole point of per-tile: a dropped study-time request must not take
    // the streak, the review count and the success rate down with it.
    renderRow({ studyMs: undefined, onRetry: () => {} })
    expect(screen.getByText('14')).toBeTruthy()
    expect(screen.getByText('40')).toBeTruthy()
    expect(screen.getByText('95 %')).toBeTruthy()
    expect(screen.getAllByText('indisponible').length).toBe(1)
  })

  it('says `—` and never a zero for the tile whose source failed', () => {
    const { container } = renderRow({ studyMs: undefined, onRetry: () => {} })
    expect(container.textContent).not.toContain('0 min')
  })

  it('never turns a missing review count into a 0 % success rate', () => {
    // `successRate({total: 0})` is null, which the tile draws as `—`; the bug
    // would be reaching that state from an ABSENT payload and calling it data.
    renderRow({ totals: undefined, onRetry: () => {} })
    expect(screen.queryByText('0 %')).toBeNull()
    expect(screen.getAllByText('indisponible').length).toBe(2) // reviews + success
  })

  it('grows exactly one retry line for the row, and it fires', () => {
    const onRetry = vi.fn()
    renderRow({ streaks: undefined, totals: undefined, studyMs: undefined, onRetry })
    const buttons = screen.getAllByText('Réessayer')
    expect(buttons.length).toBe(1)
    expect(screen.getByText('Certains chiffres n’ont pas pu être lus.')).toBeTruthy()
    buttons[0]!.click()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

/**
 * The subject filter's own share of the same failure. An empty list and an
 * unreadable one open onto the identical menu — "Toutes les matières" and
 * nothing else — so the control has to say which one it is instead of offering
 * a narrowing it cannot perform.
 */
describe('<SubjectFilter> — an unreadable list is not an empty one', () => {
  const SUBJECTS = [{ id: 's1', name: 'Théorie des langages', color: '#7999f5' }] as Subject[]

  it('offers the picker when the list is merely empty', () => {
    render(<SubjectFilter subjects={[]} value={undefined} onChange={() => {}} />)
    expect(screen.getByLabelText('Matière')).toBeTruthy()
    expect(screen.queryByText('Matières indisponibles')).toBeNull()
  })

  it('says so, and stops pretending to offer a choice, when the read failed', () => {
    render(<SubjectFilter subjects={[]} unavailable value={undefined} onChange={() => {}} />)
    expect(screen.getByText('Matières indisponibles')).toBeTruthy()
    expect(screen.queryByLabelText('Matière')).toBeNull()
  })

  it('is unaffected while the list is readable', () => {
    render(<SubjectFilter subjects={SUBJECTS} value={undefined} onChange={() => {}} />)
    expect(screen.getByLabelText('Matière')).toBeTruthy()
  })
})
