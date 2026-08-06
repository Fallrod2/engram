// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { RetentionResponse, Subject } from '@engram/shared'
import { dictEn } from '@/lib/i18n/dict.en'
import { dictFr } from '@/lib/i18n/dict.fr'
import { RetentionBySubjectChart } from './retention-by-subject-chart'

/**
 * "Not enough data yet" was an excuse, not an answer (T-033): a reader with 20
 * days of history had no way to tell whether they were one review short or
 * fifty. The countdown must be derived from the server's own `minSample`, never
 * restated in the copy — these tests use a threshold that is NOT the production
 * 10, so a hard-coded number in the UI cannot pass them.
 */
/** recharts' ResponsiveContainer observes its box; jsdom ships no ResizeObserver. */
beforeEach(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    configurable: true,
  })
})
afterEach(cleanup)

const SUBJECTS = [
  { id: 's1', name: 'Théorie des langages', color: '#3b82f6' },
  { id: 's2', name: 'Anglais', color: '#22c55e' },
] as Subject[]

function response(
  minSample: number,
  subjects: Array<{ subjectId: string; maturedReviewed: number; recalled: number }>,
): RetentionResponse {
  return {
    from: '2026-07-01',
    to: '2026-07-28',
    minSample,
    subjects: subjects.map((s) => ({
      ...s,
      retention: s.maturedReviewed >= minSample ? s.recalled / s.maturedReviewed : null,
    })),
  }
}

function renderChart(data: RetentionResponse | undefined) {
  return render(
    <RetentionBySubjectChart
      data={data}
      subjects={SUBJECTS}
      windowLabel="30 j"
      isFetching={false}
      error={false}
      onRetry={() => {}}
    />,
  )
}

describe('<RetentionBySubjectChart> — why a subject has no bar', () => {
  it('names the number of mature reviews still missing, per subject', () => {
    renderChart(
      response(7, [
        { subjectId: 's1', maturedReviewed: 5, recalled: 4 },
        { subjectId: 's2', maturedReviewed: 0, recalled: 0 },
      ]),
    )
    // 7 − 5 = 2 and 7 − 0 = 7, from the response's own minSample.
    expect(screen.getByText('encore 2 reviews mûres')).toBeTruthy()
    expect(screen.getByText('encore 7 reviews mûres')).toBeTruthy()
    // …and the progress that produces them is on screen, not just the shortfall.
    expect(screen.getByText('5/7')).toBeTruthy()
    expect(screen.getByText('0/7')).toBeTruthy()
  })

  it('the threshold in the hint comes from the response, not from the copy', () => {
    renderChart(response(4, [{ subjectId: 's1', maturedReviewed: 1, recalled: 1 }]))
    expect(
      screen.getByText('La rétention apparaît à partir de 4 reviews mûres par matière.'),
    ).toBeTruthy()
  })

  it('singular reads as singular', () => {
    renderChart(response(3, [{ subjectId: 's1', maturedReviewed: 2, recalled: 2 }]))
    expect(screen.getByText('encore 1 review mûre')).toBeTruthy()
  })

  it('with NO subject rated, the list of subjects survives the empty state', () => {
    // The old behaviour dropped every row here, so the reader lost the list AND
    // the reason and was left with "review a bit more".
    renderChart(
      response(10, [
        { subjectId: 's1', maturedReviewed: 8, recalled: 7 },
        { subjectId: 's2', maturedReviewed: 3, recalled: 3 },
      ]),
    )
    expect(screen.getByText("Aucune matière n'a encore assez de reviews mûres.")).toBeTruthy()
    expect(screen.getByText('Théorie des langages')).toBeTruthy()
    expect(screen.getByText('Anglais')).toBeTruthy()
    expect(screen.getByText('encore 2 reviews mûres')).toBeTruthy()
    expect(screen.getByText('encore 7 reviews mûres')).toBeTruthy()
  })

  it('the closest subject to the threshold is listed first', () => {
    const { container } = renderChart(
      response(10, [
        { subjectId: 's2', maturedReviewed: 1, recalled: 1 },
        { subjectId: 's1', maturedReviewed: 9, recalled: 8 },
      ]),
    )
    // `.truncate` is the name cell; the SubjectDot next to it is also a span.
    const names = Array.from(container.querySelectorAll('ul > li > span.truncate')).map(
      (el) => el.textContent,
    )
    expect(names).toEqual(['Théorie des langages', 'Anglais'])
  })

  it('a rated subject keeps its bar and is never counted down', () => {
    renderChart(
      response(5, [
        { subjectId: 's1', maturedReviewed: 20, recalled: 18 },
        { subjectId: 's2', maturedReviewed: 2, recalled: 2 },
      ]),
    )
    expect(screen.queryByText("Aucune matière n'a encore assez de reviews mûres.")).toBeNull()
    expect(screen.getByText('encore 3 reviews mûres')).toBeTruthy()
    expect(screen.queryByText(/Théorie des langages.*encore/)).toBeNull()
  })
})

/**
 * The component renders through the provider-free FR default, so the English
 * half of the countdown is asserted on the dictionary itself: a translation that
 * dropped `{count}` would read "mature reviews to go" — exactly the vague
 * sentence this entry set out to remove.
 */
describe('the countdown survives translation', () => {
  const KEYS = [
    'retentionHint_one',
    'retentionHint_other',
    'retentionRemaining_one',
    'retentionRemaining_other',
  ] as const

  it('both languages interpolate the threshold', () => {
    for (const dict of [dictFr, dictEn]) {
      for (const key of KEYS) expect(dict.analytics[key], key).toContain('{count}')
    }
  })
})
