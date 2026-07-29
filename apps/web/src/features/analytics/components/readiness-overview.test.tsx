// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type {
  ExamReadiness,
  ExamReadinessResponse,
  ReadinessBreakdown,
  Subject,
} from '@engram/shared'
import { ReadinessOverview } from './readiness-overview'

// TanStack Router's <Link> needs a router; the overview only uses it to point at
// a subject, so a plain anchor keeps these tests about the panel's own rules.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    className,
  }: {
    children: React.ReactNode
    className?: string
    to?: string
    params?: unknown
  }) => (
    <a href="#stub" className={className}>
      {children}
    </a>
  ),
}))

afterEach(cleanup)

const NOW = new Date('2026-07-29T10:00:00.000Z')
const SUBJECTS = [
  { id: 's1', name: 'Théorie des langages', color: '#7999f5' },
  { id: 's2', name: 'Architecture des ordinateurs', color: '#d1b64a' },
] as Subject[]

function breakdown(o: Partial<ReadinessBreakdown> = {}): ReadinessBreakdown {
  return {
    at: NOW.toISOString(),
    cardTotal: 14,
    ready: 11,
    notReady: 3,
    neverReviewed: 3,
    readiness: 11 / 14,
    meanRecall: 0.75,
    ...o,
  }
}

function exam(o: Partial<ExamReadiness> = {}): ExamReadiness {
  return {
    examId: 'e1',
    title: 'Partiel de théorie des langages',
    date: '2026-08-12T00:00:00.000Z',
    daysUntil: 14,
    status: 'forecast',
    projectedAt: '2026-08-12T00:00:00.000Z',
    projection: breakdown({ ready: 5, notReady: 9, readiness: 5 / 14 }),
    ...o,
  }
}

function response(subjects: ExamReadinessResponse['subjects']): ExamReadinessResponse {
  return { now: NOW.toISOString(), threshold: 0.9, pastWindowDays: 30, subjects }
}

function renderOverview(
  data: ExamReadinessResponse | undefined,
  opts: { error?: boolean; onRetry?: () => void } = {},
) {
  return render(
    <ReadinessOverview
      data={data}
      subjects={SUBJECTS}
      now={NOW}
      isFetching={false}
      error={opts.error ?? false}
      onRetry={opts.onRetry ?? (() => {})}
    />,
  )
}

describe('<ReadinessOverview>', () => {
  it('reads each exam as today → exam day, with the never-seen count called out', () => {
    renderOverview(response([{ subjectId: 's1', today: breakdown(), exams: [exam()] }]))
    expect(screen.getByText('79 %')).toBeTruthy()
    expect(screen.getByText('36 %')).toBeTruthy()
    expect(screen.getByText('3 jamais vues')).toBeTruthy()
  })

  it('puts the empty subject first and states the cause instead of a gauge', () => {
    const empty = breakdown({
      cardTotal: 0,
      ready: 0,
      notReady: 0,
      neverReviewed: 0,
      readiness: null,
      meanRecall: null,
    })
    renderOverview(
      response([
        { subjectId: 's1', today: breakdown(), exams: [exam({ daysUntil: 7 })] },
        {
          subjectId: 's2',
          today: empty,
          exams: [
            exam({
              examId: 'archi',
              title: 'Partiel d’architecture',
              daysUntil: 7,
              status: 'no_cards',
              projection: empty,
            }),
          ],
        },
      ]),
    )
    const rows = screen.getAllByRole('link')
    expect(rows[0]?.textContent).toContain('Partiel d’architecture')
    expect(screen.getByText('Aucune carte — rien à réviser d’ici là.')).toBeTruthy()
  })

  it('keeps past exams in a muted group, with no forecast', () => {
    renderOverview(
      response([
        {
          subjectId: 's1',
          today: breakdown(),
          exams: [
            exam({
              examId: 'past',
              title: 'Interro d’automates',
              daysUntil: -5,
              status: 'past',
              projectedAt: null,
              projection: null,
            }),
          ],
        },
      ]),
    )
    expect(screen.getByText('Examens passés')).toBeTruthy()
    expect(screen.getByText('Interro d’automates')).toBeTruthy()
    expect(screen.getByText('aucune projection')).toBeTruthy()
    expect(screen.getByText('Aucun examen à venir.')).toBeTruthy()
  })

  it('says "no exam coming up" only when the read SUCCEEDED and held none', () => {
    renderOverview(response([]))
    expect(screen.getByText('Aucun examen à venir.')).toBeTruthy()
  })

  it('a failed read shows the error and a retry — never the reassuring empty line', () => {
    const onRetry = vi.fn()
    renderOverview(undefined, { error: true, onRetry })
    expect(screen.getByText('Impossible de charger la préparation aux examens.')).toBeTruthy()
    expect(screen.queryByText('Aucun examen à venir.')).toBeNull()
    screen.getByText('Réessayer').click()
    expect(onRetry).toHaveBeenCalled()
  })

  it('drops a row whose subject is unknown client-side rather than rendering a blank one', () => {
    renderOverview(response([{ subjectId: 'gone', today: breakdown(), exams: [exam()] }]))
    expect(screen.getByText('Aucun examen à venir.')).toBeTruthy()
    expect(screen.queryByText('Partiel de théorie des langages')).toBeNull()
  })
})
